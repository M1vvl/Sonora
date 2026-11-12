using System.Windows;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using static Vortice.Direct3D11.D3D11;
using static Vortice.DXGI.DXGI;

namespace GlassDock.Rendering;

/// <summary>
/// All material surfaces on an output share one underlying-window compositor.
/// The application's own HWNDs remain capturable and are omitted only from this O1 scene.
/// The application uses a single WPF dispatcher; the context must not be called concurrently.
/// </summary>
internal sealed class SharedDesktopCapture
{
    private static readonly Dictionary<nint, SharedDesktopCapture> Captures = new();
    internal static int ActiveOutputCount=>Captures.Count;
    internal static bool SamplesWindow(nint window)=>Captures.Values.Any(capture=>capture._scene.SamplesWindow(window));
    private readonly nint _monitor;
    private readonly int _threadId = Environment.CurrentManagedThreadId;
    private readonly IDXGIOutput1 _output;
    private readonly WindowBackgroundScene _scene;
    private int _references;
    private long _lastPoll;
    private long _desktopGeneration=SessionSurfaceState.Generation;
    private ID3D11VertexShader? _vertexShader;
    private ID3D11PixelShader? _pixelShader;
    private ID3D11SamplerState? _sampler;
    private SharedDesktopCapture(nint monitor, Int32Rect bounds, ID3D11Device device,
        ID3D11DeviceContext context, IDXGIOutput1 output)
    {
        _monitor=monitor; Bounds=bounds; Device=device; Context=context;
        _output=output; _scene=new WindowBackgroundScene(device,context,bounds);
    }

    public ID3D11Device Device { get; }
    public ID3D11DeviceContext Context { get; }
    public Int32Rect Bounds { get; }
    public ID3D11Texture2D? DesktopTexture=>_scene.Texture;
    internal void SetRegion(object owner,Int32Rect region)=>_scene.SetRegion(owner,region);
    internal void RemoveRegion(object owner)=>_scene.RemoveRegion(owner);
    public long Version { get; private set; }
    public bool HasCurrentFrame { get; private set; }

    internal (ID3D11VertexShader Vertex,ID3D11PixelShader Pixel,ID3D11SamplerState Sampler) SharedPipeline(ReadOnlySpan<byte> vertex,ReadOnlySpan<byte> pixel)
    {
        VerifyThread();
        // Shaders and sampler state are immutable. Cards keep their own constants and
        // textures, but need only one copy of this pipeline per shared D3D device.
        _vertexShader??=Device.CreateVertexShader(vertex);
        _pixelShader??=Device.CreatePixelShader(pixel);
        _sampler??=Device.CreateSamplerState(SamplerDescription.LinearClamp);
        return (_vertexShader,_pixelShader,_sampler);
    }
    internal static object InspectMemory()=>new {
        outputs=Captures.Count,surfaces=Captures.Values.Sum(capture=>capture._references),
        sharedPipelines=Captures.Values.Count(capture=>capture._vertexShader is not null),
        desktopPixelBytes=Captures.Values.Sum(capture=>capture.DesktopTexture is null?0L:(long)capture.Bounds.Width*capture.Bounds.Height*4),
        source="underlying-hwnd-composition",windowSources=Captures.Values.Sum(capture=>capture._scene.SourceCount),
        errors=Captures.Values.Select(capture=>capture._scene.LastError).Where(error=>error is not null).Distinct().ToArray(),
        scenes=Captures.Values.Select(capture=>capture._scene.Inspect()).ToArray()
    };

    public static SharedDesktopCapture Acquire(Int32Rect region)
    {
        int centerX=region.X+region.Width/2, centerY=region.Y+region.Height/2;
        using IDXGIFactory1 factory=CreateDXGIFactory1<IDXGIFactory1>();
        for(uint adapterIndex=0;factory.EnumAdapters1(adapterIndex,out IDXGIAdapter1? adapter).Success;adapterIndex++)
        {
            using(adapter)
            {
                for(uint outputIndex=0;adapter.EnumOutputs(outputIndex,out IDXGIOutput? output).Success;outputIndex++)
                {
                    using(output)
                    {
                        var description=output.Description;
                        var r=description.DesktopCoordinates;
                        if(!description.AttachedToDesktop || centerX<r.Left || centerX>=r.Right || centerY<r.Top || centerY>=r.Bottom) continue;
                        if(description.Rotation is not ModeRotation.Identity and not ModeRotation.Unspecified)
                            throw new InvalidOperationException("Rotated displays currently use the solid material fallback.");
                        if(Captures.TryGetValue(description.Monitor,out var existing))
                        {
                            existing.VerifyThread();
                            existing._references++;
                            return existing;
                        }
                        ID3D11Device? device=null;
                        ID3D11DeviceContext? context=null;
                        IDXGIOutput1? output1=null;
                        try
                        {
                            D3D11CreateDevice(adapter,DriverType.Unknown,DeviceCreationFlags.BgraSupport,
                                [FeatureLevel.Level_11_0],out device,out context).CheckError();
                            output1=output.QueryInterface<IDXGIOutput1>();
                            var capture=new SharedDesktopCapture(description.Monitor,
                                new Int32Rect(r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top),device,context,output1)
                                { _references=1 };
                            Captures.Add(description.Monitor,capture);
                            return capture;
                        }
                        catch
                        {
                            output1?.Dispose(); context?.Dispose(); device?.Dispose();
                            throw;
                        }
                    }
                }
            }
        }
        throw new InvalidOperationException("No hardware output covers this surface.");
    }

    public void Update()
    {
        VerifyThread();
        if(_desktopGeneration!=SessionSurfaceState.Generation)
        {
            _desktopGeneration=SessionSurfaceState.Generation;
            HasCurrentFrame=false;
            _scene.ResetSources();
        }
        long now=Environment.TickCount64;
        // Dock/sidebar timers often run in the same dispatcher turn. One capture serves both.
        if(DesktopTexture is not null && now-_lastPoll<8) return;
        _lastPoll=now;
        if(_scene.Update()) { Version++; HasCurrentFrame=true; }
    }

    public void Release()
    {
        VerifyThread();
        if(--_references>0) return;
        Captures.Remove(_monitor);
        Context.ClearState();
        _sampler?.Dispose(); _sampler=null;
        _pixelShader?.Dispose(); _pixelShader=null;
        _vertexShader?.Dispose(); _vertexShader=null;
        _scene.Dispose();
        _output.Dispose();
        Context.Dispose(); Device.Dispose();
    }

    private void VerifyThread()
    {
        if(Environment.CurrentManagedThreadId!=_threadId)
            throw new InvalidOperationException("All glass surfaces for an output must use the same WPF dispatcher.");
    }
}

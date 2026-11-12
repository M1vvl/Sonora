using System.IO;
using System.Diagnostics;
using System.Numerics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using SharpGen.Runtime;
using Vortice.D3DCompiler;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;
using static Vortice.Direct3D11.D3D11;
using static Vortice.DXGI.DXGI;
using D3DMapFlags = Vortice.Direct3D11.MapFlags;

namespace GlassDock.Rendering;

/// <summary>
/// Small-region D3D11 optical material. Use one instance per surface, serially on its WPF
/// dispatcher. No browser, full-screen CPU bitmap, polling loop, or perpetual render thread.
/// Call only while the surface is visible, and cap calls at the selected material FPS.
/// </summary>
public sealed partial class GlassRenderer : IDisposable
{
    private static readonly Lazy<(byte[] Vertex,byte[] Pixel)> CompiledShaders=new(LoadShaderAssets);
    internal static bool UsingPrecompiledShaders { get; private set; }
    private static (byte[] Vertex,byte[] Pixel) LoadShaderAssets()
    {
        string source=ShaderSource(); var assembly=typeof(GlassRenderer).Assembly;
        string hash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(source)));
        using var manifest=assembly.GetManifestResourceStream("GlassDock.Rendering.Shaders.LiquidGlass.sha256");
        if(manifest is not null && new StreamReader(manifest).ReadToEnd().Trim()==hash)
        {
            byte[] Read(string suffix)
            {
                using var stream=assembly.GetManifestResourceStream("GlassDock.Rendering.Shaders.LiquidGlass."+suffix)??throw new InvalidOperationException("Missing compiled glass shader");
                using var bytes=new MemoryStream(); stream.CopyTo(bytes); return bytes.ToArray();
            }
            var result=(Read("vs.cso"),Read("ps.cso")); UsingPrecompiledShaders=true; return result;
        }
        return CompileShaderBytes(source);
    }
    private static (byte[] Vertex,byte[] Pixel) CompileShaderBytes(string source)=>(
        Compiler.Compile(source,"FullscreenVS","LiquidGlass.hlsl","vs_5_0",ShaderFlags.OptimizationLevel3).Span.ToArray(),
        Compiler.Compile(source,"GlassPS","LiquidGlass.hlsl","ps_5_0",ShaderFlags.OptimizationLevel3).Span.ToArray());
    internal static void CompileShaderAssets(string directory)
    {
        Directory.CreateDirectory(directory); string source=ShaderSource(); var compiled=CompileShaderBytes(source);
        File.WriteAllBytes(Path.Combine(directory,"LiquidGlass.vs.cso"),compiled.Vertex);
        File.WriteAllBytes(Path.Combine(directory,"LiquidGlass.ps.cso"),compiled.Pixel);
        File.WriteAllText(Path.Combine(directory,"LiquidGlass.sha256"),Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(source))));
        WindowBackgroundScene.CompileAssets(directory);
    }
    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private SharedDesktopCapture? _capture;
    private ID3D11VertexShader? _vertexShader;
    private ID3D11PixelShader? _pixelShader;
    private ID3D11Buffer? _parameters;
    private ID3D11SamplerState? _sampler;
    private ID3D11Texture2D? _paintComposeRT;
    private ID3D11ShaderResourceView? _backgroundView;
    private ID3D11Texture2D? _outputTexture;
    private ID3D11RenderTargetView? _outputView;
    private readonly ID3D11Texture2D?[] _readback = new ID3D11Texture2D?[2];
    private readonly long[] _pendingReadback = new long[2];
    private readonly float[] _pendingLightTime = new float[2];
    private long _readbackSequence;
    private WriteableBitmap? _bitmap;
    private BitmapSource? _retainedFrame;
    private Int32Rect _monitorBounds, _captureBounds, _outputBounds;
    private GlassOptions? _lastOptions;
    private bool _hasBackground, _hasMaterial, _materialDirty, _disposed;
    private DateTime _retryAfter;
    private long _lastCaptureVersion;
    private long _desktopGeneration=SessionSurfaceState.Generation;
    private float _lastLightTime;
    private bool _restoreLightOnce;
    private string _stage = "not started";
    private readonly Stopwatch _lightClock = Stopwatch.StartNew();

    public string? LastError { get; private set; }
    public bool IsAvailable => _device is not null && LastError is null;
    public bool LastFrameUpdated { get; private set; }
    public bool HasPendingFrame => _pendingReadback[0] != 0 || _pendingReadback[1] != 0;
    public bool IsTemporarilyUnavailable { get; private set; }
    internal long AllocationGeneration { get; private set; }
    internal int StagingTextureCount => _readback.Count(texture => texture is not null);

    internal object InspectMemory()
    {
        long backgroundBytes=0;
        if(_paintComposeRT is not null)
        {
            int width=_captureBounds.Width,height=_captureBounds.Height;
            while(true)
            {
                backgroundBytes+=(long)width*height*4;
                if(width==1 && height==1) break;
                width=Math.Max(1,width/2); height=Math.Max(1,height/2);
            }
        }
        long materialBytes=(long)_outputBounds.Width*_outputBounds.Height*4;
        long bitmapBytes=_bitmap is null?0:materialBytes;
        if(_retainedFrame is not null && !ReferenceEquals(_retainedFrame,_bitmap))
            bitmapBytes+=(long)_retainedFrame.PixelWidth*_retainedFrame.PixelHeight*4;
        return new {
            AllocationGeneration,StagingTextureCount,
            EstimatedBackgroundBytes=backgroundBytes,
            EstimatedOutputBytes=_outputTexture is null?0:materialBytes,
            EstimatedStagingBytes=StagingTextureCount*materialBytes,
            EstimatedBitmapBytes=bitmapBytes
        };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Parameters
    {
        public Vector2 OutputSize, CaptureSize, CaptureOffset;
        public float CornerRadius, SurfaceInset, Thickness, Transition, BackgroundDistance, Ior;
        public float Dispersion, Roughness, Tint, Time;
    }

    /// <summary>
    /// Region coordinates/sizes are physical screen pixels, never device-independent units.
    /// A false result with HasPendingFrame means the first image is still being prepared.
    /// During desktop/session transitions the last completed material is retained. A
    /// permanent LastError, rather than IsTemporarilyUnavailable, requires a fallback.
    /// On a static desktop, returns the same bitmap without GPU material work/readback.
    /// </summary>
    public bool TryRender(Int32Rect screenRegion, GlassOptions options, out BitmapSource? frame)
    {
        frame = IsTemporarilyUnavailable?_retainedFrame:null;
        LastFrameUpdated = false;
        if (_disposed || screenRegion.Width < 4 || screenRegion.Height < 4) return false;
        if(!SessionSurfaceState.CanCapture)
        {
            SuspendForDesktopTransition(); frame=_retainedFrame; return frame is not null;
        }
        if(_desktopGeneration!=SessionSurfaceState.Generation)
        {
            _desktopGeneration=SessionSurfaceState.Generation;
            SuspendForDesktopTransition(); _retryAfter=DateTime.MinValue;
        }
        if (DateTime.UtcNow < _retryAfter) { frame=IsTemporarilyUnavailable?_retainedFrame:null; return frame is not null; }
        try
        {
            _stage="acquiring shared desktop output";
            EnsureDevice(screenRegion);
            _stage="allocating regional surfaces";
            bool regionChanged = EnsureSurfaces(screenRegion);
            _stage="reading completed material frame";
            ReadbackReadyFrame();
            _stage="capturing/cropping desktop background";
            bool captured = CaptureBackground(); // O1 must precede any glass sampling.
            if (!_hasBackground) { frame=_retainedFrame; return frame is not null; }
            bool lightPoseChanged = options.LightTimeSeconds is null && !_restoreLightOnce
                && _lightClock.Elapsed.TotalSeconds - _lastLightTime >= 0.25;
            if (captured || regionChanged || _lastOptions != options || lightPoseChanged)
                _materialDirty = true;
            _stage="queueing optical material";
            if (_materialDirty && QueueMaterial(options))
            {
                _lastOptions = options;
                _materialDirty = false;
            }
            frame = _hasMaterial ? _bitmap : _retainedFrame;
            if(!IsTemporarilyUnavailable) LastError = null;
            return frame is not null;
        }
        catch (Exception ex) when (ex is SharpGenException or InvalidOperationException or ArgumentException or IOException)
        {
            HandleCaptureFailure(ex,$"D3D11 glass unavailable while {_stage}; region={screenRegion}");
            frame=IsTemporarilyUnavailable?_retainedFrame:null;
            return frame is not null;
        }
    }

    /// <summary>
    /// Presents a completed regional image without capturing or drawing another material.
    /// The window calls this on display frames only while a GPU copy is pending.
    /// </summary>
    public bool TryPresentPending(out BitmapSource? frame)
    {
        frame = null;
        LastFrameUpdated = false;
        if (_disposed || !HasPendingFrame) return false;
        if(!SessionSurfaceState.CanCapture)
        {
            SuspendForDesktopTransition(); frame=_retainedFrame; return false;
        }
        try
        {
            ReadbackReadyFrame();
            if (!LastFrameUpdated) return false;
            frame = _bitmap;
            return frame is not null;
        }
        catch (Exception ex) when (ex is SharpGenException or InvalidOperationException or ArgumentException)
        {
            HandleCaptureFailure(ex,$"D3D11 glass unavailable while presenting completed material; region={_outputBounds}");
            return false;
        }
    }

    private void HandleCaptureFailure(Exception exception,string context)
    {
        IsTemporarilyUnavailable=SessionSurfaceState.IsTransientCaptureFailure(exception);
        LastError=$"{context}: {exception}";
        if(IsTemporarilyUnavailable) { _restoreLightOnce=true; _lightClock.Stop(); }
        else _retainedFrame=null;
        ReleaseDevice();
        _retryAfter=DateTime.UtcNow.AddMilliseconds(IsTemporarilyUnavailable?250:4000);
    }

    internal void SuspendForDesktopTransition()
    {
        bool wasCapturing=_device is not null;
        SuspendResources();
        if(wasCapturing) _retryAfter=DateTime.UtcNow.AddMilliseconds(250);
    }

    internal void SuspendResources()
    {
        IsTemporarilyUnavailable=true; _restoreLightOnce=true; _lightClock.Stop();
        if(_device is not null) ReleaseDevice();
    }

    private void EnsureDevice(Int32Rect region)
    {
        int centerX = region.X + region.Width / 2, centerY = region.Y + region.Height / 2;
        if (_device is not null && Contains(_monitorBounds, centerX, centerY)) return;
        ReleaseDevice();
        _capture=SharedDesktopCapture.Acquire(region);
        _device=_capture.Device;
        _context=_capture.Context;
        _monitorBounds=_capture.Bounds;
        InitializePipeline();
    }

    private static bool Contains(Int32Rect r, int x, int y) =>
        x >= r.X && x < r.X+r.Width && y >= r.Y && y < r.Y+r.Height;

    private static string ShaderSource()
    {
        Assembly assembly = typeof(GlassRenderer).Assembly;
        string resource = assembly.GetManifestResourceNames().Single(n => n.EndsWith("LiquidGlass.hlsl", StringComparison.Ordinal));
        using var reader = new StreamReader(assembly.GetManifestResourceStream(resource)!);
        return reader.ReadToEnd();
    }

    /// <summary>Compiles both actual shipped entry points; suitable for --self-test.</summary>
    public static void ValidateShader()
    {
        string source = ShaderSource();
        var expected=CompileShaderBytes(source); var actual=CompiledShaders.Value;
        if(!UsingPrecompiledShaders)throw new InvalidOperationException("Compiled shader assets are absent or stale; regenerate them with scripts/build.ps1.");
        if(!actual.Vertex.SequenceEqual(expected.Vertex) || !actual.Pixel.SequenceEqual(expected.Pixel))throw new InvalidOperationException("Embedded glass shaders differ from the shipped HLSL compilation.");
        if (Marshal.SizeOf<Parameters>() != 64) throw new InvalidOperationException("Glass constant-buffer layout is invalid.");
    }

    /// <summary>Verifies queued GPU work can be presented without another capture/material tick.</summary>
    public static void ValidatePendingPresentation()
    {
        using var renderer = new GlassRenderer();
        var region = new Int32Rect(100,100,320,90);
        var options = new GlassOptions { LightTimeSeconds=0 };
        for(int attempt=0;attempt<20 && !renderer.HasPendingFrame;attempt++)
        {
            renderer.TryRender(region,options,out _);
            if(!renderer.HasPendingFrame) Thread.Sleep(10);
        }
        if(!renderer.HasPendingFrame)
            throw new InvalidOperationException(renderer.LastError ?? "No regional GPU frame was queued.");

        BitmapSource? frame=null;
        for(int attempt=0;attempt<40;attempt++)
        {
            if(renderer.TryPresentPending(out frame)) break;
            Thread.Sleep(10);
        }
        if(frame is null || renderer.HasPendingFrame)
            throw new InvalidOperationException(renderer.LastError ?? "Queued GPU frame did not present independently of the material timer.");
        if(renderer.TryPresentPending(out _) || renderer.LastFrameUpdated)
            throw new InvalidOperationException("An idle presenter reported an unqueued frame.");
    }

    /// <summary>
    /// Acquires a real GPU frame, evicts capture through the production desktop-transition
    /// path, verifies the displayed bitmap survives, then reacquires actual desktop pixels.
    /// This does not lock Windows or claim to exercise the secure desktop itself.
    /// </summary>
    public static void ValidateRecoveryRetention()
    {
        using var renderer=new GlassRenderer();
        var region=new Int32Rect(100,100,320,90);
        var options=new GlassOptions { LightTimeSeconds=0 };
        BitmapSource? original=null;
        for(int attempt=0;attempt<40;attempt++)
        {
            if(renderer.TryRender(region,options,out original) && original is not null) break;
            Thread.Sleep(15);
        }
        if(original is null) throw new InvalidOperationException(renderer.LastError??"No initial optical frame.");
        byte[] before=new byte[4],after=new byte[4];
        var sample=new Int32Rect(160,45,1,1);
        original.CopyPixels(sample,before,4,0);
        renderer.SuspendForDesktopTransition();
        if(!renderer.TryRender(region,options,out var retained) || !ReferenceEquals(original,retained) ||
           !renderer.IsTemporarilyUnavailable || renderer.HasPendingFrame || renderer.LastFrameUpdated)
            throw new InvalidOperationException("A desktop transition discarded or replaced the last completed material.");
        retained!.CopyPixels(sample,after,4,0);
        if(!before.SequenceEqual(after)) throw new InvalidOperationException("Retained material pixels changed while capture was suspended.");
        BitmapSource? recovered=null;
        for(int attempt=0;attempt<100;attempt++)
        {
            renderer.TryRender(region,options,out recovered);
            if(recovered is not null && !renderer.IsTemporarilyUnavailable && !ReferenceEquals(recovered,original)) break;
            Thread.Sleep(15);
        }
        if(recovered is null || renderer.IsTemporarilyUnavailable || ReferenceEquals(recovered,original))
            throw new InvalidOperationException(renderer.LastError??"Capture did not recover to a fresh optical frame.");
    }

    /// <summary>Actual two-surface DDA/GPU test, including crop change and shared lifetime.</summary>
    public static void ValidateConcurrentSurfaces()
    {
        using var dock=new GlassRenderer();
        using var sidebar=new GlassRenderer();
        var options=new GlassOptions { LightTimeSeconds=0 };
        var dockRegion=new Int32Rect(100,100,320,90);
        var sideRegion=new Int32Rect(450,100,74,562);
        BitmapSource? dockFrame=null,sideFrame=null;
        for(int attempt=0;attempt<24;attempt++)
        {
            dock.TryRender(dockRegion,options,out dockFrame);
            sidebar.TryRender(sideRegion,options,out sideFrame);
            if(dockFrame is not null && sideFrame is not null) break;
            Thread.Sleep(20);
        }
        if(dockFrame is null || sideFrame is null)
            throw new InvalidOperationException($"Concurrent glass surfaces failed. Dock: {dock.LastError}; sidebar: {sidebar.LastError}");
        if(!ReferenceEquals(dock._vertexShader,sidebar._vertexShader) || !ReferenceEquals(dock._pixelShader,sidebar._pixelShader) || !ReferenceEquals(dock._sampler,sidebar._sampler))
            throw new InvalidOperationException("Same-output surfaces duplicated immutable D3D pipeline resources.");
        dock.Dispose();
        long previousAllocation=sidebar.AllocationGeneration;
        sideFrame=null;
        sideRegion.X+=5; // A changed crop must work even when the desktop is completely static.
        for(int attempt=0;attempt<24;attempt++)
        {
            if(sidebar.TryRender(sideRegion,options,out sideFrame) && sideFrame is not null) break;
            Thread.Sleep(20);
        }
        if(sideFrame is null)
            throw new InvalidOperationException($"Remaining shared surface/crop update failed: {sidebar.LastError}");
        if(sidebar.AllocationGeneration!=previousAllocation)
            throw new InvalidOperationException("Moving an unchanged-size glass surface reallocated its GPU textures.");
        foreach(var origin in new[]{new System.Windows.Point(sidebar._monitorBounds.X+1,sidebar._monitorBounds.Y+1),
            new System.Windows.Point(sidebar._monitorBounds.X+sidebar._monitorBounds.Width-sideRegion.Width-1,sidebar._monitorBounds.Y+sidebar._monitorBounds.Height-sideRegion.Height-1)})
        {
            sideRegion.X=(int)origin.X; sideRegion.Y=(int)origin.Y; sideFrame=null;
            for(int attempt=0;attempt<24;attempt++) { if(sidebar.TryRender(sideRegion,options,out sideFrame) && sideFrame is not null)break; Thread.Sleep(20); }
            if(sideFrame is null || sidebar.AllocationGeneration!=previousAllocation)
                throw new InvalidOperationException("Monitor-edge movement reallocated an unchanged material or lost its optical frame.");
        }
    }

    private void InitializePipeline()
    {
        var shaders=CompiledShaders.Value;
        var pipeline=_capture!.SharedPipeline(shaders.Vertex,shaders.Pixel);
        _vertexShader=pipeline.Vertex; _pixelShader=pipeline.Pixel; _sampler=pipeline.Sampler;
        _parameters = _device!.CreateBuffer(new BufferDescription(64, BindFlags.ConstantBuffer));
    }

    private bool EnsureSurfaces(Int32Rect region)
    {
        if (_outputBounds == region && _paintComposeRT is not null) return false;
        // Keep real pixels outside the glass for outer-rim bleed. Clip only at monitor bounds.
        const int bleedPadding = 72;
        int captureWidth=Math.Min(_monitorBounds.Width,region.Width+2*bleedPadding),captureHeight=Math.Min(_monitorBounds.Height,region.Height+2*bleedPadding);
        // Shift the regional crop inward at monitor edges instead of changing its
        // dimensions and reallocating every GPU/readback/WPF surface while dragging.
        int left=Math.Clamp(region.X-bleedPadding,_monitorBounds.X,_monitorBounds.X+_monitorBounds.Width-captureWidth);
        int top=Math.Clamp(region.Y-bleedPadding,_monitorBounds.Y,_monitorBounds.Y+_monitorBounds.Height-captureHeight);
        int right=left+captureWidth,bottom=top+captureHeight;
        if (right <= left || bottom <= top) throw new InvalidOperationException("Glass surface is outside its monitor.");
        var captureBounds = new Int32Rect(left,top,right-left,bottom-top);
        bool canReuse = _paintComposeRT is not null
            && _outputBounds.Width==region.Width && _outputBounds.Height==region.Height
            && _captureBounds.Width==captureBounds.Width && _captureBounds.Height==captureBounds.Height;
        if(canReuse)
        {
            _outputBounds=region;
            _captureBounds=captureBounds;
            // Copies use one immediate context. A newly queued copy runs after any
            // abandoned readback, so the existing staging resources remain safe.
            Array.Clear(_pendingReadback);
            _hasBackground=false;
            _materialDirty=true;
            return true;
        }
        ReleaseSurfaces();
        _outputBounds=region;
        _captureBounds=captureBounds;

        // O1 BACKGROUND: GPU-only regional texture; GenerateMips creates SampleLevel LODs.
        _paintComposeRT = _device!.CreateTexture2D(new Texture2DDescription(
            Format.B8G8R8A8_UNorm, (uint)_captureBounds.Width, (uint)_captureBounds.Height,
            mipLevels: 0, bindFlags: BindFlags.ShaderResource | BindFlags.RenderTarget,
            miscFlags: ResourceOptionFlags.GenerateMips));
        _backgroundView = _device.CreateShaderResourceView(_paintComposeRT);
        _outputTexture = _device.CreateTexture2D(new Texture2DDescription(
            Format.B8G8R8A8_UNorm,(uint)region.Width,(uint)region.Height,mipLevels:1,
            bindFlags:BindFlags.RenderTarget));
        _outputView = _device.CreateRenderTargetView(_outputTexture);
        _readback[0]=CreateReadbackTexture();
        _bitmap = new WriteableBitmap(region.Width,region.Height,96,96,PixelFormats.Pbgra32,null);
        AllocationGeneration++;
        return true;
    }

    private ID3D11Texture2D CreateReadbackTexture() => _device!.CreateTexture2D(new Texture2DDescription(
        Format.B8G8R8A8_UNorm,(uint)_outputBounds.Width,(uint)_outputBounds.Height,mipLevels:1,
        bindFlags:BindFlags.None,usage:ResourceUsage.Staging,cpuAccessFlags:CpuAccessFlags.Read));

    private bool CaptureBackground()
    {
        _capture!.SetRegion(this,_captureBounds);
        _capture!.Update();
        if(!_capture.HasCurrentFrame || _capture.DesktopTexture is null || (_hasBackground && _lastCaptureVersion==_capture.Version)) return false;
        var sourceBox = new Box(_captureBounds.X-_monitorBounds.X,
            _captureBounds.Y-_monitorBounds.Y,0,
            _captureBounds.X-_monitorBounds.X+_captureBounds.Width,
            _captureBounds.Y-_monitorBounds.Y+_captureBounds.Height,1);
        _context!.PSUnsetShaderResource(0);
        _context.CopySubresourceRegion(_paintComposeRT!,0,0,0,0,_capture.DesktopTexture,0,sourceBox);
        _context.GenerateMips(_backgroundView!);
        _hasBackground = true;
        _lastCaptureVersion=_capture.Version;
        return true;
    }

    private bool QueueMaterial(GlassOptions options)
    {
        int slot = Array.FindIndex(_pendingReadback, sequence => sequence == 0);
        if (slot < 0) return false; // GPU is busy: retain the old image and retry on a later tick.
        // A second slot is useful only when another frame is genuinely still in
        // flight. Most small static surfaces complete before their next tick.
        _readback[slot]??=CreateReadbackTexture();
        float h = _outputBounds.Height;
        float safeIor = Math.Clamp(options.Ior,1.01f,2.2f);
        var parameters = new Parameters
        {
            OutputSize = new(_outputBounds.Width,_outputBounds.Height),
            CaptureSize = new(_captureBounds.Width,_captureBounds.Height),
            CaptureOffset = new(_outputBounds.X-_captureBounds.X,_outputBounds.Y-_captureBounds.Y),
            CornerRadius = Math.Max(options.CornerRadiusPixels,0)/h,
            SurfaceInset = Math.Clamp(options.SurfaceInsetPixels,0,Math.Min(_outputBounds.Width,_outputBounds.Height)*0.2f)/h,
            Thickness = Math.Clamp(options.ThicknessPixels,0.1f,24)/h,
            Transition = Math.Clamp(options.NormalTransitionPixels,1,40)/h,
            BackgroundDistance = Math.Clamp(options.BackgroundDistancePixels,0,72)/h,
            Ior = safeIor,
            Dispersion = Math.Clamp(options.Dispersion,0,Math.Min(0.04f,safeIor-1.001f)),
            Roughness = Math.Clamp(options.Roughness,0.08f,1),
            Tint = Math.Clamp(options.Tint,0,0.65f),
            Time = options.LightTimeSeconds ?? (_restoreLightOnce || IsTemporarilyUnavailable?_lastLightTime:(float)_lightClock.Elapsed.TotalSeconds)
        };
        _context!.UpdateSubresource(in parameters,_parameters!);
        _context.IASetPrimitiveTopology(PrimitiveTopology.TriangleList);
        _context.IASetInputLayout(null);
        _context.VSSetShader(_vertexShader);
        _context.PSSetShader(_pixelShader);
        _context.PSSetConstantBuffer(0,_parameters);
        _context.PSSetSampler(0,_sampler);
        _context.PSSetShaderResource(0,_backgroundView!);
        _context.OMSetRenderTargets(_outputView!);
        _context.RSSetViewport(0,0,_outputBounds.Width,_outputBounds.Height);
        _context.Draw(3,0);
        _context.PSUnsetShaderResource(0);
        _context.UnsetRenderTargets();
        _context.CopyResource(_readback[slot]!,_outputTexture!);
        _pendingReadback[slot] = ++_readbackSequence;
        _pendingLightTime[slot]=parameters.Time;
        _restoreLightOnce=false;
        _context.Flush(); // Submit work without waiting for GPU completion.
        return true;
    }

    private void ReadbackReadyFrame()
    {
        // Prefer the newest completed image; never synchronously wait for GPU readback.
        int newest = _pendingReadback[1] > _pendingReadback[0] ? 1 : 0;
        for (int attempt=0;attempt<2;attempt++)
        {
            int slot = attempt == 0 ? newest : 1-newest;
            long sequence = _pendingReadback[slot];
            if (sequence == 0) continue;
            Result result = _context!.Map(_readback[slot]!,0,MapMode.Read,D3DMapFlags.DoNotWait,out MappedSubresource mapped);
            if (result.Code == unchecked((int)0x887A000A)) continue; // DXGI_ERROR_WAS_STILL_DRAWING
            result.CheckError();
            try
            {
                int stride = checked((int)mapped.RowPitch);
                _bitmap!.WritePixels(new Int32Rect(0,0,_outputBounds.Width,_outputBounds.Height),
                    mapped.DataPointer,checked(stride*_outputBounds.Height),stride);
                _hasMaterial = true;
                _lastLightTime=_pendingLightTime[slot];
                _retainedFrame=_bitmap;
                IsTemporarilyUnavailable=false;
                LastError=null;
                _lightClock.Start();
                LastFrameUpdated = true;
            }
            finally { _context.Unmap(_readback[slot]!,0); }
            // GPU command ordering guarantees all earlier copies have also completed.
            for (int i=0;i<2;i++)
                if (_pendingReadback[i] <= sequence) _pendingReadback[i] = 0;
            return;
        }
    }

    private void ReleaseSurfaces()
    {
        _context?.ClearState();
        _backgroundView?.Dispose(); _backgroundView = null;
        _paintComposeRT?.Dispose(); _paintComposeRT = null;
        _outputView?.Dispose(); _outputView = null;
        _outputTexture?.Dispose(); _outputTexture = null;
        for(int i=0;i<_readback.Length;i++)
        {
            _readback[i]?.Dispose(); _readback[i] = null;
            _pendingReadback[i] = 0;
        }
        _bitmap = null;
        _lastOptions = null;
        _hasBackground = false;
        _hasMaterial = false;
        _materialDirty = false;
    }

    private void ReleaseDevice()
    {
        ReleaseSurfaces();
        _sampler = null; // Borrowed from the capture; its last owner releases the pipeline.
        _parameters?.Dispose(); _parameters = null;
        _pixelShader = null;
        _vertexShader = null;
        _context = null;
        _device = null;
        _capture?.RemoveRegion(this); _capture?.Release(); _capture=null;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        ReleaseDevice();
        _retainedFrame=null;
    }
}

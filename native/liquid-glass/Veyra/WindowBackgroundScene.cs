using System.IO;
using System.Numerics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.D3DCompiler;
using Vortice.DXGI;
using Vortice.Mathematics;

namespace GlassDock.Rendering;

/// <summary>O1: compose real underlying windows in Z order, omitting this process only.
/// Public screen/window recorders remain free to capture every GlassDock window.</summary>
internal sealed class WindowBackgroundScene : IDisposable
{
    internal static uint ExternalOwnerProcessId { get; set; }
    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private readonly Int32Rect _monitor;
    private readonly Dictionary<object,Int32Rect> _regions=[];
    private readonly Dictionary<nint,WindowCaptureSource> _sources=[];
    private readonly Dictionary<nint,long> _retry=[];
    private readonly List<(nint Window,Int32Rect Bounds,NativeWindowComposition Composition)> _order=[];
    private readonly ID3D11VertexShader _vs;
    private readonly ID3D11PixelShader _ps;
    private readonly ID3D11SamplerState _sampler;
    private readonly ID3D11Buffer _parameters;
    private readonly ID3D11BlendState _blend;
    private readonly ID3D11RenderTargetView _target;
    private long _lastEnumeration;
    private bool _dirty=true;
    private readonly Dictionary<nint,long> _started=[];
    internal ID3D11Texture2D Texture { get; }
    internal int SourceCount=>_sources.Count;
    internal bool SamplesWindow(nint window)=>_sources.ContainsKey(window);
    internal string? LastError { get; private set; }
    internal object Inspect()
    {
        nint foreground=DesktopNative.GetForegroundWindow(); GetWindowThreadProcessId(foreground,out uint process); GetBounds(foreground,out var bounds);
        DwmGetWindowAttribute(foreground,14,out int cloaked,4);
        return new {regions=_regions.Values.ToArray(),foreground=new {window=foreground.ToInt64(),process,visible=IsWindowVisible(foreground),iconic=IsIconic(foreground),cloaked,bounds},windows=_order.Select(item=>new {window=item.Window.ToInt64(),name=WindowClass(item.Window),x=item.Bounds.X,y=item.Bounds.Y,width=item.Bounds.Width,height=item.Bounds.Height,item.Composition,frame=_sources.GetValueOrDefault(item.Window)?.Inspect()}).ToArray()};
    }
    private const string Shader="""
        Texture2D<float4> windowPixels : register(t0);
        SamplerState pixels : register(s0);
        cbuffer WindowPlacement : register(b0) { float2 origin; float2 size; float4 keyAndOpacity; float4 modes; };
        struct V { float4 position:SV_Position; };
        V SceneVS(uint id:SV_VertexID) { V v; float2 uv=float2((id<<1)&2,id&2); v.position=float4(uv*float2(2,-2)+float2(-1,1),0,1); return v; }
        float4 ScenePS(V v):SV_Target {
            float4 color=windowPixels.SampleLevel(pixels,(v.position.xy-origin)/size,0);
            if(modes.x>0.5 && all(abs(color.rgb-keyAndOpacity.rgb)<(0.5/255.0)))return 0;
            return color*keyAndOpacity.a;
        }
        """;
    private static readonly Lazy<(byte[] Vertex,byte[] Pixel)> Shaders=new(()=> {
        using var manifest=typeof(WindowBackgroundScene).Assembly.GetManifestResourceStream("GlassDock.Rendering.Shaders.WindowScene.sha256");
        bool current=manifest is not null && new StreamReader(manifest).ReadToEnd().Trim()==ShaderHash();
        byte[] Read(string stage)
        {
            using var stream=current?typeof(WindowBackgroundScene).Assembly.GetManifestResourceStream("GlassDock.Rendering.Shaders.WindowScene."+stage+".cso"):null;
            if(stream is null)return Compiler.Compile(Shader,stage=="vs"?"SceneVS":"ScenePS","WindowScene",stage+"_5_0",ShaderFlags.OptimizationLevel3).Span.ToArray();
            using var bytes=new MemoryStream(); stream.CopyTo(bytes); return bytes.ToArray();
        }
        return (Read("vs"),Read("ps"));
    });
    internal static void CompileAssets(string directory)
    {
        foreach(string stage in new[]{"vs","ps"})File.WriteAllBytes(Path.Combine(directory,"WindowScene."+stage+".cso"),Compiler.Compile(Shader,stage=="vs"?"SceneVS":"ScenePS","WindowScene",stage+"_5_0",ShaderFlags.OptimizationLevel3).Span.ToArray());
        File.WriteAllText(Path.Combine(directory,"WindowScene.sha256"),ShaderHash());
    }
    private static string ShaderHash()=>Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(Shader)));
    [StructLayout(LayoutKind.Sequential)] private struct Placement {internal Vector4 Bounds,KeyAndOpacity,Modes;}
    internal WindowBackgroundScene(ID3D11Device device,ID3D11DeviceContext context,Int32Rect monitor)
    {
        _device=device; _context=context; _monitor=monitor;
        using(var threading=context.QueryInterface<ID3D11Multithread>())threading.SetMultithreadProtected(true);
        Texture=device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm,(uint)monitor.Width,(uint)monitor.Height,mipLevels:1,bindFlags:BindFlags.RenderTarget));
        _target=device.CreateRenderTargetView(Texture);
        _vs=device.CreateVertexShader(Shaders.Value.Vertex); _ps=device.CreatePixelShader(Shaders.Value.Pixel);
        _sampler=device.CreateSamplerState(SamplerDescription.LinearClamp);
        _parameters=device.CreateBuffer(new BufferDescription(48,BindFlags.ConstantBuffer));
        _blend=device.CreateBlendState(BlendDescription.AlphaBlend);
    }
    internal void SetRegion(object owner,Int32Rect region)
    {
        if(_regions.TryGetValue(owner,out var previous) && previous==region)return;
        _regions[owner]=region; _lastEnumeration=0; _dirty=true;
    }
    internal void RemoveRegion(object owner) { if(_regions.Remove(owner)) { _lastEnumeration=0; _dirty=true; } }
    internal bool Update()
    {
        long now=Environment.TickCount64;
        if(now-_lastEnumeration>=80) { Enumerate(now); _lastEnumeration=now; }
        bool changed=_dirty;
        foreach(var pair in _order)
        {
            if(!_sources.TryGetValue(pair.Window,out var source))continue;
            try { changed|=source.Update(_device); }
            catch(Exception exception) when(exception is COMException or SharpGen.Runtime.SharpGenException or InvalidOperationException or UnauthorizedAccessException or InvalidCastException)
            { LastError=exception.Message; _retry[pair.Window]=now+3000; source.Dispose(); _sources.Remove(pair.Window); changed=true; }
            if(source.View is null && _sources.ContainsKey(pair.Window) && now-_started.GetValueOrDefault(pair.Window,now)>1800)
            {
                LastError="Background source did not deliver its first frame: "+WindowClass(pair.Window);
                source.Dispose(); _sources.Remove(pair.Window); _retry[pair.Window]=now+500; changed=true;
            }
        }
        if(!changed)return false;
        // A newly opened capture session is not a background frame. Never publish
        // the cleared RT while the desktop / replacement HWND is still warming up.
        var ready=_order.Where(pair=>_sources.TryGetValue(pair.Window,out var source) && source.View is not null).ToArray();
        var opaqueReady=ready.Where(pair=>WindowClass(pair.Window) is "WorkerW" or "Progman" || pair.Composition.CanOcclude);
        if(!CoversRegions(_regions.Values,opaqueReady.Select(pair=>pair.Bounds),_monitor))return false;
        _context.PSUnsetShaderResource(0); _context.OMSetRenderTargets(_target);
        _context.ClearRenderTargetView(_target,new Color4(0.025f,0.03f,0.04f,1));
        _context.OMSetBlendState(_blend); _context.IASetInputLayout(null); _context.IASetPrimitiveTopology(PrimitiveTopology.TriangleList);
        _context.VSSetShader(_vs); _context.PSSetShader(_ps); _context.PSSetSampler(0,_sampler); _context.PSSetConstantBuffer(0,_parameters);
        foreach(var pair in _order.AsEnumerable().Reverse())
        {
            if(!_sources.TryGetValue(pair.Window,out var source) || source.View is null)continue;
            var clip=Intersect(pair.Bounds,_monitor); if(clip.IsEmpty)continue;
            var style=pair.Composition;
            var placement=new Placement {
                Bounds=new Vector4(pair.Bounds.X-_monitor.X,pair.Bounds.Y-_monitor.Y,pair.Bounds.Width,pair.Bounds.Height),
                KeyAndOpacity=new Vector4((style.ColorKey&255)/255f,((style.ColorKey>>8)&255)/255f,((style.ColorKey>>16)&255)/255f,style.Opacity),
                Modes=new Vector4(style.UsesColorKey?1:0,0,0,0)
            };
            _context.UpdateSubresource(in placement,_parameters);
            _context.RSSetViewport(clip.X-_monitor.X,clip.Y-_monitor.Y,clip.Width,clip.Height);
            _context.PSSetShaderResource(0,source.View); _context.Draw(3,0);
        }
        _context.PSUnsetShaderResource(0); _context.UnsetRenderTargets(); _context.OMSetBlendState(null);
        _dirty=false; LastError=null; return true;
    }
    internal static bool CoversRegions(IEnumerable<Int32Rect> regions,IEnumerable<Int32Rect> readyBounds,Int32Rect monitor)
    {
        var covers=readyBounds.ToArray(); bool any=false;
        foreach(var region in regions)
        {
            var clipped=Intersect(region,monitor); if(clipped.IsEmpty)continue;
            any=true; var missing=new List<Int32Rect> {clipped};
            foreach(var cover in covers) { missing=missing.SelectMany(rect=>Subtract(rect,cover)).ToList(); if(missing.Count==0)break; }
            if(missing.Count!=0)return false;
        }
        return any;
    }
    internal void ResetSources()
    {
        foreach(var source in _sources.Values)source.Dispose();
        _sources.Clear(); _started.Clear(); _retry.Clear(); _order.Clear(); _lastEnumeration=0; _dirty=true;
    }
    private void Enumerate(long now)
    {
        var next=new List<(nint Window,Int32Rect Bounds,NativeWindowComposition Composition)>(); var opaque=new List<Int32Rect>();
        var windows=new List<nint>();
        for(nint window=GetTopWindow(0);window!=0 && windows.Count<4096;window=GetWindow(window,2))windows.Add(window);
        foreach(nint window in windows)Consider(window);
        bool Consider(nint window)
        {
            if(!IsWindowVisible(window) || IsIconic(window))return true;
            GetWindowThreadProcessId(window,out uint process); if(process==(uint)Environment.ProcessId || process==ExternalOwnerProcessId)return true;
            if(DwmGetWindowAttribute(window,14,out int cloaked,4)==0 && cloaked!=0)return true;
            var composition=NativeWindowComposition.Read(window); if(!composition.Visible)return true;
            if(!GetBounds(window,out var bounds))return true;
            bool desktop=WindowClass(window) is "WorkerW" or "Progman";
            var visible=_regions.Values.Select(region=>Intersect(region,bounds)).Where(rect=>!rect.IsEmpty).ToList();
            // Keep the real desktop as the base. An empty or transparent capture
            // above it must not cull the only pixels available underneath.
            if(!desktop)foreach(var cover in opaque) { visible=visible.SelectMany(rect=>Subtract(rect,cover)).ToList(); if(visible.Count==0)break; }
            if(visible.Count==0)return true;
            next.Add((window,bounds,composition));
            if(!desktop && composition.CanOcclude && _sources.TryGetValue(window,out var ready) && ready.View is not null)opaque.Add(bounds);
            return true;
        }
        if(!_order.SequenceEqual(next))_dirty=true;
        _order.Clear(); _order.AddRange(next);
        var selected=next.Select(item=>item.Window).ToHashSet();
        foreach(var pair in _sources.ToArray())if(!selected.Contains(pair.Key) || pair.Value.Closed) { pair.Value.Dispose(); _sources.Remove(pair.Key); _started.Remove(pair.Key); _dirty=true; }
        foreach(var item in next)
        {
            if(_sources.ContainsKey(item.Window) || _retry.TryGetValue(item.Window,out long retry) && now<retry)continue;
            try { _sources.Add(item.Window,new WindowCaptureSource(item.Window,_device)); _started[item.Window]=now; _dirty=true; }
            catch(Exception exception) when(exception is COMException or SharpGen.Runtime.SharpGenException or InvalidOperationException or ArgumentException or UnauthorizedAccessException or InvalidCastException)
            { LastError=exception.Message; _retry[item.Window]=now+5000; }
        }
        foreach(var old in _retry.Keys.Where(window=>!selected.Contains(window)).ToArray())_retry.Remove(old);
    }
    private static string WindowClass(nint window) { var name=new StringBuilder(100); GetClassName(window,name,name.Capacity); return name.ToString(); }
    private static bool GetBounds(nint window,out Int32Rect bounds)
    {
        if((DwmGetWindowRect(window,9,out var rect,16)!=0 || rect.Right<=rect.Left || rect.Bottom<=rect.Top) && !GetWindowRect(window,out rect)) { bounds=Int32Rect.Empty; return false; }
        bounds=new Int32Rect(rect.Left,rect.Top,Math.Max(0,rect.Right-rect.Left),Math.Max(0,rect.Bottom-rect.Top)); return bounds.Width>0 && bounds.Height>0;
    }
    private static Int32Rect Intersect(Int32Rect a,Int32Rect b)
    {
        int x=Math.Max(a.X,b.X),y=Math.Max(a.Y,b.Y),r=Math.Min(a.X+a.Width,b.X+b.Width),bottom=Math.Min(a.Y+a.Height,b.Y+b.Height);
        return r>x && bottom>y?new(x,y,r-x,bottom-y):Int32Rect.Empty;
    }
    private static IEnumerable<Int32Rect> Subtract(Int32Rect rect,Int32Rect cover)
    {
        var hit=Intersect(rect,cover); if(hit.IsEmpty) { yield return rect; yield break; }
        if(hit.Y>rect.Y)yield return new(rect.X,rect.Y,rect.Width,hit.Y-rect.Y);
        if(hit.Y+hit.Height<rect.Y+rect.Height)yield return new(rect.X,hit.Y+hit.Height,rect.Width,rect.Y+rect.Height-hit.Y-hit.Height);
        if(hit.X>rect.X)yield return new(rect.X,hit.Y,hit.X-rect.X,hit.Height);
        if(hit.X+hit.Width<rect.X+rect.Width)yield return new(hit.X+hit.Width,hit.Y,rect.X+rect.Width-hit.X-hit.Width,hit.Height);
    }
    public void Dispose()
    {
        ResetSources(); _regions.Clear();
        _target.Dispose(); Texture.Dispose(); _blend.Dispose(); _parameters.Dispose(); _sampler.Dispose(); _ps.Dispose(); _vs.Dispose();
    }
    [DllImport("user32.dll")] private static extern nint GetTopWindow(nint parent);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint window,uint command);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window,out uint process);
    [DllImport("user32.dll")] private static extern int GetWindowLong(nint window,int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint window,out DesktopNative.Rect bounds);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetClassName(nint window,StringBuilder name,int length);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint window,uint attribute,out int value,int size);
    [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")] private static extern int DwmGetWindowRect(nint window,uint attribute,out DesktopNative.Rect value,int size);
}

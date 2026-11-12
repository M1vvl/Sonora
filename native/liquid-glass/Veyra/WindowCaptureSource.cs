using System.Runtime.InteropServices;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;

namespace GlassDock.Rendering;

/// <summary>Captures an underlying HWND, never the monitor containing our own glass.</summary>
internal sealed unsafe class WindowCaptureSource : IDisposable
{
    private readonly IDirect3DDevice _device;
    private readonly GraphicsCaptureItem _item;
    private readonly Direct3D11CaptureFramePool _pool;
    private readonly GraphicsCaptureSession _session;
    private nint _frame,_poolInterface;
    private readonly List<(nint Pointer,ID3D11Texture2D Texture,ID3D11ShaderResourceView View)> _buffers=new(2);
    private ID3D11Texture2D? _texture;
    internal ID3D11ShaderResourceView? View { get; private set; }
    internal ID3D11Texture2D? Texture=>_texture;
    internal long Version { get; private set; }
    internal bool Closed { get; private set; }
    internal object Inspect()=>new {width=_size.Width,height=_size.Height,Version,Closed,ready=View is not null,cachedViews=_buffers.Count,nativeFrameOwnership=true};
    private Windows.Graphics.SizeInt32 _size;
    internal WindowCaptureSource(nint window,ID3D11Device device)
    {
        using var dxgi=device.QueryInterface<IDXGIDevice>();
        Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi.NativePointer,out nint abi));
        try { _device=WinRT.MarshalInterface<IDirect3DDevice>.FromAbi(abi); }
        finally { Marshal.Release(abi); }
        try
        {
            _item=CreateItem(window); _size=_item.Size;
            _pool=Direct3D11CaptureFramePool.CreateFreeThreaded(_device,DirectXPixelFormat.B8G8R8A8UIntNormalized,2,_size);
            nint poolAbi=WinRT.MarshalInspectable<Direct3D11CaptureFramePool>.FromManaged(_pool);
            try {Guid iid=new("24EB6D22-1975-422E-82E7-780DBD8DDF24"); Marshal.ThrowExceptionForHR(Marshal.QueryInterface(poolAbi,ref iid,out _poolInterface));}
            finally {Marshal.Release(poolAbi);}
            _session=_pool.CreateCaptureSession(_item);
            _session.IsCursorCaptureEnabled=false;
            SetBorderless(_session);
            _item.Closed+=ItemClosed;
            _session.StartCapture();
        }
        catch { if(_item is not null)_item.Closed-=ItemClosed; _session?.Dispose(); _pool?.Dispose(); if(_poolInterface!=0)Marshal.Release(_poolInterface); _device.Dispose(); throw; }
    }
    private void ItemClosed(GraphicsCaptureItem sender,object args)=>Closed=true;
    internal bool Update(ID3D11Device device)
    {
        if(Closed)return false;
        nint next=NextFrame(); if(next==0)return false;
        // Keep only the newest complete native frame. No CPU image or duplicate cache.
        for(int count=0;count<2;count++) { nint newer=NextFrame(); if(newer==0)break; CloseFrame(next); next=newer; }
        Windows.Graphics.SizeInt32 contentSize=default;
        var getSize=(delegate* unmanaged[Stdcall]<nint,Windows.Graphics.SizeInt32*,int>)(*(nint**)next)[8];
        int sizeResult=getSize(next,&contentSize);
        if(sizeResult<0) {CloseFrame(next); Marshal.ThrowExceptionForHR(sizeResult);}
        if(contentSize.Width!=_size.Width || contentSize.Height!=_size.Height)
        {
            _size=contentSize; CloseFrame(next); ReleaseBuffers();
            if(_size.Width>0 && _size.Height>0)_pool.Recreate(_device,DirectXPixelFormat.B8G8R8A8UIntNormalized,2,_size);
            return false;
        }
        ReleaseFrame(); _frame=next;
        nint surface=0,access=0;
        try
        {
            // Read the ABI directly: a per-frame projected Surface can retain a
            // full native GPU buffer until CLR finalization, long after Close().
            var getSurface=(delegate* unmanaged[Stdcall]<nint,nint*,int>)(*(nint**)next)[6];
            Marshal.ThrowExceptionForHR(getSurface(next,&surface));
            Guid accessId=new("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(surface,ref accessId,out access));
            Guid textureId=new("6F15AAF2-D208-4E89-9AB4-489535D34F9C"); nint texture=0;
            var method=(delegate* unmanaged[Stdcall]<nint,Guid*,nint*,int>)(*(nint**)access)[3];
            Marshal.ThrowExceptionForHR(method(access,&textureId,&texture));
            int existing=-1; for(int index=0;index<_buffers.Count;index++)if(_buffers[index].Pointer==texture) {existing=index; break;}
            if(existing>=0)
            {
                Marshal.Release(texture); var buffer=_buffers[existing];
                _buffers.RemoveAt(existing); _buffers.Add(buffer); _texture=buffer.Texture; View=buffer.View;
            }
            else
            {
                var nativeTexture=new ID3D11Texture2D(texture);
                ID3D11ShaderResourceView view;
                try {view=device.CreateShaderResourceView(nativeTexture);} catch {nativeTexture.Dispose(); throw;}
                if(_buffers.Count==2) {var old=_buffers[0]; _buffers.RemoveAt(0); old.View.Dispose(); old.Texture.Dispose();}
                _buffers.Add((texture,nativeTexture,view)); _texture=nativeTexture; View=view;
            }
            Version++;
        }
        finally { if(access!=0)Marshal.Release(access); if(surface!=0)Marshal.Release(surface); }
        return true;
    }
    private nint NextFrame()
    {
        nint frame=0; var next=(delegate* unmanaged[Stdcall]<nint,nint*,int>)(*(nint**)_poolInterface)[7];
        Marshal.ThrowExceptionForHR(next(_poolInterface,&frame)); return frame;
    }
    private static void CloseFrame(nint frame)
    {
        if(frame==0)return;
        nint closable=0; Guid iid=new("30D5A829-7FA4-4026-83BB-D75BAE4EA99E");
        try {if(Marshal.QueryInterface(frame,ref iid,out closable)>=0) {var close=(delegate* unmanaged[Stdcall]<nint,int>)(*(nint**)closable)[6]; close(closable);}}
        finally {if(closable!=0)Marshal.Release(closable); Marshal.Release(frame);}
    }
    private void ReleaseFrame() {View=null; _texture=null; CloseFrame(_frame); _frame=0;}
    private void ReleaseBuffers() {ReleaseFrame(); foreach(var buffer in _buffers) {buffer.View.Dispose(); buffer.Texture.Dispose();} _buffers.Clear();}
    public void Dispose()
    {
        _item.Closed-=ItemClosed; _session.Dispose(); ReleaseBuffers(); _pool.Dispose(); Marshal.Release(_poolInterface); _poolInterface=0; _device.Dispose();
    }
    private static GraphicsCaptureItem CreateItem(nint window)
    {
        const string name="Windows.Graphics.Capture.GraphicsCaptureItem";
        Marshal.ThrowExceptionForHR(WindowsCreateString(name,name.Length,out nint text));
        nint factory=0,item=0;
        try
        {
            Guid interop=new("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
            Marshal.ThrowExceptionForHR(RoGetActivationFactory(text,ref interop,out factory));
            Guid itemId=new("79C3F95B-31F7-4EC2-A464-632EF5D30760");
            var create=(delegate* unmanaged[Stdcall]<nint,nint,Guid*,nint*,int>)(*(nint**)factory)[3];
            Marshal.ThrowExceptionForHR(create(factory,window,&itemId,&item));
            return WinRT.MarshalInterface<GraphicsCaptureItem>.FromAbi(item);
        }
        finally { if(item!=0)Marshal.Release(item); if(factory!=0)Marshal.Release(factory); WindowsDeleteString(text); }
    }
    private static void SetBorderless(GraphicsCaptureSession session)
    {
        nint abi=WinRT.MarshalInspectable<GraphicsCaptureSession>.FromManaged(session),version3=0;
        try
        {
            Guid iid=new("F2CDD966-22AE-5EA1-9596-3A289344C3BE");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(abi,ref iid,out version3));
            var setter=(delegate* unmanaged[Stdcall]<nint,byte,int>)(*(nint**)version3)[7];
            Marshal.ThrowExceptionForHR(setter(version3,0));
        }
        finally { if(version3!=0)Marshal.Release(version3); Marshal.Release(abi); }
    }
    [DllImport("d3d11.dll")] private static extern int CreateDirect3D11DeviceFromDXGIDevice(nint device,out nint result);
    [DllImport("combase.dll",CharSet=CharSet.Unicode)] private static extern int WindowsCreateString(string text,int length,out nint value);
    [DllImport("combase.dll")] private static extern int WindowsDeleteString(nint value);
    [DllImport("combase.dll")] private static extern int RoGetActivationFactory(nint name,ref Guid iid,out nint result);
}

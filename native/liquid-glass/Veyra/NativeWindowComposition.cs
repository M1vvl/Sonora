using System.Runtime.InteropServices;

namespace GlassDock.Rendering;

/// <summary>Window-level DWM transparency is separate from pixels returned by WGC.</summary>
internal readonly record struct NativeWindowComposition(float Opacity,uint ColorKey,bool UsesColorKey,bool CanOcclude)
{
    internal bool Visible=>Opacity>0;
    internal static NativeWindowComposition FromAttributes(int style,bool hasAttributes,uint key,byte alpha,uint flags)
    {
        bool layered=(style&0x80000)!=0;
        return new(layered && hasAttributes && (flags&2)!=0?alpha/255f:1,
            key,layered && hasAttributes && (flags&1)!=0,(style&0x80020)==0);
    }
    internal static NativeWindowComposition Read(nint window)
    {
        int style=GetWindowLong(window,-20);
        bool valid=GetLayeredWindowAttributes(window,out uint key,out byte alpha,out uint flags);
        return FromAttributes(style,valid,key,alpha,flags);
    }
    [DllImport("user32.dll")] private static extern int GetWindowLong(nint window,int index);
    [DllImport("user32.dll")] private static extern bool GetLayeredWindowAttributes(nint window,out uint key,out byte alpha,out uint flags);
}

using System.Runtime.InteropServices;
using System.Text;

namespace GlassDock.Rendering;

/// <summary>
/// Separates session/desktop availability from material appearance. It only observes the
/// input desktop: it never switches desktops, changes ACLs, or captures secure surfaces.
/// </summary>
internal static class SessionSurfaceState
{
    private static readonly WinEventProcedure DesktopChanged=OnDesktopChanged;
    private static readonly string ApplicationDesktop=DesktopName(GetThreadDesktop(GetCurrentThreadId()));
    private static nint _hook;
    private static int _initialized;
    private static long _generation,_nextCheck;
    private static bool _available=true;

    internal static long Generation=>Volatile.Read(ref _generation);

    internal static bool CanCapture
    {
        get
        {
            EnsureMonitoring();
            long now=Environment.TickCount64;
            if(now<Volatile.Read(ref _nextCheck)) return _available;
            Volatile.Write(ref _nextCheck,now+80);
            nint input=OpenInputDesktop(0,false,1 /* DESKTOP_READOBJECTS */);
            if(input==0) return _available=false;
            try
            {
                string name=DesktopName(input);
                return _available=name.Length>0 && string.Equals(name,ApplicationDesktop,StringComparison.OrdinalIgnoreCase);
            }
            finally { CloseDesktop(input); }
        }
    }

    private static void EnsureMonitoring()
    {
        if(Interlocked.Exchange(ref _initialized,1)!=0) return;
        _hook=SetWinEventHook(0x0020,0x0020,0,DesktopChanged,0,0,0); // EVENT_SYSTEM_DESKTOPSWITCH.
        AppDomain.CurrentDomain.ProcessExit+=(_,_)=> { if(_hook!=0) UnhookWinEvent(_hook); };
    }

    private static void OnDesktopChanged(nint hook,uint eventType,nint window,int objectId,int childId,uint eventThread,uint eventTime)
    {
        Interlocked.Increment(ref _generation);
        Volatile.Write(ref _nextCheck,0);
    }

    internal static bool IsTransientCaptureFailure(Exception exception)
    {
        for(Exception? current=exception;current is not null;current=current.InnerException)
        {
            uint code=unchecked((uint)current.HResult);
            if(code is 0x80070005 or 0x887A0026 or 0x887A0028 or 0x887A002B or
                0x887A0005 or 0x887A0006 or 0x887A0007 or 0x887A0020 or 0x887A0022)
                return true;
        }
        return !CanCapture;
    }

    private static string DesktopName(nint desktop)
    {
        if(desktop==0) return "";
        var name=new StringBuilder(256);
        return GetUserObjectInformation(desktop,2 /* UOI_NAME */,name,name.Capacity*2,out _)?name.ToString():"";
    }

    private delegate void WinEventProcedure(nint hook,uint eventType,nint window,int objectId,int childId,uint eventThread,uint eventTime);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern nint GetThreadDesktop(uint threadId);
    [DllImport("user32.dll",SetLastError=true)] private static extern nint OpenInputDesktop(uint flags,[MarshalAs(UnmanagedType.Bool)] bool inherit,uint access);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(nint desktop);
    [DllImport("user32.dll",EntryPoint="GetUserObjectInformationW",CharSet=CharSet.Unicode)] private static extern bool GetUserObjectInformation(nint handle,int index,StringBuilder information,int length,out int required);
    [DllImport("user32.dll")] private static extern nint SetWinEventHook(uint eventMin,uint eventMax,nint module,WinEventProcedure callback,uint processId,uint threadId,uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(nint hook);
}

// Independent Windows output analyser. No microphone, files, or network access.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

namespace AgentPulse.Audio {
  internal static class Program {
    static readonly ManualResetEvent Stop = new ManualResetEvent(false);
    static readonly uint OwnPid = (uint)Process.GetCurrentProcess().Id;
    static readonly Guid ClientId = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    static readonly Guid CaptureId = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    static readonly Guid SessionsId = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    static readonly HashSet<string> Players = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
      "cloudmusic", "qqmusic", "mineradio", "spotify", "kugou", "kuwo", "lx-music-desktop", "musicfree", "yesplaymusic", "qishui", "music"
    };
    static void Check(int result) { if (result < 0) Marshal.ThrowExceptionForHR(result); }
    static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    static string Escape(string text) { return text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }
    static void Emit(string text) { try { Console.WriteLine(text); } catch (System.IO.IOException) { Stop.Set(); } }
    static void State(string state, string error) { Emit("{\"type\":\"status\",\"state\":\""+state+"\",\"scope\":\"default-output\",\"message\":\""+Escape(error??"")+"\"}"); }
    static string SourcesJson(List<string> names) { return "["+string.Join(",", names.ConvertAll(name=>"\""+Escape(name)+"\"").ToArray())+"]"; }
    static List<string> AudioSources(IMMDevice device, bool musicOnly) {
      object managerObject=null; IAudioSessionEnumerator enumeration=null;
      var names=new List<string>();
      try {
        var iid=SessionsId; Check(device.Activate(ref iid,23,IntPtr.Zero,out managerObject));
        Check(((IAudioSessionManager2)managerObject).GetSessionEnumerator(out enumeration));
        int count; Check(enumeration.GetCount(out count));
        for(int i=0;i<count;i++) {
          IAudioSessionControl control=null;
          try {
            Check(enumeration.GetSession(i,out control)); int state; Check(control.GetState(out state));
            if(state!=1) continue;
            uint pid; Check(((IAudioSessionControl2)control).GetProcessId(out pid));
            if(pid==0 || pid==OwnPid) continue;
            using(var process=Process.GetProcessById((int)pid)) {
              var name=process.ProcessName;
              if(name.Equals("AgentPulse.AudioProbe",StringComparison.OrdinalIgnoreCase))continue;
              if((!musicOnly || Players.Contains(name)) && !names.Contains(name)) names.Add(name);
            }
          } catch(ArgumentException) {} catch(COMException) {} catch(InvalidOperationException) {}
          finally { Release(control); }
        }
      } finally { Release(enumeration); Release(managerObject); }
      return names;
    }
    [MTAThread] static int Main(string[] args) {
      CultureInfo.CurrentCulture=CultureInfo.InvariantCulture;
      if(Array.IndexOf(args,"--self-test")>=0) return Spectrum.SelfTest();
      int duration=0; bool musicOnly=Array.IndexOf(args,"--music-only")>=0;
      for(int i=0;i<args.Length-1;i++) if(args[i]=="--probe-duration") int.TryParse(args[i+1],out duration);
      Timer deadline=null;
      if(duration>0) deadline=new Timer(_=>Stop.Set(),null,duration*1000,Timeout.Infinite);
      else { var input=new Thread(()=> { try { while(Console.ReadLine()!=null) {} } catch {} finally { Stop.Set(); } }); input.IsBackground=true; input.Start(); }
      Console.CancelKeyPress+=(sender,e)=>{e.Cancel=true;Stop.Set();};
      while(!Stop.WaitOne(0)) {
        IMMDeviceEnumerator enumerator=null; IMMDevice device=null;
        try {
          enumerator=(IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
          Check(enumerator.GetDefaultAudioEndpoint(0,1,out device));
          var sources=AudioSources(device,musicOnly);
          if(sources.Count==0) { State("idle",musicOnly?"没有活跃的音乐播放器音频会话":"等待播放音频"); Stop.WaitOne(1000); continue; }
          string deviceId; Check(device.GetId(out deviceId));
          using(var capture=new Loopback(device)) {
            State("listening",""); var clock=Stopwatch.StartNew(); long nextFrame=0,nextDevice=2000,lastQuietFrame=-1000; int quietFrames=0;
            while(!Stop.WaitOne(10)) {
              capture.Drain();
              if(clock.ElapsedMilliseconds>=nextFrame) {
                nextFrame=clock.ElapsedMilliseconds+50;
                var levels=capture.Analyse(); bool active=levels[0]>.015||levels[1]>.015||levels[2]>.015;
                quietFrames=active?0:quietFrames+1;
                if(active || quietFrames<10 || clock.ElapsedMilliseconds-lastQuietFrame>=500) {
                  Emit(string.Format(CultureInfo.InvariantCulture,"{{\"type\":\"frame\",\"levels\":[{0:F4},{1:F4},{2:F4}],\"active\":{3},\"scope\":\"default-output\",\"audioSources\":{4}}}",levels[0],levels[1],levels[2],active?"true":"false",SourcesJson(sources)));
                  if(!active)lastQuietFrame=clock.ElapsedMilliseconds;
                }
              }
              if(clock.ElapsedMilliseconds>=nextDevice) {
                nextDevice=clock.ElapsedMilliseconds+2000;
                IMMDevice current=null;
                try { Check(enumerator.GetDefaultAudioEndpoint(0,1,out current)); string id;Check(current.GetId(out id)); if(id!=deviceId)break; }
                finally { Release(current); }
                sources=AudioSources(device,musicOnly); if(sources.Count==0)break;
              }
            }
          }
        } catch(Exception e) { State("unavailable",e.GetType().Name+": "+e.Message); Stop.WaitOne(3000); }
        finally { Release(device); Release(enumerator); }
      }
      if(deadline!=null)deadline.Dispose();return 0;
    }
    sealed class Loopback : IDisposable {
      IAudioClient client; IAudioCaptureClient capture; readonly Spectrum spectrum;
      readonly int channels,bits,blockAlign; readonly bool ieeeFloat; byte[] bytes=new byte[65536];
      readonly Stopwatch clock=Stopwatch.StartNew(); long lastSample=-1000;
      public Loopback(IMMDevice device) {
        IntPtr format=IntPtr.Zero;
        try {
          object value; var id=ClientId; Check(device.Activate(ref id,23,IntPtr.Zero,out value));client=(IAudioClient)value;
          Check(client.GetMixFormat(out format));
          int tag=(ushort)Marshal.ReadInt16(format,0);channels=(ushort)Marshal.ReadInt16(format,2);int rate=Marshal.ReadInt32(format,4);
          blockAlign=(ushort)Marshal.ReadInt16(format,12);bits=(ushort)Marshal.ReadInt16(format,14);
          if(tag==0xfffe) tag=Marshal.ReadInt32(format,24);
          ieeeFloat=tag==3;
          if(channels<1||channels>32||rate<8000||rate>384000||blockAlign<channels*(bits/8)||(!ieeeFloat&&tag!=1)||!(bits==16||bits==24||bits==32)||(ieeeFloat&&bits!=32))throw new NotSupportedException("Unsupported output mix format");
          spectrum=new Spectrum(rate);
          Check(client.Initialize(0,0x20000,1000000,0,format,IntPtr.Zero));
          id=CaptureId;Check(client.GetService(ref id,out value));capture=(IAudioCaptureClient)value;
          Check(client.Start());
        } catch { Dispose();throw; } finally { if(format!=IntPtr.Zero)Marshal.FreeCoTaskMem(format); }
      }
      public void Drain() {
        uint frames;Check(capture.GetNextPacketSize(out frames));int packets=0;
        while(frames>0 && packets++<100) {
          IntPtr data;uint flags;ulong position,time;Check(capture.GetBuffer(out data,out frames,out flags,out position,out time));
          try {
            int length=checked((int)frames*blockAlign);if(length>4*1024*1024)throw new InvalidOperationException("Oversized audio packet");
            bool silent=(flags&2)!=0;
            if(!silent) { if(bytes.Length<length)bytes=new byte[length];Marshal.Copy(data,bytes,0,length); }
            for(int frame=0;frame<(int)frames;frame++) {
              // Use the channel with greatest magnitude to avoid anti-phase cancellation.
              double sample=0;
              if(!silent)for(int ch=0;ch<channels;ch++) {
                int offset=frame*blockAlign+ch*(bits/8);double x;
                if(ieeeFloat)x=BitConverter.ToSingle(bytes,offset);
                else if(bits==16)x=(short)(bytes[offset]|bytes[offset+1]<<8)/32768.0;
                else if(bits==24)x=((bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16)<<8)/2147483648.0;
                else x=BitConverter.ToInt32(bytes,offset)/2147483648.0;
                if(!double.IsNaN(x)&&!double.IsInfinity(x)&&Math.Abs(x)>Math.Abs(sample))sample=x;
              }
              spectrum.Push(Math.Max(-1,Math.Min(1,sample)));
            }
            lastSample=clock.ElapsedMilliseconds;
          } finally { Check(capture.ReleaseBuffer(frames)); }
          Check(capture.GetNextPacketSize(out frames));
        }
      }
      public double[] Analyse() { return spectrum.Analyse(clock.ElapsedMilliseconds-lastSample>180); }
      public void Dispose() { if(client!=null) { try { client.Stop(); }catch {} } Release(capture);Release(client);capture=null;client=null; }
    }
  }
  internal sealed class Spectrum {
    const int N=2048; readonly double[] ring=new double[N],real=new double[N],imag=new double[N],window=new double[N],levels=new double[3];
    readonly int rate;int cursor; double rms;
    public Spectrum(int sampleRate) { rate=sampleRate;for(int i=0;i<N;i++)window[i]=.5-.5*Math.Cos(2*Math.PI*i/(N-1)); }
    public void Push(double sample) { ring[cursor]=sample;cursor=(cursor+1)%N; }
    public double[] Analyse(bool stale) {
      if(stale) { for(int i=0;i<3;i++) { levels[i]*=.76;if(levels[i]<.002)levels[i]=0; }return levels; }
      double sum=0;
      for(int i=0;i<N;i++){double x=stale?0:ring[(cursor+i)%N];sum+=x*x;real[i]=x*window[i];imag[i]=0;}
      rms=Math.Sqrt(sum/N);
      for(int i=1,j=0;i<N;i++){int bit=N>>1;for(;(j&bit)!=0;bit>>=1)j^=bit;j^=bit;if(i<j){double a=real[i];real[i]=real[j];real[j]=a;}}
      for(int size=2;size<=N;size<<=1){double angle=-2*Math.PI/size,wr=Math.Cos(angle),wi=Math.Sin(angle);for(int start=0;start<N;start+=size){double ur=1,ui=0;for(int j=0;j<size/2;j++){int a=start+j,b=a+size/2;double tr=ur*real[b]-ui*imag[b],ti=ur*imag[b]+ui*real[b];real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;double next=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=next;}}}
      double[] edges={45,250,2000,10000};
      for(int band=0;band<3;band++) {
        double energy=0;int first=Math.Max(1,(int)Math.Ceiling(edges[band]*N/rate)),last=Math.Min(N/2-1,(int)Math.Floor(edges[band+1]*N/rate));
        for(int i=first;i<=last;i++)energy+=real[i]*real[i]+imag[i]*imag[i];
        double amplitude=Math.Sqrt(energy)*4/N;
        double db=20*Math.Log10(Math.Max(amplitude,1e-8));
        double target=rms<.0001?0:Math.Max(0,Math.Min(1,(db+64)/58));
        // Fast attack / slower release makes energy changes legible without fake motion.
        levels[band]+=(target-levels[band])*(target>levels[band]?.85:.24);
        if(levels[band]<.002)levels[band]=0;
      }
      return levels;
    }
    public static int SelfTest() {
      int[] hz={100,800,5000};
      for(int b=0;b<3;b++){var s=new Spectrum(48000);for(int i=0;i<N;i++)s.Push(.2*Math.Sin(2*Math.PI*hz[b]*i/48000));var v=s.Analyse(false);if(!(v[b]>.4&&v[b]>v[(b+1)%3]+.2&&v[b]>v[(b+2)%3]+.2))return 1;for(int n=0;n<40;n++)s.Analyse(true);if(s.levels[0]+s.levels[1]+s.levels[2]>.01)return 2;}
      Console.WriteLine("{\"selfTest\":true,\"checks\":[\"three-frequency-bands\",\"silence-release\"]}");return 0;
    }
  }
  [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator {
    [PreserveSig]int EnumAudioEndpoints(int flow,uint mask,out object devices);
    [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice device);
    [PreserveSig]int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IMMDevice device);
    [PreserveSig]int RegisterEndpointNotificationCallback(IntPtr callback);[PreserveSig]int UnregisterEndpointNotificationCallback(IntPtr callback);
  }
  [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
    [PreserveSig]int Activate(ref Guid iid,uint context,IntPtr activation,[MarshalAs(UnmanagedType.IUnknown)]out object value);
    [PreserveSig]int OpenPropertyStore(int access,out object store);[PreserveSig]int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);[PreserveSig]int GetState(out uint state);
  }
  [ComImport,Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioClient {
    [PreserveSig]int Initialize(int mode,uint flags,long duration,long periodicity,IntPtr format,IntPtr session);
    [PreserveSig]int GetBufferSize(out uint frames);[PreserveSig]int GetStreamLatency(out long latency);[PreserveSig]int GetCurrentPadding(out uint frames);
    [PreserveSig]int IsFormatSupported(int mode,IntPtr format,out IntPtr closest);[PreserveSig]int GetMixFormat(out IntPtr format);[PreserveSig]int GetDevicePeriod(out long normal,out long minimum);
    [PreserveSig]int Start();[PreserveSig]int Stop();[PreserveSig]int Reset();[PreserveSig]int SetEventHandle(IntPtr handle);[PreserveSig]int GetService(ref Guid iid,[MarshalAs(UnmanagedType.IUnknown)]out object service);
  }
  [ComImport,Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioCaptureClient {
    [PreserveSig]int GetBuffer(out IntPtr data,out uint frames,out uint flags,out ulong position,out ulong time);
    [PreserveSig]int ReleaseBuffer(uint frames);[PreserveSig]int GetNextPacketSize(out uint frames);
  }
  [ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionManager2 {
    [PreserveSig]int GetAudioSessionControl(IntPtr session,uint flags,out object control);[PreserveSig]int GetSimpleAudioVolume(IntPtr session,uint flags,out object volume);
    [PreserveSig]int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
  }
  [ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionEnumerator {
    [PreserveSig]int GetCount(out int count);[PreserveSig]int GetSession(int index,out IAudioSessionControl session);
  }
  [ComImport,Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionControl {
    [PreserveSig]int GetState(out int state);[PreserveSig]int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)]out string name);[PreserveSig]int SetDisplayName(string name,IntPtr context);
    [PreserveSig]int GetIconPath(out string path);[PreserveSig]int SetIconPath(string path,IntPtr context);[PreserveSig]int GetGroupingParam(out Guid grouping);[PreserveSig]int SetGroupingParam(ref Guid grouping,IntPtr context);
    [PreserveSig]int RegisterAudioSessionNotification(IntPtr notify);[PreserveSig]int UnregisterAudioSessionNotification(IntPtr notify);
  }
  [ComImport,Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionControl2 {
    [PreserveSig]int GetState(out int state);[PreserveSig]int GetDisplayName(out string name);[PreserveSig]int SetDisplayName(string name,IntPtr context);
    [PreserveSig]int GetIconPath(out string path);[PreserveSig]int SetIconPath(string path,IntPtr context);[PreserveSig]int GetGroupingParam(out Guid grouping);[PreserveSig]int SetGroupingParam(ref Guid grouping,IntPtr context);
    [PreserveSig]int RegisterAudioSessionNotification(IntPtr notify);[PreserveSig]int UnregisterAudioSessionNotification(IntPtr notify);
    [PreserveSig]int GetSessionIdentifier(out string id);[PreserveSig]int GetSessionInstanceIdentifier(out string id);[PreserveSig]int GetProcessId(out uint pid);
    [PreserveSig]int IsSystemSoundsSession();[PreserveSig]int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)]bool optout);
  }
}

// UI Automation progress-text approach adapted from Widdit/now-playing-service
// Helpers/NeteaseMusicHelper.cs, MIT, Copyright (c) 2024 Widdit.
// See assets/licenses/NowPlaying-MIT.txt and THIRD_PARTY_NOTICES.md.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

namespace AgentPulse.Media {
  internal sealed class TimelineObservation {
    internal double Position, Duration;
    double changedAt = -1;
    internal void Accept(double position, double duration, bool playing, double stamp) {
      if(double.IsNaN(position)||double.IsNaN(duration)||duration<=0||duration>86400||position<0||position>duration)return;
      if(changedAt<0||Position!=position||Duration!=duration||!playing)changedAt=stamp;
      Position=position;Duration=duration;
    }
    internal bool IsFresh(double stamp) { return changedAt>=0&&stamp-changedAt<=1800; }
  }

  internal static class CloudMusicTimeline {
    const int PollMilliseconds=300, ScanRetryMilliseconds=3000, MaxNodes=256;
    static readonly object Gate=new object();
    static readonly AutoResetEvent Wake=new AutoResetEvent(false);
    static readonly Stopwatch Clock=Stopwatch.StartNew();
    static readonly Regex Progress=new Regex(@"^\s*([0-9]{1,3}):([0-9]{2})\s*[/|]\s*([0-9]{1,3}):([0-9]{2})\s*$",RegexOptions.CultureInvariant);
    static readonly Regex Separators=new Regex(@"[\s\p{P}\p{S}]",RegexOptions.CultureInvariant);
    sealed class Request { internal string Source,Key,Title,Artist; internal bool Playing; }
    sealed class ScanNode { internal AutomationElement Element; internal int Parent; }
    sealed class ClockNode { internal AutomationElement Element; internal string Text; internal int Parent; }
    sealed class Binding {
      internal AutomationElement Combined,Elapsed,Total,Title,Artist;
      internal IntPtr Window;
      internal bool Read(Request request,out double position,out double duration) {
        position=duration=0;
        if(!Matches(Window,request)&&!(TextMatches(Title,request.Title)&&TextMatches(Artist,request.Artist)))return false;
        return Combined!=null?TryParse(Combined.Current.Name,out position,out duration):TryParsePair(Elapsed.Current.Name,Total.Current.Name,out position,out duration);
      }
    }
    static Request requested;
    static TimelineObservation observed=new TimelineObservation();
    static Thread worker;
    static bool stopping;
    delegate bool WindowVisitor(IntPtr window,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor visitor,IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int count);

    internal static bool TryParse(string value,out double position,out double duration) {
      position=duration=0;
      if(value==null||value.Length>80)return false;
      var match=Progress.Match(value);
      if(!match.Success)return false;
      int minute=int.Parse(match.Groups[1].Value),second=int.Parse(match.Groups[2].Value);
      int totalMinute=int.Parse(match.Groups[3].Value),totalSecond=int.Parse(match.Groups[4].Value);
      if(second>=60||totalSecond>=60)return false;
      position=minute*60+second;duration=totalMinute*60+totalSecond;
      return duration>0&&duration<=86400&&position<=duration;
    }
    internal static bool TryParsePair(string elapsed,string total,out double position,out double duration) {
      position=duration=0;
      if(!TryClock(elapsed,out position)||!TryClock(total,out duration))return false;
      return duration>0&&duration<=86400&&position<=duration;
    }
    static bool TryClock(string value,out double seconds) {
      seconds=0;
      if(value==null||value.Length>12)return false;
      var match=Regex.Match(value,@"^\s*([0-9]{1,3}):([0-9]{2})\s*$",RegexOptions.CultureInvariant);
      if(!match.Success)return false;
      int second=int.Parse(match.Groups[2].Value);
      if(second>=60)return false;
      seconds=int.Parse(match.Groups[1].Value)*60+second;return true;
    }
    internal static void SetTrack(string key,string title,string artist,bool playing) {
      SetTrack("cloudmusic",key,title,artist,playing);
    }
    internal static bool Supports(string source) {
      return source=="cloudmusic"||source=="qqmusic"||source=="applemusic"||source=="spotify"||source=="kugou"||source=="kuwo"||source=="yesplaymusic"||source=="qishui";
    }
    internal static void SetTrack(string source,string key,string title,string artist,bool playing) {
      lock(Gate) {
        if(stopping)return;
        bool changed=requested==null||requested.Key!=key;
        requested=new Request{Source=source,Key=key,Title=title,Artist=artist,Playing=playing};
        if(changed)observed=new TimelineObservation();
        if(worker==null) {
          worker=new Thread(Work){IsBackground=true,Name="Sonara.PlayerTimeline"};
          worker.SetApartmentState(ApartmentState.STA);worker.Start();
        }
        if(changed)Wake.Set();
      }
    }
    internal static bool TryGet(string key,out double position,out double duration) {
      lock(Gate) {
        position=duration=0;
        if(requested==null||requested.Key!=key||!observed.IsFresh(Clock.Elapsed.TotalMilliseconds))return false;
        position=observed.Position;duration=observed.Duration;return true;
      }
    }
    internal static void Clear() { lock(Gate){requested=null;observed=new TimelineObservation();}Wake.Set(); }
    internal static void Stop() { lock(Gate){stopping=true;requested=null;observed=new TimelineObservation();}Wake.Set(); }
    static string Normalize(string value) { return Separators.Replace(value??"","").ToUpperInvariant(); }
    static bool TextMatches(AutomationElement element,string expected) {
      if(element==null)return string.IsNullOrWhiteSpace(expected);
      return Normalize(element.Current.Name)==Normalize(expected);
    }
    static bool Matches(IntPtr window,Request request) {
      var text=new StringBuilder(640);GetWindowText(window,text,text.Capacity);
      string title=Normalize(text.ToString()),expected=Normalize(request.Title),artist=Normalize(request.Artist);
      return expected.Length>0&&title.Contains(expected)&&(artist.Length==0||title.Contains(artist));
    }
    static List<IntPtr> Windows(Request request) {
      var processes=Process.GetProcessesByName(PlayerSources.ProcessName(request.Source));
      var ids=new HashSet<int>();
      foreach(var process in processes){try{ids.Add(process.Id);}finally{process.Dispose();}}
      var windows=new List<IntPtr>();
      EnumWindows((window,parameter)=> {
        uint id;GetWindowThreadProcessId(window,out id);
        if(ids.Contains((int)id))windows.Add(window);
        return windows.Count<8;
      },IntPtr.Zero);
      return windows;
    }
    static Binding FindProgress(IntPtr window,Request request,ref int remaining,Stopwatch budget,out double position,out double duration) {
      position=duration=0;
      var root=AutomationElement.FromHandle(window);
      if(root==null)return null;
      var queue=new Queue<ScanNode>();queue.Enqueue(new ScanNode{Element=root,Parent=-1});
      var clocks=new List<ClockNode>();AutomationElement combined=null,title=null,artist=null;int index=0;
      while(queue.Count>0&&remaining>0&&budget.ElapsedMilliseconds<400) {
        remaining--;
        var node=queue.Dequeue();var element=node.Element;int current=index++;
        string name=element.Current.Name;
        if(Normalize(name)==Normalize(request.Title))title=element;
        if(Normalize(name)==Normalize(request.Artist))artist=element;
        var type=element.Current.ControlType;
        if(type==ControlType.Text||type==ControlType.Slider) {
          if(TryParse(name,out position,out duration))combined=element;
          double seconds;
          if(clocks.Count<12&&TryClock(name,out seconds))clocks.Add(new ClockNode{Element=element,Text=name,Parent=node.Parent});
        }
        var child=TreeWalker.RawViewWalker.GetFirstChild(element);
        while(child!=null&&queue.Count<remaining&&budget.ElapsedMilliseconds<400) {
          queue.Enqueue(new ScanNode{Element=child,Parent=current});child=TreeWalker.RawViewWalker.GetNextSibling(child);
        }
      }
      // Generic application titles are accepted only when accessibility exposes
      // the exact song and artist in this same process-owned window.
      if(!Matches(window,request)&&!(TextMatches(title,request.Title)&&TextMatches(artist,request.Artist)))return null;
      if(combined!=null&&TryParse(combined.Current.Name,out position,out duration))return new Binding{Window=window,Combined=combined,Title=title,Artist=artist};
      for(int i=0;i<clocks.Count-1;i++) {
        var first=clocks[i];var second=clocks[i+1];
        if(first.Parent!=second.Parent)continue;
        if(TryParsePair(first.Text,second.Text,out position,out duration))return new Binding{Window=window,Elapsed=first.Element,Total=second.Element,Title=title,Artist=artist};
      }
      return null;
    }
    static void Work() {
      Binding cached=null;
      string track="";double nextScan=0;
      try {
        while(true) {
          Request request;
          lock(Gate){if(stopping)return;request=requested;}
          if(request==null){cached=null;track="";Wake.WaitOne();continue;}
          if(track!=request.Key){cached=null;track=request.Key;nextScan=0;}
          double position=0,duration=0;bool valid=false;
          try {
            if(cached!=null)valid=cached.Read(request,out position,out duration);
            if(!valid)cached=null;
            if(cached==null&&Clock.Elapsed.TotalMilliseconds>=nextScan) {
              nextScan=Clock.Elapsed.TotalMilliseconds+ScanRetryMilliseconds;
              var budget=Stopwatch.StartNew();int remaining=MaxNodes;
              foreach(var candidate in Windows(request)) {
                if(remaining<=0||budget.ElapsedMilliseconds>=400)break;
                cached=FindProgress(candidate,request,ref remaining,budget,out position,out duration);
                if(cached!=null){valid=true;break;}
              }
            }
          }catch{cached=null;}
          if(valid)lock(Gate) {
            // A slow accessibility provider cannot attach an older song's
            // sample to a newer request. Repeated stale playing values expire.
            if(requested!=null&&requested.Key==request.Key)observed.Accept(position,duration,requested.Playing,Clock.Elapsed.TotalMilliseconds);
          }
          Wake.WaitOne(PollMilliseconds);
        }
      }finally{cached=null;}
    }
  }
}

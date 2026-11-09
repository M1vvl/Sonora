// GSMTC observer with a fixed, track-bound transport command protocol.
// No account, credential, media-file or arbitrary process access is exposed.
using System;
using System.Globalization;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace AgentPulse.Media {
  internal static class Program {
    static readonly ManualResetEvent Stop = new ManualResetEvent(false);
    static readonly AutoResetEvent Changed = new AutoResetEvent(false);
    static string previous = null, previousTrack = null, cachedCover = null;
    static DateTime thumbnailAt = DateTime.MinValue;
    static volatile bool refreshThumbnail = true;
    static readonly object CommandLock = new object();
    static readonly Queue<TransportCommand> Commands = new Queue<TransportCommand>();
    sealed class TransportCommand {
      internal string RequestId, Action, Source, TrackKey;
      internal double Position;
      internal DateTime ExpiresAt;
    }
    static void ReadCommand(string line) {
      if(line==null||line.Length>512)return;
      var fields=line.Split('\t');
      if(fields.Length!=6||fields[0]!="control")return;
      long id;double position;
      if(!long.TryParse(fields[1],out id)||id<1||id>9007199254740991)return;
      if(fields[2]!="toggle"&&fields[2]!="next"&&fields[2]!="previous"&&fields[2]!="seek")return;
      if(fields[3].Length>32||Player(fields[3])!=fields[3])return;
      if(fields[4].Length!=64||fields[4].Any(c=>!(c>='0'&&c<='9'||c>='a'&&c<='f')))return;
      if(!double.TryParse(fields[5],NumberStyles.Float,CultureInfo.InvariantCulture,out position)||double.IsNaN(position)||double.IsInfinity(position)||position<0||position>86400)return;
      lock(CommandLock) {
        if(Commands.Count>=8)return;
        Commands.Enqueue(new TransportCommand{RequestId=fields[1],Action=fields[2],Source=fields[3],TrackKey=fields[4],Position=position,ExpiresAt=DateTime.UtcNow.AddSeconds(4)});
      }
      Changed.Set();
    }
    static string Limit(string value,int maximum) { return (value??"").Length>maximum?value.Substring(0,maximum):(value??""); }
    static string Json(string value) {
      var text=new StringBuilder("\"");
      foreach(char c in value??"") { if(c=='\\'||c=='\"')text.Append('\\').Append(c);else if(c<32)text.Append("\\u").Append(((int)c).ToString("x4"));else text.Append(c); }
      return text.Append('"').ToString();
    }
    static string Digest(string text) { using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant(); }
    static string TrackKey(GlobalSystemMediaTransportControlsSession session,GlobalSystemMediaTransportControlsSessionMediaProperties properties) {
      return Digest(session.SourceAppUserModelId+"\n"+Limit(properties.Title,300)+"\n"+Limit(properties.Artist,300)+"\n"+properties.AlbumTitle+"\n"+properties.TrackNumber);
    }
    static void CommandResult(string requestId,bool ok) {
      try{Console.WriteLine("{\"type\":\"command\",\"requestId\":"+requestId+",\"ok\":"+(ok?"true":"false")+"}");}catch(IOException){Stop.Set();}
    }
    static void ApplyCommands(GlobalSystemMediaTransportControlsSessionManager manager) {
      while(!Stop.WaitOne(0)) {
        TransportCommand command;
        lock(CommandLock){if(Commands.Count==0)return;command=Commands.Dequeue();}
        bool ok=false;
        try {
          if(DateTime.UtcNow>=command.ExpiresAt){CommandResult(command.RequestId,false);continue;}
          var session=Select(manager);
          if(session!=null&&Player(session.SourceAppUserModelId)==command.Source) {
            var properties=Wait(session.TryGetMediaPropertiesAsync());
            if(DateTime.UtcNow<command.ExpiresAt&&TrackKey(session,properties)==command.TrackKey) {
              var controls=session.GetPlaybackInfo().Controls;
              if(command.Action=="toggle"&&controls.IsPlayPauseToggleEnabled)ok=Wait(session.TryTogglePlayPauseAsync());
              else if(command.Action=="next"&&controls.IsNextEnabled)ok=Wait(session.TrySkipNextAsync());
              else if(command.Action=="previous"&&controls.IsPreviousEnabled)ok=Wait(session.TrySkipPreviousAsync());
              else if(command.Action=="seek"&&controls.IsPlaybackPositionEnabled) {
                var timeline=session.GetTimelineProperties();
                double duration=Math.Max(0,(timeline.EndTime-timeline.StartTime).TotalSeconds);
                long ticks=timeline.StartTime.Ticks+(long)(Math.Min(duration,command.Position)*TimeSpan.TicksPerSecond);
                ok=Wait(session.TryChangePlaybackPositionAsync(ticks));
              }
            }
          }
        } catch { ok=false; }
        CommandResult(command.RequestId,ok);
      }
    }
    static void Emit(string value) { if(value==previous)return;previous=value;try{Console.WriteLine(value);}catch(IOException){Stop.Set();} }
    static T Wait<T>(IAsyncOperation<T> operation) {
      try {
        var deadline=DateTime.UtcNow.AddSeconds(5);
        while(operation.Status==AsyncStatus.Started && !Stop.WaitOne(20) && DateTime.UtcNow<deadline) {}
        if(operation.Status==AsyncStatus.Started){operation.Cancel();throw new TimeoutException("Media operation timed out");}
        return operation.GetResults();
      } finally { operation.Close(); }
    }
    static string Player(string appId) { return PlayerSources.FromAppId(appId); }
    static bool Running(string name) { var all=Process.GetProcessesByName(name);try{return all.Length>0;}finally{foreach(var p in all)p.Dispose();} }
    static GlobalSystemMediaTransportControlsSession Select(GlobalSystemMediaTransportControlsSessionManager manager) {
      var current=manager.GetCurrentSession();
      GlobalSystemMediaTransportControlsSession selected=null;int rank=-1;
      foreach(var session in manager.GetSessions()) {
        try {
          var player=Player(session.SourceAppUserModelId);if(player==null)continue;
          if(!Running(PlayerSources.ProcessName(player)))continue;
          var status=session.GetPlaybackInfo().PlaybackStatus;
          int candidate=(status==GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing?10:0)+(current!=null&&session.SourceAppUserModelId==current.SourceAppUserModelId?2:0);
          if(candidate>rank){rank=candidate;selected=session;}
        }catch(System.Runtime.InteropServices.COMException){}
      }
      return selected;
    }
    static string Thumbnail(GlobalSystemMediaTransportControlsSessionMediaProperties properties) {
      if(properties.Thumbnail==null)return null;
      using(var stream=Wait(properties.Thumbnail.OpenReadAsync())) {
        if(stream.Size==0||stream.Size>4*1024*1024)return null;
        using(var input=stream.GetInputStreamAt(0))using(var reader=new DataReader(input)) {
          uint length=(uint)stream.Size,loaded=Wait(reader.LoadAsync(length));if(loaded!=length)return null;
          var bytes=new byte[length];reader.ReadBytes(bytes);
          using(var memory=new MemoryStream(bytes))using(var image=Image.FromStream(memory,false,true)) {
            if(image.Width<1||image.Height<1||image.Width>8192||image.Height>8192)return null;
            using(var output=new Bitmap(96,96))using(var graphics=Graphics.FromImage(output))using(var png=new MemoryStream()) {
              graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;
              float scale=Math.Max(96f/image.Width,96f/image.Height),w=image.Width*scale,h=image.Height*scale;
              graphics.DrawImage(image,(96-w)/2,(96-h)/2,w,h);
              output.Save(png,ImageFormat.Png);
              return "data:image/png;base64,"+Convert.ToBase64String(png.ToArray());
            }
          }
        }
      }
    }
    static void Snapshot(GlobalSystemMediaTransportControlsSessionManager manager) {
      var session=Select(manager);
      if(session==null){CloudMusicTimeline.Clear();previousTrack=null;cachedCover=null;Emit("{\"type\":\"media\",\"available\":false,\"reason\":\"no-supported-session\"}");return;}
      var properties=Wait(session.TryGetMediaPropertiesAsync());
      string source=Player(session.SourceAppUserModelId),title=Limit(properties.Title,300),artist=Limit(properties.Artist,300);
      string key=TrackKey(session,properties);
      if(key!=previousTrack){cachedCover=null;refreshThumbnail=true;}
      if(refreshThumbnail||cachedCover==null||DateTime.UtcNow-thumbnailAt>TimeSpan.FromSeconds(30)) {
        refreshThumbnail=false;thumbnailAt=DateTime.UtcNow;
        try{cachedCover=Thumbnail(properties);}catch{cachedCover=null;}
        // Media can change while its asynchronous thumbnail is loading.
        var latest=Wait(session.TryGetMediaPropertiesAsync());
        if(latest.Title!=properties.Title||latest.Artist!=properties.Artist){refreshThumbnail=true;Changed.Set();return;}
      }
      previousTrack=key;
      var playback=session.GetPlaybackInfo();
      bool playing=playback.PlaybackStatus==GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
      var controls=playback.Controls;
      var timeline=session.GetTimelineProperties();
      double duration=Math.Max(0,(timeline.EndTime-timeline.StartTime).TotalSeconds);
      double position=Math.Max(0,(timeline.Position-timeline.StartTime).TotalSeconds);
      bool timelineKnown=duration>0||position>0;
      // Some providers publish artwork and buttons without a timeline. A
      // missing timeline must not become an elapsed-since-detection clock.
      if(timelineKnown&&playing&&timeline.LastUpdatedTime.Year>=2000)position+=Math.Max(0,(DateTimeOffset.Now-timeline.LastUpdatedTime).TotalSeconds);
      position=Math.Min(duration>0?duration:86400,position);
      string timelineSource=timelineKnown?"smtc":"none";
      if(CloudMusicTimeline.Supports(source)&&!timelineKnown) {
        CloudMusicTimeline.SetTrack(source,key,title,artist,playing);
        if(CloudMusicTimeline.TryGet(key,out position,out duration)){timelineKnown=true;timelineSource="uia";}
      } else CloudMusicTimeline.Clear();
      bool canControl=controls.IsPlayPauseToggleEnabled||controls.IsNextEnabled||controls.IsPreviousEnabled||controls.IsPlaybackPositionEnabled;
      Emit("{\"type\":\"media\",\"available\":true,\"source\":"+Json(source)+",\"title\":"+Json(title)+",\"artist\":"+Json(artist)+",\"trackKey\":"+Json(key)+",\"playing\":"+(playing?"true":"false")+",\"cover\":"+Json(cachedCover)+",\"position\":"+position.ToString("F3",CultureInfo.InvariantCulture)+",\"duration\":"+duration.ToString("F3",CultureInfo.InvariantCulture)+",\"timelineKnown\":"+(timelineKnown?"true":"false")+",\"timelineSource\":"+Json(timelineSource)+",\"canControl\":"+(canControl?"true":"false")+",\"canToggle\":"+(controls.IsPlayPauseToggleEnabled?"true":"false")+",\"canSeek\":"+(controls.IsPlaybackPositionEnabled?"true":"false")+",\"canPrevious\":"+(controls.IsPreviousEnabled?"true":"false")+",\"canNext\":"+(controls.IsNextEnabled?"true":"false")+"}");
    }
    [MTAThread] static int Main(string[] args) {
      int seconds=0;for(int i=0;i<args.Length-1;i++)if(args[i]=="--probe-duration")int.TryParse(args[i+1],out seconds);
      Timer deadline=seconds>0?new Timer(_=>{Stop.Set();Changed.Set();},null,seconds*1000,Timeout.Infinite):null;
      if(seconds==0){var input=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null)ReadCommand(line);}catch{}finally{Stop.Set();Changed.Set();}});input.IsBackground=true;input.Start();}
      while(!Stop.WaitOne(0)) {
        GlobalSystemMediaTransportControlsSessionManager manager=null;
        var observed=new List<GlobalSystemMediaTransportControlsSession>();
        TypedEventHandler<GlobalSystemMediaTransportControlsSession,MediaPropertiesChangedEventArgs> mediaChanged=(s,e)=>{refreshThumbnail=true;Changed.Set();};
        TypedEventHandler<GlobalSystemMediaTransportControlsSession,PlaybackInfoChangedEventArgs> playbackChanged=(s,e)=>Changed.Set();
        TypedEventHandler<GlobalSystemMediaTransportControlsSessionManager,SessionsChangedEventArgs> sessionsChanged=(s,e)=>Changed.Set();
        try {
          manager=Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
          manager.SessionsChanged+=sessionsChanged;
          while(!Stop.WaitOne(0)) {
            foreach(var old in observed){try{old.MediaPropertiesChanged-=mediaChanged;old.PlaybackInfoChanged-=playbackChanged;}catch{}}observed.Clear();
            foreach(var s in manager.GetSessions())if(Player(s.SourceAppUserModelId)!=null){s.MediaPropertiesChanged+=mediaChanged;s.PlaybackInfoChanged+=playbackChanged;observed.Add(s);}
            ApplyCommands(manager);Snapshot(manager);
            // Bounded fallback catches missing player events and closed processes.
            Changed.WaitOne(1000);
          }
        } catch(Exception error) { CloudMusicTimeline.Clear();Emit("{\"type\":\"media\",\"available\":false,\"reason\":\"media-unavailable\",\"message\":"+Json(Limit(error.Message,200))+"}");Stop.WaitOne(3000); }
        finally {
          foreach(var old in observed){try{old.MediaPropertiesChanged-=mediaChanged;old.PlaybackInfoChanged-=playbackChanged;}catch{}}
          if(manager!=null)try{manager.SessionsChanged-=sessionsChanged;}catch{}
        }
      }
      CloudMusicTimeline.Stop();if(deadline!=null)deadline.Dispose();return 0;
    }
  }
}

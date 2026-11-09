using System;

namespace AgentPulse.Media {
  internal static class PlayerSources {
    internal static string FromAppId(string appId) {
      var id=(appId??"").ToLowerInvariant();
      if(id.Contains("cloudmusic")||id.Contains("netease"))return "cloudmusic";
      if(id.Contains("qqmusic"))return "qqmusic";
      if(id.Contains("applemusic"))return "applemusic";
      if(id.Contains("mineradio"))return "mineradio";
      if(id.Contains("spotify"))return "spotify";
      if(id.Contains("kugou"))return "kugou";
      if(id.Contains("kuwo"))return "kuwo";
      if(id.Contains("yesplaymusic"))return "yesplaymusic";
      if(id.Contains("qishui"))return "qishui";
      return null;
    }

    internal static string ProcessName(string source) {
      return source=="applemusic"?"AppleMusic":source;
    }
  }
}

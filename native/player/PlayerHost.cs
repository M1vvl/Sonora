// Windows-only libmpv host. A child HWND owns video; JSON commands own its lifetime.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AgentPulse.Player {
  internal static class Program {
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=262144, RecursionLimit=24 };
    static readonly object OutputLock=new object();
    static Native Mpv; static Surface Host; static ApplicationContext Context; static System.Windows.Forms.Timer Poll,Click;
    static bool Closing=false,Diagnostic=false,PointerKnown=false,LastInsideApp=false,LastInsideVideo=false; static string ShaderDirectory="";
    static IntPtr Parent=IntPtr.Zero; static Point LastPointer;
    [StructLayout(LayoutKind.Sequential)] struct NativePoint {public int X,Y;}
    [StructLayout(LayoutKind.Sequential)] struct NativeRect {public int Left,Top,Right,Bottom;}
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window,ref NativePoint point);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out NativeRect rect);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(NativePoint point);
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr handle,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr handle,int value);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle,uint message,IntPtr wParam,IntPtr lParam);
    static void Emit(object value){try{lock(OutputLock){Console.WriteLine(Json.Serialize(value));Console.Out.Flush();}}catch{Close();}}
    static string Text(object value){return Convert.ToString(value,CultureInfo.InvariantCulture)??"";}
    static double Number(object value,double fallback){double result;return double.TryParse(Text(value),NumberStyles.Float,CultureInfo.InvariantCulture,out result)&&!double.IsNaN(result)&&!double.IsInfinity(result)?result:fallback;}
    static object Value(Dictionary<string,object> data,string key,object fallback){object result;return data.TryGetValue(key,out result)?result:fallback;}
    static string Limit(string value,int max){return value.Length>max?value.Substring(0,max):value;}
    static void Close(){if(Closing)return;Closing=true;try{if(Poll!=null)Poll.Stop();if(Click!=null)Click.Stop();if(Mpv!=null){Mpv.Dispose();Mpv=null;}if(Host!=null)Host.Dispose();}finally{if(Context!=null)Context.ExitThread();}}
    static void Interact(string action){if(action=="togglePause"){if(Click==null){Click=new System.Windows.Forms.Timer { Interval=260 };Click.Tick+=(s,e)=>{Click.Stop();Emit(new {type="interaction",action="togglePause"});};}Click.Stop();Click.Start();}else{if(Click!=null)Click.Stop();Emit(new {type="interaction",action=action});}}
    static bool HttpUrl(string value){Uri uri;return Uri.TryCreate(value,UriKind.Absolute,out uri)&&(uri.Scheme=="http"||uri.Scheme=="https")&&uri.UserInfo.Length==0;}
    static void CheckShaders(string text){if(text.Length>32768)throw new Exception("Shader list is too large");foreach(string name in text.Split(new[]{';'},StringSplitOptions.RemoveEmptyEntries)){string file=Path.GetFullPath(name);if(!file.StartsWith(ShaderDirectory+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||Path.GetExtension(file)!=".glsl"||!File.Exists(file))throw new Exception("Shader path is outside the configured directory");}}
    static void Set(string property,object value){
      switch(property){
        case "pause":case "mute":Mpv.Set(property,Convert.ToBoolean(value)?"yes":"no");break;
        case "speed":Mpv.Set(property,Math.Max(.25,Math.Min(3,Number(value,1))).ToString(CultureInfo.InvariantCulture));break;
        case "volume":Mpv.Set(property,Math.Max(0,Math.Min(100,Number(value,100))).ToString(CultureInfo.InvariantCulture));break;
        case "brightness":case "contrast":case "saturation":case "gamma":Mpv.Set(property,Math.Max(-100,Math.Min(100,Number(value,0))).ToString(CultureInfo.InvariantCulture));break;
        case "video-aspect-override":case "panscan":Mpv.Set(property,Math.Max(-1,Math.Min(4,Number(value,-1))).ToString(CultureInfo.InvariantCulture));break;
        case "glsl-shaders":CheckShaders(Text(value));Mpv.Set(property,Text(value));break;
        default:throw new Exception("Unsupported player property");
      }
    }
    static object Dispatch(Dictionary<string,object> data){
      string command=Text(Value(data,"command",""));
      if(command=="viewport"){
        int x=(int)Math.Round(Number(Value(data,"x",0),0)),y=(int)Math.Round(Number(Value(data,"y",0),0));
        int width=Math.Max(1,Math.Min(16384,(int)Number(Value(data,"width",1),1))),height=Math.Max(1,Math.Min(16384,(int)Number(Value(data,"height",1),1)));
        if(Math.Abs(x)>32768||Math.Abs(y)>32768)throw new Exception("Viewport is outside the supported bounds");
        SetWindowPos(Host.Handle,IntPtr.Zero,x,y,width,height,0x0010|0x0040);ShowWindow(Host.Handle,Convert.ToBoolean(Value(data,"visible",true))?4:0);return null;
      }
      if(command=="load"){
        string url=Text(Value(data,"url",""));if(!HttpUrl(url)||url.Length>16384)throw new Exception("Expected an HTTP(S) media URL");
        Mpv.Set("mute",Convert.ToBoolean(Value(data,"muted",false))?"yes":"no");
        var headers=Value(data,"headers",null) as Dictionary<string,object>;var lines=new List<string>();
        if(headers!=null)foreach(var entry in headers){string value=Text(entry.Value);if(entry.Key.IndexOfAny(new[]{'\r','\n','\0'})>=0||value.IndexOfAny(new[]{'\r','\n','\0'})>=0)throw new Exception("Invalid media header");if(entry.Key.Equals("User-Agent",StringComparison.OrdinalIgnoreCase))Mpv.Set("user-agent",value);else if(entry.Key.Equals("Referer",StringComparison.OrdinalIgnoreCase))Mpv.Set("referrer",value);else lines.Add(entry.Key+": "+value.Replace(",","\\,"));}
        Mpv.Set("http-header-fields",string.Join(",",lines.ToArray()));
        double start=Math.Max(0,Math.Min(604800,Number(Value(data,"start",0),0)));Mpv.Command(new[]{"loadfile",url,"replace","-1","start="+start.ToString(CultureInfo.InvariantCulture)});return null;
      }
      if(command=="set"){Set(Text(Value(data,"property","")),Value(data,"value",null));return null;}
      if(command=="command"){
        string name=Text(Value(data,"name",""));var input=Value(data,"args",new object[0]) as object[];if(input==null||input.Length>16)throw new Exception("Invalid command arguments");var args=new List<string>{name};foreach(object item in input)args.Add(Text(item));
        if(name=="seek"){if(args.Count<2||args.Count>3||Math.Abs(Number(args[1],double.MaxValue))>604800||args.Count==3&&args[2]!="absolute"&&args[2]!="relative"&&args[2]!="absolute+exact"&&args[2]!="relative+exact")throw new Exception("Invalid seek");}
        else if(name=="change-list"){if(args.Count!=4||args[1]!="glsl-shaders"||(args[2]!="set"&&args[2]!="clr"))throw new Exception("Unsupported list mutation");CheckShaders(args[3]);}
        else if(name=="cycle"){if(args.Count!=2||args[1]!="pause")throw new Exception("Unsupported cycle property");}
        else if(name!="stop"&&name!="frame-step"&&name!="frame-back-step")throw new Exception("Unsupported player command");
        Mpv.Command(args.ToArray());return null;
      }
      if(command=="stats")return new {voPasses=Mpv.Node("vo-passes"),shaders=Mpv.Node("glsl-shaders"),video=Mpv.Node("video-params"),videoOutput=Mpv.Node("video-out-params"),osdDimensions=Mpv.Node("osd-dimensions"),aspectOverride=Mpv.Double("video-aspect-override",-1),panscan=Mpv.Double("panscan",0),renderer=Mpv.Get("current-vo"),hwdec=Mpv.Get("hwdec-current"),version=Mpv.Get("mpv-version")};
      if(command=="diagnostic-escape"){if(!Diagnostic)throw new Exception("Diagnostic key injection is disabled");if(!PostMessage(Host.Handle,0x0100,(IntPtr)0x1B,IntPtr.Zero))throw new Exception("Diagnostic Escape post failed");return null;}
      if(command=="diagnostic-frame"){
        if(!Diagnostic)throw new Exception("Diagnostic frame capture is disabled");
        string value=Text(Value(data,"path",""));if(!Path.IsPathRooted(value)||!Path.GetExtension(value).Equals(".png",StringComparison.OrdinalIgnoreCase))throw new Exception("Diagnostic frame must be an absolute PNG path");
        string file=Path.GetFullPath(value);Mpv.Command(new[]{"screenshot-to-file",file,"window"});return new {path=file};
      }
      if(command=="shutdown")return null;
      throw new Exception("Unknown player request");
    }
    static void Request(string line){
      object id=null;string command="";
      try{var data=Json.DeserializeObject(line) as Dictionary<string,object>;if(data==null)throw new Exception("Expected a JSON object");id=Value(data,"id",null);command=Text(Value(data,"command",""));object result=Dispatch(data);Emit(new {type="result",id=id,ok=true,data=result});if(command=="shutdown")Close();}
      catch(Exception error){Emit(new {type="result",id=id,ok=false,error=Limit(error.Message,2000)});}
    }
    static void ReadInput(){try{var line=new StringBuilder();bool oversized=false;for(;;){int c=Console.In.Read();if(c<0)break;if(c=='\n'){string request=line.ToString();line.Length=0;if(!oversized&&request.Length>0)Host.BeginInvoke(new Action(()=>Request(request)));oversized=false;}else if(c!='\r'){if(line.Length<65536)line.Append((char)c);else oversized=true;}}}catch{}finally{try{Host.BeginInvoke(new Action(Close));}catch{}}}
    static bool Contains(NativeRect rect,NativePoint point){return point.X>=rect.Left&&point.X<rect.Right&&point.Y>=rect.Top&&point.Y<rect.Bottom;}
    static void Pointer(){
      NativePoint screen;if(!GetCursorPos(out screen))return;
      NativePoint point=screen;NativeRect client;IntPtr hit=WindowFromPoint(screen);
      bool inside=IsWindowVisible(Parent)&&!IsIconic(Parent)&&ScreenToClient(Parent,ref point)&&GetClientRect(Parent,out client)&&Contains(client,point)&&(hit==Parent||IsChild(Parent,hit));
      NativePoint local=screen;NativeRect video;
      bool insideVideo=inside&&IsWindowVisible(Host.Handle)&&ScreenToClient(Host.Handle,ref local)&&GetClientRect(Host.Handle,out video)&&Contains(video,local)&&(hit==Host.Handle||IsChild(Host.Handle,hit));
      bool changed=PointerKnown&&(LastPointer.X!=screen.X||LastPointer.Y!=screen.Y);
      if(!PointerKnown||inside!=LastInsideApp||insideVideo!=LastInsideVideo||inside&&changed)
        Emit(new {type="pointer",insideApp=inside,insideVideo=insideVideo,x=point.X,y=point.Y,changed=changed});
      PointerKnown=true;LastPointer=new Point(screen.X,screen.Y);LastInsideApp=inside;LastInsideVideo=insideVideo;
    }
    static void Tick(){if(Mpv==null||Closing)return;try{
      Pointer();
      Mpv.Events((action)=>Interact(action));
      Emit(new {type="state",ready=true,paused=Mpv.Flag("pause",true),position=Mpv.Double("time-pos",0),duration=Mpv.Double("duration",0),volume=Mpv.Double("volume",100),mute=Mpv.Flag("mute",false),speed=Mpv.Double("speed",1),videoWidth=(int)Mpv.Double("width",0),videoHeight=(int)Mpv.Double("height",0),hwdec=Mpv.Get("hwdec-current"),vo=Mpv.Get("current-vo"),shaderCount=Mpv.ArrayLength("glsl-shaders"),eof=Mpv.Flag("eof-reached",false)});
    }catch(Exception error){Emit(new {type="error",error=Limit(error.Message,1000)});}}
    [STAThread] static int Main(string[] args){
      try{
        Console.OutputEncoding=new UTF8Encoding(false);Console.InputEncoding=new UTF8Encoding(false);
        if(args.Length%2!=0)throw new Exception("Expected paired host arguments");
        string library="",parent="";for(int i=0;i+1<args.Length;i+=2){if(args[i]=="--library")library=args[i+1];else if(args[i]=="--parent-hwnd")parent=args[i+1];else if(args[i]=="--shader-directory")ShaderDirectory=Path.GetFullPath(args[i+1]).TrimEnd(Path.DirectorySeparatorChar);else if(args[i]=="--diagnostic"&&args[i+1]=="true")Diagnostic=true;else throw new Exception("Unknown host argument");}
        ulong raw;if(!ulong.TryParse(parent,out raw)||raw==0||!IsWindow(new IntPtr(unchecked((long)raw))))throw new Exception("Invalid parent window");
        Parent=new IntPtr(unchecked((long)raw));
        if(!Path.IsPathRooted(library)||!File.Exists(library)||!Directory.Exists(ShaderDirectory))throw new Exception("Native player resources are missing");
        try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        Context=new ApplicationContext();Host=new Surface(new IntPtr(unchecked((long)raw)));Host.CreateControl();IntPtr handle=Host.Handle;ShowWindow(handle,0);
        Mpv=new Native(library,handle);Poll=new System.Windows.Forms.Timer {Interval=250};Poll.Tick+=(s,e)=>Tick();Poll.Start();
        Emit(new {type="ready",version=Mpv.Get("mpv-version"),renderer="gpu-next",hostHwnd=handle.ToInt64().ToString(CultureInfo.InvariantCulture)});
        new Thread(ReadInput){IsBackground=true,Name="Player command input"}.Start();Application.Run(Context);Close();return 0;
      }catch(Exception error){Emit(new {type="error",error=Limit(error.ToString(),3000)});Close();return 1;}
    }
    class Surface:Control {
      readonly IntPtr parent;public Surface(IntPtr value){parent=value;BackColor=Color.Black;SetStyle(ControlStyles.Selectable,false);Bounds=new Rectangle(0,0,1,1);}
      protected override CreateParams CreateParams {get{var value=base.CreateParams;value.Parent=parent;value.Style=(value.Style|0x40000000|0x04000000|0x02000000)&unchecked((int)~0x80000000);value.ClassStyle|=8;return value;}}
      protected override void OnClick(EventArgs e){Interact("togglePause");}
      protected override void OnDoubleClick(EventArgs e){Interact("fullscreen");}
      protected override void WndProc(ref Message message){if(message.Msg==0x0100&&message.WParam.ToInt32()==0x1B){Interact("exitFullscreen");return;}base.WndProc(ref message);}
    }
    sealed class Native:IDisposable {
      [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryW(string name);
      [DllImport("kernel32.dll",CharSet=CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr module,string name);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr CreateFn();
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int InitializeFn(IntPtr handle);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetFn(IntPtr handle,IntPtr name,IntPtr value);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetFn(IntPtr handle,IntPtr name,int format,IntPtr result);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr StringFn(IntPtr handle,IntPtr name);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int CommandFn(IntPtr handle,IntPtr args);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr EventFn(IntPtr handle,double timeout);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void FreeFn(IntPtr value);
      [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void DestroyFn(IntPtr handle);
      IntPtr module,handle;SetFn option,set;GetFn get;StringFn str;CommandFn command;EventFn events;FreeFn free,nodeFree;DestroyFn destroy;
      T Bind<T>(string name){IntPtr address=GetProcAddress(module,name);if(address==IntPtr.Zero)throw new Exception("Missing libmpv API: "+name);return (T)(object)Marshal.GetDelegateForFunctionPointer(address,typeof(T));}
      static IntPtr Utf8(string value){byte[] bytes=Encoding.UTF8.GetBytes(value+"\0");IntPtr p=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,p,bytes.Length);return p;}
      static string Decode(IntPtr p){if(p==IntPtr.Zero)return "";int length=0;while(length<262144&&Marshal.ReadByte(p,length)!=0)length++;byte[] bytes=new byte[length];Marshal.Copy(p,bytes,0,length);return Encoding.UTF8.GetString(bytes);}
      int Call(SetFn fn,string name,string value){IntPtr n=Utf8(name),v=Utf8(value);try{return fn(handle,n,v);}finally{Marshal.FreeHGlobal(n);Marshal.FreeHGlobal(v);}}
      public Native(string file,IntPtr host){module=LoadLibraryW(file);if(module==IntPtr.Zero)throw new Exception("Load libmpv failed: "+Marshal.GetLastWin32Error());handle=Bind<CreateFn>("mpv_create")();if(handle==IntPtr.Zero)throw new Exception("mpv_create failed");option=Bind<SetFn>("mpv_set_option_string");set=Bind<SetFn>("mpv_set_property_string");get=Bind<GetFn>("mpv_get_property");str=Bind<StringFn>("mpv_get_property_string");command=Bind<CommandFn>("mpv_command");events=Bind<EventFn>("mpv_wait_event");free=Bind<FreeFn>("mpv_free");nodeFree=Bind<FreeFn>("mpv_free_node_contents");destroy=Bind<DestroyFn>("mpv_terminate_destroy");
        var options=new Dictionary<string,string>{{"config","no"},{"load-scripts","no"},{"terminal","no"},{"osd-level","0"},{"input-default-bindings","no"},{"input-vo-keyboard","yes"},{"input-cursor","yes"},{"vo","gpu-next"},{"gpu-api","d3d11"},{"gpu-context","d3d11"},{"hwdec","auto-safe"},{"idle","yes"},{"keep-open","yes"},{"force-window","yes"},{"audio-display","no"},{"video-aspect-override","-1"},{"panscan","0"},{"network-timeout","15"},{"demuxer-max-bytes","33554432"},{"demuxer-max-back-bytes","8388608"},{"wid",host.ToInt64().ToString(CultureInfo.InvariantCulture)}};
        foreach(var entry in options){int code=Call(option,entry.Key,entry.Value);if(code<0&&entry.Key!="gpu-context")throw new Exception("mpv option "+entry.Key+" failed: "+code);}
        int initialized=Bind<InitializeFn>("mpv_initialize")(handle);if(initialized<0)throw new Exception("mpv_initialize failed: "+initialized);
        foreach(var binding in new[]{new[]{"MBTN_LEFT","togglePause"},new[]{"MBTN_LEFT_DBL","fullscreen"},new[]{"SPACE","togglePause"},new[]{"ESC","exitFullscreen"},new[]{"LEFT","seekBackward"},new[]{"RIGHT","seekForward"}})Command(new[]{"keybind",binding[0],"script-message agent-pulse "+binding[1]});
      }
      public void Set(string name,string value){int code=Call(set,name,value);if(code<0)throw new Exception("mpv property "+name+" failed: "+code);}
      public string Get(string name){IntPtr n=Utf8(name),value=IntPtr.Zero;try{value=str(handle,n);return Decode(value);}finally{Marshal.FreeHGlobal(n);if(value!=IntPtr.Zero)free(value);}}
      public double Double(string name,double fallback){IntPtr n=Utf8(name),data=Marshal.AllocHGlobal(8);try{if(get(handle,n,5,data)<0)return fallback;double value=(double)Marshal.PtrToStructure(data,typeof(double));return double.IsNaN(value)||double.IsInfinity(value)?fallback:value;}finally{Marshal.FreeHGlobal(n);Marshal.FreeHGlobal(data);}}
      public bool Flag(string name,bool fallback){IntPtr n=Utf8(name),data=Marshal.AllocHGlobal(4);try{return get(handle,n,3,data)<0?fallback:Marshal.ReadInt32(data)!=0;}finally{Marshal.FreeHGlobal(n);Marshal.FreeHGlobal(data);}}
      public object Node(string name){IntPtr n=Utf8(name),data=Marshal.AllocHGlobal(16);try{if(get(handle,n,6,data)<0)return null;try{int budget=2000;return ReadNode(data,0,ref budget);}finally{nodeFree(data);}}finally{Marshal.FreeHGlobal(n);Marshal.FreeHGlobal(data);}}
      object ReadNode(IntPtr pointer,int depth,ref int budget){if(depth>8||--budget<0)return null;int format=Marshal.ReadInt32(pointer,8);if(format==1||format==2)return Limit(Decode(Marshal.ReadIntPtr(pointer)),2000);if(format==3)return Marshal.ReadInt32(pointer)!=0;if(format==4)return Marshal.ReadInt64(pointer);if(format==5){double d=(double)Marshal.PtrToStructure(pointer,typeof(double));return double.IsNaN(d)||double.IsInfinity(d)?null:(object)d;}if(format==7||format==8){IntPtr list=Marshal.ReadIntPtr(pointer);if(list==IntPtr.Zero)return null;int count=Math.Min(256,Math.Max(0,Marshal.ReadInt32(list)));IntPtr values=Marshal.ReadIntPtr(list,8),keys=Marshal.ReadIntPtr(list,16);if(format==7){var output=new List<object>();for(int i=0;i<count;i++)output.Add(ReadNode(IntPtr.Add(values,i*16),depth+1,ref budget));return output;}var map=new Dictionary<string,object>();for(int i=0;i<count;i++)map[Limit(Decode(Marshal.ReadIntPtr(keys,i*8)),200)]=ReadNode(IntPtr.Add(values,i*16),depth+1,ref budget);return map;}return null;}
      public int ArrayLength(string name){var value=Node(name) as IList;return value==null?0:value.Count;}
      public void Command(string[] arguments){IntPtr argv=Marshal.AllocHGlobal((arguments.Length+1)*IntPtr.Size);var pointers=new List<IntPtr>();try{for(int i=0;i<arguments.Length;i++){IntPtr item=Utf8(arguments[i]);pointers.Add(item);Marshal.WriteIntPtr(argv,i*IntPtr.Size,item);}Marshal.WriteIntPtr(argv,arguments.Length*IntPtr.Size,IntPtr.Zero);int code=command(handle,argv);if(code<0)throw new Exception("mpv command "+arguments[0]+" failed: "+code);}finally{foreach(IntPtr item in pointers)Marshal.FreeHGlobal(item);Marshal.FreeHGlobal(argv);}}
      public void Events(Action<string> action){for(int i=0;i<32;i++){IntPtr value=events(handle,0);if(value==IntPtr.Zero)return;int id=Marshal.ReadInt32(value);if(id==0)return;if(id==16){IntPtr data=Marshal.ReadIntPtr(value,16);int length=Marshal.ReadInt32(data);IntPtr args=Marshal.ReadIntPtr(data,8);if(length>=2&&Decode(Marshal.ReadIntPtr(args))=="agent-pulse")action(Decode(Marshal.ReadIntPtr(args,8)));}else if(id==7){IntPtr data=Marshal.ReadIntPtr(value,16);if(data!=IntPtr.Zero&&Marshal.ReadInt32(data)==4)Emit(new {type="error",error="视频来源播放失败（libmpv "+Marshal.ReadInt32(data,4)+"），请重试或切换来源。"});}}}
      public void Dispose(){if(handle!=IntPtr.Zero){IntPtr value=handle;handle=IntPtr.Zero;destroy(value);}}
    }
  }
}

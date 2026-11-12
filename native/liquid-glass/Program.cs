using System.Buffers.Binary;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using GlassDock.Rendering;

namespace GlassDock {
    internal static class DesktopNative {
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left,Top,Right,Bottom; }
        [DllImport("user32.dll")] internal static extern nint GetForegroundWindow();
    }
}

namespace SonaraGlass {
    internal sealed record Command(string Op,int Id=0,int X=0,int Y=0,int Width=0,int Height=0,float Scale=1,float Radius=24,int Sequence=0,bool Static=false);
    internal sealed class Surface : IDisposable {
        internal GlassRenderer Renderer=new();
        internal Command Configuration;
        internal byte[] Pixels=[];
        internal int Waiting;
        internal long Next,Sent;
        internal Surface(Command configuration) { Configuration=configuration; }
        public void Dispose() { Renderer.Dispose(); Pixels=[]; }
    }
    internal static class Program {
        private static readonly Dictionary<int,Surface> Surfaces=[];
        private static readonly Stream Output=Console.OpenStandardOutput();
        private static int _sequence;
        [STAThread] private static void Main(string[] args) {
            if(args is ["--validate-shader"]){GlassRenderer.ValidateShader();Console.WriteLine("Veyra embedded shaders match HLSL byte for byte");return;}
            if(args.Length!=1 || !uint.TryParse(args[0],out uint owner) || owner<1)return;
            WindowBackgroundScene.ExternalOwnerProcessId=owner;
            var dispatcher=Dispatcher.CurrentDispatcher;
            var timer=new DispatcherTimer(DispatcherPriority.Background) { Interval=TimeSpan.FromMilliseconds(16) };
            timer.Tick+=(_,_)=>Tick(); timer.Start();
            _=Task.Run(async()=> {
                try {
                    while(await Console.In.ReadLineAsync() is { } line) {
                        if(line.Length>2048)continue;
                        var command=JsonSerializer.Deserialize<Command>(line);
                        if(command is not null)await dispatcher.InvokeAsync(()=>Apply(command));
                    }
                } catch(Exception exception) { Console.Error.WriteLine(exception.Message); }
                finally { dispatcher.BeginInvokeShutdown(DispatcherPriority.Send); }
            });
            try { Dispatcher.Run(); }
            finally { timer.Stop(); foreach(var surface in Surfaces.Values)surface.Dispose(); Output.Dispose(); }
        }
        private static void Apply(Command command) {
            if(command.Id is <1 or >2)return;
            if(command.Op=="ack") { if(Surfaces.TryGetValue(command.Id,out var surface)&&surface.Waiting==command.Sequence)surface.Waiting=0; return; }
            if(command.Op=="remove") { if(Surfaces.Remove(command.Id,out var old))old.Dispose(); return; }
            if(command.Op!="surface" || command.Width<4 || command.Height<4 || command.Width>4096 || command.Height>3072 || (long)command.Width*command.Height>8_388_608 || command.Scale<.5 || command.Scale>4 || command.Radius<0 || command.Radius>200)return;
            if(Surfaces.TryGetValue(command.Id,out var current)) { current.Configuration=command; current.Next=0; }
            else Surfaces.Add(command.Id,new(command));
        }
        private static void Tick() {
            long now=Environment.TickCount64;
            foreach(var pair in Surfaces) {
                var surface=pair.Value; var c=surface.Configuration;
                // One in-flight frame per surface; an unresponsive renderer cannot queue images.
                if(surface.Waiting!=0)continue;
                try {
                    BitmapSource? image=null;bool updated=false;
                    if(surface.Renderer.HasPendingFrame){surface.Renderer.TryPresentPending(out image);updated=surface.Renderer.LastFrameUpdated;}
                    if(now>=surface.Next) {
                        surface.Next=now+(pair.Key==1?67:125);
                        var options=new GlassOptions { CornerRadiusPixels=c.Radius,SurfaceInsetPixels=1.25f*c.Scale,ThicknessPixels=8*c.Scale,NormalTransitionPixels=12.5f*c.Scale,BackgroundDistancePixels=24*c.Scale,Tint=.035f,LightTimeSeconds=c.Static?0:null };
                        surface.Renderer.TryRender(new Int32Rect(c.X,c.Y,c.Width,c.Height),options,out var rendered);image=rendered??image;updated|=surface.Renderer.LastFrameUpdated;
                    }
                    if(image is not null && updated)Present(pair.Key,surface,image);
                    if(surface.Renderer.LastError is { } error && now-surface.Sent>5000) { surface.Sent=now; Console.Error.WriteLine($"surface {pair.Key}: {error}"); }
                } catch(Exception exception) { surface.Next=now+3000; Console.Error.WriteLine($"surface {pair.Key}: {exception.Message}"); }
            }
        }
        private static void Present(int id,Surface surface,BitmapSource image) {
            int size=checked(image.PixelWidth*image.PixelHeight*4);
            if(surface.Pixels.Length!=size)surface.Pixels=new byte[size];
            image.CopyPixels(surface.Pixels,image.PixelWidth*4,0);
            // The migrated WPF output is premultiplied BGRA; Canvas ImageData needs straight RGBA.
            for(int offset=0;offset<size;offset+=4) {
                byte b=surface.Pixels[offset],g=surface.Pixels[offset+1],r=surface.Pixels[offset+2],a=surface.Pixels[offset+3];
                surface.Pixels[offset]=(byte)(a==0?0:Math.Min(255,r*255/a));
                surface.Pixels[offset+1]=(byte)(a==0?0:Math.Min(255,g*255/a));
                surface.Pixels[offset+2]=(byte)(a==0?0:Math.Min(255,b*255/a));
            }
            int sequence=++_sequence; surface.Waiting=sequence;
            Span<byte> header=stackalloc byte[24];
            BinaryPrimitives.WriteUInt32LittleEndian(header,0x31474c56);
            BinaryPrimitives.WriteInt32LittleEndian(header[4..],id);
            BinaryPrimitives.WriteInt32LittleEndian(header[8..],image.PixelWidth);
            BinaryPrimitives.WriteInt32LittleEndian(header[12..],image.PixelHeight);
            BinaryPrimitives.WriteInt32LittleEndian(header[16..],sequence);
            BinaryPrimitives.WriteInt32LittleEndian(header[20..],size);
            Output.Write(header); Output.Write(surface.Pixels); Output.Flush();
        }
    }
}

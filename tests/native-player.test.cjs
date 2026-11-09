'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createNativePlayer,parentValue}=require('../src/native-player/index.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
  let instance,spawns=0;const packets=[],states=[],interactions=[],pointers=[],errors=[];
  const spawn=(file,args,options)=>{spawns++;instance=new EventEmitter();instance.pid=42;instance.stdout=new EventEmitter();instance.stdout.setEncoding=()=>{};instance.stderr={resume(){}};instance.stdin=new EventEmitter();instance.stdin.write=(text,callback)=>{packets.push(JSON.parse(text));callback?.();};instance.stdin.end=text=>{if(text)packets.push(JSON.parse(text));setImmediate(()=>instance.emit('exit',0));};instance.kill=()=>{instance.killed=true;setImmediate(()=>instance.emit('exit',1));};instance.launch={file,args,options};return instance;};
  const config={executablePath:path.resolve('native/player/bin/AgentPulse.Player.exe'),libraryPath:path.resolve('native/player/resources/libmpv-2.dll'),shaderDirectory:path.resolve('native/player/resources/shaders'),parentHwnd:Buffer.from([123,0,0,0,0,0,0,0]),spawn,onState:value=>states.push(value),onInteraction:value=>interactions.push(value),onPointer:value=>pointers.push(value),onError:error=>errors.push(error),...overrides};
  const player=createNativePlayer(config);
  function emit(message){instance.stdout.emit('data',JSON.stringify(message)+'\n');}
  async function ready(){const p=player.start();emit({type:'ready',version:'mpv fixture',renderer:'gpu-next'});await p;}
  return {player,packets,states,interactions,pointers,errors,config,emit,ready,get child(){return instance;},get spawns(){return spawns;}};
}
test('native player loads only on demand and waits for its exact helper handshake',async()=>{
  const f=fixture();assert.equal(f.spawns,0);const ready=f.player.start();assert.equal(f.spawns,1);assert.equal(f.child.launch.options.windowsHide,true);assert.equal(f.child.launch.options.shell,false);assert.equal(f.child.launch.args[3],'123');assert.equal(f.player.getStatus().ready,false);f.emit({type:'ready',version:'mpv fixture',renderer:'gpu-next'});await ready;assert.equal(f.player.getStatus().ready,true);assert.equal(await f.player.start(),await ready);await f.player.stop();assert.equal(f.player.getStatus().ready,false);
});
test('chunked responses correlate by id and four-Hz state remains separate from request results',async()=>{
  const f=fixture();await f.ready();const a=f.player.set('volume',40),b=f.player.command('seek',['35','absolute']);await turn();const [one,two]=f.packets;f.child.stdout.emit('data',JSON.stringify({type:'result',id:two.id,ok:true,data:{seek:35}}).slice(0,20));f.child.stdout.emit('data',JSON.stringify({type:'result',id:two.id,ok:true,data:{seek:35}}).slice(20)+'\n');f.emit({type:'result',id:one.id,ok:false,error:'Rejected'});await assert.rejects(a,/Rejected/);assert.deepEqual(await b,{seek:35});f.emit({type:'state',paused:false,position:35,duration:1200,volume:40,mute:false,speed:1,videoWidth:1280,videoHeight:720,hwdec:'d3d11va',vo:'gpu-next',shaderCount:7});assert.equal(f.states.length,1);assert.equal(f.states[0].position,35);f.emit({type:'state',position:Infinity});assert.equal(f.states.length,1);f.emit({type:'interaction',action:'fullscreen'});f.emit({type:'interaction',action:'run-shell'});assert.deepEqual(f.interactions,['fullscreen']);await f.player.stop();
});
test('only allowed properties, shader paths and player commands reach the native protocol',async()=>{
  const f=fixture();await f.ready();assert.throws(()=>f.player.set('arbitrary','x'));assert.throws(()=>f.player.set('speed',12));assert.throws(()=>f.player.command('run',['cmd']));assert.throws(()=>f.player.command('change-list',['glsl-shaders','set',path.resolve('outside.glsl')]));assert.throws(()=>f.player.load({url:'file:///C:/private'}));assert.throws(()=>f.player.load({url:'https://media.test/a',headers:{Referer:'bad\r\nheader'}}));assert.equal(f.player.screenshot,undefined);assert.throws(()=>f.player.captureFrame(path.resolve('frame.png')),/disabled/);assert.throws(()=>f.player.diagnosticEscape(),/disabled/);assert.throws(()=>f.player.viewport({x:0,y:0,width:0,height:100}));const shader=path.join(f.config.shaderDirectory,'Anime4K_Restore_CNN_M.glsl');const request=f.player.command('change-list',['glsl-shaders','set',shader]);await turn();const packet=f.packets.at(-1);assert.equal(packet.args[2],shader);f.emit({type:'result',id:packet.id,ok:true});await request;await f.player.stop();
});

test('native pointer notifications are validated and never become playback or history frames',async()=>{
  const f=fixture();await f.ready();const value={type:'pointer',insideApp:true,insideVideo:true,x:640,y:400,changed:true};f.emit(value);assert.deepEqual(f.pointers,[{insideApp:true,insideVideo:true,x:640,y:400,changed:true}]);assert.equal(f.states.length,0);assert.equal(f.packets.length,0);
  for(const patch of [{insideApp:false},{x:Infinity},{insideVideo:1},{changed:'true'},{y:-2147483649}])f.emit({...value,...patch});assert.equal(f.pointers.length,1);
  f.emit({type:'pointer',insideApp:false,insideVideo:false,x:-400,y:20,changed:true});assert.equal(f.pointers.length,2);assert.equal(f.player.getStatus().position,0);await f.player.stop();f.emit(value);assert.equal(f.pointers.length,2);
});

test('diagnostic frame capture requires explicit host opt-in and never exposes the former screenshot command',async()=>{
  const f=fixture({diagnostic:true});await f.ready();assert.deepEqual(f.child.launch.args.slice(-2),['--diagnostic','true']);assert.equal(f.player.screenshot,undefined);assert.throws(()=>f.player.captureFrame('relative.png'),/absolute PNG/);assert.throws(()=>f.player.captureFrame(path.resolve('frame.jpg')),/absolute PNG/);
  const file=path.resolve('frame.png'),pending=f.player.captureFrame(file);await turn();assert.equal(f.packets.at(-1).command,'diagnostic-frame');assert.equal(f.packets.at(-1).path,file);f.emit({type:'result',id:f.packets.at(-1).id,ok:true,data:{path:file}});assert.deepEqual(await pending,{path:file});await f.player.stop();
});
test('EOF shutdown rejects pending work and late frames cannot revive the player',async()=>{
  const f=fixture();await f.ready();const pending=f.player.requestStats();await turn();const stopped=f.player.stop();await assert.rejects(pending,/stopped/);await stopped;assert.equal(f.packets.at(-1).command,'shutdown');assert.equal(f.child.killed,undefined);const before=f.states.length;f.emit({type:'state',position:1});assert.equal(f.states.length,before);await assert.rejects(f.player.start(),/stopped/);
});

test('native Escape diagnostic uses only the opt-in helper command and not an unrestricted key interface',async()=>{
  const f=fixture({diagnostic:true});await f.ready();const request=f.player.diagnosticEscape();await turn();const packet=f.packets.at(-1);assert.equal(packet.command,'diagnostic-escape');f.emit({type:'result',id:packet.id,ok:true});await request;f.emit({type:'interaction',action:'exitFullscreen'});assert.deepEqual(f.interactions,['exitFullscreen']);assert.throws(()=>f.player.command('keypress',['ESC']));await f.player.stop();
});
test('bad helper frames are bounded and a crashed helper is never automatically respawned',async()=>{
  const f=fixture();await f.ready();f.child.stdout.emit('data','x'.repeat(524289));await turn();assert.equal(f.child.killed,true);assert(f.errors.some(error=>/Oversized/.test(error.message)));assert.equal(f.spawns,1);await f.player.stop();
});
test('Windows x64 HWNDs retain every bit rather than passing through lossy numbers',()=>{
  const handle=Buffer.alloc(8);handle.writeBigUInt64LE(0xfffffffffffffff0n);assert.equal(parentValue(handle),'18446744073709551600');assert.throws(()=>parentValue('0'));assert.throws(()=>parentValue('0x123'));assert.throws(()=>parentValue(Buffer.alloc(4)));
});

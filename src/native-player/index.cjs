'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const MAX_LINE=262144,MAX_PENDING=32;
const finite=(value,min,max)=>Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
function parentValue(input){if(Buffer.isBuffer(input)){if(input.length<8)throw Error('Expected a Windows x64 parent HWND');return input.readBigUInt64LE(0).toString();}const text=String(input??'');if(!/^\d{1,20}$/.test(text)||BigInt(text)<=0n||BigInt(text)>0xffffffffffffffffn)throw Error('Invalid parent HWND');return text;}
function webURL(input){const url=new URL(String(input));if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.href.length>16384)throw Error('Expected an HTTP(S) media URL');return url.href;}
function createNativePlayer(options={}){
  const launch=options.spawn||spawn,executable=options.executablePath,library=options.libraryPath,shaderDirectory=path.resolve(options.shaderDirectory||'.');
  let child=null,starting=null,ready=false,stopped=false,generation=0,sequence=0,buffer='',stopPromise=null,resolveStop=null,killTimer=null;
  let status={ready:false,paused:true,position:0,duration:0},resolveReady,rejectReady,readyTimer;
  const pending=new Map();
  const errorValue=value=>value instanceof Error?value:Error(String(value?.message||value||'Native player failed'));
  function notifyError(error){try{options.onError?.(errorValue(error));}catch{}}
  function rejectAll(error){for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();}
  function fail(error){ready=false;status={...status,ready:false,error:errorValue(error).message};rejectReady?.(errorValue(error));resolveReady=null;rejectReady=null;clearTimeout(readyTimer);rejectAll(errorValue(error));notifyError(error);}
  function consume(message){
    if(message?.type==='ready'){
      if(ready)return;ready=true;status={...status,ready:true,version:String(message.version||'').slice(0,200),renderer:String(message.renderer||'').slice(0,40)};
      clearTimeout(readyTimer);resolveReady?.(status);resolveReady=null;rejectReady=null;return;
    }
    if(message?.type==='result'){
      const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
      message.ok===true?item.resolve(message.data??null):item.reject(errorValue(message.error||'Native command failed'));return;
    }
    if(message?.type==='state'){
      const next={ready:true,paused:message.paused===true,mute:message.mute===true,eof:message.eof===true};
      for(const [name,min,max]of [['position',0,604800],['duration',0,604800],['volume',0,100],['speed',.25,3],['videoWidth',0,16384],['videoHeight',0,16384],['shaderCount',0,32]]){
        if(!finite(message[name],min,max))return;next[name]=Number(message[name]);
      }
      next.hwdec=String(message.hwdec||'').slice(0,80);next.vo=String(message.vo||'').slice(0,80);status={...status,...next};
      try{options.onState?.({...status});}catch(error){notifyError(error);}return;
    }
    if(message?.type==='pointer'){
      if(typeof message.insideApp!=='boolean'||typeof message.insideVideo!=='boolean'||typeof message.changed!=='boolean'||message.insideVideo&&!message.insideApp||!Number.isInteger(message.x)||!Number.isInteger(message.y)||!finite(message.x,-2147483648,2147483647)||!finite(message.y,-2147483648,2147483647))return;
      try{options.onPointer?.({insideApp:message.insideApp,insideVideo:message.insideVideo,x:Number(message.x),y:Number(message.y),changed:message.changed});}catch(error){notifyError(error);}return;
    }
    if(message?.type==='interaction'&&['togglePause','fullscreen','exitFullscreen','seekBackward','seekForward'].includes(message.action)){try{options.onInteraction?.(message.action);}catch(error){notifyError(error);}return;}
    if(message?.type==='error'){const error=errorValue(message.error);if(!ready)fail(error);else{status.error=error.message;notifyError(error);}}
  }
  function start(){
    if(stopped)return Promise.reject(Error('Native player is stopped'));if(starting)return starting;
    for(const file of [executable,library,shaderDirectory])if(!file||!path.isAbsolute(file))return Promise.reject(Error('Native player resource paths must be absolute'));
    if(!options.spawn&&(!fs.existsSync(executable)||!fs.existsSync(library)||!fs.existsSync(shaderDirectory)))return Promise.reject(Error('Native player resources are missing'));
    const parent=parentValue(options.parentHwnd),token=++generation;
    starting=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    try{
      const args=['--library',library,'--parent-hwnd',parent,'--shader-directory',shaderDirectory];if(options.diagnostic===true)args.push('--diagnostic','true');
      const instance=launch(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});child=instance;
      instance.stdin?.on('error',()=>{});instance.stderr?.resume();instance.stdout.setEncoding('utf8');
      instance.stdout.on('data',chunk=>{
        if(token!==generation||stopped)return;buffer+=chunk;
        if(buffer.length>MAX_LINE*2){fail(Error('Oversized native player protocol buffer'));instance.kill();return;}
        let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(line.length>MAX_LINE){fail(Error('Oversized native player message'));instance.kill();return;}try{consume(JSON.parse(line));}catch{}}
      });
      let endedOnce=false;
      const ended=error=>{if(endedOnce||token!==generation)return;endedOnce=true;child=null;ready=false;clearTimeout(killTimer);clearTimeout(readyTimer);if(!stopped)fail(error||Error('Native player helper exited'));else rejectAll(Error('Native player stopped'));resolveStop?.();resolveStop=null;};
      instance.once('exit',()=>ended());instance.once('error',error=>ended(error));
      readyTimer=setTimeout(()=>{if(token===generation&&!ready){fail(Error('Native player startup timed out'));instance.kill();}},12000);readyTimer.unref?.();
    }catch(error){fail(error);}
    return starting;
  }
  async function request(command,payload={}){
    await start();if(stopped||!child||!ready)throw Error('Native player is unavailable');if(pending.size>=MAX_PENDING)throw Error('Native player request queue is full');
    return new Promise((resolve,reject)=>{
      const id=++sequence,packet=JSON.stringify({id,command,...payload});if(Buffer.byteLength(packet)>65536){reject(Error('Native command is too large'));return;}
      const item={resolve,reject,timer:setTimeout(()=>{pending.delete(id);reject(Error('Native player command timed out'));},10000)};item.timer.unref?.();pending.set(id,item);
      child.stdin.write(packet+'\n',error=>{if(error&&pending.has(id)){pending.delete(id);clearTimeout(item.timer);reject(error);}});
    });
  }
  function shaders(value){const list=String(value||'').split(';').filter(Boolean);if(list.length>16)throw Error('Too many shaders');for(const name of list){const file=path.resolve(name);if(path.dirname(file).toLowerCase()!==shaderDirectory.toLowerCase()||path.extname(file)!=='.glsl')throw Error('Shader path is outside the configured directory');}return list.join(';');}
  function validateProperty(property,value){
    if(['pause','mute'].includes(property)){if(typeof value!=='boolean')throw Error('Expected a boolean player value');return value;}
    const ranges={speed:[.25,3],volume:[0,100],brightness:[-100,100],contrast:[-100,100],saturation:[-100,100],gamma:[-100,100],'video-aspect-override':[-1,4],panscan:[0,1]};
    if(property==='glsl-shaders')return shaders(value);if(!ranges[property]||!finite(value,...ranges[property]))throw Error('Unsupported or invalid player property');return Number(value);
  }
  return {
    start,
    load(value={}){const url=webURL(value.url),headers={};for(const [name,raw]of Object.entries(value.headers||{})){const text=String(raw);if(!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)||/[\r\n\0]/.test(text)||text.length>8192)throw Error('Invalid media header');headers[name]=text;}return request('load',{url,headers,start:finite(value.start??0,0,604800)?Number(value.start||0):0,muted:value.muted===true});},
    set(property,value){return request('set',{property,value:validateProperty(property,value)});},
    command(name,args=[]){
      if(!Array.isArray(args)||args.length>16)throw Error('Invalid player arguments');args=args.map(String);
      if(name==='change-list'){if(args.length!==3||args[0]!=='glsl-shaders'||!['set','clr'].includes(args[1]))throw Error('Unsupported shader command');args[2]=shaders(args[2]);}
      else if(name==='seek'){if(args.length<1||args.length>2||!finite(args[0],-604800,604800)||args.length===2&&!['absolute','relative','absolute+exact','relative+exact'].includes(args[1]))throw Error('Invalid seek');}
      else if(name==='cycle'){if(args.length!==1||args[0]!=='pause')throw Error('Unsupported cycle property');}
      else if(!['stop','frame-step','frame-back-step'].includes(name)||args.length)throw Error('Unsupported player command');
      return request('command',{name,args});
    },
    viewport(value={}){for(const key of ['x','y'])if(!finite(value[key],-32768,32768))throw Error('Invalid viewport position');for(const key of ['width','height'])if(!finite(value[key],1,16384))throw Error('Invalid viewport size');return request('viewport',{x:Math.round(value.x),y:Math.round(value.y),width:Math.round(value.width),height:Math.round(value.height),visible:value.visible!==false});},
    requestStats:()=>request('stats'),
    diagnosticEscape(){if(options.diagnostic!==true)throw Error('Diagnostic key injection is disabled');return request('diagnostic-escape');},
    captureFrame(file){if(options.diagnostic!==true)throw Error('Diagnostic frame capture is disabled');if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.png')throw Error('Expected an absolute PNG diagnostic path');return request('diagnostic-frame',{path:path.resolve(file)});},
    getStatus:()=>({...status,ready,pid:child?.pid||null,pending:pending.size}),
    stop(){
      if(stopPromise)return stopPromise;stopped=true;clearTimeout(readyTimer);rejectReady?.(Error('Native player stopped'));resolveReady=null;rejectReady=null;rejectAll(Error('Native player stopped'));
      if(!child){ready=false;return Promise.resolve();}
      const instance=child;stopPromise=new Promise(resolve=>{resolveStop=resolve;});
      try{instance.stdin.end(JSON.stringify({id:++sequence,command:'shutdown'})+'\n');}catch{}
      killTimer=setTimeout(()=>{instance.kill();},2500);killTimer.unref?.();return stopPromise;
    }
  };
}
module.exports={createNativePlayer,parentValue};

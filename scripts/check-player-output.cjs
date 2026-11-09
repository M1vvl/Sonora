'use strict';
// Explicit synthetic-frame GPU check. No real video or desktop pixels are read.
const electron=require('electron'),{app,BrowserWindow,nativeImage}=electron;
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.PULSE_OUTPUT_TEST_DIR||path.join(root,'artifacts/v0.3.15-output'));
app.setPath('userData',path.join(out,'profile'));app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  fs.mkdirSync(out,{recursive:true});const shaders=path.join(out,'shaders');fs.mkdirSync(shaders,{recursive:true});
  const original=process.env.PULSE_PLAYER_NATIVE||path.join(root,'native/player/resources');
  for(const name of fs.readdirSync(path.join(original,'shaders')))if(name.endsWith('.glsl'))fs.copyFileSync(path.join(original,'shaders',name),path.join(shaders,name));
  const debug=path.join(shaders,'AgentPulse_DiagnosticTextureSize.glsl');
  fs.writeFileSync(debug,'//!HOOK MAIN\n//!BIND HOOKED\n//!DESC AgentPulse diagnostic actual texture size\nvec4 hook(){return vec4(HOOKED_size.x/8192.0,HOOKED_size.y/8192.0,0.0,1.0);}\n');
  const raw=Buffer.alloc(1920*1080*4);for(let y=0;y<1080;y++)for(let x=0;x<1920;x++){const at=(y*1920+x)*4;raw[at]=x%16<8?230:30;raw[at+1]=y%16<8?30:230;raw[at+2]=(x+y)%32<16?230:30;raw[at+3]=255;}
  const png=nativeImage.createFromBitmap(raw,{width:1920,height:1080}).toPNG(),server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'image/png','Content-Length':png.length});response.end(png);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const owner=new BrowserWindow({show:false,width:640,height:360,frame:false}),report={checkedAt:new Date().toISOString(),checks:{},modes:{}};
  const {createNativePlayer}=require('../src/native-player/index.cjs'),{processingShaders}=require('../src/player-output.cjs');
  const backend=createNativePlayer({executablePath:process.env.PULSE_PLAYER_EXE||path.join(root,'native/player/bin/AgentPulse.Player.exe'),libraryPath:path.join(original,'libmpv-2.dll'),shaderDirectory:shaders,parentHwnd:owner.getNativeWindowHandle(),diagnostic:true});
  const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
  try{
    await backend.start();await backend.viewport({x:0,y:0,width:640,height:360,visible:true});
    await backend.load({url:'http://127.0.0.1:'+server.address().port+'/source.png',muted:true});await wait(1200);
    for(const [target,width,height]of [['1080p',1920,1080],['1440p',2560,1440],['2160p',3840,2160]]){
      const files=processingShaders({superResolution:'quality',outputResolution:target},shaders);await backend.command('change-list',['glsl-shaders','set',files.join(';')]);await wait(700);
      const stats=await backend.requestStats();report.modes[target]={stats};
      report.checks[target+'PassExecuted']=strings(stats.voPasses).some(text=>text.includes(`AgentPulse GPU target ${width}x${height}`));
      if(target==='2160p')report.checks.neuralUpscaleIndependentOfSmallWindow=strings(stats.voPasses).some(text=>/Anime4K.*Upscale.*CNN/i.test(text));
      await backend.command('change-list',['glsl-shaders','set',[...files,debug].join(';')]);await wait(500);
      const file=path.join(out,target+'-actual-texture.png');await backend.captureFrame(file);const image=nativeImage.createFromPath(file),bitmap=image.toBitmap(),size=image.getSize(),at=(Math.floor(size.height/2)*size.width+Math.floor(size.width/2))*4;
      const actual=[bitmap[at+2],bitmap[at+1]],expected=[Math.round(width/8192*255),Math.round(height/8192*255)];
      report.modes[target].actualPixel=actual;report.modes[target].expectedPixel=expected;report.modes[target].captureSize=size;
      report.checks[target+'TextureDimensions']=actual.every((channel,index)=>Math.abs(channel-expected[index])<=3);
    }
  }catch(error){report.error=error.stack;report.checks.noError=false;}
  finally{await backend.stop();owner.destroy();await new Promise(resolve=>server.close(resolve));}
  fs.writeFileSync(path.join(out,'output-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,error:report.error,modes:Object.fromEntries(Object.entries(report.modes).map(([name,value])=>[name,{pixel:value.actualPixel,expected:value.expectedPixel}]))}));app.exit(Object.values(report.checks).every(value=>value===true)?0:1);
}).catch(error=>{console.error(error.stack);app.exit(1);});

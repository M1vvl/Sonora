'use strict';
// Hidden, synthetic-cover-only WebGL validation. Never reads user desktop,
// camera, profile, music credentials or real album artwork.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const workspace=path.resolve(__dirname,'..');
const argument=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:null;};
const root=path.resolve(argument('--root')||process.env.PULSE_MUSIC_CARDS_ROOT||workspace);
const out=path.resolve(argument('--output')||process.env.PULSE_MUSIC_CARDS_OUTPUT||path.join(workspace,'artifacts/music-cards'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!process.versions.electron){
  const {spawn}=require('node:child_process');fs.mkdirSync(out,{recursive:true});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[__filename,'--cards-child','--root',root,'--output',out],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let errors='';child.stdout.on('data',()=>{});child.stderr.on('data',value=>{if(errors.length<16000)errors+=value.toString();});
  const timer=setTimeout(()=>child.kill(),90000);
  child.once('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1;});
  child.once('exit',code=>{clearTimeout(timer);try{const report=JSON.parse(fs.readFileSync(path.join(out,'music-cards-report.json'),'utf8'));console.log(JSON.stringify({checks:report.checks,metrics:report.metrics,output:out}));if(code||report.error||Object.values(report.checks).some(value=>value!==true)){console.error(report.error||errors);process.exitCode=1;}}catch(error){console.error(errors||error.message);process.exitCode=1;}});
}else run().catch(error=>{console.error(error);require('electron').app.exit(1);});

async function run(){
  const {app,BrowserWindow,protocol,nativeImage}=require('electron');
  fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile-'+Date.now()));
  protocol.registerSchemesAsPrivileged([{scheme:'pulse-music-image',privileges:{standard:true,secure:true,corsEnabled:true,supportFetchAPI:true}}]);
  const report={checkedAt:new Date().toISOString(),root,syntheticOnly:true,checks:{},metrics:{},rendererErrors:[]};
  const save=()=>fs.writeFileSync(path.join(out,'music-cards-report.json'),JSON.stringify(report,null,2));
  const check=(name,value)=>{report.checks[name]=!!value;if(!value)throw new Error('Music cards check failed: '+name);};
  let owner;
  try{
    await app.whenReady();const covers=new Map();
    for(let index=0;index<5;index++){
      const size=512,pixels=Buffer.alloc(size*size*4);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const at=(y*size+x)*4,band=((x+y+index*80)%210)/210,circle=Math.hypot(x-190-index*25,y-210)<100;
        const colors=index===0?[65+band*140,65+band*95,125+band*100]:index===1?[145+band*75,70+band*100,85+band*95]:[70+band*100,135+band*80,95+band*100];
        pixels[at]=circle?220:Math.round(colors[2]);pixels[at+1]=circle?225:Math.round(colors[1]);pixels[at+2]=circle?230:Math.round(colors[0]);pixels[at+3]=255;
      }
      covers.set(String.fromCharCode(97+index),nativeImage.createFromBitmap(pixels,{width:size,height:size,scaleFactor:1}).toPNG());
    }
    protocol.handle('pulse-music-image',request=>{const key=new URL(request.url).pathname.slice(1),png=covers.get(key);return png?new Response(png,{headers:{'Content-Type':'image/png','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}}):new Response(null,{status:404});});
    const fileURL=file=>pathToFileURL(path.join(root,file)).href;
    const html=`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self' file:; script-src 'self' file:; style-src 'self' file: 'unsafe-inline'; img-src pulse-music-image:; connect-src 'none'"><title>Synthetic cover material diagnostic</title><link rel="stylesheet" href="${fileURL('ui/themes.css')}"><link rel="stylesheet" href="${fileURL('ui/music/cards.css')}"><script src="${fileURL('ui/themes.js')}" defer></script><script src="${fileURL('ui/music/cards.js')}" defer></script><style>*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px 'Segoe UI',sans-serif}body{padding:40px;background:var(--bg);color:var(--text)}h1{font-size:24px;margin:0 0 16px}p{color:var(--muted)}#mount{width:330px;height:340px}aside{position:absolute;left:450px;top:125px;max-width:390px;line-height:1.7}code{color:var(--accent-text)}@media(max-width:1000px){#mount{width:280px;height:305px}aside{left:385px}}</style><h1>封面材质与手势 · 合成诊断</h1><div id="mount"></div><aside>五张独立封面，右上露角叠放。<p>顶卡：清晰封面 / 轻微表面纹理 / 倒角法线 / 环境反射。<br>反射环境只来自合成封面，未读取桌面或摄像头。</p><code>384² 画布 · 512² 封面 · 单一 WebGL context</code></aside></html>`;
    const fixture=path.join(out,'synthetic-cards.html');fs.writeFileSync(fixture,html);
    owner=new BrowserWindow({show:false,width:1260,height:760,useContentSize:true,frame:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    owner.webContents.on('console-message',details=>{if(details.level==='error'||details.level===3)report.rendererErrors.push(details.message);});
    await owner.loadFile(fixture);const web=owner.webContents;
    web.debugger.attach('1.3');await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    const capture=async()=>{for(let attempt=0;attempt<4;attempt++){try{return await web.capturePage();}catch(error){if(!String(error.message).includes('UnknownVizError')||attempt===3)throw error;await wait(60);}}};
    const until=async(predicate,timeout=10000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;try{await web.capturePage();}catch(error){if(!String(error.message).includes('UnknownVizError'))throw error;}await wait(40);}throw new Error('Music cards condition timed out');};
    await web.executeJavaScript(`window.materialErrors=[];window.activated=[];PulseThemes.apply(document.documentElement,'electric-purple');window.cards=PulseMusicCards.create({root:document.getElementById('mount'),diagnostic:true,onActivate:item=>window.activated.push(item.id),onError:error=>window.materialErrors.push(error.message)});window.fixtureTracks=[{id:'a',title:'折光 · 合成封面 A',artist:'Synthetic material',coverURL:'pulse-music-image://fixture/a'},{id:'b',title:'流动 · 合成封面 B',artist:'Synthetic material',coverURL:'pulse-music-image://fixture/b'},{id:'c',title:'微光 · 合成封面 C',artist:'Synthetic material',coverURL:'pulse-music-image://fixture/c'},{id:'d',title:'合成封面 D',coverURL:'pulse-music-image://fixture/d'},{id:'e',title:'合成封面 E',coverURL:'pulse-music-image://fixture/e'}];cards.update(fixtureTracks);`);
    check('inertBeforeActivation',await web.executeJavaScript(`cards.getState().gpuContexts===0&&!cards.getState().pendingFrame&&!document.querySelector('.music-cover-fallback').getAttribute('src')`));
    await web.executeJavaScript('cards.activate()');
    await until(()=>web.executeJavaScript(`cards.getState().renderer==='webgl'&&!cards.getState().pendingFrame`));
    const initial=await web.executeJavaScript('cards.inspectGPU()');
    check('realShaderLinked',initial.ready&&initial.linked&&initial.error===0);
    check('bothActualTexturesBound',initial.texturesBound.length===2&&initial.texturesBound.every(Boolean));
    check('boundedCanvasAndTexture',initial.width<=384&&initial.height<=384&&initial.textureLimit===512&&initial.maxTextureSize>=512);
    check('singleActualContext',await web.executeJavaScript(`cards.getState().gpuContexts===1&&document.querySelectorAll('canvas').length===1`));
    const pixelStats=data=>{let opaque=0,sum=0;const colors=new Set();for(let at=0;at<data.length;at+=4){if(data[at+3]>240){opaque++;sum+=data[at]+data[at+1]+data[at+2];colors.add((data[at]>>3)+'/'+(data[at+1]>>3)+'/'+(data[at+2]>>3));}}return {opaque,mean:opaque?sum/(opaque*3):0,colors:colors.size};};
    report.metrics.gpu={width:initial.width,height:initial.height,maxTextureSize:initial.maxTextureSize,texturesBound:initial.texturesBound,linked:initial.linked,...pixelStats(initial.pixels)};
    check('actualCoverPixelsVisible',report.metrics.gpu.opaque>initial.width*initial.height*.85&&report.metrics.gpu.mean>65&&report.metrics.gpu.colors>60);
    await web.executeJavaScript(`window.syntheticPointer=(type,x,y,time=performance.now())=>{const front=document.querySelector('.music-cover-front');const event=new PointerEvent(type,{clientX:x,clientY:y,button:0,pointerId:1,pointerType:'mouse',isPrimary:true,bubbles:true,cancelable:true});Object.defineProperty(event,'timeStamp',{value:time});front.dispatchEvent(event);};window.frontBox=()=>{const b=document.querySelector('.music-cover-front').getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height};};const b=frontBox();syntheticPointer('pointermove',b.left+b.width*.9,b.top+b.height*.2);`);
    await until(()=>web.executeJavaScript('!cards.getState().pendingFrame'));
    const tilted=await web.executeJavaScript('cards.inspectGPU()');let bodySum=0,edgeSum=0,bodyCount=0,edgeCount=0;
    for(let y=0;y<initial.height;y++)for(let x=0;x<initial.width;x++){
      const at=(y*initial.width+x)*4;if(initial.pixels[at+3]<240||tilted.pixels[at+3]<240)continue;
      const diff=(Math.abs(initial.pixels[at]-tilted.pixels[at])+Math.abs(initial.pixels[at+1]-tilted.pixels[at+1])+Math.abs(initial.pixels[at+2]-tilted.pixels[at+2]))/3;
      const depth=Math.min(x,y,initial.width-1-x,initial.height-1-y);if(depth<initial.width*.045){edgeSum+=diff;edgeCount++;}else if(depth>initial.width*.2){bodySum+=diff;bodyCount++;}
    }
    report.metrics.reflection={tilt:tilted.tilt,edgeMeanDifference:edgeSum/Math.max(1,edgeCount),bodyMeanDifference:bodySum/Math.max(1,bodyCount)};
    check('pointerChangesShaderReflection',Math.abs(tilted.tilt[0])>3&&Math.abs(tilted.tilt[1])>2&&report.metrics.reflection.edgeMeanDifference>.6);
    check('bevelReflectsMoreThanClearBody',report.metrics.reflection.edgeMeanDifference>report.metrics.reflection.bodyMeanDifference*1.4);
    const uploads=await web.executeJavaScript('cards.getState().uploads');await wait(180);check('idleStopsFramesAndUploads',await web.executeJavaScript(`!cards.getState().pendingFrame&&cards.getState().uploads===${uploads}`));
    const leave=()=>web.executeJavaScript(`syntheticPointer('pointerleave',0,0)`);await leave();await until(()=>web.executeJavaScript('!cards.getState().pendingFrame'));
    for(const width of [960,1260]){
      owner.setContentSize(width,760);await wait(120);await until(()=>web.executeJavaScript('!cards.getState().pendingFrame'));
      const layout=await web.executeJavaScript(`(()=>{const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {front:rect(document.querySelector('.music-cover-front')),second:rect(document.querySelector('.music-cover-second')),third:rect(document.querySelector('.music-cover-third')),fourth:rect(document.querySelector('.music-cover-fourth')),fifth:rect(document.querySelector('.music-cover-fifth')),root:rect(document.getElementById('mount')),theme:document.documentElement.dataset.interfaceTheme};})()`);
      check('staggeredUpperRightEdges'+width,layout.second.right>layout.front.right+5&&layout.third.right>layout.second.right+5&&layout.second.top<layout.front.top-5&&layout.third.top<layout.second.top-5);
      check('upperEdgesNotClipped'+width,layout.fifth.top>=layout.root.top&&layout.fifth.right<=layout.root.right&&Math.abs(layout.fifth.right-layout.root.right)<2&&layout.front.bottom<=layout.root.bottom-15);
      check('savedPalettePreserved'+width,layout.theme==='electric-purple');report.metrics['layout'+width]=layout;
      await capture();await wait(40);fs.writeFileSync(path.join(out,'cards-'+width+'.png'),(await capture()).toPNG());
    }
    await web.executeJavaScript(`(()=>{const b=frontBox(),now=performance.now();syntheticPointer('pointerdown',b.left+5,b.top+b.height*.5,now);syntheticPointer('pointermove',b.left-b.width*.35,b.top+b.height*.5,now+80);syntheticPointer('pointerup',b.left-b.width*.35,b.top+b.height*.5,now+100);})()`);
    await until(()=>web.executeJavaScript(`cards.getState().order[0]==='b'&&!cards.getState().pendingFrame`));check('edgeSwipeCyclesExactlyOnce',await web.executeJavaScript(`JSON.stringify(cards.getState().order)===JSON.stringify(['b','c','d','e','a'])&&activated.length===0`));
    await web.executeJavaScript(`(()=>{const b=frontBox(),now=performance.now(),x=b.left+b.width*.5,y=b.top+b.height*.5;syntheticPointer('pointerdown',x,y,now);syntheticPointer('pointermove',x+b.width*.4,y,now+80);syntheticPointer('pointerup',x+b.width*.4,y,now+100);})()`);
    await until(()=>web.executeJavaScript(`cards.getState().order[0]==='a'&&!cards.getState().pendingFrame`));check('centerRightSwipeReversesSmoothly',await web.executeJavaScript(`JSON.stringify(cards.getState().order)===JSON.stringify(['a','b','c','d','e'])&&activated.length===0`));
    await web.executeJavaScript(`(()=>{const b=frontBox(),now=performance.now(),x=b.left+b.width*.5,y=b.top+b.height*.5;syntheticPointer('pointerdown',x,y,now);syntheticPointer('pointermove',x-b.width*.4,y,now+80);syntheticPointer('pointerup',x-b.width*.4,y,now+100);})()`);
    await until(()=>web.executeJavaScript(`cards.getState().order[0]==='b'&&!cards.getState().pendingFrame`));check('centerLeftSwipeCyclesSmoothly',true);
    await web.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(60);
    await web.executeJavaScript(`(()=>{const b=frontBox(),now=performance.now();syntheticPointer('pointerdown',b.left+5,b.top+b.height*.5,now);syntheticPointer('pointermove',b.left-b.width*.35,b.top+b.height*.5,now+80);syntheticPointer('pointerup',b.left-b.width*.35,b.top+b.height*.5,now+100);})()`);
    check('reducedMotionIsImmediate',await web.executeJavaScript(`cards.getState().order[0]==='c'&&!cards.getState().pendingFrame`));web.debugger.detach();
    await until(()=>web.executeJavaScript(`cards.getState().renderer==='webgl'`));
    await web.executeJavaScript(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));`);
    check('hiddenReleasesResources',await web.executeJavaScript(`cards.getState().gpuContexts===0&&!cards.getState().pendingFrame&&document.querySelectorAll('canvas').length===0&&[...document.querySelectorAll('.music-cards img')].every(img=>!img.getAttribute('src'))`));
    await web.executeJavaScript(`delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));`);await until(()=>web.executeJavaScript(`cards.getState().renderer==='webgl'&&!cards.getState().pendingFrame`));
    await web.executeJavaScript('cards.deactivate()');check('deactivateReleasesResources',await web.executeJavaScript('cards.getState().gpuContexts===0&&!cards.getState().pendingFrame'));
    await web.executeJavaScript('cards.dispose()');check('disposeRemovesOwnedDOM',await web.executeJavaScript('cards.getState().disposed&&document.getElementById("mount").children.length===0'));
    report.materialErrors=await web.executeJavaScript('materialErrors');check('noMaterialOrRendererErrors',report.materialErrors.length===0&&report.rendererErrors.length===0);
  }catch(error){report.error=error.stack||String(error);}
  finally{owner?.destroy();await protocol.unhandle('pulse-music-image');save();app.quit();}
  if(report.error)process.exitCode=1;
}

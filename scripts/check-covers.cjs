'use strict';
// Isolated, anonymous CDN / actual Chromium decode check. Never opens a window
// or reads the real Agent Pulse profile. Reports sizes, not image URLs.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const workspace=path.resolve(__dirname,'..'),arg=name=>{const at=process.argv.indexOf('--'+name);return at>=0?process.argv[at+1]:null;};
const root=path.resolve(arg('root')||workspace),out=path.resolve(arg('output')||path.join(workspace,'artifacts/v0.3.17-covers')),baseline=path.join(workspace,'release/win-unpacked/resources/app.asar');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runner(){
  fs.mkdirSync(out,{recursive:true});const {spawn}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const exit=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[__filename,'--covers-child','--root',root,'--output',out],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});const timer=setTimeout(()=>{child.kill();reject(new Error('Cover check timed out'));},120000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});child.once('error',error=>{clearTimeout(timer);reject(error);});});
  const report=JSON.parse(fs.readFileSync(path.join(out,'covers-report.json'),'utf8'));console.log(JSON.stringify({passed:exit===0&&!report.error,checks:report.checks,benchmark:report.benchmark,output:out}));if(exit!==0||report.error)process.exitCode=1;
}
async function child(){
  const {app,BrowserWindow,protocol,net}=require('electron');fs.mkdirSync(out,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(out,'profile-')));
  protocol.registerSchemesAsPrivileged([{scheme:'pulse-cover-check',privileges:{standard:true,secure:true,corsEnabled:true,supportFetchAPI:true}}]);
  const report={checkedAt:new Date().toISOString(),root,anonymous:true,checks:{},benchmark:{},rendererErrors:[]},check=(key,value)=>{report.checks[key]=!!value;if(!value)throw new Error('Cover check failed: '+key);};let owner,service,images;
  const save=()=>fs.writeFileSync(path.join(out,'covers-report.json'),JSON.stringify(report,null,2));
  try{
    await app.whenReady();service=require(path.join(root,'src/music/index.cjs')).createMusicService({fetchImpl:(url,options)=>net.fetch(url,{...options,credentials:'omit'})});
    const home=await service.home(),covers=[...new Set(home.playlists.map(item=>item.coverURL).filter(Boolean))].slice(0,6);check('sixAnonymousCoverURLs',covers.length===6);
    const measure=async(label,modulePath)=>{
      let requests=0,bytes=0;const start=Date.now(),factory=require(modulePath),instance=factory.createMusicImages({fetchImpl:async(url,options)=>{requests++;const response=await net.fetch(url,options);const buffer=await response.arrayBuffer();bytes+=buffer.byteLength;return new Response(buffer,{status:response.status,headers:response.headers});}});
      const load=async()=>{for(const url of covers){const response=await instance.handle(new Request('pulse-cover-check://image?url='+encodeURIComponent(url)));if(response.status!==200)throw new Error(label+' cover response '+response.status);await response.arrayBuffer();}};
      await load();const cold={requests,bytes,ms:Date.now()-start},warmStart=Date.now();await load();const warm={requests:requests-cold.requests,bytes:bytes-cold.bytes,ms:Date.now()-warmStart};instance.dispose();return {cold,warm};
    };
    if(fs.existsSync(baseline)&&baseline!==root){try{report.benchmark.installed=await measure('installed',path.join(baseline,'src/music-images.cjs'));}catch(error){report.benchmark.installed={unavailable:String(error.message).slice(0,120)};}}
    report.benchmark.current=await measure('current',path.join(root,'src/music-images.cjs'));
    check('currentWarmCacheAvoidsDownloads',report.benchmark.current.warm.requests===0&&report.benchmark.current.warm.bytes===0);
    images=require(path.join(root,'src/music-images.cjs')).createMusicImages({fetchImpl:(url,options)=>net.fetch(url,options)});protocol.handle('pulse-cover-check',request=>images.handle(request));
    const local=file=>pathToFileURL(path.join(root,file)).href,urls=covers.map(url=>'pulse-cover-check://image?url='+encodeURIComponent(url));
    const html=`<!doctype html><meta charset="utf-8"><title>Anonymous cover decode</title><script src="${local('ui/cover-loading.js')}" defer></script><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#101020;color:#eee;font:16px system-ui}#root{display:grid;grid-template-columns:repeat(4,160px);gap:18px}img{width:160px;height:160px;display:block;border-radius:18px;background:#262636}span{display:block;width:160px;height:160px}.distant{margin-top:1900px}</style><h1>匿名封面 · 首屏与邻近预加载</h1><div id="root">${urls.slice(0,4).map((url,index)=>`<span><img data-cover data-cover-src="${url}" ${index===0?'data-cover-priority="high"':''} width="160" height="160"></span>`).join('')}<span class="distant"><img data-cover data-cover-src="${urls[4]}" width="160" height="160"></span></div>`;
    const fixture=path.join(out,'cover-fixture.html');fs.writeFileSync(fixture,html);owner=new BrowserWindow({show:false,width:800,height:500,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const web=owner.webContents;web.on('console-message',details=>{if(details.level==='error'||details.level===3)report.rendererErrors.push(details.message);});await owner.loadFile(fixture);
    const capture=async()=>{for(let i=0;i<5;i++){try{return await web.capturePage();}catch(error){if(!String(error.message).includes('UnknownVizError')||i===4)throw error;await wait(50);}}};
    const until=async predicate=>{const start=Date.now();while(Date.now()-start<25000){if(await predicate())return;await capture();await wait(60);}throw new Error('Cover decode condition timed out');};
    await web.executeJavaScript("window.loader=PulseCoverLoading.create({root:document.getElementById('root')});loader.activate();");
    await until(()=>web.executeJavaScript("[...document.querySelectorAll('img')].slice(0,4).every(img=>img.complete&&img.naturalWidth>0)"));
    check('firstScreenDecoded',await web.executeJavaScript("[...document.querySelectorAll('img')].slice(0,4).every(img=>!img.hidden&&getComputedStyle(img).display!=='none'&&img.getBoundingClientRect().width===160&&img.naturalWidth>0)"));
    check('distantCoverNotRequested',await web.executeJavaScript("!document.querySelector('.distant img').hasAttribute('src')"));
    await capture();await wait(120);const shot=await capture();fs.writeFileSync(path.join(out,'covers-first-screen.png'),shot.toPNG());
    const bitmap=shot.toBitmap(),size=shot.getSize(),colors=new Set();for(let y=100;y<220;y+=7)for(let x=28;x<180;x+=7){const at=(y*size.width+x)*4;colors.add(bitmap[at]+','+bitmap[at+1]+','+bitmap[at+2]);}report.visibleCoverColors=colors.size;check('actualCoverPixelsVisible',colors.size>40);
    await web.executeJavaScript("window.scrollTo(0,1900)");await until(()=>web.executeJavaScript("(()=>{const img=document.querySelector('.distant img');return img.complete&&img.naturalWidth>0})()"));check('lookAheadLoadsAfterScroll',true);
    await web.executeJavaScript("loader.dispose()");check('disposeClearsTrackedImages',await web.executeJavaScript('loader.getStatus().tracked===0'));check('windowAlwaysHidden',!owner.isVisible());check('noRendererErrors',report.rendererErrors.length===0);save();
  }catch(error){report.error=String(error.message).replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,240);save();process.exitCode=1;}
  finally{owner?.destroy();images?.dispose();await service?.dispose();app.quit();}
}
if(process.argv.includes('--covers-child'))child();else runner().catch(error=>{console.error(error.message);process.exitCode=1;});

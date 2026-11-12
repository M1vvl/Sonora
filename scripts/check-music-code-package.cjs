'use strict';
// Code-only package verification. No BrowserWindow, GPU, audio, real account,
// catalog request, screenshot or non-music UI inspection is performed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const workspace=path.resolve(__dirname,'..');
const arg=name=>{const index=process.argv.indexOf('--'+name);return index<0?null:process.argv[index+1];};
const root=path.resolve(arg('root')||workspace),reportPath=path.resolve(arg('report')||path.join(workspace,'artifacts/v021-music-code-report.json'));
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
async function run(){
  const {app}=require('electron');
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  app.disableHardwareAcceleration();app.setPath('userData',fs.mkdtempSync(path.join(path.dirname(reportPath),'code-profile-')));
  await app.whenReady();
  const report={version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,scope:'music-island-and-settings-code-only',interaction:{},files:[],skipped:['music and island visual acceptance','monitor','anime','movies','video player'],errors:[]};
  function check(key,value){report.interaction[key]=!!value;if(!value)throw new Error(key);}
  try{
    const relativeFiles=[];
    function collect(relative){if(relative.replaceAll('\\','/')==='assets/music/source-presets/assets/skull-decimation-points.bin')return;const file=path.join(workspace,relative);if(fs.statSync(file).isDirectory())for(const name of fs.readdirSync(file))collect(path.join(relative,name));else relativeFiles.push(relative);}
    for(const relative of ['ui/music','src/music','src/music-visual','assets/music/source-presets','assets/music/provider-sdk/qishui'])collect(relative);
    for(const relative of ['src/music-bridge.cjs','src/preload.cjs','src/music-images.cjs','src/music-stream.cjs','ui/themes.js','ui/themes.css','ui/dashboard.html','ui/dashboard.js','ui/dashboard-material.js','ui/dashboard-material.css','ui/dashboard-grain.svg','src/dashboard-shape.cjs','src/dashboard-fullscreen.cjs','src/dashboard-readiness.cjs','src/surface-recovery.cjs','src/dashboard-lifecycle.cjs','src/dashboard-material.cjs','ui/glass-select.css','ui/cover-palette.js','src/main.cjs','src/settings.cjs','src/island-autohide.cjs','src/media/index.cjs','src/media-selection.cjs','src/media-lyrics.cjs','src/glass-appearance.cjs','src/refraction.cjs','src/refraction-map.cjs','ui/island.js','ui/island.html','ui/island.css','ui/island-music.js','ui/island-music.css','ui/island-drag.css','ui/media-cover.js','ui/liquid-edge.js'])relativeFiles.push(relative);
    relativeFiles.push('assets/icon.png','assets/icon.ico','src/liquid-glass.cjs','ui/veyra-glass.js','ui/veyra-glass.css');
    for(const relative of relativeFiles){
      const source=fs.readFileSync(path.join(workspace,relative)),packed=fs.readFileSync(path.join(root,relative));
      check('matching_'+relative.replaceAll('\\','/'),hash(source)===hash(packed));
      if(/\.(?:js|cjs)$/.test(relative)){
        const code=packed.toString('utf8');new vm.Script(relative.endsWith('.cjs')?'(function(require,module,exports,__dirname,__filename){'+code+'\n})':code,{filename:relative});
      }
      report.files.push({path:relative.replaceAll('\\','/'),sha256:hash(packed),bytes:packed.length});
    }
    const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    const main=fs.readFileSync(path.join(root,'src/main.cjs'),'utf8');
    // electron-builder removes development-only build configuration from the
    // installed manifest. Verify runtime identity instead of requiring it.
    check('sonaraProductIdentity',metadata.name==='sonara'&&metadata.author==='Sonara'&&main.includes("app.setName('Sonara')"));
    check('renamePreservesExistingProfile',main.includes("app.setAppUserModelId('local.agentpulse.desktop')")&&main.includes("path.join(app.getPath('appData'),'Agent Pulse')")&&main.includes("app.setPath('userData',profileDirectory)"));
    const brandPNG=fs.readFileSync(path.join(root,'assets/icon.png'));
    const brandICO=fs.readFileSync(path.join(root,'assets/icon.ico'));
    const iconSizes=Array.from({length:brandICO.readUInt16LE(4)},(_,index)=>brandICO[6+index*16]||256);
    check('sonaraArtworkHasWindowsSizes',brandPNG.readUInt32BE(16)>=256&&brandPNG.readUInt32BE(20)>=256&&[16,32,48,256].every(size=>iconSizes.includes(size)));
    check('musicFilesAndSourceSyntax',report.files.length>50);
    const model=require(path.join(root,'ui/music/visual-settings.js'));
    check('retainedSourcePresetControls',model.PRESETS.length===2&&model.PRESETS.includes('cover')&&model.PRESETS.includes('topography')&&!Object.hasOwn(model.FIELDS,'interface'));
    const sourceManifest=JSON.parse(fs.readFileSync(path.join(root,'assets/music/source-presets/source-manifest.json'),'utf8'));
    check('unchangedOriginalSonicModules',sourceManifest.sonicPorts.length===2&&sourceManifest.sonicPorts.every(row=>
      row.adaptation==='unchanged'&&hash(fs.readFileSync(path.join(root,'assets/music/source-presets',row.path)))===row.sha256));
    check('pureThemeOptionRemoved',!Object.hasOwn(model.normalize(),'stageStyle')&&!fs.readFileSync(path.join(root,'ui/music/immersive.js'),'utf8').includes('纯主题'));
    check('lyricFontDefault',model.normalize().fontSize===20);
    check('transportGlassDefault',model.normalize().transportGlass===.2);
    const normalized=model.normalize();
    check('everyVisibleControlHasNormalizedState',Object.values(model.FIELDS).flat().every(row=>Object.hasOwn(normalized,row[1])));
    const scaled=model.normalize({visualScale:90,lyricScale:-9});
    check('independentBoundedSceneAndLyricScale',scaled.visualScale===1.65&&scaled.lyricScale===.55);
    const music=require(path.join(root,'src/music/playback-state.cjs'));
    const sample=music.normalize({song:{id:'1',title:'Synthetic',artist:'Test',duration:300,audioURL:'https://forbidden.invalid/audio'},position:72,queue:[{id:'1',name:'Synthetic'},{id:'2',name:'Next'}],mode:'shuffle'});
    check('resumeIsMetadataOnly',sample.song.id==='1'&&sample.position===72&&sample.queue.length===2&&sample.mode==='shuffle'&&!JSON.stringify(sample).includes('forbidden'));
    check('fourModesPersist',require(path.join(root,'ui/music/queue.js')).MODES.every(mode=>music.normalize({mode}).mode===mode));
    const dashboard=fs.readFileSync(path.join(root,'ui/dashboard.html'),'utf8');
    check('sharedModulesIncluded', ['lyric-motion.js','immersive-transport.js','playback-session.js','interaction-policy.js'].every(file=>dashboard.includes('music/'+file)));
    check('removedVisualFeaturesAbsent',['ui/music/visual-studio.js','ui/music/source-preset-bridge.js','assets/music/source-presets/workshop.html','assets/music/source-presets/topography.html','src/music-visual/engine.cjs','src/music-visual/media.cjs'].every(file=>!fs.existsSync(path.join(root,file))));
    if(root!==workspace)check('removedBinaryResourcesExcluded',['assets/music/source-presets/assets/skull-decimation-points.bin',...['planet','record','ripple','stars','tranquil','tunnel','void'].map(name=>'assets/music/presets/'+name+'.png')].every(file=>!fs.existsSync(path.join(root,file))));
    check('noWindowConstructed',require('electron').BrowserWindow.getAllWindows().length===0);
  }catch(error){report.errors.push(String(error.stack||error));process.exitCode=1;}
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({version:report.version,checks:Object.keys(report.interaction).length,failed:Object.keys(report.interaction).filter(key=>!report.interaction[key]),errors:report.errors,report:reportPath}));app.exit(process.exitCode||0);
}
if(process.argv.includes('--code-child'))run().catch(error=>{console.error(error.stack);require('electron').app.exit(1);});
else{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename,'--code-child','--root',root,'--report',reportPath],{cwd:workspace,env,windowsHide:true,stdio:'inherit'});
  const timer=setTimeout(()=>{child.kill();process.exitCode=1;},30000);child.on('exit',code=>{clearTimeout(timer);process.exitCode=code??1;});
}

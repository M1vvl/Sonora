'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');

test('fresh media profiles bootstrap bundled providers without Kazumi, LibreTV, Docker or network setup',async t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-portable-profile-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  let requests=0;const fetchImpl=async()=>{requests++;throw new Error('Bootstrap must not need a server or source tree');};
  const anime=require('../src/anime/index.cjs').createAnimeService({dataDir:path.join(temporary,'anime'),installedRulesPath:path.join(temporary,'absent-kazumi','plugins.json'),fetchImpl});
  const movies=require('../src/movies/index.cjs').createMoviesService({dataDir:path.join(temporary,'movies'),fetchImpl});
  t.after(async()=>{await anime.dispose();await movies.dispose();});
  const animeBootstrap=await anime.request('bootstrap'),movieBootstrap=await movies.request('bootstrap');
  assert.equal(animeBootstrap.rules.length,18);assert.equal(animeBootstrap.importedFrom,'bundled-kazumi-rules');assert.equal(animeBootstrap.history.length,0);
  assert.equal(movieBootstrap.rules.length,6);assert.equal(movieBootstrap.history.length,0);assert(movieBootstrap.rules.every(source=>source.enabled!==false&&/^https:\/\//.test(source.url||source.baseURL)));
  assert.equal(requests,0);assert.equal(new Set(movieBootstrap.rules.map(source=>source.id)).size,6);
  assert(movieBootstrap.categories.includes('电影'));assert(movieBootstrap.categories.includes('电视剧'));
});

function coveredResource(source){
  const absolute=path.resolve(root,source);
  return pkg.build.extraResources.some(entry=>{const from=path.resolve(root,entry.from);return absolute===from||absolute.startsWith(from+path.sep);});
}
test('the portable build includes native engines, algorithms, data defaults and upstream license files',()=>{
  for(const source of ['src/**/*','ui/**/*','config/**/*','assets/**/*'])assert(pkg.build.files.includes(source),`Missing packed application tree ${source}`);
  for(const file of ['src/anime/default-rules.json','src/movies/default-sources.cjs'])assert(fs.statSync(path.join(root,file)).isFile());
  const resources=['native/audio/bin/AgentPulse.AudioProbe.exe','native/media/bin/AgentPulse.MediaProbe.exe','native/player/bin/AgentPulse.Player.exe','native/player/resources/libmpv-2.dll','native/ech/ech_http.dll','assets/licenses/LibreTV-AGPL-3.0.txt','assets/licenses/Kazumi-GPL-3.0.txt','assets/licenses/Anime4K-MIT.txt'];
  for(const source of resources){assert(fs.statSync(path.join(root,source)).size>0,`Missing runtime ${source}`);assert(coveredResource(source),`Runtime resource not copied into portable ${source}`);}
  const shaders=fs.readdirSync(path.join(root,'native/player/resources/shaders')).filter(name=>name.endsWith('.glsl'));assert(shaders.length>=12);for(const target of ['1080p','1440p','2160p'])assert(shaders.includes('AgentPulse_Output_'+target+'.glsl'));for(const shader of shaders)assert(coveredResource('native/player/resources/shaders/'+shader));
  assert(pkg.build.extraResources.some(entry=>entry.to==='corresponding-source.zip'));
});

function peImports(file){
  const bytes=fs.readFileSync(file),pe=bytes.readUInt32LE(0x3c);assert.equal(bytes.toString('ascii',pe,pe+4),'PE\0\0');
  const machine=bytes.readUInt16LE(pe+4),count=bytes.readUInt16LE(pe+6),optionalSize=bytes.readUInt16LE(pe+20),optional=pe+24,magic=bytes.readUInt16LE(optional),directory=optional+(magic===0x20b?112:96),rva=bytes.readUInt32LE(directory+8),sections=optional+optionalSize;
  function offset(address){for(let index=0;index<count;index++){const section=sections+index*40,size=bytes.readUInt32LE(section+8),base=bytes.readUInt32LE(section+12),rawSize=bytes.readUInt32LE(section+16),raw=bytes.readUInt32LE(section+20);if(address>=base&&address<base+Math.max(size,rawSize))return raw+address-base;}return address;}
  const names=[];if(rva){let descriptor=offset(rva);while(bytes.subarray(descriptor,descriptor+20).some(byte=>byte)){const name=offset(bytes.readUInt32LE(descriptor+12)),end=bytes.indexOf(0,name);assert(end>name&&end-name<256,'Malformed native import');names.push(bytes.toString('ascii',name,end).toLowerCase());descriptor+=20;assert(names.length<200);}}
  return {machine,names};
}
test('bundled media DLLs have no unbundled external C++ runtime or application dependency',()=>{
  const windows=new Set(['advapi32.dll','avicap32.dll','avrt.dll','bcrypt.dll','crypt32.dll','dwmapi.dll','gdi32.dll','imm32.dll','iphlpapi.dll','kernel32.dll','ntdll.dll','ole32.dll','oleaut32.dll','opengl32.dll','shcore.dll','shell32.dll','shlwapi.dll','user32.dll','uxtheme.dll','version.dll','ws2_32.dll']);
  for(const source of ['native/player/resources/libmpv-2.dll','native/ech/ech_http.dll']){
    const result=peImports(path.join(root,source));assert.equal(result.machine,0x8664,source+' must match the Windows x64 package');assert(result.names.length>0);
    for(const name of result.names)assert(windows.has(name)||/^api-ms-win-(?:core|crt)-[a-z0-9-]+\.dll$/.test(name),`${source} requires an unbundled external DLL: ${name}`);
  }
});

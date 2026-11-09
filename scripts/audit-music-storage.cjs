'use strict';
// Music-only audit. No account state, browser cookies, source or unrelated
// media files are read. Deletion needs --apply and is limited to verified
// Agent Pulse music test audio or HTTP-cache entries keyed by our audio scheme.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const workspace=path.resolve(__dirname,'..'),artifacts=path.join(workspace,'artifacts');
const output=path.join(artifacts,'v0.3.18-music-storage');
const formal=path.resolve(process.env.APPDATA||'', 'Agent Pulse');
const apply=process.argv.includes('--apply');
const inside=(value,root)=>{const relative=path.relative(root,value);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
function walk(root,visit){if(!fs.existsSync(root))return;for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())walk(file,visit);else if(entry.isFile())visit(file);}}
const candidates=[],seen=new Set();let audioExtensions=0,cacheFiles=0,cacheReadBytes=0,skippedUnreadable=0;
const scopes=[{root:artifacts,kind:'isolated-artifact'},{root:formal,kind:'formal-agent-pulse'}];
for(const scope of scopes)walk(scope.root,file=>{
  if(!inside(file,scope.root))throw new Error('Audit path escaped its scope');
  const relative=path.relative(scope.root,file),parts=relative.split(path.sep),inCache=parts.some(part=>['Cache_Data','Media Cache'].includes(part));
  // Audio extensions count as diagnostic samples only under a music-specific
  // artifact directory. A user's songs, native-player videos and source files
  // are outside this boundary, including public NodeAPI examples.
  const extension=/\.(?:mp3|flac|m4a|ogg|wav|aac|opus)$/i.test(file);
  const musicTest=scope.kind==='isolated-artifact'&&parts.some(part=>/music/i.test(part));
  if(extension&&musicTest){audioExtensions++;add(file,scope.kind,'music-test-audio-extension');return;}
  if(!inCache)return;
  cacheFiles++;
  try{
    const stat=fs.statSync(file),size=Math.min(stat.size,512*1024),buffer=Buffer.alloc(size),fd=fs.openSync(file,'r');
    try{fs.readSync(fd,buffer,0,size,0);}finally{fs.closeSync(fd);}
    cacheReadBytes+=size;
    const value=buffer.toString('latin1');
    if(value.includes('pulse-music-audio://')&&(/audio\/(?:mpeg|mp3|wav|flac|ogg|aac|mp4|opus)/i.test(value)||buffer.includes(Buffer.from('RIFF'))))add(file,scope.kind,'our-audio-scheme-and-audio-type');
  }catch{skippedUnreadable++;}
});
function add(file,scope,reason){if(seen.has(file))return;seen.add(file);const bytes=fs.readFileSync(file);candidates.push({path:file,scope,reason,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
fs.mkdirSync(output,{recursive:true});
const report={checkedAt:new Date().toISOString(),scope:scopes.map(value=>value.root),apply,audioExtensions,cacheFiles,cacheReadBytes,skippedUnreadable,candidates,removed:[],preserved:['account credentials','cookies and local/session storage','images','source and REA evidence','native video fixtures','other music applications'],readPolicy:'Only file names and bounded HTTP cache entry bytes are inspected; cache entry content is never printed'};
const manifest=path.join(output,'before-cleanup.json');
fs.writeFileSync(manifest,JSON.stringify(report,null,2)+'\n');
if(apply)for(const item of candidates){
  const root=item.scope==='isolated-artifact'?artifacts:formal;
  if(!inside(item.path,root))throw new Error('Unsafe cleanup path');
  const bytes=fs.readFileSync(item.path),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(hash!==item.sha256)throw new Error('Candidate changed during audit');
  fs.unlinkSync(item.path);report.removed.push({path:item.path,bytes:item.bytes});
}
fs.writeFileSync(path.join(output,'storage-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,apply,audioExtensions,cacheFiles,skippedUnreadable,candidates:candidates.length,removed:report.removed.length}));

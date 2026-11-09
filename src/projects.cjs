'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function normalizeRoot(value){return String(value||'').replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\/,'').replace(/[\\/]+/g,'/').replace(/\/$/,'').toLowerCase();}
function findStateDatabase(codexHome){try{const names=fs.readdirSync(codexHome).filter(name=>/^state_\d+\.sqlite$/.test(name)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));return names.length?path.join(codexHome,names[0]):null;}catch{return null;}}
function readGlobal(codexHome){try{return JSON.parse(fs.readFileSync(path.join(codexHome,'.codex-global-state.json'),'utf8'));}catch{return null;}}
function readProjectCatalog(codexHome,db=null,global=readGlobal(codexHome)){
 const local=global?.['local-projects']||{},order=Array.isArray(global?.['project-order'])?global['project-order']:[],legacyIds=[...new Set([...order,...Object.keys(local)])];
 let projects=legacyIds.filter(id=>local[id]).map(id=>({id,name:String(local[id].name||local[id].label||'未命名项目'),roots:(Array.isArray(local[id].rootPaths)?local[id].rootPaths:[]).filter(x=>typeof x==='string'&&x)}));
 let available=!!global&&Object.hasOwn(global,'local-projects'),source=available?'desktop-global-state':'unavailable';
 if(db)try{const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));if(tables.has('projects')&&tables.has('project_roots')){
  const roots=db.prepare('SELECT project_id,path FROM project_roots ORDER BY position').all();projects=db.prepare('SELECT id,name FROM projects ORDER BY position').all().map(p=>({id:String(p.id),name:String(p.name||'未命名项目'),roots:roots.filter(r=>r.project_id===p.id&&typeof r.path==='string').map(r=>r.path)}));available=true;source='desktop-sqlite-projects';
 }}catch{}
 const ids=new Set(projects.map(x=>x.id)),migration={};
 for(const map of Object.values(global?.['app-server-project-id-by-legacy-project-id-by-host']||{}))if(map&&typeof map==='object')for(const [oldId,newId]of Object.entries(map))if(ids.has(newId))migration[oldId]=newId;
 const assignments={},excludedAssignments=new Set();
 for(const [threadId,value]of Object.entries(global?.['thread-project-assignments']||{}))if(value?.projectKind==='local'){const id=ids.has(value.projectId)?value.projectId:migration[value.projectId];if(ids.has(id))assignments[threadId]=id;else excludedAssignments.add(threadId);}
 const projectless=new Set((Array.isArray(global?.['projectless-thread-ids'])?global['projectless-thread-ids']:[]).filter(x=>typeof x==='string'));
 return {projects,assignments,excludedAssignments,projectless,available,source};
}
function loadProjects(codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')){let db;try{const file=findStateDatabase(codexHome);if(file){const {DatabaseSync}=require('node:sqlite');db=new DatabaseSync(file,{readOnly:true});}const {projects,assignments}=readProjectCatalog(codexHome,db);return {projects,assignments};}catch{const {projects,assignments}=readProjectCatalog(codexHome);return {projects,assignments};}finally{try{db?.close();}catch{}}}
module.exports={loadProjects,readProjectCatalog,findStateDatabase,normalizeRoot};

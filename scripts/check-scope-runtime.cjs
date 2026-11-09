'use strict';
// Verify the actual Electron runtime's SQLite support against a synthetic Codex
// database. No formal Codex metadata, conversation, or settings are opened.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const workspace=path.resolve(__dirname,'..'),arg=name=>{const at=process.argv.indexOf('--'+name);return at<0?null:process.argv[at+1];};
const root=path.resolve(arg('root')||workspace),output=path.resolve(arg('output')||path.join(workspace,'artifacts/hotfix-scope-runtime'));
async function runner(){
 fs.mkdirSync(output,{recursive:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--scope-runtime-child','--root',root,'--output',output],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stdout.on('data',()=>{});child.stderr.on('data',value=>{if(errors.length<3000)errors+=value;});const timer=setTimeout(()=>{child.kill();reject(new Error('Scope runtime check timed out'));},25000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error(errors||'Scope runtime check failed'));else resolve();});});
 const report=JSON.parse(fs.readFileSync(path.join(output,'scope-runtime-report.json'),'utf8'));console.log(JSON.stringify(report));
}
async function child(){
 const {app}=require('electron');fs.mkdirSync(output,{recursive:true});const profile=fs.mkdtempSync(path.join(output,'profile-'));app.setPath('userData',profile);
 const report={root,syntheticOnly:true,versions:{electron:process.versions.electron,node:process.versions.node},checks:{}};
 const save=()=>fs.writeFileSync(path.join(output,'scope-runtime-report.json'),JSON.stringify(report,null,2)),check=(name,value)=>{report.checks[name]=!!value;if(!value)throw new Error('Scope runtime failed: '+name);};
 try{
  await app.whenReady();const {DatabaseSync}=require('node:sqlite');check('electronSQLiteAvailable',typeof DatabaseSync==='function');
  const home=path.join(profile,'codex');fs.mkdirSync(home);const file=path.join(home,'state_5.sqlite'),db=new DatabaseSync(file);
  db.exec("CREATE TABLE projects(id TEXT,name TEXT,position INTEGER);CREATE TABLE project_roots(project_id TEXT,path TEXT,position INTEGER);CREATE TABLE threads(id TEXT,archived INTEGER,source TEXT,cwd TEXT,project_id TEXT);CREATE TABLE thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT);INSERT INTO projects VALUES('visible','Synthetic',0);INSERT INTO project_roots VALUES('visible','D:/synthetic',0);INSERT INTO threads VALUES('main',0,'vscode','D:/synthetic',NULL),('archived',1,'vscode','D:/synthetic',NULL),('outside',0,'vscode','D:/not-visible',NULL);");db.close();
  const digest=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=digest();
  const scope=require(path.join(root,'src/codex-scope.cjs')).readCodexScope(home);
  check('packagedScopeUsesIndexedSQLite',scope.indexed&&scope.indexWarning===null&&scope.rows.length===3);
  check('visibleMainIncluded',scope.reason({id:'main',agent:'Codex'})===null);
  check('archivedExcluded',scope.reason({id:'archived',agent:'Codex'})==='archived');
  check('invisibleProjectExcluded',scope.reason({id:'outside',agent:'Codex'})==='outside-visible-projects');
  check('scopeReadPreservesDatabase',before===digest());save();app.quit();
 }catch(error){report.error=String(error.stack||error).slice(0,1600);save();console.error(report.error);app.exit(1);}
}
if(process.argv.includes('--scope-runtime-child'))child();else runner().catch(error=>{console.error(error.stack);process.exitCode=1;});

'use strict';
const {readProjectCatalog,findStateDatabase,normalizeRoot}=require('./projects.cjs');
const GRACE_MS=120000;

function sourceInfo(value){
  let source=value;
  if(typeof source==='string')try{source=JSON.parse(source);}catch{}
  const sub=source&&typeof source==='object'?source.subagent:null;
  return {subagent:!!sub||source==='subagent',guardian:!!sub&&!sub.thread_spawn,parent:sub?.thread_spawn?.parent_thread_id||null};
}

function readCodexScope(codexHome){
  let db,rows=[],indexed=false,indexWarning=null,projectCatalog;
  const file=findStateDatabase(codexHome),edges=new Map();
  try{
    if(file){const {DatabaseSync}=require('node:sqlite');db=new DatabaseSync(file,{readOnly:true});}
    projectCatalog=readProjectCatalog(codexHome,db);
    if(db){
      const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(x=>x.name));
      if(columns.has('id')){
        const fields=['id','rollout_path','title','model','cwd','updated_at','source','archived','project_id','attached_thread_parent_id'].filter(x=>columns.has(x));
        rows=db.prepare('SELECT '+fields.join(',')+' FROM threads ORDER BY id').all();
        indexed=true;
      }
    }
  }catch(error){
    indexWarning=String(error.message||error).slice(0,180);
    projectCatalog ||=readProjectCatalog(codexHome);
  }
  try{
    if(db)for(const row of db.prepare('SELECT parent_thread_id,child_thread_id FROM thread_spawn_edges').all())edges.set(row.child_thread_id,row.parent_thread_id);
  }catch{}finally{try{db?.close();}catch{}}
  const byId=new Map(rows.map(row=>[row.id,row]));

  function rootProject(cwd,projects){
    const value=normalizeRoot(cwd);
    let best=null,length=-1;
    for(const project of projects)for(const root of project.roots||[]){
      const prefix=normalizeRoot(root);
      if(prefix&&(value===prefix||value.startsWith(prefix+'/'))&&prefix.length>length){best=String(project.id);length=prefix.length;}
    }
    return best;
  }

  // Visibility and project inheritance share one decision, before either usage
  // ownership or money is aggregated. An archived parent hides its whole tree.
  function resolve(state,{projects=projectCatalog.projects,assignments=projectCatalog.assignments,now=Date.now(),statesById=new Map()}={}){
    const excluded=reason=>({reason,projectId:null});
    if(state.agent&&state.agent!=='Codex')return {reason:null,projectId:null};
    const strict=projectCatalog.available||projects.length>0,visited=new Set();
    function inspect(id,hint){
      if(visited.has(id)||visited.size>=64)return excluded('orphan-subagent');
      visited.add(id);
      const row=byId.get(id),value=row||hint||statesById.get(id);
      if(!value)return excluded('orphan-subagent');
      if(row?.archived||value.archive||value.archived||/[\\/]archived_sessions[\\/]/.test(value.file||''))return excluded('archived');
      if(projectCatalog.excludedAssignments.has(id)||projectCatalog.projectless.has(id))return excluded('outside-visible-projects');
      const info=sourceInfo(row?.source||value.source);
      if(info.guardian)return excluded('internal-agent');
      if(info.subagent||value.isSubagent){
        // CLI-only installs without desktop project metadata retain their old
        // grouping. Desktop subagents must descend from a visible conversation.
        if(!strict&&!indexed)return {reason:null,projectId:null};
        const parent=info.parent||edges.get(id)||value.parentThreadId||value.parent_thread_id||value.rootSessionId;
        if(!parent||parent===id)return excluded('orphan-subagent');
        return inspect(parent,statesById.get(parent));
      }
      const explicit=row?.project_id||assignments[id];
      const explicitValid=explicit&&projects.some(p=>String(p.id)===String(explicit));
      const projectId=explicitValid?String(explicit):rootProject(row?.cwd||value.cwd,projects);
      if(!strict)return {reason:null,projectId};
      if((explicit&&!explicitValid)||!projectId)return excluded('outside-visible-projects');
      if(indexed&&!row){
        // A live rollout can precede SQLite indexing. Fresh activity in a real
        // displayed root gets a short grace period; stale hidden logs do not.
        const recent=Math.max(Number(value.mtimeMs)||0,Number(value.mtime)||0,new Date(value.updatedAt||value.startedAt||0).getTime()||0);
        if(recent<now-GRACE_MS)return excluded('not-in-desktop-index');
      }
      return {reason:null,projectId};
    }
    return inspect(state.id,state);
  }

  return {rows,byId,indexed,indexWarning,projectCatalog,sourceInfo,
    reason:(state,context)=>resolve(state,context).reason,
    projectId:(state,context)=>resolve(state,context).projectId};
}
module.exports={readCodexScope,sourceInfo,GRACE_MS};
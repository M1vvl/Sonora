'use strict';
// Isolated real-main / real-preload lifecycle check. All logs are synthetic;
// neither preferences nor conversations in the user's normal profile change.
const fs=require('node:fs'),path=require('node:path');
const workspaceRoot=path.resolve(__dirname,'..'),root=process.env.PULSE_RESTART_ROOT||workspaceRoot;
const out=path.resolve(process.env.PULSE_DASHBOARD_RESTART_OUTPUT||path.join(workspaceRoot,'artifacts/v0.3.13-dashboard-restart'));
const profile=path.join(out,'profile'),phase=process.argv.find(arg=>arg.startsWith('--dashboard-phase='))?.split('=')[1];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runner(){
  const {spawn}=require('node:child_process'),electron=require('electron');fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'dashboard-state.json'),JSON.stringify(require('../src/dashboard-state.cjs').normalizeDashboardState({version:1})));
  fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({interfaceTheme:'electric-purple',islandEnabled:true,musicReactive:false,musicCover:false,islandEdge:'off',launchAtLogin:false}));
  // Distinct roots exercise both project state and a selected child list.
  const logs=path.join(out,'codex','sessions');fs.mkdirSync(logs,{recursive:true});
  const stamp=new Date().toISOString(),line=(type,payload)=>JSON.stringify({timestamp:stamp,type,payload})+'\n';
  for(let project=0;project<14;project++)for(let chat=0;chat<3;chat++){
    const id=`fixture-${project}-${chat}`,meta={id,cwd:`D:\\Fixture Project ${project}`,timestamp:stamp};
    if(chat===2){meta.thread_source='subagent';meta.parent_thread_id=`fixture-${project}-0`;}
    let body=line('session_meta',meta)+line('response_item',{type:'message',role:'user',content:[{type:'input_text',text:`Fixture ${project}/${chat}`} ]});
    for(let event=0;event<45;event++)body+=line('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:`Synthetic test event ${event}. `+'Reading scroll restoration. '.repeat(8)}]});
    fs.writeFileSync(path.join(logs,id+'.jsonl'),body);
  }
  const run=mode=>new Promise((resolve,reject)=>{
    const env={...process.env,CODEX_HOME:path.join(out,'codex'),CLAUDE_CONFIG_DIR:path.join(out,'claude')};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(electron,[__filename,'--dashboard-phase='+mode],{cwd:workspaceRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stderr='';child.stdout.on('data',()=>{});child.stderr.on('data',data=>{if(stderr.length<32000)stderr+=data;});
    const timer=setTimeout(()=>{child.kill();reject(new Error(mode+' timed out'));},60000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);if(code)reject(new Error(mode+' failed: '+stderr));else resolve(child.pid);});
  });
  const first=await run('write'),second=await run('read');
  const write=JSON.parse(fs.readFileSync(path.join(out,'write-report.json'),'utf8')),read=JSON.parse(fs.readFileSync(path.join(out,'read-report.json'),'utf8'));
  const checks={differentMainProcesses:first!==second,normalQuit:write.normalQuit&&read.normalQuit,writeCompleted:!write.error&&Object.keys(write.checks).length===3,readCompleted:!read.error&&Object.keys(read.checks).length===6,...write.checks,...read.checks};
  fs.writeFileSync(path.join(out,'restart-report.json'),JSON.stringify({root,checkedAt:new Date().toISOString(),checks,write,read},null,2));
  console.log(JSON.stringify({checks,output:out}));if(Object.values(checks).some(value=>value!==true))process.exitCode=1;
}
async function child(){
  const {app,BrowserWindow}=require('electron');app.setPath('userData',profile);
  for(const method of ['show','showInactive','focus'])BrowserWindow.prototype[method]=function(){};
  const report={phase,pid:process.pid,normalQuit:false,checks:{}},file=path.join(out,phase+'-report.json');
  const write=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));app.once('will-quit',()=>{report.normalQuit=true;write();});
  require(path.join(root,'src/main.cjs'));
  const until=async predicate=>{for(let n=0;n<360;n++){const value=await predicate();if(value)return value;await sleep(50);}throw new Error('Dashboard lifecycle condition timed out');};
  const find=()=>BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&win.webContents.getURL().endsWith('/ui/dashboard.html')&&!win.webContents.isLoading());
  async function ready(){const win=await until(find);await until(()=>win.webContents.executeJavaScript(`typeof workspaceReady!=='undefined'&&workspaceReady&&state.snapshot?.diagnostics?.loading===false&&state.snapshot?.diagnostics?.progress===1&&state.snapshot.sessions.length===42`));return win;}
  const observe=web=>web.executeJavaScript(`({saved:workspace.capture(),selected:document.querySelector('.session-row.selected')?.dataset.session,composition:document.querySelector('.token-composition')?.open,filter:document.querySelector('[data-agent].active')?.dataset.agent,query:document.getElementById('session-search').value,range:document.querySelector('[data-range].active')?.dataset.range,mode:document.getElementById('token-activity').dataset.activityMode,scroll:{sessions:document.getElementById('sessions-list').scrollTop,events:document.querySelector('.event-list')?.scrollTop},theme:document.documentElement.dataset.interfaceTheme})`);
  try{
    await app.whenReady();let win=await ready(),web=win.webContents;
    if(phase==='write'){
      await web.executeJavaScript(`(async()=>{
        document.querySelector('[data-agent="Codex"]').click();
        for(const details of document.querySelectorAll('details[data-project]'))details.open=false;
        await new Promise(resolve=>setTimeout(resolve,30));
        const target=document.querySelector('[data-session="fixture-7-1"]');target.closest('details[data-project]').open=true;
        await new Promise(resolve=>setTimeout(resolve,30));target.click();
        const children=document.querySelector('[data-session="fixture-7-1"]').closest('details[data-project]').querySelector('details[data-subagents]');children.open=true;
        document.querySelector('[data-range="history"]').click();document.querySelector('.token-composition').open=true;
        document.querySelector('[data-activity-mode="weekly"]').click();
        await new Promise(resolve=>setTimeout(resolve,50));
        document.getElementById('sessions-list').scrollTop=120;document.querySelector('.event-list').scrollTop=180;
      })()`);
      report.before=await observe(web);
      // Close well before the 180ms save timer expires: beforeunload must flush.
      win.close();await until(()=>!find());
      report.diskAfterClose=JSON.parse(fs.readFileSync(path.join(profile,'dashboard-state.json'),'utf8'));
      const island=await until(()=>BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().endsWith('/ui/island.html')&&!item.webContents.isLoading()));
      await island.webContents.executeJavaScript('window.pulse.openDashboard()');win=await ready();web=win.webContents;await sleep(150);report.reopened=await observe(web);
      report.checks.panelCloseFlush=report.diskAfterClose.selected==='fixture-7-1'&&report.diskAfterClose.closedProjects.length===13&&report.diskAfterClose.openSubagents.length===1;
      report.checks.panelReopenRestores=report.reopened.selected==='fixture-7-1'&&report.reopened.composition&&report.reopened.range==='history'&&report.reopened.filter==='Codex'&&report.reopened.mode==='weekly';
      report.checks.panelReopenScroll=Math.abs(report.reopened.scroll.sessions-report.before.scroll.sessions)<1&&Math.abs(report.reopened.scroll.events-report.before.scroll.events)<1;
      await web.executeJavaScript(`const input=document.getElementById('session-search');input.value='Fixture';input.dispatchEvent(new Event('input',{bubbles:true}));`);
      // Normal full quit, again with a still-pending save.
      app.quit();
    }else{
      await sleep(220);report.restored=await observe(web);const saved=report.restored.saved;
      report.checks.fullRestartSelection=report.restored.selected==='fixture-7-1';
      report.checks.fullRestartControls=report.restored.filter==='Codex'&&report.restored.range==='history'&&report.restored.mode==='weekly'&&report.restored.composition&&report.restored.query==='Fixture';
      report.checks.queryDoesNotOverwriteFolds=saved.closedProjects.length===13&&saved.openSubagents.length===1;
      await web.executeJavaScript(`const input=document.getElementById('session-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));`);await sleep(100);
      report.checks.foldedProjectDOM=await web.executeJavaScript(`document.querySelectorAll('details[data-project]:not([open])').length===13&&document.querySelectorAll('details[data-subagents][open]').length===1`);
      report.checks.themeUnchanged=report.restored.theme==='electric-purple';report.checks.todayRemainsDynamic=saved.date===null;
      app.quit();
    }
    write();if(Object.values(report.checks).some(value=>value!==true))process.exitCode=1;
  }catch(error){report.error=error.stack;write();console.error(error.stack);process.exitCode=1;app.quit();}
}
if(phase)child();else runner().catch(error=>{console.error(error.stack);process.exitCode=1;});

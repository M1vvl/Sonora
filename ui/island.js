'use strict';
const $ = id => document.getElementById(id);
const value = n => Number.isFinite(Number(n)) ? Math.max(0,Number(n)) : 0;
const short = n => { n=value(n); return n>=1e6 ? `${(n/1e6).toFixed(1)}M` : n>=1000 ? `${(n/1000).toFixed(1)}K` : n.toLocaleString('en-US'); };
const money = (cost, unknown=0, known=null) => { if (cost == null) return unknown > 0 && known != null && value(known) > 0 ? `≥ $${value(known).toFixed(value(known)<.01?4:2)}` : '未定价'; return `${unknown > 0 ? '≥ ' : ''}$${value(cost).toFixed(value(cost)>0&&value(cost)<.01?4:2)}`; };
const agentGlyphs={Codex:'<svg viewBox="0 0 28 24" fill="none" class="agent-cloud" aria-hidden="true"><defs><linearGradient id="pulse-cloud" x1="9" y1="4" x2="18" y2="21" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".55" stop-color="#eeeef9"/><stop offset="1" stop-color="#b8bbd3"/></linearGradient></defs><path d="M8 18.6a5.25 5.25 0 0 1-.6-10.47A7.25 7.25 0 0 1 21.35 9.5a4.55 4.55 0 0 1-.9 9.1H8Z" fill="url(#pulse-cloud)"/><path d="M8 9.4a5.6 5.6 0 0 1 10.1-2.7" stroke="#fff" stroke-opacity=".7" stroke-width="1.15" stroke-linecap="round"/><path d="m10.5 18.1-1 2.2 4-1.7" fill="#d2d3e7"/></svg>',Claude:'<svg viewBox="0 0 28 24" fill="none" class="agent-asterisk" aria-hidden="true"><path d="m14 3.5-.15 17M6.5 6.6l15 10.7M4.8 13.5l18.4-3M8.1 21l11.8-18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'};
function updateAgentGlyph(agent) { const kind=agent==='Claude'?'Claude':'Codex', orb=$('agent-orb'); if(orb.dataset.agent!==kind) { orb.dataset.agent=kind; orb.innerHTML=agentGlyphs[kind]; } orb.classList.toggle('claude',kind==='Claude'); }
const statusLabels = {working:'进行中',idle:'空闲',waiting:'等待输入',completed:'已完成',unknown:'状态未知'};
let selectedSessionId='', sessionOptionsKey='';
let expanded=false, settings={alwaysOnTop:true,islandMaterial:'acrylic',islandOpacity:.55}, snapshot=null;
let modeFeedbackTimer=null;
const islandMusic=window.PulseIslandMusic?.create({island:$('island')});
async function invoke(method,...args) { if(typeof window.pulse?.[method]!=='function') return null; try { return await window.pulse[method](...args); } catch(error) { window.PulseActivityFeed?.showError?.(error?.message || '操作未完成'); return null; } }
function applyMaterial(material) { document.documentElement.dataset.material=material==='blur'?'blur':'css'; document.documentElement.style.setProperty('--glass-opacity',String(Math.max(.25,Math.min(.9,Number(settings.islandOpacity)||.55)))); }
function acceptSettings(next) {
  const previousMode=settings.islandAutoHide;
  settings={...settings,...next};
  if(typeof previousMode==='boolean' && typeof next?.islandAutoHide==='boolean' && previousMode!==next.islandAutoHide) {
    const feedback=$('island-mode-feedback');
    if(modeFeedbackTimer!==null) clearTimeout(modeFeedbackTimer);
    feedback.textContent=settings.islandAutoHide?'自动隐藏 · 顶边唤出':'已固定在顶部';
    feedback.hidden=false;
    modeFeedbackTimer=setTimeout(()=>{feedback.hidden=true;modeFeedbackTimer=null;},1800);
  }
  applyMaterial(snapshot?.material || 'css'); window.PulseLiquidEdge?.setMode(settings.islandEdge || 'refract'); window.PulseActivityFeed?.setMotion(settings.activityMotion || 'scroll'); window.PulseHeaderStatus?.setMotion(settings.activityMotion || 'scroll');
}
function isChildSession(session) {
  return Boolean(session.isSubagent || session.source==='subagent' || session.source?.subagent);
}
function orderedMainSessions(next) {
  const candidates=(next.sessions || []).filter(session=>!isChildSession(session));
  return [...candidates].sort((a,b)=>{
    const priority=session=>(session.status==='working'?4:session.status==='waiting'?3:0)+(value(session.tokens?.total)>0?1:0);
    return priority(b)-priority(a) || new Date(b.updatedAt || 0)-new Date(a.updatedAt || 0);
  });
}
function sessionDisplayName(session) {
  const project=session.projectName || session.cwd?.split(/[\\/]/).pop() || session.agent || '本地项目';
  const title=session.title || '未命名对话';
  return `${project} / ${title}`;
}
function updateSessionPicker(sessions, current, loading) {
  const select=$('island-session-select');
  // Keep keyboard/pointer selection stable while the live session order changes.
  if(select.matches(':open')) return;
  const autoText=current && !selectedSessionId ? `自动跟随 · ${sessionDisplayName(current)}` : '自动跟随活动';
  const optionsKey=JSON.stringify([autoText,selectedSessionId,loading && !current,sessions.map(session=>[session.id,sessionDisplayName(session)])]);
  if(optionsKey!==sessionOptionsKey) {
    sessionOptionsKey=optionsKey;
    const options=document.createDocumentFragment();
    const nativeButton=select.querySelector('.session-select-button');
    if(nativeButton) options.appendChild(nativeButton);
    const automatic=document.createElement('option');
    automatic.value=''; automatic.textContent=autoText; options.appendChild(automatic);
    if(selectedSessionId && !sessions.some(session=>session.id===selectedSessionId)) {
      const pending=document.createElement('option');
      pending.value=selectedSessionId; pending.textContent='正在读取所选对话…'; pending.disabled=true; options.appendChild(pending);
    }
    for(const session of sessions) {
      const option=document.createElement('option');
      option.value=session.id; option.textContent=sessionDisplayName(session); options.appendChild(option);
    }
    select.replaceChildren(options);
  }
  select.value=selectedSessionId;
  select.title=current ? `${selectedSessionId ? '固定显示' : '自动跟随'} · ${sessionDisplayName(current)}` : '选择对话，或自动跟随活动';
}
function render(next) {
  if(!next) return; snapshot=next;
  if(next.settings) acceptSettings(next.settings); applyMaterial(next.material || 'css');
  const mainSessions=orderedMainSessions(next);
  const selected=mainSessions.find(session=>session.id===selectedSessionId);
  if(selectedSessionId && !selected && !next.diagnostics?.loading) selectedSessionId='';
  const session=selectedSessionId ? selected : mainSessions[0];
  updateSessionPicker(mainSessions,session,Boolean(next.diagnostics?.loading));
  const status=session?.status || 'unknown', tokens=session?.tokens || {}, events=session?.events || [];
  const recent=[...events].sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0));
  $('island').classList.toggle('working',status==='working');
  $('island-status').className=`status-dot ${Object.hasOwn(statusLabels,status)?status:'unknown'}`;
  $('island-agent').textContent=session?.agent || 'SONARA';
  $('island-status-label').textContent=session ? statusLabels[status] || '状态未知' : next.diagnostics?.loading ? '正在发现会话' : '等待会话';
  updateAgentGlyph(session?.agent);
  window.PulseHeaderStatus?.update(window.PulseHarnessSummary.project(session, Boolean(next.diagnostics?.loading)));
  $('island-title').title=session?.title || '';
  $('island-tokens').textContent=session ? `${short(tokens.total)} tok` : '—'; $('island-tokens').title='当前对话完整历史 Token';
  $('island-cost').textContent=session ? money(session.costUSD,session.unpricedTokens,session.knownCostUSD) : '本地监控'; $('island-cost').title='当前对话历史金额 · USD';
  $('expanded-input').textContent=session ? short(tokens.input) : '—';
  $('expanded-cached').textContent=session ? short(tokens.cached) : '—';
  $('expanded-output').textContent=session ? short(tokens.output) : '—';
  $('expanded-cost').textContent=session ? money(session.costUSD,session.unpricedTokens,session.knownCostUSD) : '—';
  window.PulseActivityFeed?.update({sessionId:session?.id || '',events:recent.slice().reverse(),loading:Boolean(next.diagnostics?.loading)});

}
async function toggle() {
  const next=!expanded; const result=await invoke('setIslandExpanded',next); if(result===null) return;
  expanded=next; $('island').classList.toggle('expanded',expanded); $('island-details').hidden=!expanded;
  islandMusic?.setExpanded(expanded);
  window.PulseActivityFeed?.setExpanded(expanded);
  $('island-toggle').setAttribute('aria-expanded',String(expanded)); $('island-toggle').setAttribute('aria-label',expanded?'收起实时监控':'展开实时监控');
}
// Pointer activation requires a double click. Keyboard button activation keeps
// its normal Enter/Space semantics through the synthetic zero-detail click.
$('island-toggle').addEventListener('click',event=>{
  if(event.detail===0) toggle();
});
$('island').addEventListener('dblclick',event=>{
  if(handleWasDragged || event.target.closest('.island-details,[data-island-interactive]')) return;
  event.preventDefault();
  toggle();
});
$('island-session-select').addEventListener('change',event=>{
  selectedSessionId=event.target.value;
  if(snapshot) render(snapshot);
});
$('island-session-select').addEventListener('click',event=>event.stopPropagation());

// Window placement stays anchored to the top edge. Screen deltas only classify
// horizontal page swipes and downward mode gestures, never move the window.
const dragHandle=$('island');
let dragState=null, handleWasDragged=false;
dragHandle.addEventListener('pointerdown',event=>{
  if(event.button!==0 || event.target.closest('.island-details,[data-island-interactive]')) return;
  handleWasDragged=false;
  dragState={id:event.pointerId,x:event.screenX,y:event.screenY,startX:event.screenX,startY:event.screenY,swipe:false};
  dragHandle.setPointerCapture?.(event.pointerId);
  dragHandle.classList.add('dragging');
  invoke('islandInteraction',{type:'drag-start'});
  event.preventDefault();
});
dragHandle.addEventListener('pointermove',event=>{
  if(!dragState || dragState.id!==event.pointerId) return;
  const dx=event.screenX-dragState.startX,dy=event.screenY-dragState.startY;
  if(Math.hypot(dx,dy)>4) handleWasDragged=true;
  dragState.x=event.screenX; dragState.y=event.screenY;
  dragState.swipe=Math.abs(dx)>Math.abs(dy)*1.35;
  dragHandle.dataset.pullReady=String(dy>=48 && dy>=Math.abs(dx)*1.5);
});
function finishDrag(event) {
  if(!dragState || dragState.id!==event.pointerId) return;
  const dx=dragState.x-dragState.startX,dy=dragState.y-dragState.startY;
  const cancelled=event.type==='pointercancel';
  if(dragState.swipe && !cancelled && Math.abs(dx)>=42 && Math.abs(dx)>Math.abs(dy)*1.35) {
    const page=islandMusic?.getState().page==='music'?'monitor':'music';
    islandMusic?.setPage(page,dx<0?1:-1);
  }
  const offset={type:'drag-end',dx,dy,cancelled:cancelled||dragState.swipe};
  dragState=null; dragHandle.classList.remove('dragging'); delete dragHandle.dataset.pullReady;
  invoke('islandInteraction',offset);
}
dragHandle.addEventListener('pointerup',finishDrag);
dragHandle.addEventListener('pointercancel',finishDrag);
dragHandle.addEventListener('lostpointercapture',finishDrag);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden || !dragState) return;
  finishDrag({pointerId:dragState.id,type:'pointercancel'});
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape' || !expanded || event.defaultPrevented) return;
  // The in-page native picker handles its own Escape before the island closes.
  if($('island-session-select').matches(':open')) return;
  toggle();
});
window.addEventListener('pagehide',()=>{if(modeFeedbackTimer!==null)clearTimeout(modeFeedbackTimer);islandMusic?.dispose();},{once:true});
(async()=>{acceptSettings(await invoke('getSettings') || {}); window.pulse?.onSnapshot?.(render); window.pulse?.onSettings?.(acceptSettings); render(await invoke('getSnapshot'));})();

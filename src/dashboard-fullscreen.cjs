'use strict';
// Native Escape handling cannot be swallowed by a focused menu or renderer.
function attachDashboardFullscreen(window){
  const web=window.webContents;
  const publish=()=>{if(!window.isDestroyed()&&!web.isDestroyed())web.send('pulse:dashboard-fullscreen',{fullscreen:window.isFullScreen()});};
  const input=(event,value)=>{if(value.type==='keyDown'&&(value.key==='Escape'||value.code==='Escape')&&window.isFullScreen()){event.preventDefault();window.setFullScreen(false);}};
  web.on('before-input-event',input);window.on('enter-full-screen',publish);window.on('leave-full-screen',publish);web.on('did-finish-load',publish);
  const dispose=()=>{web.removeListener('before-input-event',input);web.removeListener('did-finish-load',publish);window.removeListener('enter-full-screen',publish);window.removeListener('leave-full-screen',publish);};
  window.once('closed',dispose);return {dispose,publish};
}
module.exports={attachDashboardFullscreen};

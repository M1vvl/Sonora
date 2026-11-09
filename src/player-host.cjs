'use strict';

// An isolated WebContentsView inside the existing dashboard. The right rail is
// fully covered during playback. Removing this view restores the untouched DOM.
function createPlayerHost({electron,getWindow,preload,onClosed}){
  const {WebContentsView,screen}=electron;
  let view=null,owner=null,bounds=null;
  function layout(){
    if(!view||!owner||owner.isDestroyed())return;
    const [width,height]=owner.getContentSize();
    bounds={x:0,y:0,width,height};
    view.setBounds(bounds);
  }
  function detached(){onClosed?.();}
  return {
    attach(playerSession){
      if(view&&!view.webContents.isDestroyed())return view.webContents;
      owner=getWindow();if(!owner||owner.isDestroyed())throw new Error('请先打开监控面板');
      view=new WebContentsView({webPreferences:{session:playerSession,preload,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
      view.setBackgroundColor('#050608');owner.contentView.addChildView(view);layout();
      owner.on('resize',layout);owner.on('enter-full-screen',layout);owner.on('leave-full-screen',layout);owner.on('closed',detached);
      return view.webContents;
    },
    getContents:()=>view&&!view.webContents.isDestroyed()?view.webContents:null,
    getWindow:()=>owner&&!owner.isDestroyed()?owner:null,
    getBounds:()=>bounds?{...bounds}:null,
    hwnd(){if(!owner||owner.isDestroyed())throw new Error('播放宿主已关闭');const raw=owner.getNativeWindowHandle();return raw.length>=8?raw.readBigUInt64LE().toString():String(raw.readUInt32LE());},
    viewport(rect){
      if(!bounds||!owner||owner.isDestroyed()||!rect||!['x','y','width','height'].every(key=>Number.isFinite(rect[key])))throw new Error('无效的视频区域');
      const scale=screen.getDisplayMatching(owner.getBounds()).scaleFactor;
      const left=Math.max(0,Math.min(bounds.width,rect.x)),top=Math.max(0,Math.min(bounds.height,rect.y));
      const width=Math.round(Math.max(0,Math.min(bounds.width-left,rect.width))*scale),height=Math.round(Math.max(0,Math.min(bounds.height-top,rect.height))*scale);
      return {x:Math.round((bounds.x+left)*scale),y:Math.round((bounds.y+top)*scale),width:Math.max(1,width),height:Math.max(1,height),visible:rect.visible!==false&&width>0&&height>0};
    },
    detach(){
      if(owner&&!owner.isDestroyed()){owner.removeListener('resize',layout);owner.removeListener('enter-full-screen',layout);owner.removeListener('leave-full-screen',layout);owner.removeListener('closed',detached);if(view)owner.contentView.removeChildView(view);}
      if(view&&!view.webContents.isDestroyed())view.webContents.close({waitForBeforeUnload:false});
      view=null;owner=null;bounds=null;
    }
  };
}
module.exports={createPlayerHost};

'use strict';

// Per-pixel transparent HWNDs cannot rely on DWM's corner hint. A window
// region clips both the visible surface and its native hit-test footprint.
const DASHBOARD_RADIUS = 24;
const UPDATE_DELAY_MS = 32;
const BORDER_NONE = 0xfffffffe;
const BORDER_DEFAULT = 0xffffffff;
let nativeBindings;

function bindings() {
  if (nativeBindings) return nativeBindings;
  const koffi = require('koffi');
  const user = koffi.load('user32.dll'), gdi = koffi.load('gdi32.dll'), dwm = koffi.load('dwmapi.dll');
  koffi.struct('PulseDashboardShapeRect', {left:'int32_t', top:'int32_t', right:'int32_t', bottom:'int32_t'});
  const rect = user.func('int __stdcall GetWindowRect(void *hwnd, _Out_ PulseDashboardShapeRect *rect)');
  const dpi = user.func('uint32_t __stdcall GetDpiForWindow(void *hwnd)');
  const setRegion = user.func('int __stdcall SetWindowRgn(void *hwnd, void *region, int redraw)');
  const roundRegion = gdi.func('void * __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height)');
  const deleteRegion = gdi.func('int __stdcall DeleteObject(void *object)');
  const setAttribute = dwm.func('int32_t __stdcall DwmSetWindowAttribute(void *hwnd, uint32_t attribute, void *value, uint32_t size)');
  nativeBindings = {
    getRect(hwnd) {const value={};if (!rect(hwnd,value)) throw new Error('Dashboard window bounds unavailable');return value;},
    getDpi: dpi,
    // GDI's rounded region otherwise drops the last column/row and offsets
    // the right/bottom arc inward by one physical pixel. Include that bound
    // so the native mask encloses Chromium's antialiased inset consistently.
    createRegion(width,height,diameter) {return roundRegion(0,0,width+1,height+1,diameter,diameter);},
    setRegion(hwnd,region) {return setRegion(hwnd,region,1)!==0;},
    deleteRegion,
    setCornerPreference(hwnd,value) {const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return setAttribute(hwnd,33,bytes,4)>=0;},
    setBorderColor(hwnd,value) {const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return setAttribute(hwnd,34,bytes,4)>=0;}
  };
  return nativeBindings;
}

function windowHandle(window) {
  const bytes=window.getNativeWindowHandle();
  if (!Buffer.isBuffer(bytes)||bytes.length<4) throw new Error('Dashboard native handle unavailable');
  return bytes.length>=8?bytes.readBigUInt64LE():BigInt(bytes.readUInt32LE());
}

function shapeGeometry(rect,dpi,square=false) {
  const width=rect?.right-rect?.left, height=rect?.bottom-rect?.top;
  if (![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=32768)) throw new Error('Dashboard shape bounds are invalid');
  const scale=Number.isFinite(dpi)&&dpi>=48&&dpi<=768?dpi/96:1;
  const radius=square?0:Math.min(Math.round(DASHBOARD_RADIUS*scale),Math.floor(Math.min(width,height)/2));
  return {width,height,dpi:Math.round(scale*96),radius,radiusDIP:square?0:DASHBOARD_RADIUS};
}

function attachDashboardShape({window,screen,onGeometry=()=>{},platform=process.platform,native,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let api=native, timer=null, forcePending=false, disposed=false, applying=false, ownsRegion=false, signature='';
  let status={backend:'pending',rounded:false,nativeRegion:false,radiusDIP:DASHBOARD_RADIUS};
  const getNative=()=>api||=bindings();
  const listeners=[];
  const on=(target,event,listener)=>{target.on(event,listener);listeners.push(()=>target.removeListener(event,listener));};
  function update(force=false) {
    if (disposed||window.isDestroyed()) return {...status};
    if (platform!=='win32') {
      status={backend:'css-only',rounded:false,nativeRegion:false,radiusDIP:DASHBOARD_RADIUS,fallbackReason:'platform-unsupported'};
      onGeometry({...status});return {...status};
    }
    applying=true;
    try {
      const current=getNative(),hwnd=windowHandle(window);
      const square=window.isMaximized()||window.isFullScreen();
      const geometry=shapeGeometry(current.getRect(hwnd),current.getDpi(hwnd),square);
      const next=JSON.stringify(geometry);
      if (next===signature&&force!==true) return {...status};
      // One native region owns the 24 DIP outline. A separate DWM border can
      // otherwise follow a smaller system radius outside that outline.
      const cornerPreferenceAccepted=current.setCornerPreference(hwnd,1);
      const borderSuppressed=current.setBorderColor(hwnd,BORDER_NONE);
      if (square) {
        if (ownsRegion&&!current.setRegion(hwnd,null)) throw new Error('Dashboard rounded region could not be cleared');
        ownsRegion=false;
      } else {
        const region=current.createRegion(geometry.width,geometry.height,geometry.radius*2);
        if (!region) throw new Error('Dashboard rounded region could not be allocated');
        let transferred=false;
        try {
          if (!current.setRegion(hwnd,region)) throw new Error('Dashboard rounded region was rejected');
          transferred=true;ownsRegion=true;
        } finally {
          // A successful SetWindowRgn transfers ownership to Windows. Only a
          // rejected or throwing call leaves this handle owned by the module.
          if (!transferred) current.deleteRegion(region);
        }
      }
      signature=next;
      status={...geometry,backend:square?'native-rectangle':'native-window-region',rounded:!square,nativeRegion:ownsRegion,cornerPreferenceAccepted,borderSuppressed};
    } catch (error) {
      status={...status,nativeRegion:ownsRegion,error:String(error.message||error).slice(0,180)};
    } finally {applying=false;}
    onGeometry({...status});
    return {...status};
  }
  function schedule(force=false) {
    if (disposed||applying) return;
    forcePending=forcePending||force;
    if (timer!==null) return;
    timer=setTimer(()=>{const requested=forcePending;timer=null;forcePending=false;update(requested);},UPDATE_DELAY_MS);
    timer.unref?.();
  }
  function dispose() {
    if (disposed) return;
    disposed=true;
    if (timer!==null) clearTimer(timer);
    timer=null;forcePending=false;listeners.splice(0).forEach(remove=>remove());
    if (platform==='win32'&&api&&!window.isDestroyed()) {
      try {const hwnd=windowHandle(window);if (ownsRegion) api.setRegion(hwnd,null);api.setCornerPreference(hwnd,0);api.setBorderColor(hwnd,BORDER_DEFAULT);} catch {}
    }
    ownsRegion=false;
  }
  for (const event of ['resize','resized','move','maximize','unmaximize','enter-full-screen','leave-full-screen']) on(window,event,()=>schedule());
  // Chromium can reset the HWND frame/region while presenting or restoring
  // its surface. These finite transitions must not use the geometry cache.
  for (const event of ['show','ready-to-show','restore','focus','blur']) on(window,event,()=>schedule(true));
  if (window.webContents) on(window.webContents,'did-finish-load',()=>schedule(true));
  if (screen) on(screen,'display-metrics-changed',()=>schedule());
  on(window,'closed',dispose);
  update();
  return {update,dispose,getStatus:()=>({...status,disposed,pendingUpdate:timer!==null})};
}

module.exports={DASHBOARD_RADIUS,UPDATE_DELAY_MS,shapeGeometry,attachDashboardShape};

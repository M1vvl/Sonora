'use strict';
// Transparent BrowserWindow pixels and a system backdrop are separate layers.
// CSS owns theme tint/opacity. The native layer never fades the whole window.
// Windows can suppress Acrylic despite accepting its requested attribute.
const os = require('node:os');
const {transparencyEnabled} = require('./material.cjs');
const diagnostics = new WeakMap();
let nativeApi;
const BACKDROP_ATTRIBUTE = 38;
const BACKDROP_NONE = 1;
const BACKDROP_ACRYLIC = 3;

function bindings() {
  if (nativeApi) return nativeApi;
  const koffi = require('koffi'), dwm = koffi.load('dwmapi.dll');
  koffi.struct('PulseDashboardMargins', {left:'int32_t', right:'int32_t', top:'int32_t', bottom:'int32_t'});
  const extend = dwm.func('int32_t __stdcall DwmExtendFrameIntoClientArea(void *hwnd, PulseDashboardMargins *margins)');
  const set = dwm.func('int32_t __stdcall DwmSetWindowAttribute(void *hwnd, uint32_t attribute, void *value, uint32_t size)');
  const get = dwm.func('int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attribute, _Out_ void *value, uint32_t size)');
  const composition = dwm.func('int32_t __stdcall DwmIsCompositionEnabled(_Out_ int32_t *enabled)');
  nativeApi = {
    compositionEnabled() {const enabled=[0];return composition(enabled)>=0&&enabled[0]!==0;},
    setBackdrop(hwnd,value) {const buffer=Buffer.alloc(4);buffer.writeUInt32LE(value);return set(hwnd,BACKDROP_ATTRIBUTE,buffer,buffer.length);},
    getBackdrop(hwnd) {const buffer=Buffer.alloc(4);return get(hwnd,BACKDROP_ATTRIBUTE,buffer,buffer.length)>=0?buffer.readUInt32LE():null;},
    extendFrame(hwnd,enabled) {const value=enabled?-1:0;return extend(hwnd,{left:value,right:value,top:value,bottom:value});}
  };
  return nativeApi;
}
function handle(win) {
  const bytes=win.getNativeWindowHandle();
  if (!Buffer.isBuffer(bytes)||bytes.length<4) throw new Error('Dashboard native handle unavailable');
  return bytes.length>=8?bytes.readBigUInt64LE():BigInt(bytes.readUInt32LE());
}
function normalizeOpacity(value) {return Number.isFinite(value)?Math.max(.18,Math.min(.9,value)):.55;}
function applyDashboardMaterial(win,settings={},adapters={}) {
  const requested=settings.dashboardGlass===true;
  const details={requested,opacity:normalizeOpacity(settings.dashboardOpacity),backend:requested?'per-pixel-clear':'opaque-theme',desktopBlur:false,nativeConfigured:false,visualVerified:false};
  if (!win||win.isDestroyed()) return {...details,backend:'unavailable',fallbackReason:'window-unavailable'};
  const previous=diagnostics.get(win);
  const platform=adapters.platform||process.platform;
  const build=adapters.build??Number(os.release().split('.')[2]);
  let api;
  const native=()=>api||=adapters.native||bindings();
  function clearNative() {
    if (!previous?.nativeConfigured) return;
    try {
      const hwnd=handle(win),current=native();
      const reset=current.setBackdrop(hwnd,BACKDROP_NONE),frame=current.extendFrame(hwnd,false);
      details.nativeCleared=reset>=0&&frame>=0;
      details.nativeConfigured=!details.nativeCleared;
      if (!details.nativeCleared) details.clearError='native-backdrop-reset-failed';
    } catch (error) {details.clearError=String(error.message||error).slice(0,180);}
  }
  if (!requested) clearNative();
  else if (platform!=='win32') details.fallbackReason='desktop-blur-platform-unsupported';
  else if (build<22621) details.fallbackReason='windows-build-unsupported';
  else {
    try {
      details.systemTransparencyEnabled=(adapters.transparencyEnabled||transparencyEnabled)()===true;
      if (!details.systemTransparencyEnabled) {clearNative();details.fallbackReason='system-transparency-disabled';}
      else if (!native().compositionEnabled()) {clearNative();details.fallbackReason='desktop-composition-unavailable';}
      else {
        const hwnd=handle(win),current=native();
        if (current.extendFrame(hwnd,true)<0) throw new Error('Native frame extension rejected');
        if (current.setBackdrop(hwnd,BACKDROP_ACRYLIC)<0) throw new Error('Native Acrylic request rejected');
        const selected=current.getBackdrop(hwnd);
        if (selected!==BACKDROP_ACRYLIC) throw new Error('Native Acrylic attribute was not retained');
        details.nativeConfigured=true;
        details.requestedBackdrop='acrylic';
        details.backend='dwm-acrylic-requested';
        details.desktopBlur=null;
        details.effectiveBlur='system-managed-unverified';
      }
    } catch (error) {
      details.error=String(error.message||error).slice(0,180);
      details.fallbackReason='native-backdrop-unavailable';
      // Also undo a partially applied request. Do not use Electron's
      // setBackgroundMaterial('none'), which changes its transparency state.
      try {if(api){const hwnd=handle(win);api.setBackdrop(hwnd,BACKDROP_NONE);api.extendFrame(hwnd,false);}} catch {}
    }
  }
  diagnostics.set(win,details);
  return {...details};
}
function getDashboardMaterialDiagnostics(win) {return win&&!win.isDestroyed()?{...diagnostics.get(win)}:null;}
module.exports={applyDashboardMaterial,getDashboardMaterialDiagnostics,normalizeOpacity};

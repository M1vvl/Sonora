'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyDashboardMaterial,getDashboardMaterialDiagnostics,normalizeOpacity}=require('../src/dashboard-material.cjs');
function fixture(options={}) {
  const calls=[],bytes=Buffer.alloc(options.bits===32?4:8);if(bytes.length===8)bytes.writeBigUInt64LE(12345n);else bytes.writeUInt32LE(12345);
  const win={isDestroyed:()=>false,getNativeWindowHandle:()=>bytes,setOpacity:()=>{throw new Error('Whole-window opacity forbidden');},setBackgroundMaterial:()=>{throw new Error('Electron transparency mutation forbidden');}};
  const native={compositionEnabled:()=>true,setBackdrop:(hwnd,value)=>{calls.push(['backdrop',hwnd,value]);return 0;},getBackdrop:()=>3,extendFrame:(hwnd,value)=>{calls.push(['frame',hwnd,value]);return 0;},...options.native};
  return {win,calls,native,adapters:{platform:'win32',build:26200,transparencyEnabled:()=>true,native}};
}
test('glass off keeps the opaque theme without initializing any native backdrop',()=>{
 const f=fixture(),value=applyDashboardMaterial(f.win,{dashboardGlass:false,dashboardOpacity:.6},f.adapters);
 assert.equal(value.backend,'opaque-theme');assert.equal(value.opacity,.6);assert.equal(value.desktopBlur,false);assert.equal(f.calls.length,0);
 assert.deepEqual(getDashboardMaterialDiagnostics(f.win),value);
});
test('system transparency off preserves real per-pixel clear fallback and never requests native Acrylic',()=>{
 const f=fixture();f.adapters.transparencyEnabled=()=>false;
 const value=applyDashboardMaterial(f.win,{dashboardGlass:true},f.adapters);
 assert.equal(value.backend,'per-pixel-clear');assert.equal(value.fallbackReason,'system-transparency-disabled');assert.equal(value.systemTransparencyEnabled,false);assert.equal(value.nativeConfigured,false);assert.equal(f.calls.length,0);
});
test('documented DWM attribute is requested and retained without claiming visual blur acceptance',()=>{
 for(const bits of [32,64]){
  const f=fixture({bits}),value=applyDashboardMaterial(f.win,{dashboardGlass:true,dashboardOpacity:.3},f.adapters);
  assert.equal(value.backend,'dwm-acrylic-requested');assert.equal(value.nativeConfigured,true);assert.equal(value.desktopBlur,null);assert.equal(value.visualVerified,false);assert.equal(value.effectiveBlur,'system-managed-unverified');
  assert.deepEqual(f.calls,[['frame',12345n,true],['backdrop',12345n,3]]);
 }
});
test('turning glass off clears only its owned DWM request and does not recreate or fade the window',()=>{
 const f=fixture();applyDashboardMaterial(f.win,{dashboardGlass:true},f.adapters);f.calls.length=0;
 const value=applyDashboardMaterial(f.win,{dashboardGlass:false},f.adapters);
 assert.equal(value.backend,'opaque-theme');assert.equal(value.nativeCleared,true);assert.deepEqual(f.calls,[['backdrop',12345n,1],['frame',12345n,false]]);
 f.calls.length=0;applyDashboardMaterial(f.win,{dashboardGlass:false},f.adapters);assert.equal(f.calls.length,0);
});
test('changing the system preference clears an already configured backdrop',()=>{
 const f=fixture();applyDashboardMaterial(f.win,{dashboardGlass:true},f.adapters);f.calls.length=0;f.adapters.transparencyEnabled=()=>false;
 const value=applyDashboardMaterial(f.win,{dashboardGlass:true},f.adapters);
 assert.equal(value.backend,'per-pixel-clear');assert.equal(value.nativeCleared,true);assert.deepEqual(f.calls,[['backdrop',12345n,1],['frame',12345n,false]]);
});
test('unsupported OS and unavailable composition do not report native blur',()=>{
 const f=fixture();for(const adapters of [{...f.adapters,platform:'linux'},{...f.adapters,build:19045},{...f.adapters,native:{...f.native,compositionEnabled:()=>false}}]){
  const value=applyDashboardMaterial(f.win,{dashboardGlass:true},adapters);assert.equal(value.nativeConfigured,false);assert.equal(value.desktopBlur,false);assert.equal(value.backend,'per-pixel-clear');
 }
 assert.equal(f.calls.length,0);assert.equal(applyDashboardMaterial(null,{dashboardGlass:true}).fallbackReason,'window-unavailable');
});
test('partial failure is reverted and reports the native rejection instead of fabricated blur',()=>{
 const f=fixture({native:{getBackdrop:()=>1}}),value=applyDashboardMaterial(f.win,{dashboardGlass:true},f.adapters);
 assert.equal(value.nativeConfigured,false);assert.equal(value.fallbackReason,'native-backdrop-unavailable');assert.match(value.error,/not retained/);assert.deepEqual(f.calls.slice(-2),[['backdrop',12345n,1],['frame',12345n,false]]);
});
test('opacity stays bounded as a surface parameter, keeping text and controls at full window opacity',()=>{
 for(const [input,expected] of [[0,.18],[1,.9],[NaN,.55],[Infinity,.55],[undefined,.55],[.42,.42]])assert.equal(normalizeOpacity(input),expected);
 const f=fixture(),settings={dashboardGlass:true,dashboardOpacity:0,interfaceTheme:'electric-purple'};
 applyDashboardMaterial(f.win,settings,{...f.adapters,transparencyEnabled:()=>false});assert.deepEqual(settings,{dashboardGlass:true,dashboardOpacity:0,interfaceTheme:'electric-purple'});
 const copied=getDashboardMaterialDiagnostics(f.win);copied.backend='changed';assert.equal(getDashboardMaterialDiagnostics(f.win).backend,'per-pixel-clear');
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {create}=require('../ui/dashboard-material.js');
const {sanitize}=require('../src/settings.cjs');
test('desktop glass is opt-in with separate bounded persisted surface opacity',()=>{
  const defaults=sanitize({});assert.equal(defaults.dashboardGlass,false);assert.equal(defaults.dashboardOpacity,.6);
  const value=sanitize({dashboardGlass:true,dashboardOpacity:4,islandOpacity:-1,interfaceTheme:'electric-purple'});
  assert.equal(value.dashboardOpacity,.9);assert.equal(value.islandOpacity,.25);assert.equal(value.interfaceTheme,'electric-purple');
  assert.equal(sanitize({dashboardGlass:'false',dashboardOpacity:NaN}).dashboardGlass,false);
});
test('glass controls retain theme, place island settings beside its switch, and save distinct opacity keys',()=>{
  const dom=new JSDOM(fs.readFileSync(require.resolve('../ui/dashboard.html'),'utf8'));
  const document=dom.window.document,patches=[],dialog=document.getElementById('material-transparency-dialog');
  dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;};
  document.documentElement.dataset.interfaceTheme='electric-purple';
  let control;
  control=create({document,saveSettings:patch=>{patches.push(patch);control.update(patch);}});
  try{
    control.update({dashboardGlass:false,dashboardOpacity:.6,islandOpacity:.55});
    assert.equal(document.documentElement.style.getPropertyValue('--dashboard-shell-tint'),'60%');
    assert.equal(document.documentElement.style.getPropertyValue('--dashboard-panel-tint'),'35%');
    control.setShape({radiusDIP:0});assert.equal(document.documentElement.style.getPropertyValue('--dashboard-radius'),'0px');
    assert.equal(document.documentElement.dataset.dashboardSquare,'true');
    control.setShape({radiusDIP:24});assert.equal(document.documentElement.style.getPropertyValue('--dashboard-radius'),'24px');
    assert.equal(document.documentElement.dataset.dashboardGlass,'false');
    control.setDiagnostics({fallbackReason:'system-transparency-disabled'});
    const toggle=document.getElementById('setting-dashboard-glass');toggle.checked=true;toggle.dispatchEvent(new dom.window.Event('change'));
    assert.equal(document.documentElement.dataset.dashboardGlass,'true');assert.match(document.getElementById('dashboard-glass-status').textContent,/Veyra Liquid Glass/);
    document.getElementById('dashboard-transparency-button').click();
    const range=document.getElementById('material-transparency');range.value='65';range.dispatchEvent(new dom.window.Event('input'));
    assert.equal(document.documentElement.style.getPropertyValue('--dashboard-tint'),'35%');assert.equal(document.documentElement.style.getPropertyValue('--dashboard-shell-tint'),'35%');range.dispatchEvent(new dom.window.Event('change'));
    assert.deepEqual(patches.at(-1),{dashboardOpacity:.35});document.getElementById('material-transparency-close').click();
    const islandButton=document.getElementById('island-transparency-button');assert.equal(islandButton.nextElementSibling.id,'setting-island');islandButton.click();
    assert.equal(range.max,'75');range.value='60';range.dispatchEvent(new dom.window.Event('input'));range.dispatchEvent(new dom.window.Event('change'));
    assert.deepEqual(patches.at(-1),{islandOpacity:.4});assert.equal(document.documentElement.dataset.interfaceTheme,'electric-purple');
  }finally{control.dispose();dom.window.close();}
});


test('dashboard glass shares the transport material and static grain without a desktop-blur claim',()=>{
 const css=fs.readFileSync(require.resolve('../ui/dashboard-material.css'),'utf8');
 const bar=fs.readFileSync(require.resolve('../ui/music/immersive-transport.css'),'utf8');
 assert.match(css,/--frosted-glass-filter:blur\(18px\) saturate\(125%\)/);
 assert.match(bar,/backdrop-filter:var\(--frosted-glass-filter/);
 assert.match(css,/dashboard-grain\.svg/);assert.match(css,/pointer-events:none/);
 assert.match(css,/theme-option \{ backdrop-filter:none/);
});

test('one alpha outline encloses the surface and only enabled glass paints the bevel',()=>{
 const tree=require('css-tree'),rules=new Map();
 tree.walk(tree.parse(fs.readFileSync(require.resolve('../ui/dashboard-material.css'),'utf8')),{visit:'Rule',enter(node){
   rules.set(tree.generate(node.prelude),tree.generate(node.block));
 }});
 assert.match(rules.get('html,html[data-interface-theme] body'),/background:transparent/);
 assert.match(rules.get('.app-shell'),/background:var\(--bg\)/);
 assert.match(rules.get('.app-shell'),/clip-path:inset\(var\(--dashboard-surface-inset\) round var\(--dashboard-surface-radius\)\)/);
 assert.match(rules.get(':root'),/--dashboard-surface-inset:1\.25px/);
 assert.match(rules.get(':root'),/--dashboard-surface-radius:max\(0px,calc\(var\(--dashboard-radius\) - var\(--dashboard-surface-inset\)\)\)/);
 assert.match(rules.get('html[data-dashboard-square="true"]'),/--dashboard-surface-inset:0px/);
 assert.equal(rules.get('.app-shell::after'),'{content:none}');
 assert(![...rules.keys()].some(selector=>selector.includes('body::after')));
 const bevel=rules.get('html[data-dashboard-glass="true"] .app-shell::after');
 assert.match(bevel,/position:absolute/);assert.match(bevel,/inset:var\(--dashboard-surface-inset\)/);
 assert.match(bevel,/border-radius:var\(--dashboard-surface-radius\)/);assert.match(bevel,/pointer-events:none/);
 assert.match(bevel,/box-shadow:inset/);
 assert(!bevel.includes('filter:')); // Depth does not add another full-window blur pass.
});

test('dashboard glass never paints a rectangular layer behind the immersive transport',()=>{
 const tree=require('css-tree'),css=fs.readFileSync(require.resolve('../ui/dashboard-material.css'),'utf8');
 const dom=new JSDOM('<html data-dashboard-glass="true"><body><section class="music-immersive"><div class="music-immersive-player"><div class="music-player-root"><div class="music-player-bar"></div></div></div></section></body></html>');
 try{
  const wrapper=dom.window.document.querySelector('.music-immersive-player');
  const bar=dom.window.document.querySelector('.music-player-bar');
  const declarations=[];
  tree.walk(tree.parse(css),{visit:'Rule',enter(node){
   const selector=tree.generate(node.prelude);
   if(selector.includes('::'))return;
   for(const element of [wrapper,bar])if(element.matches(selector))tree.walk(node.block,{visit:'Declaration',enter(declaration){declarations.push([element.className,declaration.property]);}});
  }});
  assert.deepEqual(declarations,[],'The lyric playback bar owns its material, border and clipping in both glass modes.');
 }finally{dom.window.close();}
});

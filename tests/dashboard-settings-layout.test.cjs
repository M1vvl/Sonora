'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('settings directly opens on the theme and keeps only desktop and music controls below it',()=>{
 const dom=new JSDOM(fs.readFileSync(require.resolve('../ui/dashboard.html'),'utf8'));
 try{
  const view=dom.window.document.getElementById('settings-view');
  assert.equal(view.firstElementChild.className,'settings-grid');
  assert.deepEqual([...view.querySelectorAll('.settings-panel>h2,.theme-panel-header>h2')].map(node=>node.textContent),['界面主题','桌面体验','音乐律动']);
  for(const id of ['save-status','source-status','pricing-table','settings-pricing-source'])assert.equal(view.querySelector('#'+id),null);
  assert.equal(view.querySelector('.music-settings-panel').previousElementSibling.querySelector('h2').textContent,'桌面体验');
  for(const id of ['setting-dashboard-glass','setting-island','setting-music','setting-audio-source','setting-music-cover','setting-cover-motion'])assert.ok(view.querySelector('#'+id));
  assert.doesNotMatch(view.textContent,/保持专注|MAKE IT YOURS|实时 Token 计价|本地连接|已保存/);
 }finally{dom.window.close();}
 const source=fs.readFileSync(require.resolve('../ui/dashboard.js'),'utf8');
 assert.doesNotMatch(source,/renderSources|source-status|pricing-table|settings-pricing-source|save-status/,'Removed panels must not leave DOM reads that can interrupt initialization or saving.');
});

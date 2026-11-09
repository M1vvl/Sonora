'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {parseLyrics}=require('../src/music/lyrics.cjs');
const {create,progressAt,contextStyle}=require('../ui/music/lyric-motion.js');
test('native YRC retains real absolute/relative word clocks and translation without inventing LRC words',()=>{
  const result=parseLyrics({yrc:{lyric:'[10000,4000](10000,1000,0)Hello (12000,1000,0)world\n[20000,2000](0,800,0)你(800,900,0)好'},tlyric:{lyric:'[00:10.00]你好世界'}});
  assert.equal(result.timingSource,'yrc-word');assert.equal(result.lines[0].text,'Hello world');assert.equal(result.lines[0].translation,'你好世界');
  assert.deepEqual(result.lines[0].words.map(word=>[word.time,word.duration,word.c0,word.c1]),[[10,1,0,6],[12,1,6,11]]);
  assert.deepEqual(result.lines[1].words.map(word=>word.time),[20,20.8]);
  const plain=parseLyrics({lrc:{lyric:'[00:10]ordinary LRC'}});assert.equal(plain.timingSource,'lrc-line');assert.equal(plain.lines[0].words,undefined);
});
test('word progress holds an actual gap, follows current word and reverses on seek',()=>{
  const line={time:10,text:'ab',words:[{time:10,duration:1,c0:0,c1:1},{time:13,duration:2,c0:1,c1:2}]};
  assert.equal(progressAt(line,null,9),0);assert.equal(progressAt(line,null,10.5),.25);assert.equal(progressAt(line,null,12),.5);assert.equal(progressAt(line,null,14),.75);assert.equal(progressAt(line,null,16),1);assert.equal(progressAt(line,null,10),0);
  const lrc={time:5,text:'not word timed'};const at=progressAt(lrc,{time:10},7.5);assert(at>.50&&at<.51);assert.equal(progressAt(lrc,null,100,12),1);
});
test('malformed YRC timestamps and words stay bounded while ordinary LRC remains available',()=>{
  const invalid=parseLyrics({yrc:{lyric:'[999999999999,1000](0,1,0)bad\nnot valid'},lrc:{lyric:'[00:00.00]fallback'}});assert.equal(invalid.lines[0].text,'fallback');
  const many=parseLyrics({yrc:{lyric:Array.from({length:1500},(_,n)=>`[${n*1000},1000](0,999,0)word`).join('\n')}});assert.equal(many.lines.length,1200);assert(many.lines.every(line=>line.words.length<=200));
});
function fixture(settings={}){
  const dom=new JSDOM('<div id="root" style="font-size:27px"></div><audio src="pulse-music-audio://track/test-only"></audio>',{url:'https://local.test',pretendToBeVisual:true}),view=dom.window,root=view.document.getElementById('root'),audio=view.document.querySelector('audio'),frames=new Map();let next=0,stamp=0,paused=true;
  Object.defineProperty(audio,'paused',{get:()=>paused});Object.defineProperty(audio,'duration',{get:()=>1000});Object.defineProperty(root,'clientHeight',{get:()=>450});Object.defineProperty(root,'clientWidth',{get:()=>750});
  view.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};view.cancelAnimationFrame=id=>frames.delete(id);
  const projection=create({root,immersive:true,getSettings:()=>({lyricMode:'immersive',lyricLines:7,...settings})});projection.attachAudio(audio);
  return {dom,root,audio,view,frames,projection,play(){paused=false;audio.dispatchEvent(new view.Event('playing'));},pause(){paused=true;audio.dispatchEvent(new view.Event('pause'));},frame(time){audio.currentTime=time;stamp+=16.7;const pending=[...frames];frames.clear();for(const[,fn]of pending)fn(stamp);},dispose(){projection.dispose();dom.window.close();}};
}
test('persistent track recycles at most seventeen rows and interpolates scrolling without rebuilding current text',()=>{
  const f=fixture();try{f.projection.setLines(Array.from({length:100},(_,n)=>({time:n*2,text:'真实歌词 '+n})));f.projection.activate();f.play();f.frame(8.2);const current=f.root.querySelector('[data-line-index="4"]');assert(current);assert(f.projection.getState().rendered<=17);const initial=f.projection.getState().offset;
    f.frame(10.05);assert.equal(f.root.querySelector('[data-line-index="4"]'),current);const first=f.projection.getState().offset;f.frame(10.1);const second=f.projection.getState().offset;assert.notEqual(first,second);assert(second<initial);assert(f.projection.getState().builds<25);
    f.audio.currentTime=150;f.audio.dispatchEvent(new f.view.Event('seeking'));assert.equal(f.projection.getState().index,75);assert.equal(f.root.querySelectorAll('.pulse-lyric-row').length,13);f.pause();assert.equal(f.frames.size,0);f.projection.dispose();assert.equal(f.root.children.length,0);
  }finally{f.dispose();}
});
test('native word reveal uses media seconds, pauses without an animation loop and resumes after obscuring',()=>{
  const f=fixture();try{f.projection.setLines([{time:0,text:'Hello world',words:[{time:0,duration:2,c0:0,c1:6},{time:3,duration:2,c0:6,c1:11}]}]);f.projection.activate();f.play();f.frame(1);let words=f.root.querySelectorAll('.pulse-lyric-word');assert.equal(words[0].style.getPropertyValue('--word-reveal'),'50.000%');assert.equal(words[1].style.getPropertyValue('--word-reveal'),'0.000%');
    f.frame(4);assert.equal(words[0].style.getPropertyValue('--word-reveal'),'100.000%');assert.equal(words[1].style.getPropertyValue('--word-reveal'),'50.000%');assert.equal(f.projection.getState().timingSource,'yrc-word');f.projection.setObscured(true);assert.equal(f.frames.size,0);f.projection.setObscured(false);assert.equal(f.frames.size,1);f.pause();assert.equal(f.frames.size,0);
  }finally{f.dispose();}
});

test('YRC preserves literal punctuation between timing tokens',()=>{
  const value=parseLyrics({yrc:{lyric:'[1000,2000](1000,500,0)(Hello) (1500,500,0)world (live)'}});
  assert.equal(value.lines[0].text,'(Hello) world (live)');
  assert.deepEqual(value.lines[0].words.map(word=>word.text),['(Hello) ','world (live)']);
});

test('inactive or obscured projections keep only timing metadata until visible',()=>{
  const f=fixture();try{
    f.projection.setLines(Array.from({length:100},(_,n)=>({time:n*2,text:'歌词 '+n})));
    f.projection.time(80);assert.equal(f.root.querySelectorAll('.pulse-lyric-row').length,0);assert.equal(f.projection.getState().builds,0);assert.equal(f.frames.size,0);
    f.audio.currentTime=80;f.projection.activate();const row=f.root.querySelector('[data-line-index="40"]');assert(row);
    f.projection.setObscured(true);const builds=f.projection.getState().builds,offset=f.projection.getState().offset;
    f.audio.currentTime=100;f.projection.time(100);assert.equal(f.projection.getState().builds,builds);assert.equal(f.projection.getState().offset,offset);assert.equal(f.frames.size,0);
    f.projection.setObscured(false);assert.equal(f.projection.getState().index,50);assert(f.root.querySelector('[data-line-index="50"]'));
  }finally{f.dispose();}
});

test('font and line-spacing changes reposition the same active row immediately',()=>{
  const settings={lyricLineHeight:1.4};const f=fixture(settings);try{
    f.projection.setLines(Array.from({length:10},(_,n)=>({time:n*2,text:'歌词 '+n})));
    f.audio.currentTime=6.2;f.projection.activate();const row=f.root.querySelector('[data-line-index="3"]'),before=parseFloat(row.style.top);
    settings.lyricLineHeight=1.8;f.root.style.fontSize='40px';f.projection.updateSettings();
    assert.equal(f.root.querySelector('[data-line-index="3"]'),row);assert(parseFloat(row.style.top)>before);
    settings.lyricMode='off';f.projection.updateSettings();assert([...f.root.querySelectorAll('.pulse-lyric-row')].every(node=>node.hidden));assert.equal(f.frames.size,0);
    settings.lyricMode='immersive';f.projection.updateSettings();assert.equal(row.hidden,false);
  }finally{f.dispose();}
});

test('both progress response and motion softness change interpolation while native word timing stays exact',()=>{
  function step(softness){const f=fixture({lyricProgressEase:.18,lyricMotionSoftness:softness});try{
    f.projection.setLines(Array.from({length:20},(_,n)=>({time:n*2,text:'歌词 '+n})));f.projection.activate();f.play();f.frame(8.1);return f.projection.getState().offset;
  }finally{f.dispose();}}
  assert.notEqual(step(.1),step(1));
});

test('clearing the song while inactive cannot restore stale lyric lines',async()=>{
  const {create:createLyrics}=require('../ui/music/lyrics.js'),dom=new JSDOM('<div id="lyrics"></div>',{url:'https://local.test',pretendToBeVisual:true}),root=dom.window.document.getElementById('lyrics');
  const lyrics=createLyrics({root,api:async()=>({lines:[{time:0,text:'先前歌曲'}]})});
  try{lyrics.activate();await lyrics.setSong({id:'1'});assert.equal(lyrics.getState().lines,1);lyrics.deactivate();await lyrics.setSong(null);lyrics.activate();assert.equal(lyrics.getState().lines,0);assert(!root.textContent.includes('先前歌曲'));}
  finally{lyrics.dispose();dom.window.close();}
});

test('even requested line counts show the exact number at beginning, middle and end',()=>{
  const f=fixture({lyricLines:10});try{f.projection.setLines(Array.from({length:100},(_,n)=>({time:n*2,text:'歌词 '+n})));f.projection.activate();
    for(const value of [0,90,199]){f.audio.currentTime=value;f.projection.time(value);assert.equal(f.root.querySelectorAll('.pulse-lyric-row:not(.is-outside-window)').length,10);assert(f.projection.getState().rendered<=17);}
  }finally{f.dispose();}
});

test('late lyric metadata keeps an unloaded restored position through settings, visibility and pause updates',async()=>{
  const {create:createLyrics}=require('../ui/music/lyrics.js'),dom=new JSDOM('<div id="lyrics"></div><audio></audio>',{url:'https://local.test',pretendToBeVisual:true}),root=dom.window.document.getElementById('lyrics'),audio=dom.window.document.querySelector('audio');let finish;
  const lyrics=createLyrics({root,api:()=>new Promise(resolve=>{finish=resolve;})});lyrics.attachPlayer({getAudio:()=>audio});
  try{lyrics.activate();const pending=lyrics.setSong({id:'123'});lyrics.time(63.5);finish({lines:[{time:0,text:'开头'},{time:60,text:'恢复的位置'},{time:90,text:'下一句'}]});await pending;assert.equal(audio.currentTime,0);assert(!audio.hasAttribute('src'));assert.equal(lyrics.getState().position,63.5);assert.equal(lyrics.getState().index,1);assert.equal(lyrics.getState().motion.position,63.5);assert.equal(lyrics.getState().motion.index,1);lyrics.setObscured(true);lyrics.setObscured(false);lyrics.deactivate();lyrics.activate();audio.dispatchEvent(new dom.window.Event('pause'));assert.equal(lyrics.getState().motion.index,1);assert.equal(lyrics.getState().motion.position,63.5);audio.src='pulse-music-audio://track/fresh';audio.currentTime=4;lyrics.time(4);assert.equal(lyrics.getState().motion.index,0);assert.equal(lyrics.getState().motion.position,4);}finally{lyrics.dispose();dom.window.close();}
});

test('every context distance scales and fades progressively while the current line keeps authored size',()=>{
  const f=fixture({lyricLines:15,lyricContextOpacity:.64});try{
    f.projection.setLines(Array.from({length:60},(_,n)=>({time:n*2,text:'歌词 '+n})));f.audio.currentTime=40;f.projection.activate();
    const current=f.root.querySelector('[data-line-index="20"]');assert.equal(current.querySelector('.pulse-lyric-row-body').style.transform,'scale(1)');assert.equal(current.style.opacity,'1');
    let lastScale=1,lastAlpha=1;
    for(let distance=1;distance<=6;distance++){
      const before=f.root.querySelector(`[data-line-index="${20-distance}"]`),after=f.root.querySelector(`[data-line-index="${20+distance}"]`),style=contextStyle(distance,.64);
      const body=after.querySelector('.pulse-lyric-row-body');assert.equal(body.style.transform,`scale(${style.scale})`);assert.equal(before.querySelector('.pulse-lyric-row-body').style.transform,body.style.transform);
      assert(style.scale<lastScale);assert(style.opacity<lastAlpha);lastScale=style.scale;lastAlpha=style.opacity;
    }
    assert.equal(contextStyle(100,.64).scale,.62);assert.equal(contextStyle(100,.64).opacity,.08);assert.equal(f.root.style.fontSize,'27px');
  }finally{f.dispose();}
});

test('line changes reuse both neighboring nodes and restore the new current line to scale one',()=>{
  const f=fixture();try{
    f.projection.setLines(Array.from({length:30},(_,n)=>({time:n*2,text:'歌词 '+n})));f.audio.currentTime=20;f.projection.activate();
    const old=f.root.querySelector('[data-line-index="10"]'),next=f.root.querySelector('[data-line-index="11"]');
    f.audio.currentTime=22.1;f.projection.time(22.1);assert.equal(f.root.querySelector('[data-line-index="10"]'),old);assert.equal(f.root.querySelector('[data-line-index="11"]'),next);
    assert.equal(old.querySelector('.pulse-lyric-row-body').style.transform,'scale(0.9)');assert.equal(next.querySelector('.pulse-lyric-row-body').style.transform,'scale(1)');
    assert.equal(f.root.dataset.lyricMotion,'true');assert.equal(f.frames.size,0,'paused lyrics use CSS transitions without a running frame loop');
  }finally{f.dispose();}
});

test('old saved font and custom colors survive context changes and reduced-motion updates',()=>{
  const settings={fontSize:33,lyricColorMode:'custom',lyricColor:'#b0c8da',lyricHighlightMode:'custom',lyricHighlightColor:'#ffd89a',lyricMotion:false},f=fixture(settings);try{
    f.root.style.fontSize='33px';f.root.style.setProperty('--lyric-user-base',settings.lyricColor);f.root.style.setProperty('--lyric-user-highlight',settings.lyricHighlightColor);
    f.projection.setLines(Array.from({length:30},(_,n)=>({time:n*2,text:'歌词 '+n})));f.audio.currentTime=20;f.projection.activate();f.audio.currentTime=24;f.projection.time(24);f.projection.updateSettings();
    assert.equal(f.root.style.fontSize,'33px');assert.equal(f.root.style.getPropertyValue('--lyric-user-base'),'#b0c8da');assert.equal(f.root.style.getPropertyValue('--lyric-user-highlight'),'#ffd89a');assert.equal(settings.fontSize,33);assert.equal(f.root.dataset.lyricMotion,'false');
    assert.equal(f.root.querySelector('.is-current .pulse-lyric-row-body').style.transform,'scale(1)');assert.equal(f.frames.size,0);
  }finally{f.dispose();}
});

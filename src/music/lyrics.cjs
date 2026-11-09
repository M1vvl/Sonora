'use strict';
// Bounded LRC / native YRC projection. Native word timestamps are never
// inferred from ordinary LRC text. YRC timing normalization is adapted from
// MineRadio 06-lyrics/00-lyrics-fetch-parse.js (GPL-3.0, see notices).
function isLyricText(value){
  const text=String(value||'').trim();
  if(!text||/^(?:纯音乐[，,、\s]*(?:请欣赏)?|instrumental|no lyrics)$/i.test(text))return false;
  if(/^\{/.test(text)){
    try{const data=JSON.parse(text);if(data&&typeof data==='object'&&(Array.isArray(data.c)||Object.hasOwn(data,'t')||Object.hasOwn(data,'tx')))return false;}catch{}
    // Some older clients have already stripped JSON arrays as if they were
    // LRC tags. Do not render those damaged metadata fragments as a verse.
    if(/^\{\s*["']?(?:c|t|tx)["']?\s*(?::[\s\S]*)?\}$/i.test(text))return false;
  }
  return true;
}
function lyricText(row){
  const timed=row.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g,'').trim();
  if(!isLyricText(timed))return '';
  const text=timed.replace(/\[[^\]]*\]/g,'').trim().slice(0,500);
  return isLyricText(text)?text:'';
}
function parseLyrics(body={}){
  const raw=String(body.lrc?.lyric||'').slice(0,100000),translation=String(body.tlyric?.lyric||'').slice(0,100000);
  function parse(value){
    const lines=[];let offset=0;
    const match=/\[offset:([+-]?\d+)\]/i.exec(value);if(match)offset=Math.max(-30000,Math.min(30000,Number(match[1])))/1000;
    for(const row of value.split(/\r?\n/).slice(0,1600)){
      const stamps=[...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const text=lyricText(row);if(!text)continue;
      for(const stamp of stamps){const time=Number(stamp[1])*60+Number(stamp[2])+Number('0.'+(stamp[3]||'0'))+offset;if(time>=0&&time<=86400)lines.push({time,text});}
      if(lines.length>=1200)break;
    }
    return lines.sort((a,b)=>a.time-b.time).slice(0,1200);
  }
  const native=[];let wordBudget=12000;
  for(const row of String(body.yrc?.lyric||'').slice(0,256000).split(/\r?\n/).slice(0,1600)){
    const match=/^\[(\d+),(\d+)\](.*)$/.exec(row);if(!match)continue;
    const start=Number(match[1]),duration=Number(match[2]);if(start>86400000||duration>86400000)continue;
    let text='';const words=[];
    const tokens=[...match[3].matchAll(/\((\d+),(\d+),\d+\)/g)].slice(0,200);
    for(let index=0;index<tokens.length;index++){
      const token=tokens[index];if(wordBudget<=0||text.length>=500)break;
      const fragment=match[3].slice(token.index+token[0].length,tokens[index+1]?.index).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,500-text.length);if(!fragment)continue;
      const rawStart=Number(token[1]),absolute=rawStart>=start-500?rawStart:start+rawStart;
      const c0=text.length;text+=fragment;
      if(absolute<=86400000){words.push({text:fragment,time:absolute/1000,duration:Math.max(.06,Math.min(86400,Number(token[2])/1000)),c0,c1:text.length});wordBudget--;}
    }
    if(!text)text=match[3].replace(/\(\d+,\d+,\d+\)/g,'').slice(0,500);
    const leading=text.length-text.trimStart().length;text=text.trim();if(!isLyricText(text))continue;
    const bounded=words.map(word=>({...word,c0:Math.max(0,word.c0-leading),c1:Math.min(text.length,Math.max(0,word.c1-leading))})).filter(word=>word.c1>word.c0);
    native.push({time:start/1000,duration:duration/1000,text,...(bounded.length?{words:bounded}:{})});if(native.length>=1200)break;
  }
  const lines=native.length?native.sort((a,b)=>a.time-b.time):parse(raw),translatedLines=parse(translation||String(body.ytlrc?.lyric||'').slice(0,100000));
  for(const line of lines){const translated=translatedLines.find(value=>Math.abs(value.time-line.time)<.06);if(translated&&translated.text!==line.text)line.translation=translated.text;}
  const instrumental=body.nolyric===true||body.pureMusic===true;
  return {lines:instrumental?[]:lines,timingSource:instrumental?'unsynced':native.some(line=>line.words?.length)?'yrc-word':native.length?'yrc-line':lines.length?'lrc-line':'unsynced',instrumental,unsynced:instrumental||lines.length?'':raw.split(/\r?\n/).map(lyricText).filter(Boolean).join('\n').slice(0,12000)};
}
module.exports={parseLyrics,isLyricText};

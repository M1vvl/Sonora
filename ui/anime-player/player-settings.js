(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulsePlayerSettings=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const DEFAULTS=Object.freeze({superResolution:'quality',outputResolution:'2160p',aspect:'contain',speed:1,volume:100,mute:false,brightness:0,contrast:0,saturation:0,gamma:0});
  const SR_MODES=Object.freeze([{value:'off',label:'关闭'},{value:'efficiency',label:'效率档'},{value:'quality',label:'质量档'}].map(Object.freeze));
  const OUTPUT_MODES=Object.freeze([{value:'auto',label:'自动'},{value:'1080p',label:'1080p',width:1920,height:1080},{value:'1440p',label:'2K · 1440p',width:2560,height:1440},{value:'2160p',label:'4K · 2160p',width:3840,height:2160}].map(Object.freeze));
  const ASPECTS=Object.freeze([{value:'contain',label:'适应画面'},{value:'cover',label:'填满画面'},{value:'fill',label:'拉伸填充'},{value:'16:9',label:'16:9'},{value:'4:3',label:'4:3'}].map(Object.freeze));
  const SPEEDS=Object.freeze(Array.from({length:12},(_,index)=>(index+1)/4));
  const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
  function normalize(value={},base=DEFAULTS){
    if(!value||typeof value!=='object'||Array.isArray(value))value={};
    const result={...DEFAULTS,...base};
    if(SR_MODES.some(mode=>mode.value===value.superResolution))result.superResolution=value.superResolution;
    if(OUTPUT_MODES.some(mode=>mode.value===value.outputResolution))result.outputResolution=value.outputResolution;
    if(ASPECTS.some(aspect=>aspect.value===value.aspect))result.aspect=value.aspect;
    for(const name of ['brightness','contrast','saturation','gamma'])if(Object.hasOwn(value,name))result[name]=Math.round(clamp(value[name],-100,100,result[name]));
    if(Object.hasOwn(value,'speed'))result.speed=clamp(value.speed,0.25,3,result.speed);
    if(Object.hasOwn(value,'volume'))result.volume=Math.round(clamp(value.volume,0,100,result.volume));
    if(typeof value.mute==='boolean')result.mute=value.mute;
    return result;
  }
  function time(value){const seconds=Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;const h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=seconds%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
  return {DEFAULTS,SR_MODES,OUTPUT_MODES,ASPECTS,SPEEDS,normalize,time};
});

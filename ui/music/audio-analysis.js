(function(host,factory){'use strict';const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else host.PulseMusicAudioAnalysis=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // One graph per existing audio element, shared by the small lyric material
  // and immersive renderer. No sampler timer and no additional audio source.
  const graphs=new WeakMap();
  // MineRadio uses a 2048-point FFT and .58 smoothing; retain one shared graph.
  const FFT_SIZE=2048;
  function acquire(audio,{onNotice=()=>{}}={}){
    if(!audio?.ownerDocument)throw new TypeError('Audio analysis needs the current audio element');
    let graph=graphs.get(audio);
    if(!graph){
      const view=audio.ownerDocument.defaultView;let context=null,source=null,analyser=null,refs=0,closed=false,failed=false,last=-Infinity;
      const bins=new Uint8Array(FFT_SIZE/2),wave=new Float32Array(FFT_SIZE),result={bins,energy:0,rms:0,bass:0,mid:0,treble:0,sampleRate:44100,fftSize:FFT_SIZE,contextState:null,contextTime:0};
      const updateState=()=>{result.sampleRate=context?.sampleRate||44100;result.fftSize=analyser?.fftSize||FFT_SIZE;result.contextState=context?.state||null;result.contextTime=context?.currentTime||0;return result;};
      function clear(){bins.fill(0);result.energy=result.rms=result.bass=result.mid=result.treble=0;return updateState();}
      function resume(){if(context&&!audio.paused&&context.state!=='closed')context.resume().catch(()=>{});}
      function pause(){if(context&&audio.paused&&context.state!=='closed')context.suspend().catch(()=>{});clear();}
      function close(){if(closed)return;closed=true;source?.disconnect();analyser?.disconnect();context?.close().catch(()=>{});source=analyser=null;audio.removeEventListener('playing',resume);audio.removeEventListener('pause',pause);audio.removeEventListener('emptied',empty);clear();}
      function empty(){clear();}
      audio.addEventListener('playing',resume);audio.addEventListener('pause',pause);audio.addEventListener('emptied',empty);
      graph={
        retain(){refs++;},
        ensure(){if(closed||failed)return false;if(context){resume();return true;}try{const Context=view.AudioContext||view.webkitAudioContext;if(!Context)return false;context=new Context();analyser=context.createAnalyser();analyser.fftSize=FFT_SIZE;analyser.smoothingTimeConstant=.58;source=context.createMediaElementSource(audio);source.connect(analyser);analyser.connect(context.destination);resume();return true;}catch{failed=true;context?.close().catch(()=>{});context=null;source=analyser=null;onNotice('当前音源无法分析频谱，保留静态视觉。');return false;}},
        sample(time=view.performance.now()){
          if(!analyser||closed||audio.paused||audio.muted||audio.volume===0)return clear();
          if(time-last<1000/30)return updateState();last=time;
          analyser.getByteFrequencyData(bins);analyser.getFloatTimeDomainData(wave);let power=0,rms=0,bass=0,mid=0,high=0,bn=0,mn=0,hn=0;
          for(let i=0;i<wave.length;i++)rms+=wave[i]*wave[i];result.rms=Math.sqrt(rms/wave.length);
          for(let i=0;i<bins.length;i++){const n=bins[i]/255,f=i*context.sampleRate/FFT_SIZE;power+=n*n;if(f>=40&&f<280){bass+=n*n;bn++;}else if(f<2500){mid+=n*n;mn++;}else if(f<12000){high+=n*n;hn++;}}
          result.energy=Math.sqrt(power/bins.length);result.bass=Math.sqrt(bass/Math.max(1,bn));result.mid=Math.sqrt(mid/Math.max(1,mn));result.treble=Math.sqrt(high/Math.max(1,hn));
          // FFT smoothing has a tail. A silent time-domain buffer is the source
          // of truth rather than presenting that tail as current output.
          if(result.rms<.00001)clear();return updateState();
        },
        resume,
        release({final=false}={}){refs=Math.max(0,refs-1);if(refs===0&&final)close();},
        getState:()=>({...updateState(),bins:bins.length,references:refs,available:!!analyser,closed})
      };graphs.set(audio,graph);
    }
    graph.retain();let released=false;
    return {ensure:()=>!released&&graph.ensure(),sample:time=>graph.sample(time),resume:()=>graph.resume(),getState:()=>graph.getState(),release(options){if(released)return;released=true;graph.release(options);}};
  }
  return {acquire};
});

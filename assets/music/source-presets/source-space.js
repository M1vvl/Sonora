/* MineRadio GPL-3.0 host adaptation. Source 11-main-loop.js supplies the band
 * peak normalization and attack/release used by Emily below.
 * No audio source, timer, second WebGL context or alternative lyric shader.
 * Emily shaders and retained lyric algorithms keep their source provenance. */
(function(host){
  'use strict';
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,finite(v,min)));
  const peaks={bass:.03,mid:.026,treble:.018,energy:.03};
  const smooth={bass:0,mid:0,treble:0,energy:0};
  let pulse=0,previousEnergy=0,lastKey='',lastSignal=null;
  function bandRms(bins,sampleRate,fftSize,low,high){
    if(!bins?.length)return null;
    // MineRadio beatBandRms includes the bins bracketing the requested band
    // and excludes DC. Inward rounding drops the entire 38–74Hz sub-kick
    // band at a coarse FFT, making the cover react to other bands instead.
    const start=Math.max(1,Math.floor(low*fftSize/sampleRate)),end=Math.min(bins.length-1,Math.ceil(high*fftSize/sampleRate));
    let sum=0,count=0;for(let i=start;i<=end;i++){const x=clamp(bins[i]/255,0,1);sum+=x*x;count++;}
    return Math.sqrt(sum/Math.max(1,count));
  }
  function project(frame,dt=1/60,preset=0){
    const raw=frame.audio||{},s=frame.settings||{},key=[frame.time,frame.position,frame.playing,preset].join('|');
    if(lastSignal&&key===lastKey)return lastSignal;lastKey=key;
    const step=clamp(dt,.001,.1),ticks=step*60,live=frame.playing!==false&&finite(raw.rms,finite(raw.energy))>.00001;
    if(live){
      const bins=raw.bins,sr=finite(raw.sampleRate,44100),fft=finite(raw.fftSize,(bins?.length||256)*2);
      const sub=bandRms(bins,sr,fft,38,74),core=bandRms(bins,sr,fft,52,165),body=bandRms(bins,sr,fft,165,420);
      const kick=core===null?clamp(raw.bass,0,1):Math.min(1,core*.86+sub*.42+body*.10);
      const instrument=bandRms(bins,sr,fft,2600,6200)??clamp(raw.mid,0,1);
      const high=bandRms(bins,sr,fft,6200,Math.min(16000,sr/2))??clamp(raw.treble,0,1);
      const energy=clamp(raw.rms??raw.energy,0,1);
      peaks.bass=Math.max(peaks.bass*Math.pow(.994,ticks),kick,.030);
      peaks.mid=Math.max(peaks.mid*Math.pow(.993,ticks),instrument,.026);
      peaks.treble=Math.max(peaks.treble*Math.pow(.992,ticks),high,.018);
      peaks.energy=Math.max(peaks.energy*Math.pow(.995,ticks),energy,.030);
      const rb=Math.min(1,Math.pow(kick/Math.max(.038,peaks.bass*.66),.78));
      const rm=Math.min(1,Math.pow(instrument/Math.max(.025,peaks.mid*.70),.86));
      const rt=Math.min(1,Math.pow(high/Math.max(.020,peaks.treble*.74),.92));
      const re=Math.min(1,Math.pow(energy/Math.max(.034,peaks.energy*.68),.82));
      const bassOnset=Math.max(0,rb-smooth.bass),energyOnset=Math.max(0,re-previousEnergy);
      previousEnergy+=(re-previousEnergy)*(1-Math.pow(.88,ticks));
      // Parent onset is measured from the same real analyser. MineRadio's
      // conservative un-locked beat fallback supplements it; no synthetic beat.
      const fallback=bassOnset>.075&&rb>.32&&energyOnset>.020?Math.min(.12,bassOnset*.18):0;
      pulse=Math.max(pulse,clamp(raw.beat??raw.kickEnvelope,0,1),fallback)*Math.pow(.36,step);
      const envelope=(name,next,attack,release)=>{const k=next>smooth[name]?attack:release;smooth[name]+=(next-smooth[name])*(1-Math.pow(1-k,ticks));};
      envelope('bass',Math.min(.82,rb*.78+re*.025),.28,.075);
      envelope('mid',Math.min(.68,rm*.64+re*.025),.18,.060);
      envelope('treble',Math.min(.56,rt*.54),.18,.055);
      envelope('energy',Math.min(.72,re),.16,.055);
    }else{
      for(const key of Object.keys(smooth))smooth[key]*=Math.pow(.91,Math.max(1,ticks));
      pulse*=Math.pow(.82,Math.max(1,ticks));
    }
    const intensity=clamp(s.intensity??.85,0,2);
    let b=Math.min(.90,smooth.bass*1.05+pulse*.18)*intensity;
    let m=Math.min(.72,smooth.mid*1.12)*intensity,t=Math.min(.62,smooth.treble*1.20)*intensity,beat=pulse;
    if (preset === 7) {
      // Original 11-main-loop.js preset-7 frequency separation and gains.
      const ringBass = smooth.bass * 1.58 + beat * .42 - smooth.mid * .16 - smooth.treble * .06;
      const ringMid = smooth.mid * 1.82 - smooth.bass * .14 - smooth.treble * .07;
      const ringTreble = smooth.treble * 2.28 - smooth.mid * .10 - smooth.bass * .05;
      b = Math.pow(clamp((ringBass - .050) / .58, 0, 1), .72) * intensity;
      m = Math.pow(clamp((ringMid - .045) / .46, 0, 1), .78) * intensity;
      t = Math.pow(clamp((ringTreble - .030) / .34, 0, 1), .84) * intensity;
    }
    lastSignal={...raw,bass:b,mid:m,treble:t,beat,energy:Math.max(smooth.energy,beat*.30),sourceProjected:true};
    return lastSignal;
  }
  host.PulseSourceAudio={project,bandRms};
  const visualScene=scene,visualCamera=camera,lyricScene=new THREE.Scene(),lyricCamera=new THREE.PerspectiveCamera(42,1,.1,100),lyricAnchor=new THREE.Group();
  lyricCamera.position.set(0,0,7.6);lyricCamera.lookAt(0,0,0);lyricScene.add(lyricAnchor);
  let visualScale=1,lyricScale=1,lastFrame={},renderCount=0,disposed=false;
  function prepare(frame={},dt=1/60,preset=0){
    if(disposed)return frame;lastFrame=frame;
    visualScale=clamp(frame.settings?.visualScale??1,.55,1.65);
    lyricScale=clamp(frame.settings?.lyricScale??1,.55,1.65);
    visualScene.scale.setScalar(visualScale);
    const width=Math.max(1,finite(frame.width,960)),height=Math.max(1,finite(frame.height,540));
    if(lyricCamera.aspect!==width/height){lyricCamera.aspect=width/height;lyricCamera.updateProjectionMatrix();}
    lyricAnchor.rotation.set(finite(frame.lyricPitch),finite(frame.lyricYaw),0);
    return {...frame,audio:frame.audio?.sourceProjected?frame.audio:project(frame,dt,preset)};
  }
  function withLyrics(frame,callback){
    // The upstream lyrics use global camera/scene/particles and intentionally
    // use scene/camera globals. Supply a separate, neutral lyric space
    // for those globals without rewriting any of the source mesh/shader code.
    const saved={scene,camera,particles,preset:fx.preset,independent:pulseSourceLyricHost.independentSpace};
    try{
      scene=lyricScene;camera=lyricCamera;particles=lyricAnchor;
      pulseSourceLyricHost.independentSpace=true;fx.preset=0;
      return callback();
    }finally{
      if(stageLyrics.group&&stageLyrics.group.parent!==lyricScene)lyricScene.add(stageLyrics.group);
      scene=saved.scene;camera=saved.camera;particles=saved.particles;
      fx.preset=saved.preset;pulseSourceLyricHost.independentSpace=saved.independent;
    }
  }
  function updateLyrics(frame={},dt=1/60){return withLyrics(frame,()=>host.PulseSourceLyrics?.update(frame,dt));}
  function render(){
    if(disposed)return;const autoClear=renderer.autoClear;
    try{renderer.autoClear=true;renderer.render(visualScene,visualCamera);renderer.autoClear=false;renderer.clearDepth();renderer.render(lyricScene,lyricCamera);renderCount++;}
    finally{renderer.autoClear=autoClear;}
  }
  function dispose(){if(disposed)return;withLyrics(lastFrame,()=>host.PulseSourceLyrics?.dispose());lyricScene.clear();disposed=true;}
  function getState(){return {independentLyrics:true,visualScale,lyricScale,renderCount,visualScene:visualScene.uuid,lyricScene:lyricScene.uuid,lyricYaw:lyricAnchor.rotation.y,lyricPitch:lyricAnchor.rotation.x};}
  host.PulseSourceSpace={prepare,withLyrics,updateLyrics,render,dispose,getState};
})(window);

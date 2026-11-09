(function(host,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else host.PulseMusicCards=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const MAX_RENDER=384,MAX_TEXTURE=512,RESPONSE=.3,OMEGA=2*Math.PI/RESPONSE;
  const VERTEX='attribute vec2 aPosition;varying vec2 vUV;void main(){vUV=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}';
  // These are cover-derived environment reflections, never camera/desktop pixels.
  // Gaussian filtering occurs twice only when a new texture is uploaded.
  const BLUR=`precision mediump float;varying vec2 vUV;uniform sampler2D uImage;uniform vec2 uStep;
    void main(){vec4 c=texture2D(uImage,vUV)*.227027;
    c+=(texture2D(uImage,vUV+uStep*1.384615)+texture2D(uImage,vUV-uStep*1.384615))*.316216;
    c+=(texture2D(uImage,vUV+uStep*3.230769)+texture2D(uImage,vUV-uStep*3.230769))*.070270;
    gl_FragColor=c;}`;
  const SURFACE=`precision mediump float;varying vec2 vUV;uniform sampler2D uCover;uniform sampler2D uEnvironment;
    uniform vec2 uTilt;uniform vec2 uResolution;
    float hash(vec2 p){vec3 h=fract(vec3(p.xyx)*.1031);h+=dot(h,h.yzx+33.33);return fract((h.x+h.y)*h.z);}
    void main(){
      vec2 uv=vec2(vUV.x,1.-vUV.y),p=uv-.5;float radius=.082;
      vec2 q=abs(p)-vec2(.5-radius);float distance=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
      float aa=1.5/min(uResolution.x,uResolution.y),coverage=1.-smoothstep(-aa,aa,distance);
      if(coverage<=0.)discard;
      float depth=max(0.,-distance),bevel=1.-smoothstep(0.,.036,depth);
      vec2 outward=sign(p)*normalize(max(q,vec2(.0001)));
      if(q.x<0.&&q.y<0.)outward=abs(p.x)>abs(p.y)?vec2(sign(p.x),0.):vec2(0.,sign(p.y));
      vec2 noise=vec2(hash(uv*512.),hash(uv.yx*503.+17.))-.5;
      vec3 n=normalize(vec3(outward*bevel*.72+noise*.008,1.));
      float cx=cos(uTilt.y),sx=sin(uTilt.y),cy=cos(uTilt.x),sy=sin(uTilt.x);
      n=mat3(cy,0.,-sy,0.,1.,0.,sy,0.,cy)*mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx)*n;
      vec3 reflected=reflect(vec3(0.,0.,-1.),n);
      vec2 envUV=clamp(.5+vec2(reflected.x,-reflected.y)/max(abs(reflected.z),.28)*.32,0.,1.);
      vec3 environment=texture2D(uEnvironment,envUV).rgb;
      vec3 cover=texture2D(uCover,uv).rgb;
      float broad=pow(max(dot(normalize(reflected),normalize(vec3(-.45,-.55,.82))),0.),9.);
      float rim=1.-smoothstep(.002,.009,depth);
      float fresnel=.04+.96*pow(1.-max(dot(n,vec3(0.,0.,1.)),0.),5.);
      vec3 metal=environment*.67+vec3(.2)+vec3(broad*.52);
      vec3 color=mix(cover*.985,metal,bevel*.76);
      color+=environment*(.025+fresnel*.1)+vec3(broad*.04+rim*.25);
      color-=vec3((smoothstep(.009,.016,depth)-smoothstep(.016,.026,depth))*.08);
      color+=vec3((hash(uv*512.)-.5)*.008);
      gl_FragColor=vec4(clamp(color,0.,1.),coverage);
    }`;
  function springStep(position,velocity,target,delta){
    const dt=Math.max(0,Math.min(.05,delta)),offset=position-target,c=velocity+OMEGA*offset,decay=Math.exp(-OMEGA*dt);
    return {position:target+(offset+c*dt)*decay,velocity:(velocity-OMEGA*c*dt)*decay};
  }
  function safeCover(value){
    if(typeof value!=='string'||value.length>16384)return '';
    try{const url=new URL(value);return url.protocol==='pulse-music-image:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
  }
  function normalizeItems(items){
    if(!Array.isArray(items))return [];
    const out=[],seen=new Set();
    for(const value of items.slice(0,530)){
      if(!value||typeof value!=='object')continue;
      const id=String(value.id??'').slice(0,120);if(!id||seen.has(id))continue;
      seen.add(id);out.push({id,title:String(value.title||'未命名歌曲').slice(0,160),artist:String(value.artist||'').slice(0,160),coverURL:safeCover(value.coverURL)});
      if(out.length===530)break;
    }
    return out;
  }
  function create({root,onActivate,onError,diagnostic=false}={}){
    if(!root?.ownerDocument)throw new TypeError('Music cards need a root');
    const document=root.ownerDocument,view=document.defaultView,removers=[];
    let items=[],active=false,disposed=false,intersecting=true,frame=null,lastTime=null,drag=null,phase='idle',generation=0,exitReverse=false,pendingItems=null;
    let gpu=null,canvas=null,resizeObserver=null,intersectionObserver=null,failed=false,uploads=0,draws=0,cardWidth=240,resizeFrame=null,resizeTimer=null;
    const reduced=view.matchMedia?.('(prefers-reduced-motion: reduce)'),fine=view.matchMedia?.('(any-hover: hover) and (any-pointer: fine)');
    const channels={x:0,y:0,tiltX:0,tiltY:0,angle:0,scale:1,opacity:1},target={...channels},velocity=Object.fromEntries(Object.keys(channels).map(key=>[key,0]));
    root.classList.add('music-cards');root.setAttribute('data-no-window-drag','');
    root.innerHTML='<div class="music-cards-stack"><div class="music-cover-back music-cover-fifth" aria-hidden="true"><img alt="" draggable="false"></div><div class="music-cover-back music-cover-fourth" aria-hidden="true"><img alt="" draggable="false"></div><div class="music-cover-back music-cover-third" aria-hidden="true"><img alt="" draggable="false"></div><div class="music-cover-back music-cover-second" aria-hidden="true"><img alt="" draggable="false"></div><button class="music-cover-front" type="button" aria-label="暂无歌曲" disabled><img class="music-cover-fallback" alt="" draggable="false"><span class="music-cover-empty" aria-hidden="true">♫</span><span class="music-cover-caption"><strong></strong><small></small></span></button></div><p class="music-cards-instruction"><span class="music-card-gesture" aria-live="polite"></span><span class="music-recommendation-mode"></span></p>';
    const stack=root.querySelector('.music-cards-stack'),front=root.querySelector('.music-cover-front'),fallback=root.querySelector('.music-cover-fallback'),caption=front.querySelector('strong'),artist=front.querySelector('small'),empty=front.querySelector('.music-cover-empty'),instruction=root.querySelector('.music-card-gesture');
    const backs=[root.querySelector('.music-cover-second'),root.querySelector('.music-cover-third'),root.querySelector('.music-cover-fourth'),root.querySelector('.music-cover-fifth')];
    const on=(node,name,handler,options)=>{node.addEventListener(name,handler,options);removers.push(()=>node.removeEventListener(name,handler,options));};
    const visible=()=>active&&!disposed&&intersecting&&document.visibilityState!=='hidden';
    const width=()=>cardWidth;
    function measure(){
      const bounds=root.getBoundingClientRect();
      if(bounds.width>0&&bounds.height>0){const depth=Math.max(0,Math.min(4,items.length-1)),angle=depth*3*Math.PI/180,edge=.5+(1-depth*.02)*(.5*Math.cos(angle)+.55*Math.sin(angle)),fitted=Math.max(120,Math.min(256,(bounds.width-8-depth*14)/edge,bounds.height-64));stack.style.width=`${fitted}px`;stack.style.marginLeft=`${Math.max(1,bounds.width-(depth*14+fitted*edge)-1)}px`;cardWidth=fitted;}
      else cardWidth=Math.max(1,stack.getBoundingClientRect().width||240);
    }
    function cancelDrag(){const id=drag?.id;drag=null;if(id!==undefined)try{front.releasePointerCapture?.(id);}catch{}}
    function notify(error){try{onError?.(error instanceof Error?error:new Error(String(error)));}catch{}}
    function warn(error){if(failed)return;failed=true;notify(error);}
    function cancelFrame(){if(frame!==null)view.cancelAnimationFrame(frame);frame=null;lastTime=null;}
    function cancelResize(){if(resizeFrame!==null)view.cancelAnimationFrame(resizeFrame);if(resizeTimer!==null)view.clearTimeout(resizeTimer);resizeFrame=resizeTimer=null;}
    function scheduleResize(){
      if(!visible()||resizeFrame!==null||resizeTimer!==null)return;
      const finish=()=>{cancelResize();if(!visible())return;measure();sizeCanvas();schedule();};
      resizeFrame=view.requestAnimationFrame(finish);resizeTimer=view.setTimeout(finish,50);
    }
    function dropGPU(){
      if(!gpu){canvas?.remove();canvas=null;return;}
      const {gl,textures,framebuffers,programs,buffer,lostCallback}=gpu;gpu=null;
      if(lostCallback)canvas?.removeEventListener('webglcontextlost',lostCallback);
      for(const texture of textures)gl.deleteTexture(texture);for(const fb of framebuffers)gl.deleteFramebuffer(fb);for(const program of programs)gl.deleteProgram(program);gl.deleteBuffer(buffer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();canvas?.remove();canvas=null;front.classList.remove('has-metal-renderer');
    }
    function program(gl,fragment){
      const shaders=[];let result=null;
      try{
        for(const [kind,source]of [[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(kind);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('封面材质着色器不可用');}
        result=gl.createProgram();for(const shader of shaders)gl.attachShader(result,shader);gl.linkProgram(result);if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw new Error('封面材质程序不可用');return result;
      }catch(error){if(result)gl.deleteProgram(result);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
    }
    function ensureGPU(){
      if(gpu||!visible()||!items.length||failed)return gpu;
      canvas=document.createElement('canvas');canvas.className='music-cover-metal';canvas.setAttribute('aria-hidden','true');front.insertBefore(canvas,front.querySelector('.music-cover-caption'));
      let gl;
      try{
        gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
        if(!gl)throw new Error('当前设备使用原生封面材质');
        gpu={gl,textures:[],framebuffers:[],programs:[],buffer:null,cover:null,environment:null,ready:false};
        gpu.surface=program(gl,SURFACE);gpu.programs.push(gpu.surface);gpu.blur=program(gl,BLUR);gpu.programs.push(gpu.blur);
        gpu.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,gpu.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
        for(let i=0;i<3;i++){const texture=gl.createTexture();gpu.textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
        gpu.cover=gpu.textures[0];gpu.environment=gpu.textures[2];
        for(let i=1;i<3;i++){gl.bindTexture(gl.TEXTURE_2D,gpu.textures[i]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,null);const fb=gl.createFramebuffer();gpu.framebuffers.push(fb);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,gpu.textures[i],0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('封面材质缓冲不可用');}
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);sizeCanvas();
        const ownedCanvas=canvas;gpu.lostCallback=event=>{event.preventDefault();if(canvas!==ownedCanvas||!gpu)return;dropGPU();warn(new Error('封面材质已降级'));};ownedCanvas.addEventListener('webglcontextlost',gpu.lostCallback);
        return gpu;
      }catch(error){dropGPU();warn(error);return null;}
    }
    function use(gl,shader){gl.useProgram(shader);gl.bindBuffer(gl.ARRAY_BUFFER,gpu.buffer);const location=gl.getAttribLocation(shader,'aPosition');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);}
    function sizeCanvas(){if(!gpu||!canvas)return;measure();const size=Math.max(1,Math.min(MAX_RENDER,Math.round(width()*Math.min(1.5,view.devicePixelRatio||1))));if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}draw();}
    function upload(){
      if(!visible()||!items[0]?.coverURL||fallback.getAttribute('src')!==items[0].coverURL||!fallback.complete||!fallback.naturalWidth)return;
      const renderer=ensureGPU();if(!renderer)return;
      try{
        const scratch=document.createElement('canvas');scratch.width=scratch.height=MAX_TEXTURE;const ctx=scratch.getContext('2d');if(!ctx)throw new Error('封面纹理不可用');
        const side=Math.min(fallback.naturalWidth,fallback.naturalHeight);ctx.drawImage(fallback,(fallback.naturalWidth-side)/2,(fallback.naturalHeight-side)/2,side,side,0,0,MAX_TEXTURE,MAX_TEXTURE);
        const {gl}=renderer;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,renderer.cover);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,scratch);
        use(gl,renderer.blur);gl.uniform1i(gl.getUniformLocation(renderer.blur,'uImage'),0);gl.viewport(0,0,256,256);
        for(let pass=0;pass<2;pass++){gl.bindFramebuffer(gl.FRAMEBUFFER,renderer.framebuffers[pass]);gl.bindTexture(gl.TEXTURE_2D,renderer.textures[pass]);gl.uniform2f(gl.getUniformLocation(renderer.blur,'uStep'),pass===0?1.5/256:0,pass===1?1.5/256:0);gl.drawArrays(gl.TRIANGLES,0,6);}
        if(gl.getError()!==gl.NO_ERROR)throw new Error('封面纹理处理不可用');
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);renderer.ready=true;uploads++;front.classList.add('has-metal-renderer');draw();
      }catch(error){dropGPU();warn(error);}
    }
    function draw(){
      if(!visible()||!gpu?.ready||!canvas)return;const {gl,surface,cover,environment}=gpu;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);use(gl,surface);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,cover);gl.uniform1i(gl.getUniformLocation(surface,'uCover'),0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,environment);gl.uniform1i(gl.getUniformLocation(surface,'uEnvironment'),1);
      gl.uniform2f(gl.getUniformLocation(surface,'uTilt'),channels.tiltX*Math.PI/180,channels.tiltY*Math.PI/180);gl.uniform2f(gl.getUniformLocation(surface,'uResolution'),canvas.width,canvas.height);gl.drawArrays(gl.TRIANGLES,0,6);draws++;
    }
    function paint(){
      front.style.transform=`translate3d(${channels.x.toFixed(3)}px,${channels.y.toFixed(3)}px,0) rotateX(${channels.tiltY.toFixed(3)}deg) rotateY(${channels.tiltX.toFixed(3)}deg) rotateZ(${channels.angle.toFixed(3)}deg) scale(${channels.scale.toFixed(4)})`;
      front.style.opacity=String(channels.opacity);draw();
    }
    function schedule(){if(!visible()||frame!==null)return;frame=view.requestAnimationFrame(step);}
    function settled(){return Object.keys(channels).every(key=>Math.abs(channels[key]-target[key])<.02&&Math.abs(velocity[key])<.1);}
    function snap(){for(const key of Object.keys(channels)){channels[key]=target[key];velocity[key]=0;}paint();}
    function step(time){
      frame=null;if(!visible())return;const dt=lastTime===null?1/60:(time-lastTime)/1000;lastTime=time;
      for(const key of Object.keys(channels)){if(key==='x'&&drag?.moved)continue;const next=springStep(channels[key],velocity[key],target[key],dt);channels[key]=next.position;velocity[key]=next.velocity;}
      paint();
      if(phase==='exit'&&(Math.abs(channels.x)>width()*1.02||settled())){rotate({reverse:exitReverse});return;}
      if(!settled()){schedule();}else{snap();lastTime=null;phase='idle';applyPending();}
    }
    function applyPending(){if(pendingItems&&!drag&&phase==='idle'){const next=pendingItems;pendingItems=null;api.update(next);}}
    function resetTargets(){Object.assign(target,{x:0,y:0,tiltX:0,tiltY:0,angle:0,scale:1,opacity:1});}
    function rotate({immediate=false,reverse=false}={}){
      if(items.length<2)return;const first=reverse?items.pop():items.shift();if(reverse)items.unshift(first);else items.push(first);
      generation++;phase='settle';cancelDrag();resetTargets();render();
      Object.assign(channels,{x:immediate?0:reverse?-18:18,y:immediate?0:-13,tiltX:0,tiltY:0,angle:immediate?0:reverse?-5:5,scale:immediate?1:.96,opacity:1});for(const key of Object.keys(velocity))velocity[key]=0;
      if(immediate){cancelFrame();snap();phase='idle';applyPending();}else{paint();schedule();}
    }
    function cycle({immediate=false,reverse=false}={}){
      if(items.length<2)return;
      if(immediate||reduced?.matches){if(phase==='exit')rotate({immediate:true,reverse:exitReverse});rotate({immediate:true,reverse});return;}
      if(phase==='exit')return;exitReverse=reverse;phase='exit';target.x=width()*1.25*(reverse?1:-1);target.angle=reverse?11:-11;target.opacity=.35;target.tiltX=target.tiltY=0;schedule();
    }
    function render(){
      front.disabled=!items.length;const first=items[0];caption.textContent=first?.title||'';artist.textContent=first?.artist||'';empty.hidden=!!first?.coverURL;
      if(!first)dropGPU();
      front.setAttribute('aria-label',first?`播放 ${first.title}${first.artist?' · '+first.artist:''}`:'暂无歌曲');
      instruction.textContent=items.length>1?'左右拖动封面切换 · 点击播放':first?'点击封面播放':'暂无可显示的歌曲';
      if(gpu)gpu.ready=false;front.classList.remove('has-metal-renderer');
      const setImage=(img,item)=>{img.crossOrigin='anonymous';img.loading='eager';img.decoding='async';img.dataset.cover='card';img.fetchPriority=img===fallback?'high':'auto';if(visible()&&item?.coverURL){if(img.getAttribute('src')!==item.coverURL)img.src=item.coverURL;}else img.removeAttribute('src');};
      setImage(fallback,first);fallback.hidden=!first?.coverURL;
      backs.forEach((node,index)=>{const item=items[index+1];node.hidden=!item;setImage(node.querySelector('img'),item);});
      if(visible())upload();
    }
    function stop(){cancelFrame();cancelResize();cancelDrag();phase='idle';resetTargets();snap();dropGPU();for(const image of root.querySelectorAll('img'))image.removeAttribute('src');}
    function hover(event){if(!visible()||drag||reduced?.matches||event.pointerType==='touch'||(fine?.matches===false&&event.pointerType!=='mouse'))return;const box=front.getBoundingClientRect();target.tiltX=Math.max(-8,Math.min(8,((event.clientX-box.left)/Math.max(1,box.width)-.5)*16));target.tiltY=Math.max(-6,Math.min(6,-((event.clientY-box.top)/Math.max(1,box.height)-.5)*12));schedule();}
    function release(event,cancelled=false){
      if(!drag||event.pointerId!==drag.id)return;const current=drag;drag=null;
      try{front.releasePointerCapture?.(current.id);}catch{}
      if(current.moved){
        suppressClickUntil=view.performance.now()+400;
        const distance=channels.x-current.baseX,committed=Math.abs(distance)>current.width*.22||(Math.abs(distance)>12&&Math.abs(current.velocity)>.6&&Math.sign(current.velocity)===Math.sign(distance));
        if(!cancelled&&items.length>1&&committed){velocity.x=current.velocity*1000;cycle({reverse:distance>0});}else{resetTargets();schedule();}
      }else if(phase==='idle')applyPending();
    }
    let suppressClickUntil=0;
    on(front,'pointerdown',event=>{
      if(!visible()||!items.length||event.button!==0||event.isPrimary===false)return;
      const box=front.getBoundingClientRect();
      if(phase==='exit')rotate({immediate:true,reverse:exitReverse});
      drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,baseX:channels.x,lastX:event.clientX,lastAt:event.timeStamp,width:Math.max(1,box.width),velocity:0,moved:false};
      try{front.setPointerCapture?.(event.pointerId);}catch{}
    });
    on(front,'pointermove',event=>{
      if(!drag||event.pointerId!==drag.id){hover(event);return;}
      const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
      if(!drag.moved&&Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)*1.2){release(event,true);return;}
      if(!drag.moved&&Math.abs(dx)<6)return;drag.moved=true;event.preventDefault();
      const delta=Math.max(1,event.timeStamp-drag.lastAt);drag.velocity=Math.max(-2,Math.min(2,(event.clientX-drag.lastX)/delta));drag.lastX=event.clientX;drag.lastAt=event.timeStamp;
      channels.x=drag.baseX+Math.max(-drag.width*1.2,Math.min(drag.width*1.2,dx));target.x=channels.x;target.angle=Math.max(-9,Math.min(9,dx/drag.width*9));target.tiltX=target.tiltY=0;schedule();
    });
    on(front,'pointerup',event=>release(event));on(front,'pointercancel',event=>release(event,true));on(front,'lostpointercapture',event=>release(event,true));
    on(front,'pointerleave',()=>{if(!drag){target.tiltX=target.tiltY=0;schedule();}});
    on(front,'click',()=>{if(!visible()||phase==='exit'||view.performance.now()<suppressClickUntil||!items[0])return;try{const result=onActivate?.({...items[0]});if(result&&typeof result.then==='function')result.catch(error=>{if(!disposed)notify(error);});}catch(error){notify(error);}});
    on(front,'keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||items.length<2)return;event.preventDefault();cycle({immediate:true,reverse:event.key==='ArrowRight'});});
    on(fallback,'load',()=>{if(!visible())return;fallback.hidden=false;empty.hidden=true;upload();});
    on(fallback,'error',()=>{if(!visible())return;fallback.hidden=true;empty.hidden=false;dropGPU();});
    on(document,'visibilitychange',()=>{if(visible()){failed=false;render();schedule();}else stop();});
    if(typeof view.IntersectionObserver==='function'){intersectionObserver=new view.IntersectionObserver(entries=>{const entry=entries.find(value=>value.target===root);if(!entry)return;intersecting=entry.isIntersecting;if(visible()){failed=false;render();schedule();}else stop();},{threshold:0});intersectionObserver.observe(root);}
    // ResizeObserver only schedules; layout writes happen outside its delivery
    // cycle. The mount owns height, so card fitting cannot feed its own height.
    if(typeof view.ResizeObserver==='function'){resizeObserver=new view.ResizeObserver(scheduleResize);resizeObserver.observe(root);}else on(view,'resize',scheduleResize);
    const reduceChange=()=>{if(reduced?.matches){if(phase==='exit')rotate({immediate:true,reverse:exitReverse});else{resetTargets();cancelFrame();snap();if(!drag){phase='idle';applyPending();}}}};
    reduced?.addEventListener?.('change',reduceChange);removers.push(()=>reduced?.removeEventListener?.('change',reduceChange));
    render();
    const api={
      update(value){if(disposed)return;if(drag||phase==='exit'||phase==='settle'){pendingItems=normalizeItems(value);return;}const next=normalizeItems(value),current=items[0]?.id;const at=next.findIndex(item=>item.id===current);if(at>0)next.push(...next.splice(0,at));if(JSON.stringify(next)===JSON.stringify(items))return;items=next;generation++;cancelDrag();phase='idle';resetTargets();cancelFrame();snap();render();},
      activate(){if(disposed||active)return;active=true;applyPending();failed=false;measure();render();schedule();},
      deactivate(){if(disposed)return;active=false;generation++;stop();},
      getState:()=>({active,disposed,visible:visible(),order:items.map(item=>item.id),phase,pendingFrame:frame!==null||resizeFrame!==null||resizeTimer!==null,renderer:gpu?.ready?'webgl':'css',gpuContexts:gpu?1:0,textureLimit:MAX_TEXTURE,renderLimit:MAX_RENDER,uploads,draws}),
      dispose(){if(disposed)return;active=false;disposed=true;pendingItems=null;generation++;stop();resizeObserver?.disconnect();intersectionObserver?.disconnect();removers.splice(0).forEach(remove=>remove());root.replaceChildren();root.classList.remove('music-cards');root.removeAttribute('data-no-window-drag');}
    };
    // Explicit synthetic-fixture diagnostics only. Normal UI never reads pixels.
    if(diagnostic)api.inspectGPU=()=>{
      if(!gpu?.ready||!canvas)return {ready:false};draw();const {gl}=gpu,pixels=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const previous=gl.getParameter(gl.ACTIVE_TEXTURE),bound=[];
      for(let unit=0;unit<2;unit++){gl.activeTexture(unit===0?gl.TEXTURE0:gl.TEXTURE1);bound.push(gl.getParameter(gl.TEXTURE_BINDING_2D)===(unit===0?gpu.cover:gpu.environment));}
      gl.activeTexture(previous);
      return {ready:true,width:canvas.width,height:canvas.height,textureLimit:MAX_TEXTURE,linked:gpu.programs.every(value=>gl.getProgramParameter(value,gl.LINK_STATUS)),texturesBound:bound,maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),error:gl.getError(),tilt:[channels.tiltX,channels.tiltY],pixels:Array.from(pixels)};
    };
    return api;
  }
  // Shared optical model for small surfaces. Other views can reuse the same
  // bevel, normals and two-pass environment reflection without a second deck.
  return {create,normalizeItems,safeCover,springStep,MAX_RENDER,MAX_TEXTURE,metalShaders:Object.freeze({VERTEX,BLUR,SURFACE})};
});

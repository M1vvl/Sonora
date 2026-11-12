/* The native Veyra pipeline paints Background -> Glass; all DOM content stays
   above it. No screen capture, desktop texture, or credentials reach web pages. */
(() => {
  'use strict';
  const root=document.documentElement,island=document.getElementById('island'),surface=island||document.querySelector('.app-shell');
  if(!surface||typeof window.pulse?.onLiquidGlass!=='function')return;
  const canvas=document.createElement('canvas');canvas.className='veyra-glass-canvas';canvas.setAttribute('aria-hidden','true');canvas.hidden=true;surface.prepend(canvas);
  if(!island){const tint=document.createElement('div');tint.className='veyra-glass-tint';tint.setAttribute('aria-hidden','true');surface.prepend(tint);}
  const context=canvas.getContext('2d',{alpha:true});let disposed=false;
  const unsubscribe=window.pulse.onLiquidGlass(value=>{
    if(disposed)return;
    if(Number.isFinite(value.opacity))canvas.style.opacity=String(Math.max(0,Math.min(1,value.opacity)));
    if(value.active===false){canvas.hidden=true;delete root.dataset.veyraGlass;return;}
    if(!value.pixels)return;
    try{
      const {width,height,pixels}=value;
      if(!context||!ArrayBuffer.isView(pixels)||pixels.byteLength!==width*height*4||width*height>8388608)return;
      if(Math.abs(width-innerWidth*devicePixelRatio)>3||Math.abs(height-innerHeight*devicePixelRatio)>3)return;
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer,pixels.byteOffset,pixels.byteLength),width,height),0,0);
      if(island){
        const samples=[];for(let row=0;row<3;row++)for(let column=0;column<3;column++){
          const index=(Math.round((height-1)*(2+3*row)/10)*width+Math.round((width-1)*(2+3*column)/10))*4;
          samples.push((.2126*pixels[index]+.7152*pixels[index+1]+.0722*pixels[index+2])/255);
        }
        samples.sort((a,b)=>a-b);const luminance=samples[4];
        if(luminance>.62)root.dataset.glassInk='dark';else if(luminance<.48)root.dataset.glassInk='light';
      }
      canvas.hidden=false;root.dataset.veyraGlass='true';
    }finally{window.pulse.liquidGlassPresented({id:value.id,sequence:value.sequence});}
  });
  window.addEventListener('resize',()=>{canvas.hidden=true;delete root.dataset.veyraGlass;});
  window.addEventListener('pagehide',()=>{disposed=true;unsubscribe();canvas.width=canvas.height=0;},{once:true});
})();

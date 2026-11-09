'use strict';
const fs = require('node:fs');
const path = require('node:path');
const currentMap = require('../refraction-map.cjs');

const SCENES = ['bright', 'dark', 'detail'];
const STATES = [{ name: 'compact', width: 480, height: 44, radius: 22 }, { name: 'expanded', width: 520, height: 260, radius: 26 }];
const FIXTURE_KEY = '__pulseMaterialPreviewFixture';

// This deterministic shader is used both by the renderer's diagnostic canvas
// and by the BGRA source supplied to the real edge-map implementation. It does
// not use user images, a desktop capture, or a fixture in the product path.
function scenePixel(scene, x, y, width, height) {
  const u = x / width, v = y / height;
  const cloud = (cx, cy, sx, sy) => Math.exp(-(((u - cx) / sx) ** 2) - ((v - cy) / sy) ** 2);
  const blend = (a, b, amount) => a + (b - a) * Math.max(0, Math.min(1, amount));
  let rgb;
  if (scene === 'bright') {
    const light = Math.min(1, .9 * cloud(.16, .15, .28, .75) + .85 * cloud(.7, .8, .21, .7));
    rgb = [blend(88, 245, light), blend(148, 250, light), blend(205, 255, light)];
  } else if (scene === 'dark') {
    const light = Math.min(1, .85 * cloud(.24, .7, .26, .9) + .6 * cloud(.86, .05, .2, .65));
    rgb = [blend(3, 21, light), blend(8, 48, light), blend(21, 85, light)];
  } else {
    const stripe = .5 + .5 * Math.sin((x + y * .38) * Math.PI / 4.5);
    const broad = .5 + .5 * Math.sin((x - y * .13) * Math.PI / 57);
    rgb = [blend(26, 205, stripe), blend(55, 222, stripe), blend(86, 238, stripe)].map((value, index) => blend(value, [29, 63, 115][index], broad * .22));
  }
  return rgb.map(value => Math.max(0, Math.min(255, Math.round(value))));
}

function syntheticSource(scene, geometry, cssWidth, cssHeight, scaleX, scaleY) {
  const { width, height, padding } = geometry;
  const sourceWidth = width + padding * 2, sourceHeight = height + padding * 2;
  const bgra = Buffer.allocUnsafe(sourceWidth * sourceHeight * 4);
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const rgb = scenePixel(scene, (x - padding + .5) / scaleX, (y - padding + .5) / scaleY, cssWidth, cssHeight);
      const offset = (y * sourceWidth + x) * 4;
      bgra[offset] = rgb[2]; bgra[offset + 1] = rgb[1]; bgra[offset + 2] = rgb[0]; bgra[offset + 3] = 255;
    }
  }
  return bgra;
}

function baselineMaterial() {
  const archive = path.join(process.cwd(), 'release', 'win-unpacked', 'resources', 'app.asar');
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
    if (metadata.version !== '0.3.5') return { available: false, reason: `Packaged baseline is ${String(metadata.version || 'unversioned')}, expected 0.3.5` };
    const css = ['island.css', 'liquid-edge.css'].map(file => fs.readFileSync(path.join(archive, 'ui', file), 'utf8')).join('\n');
    const map = require(path.join(archive, 'src', 'refraction-map.cjs'));
    if (typeof map.buildEdgeMap !== 'function' || typeof map.refractEdges !== 'function') return { available: false, reason: 'Packaged 0.3.5 edge map is unavailable' };
    return { available: true, version: metadata.version, css, map };
  } catch (error) {
    return { available: false, reason: String(error.message || error).slice(0, 240) };
  }
}

async function settle(contents) {
  return contents.executeJavaScript(`(async () => {
    const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await paint();
    let timer;
    const finite=document.getAnimations().filter(animation=>{
      const iterations=animation.effect?.getComputedTiming().iterations;
      return iterations!==Infinity&&(animation.playState==='running'||animation.pending);
    });
    await Promise.race([Promise.allSettled(finite.map(animation=>animation.finished)),new Promise(resolve=>{timer=setTimeout(resolve,350);})]);
    clearTimeout(timer); await paint();
    return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,expanded:document.getElementById('island').classList.contains('expanded')};
  })()`);
}

async function setExpanded(contents, expanded) {
  return contents.executeJavaScript(`(async () => {
    const desired=${JSON.stringify(expanded)},island=document.getElementById('island');
    if(island.classList.contains('expanded')!==desired) document.getElementById('island-toggle').click();
    const deadline=Date.now()+2000;
    while(island.classList.contains('expanded')!==desired&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
    if(island.classList.contains('expanded')!==desired) throw Error('Material preview could not change the existing island state');
    return desired;
  })()`);
}

function maximum(values, stride = 1, first = 0) {
  let result = 0;
  for (let index = first; index < values.length; index += stride) result = Math.max(result, values[index]);
  return result;
}

/** Synthetic, hidden-window diagnostics only; never creates or shows a window. */
async function previewMaterial({ island, out, ROOT }) {
  const baseline = baselineMaterial();
  const report = { baseline: baseline.available, baselineVersion: baseline.version || null, baselineReason: baseline.reason || null, syntheticOnly: true, desktopRead: false, captures: [], completed: false, restored: false, passed: false };
  if (!island || island.isDestroyed()) return { ...report, error: 'An existing island window is required' };
  const contents = island.webContents, oldBounds = island.getBounds(), oldZoom = contents.getZoomFactor();
  const destination = path.resolve(out || path.join(ROOT || process.cwd(), 'artifacts'));
  let fixtureReady = false, originalExpanded = null;
  try {
    fs.mkdirSync(destination, { recursive: true });
    const initial = await contents.executeJavaScript(`(() => {
      const key=${JSON.stringify(FIXTURE_KEY)};
      if(window[key]) throw Error('A material preview fixture is already active');
      const links=[...document.querySelectorAll('link[rel="stylesheet"]')].filter(link=>['island.css','liquid-edge.css'].includes(new URL(link.href).pathname.split('/').pop()));
      if(links.length!==2||!window.PulseLiquidEdge) throw Error('Island material modules are not ready');
      const root=document.getElementById('island'),canvas=document.querySelector('.refraction-canvas');
      if(!root||!canvas) throw Error('Island material DOM is not ready');
      const expanded=root.classList.contains('expanded'),wasHidden=document.hidden;
      window[key]={links:links.map(link=>({link,disabled:link.disabled})),expanded,
        edgeMode:document.documentElement.getAttribute('data-liquid-edge'),bodyIsolation:document.body.style.isolation,
        hidden:Object.getOwnPropertyDescriptor(document,'hidden'),visibility:Object.getOwnPropertyDescriptor(document,'visibilityState'),
        oldCanvas:{width:canvas.width,height:canvas.height,hidden:canvas.hidden,pixels:canvas.width&&canvas.height?canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height):null}};
      const state=window[key];
      // Hidden-window frame consumers must accept this synthetic diagnostic frame.
      // Own properties are removed/restored afterward; no window is made visible.
      if(document.hidden){Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});}
      const background=document.createElement('canvas');background.id='pulse-material-preview-background';
      background.setAttribute('data-material-preview','background');background.setAttribute('aria-hidden','true');
      background.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:-1';
      document.body.style.isolation='isolate';document.body.prepend(background);state.background=background;
      const style=document.createElement('style');style.setAttribute('data-material-preview','freeze');
      style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.append(style);state.freeze=style;
      window.PulseLiquidEdge.setMode('refract');
      return {expanded,visibilityWasOverridden:wasHidden};
    })()`);
    fixtureReady = true; originalExpanded = initial.expanded;
    report.visibilityWasOverridden = initial.visibilityWasOverridden;
    const variants = baseline.available ? [{ name: 'before-035', map: baseline.map }, { name: 'after-036', map: currentMap }] : [{ name: 'after-036', map: currentMap }];
    for (const zoom of [1, 2]) {
      contents.setZoomFactor(zoom);
      for (const state of STATES) {
        await setExpanded(contents, state.name === 'expanded');
        island.setBounds({ ...oldBounds, width: state.width * zoom, height: state.height * zoom }, false);
        const viewport = await settle(contents);
        if (Math.abs(viewport.width - state.width) > 1 || Math.abs(viewport.height - state.height) > 1) throw Error('Material preview viewport does not match its design size');
        const width = Math.round(viewport.width * viewport.dpr), height = Math.round(viewport.height * viewport.dpr);
        const scaleX = width / viewport.width, scaleY = height / viewport.height;
        const geometry = { width, height, radius: Math.min(Math.floor(Math.min(width, height) / 2), Math.round(state.radius * scaleX)), thickness: Math.max(1, Math.round(6 * scaleX)), padding: Math.max(3, Math.round(10 * scaleX)) };
        if (width > 2048 || height > 1024) throw Error(`Material preview exceeds the bounded map at actual DPR ${viewport.dpr}`);
        const maps = variants.map(variant => ({ ...variant, edgeMap: variant.map.buildEdgeMap(geometry) }));
        for (const scene of SCENES) {
          await contents.executeJavaScript(`(() => {
            const fixture=window[${JSON.stringify(FIXTURE_KEY)}],canvas=fixture.background;
            canvas.width=${width};canvas.height=${height};
            const context=canvas.getContext('2d'),image=context.createImageData(canvas.width,canvas.height),pixel=${scenePixel.toString()};
            for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
              const rgb=pixel(${JSON.stringify(scene)},(x+.5)/${scaleX},(y+.5)/${scaleY},${viewport.width},${viewport.height}),offset=(y*canvas.width+x)*4;
              image.data[offset]=rgb[0];image.data[offset+1]=rgb[1];image.data[offset+2]=rgb[2];image.data[offset+3]=255;
            }
            context.putImageData(image,0,0);
          })()`);
          const source = syntheticSource(scene, geometry, viewport.width, viewport.height, scaleX, scaleY);
          for (const variant of maps) {
            await contents.executeJavaScript(`(() => {
              const fixture=window[${JSON.stringify(FIXTURE_KEY)}];fixture.baseline?.remove();fixture.baseline=null;
              const before=${JSON.stringify(variant.name === 'before-035')};
              fixture.links.forEach(saved=>{saved.link.disabled=before?true:saved.disabled;});
              if(before){const style=document.createElement('style');style.setAttribute('data-material-preview','baseline');style.textContent=${JSON.stringify(baseline.css || '')};document.head.append(style);fixture.baseline=style;}
              window.PulseLiquidEdge.setMode('refract');
            })()`);
            const pixels = variant.map.refractEdges(source, variant.edgeMap);
            contents.send('pulse:refraction-frame', { active: true, width, height, pixels });
            await settle(contents);
            const frame = await contents.executeJavaScript(`(() => {
              const canvas=document.querySelector('.refraction-canvas'),context=canvas.getContext('2d'),center=context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;
              return {visible:!canvas.hidden,width:canvas.width,height:canvas.height,centerAlpha:center[3],border:getComputedStyle(document.getElementById('island')).borderColor};
            })()`);
            if (!frame.visible || frame.width !== width || frame.height !== height) throw Error('Synthetic edge frame did not reach the existing island canvas');
            // Hidden compositors can return the preceding frame on the first read.
            await contents.capturePage();
            await settle(contents);
            const image = await contents.capturePage();
            const filename = `material-${scene}-${state.name}-${Math.round(zoom * 100)}pct-${variant.name}.png`;
            fs.writeFileSync(path.join(destination, filename), image.toPNG());
            report.captures.push({ file: filename, scene, state: state.name, variant: variant.name, zoom, dpr: viewport.dpr, cssSize: [viewport.width, viewport.height], imageSize: image.getSize(), mapAlphaMax: maximum(variant.edgeMap.coverage), outputAlphaMax: maximum(pixels, 4, 3), centerAlpha: frame.centerAlpha, border: frame.border });
          }
        }
      }
    }
    report.completed = report.captures.length === (baseline.available ? 24 : 12);
  } catch (error) {
    report.error = String(error.message || error).slice(0, 500);
  } finally {
    if (!island.isDestroyed()) {
      try {
        contents.send('pulse:refraction-frame', { active: false });
        if (fixtureReady && originalExpanded !== null) await setExpanded(contents, originalExpanded);
        contents.setZoomFactor(oldZoom);
        island.setBounds(oldBounds, false);
        await settle(contents);
        const cleanup = await contents.executeJavaScript(`(() => {
          const key=${JSON.stringify(FIXTURE_KEY)},state=window[key];
          if(state){
            state.baseline?.remove();state.freeze?.remove();state.background?.remove();
            state.links.forEach(saved=>{saved.link.disabled=saved.disabled;});
            document.body.style.isolation=state.bodyIsolation;
            window.PulseLiquidEdge.setMode(state.edgeMode||'light');
            if(state.edgeMode===null)document.documentElement.removeAttribute('data-liquid-edge');
            const canvas=document.querySelector('.refraction-canvas');
            if(canvas){canvas.width=state.oldCanvas.width;canvas.height=state.oldCanvas.height;if(state.oldCanvas.pixels)canvas.getContext('2d').putImageData(state.oldCanvas.pixels,0,0);canvas.hidden=state.oldCanvas.hidden;}
            if(state.hidden)Object.defineProperty(document,'hidden',state.hidden);else delete document.hidden;
            if(state.visibility)Object.defineProperty(document,'visibilityState',state.visibility);else delete document.visibilityState;
            delete window[key];
          }
          return {fixtureAbsent:!window[key]&&!document.querySelector('[data-material-preview]'),expanded:document.getElementById('island').classList.contains('expanded')};
        })()`);
        const bounds = island.getBounds();
        report.restored = cleanup.fixtureAbsent && (originalExpanded === null || cleanup.expanded === originalExpanded) && contents.getZoomFactor() === oldZoom && ['x', 'y', 'width', 'height'].every(key => bounds[key] === oldBounds[key]);
        report.fixtureAbsent = cleanup.fixtureAbsent;
      } catch (error) { report.restoreError = String(error.message || error).slice(0, 500); }
    } else report.restoreError = 'The island was destroyed during material preview';
  }
  report.passed = report.completed && report.restored && !report.error && report.captures.every(capture => capture.centerAlpha === 0 && (capture.variant !== 'after-036' || capture.outputAlphaMax <= 71));
  return report;
}

module.exports = { previewMaterial };

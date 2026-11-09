/* MineRadio 11-main-loop.js Emily uniform/ripple/rotation update, GPL-3.0-only. */
(() => {
  'use strict';
  let resolution = 0;
  let previousSettings = null;
  const textures = new Set([coverTex, prevCoverTex, coverEdgeTex, rippleTex, dotTexture]);
  // MineRadio's pointer ray intersects the rotated cover plane in local space.
  // These reusable objects replace the original document-wide input listeners.
  const pointerRay = new THREE.Raycaster(), pointerNdc = new THREE.Vector2();
  const pointerPlane = new THREE.Plane(), pointerPoint = new THREE.Vector3();
  const pointerNormal = new THREE.Vector3(), pointerHit = new THREE.Vector3();
  const pointerRotation = new THREE.Quaternion();
  function updatePointer(pointer) {
    uniforms.uMouseActive.value = 0;
    if (!pointer) return;
    pointerNdc.set(pointer.x, pointer.y);
    camera.updateMatrixWorld();
    pointerRay.setFromCamera(pointerNdc, camera);
    particles.updateMatrixWorld(true);
    particles.getWorldPosition(pointerPoint);
    particles.getWorldQuaternion(pointerRotation);
    pointerNormal.set(0, 0, 1).applyQuaternion(pointerRotation).normalize();
    if (Math.abs(pointerNormal.dot(pointerRay.ray.direction)) < .16) return;
    pointerPlane.setFromNormalAndCoplanarPoint(pointerNormal, pointerPoint);
    if (!pointerRay.ray.intersectPlane(pointerPlane, pointerHit)) return;
    particles.worldToLocal(pointerHit);
    if (!Number.isFinite(pointerHit.x) || !Number.isFinite(pointerHit.y) || Math.abs(pointerHit.x) >= 8.5 || Math.abs(pointerHit.y) >= 8.5) return;
    uniforms.uMouseXY.value.set(pointerHit.x, pointerHit.y);
    uniforms.uMouseActive.value = 1;
  }
  window.PulseEmilyFrame = {
    update(frame, dt) {
      const settings = frame.settings || {};
      const signal = frame.audio || {};
      if (settings !== previousSettings) {
        Object.assign(fx, settings);
        previousSettings = settings;
      }
      fx.preset = settings.preset === 'topography' ? 7 : 0;
      uniforms.uPreset.value = fx.preset;
      fx.speed = settings.speed ?? 1;
      const width = frame.width || 960, height = frame.height || 540;
      if (canvas.width !== width || canvas.height !== height) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      particles.visible = settings.visualEnabled !== false &&
        (fx.preset !== 7 || settings.backgroundStarRiver !== false);
      bloomParticles.visible = particles.visible && settings.bloom === true && (settings.bloomStrength ?? .62) > .01;
      if (settings.visualEnabled === false) return;
      const nextResolution = clampRange((settings.coverResolution || 384) / 248, .74, 1.55);
      if (nextResolution !== resolution) {
        resolution = nextResolution;
        applyCoverParticleResolution(resolution, {reload: false});
      }
      bass = Number(signal.bass) || 0;
      mid = Number(signal.mid) || 0;
      treble = Number(signal.treble) || 0;
      beatPulse = Number(signal.beat) || 0;
      uniforms.uTime.value = (Number(frame.time) || 0) / 1000;
      uniforms.uBass.value = bass;
      uniforms.uMid.value = mid;
      uniforms.uTreble.value = treble;
      uniforms.uEnergy.value = Number(signal.energy) || 0;
      uniforms.uBeat.value = beatPulse;
      uniforms.uAlpha.value = fx.preset === 7 || uniforms.uHasCover.value > 0 ? 1 : 0;
      uniforms.uIntensity.value = settings.intensity ?? .85;
      uniforms.uDepth.value = settings.depth ?? .2;
      uniforms.uPointScale.value = settings.point ?? 1;
      uniforms.uSpeed.value = fx.speed;
      uniforms.uTwist.value = settings.twist || 0;
      uniforms.uColorBoost.value = settings.color ?? 1.1;
      uniforms.uScatter.value = settings.scatter || 0;
      uniforms.uCoverRes.value = resolution;
      uniforms.uBgFade.value = settings.bgFade ?? .2;
      // MineRadio syncFxUniforms(): these are material inputs, not only UI
      // preferences. Leaving the initializer values silently enables edges
      // and prevents the custom-colour controls from ever reaching the GPU.
      uniforms.uEdgeEnabled.value = settings.edge === true ? 1 : 0;
      uniforms.uBackdropAdapt.value = settings.lyricBackdropAdapt === false ? 0 : .72;
      uniforms.uTintColor.value.set(normalizeHexColor(settings.visualTintColor, '#9db8cf'));
      uniforms.uTintStrength.value = settings.visualTintMode === 'custom' ? .42 : 0;
      uniforms.uBloomStrength.value = settings.bloomStrength ?? .62;
      uniforms.uBloomSize.value = settings.bloomSize ?? 2.65;
      uniforms.uParticleDim.value = frame.shelf?.open ? .48 : 1;
      uniforms.uBurstAmt.value *= Math.pow(.90, dt * 60);
      const ease = 1 - Math.pow(1 - .055, dt * 60);
      gestureRotation.x = Number(frame.pitch) || 0;
      gestureRotation.y = Number(frame.yaw) || 0;
      particles.rotation.x += (gestureRotation.x - particles.rotation.x) * ease;
      particles.rotation.y += (gestureRotation.y - particles.rotation.y) * ease;
      bloomParticles.rotation.copy(particles.rotation);
      bloomParticles.visible = particles.visible && settings.bloom === true && uniforms.uBloomStrength.value > .01;
      updatePointer(frame.reducedMotion ? null : frame.pointer);
      updateRipples(dt);
    },
    dispose() {
      geo.dispose();
      material.dispose();
      bloomMaterial.dispose();
      for (const texture of textures) texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
})();

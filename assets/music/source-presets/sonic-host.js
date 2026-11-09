/* Sonara lifecycle adapter. The Sonic terrain and frequency-monitor modules
 * retain their exact MineRadio bytes; shared source shaders use preset 7. */
(() => {
  'use strict';
  let previous = -1;
  window.PulseSonicHost = {
    update(frame, dt) {
      const settings = frame.settings || {};
      const next = settings.preset === 'topography' && settings.visualEnabled !== false ? 7 : 0;
      Object.assign(fx, settings, {preset: next});
      if (next !== previous) {
        MineradioSonicTopography.onPresetChange(previous, next, {scene, fx});
        if (next === 7) {
          // Original 01-orbit-free-camera.js SONIC_ORBIT_BASELINE.
          camera.fov = 45;
          camera.position.set(0, 8.4 * Math.sin(.18), 8.4 * Math.cos(.18));
        } else {
          camera.fov = 42;
          camera.position.set(0, 0, 7.6);
        }
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        previous = next;
      }
      if (next !== 7) return;
      const raw = frame.audio || {};
      const detailed = stepSonicAudioMonitor(raw.bins, dt, {
        fx,
        playing: frame.playing && raw.rms > 0,
        sampleRate: raw.sampleRate,
        fftSize: raw.fftSize,
        currentTime: frame.position
      });
      orbit.rotating = frame.rotating === true;
      MineradioSonicTopography.update(dt, {
        scene, fx,
        time: frame.time / 1000,
        screenHeight: frame.height,
        dpr: renderer.getPixelRatio(),
        visualRotation: {x: frame.pitch || 0, y: frame.yaw || 0},
        visualRotationActive: orbit.rotating,
        audio: detailed
      });
    },
    dispose() {
      MineradioSonicTopography.clear();
    }
  };
})();

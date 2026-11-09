'use strict';

// Read a bounded set of exterior desktop pixels already held by refraction.
// The contour interior is never read, so the island cannot classify itself.
function analyzeSurroundings(pixels, geometry, previous = {}) {
  const width = geometry.width + geometry.padding * 2;
  const height = geometry.height + geometry.padding * 2;
  if (!ArrayBuffer.isView(pixels) || pixels.byteLength !== width * height * 4) return null;
  const luminances = [];
  const read = (x, y) => {
    const offset = (y * width + x) * 4;
    luminances.push((pixels[offset + 2] * .2126 + pixels[offset + 1] * .7152 + pixels[offset] * .0722) / 255);
  };
  const step = Math.max(1, Math.ceil((width + height) / 256));
  for (let x = 0; x < width; x += step) { read(x, 0); read(x, height - 1); }
  for (let y = 0; y < height; y += step) { read(0, y); read(width - 1, y); }
  const mean = luminances.reduce((sum, value) => sum + value, 0) / luminances.length;
  const variance = luminances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luminances.length;
  const smoothed = Number.isFinite(previous.luminance) ? previous.luminance * .55 + mean * .45 : mean;
  const light = previous.ink === 'dark' ? smoothed > .45 : smoothed > .60;
  return {
    ink: light ? 'dark' : 'light',
    luminance: Math.round(smoothed * 1000) / 1000,
    tint: Math.round((.06 + Math.min(1, Math.sqrt(variance) * 3) * .16) * 1000) / 1000
  };
}

module.exports = { analyzeSurroundings };

(function (host, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else host.PulseCoverPalette = value;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  // MineRadio's area-bucket palette samples the current cover on change.
  // The compact player needs one accent, bounded to a 16x16 image, not a
  // continuous canvas or a second image request.
  function luminance(rgb) {
    const values = rgb.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  }
  function readable(rgb, background, target) {
    const base = luminance(background);
    let result = rgb;
    for (let step = 0; step <= 20; step++) {
      const level = luminance(result);
      if ((Math.max(level, base) + .05) / (Math.min(level, base) + .05) >= 4.5) return result;
      const ratio = (step + 1) / 20;
      result = rgb.map(value => Math.round(value + (target - value) * Math.min(1, ratio)));
    }
    return result;
  }
  function fromPixels(pixels) {
    const buckets = new Map();
    for (let n = 0; n + 3 < Math.min(pixels.length, 16 * 16 * 4); n += 4) {
      const r = pixels[n], g = pixels[n + 1], b = pixels[n + 2];
      if (pixels[n + 3] < 128) continue;
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { r: 0, g: 0, b: 0, count: 0, score: 0 }; buckets.set(key, bucket); }
      bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
      bucket.score += .6 + (Math.max(r, g, b) - Math.min(r, g, b)) / 255 * .4;
    }
    let dominant = null;
    for (const bucket of buckets.values()) if (!dominant || bucket.score > dominant.score) dominant = bucket;
    if (!dominant) return null;
    const rgb = ['r', 'g', 'b'].map(key => Math.round(dominant[key] / dominant.count));
    const css = value => 'rgb(' + value.join(' ') + ')';
    return { light: css(readable(rgb, [23, 35, 44], 255)), dark: css(readable(rgb, [255, 255, 255], 0)) };
  }
  function read(image) {
    if (!image?.complete || !image.naturalWidth) return null;
    const canvas = image.ownerDocument.createElement('canvas');
    canvas.width = canvas.height = 16;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0, 16, 16);
      return fromPixels(context.getImageData(0, 0, 16, 16).data);
    } catch { return null; }
    finally { canvas.width = canvas.height = 0; }
  }
  return { read, fromPixels };
});

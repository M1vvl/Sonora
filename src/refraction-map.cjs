'use strict';

// Geometry and resampling only. This module does not access the desktop, create
// native handles, send IPC, or synthesize any background pixels.
const MAX_WIDTH = 2048;
const MAX_HEIGHT = 1024;
const MIN_PADDING = 3;
const MAX_PADDING = 64;
const MAX_THICKNESS = 64;
const MIN_OUTSIDE_EXTRA = 2.5;
const MIN_SAMPLE_DISTANCE = 1;
const MAP_KIND = 'pulse-refraction-edge-map-v3';
const MAX_RIM_OPACITY = 0.28;

function integer(value, name, minimum, maximum) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(minimum, maximum, value) {
  const t = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return t * t * (3 - 2 * t);
}

function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x - halfWidth) - (halfWidth - radius);
  const qy = Math.abs(y - halfHeight) - (halfHeight - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * Precompute an inward rounded-rectangle rim and bilinear source addresses.
 *
 * All dimensions, radius, thickness and padding are physical pixels. The source
 * rectangle is (width + 2 * padding) by (height + 2 * padding), aligned so that
 * the unshifted island's top-left pixel is source pixel (padding, padding).
 *
 * Every source pixel, including all four bilinear neighbours, is strictly more
 * than one pixel outside this rounded rectangle. Only surrounding desktop pixels
 * fold into the inner rim; this never samples the island or its center and does
 * not require the island to be excluded from screenshots/recordings.
 * The caller may cache the returned map until geometry changes.
 */
function buildEdgeMap(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Edge-map geometry must be an object');
  }
  const width = integer(options.width, 'width', 1, MAX_WIDTH);
  const height = integer(options.height, 'height', 1, MAX_HEIGHT);
  const radius = integer(options.radius, 'radius', 0, Math.floor(Math.min(width, height) / 2));
  const thickness = integer(options.thickness === undefined ? 6 : options.thickness, 'thickness', 1, MAX_THICKNESS);
  const padding = integer(options.padding === undefined ? 10 : options.padding, 'padding', MIN_PADDING, MAX_PADDING);
  const sourceWidth = width + 2 * padding;
  const sourceHeight = height + 2 * padding;
  const geometry = Object.freeze({ width, height, radius, thickness, padding, sourceWidth, sourceHeight });
  const destinations = [], addresses = [], coefficients = [], coverage = [];
  const halfWidth = width / 2, halfHeight = height / 2;
  const scale = thickness / 6;
  const outerFeather = Math.max(1, scale);
  let minimumSampleDistance = Infinity;

  for (let y = 0; y < height; y++) {
    const relativeY = y + 0.5 - halfHeight;
    const qy = Math.abs(relativeY) - (halfHeight - radius);
    for (let x = 0; x < width; x++) {
      const relativeX = x + 0.5 - halfWidth;
      const qx = Math.abs(relativeX) - (halfWidth - radius);
      const outsideX = Math.max(qx, 0), outsideY = Math.max(qy, 0);
      const outsideLength = Math.hypot(outsideX, outsideY);
      const distance = outsideLength + Math.min(Math.max(qx, qy), 0) - radius;
      const depth = -distance;
      if (depth <= 0 || depth >= thickness) continue;

      // A solid 255-alpha plateau makes a copied strip look like a plastic
      // frame. Feather the whole bevel, in physical pixels scaled with its
      // thickness, and leave the actual desktop visible through every sample.
      const outerCoverage = smoothstep(0, outerFeather, depth);
      const innerCoverage = 1 - smoothstep(thickness * 0.15, thickness, depth);
      const alpha = Math.round(255 * MAX_RIM_OPACITY * outerCoverage * innerCoverage);
      if (!alpha) continue;

      let normalX = 0, normalY = 0;
      if (outsideLength > 0) {
        normalX = Math.sign(relativeX) * outsideX / outsideLength;
        normalY = Math.sign(relativeY) * outsideY / outsideLength;
      } else if (qx > qy) normalX = Math.sign(relativeX) || 1;
      else normalY = Math.sign(relativeY) || 1;

      // Continuously traverse nearby exterior texture as depth increases,
      // rather than extruding a nearly constant exterior stripe inward.
      // This remains an exterior-only approximation, not a full Snell lens.
      const curvature = Math.min(1, 2 * Math.abs(normalX * normalY));
      const lensFalloff = 1.1 * thickness * Math.pow(1 - depth / thickness, 2.6);
      const extra = Math.max(MIN_OUTSIDE_EXTRA, Math.min(padding - 2, 2.5 * scale + lensFalloff + thickness * .05 + curvature * .5));
      const shift = depth + extra;
      const sampleX = clamp(x + padding + normalX * shift, 0, sourceWidth - 1);
      const sampleY = clamp(y + padding + normalY * shift, 0, sourceHeight - 1);
      const x0 = Math.floor(sampleX), y0 = Math.floor(sampleY);
      const x1 = Math.min(x0 + 1, sourceWidth - 1), y1 = Math.min(y0 + 1, sourceHeight - 1);
      const fx = sampleX - x0, fy = sampleY - y0;
      const samples = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
      for (const [sourceX, sourceY] of samples) {
        const clearance = roundedRectDistance(sourceX + 0.5 - padding, sourceY + 0.5 - padding, halfWidth, halfHeight, radius);
        if (!(clearance > MIN_SAMPLE_DISTANCE)) {
          throw new RangeError('Geometry/padding cannot keep every source pixel outside the island');
        }
        minimumSampleDistance = Math.min(minimumSampleDistance, clearance);
      }
      destinations.push((y * width + x) * 4);
      addresses.push((y0 * sourceWidth + x0) * 4, (y0 * sourceWidth + x1) * 4,
        (y1 * sourceWidth + x0) * 4, (y1 * sourceWidth + x1) * 4);
      coefficients.push((1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy);
      coverage.push(alpha);
    }
  }

  return Object.freeze({
    kind: MAP_KIND, ...geometry, geometry,
    sourceByteLength: sourceWidth * sourceHeight * 4,
    outputByteLength: width * height * 4,
    sampling: 'outside-contour', minimumSampleDistance, profile: 'feathered-bevel', maxRimOpacity: MAX_RIM_OPACITY,
    rimPixels: destinations.length,
    destinations: Uint32Array.from(destinations),
    addresses: Uint32Array.from(addresses),
    coefficients: Float32Array.from(coefficients),
    coverage: Uint8Array.from(coverage),
  });
}

/**
 * Sample an existing top-down BGRA capture into straight-alpha RGBA rim pixels.
 * Returns Uint8ClampedArray, suitable for new ImageData(data, width, height).
 * Source alpha is intentionally ignored: GDI BI_RGB commonly leaves it unset.
 */
function refractEdges(source, map) {
  if (!(source instanceof Uint8Array) && !(source instanceof Uint8ClampedArray)) {
    throw new TypeError('BGRA source must be a Buffer or an unsigned byte typed array');
  }
  if (!map || map.kind !== MAP_KIND || !map.geometry) throw new TypeError('A valid edge map is required');
  integer(map.width, 'map.width', 1, MAX_WIDTH);
  integer(map.height, 'map.height', 1, MAX_HEIGHT);
  integer(map.radius, 'map.radius', 0, Math.floor(Math.min(map.width, map.height) / 2));
  integer(map.thickness, 'map.thickness', 1, MAX_THICKNESS);
  integer(map.padding, 'map.padding', MIN_PADDING, MAX_PADDING);
  integer(map.rimPixels, 'map.rimPixels', 0, map.width * map.height);
  if (map.sourceWidth !== map.width + 2 * map.padding || map.sourceHeight !== map.height + 2 * map.padding
      || ['width', 'height', 'radius', 'thickness', 'padding', 'sourceWidth', 'sourceHeight'].some(key => map.geometry[key] !== map[key])
      || map.sourceByteLength !== map.sourceWidth * map.sourceHeight * 4
      || map.outputByteLength !== map.width * map.height * 4
      || !(map.destinations instanceof Uint32Array) || map.destinations.length !== map.rimPixels
      || !(map.addresses instanceof Uint32Array) || map.addresses.length !== map.rimPixels * 4
      || !(map.coefficients instanceof Float32Array) || map.coefficients.length !== map.rimPixels * 4
      || !(map.coverage instanceof Uint8Array) || map.coverage.length !== map.rimPixels) {
    throw new TypeError('Edge map has invalid geometry or sample tables');
  }
  if (source.byteLength !== map.sourceByteLength) {
    throw new RangeError(`BGRA source must contain exactly ${map.sourceByteLength} bytes`);
  }
  const output = new Uint8ClampedArray(map.outputByteLength);
  for (let index = 0; index < map.rimPixels; index++) {
    const destination = map.destinations[index], base = index * 4;
    const a = map.addresses[base], b = map.addresses[base + 1];
    const c = map.addresses[base + 2], d = map.addresses[base + 3];
    const wa = map.coefficients[base], wb = map.coefficients[base + 1];
    const wc = map.coefficients[base + 2], wd = map.coefficients[base + 3];
    output[destination] = source[a + 2] * wa + source[b + 2] * wb + source[c + 2] * wc + source[d + 2] * wd;
    output[destination + 1] = source[a + 1] * wa + source[b + 1] * wb + source[c + 1] * wc + source[d + 1] * wd;
    output[destination + 2] = source[a] * wa + source[b] * wb + source[c] * wc + source[d] * wd;
    output[destination + 3] = map.coverage[index];
  }
  return output;
}

module.exports = { buildEdgeMap, refractEdges };

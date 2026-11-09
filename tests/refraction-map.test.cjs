'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEdgeMap, refractEdges } = require('../src/refraction-map.cjs');

function gradient(map) {
  const data = Buffer.alloc(map.sourceByteLength);
  for (let y = 0; y < map.sourceHeight; y++) for (let x = 0; x < map.sourceWidth; x++) {
    const index = (y * map.sourceWidth + x) * 4;
    data[index] = (x + y) % 256;
    data[index + 1] = Math.min(255, y * 3);
    data[index + 2] = Math.min(255, x * 2);
    data[index + 3] = 0; // GDI alpha is not reliable and must not hide the rim.
  }
  return data;
}
const pixel = (data, map, x, y) => [...data.subarray((y * map.width + x) * 4, (y * map.width + x) * 4 + 4)];
// Independent signed-distance implementation used to prove every contributing
// source pixel is outside the island, including neighbours with zero weight.
function sdf(x, y, map) {
  const dx = Math.abs(x - map.width / 2) - map.width / 2 + map.radius;
  const dy = Math.abs(y - map.height / 2) - map.height / 2 + map.radius;
  return Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) + Math.min(Math.max(dx, dy), 0) - map.radius;
}

test('a synthetic captured gradient really moves outward on all four edges', () => {
  const map = buildEdgeMap({ width: 80, height: 40, radius: 20 });
  const source = gradient(map), before = Buffer.from(source);
  const output = refractEdges(source, map);
  assert.ok(output instanceof Uint8ClampedArray);
  assert.equal(output.byteLength, 80 * 40 * 4);
  const left = pixel(output, map, 0, 20), right = pixel(output, map, 79, 20);
  const top = pixel(output, map, 40, 0), bottom = pixel(output, map, 40, 39);
  assert.ok(left[0] < map.padding * 2 - 4);
  assert.ok(right[0] > (79 + map.padding) * 2 + 4);
  assert.ok(top[1] < map.padding * 3 - 6);
  assert.ok(bottom[1] > (39 + map.padding) * 3 + 6);
  assert.ok([left, right, top, bottom].every(value => value[3] > 0));
  assert.deepEqual(source, before, 'sampling must not modify the captured bytes');
});

test('rounded corners, outside pixels and the center remain fully transparent', () => {
  const map = buildEdgeMap({ width: 100, height: 60, radius: 24 });
  const output = refractEdges(gradient(map), map);
  for (const [x, y] of [[0, 0], [99, 0], [0, 59], [99, 59], [50, 30], [50, 15]]) {
    assert.deepEqual(pixel(output, map, x, y), [0, 0, 0, 0]);
  }
  assert.ok(pixel(output, map, 50, 0)[3] > 0);
  assert.ok(pixel(output, map, 50, 2)[3] > pixel(output, map, 50, 0)[3], 'outer boundary is anti-aliased');
  assert.ok(pixel(output, map, 50, 5)[3] < pixel(output, map, 50, 3)[3], 'inner boundary fades out');
  assert.equal(pixel(output, map, 50, 6)[3], 0);
});

test('bilinear weights preserve a linear gradient at fractional sample positions', () => {
  const map = buildEdgeMap({ width: 80, height: 40, radius: 16 });
  const output = refractEdges(gradient(map), map);
  const destination = (20 * map.width + 1) * 4;
  const sample = map.destinations.indexOf(destination);
  assert.ok(sample >= 0);
  const expectedSourceX = Array.from({ length: 4 }, (_, index) => {
    const address = map.addresses[sample * 4 + index];
    const x = address / 4 % map.sourceWidth;
    return x * map.coefficients[sample * 4 + index];
  }).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(expectedSourceX - Math.round(expectedSourceX)) > 0.1, 'the fixture uses a fractional source coordinate');
  assert.ok(Math.abs(output[destination] - expectedSourceX * 2) <= 0.51);
  assert.equal(map.coefficients.slice(sample * 4, sample * 4 + 4).reduce((a, b) => a + b, 0).toFixed(6), '1.000000');
});

test('compact and expanded geometry generate different rounded rims', () => {
  const compact = buildEdgeMap({ width: 520, height: 60, radius: 30 });
  const expanded = buildEdgeMap({ width: 520, height: 260, radius: 26 });
  assert.equal(compact.geometry.sourceWidth, 540);
  assert.equal(compact.geometry.sourceHeight, 80);
  assert.equal(expanded.geometry.sourceHeight, 280);
  assert.equal(compact.radius, 30);
  assert.equal(expanded.radius, 26);
  assert.ok(expanded.rimPixels > compact.rimPixels);
  assert.equal(refractEdges(Buffer.alloc(expanded.sourceByteLength, 255), expanded).byteLength, 520 * 260 * 4);
});

test('minimum-padding samples clamp safely outside the shape and retain channel order', () => {
  const map = buildEdgeMap({ width: 12, height: 10, radius: 0, thickness: 2, padding: 3 });
  const source = Buffer.alloc(map.sourceByteLength);
  for (let index = 0; index < source.length; index += 4) {
    source[index] = 7; source[index + 1] = 19; source[index + 2] = 31;
  }
  const output = refractEdges(source, map);
  assert.ok([...map.addresses].every(address => address >= 0 && address + 2 < source.length));
  assert.ok(map.minimumSampleDistance > 1);
  for (const destination of map.destinations) {
    assert.deepEqual([...output.subarray(destination, destination + 3)], [31, 19, 7]);
    assert.ok(output[destination + 3] > 0);
  }
  assert.deepEqual(pixel(output, map, 6, 5), [0, 0, 0, 0]);
});

test('all four bilinear source pixels are beyond the contour and its one-pixel AA border', () => {
  for (const geometry of [
    { width: 520, height: 60, radius: 30 },
    { width: 520, height: 260, radius: 26 },
    { width: 80, height: 40, radius: 0, padding: 3 },
    { width: 80, height: 40, radius: 20, padding: 3 },
    { width: 9, height: 7, radius: 3, padding: 3 },
    { width: 1, height: 1, radius: 0, padding: 3 },
  ]) {
    const map = buildEdgeMap(geometry);
    assert.equal(map.sampling, 'outside-contour');
    for (const address of map.addresses) {
      const sourcePixel = address / 4;
      const x = sourcePixel % map.sourceWidth + 0.5 - map.padding;
      const y = Math.floor(sourcePixel / map.sourceWidth) + 0.5 - map.padding;
      assert.ok(sdf(x, y, map) > 1, `source (${x}, ${y}) must be strictly outside its island`);
    }
  }
});

test('changing every island/interior/AA source pixel cannot feed back into the rim', () => {
  const map = buildEdgeMap({ width: 100, height: 60, radius: 24 });
  const source = gradient(map), poisoned = Buffer.from(source);
  for (let y = 0; y < map.sourceHeight; y++) for (let x = 0; x < map.sourceWidth; x++) {
    if (sdf(x + 0.5 - map.padding, y + 0.5 - map.padding, map) <= 1) {
      const offset = (y * map.sourceWidth + x) * 4;
      poisoned[offset] = 255; poisoned[offset + 1] = 0; poisoned[offset + 2] = 255; poisoned[offset + 3] = 255;
    }
  }
  assert.deepEqual(refractEdges(poisoned, map), refractEdges(source, map));
});

test('the entire bevel stays translucent and fades inward at 100%, 150% and 200% DPI', () => {
  for (const scale of [1, 1.5, 2]) {
    const thickness = Math.round(6 * scale);
    const map = buildEdgeMap({width: Math.round(480 * scale), height: Math.round(44 * scale), radius: Math.round(22 * scale), thickness, padding: Math.round(10 * scale)});
    const output = refractEdges(Buffer.alloc(map.sourceByteLength, 255), map);
    const profile = Array.from({length: thickness + 1}, (_, y) => pixel(output, map, Math.floor(map.width / 2), y)[3]);
    assert.ok(Math.max(...map.coverage) <= 72, 'no opaque stripe can cover the real desktop');
    const peak = profile.indexOf(Math.max(...profile));
    assert.ok(peak < Math.ceil(thickness / 2), 'highlight sits toward the exterior');
    for (let y = peak + 1; y < profile.length; y++) assert.ok(profile[y] <= profile[y - 1], 'the inner bevel fades continuously without a second rim');
    assert.equal(profile.at(-1), 0);
    assert.ok(map.minimumSampleDistance > 1);
  }
});

test('geometry bounds, finite integers and exact source byte counts are enforced', () => {
  const valid = { width: 80, height: 40, radius: 20 };
  for (const patch of [{ width: 0 }, { width: 2049 }, { height: 1025 }, { width: 4.5 }, { height: Infinity },
    { width: NaN }, { radius: -1 }, { radius: 21 }, { radius: 0.5 }, { thickness: 0 }, { thickness: 65 },
    { thickness: NaN }, { padding: -1 }, { padding: 0 }, { padding: 1 }, { padding: 2 }, { padding: 65 }, { padding: 1.1 }]) {
    assert.throws(() => buildEdgeMap({ ...valid, ...patch }), RangeError);
  }
  assert.throws(() => buildEdgeMap(null), TypeError);
  assert.throws(() => buildEdgeMap([]), TypeError);
  const map = buildEdgeMap(valid);
  assert.throws(() => refractEdges(Buffer.alloc(map.sourceByteLength - 1), map), RangeError);
  assert.throws(() => refractEdges(Buffer.alloc(map.sourceByteLength + 1), map), RangeError);
  assert.throws(() => refractEdges(new Int8Array(map.sourceByteLength), map), TypeError);
  assert.throws(() => refractEdges(new Array(map.sourceByteLength), map), TypeError);
  assert.throws(() => refractEdges(Buffer.alloc(map.sourceByteLength), {}), TypeError);
  assert.throws(() => refractEdges(Buffer.alloc(map.sourceByteLength), { ...map, rimPixels: 99999999 }), RangeError);
  assert.throws(() => refractEdges(Buffer.alloc(map.sourceByteLength), { ...map, sourceWidth: -map.sourceWidth }), TypeError);
  assert.throws(() => refractEdges(Buffer.alloc(map.sourceByteLength), { ...map, padding: NaN }), RangeError);
});

'use strict';
// Native window and diagnostics share these dimensions. The page fills its
// actual viewport, so geometry changes cannot leave a rectangular outer strip.
const ISLAND_COMPACT = Object.freeze({ width: 480, height: 44 });
const ISLAND_EXPANDED = Object.freeze({ width: 520, height: 260 });
module.exports = { ISLAND_COMPACT, ISLAND_EXPANDED };

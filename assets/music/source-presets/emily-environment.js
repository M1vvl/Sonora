/* GPL-3.0-only. Host values for MineRadio's Emily plane and native lyrics. */
var canvas = document.querySelector('canvas');
var renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: false, powerPreference: 'high-performance'});
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
renderer.setPixelRatio(1);
renderer.setClearColor(0, 0);
camera.position.set(0, 0, 7.6);
var fxDefaults = {preset: 0, intensity: .85, depth: .2, coverResolution: 1.55, point: 1, speed: 1, twist: 0, color: 1.1, scatter: 0, bgFade: .2, bloom: false, bloomStrength: .62, bloomSize: 2.65};
var fx = {...fxDefaults};
var gestureRotation = {x: 0, y: 0};
var orbit = {centerLocked: false, rotating: false};
var bass = 0, mid = 0, treble = 0, beatPulse = 0;
var stageLyrics = {coverPalette: {primary: '#9db8cf', secondary: '#426dab', highlight: '#c8eef5'}};
function clampRange(value, minimum, maximum) {return Math.max(minimum, Math.min(maximum, Number(value) || 0));}
function normalizeHexColor(value, fallback) {return /^#[\da-f]{6}$/i.test(value || '') ? value : fallback;}
function normalizeCoverResolution(value) {return clampRange(value, .74, 1.55);}
function coverParticleGridForResolution(value) {
  var grid = Math.max(88, Math.min(183, Math.round(118 * normalizeCoverResolution(value))));
  return grid % 2 ? grid : grid + 1;
}

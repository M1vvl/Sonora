'use strict';
// Playback preferences and Kazumi's exact Windows Anime4K pipelines. This
// module does not load a player, change monitor settings, or start GPU work.
const fs = require('node:fs');
const path = require('node:path');

const SHADER_PRESETS = Object.freeze({
  off: Object.freeze([]),
  efficiency: Object.freeze([
    'Anime4K_Clamp_Highlights.glsl',
    'Anime4K_Restore_CNN_M.glsl',
    'Anime4K_Restore_CNN_S.glsl',
    'Anime4K_Upscale_CNN_x2_M.glsl',
    'Anime4K_AutoDownscalePre_x2.glsl',
    'Anime4K_AutoDownscalePre_x4.glsl',
    'Anime4K_Upscale_CNN_x2_S.glsl'
  ]),
  quality: Object.freeze([
    'Anime4K_Clamp_Highlights.glsl',
    'Anime4K_Restore_CNN_VL.glsl',
    'Anime4K_Upscale_CNN_x2_VL.glsl',
    'Anime4K_AutoDownscalePre_x2.glsl',
    'Anime4K_AutoDownscalePre_x4.glsl',
    'Anime4K_Upscale_CNN_x2_M.glsl'
  ])
});
const DEFAULT_PLAYER_SETTINGS = Object.freeze({
  superResolution: 'quality', outputResolution:'2160p', speed: 1, volume: 100, mute: false,
  aspect: 'contain', brightness: 0, contrast: 0, saturation: 0, gamma: 0,
  hwdec: 'auto-safe', renderer: 'gpu-next'
});
const ENUMS = Object.freeze({
  superResolution: Object.freeze(Object.keys(SHADER_PRESETS)),
  outputResolution:Object.freeze(['auto','1080p','1440p','2160p']),
  aspect: Object.freeze(['contain', 'cover', 'fill', '16:9', '4:3']),
  hwdec: Object.freeze(['auto-safe', 'auto', 'no', 'd3d11va', 'd3d11va-copy', 'dxva2', 'dxva2-copy', 'nvdec', 'nvdec-copy']),
  renderer: Object.freeze(['gpu-next', 'gpu'])
});
const RANGES = Object.freeze({ speed: [0.25, 3], volume: [0, 100], brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100], gamma: [-100, 100] });
function sanitizePlayerSettings(value, base = DEFAULT_PLAYER_SETTINGS) {
  const next = { ...DEFAULT_PLAYER_SETTINGS };
  for (const key of Object.keys(next)) if (Object.hasOwn(base, key)) next[key] = base[key];
  if (value == null) return next;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('播放器设置必须为对象');
  for (const [key, options] of Object.entries(ENUMS)) {
    if (!Object.hasOwn(value, key)) continue;
    if (!options.includes(value[key])) throw new TypeError(`无效的播放器选项：${key}`);
    next[key] = value[key];
  }
  for (const [key, [minimum, maximum]] of Object.entries(RANGES)) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new TypeError(`播放器数值无效：${key}`);
    next[key] = Math.max(minimum, Math.min(maximum, value[key]));
  }
  if (Object.hasOwn(value, 'mute')) {
    if (typeof value.mute !== 'boolean') throw new TypeError('静音选项必须为布尔值');
    next.mute = value.mute;
  }
  return next;
}
function shaderPaths(mode, directory) {
  if (!Object.hasOwn(SHADER_PRESETS, mode)) throw new TypeError('无效的超分辨率档位');
  if (mode === 'off') return [];
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\0\r\n;]/.test(directory)) throw new TypeError('着色器目录必须是有效的绝对路径');
  return SHADER_PRESETS[mode].map(name => path.join(directory, name));
}
function createPlayerSettings(file) {
  let current = { ...DEFAULT_PLAYER_SETTINGS };
  try {
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    // The 0.3.15 request explicitly changes the old default-off experience to
    // best quality. The new output key marks that migration; subsequent user
    // choices (including enhancement off) remain untouched on every restart.
    const legacy=saved&&typeof saved==='object'&&!Array.isArray(saved)&&!Object.hasOwn(saved,'outputResolution');
    current=sanitizePlayerSettings(legacy?{...saved,superResolution:'quality',outputResolution:'2160p'}:saved);
  } catch { /* Invalid/missing preferences fall back without opening media. */ }
  return {
    get: () => ({ ...current }),
    preview: patch => sanitizePlayerSettings(patch, current),
    save(patch) {
      const next = sanitizePlayerSettings(patch, current);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
      fs.renameSync(temporary, file);
      current = next;
      return { ...current };
    }
  };
}
module.exports = { DEFAULT_PLAYER_SETTINGS, SHADER_PRESETS, sanitizePlayerSettings, shaderPaths, createPlayerSettings };

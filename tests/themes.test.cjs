'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const api = require('../ui/themes.js');
const expected = [
  ['carbon-lime', '#000000', '#B8F732'], ['electric-purple', '#923EE5', '#00FF00'],
  ['ember-orange', '#FF770F', '#000026'], ['charcoal-pink', '#1A1A1D', '#E6397C'],
  ['wisteria-lime', '#5E55A2', '#91C53A'],
  ['neon-pop', '#0A0A32', '#01F87A', '#FB01BE'],
  ['klein-yellow', '#002FA7', '#FFE76F'], ['mars-rose', '#01847F', '#F9D2E4']
];
function luminance(hex) {
  return hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
}
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function dom() {
  class Element {
    constructor(tag, ownerDocument) {
      this.tagName = tag; this.ownerDocument = ownerDocument; this.children = []; this.attributes = new Map(); this.events = new Map(); this.properties = new Map(); this.checked = false; this.textContent = '';
      this.style = { setProperty: (name, value) => this.properties.set(name, value) };
      this.classList = { add: value => { this.className = `${this.className || ''} ${value}`.trim(); } };
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    append(...elements) { this.children.push(...elements); }
    prepend(element) { this.children.unshift(element); }
    replaceChildren(...elements) { this.children = elements; }
    addEventListener(name, callback) { this.events.set(name, callback); }
    removeEventListener(name, callback) { if (this.events.get(name) === callback) this.events.delete(name); }
  }
  const document = { createElement: tag => new Element(tag, document) };
  return { document, create: tag => document.createElement(tag) };
}

test('eight ordered themes retain the exact reference HEX colors and immutable palettes', () => {
  assert.deepEqual(api.list.map(theme => [theme.id, ...theme.colors]), expected);
  assert.deepEqual(api.list.map(theme => theme.order), expected.map((_theme, index) => index + 1));
  assert.equal(api.DEFAULT_THEME, 'carbon-lime');
  assert.ok(Object.isFrozen(api.themes)); assert.ok(Object.isFrozen(api.list));
  for (const theme of api.list) {
    assert.equal(api.themes[theme.id], theme); assert.ok(Object.isFrozen(theme.tokens)); assert.ok(Object.isFrozen(theme.colors));
    for (const value of Object.values(theme.tokens)) assert.match(value, /^#[0-9A-F]{6}$/);
  }
});

test('normal, muted, semantic icon, and highlighted text meet 4.5:1 on every content surface', () => {
  for (const theme of api.list) {
    const t = theme.tokens;
    for (const background of ['bg', 'surface', 'surface-raised', 'accent-soft', 'hover', 'input-bg']) {
      for (const foreground of ['text', 'muted', 'accent-text', 'role-assistant', 'role-tool', 'role-user', 'role-status', 'status-waiting', 'status-completed', 'status-error']) {
        const ratio = contrast(t[foreground], t[background]);
        assert.ok(ratio >= 4.5, `${theme.id}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
      }
    }
    assert.ok(contrast(t['accent-ink'], t.accent) >= 4.5, `${theme.id}: action text`);
    assert.ok(contrast(t['rail-ink'], t['rail-bg']) >= 4.5, `${theme.id}: rail icons`);
    assert.ok(contrast(t['rail-active-ink'], t['rail-active']) >= 4.5, `${theme.id}: active rail icons`);
  }
});

test('each complete scheme maps its exact colors to background, rail, and a readable solid feature card', () => {
  const assignments = [
    ['carbon-lime', '#000000', '#B8F732', '#B8F732', '#142000'],
    ['electric-purple', '#110C19', '#00FF00', '#923EE5', '#FFFFFF'],
    ['ember-orange', '#000026', '#FF770F', '#FF770F', '#000026'],
    ['charcoal-pink', '#1A1A1D', '#E6397C', '#E6397C', '#16080D'],
    ['wisteria-lime', '#13111E', '#91C53A', '#5E55A2', '#FFFFFF'],
    ['neon-pop', '#0A0A32', '#01F87A', '#FB01BE', '#0A0A32'],
    ['klein-yellow', '#002FA7', '#FFE76F', '#FFE76F', '#002FA7'],
    ['mars-rose', '#062522', '#F9D2E4', '#01847F', '#FFFFFF']
  ];
  for (const [id, bg, rail, feature, ink] of assignments) {
    const theme = api.get(id), t = theme.tokens;
    assert.deepEqual([t.bg, t['rail-bg'], t['feature-bg'], t['feature-ink']], [bg, rail, feature, ink]);
    assert.ok(contrast(t['feature-ink'], t['feature-bg']) >= 4.5, `${id}: feature headline`);
    assert.ok(contrast(t['feature-muted'], t['feature-bg']) >= 4.5, `${id}: feature detail`);
    assert.ok(luminance(t['rail-active']) < .05, `${id}: active navigation stays dark`);
    assert.match(theme.description, /导航.*金额/);
    if (theme.colors.length === 3) {
      assert.equal(t['feature-bg'], theme.colors[2], `${id}: third color is a solid UI surface`);
      assert.equal(new Set([t.bg, t['rail-bg'], t['feature-bg']]).size, 3);
    }
  }
});

test('invalid and prototype-like IDs fall back without accepting arbitrary CSS values', () => {
  for (const value of [undefined, null, false, 3, {}, '__proto__', 'constructor', '', '#FFFFFF', 'electric-purple; background:red']) assert.equal(api.normalize(value), 'carbon-lime');
  assert.equal(api.normalize('ink-aqua'), api.DEFAULT_THEME);
  assert.equal(Object.hasOwn(api.themes,'ink-aqua'),false);
  const h = dom(), root = h.create('html');
  assert.equal(api.apply(root, 'neon-pop'), 'neon-pop');
  assert.equal(root.attributes.get('data-interface-theme'), 'neon-pop');
  assert.equal(root.properties.get('--accent'), '#01F87A');
  assert.equal(api.apply(root, { id: 'mars-rose', tokens: { accent: 'url(secret)' } }), 'mars-rose');
  assert.equal(root.properties.get('--accent'), '#F9D2E4');
  assert.equal(root.properties.size, Object.keys(api.get().tokens).length);
  assert.equal(api.apply(root, 'missing'), 'carbon-lime');
  assert.throws(() => api.apply(null, 'mars-rose'), TypeError);
});

test('browser UMD exports definitions without creating DOM, storage, or timers', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/themes.js'), 'utf8'), { window });
  assert.equal(window.PulseThemes.normalize('electric-purple'), 'electric-purple');
  assert.equal(window.PulseThemes.list.length, 8);
});

test('swatch cards use ordered native radios, emit only user changes, and support settings sync', () => {
  const h = dom(), container = h.create('div'), changes = [];
  const controller = api.mount(container, { value: 'ember-orange', onChange: value => changes.push(value) });
  const inputs = container.children.map(card => card.children[0]);
  assert.equal(container.attributes.get('role'), 'group'); assert.equal(container.children.length, 8);
  assert.deepEqual(inputs.map(input => input.value), expected.map(item => item[0]));
  assert.ok(inputs.every(input => input.type === 'radio' && input.name === inputs[0].name));
  assert.equal(inputs.filter(input => input.checked).length, 1); assert.ok(inputs[2].checked);
  assert.ok(inputs.every(input => input.attributes.get('aria-label')));
  assert.deepEqual(changes, []);
  inputs[5].checked = true; inputs[5].events.get('change')();
  assert.equal(controller.value, 'neon-pop'); assert.ok(inputs[5].checked); assert.ok(!inputs[2].checked); assert.deepEqual(changes, ['neon-pop']);
  inputs[5].events.get('change')(); assert.deepEqual(changes, ['neon-pop']);
  controller.setValue('electric-purple'); assert.equal(controller.value, 'electric-purple'); assert.ok(inputs[1].checked);
  assert.deepEqual(changes, ['neon-pop']);
  controller.setValue('invalid'); assert.ok(inputs[0].checked);
  controller.dispose(); assert.ok(inputs.every(input => input.events.size === 0));
  assert.equal(controller.setValue('mars-rose'), 'carbon-lime');
});

test('remount removes obsolete listeners and picker groups remain independent', () => {
  const h = dom(), first = h.create('div'), second = h.create('div');
  const a = api.mount(first), previous = first.children.map(card => card.children[0]);
  const b = api.mount(first, { value: 'mars-rose' }), c = api.mount(second);
  assert.ok(previous.every(input => input.events.size === 0));
  assert.equal(a.setValue('neon-pop'), 'carbon-lime'); assert.equal(b.value, 'mars-rose');
  assert.notEqual(first.children[0].children[0].name, second.children[0].children[0].name);
  b.dispose(); b.dispose(); c.dispose();
});

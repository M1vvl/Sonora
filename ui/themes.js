(function (host, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else host.PulseThemes = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const DEFAULT_THEME = 'carbon-lime';
  const definitions = [
    { id: 'carbon-lime', name: '碳黑青柠', description: '黑色基底 · 青柠导航与金额', colors: ['#000000', '#B8F732'], bg: '#000000', surface: '#141A16', raised: '#202922', border: '#364438', text: '#F2F7F2', muted: '#B4C3B6', accent: '#B8F732', rail: '#B8F732', railInk: '#142000', feature: '#B8F732', featureInk: '#142000', active: '#17220E', activeInk: '#D7FF95', assistant: '#D0BAF1' },
    { id: 'electric-purple', name: '电光紫绿', description: '深紫基底 · 绿导航 · 紫金额', colors: ['#923EE5', '#00FF00'], bg: '#110C19', surface: '#1B1426', raised: '#2A2035', border: '#4C3B5F', text: '#F8F2FC', muted: '#C6B8D1', accent: '#00FF00', rail: '#00FF00', railInk: '#142000', feature: '#923EE5', featureInk: '#FFFFFF', active: '#1B1424', activeInk: '#00FF00', assistant: '#D8B4FF' },
    { id: 'ember-orange', name: '爱马仕橙蓝', description: '深蓝基底 · 爱马仕橙导航与金额', colors: ['#FF770F', '#000026'], bg: '#000026', surface: '#10102D', raised: '#1B1B3A', border: '#454566', text: '#FFF6F0', muted: '#C9C6D9', accent: '#FF770F', rail: '#FF770F', railInk: '#000026', feature: '#FF770F', featureInk: '#000026', active: '#0C0C2E', activeInk: '#FFB37A', assistant: '#DFB9F4' },
    { id: 'charcoal-pink', name: '炭灰莓粉', description: '炭灰基底 · 莓粉导航与金额', colors: ['#1A1A1D', '#E6397C'], bg: '#1A1A1D', surface: '#1A1A1D', raised: '#29252C', border: '#4B3B47', text: '#FFF4F8', muted: '#CBBBC4', accent: '#E6397C', accentText: '#FF80B0', rail: '#E6397C', railInk: '#16080D', feature: '#E6397C', featureInk: '#16080D', active: '#21141C', activeInk: '#FFB1CF', assistant: '#D5B9F2' },
    { id: 'wisteria-lime', name: '藤紫青柠', description: '深紫基底 · 青柠导航 · 藤紫金额', colors: ['#5E55A2', '#91C53A'], bg: '#13111E', surface: '#201D31', raised: '#2D2942', border: '#494362', text: '#F7F5FF', muted: '#C3BDD1', accent: '#91C53A', rail: '#91C53A', railInk: '#142000', feature: '#5E55A2', featureInk: '#FFFFFF', active: '#211D37', activeInk: '#B5E56A', assistant: '#D1BDF4' },
    { id: 'neon-pop', name: '霓虹脉冲', description: '午夜蓝基底 · 绿导航 · 洋红金额', colors: ['#0A0A32', '#01F87A', '#FB01BE'], bg: '#0A0A32', surface: '#13132C', raised: '#24243D', border: '#3E3E61', text: '#F3F4FF', muted: '#BCBED3', accent: '#01F87A', rail: '#01F87A', railInk: '#0A0A32', feature: '#FB01BE', featureInk: '#0A0A32', active: '#17172E', activeInk: '#FF8BE3', assistant: '#FF8BE3' },
    { id: 'klein-yellow', name: '克莱因蓝黄', description: '克莱因蓝基底 · 松花黄导航与金额', colors: ['#002FA7', '#FFE76F'], bg: '#002FA7', surface: '#092360', raised: '#123174', border: '#49659A', text: '#FFFFFF', muted: '#D5DFFD', accent: '#FFE76F', rail: '#FFE76F', railInk: '#002FA7', feature: '#FFE76F', featureInk: '#002FA7', active: '#001C64', activeInk: '#FFE76F', assistant: '#F3D6FF' },
    { id: 'mars-rose', name: '马尔斯绿粉', description: '深马尔斯绿基底 · 玫瑰粉导航 · 马尔斯绿金额', colors: ['#01847F', '#F9D2E4'], bg: '#062522', surface: '#0B302D', raised: '#103B37', border: '#41635F', text: '#F5FFFD', muted: '#BED9D3', accent: '#F9D2E4', rail: '#F9D2E4', railInk: '#07332E', feature: '#01847F', featureInk: '#FFFFFF', featureMuted: '#FFFFFF', active: '#062522', activeInk: '#F9D2E4', assistant: '#EDD6FF' }
  ];

  function mix(first, second, amount) {
    const parts = color => color.slice(1).match(/../g).map(value => parseInt(value, 16));
    const a = parts(first), b = parts(second);
    return '#' + a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  const list = Object.freeze(definitions.map((source, index) => {
    const accentText = source.accentText || source.accent;
    const tokens = Object.freeze({
      bg: source.bg, surface: source.surface, 'surface-raised': source.raised,
      border: source.border, 'border-strong': mix(source.border, source.text, .2),
      text: source.text, muted: source.muted, lime: accentText, accent: source.accent,
      'accent-text': accentText, 'accent-ink': source.railInk === '#FFFFFF' || source.railInk === '#F8F7FF' ? '#071008' : source.railInk,
      'accent-soft': mix(source.surface, source.accent, .1),
      hover: mix(source.raised, source.text, .035), 'input-bg': source.bg,
      'rail-bg': source.rail, 'rail-ink': source.railInk, 'rail-active': source.active, 'rail-active-ink': source.activeInk,
      'feature-bg': source.feature, 'feature-ink': source.featureInk, 'feature-muted': source.featureMuted || mix(source.featureInk, source.feature, .05),
      'reference-primary': source.colors[0], 'reference-secondary': source.colors[1],
      'reference-tertiary': source.colors[2] || source.colors[1],
      purple: source.assistant, 'role-assistant': source.assistant, 'role-tool': '#C3CCD9',
      'role-user': '#A8DCE5', 'role-usage': accentText, 'role-status': source.muted,
      icon: '#D1D9DC', 'icon-muted': source.muted,
      'status-working': accentText, 'status-waiting': '#F0CF91', 'status-completed': '#A8DEC8',
      'status-unknown': source.muted, 'status-error': '#FFB3AA', warning: '#F0CF91'
    });
    return Object.freeze({ id: source.id, name: source.name, description: source.description, order: index + 1, colors: Object.freeze(source.colors), tokens });
  }));
  const themes = Object.freeze(Object.fromEntries(list.map(theme => [theme.id, theme])));
  function normalize(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(themes, value) ? value : DEFAULT_THEME;
  }
  function get(value) { return themes[normalize(value)]; }

  // Applying is deliberately local: no storage, IPC, OS preference, or island changes.
  function apply(root, value) {
    if (!root || typeof root.setAttribute !== 'function' || typeof root.style?.setProperty !== 'function') throw new TypeError('A dashboard root element is required');
    const theme = get(typeof value === 'object' && value ? value.id : value);
    root.setAttribute('data-interface-theme', theme.id);
    for (const [name, color] of Object.entries(theme.tokens)) root.style.setProperty('--' + name, color);
    return theme.id;
  }

  const mounts = new WeakMap();
  let nextGroup = 0;
  function mount(container, options = {}) {
    if (!container || !container.ownerDocument) throw new TypeError('A theme picker container is required');
    mounts.get(container)?.dispose();
    const document = container.ownerDocument, groupName = `interface-theme-${++nextGroup}`;
    const listeners = [], inputs = [], cards = [];
    let selected = normalize(options.value), disposed = false;
    container.classList.add('theme-picker');
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', '界面配色');
    const create = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    for (const theme of list) {
      const card = create('label', 'theme-option');
      card.setAttribute('data-theme-id', theme.id);
      const input = create('input', 'theme-option-input');
      input.type = 'radio'; input.name = groupName; input.value = theme.id;
      input.setAttribute('aria-label', `${theme.order}. ${theme.name}`);
      const preview = create('span', 'theme-option-preview');
      preview.setAttribute('aria-hidden', 'true');
      for (const [name, color] of Object.entries({ bg: theme.tokens.bg, surface: theme.tokens['surface-raised'], rail: theme.tokens['rail-bg'], accent: theme.tokens['feature-bg'] })) preview.style.setProperty('--preview-' + name, color);
      preview.append(create('i', 'theme-preview-rail'), create('i', 'theme-preview-line'), create('i', 'theme-preview-metric'));
      const caption = create('span', 'theme-option-caption');
      const name = create('span', 'theme-option-name', theme.name);
      name.prepend(create('span', 'theme-option-number', String(theme.order).padStart(2, '0')));
      const colors = create('span', 'theme-reference-colors');
      colors.setAttribute('aria-hidden', 'true');
      for (const color of theme.colors) {
        const dot = create('i'); dot.style.setProperty('background-color', color); colors.append(dot);
      }
      caption.append(name, create('span', 'theme-option-description', theme.description), colors);
      card.append(input, preview, caption, create('span', 'theme-option-check', '✓'));
      const change = () => {
        if (disposed || !input.checked || selected === theme.id) return;
        setValue(theme.id);
        if (typeof options.onChange === 'function') options.onChange(theme.id);
      };
      input.addEventListener('change', change);
      listeners.push(() => input.removeEventListener('change', change));
      inputs.push(input); cards.push(card);
    }
    container.replaceChildren(...cards);
    function setValue(value) {
      if (disposed) return selected;
      selected = normalize(value);
      inputs.forEach((input, index) => {
        input.checked = input.value === selected;
        cards[index].setAttribute('data-selected', String(input.checked));
      });
      return selected;
    }
    const controller = Object.freeze({
      setValue,
      get value() { return selected; },
      dispose() {
        if (disposed) return;
        disposed = true;
        listeners.forEach(remove => remove());
        if (mounts.get(container) === controller) mounts.delete(container);
      }
    });
    setValue(selected); mounts.set(container, controller);
    return controller;
  }
  return Object.freeze({ DEFAULT_THEME, themes, list, normalize, get, apply, mount });
});

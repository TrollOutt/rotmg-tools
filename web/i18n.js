(function (global) {
  'use strict';

  /* English-only is a product switch, not a catalogue deletion. Keep loading
     every catalogue so sources and build checks remain ready to restore, but
     deliberately expose and render English alone. */
  const LOCALES = ['en'];
  const NAMES = { en: 'English' };
  const FLAGS = { en: '🇬🇧' };
  const messages = global.REALM_TOOLS_LOCALES || { en: {} };
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();

  // This is intentionally not locale negotiation. Inputs are ignored while
  // the site is English-only, including saved choices and embedded requests.
  function match(value) {
    return /^en(?:[-_].*)?$/i.test(String(value || '').trim()) ? 'en' : null;
  }

  const locale = 'en';
  document.documentElement.lang = locale;

  function interpolate(value, params) {
    return String(value).replace(/\{(\w+)\}/g, (_, name) =>
      Object.prototype.hasOwnProperty.call(params || {}, name) ? params[name] : `{${name}}`);
  }
  function t(key, params) { return interpolate(messages.en?.[key] ?? key, params); }
  function number(value, options) { return new Intl.NumberFormat('en', options).format(value); }
  function date(value, options) { return new Intl.DateTimeFormat('en', options).format(value); }

  function sourceIndex() {
    const out = new Map();
    for (const [key, value] of Object.entries(messages.en || {})) {
      if (typeof value === 'string' && value && !value.includes('{')) {
        out.set(value, key);
        if (value.toLowerCase() !== value) out.set(value.toLowerCase(), key);
      }
    }
    return out;
  }
  const byEnglish = sourceIndex();
  const NUMBER = '(\\d[\\d\\s.,   ’\']*)';
  const ANYTHING = '(.+?)';
  const holeFor = name => /^(count|n|number|total|many|amount)$/i.test(name) ? NUMBER : ANYTHING;
  const patterns = Object.entries(messages.en || {}).flatMap(([key, value]) => {
    if (typeof value !== 'string' || !value.includes('{')) return [];
    const names = [];
    const expression = value.split(/(\{\w+\})/g).map(part => {
      const found = /^\{(\w+)\}$/.exec(part);
      if (found) { names.push(found[1]); return holeFor(found[1]); }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return [{ key, names, expression: new RegExp('^' + expression + '$') }];
  });
  function translatedSource(source) {
    const key = byEnglish.get(source);
    if (key) return t(key);
    for (const pattern of patterns) {
      const found = pattern.expression.exec(source);
      if (!found) continue;
      return t(pattern.key, Object.fromEntries(pattern.names.map((name, index) => [name, found[index + 1]])));
    }
    return source;
  }

  function translateTextNode(node) {
    if (!node || !node.nodeValue || node.parentElement?.closest('[data-i18n-skip]')) return;
    let saved = textSources.get(node);
    const current = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.nodeValue);
    if (!current || !current[2]) return;
    if (saved === undefined || current[2] !== saved.last) {
      saved = { before: current[1], value: current[2], after: current[3], last: current[2] };
      textSources.set(node, saved);
    }
    const next = translatedSource(saved.value);
    saved.last = next;
    if (next !== current[2]) node.nodeValue = saved.before + next + saved.after;
  }
  const ATTRIBUTES = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt'];
  function translateElement(node) {
    if (!(node instanceof Element) || node.closest('[data-i18n-skip]')) return;
    if (node.dataset.i18n) node.textContent = t(node.dataset.i18n);
    let stored = attributeSources.get(node);
    if (!stored) { stored = {}; attributeSources.set(node, stored); }
    for (const name of ATTRIBUTES) {
      if (!node.hasAttribute(name)) continue;
      const current = node.getAttribute(name);
      if (!(name in stored) || current !== stored[name].last) stored[name] = { source: current, last: current };
      const explicit = node.dataset[`i18n${name.replace(/(^|-)(.)/g, (_, __, c) => c.toUpperCase())}`];
      const next = explicit ? t(explicit) : translatedSource(stored[name].source);
      stored[name].last = next;
      if (current !== next) node.setAttribute(name, next);
    }
  }
  function localize(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) translateTextNode(root);
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateElement(node);
    }
  }
  function observe(root) {
    localize(root);
    const watch = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) localize(node);
    });
    watch.observe(root, { childList: true, characterData: true, attributes: true,
      attributeFilter: ATTRIBUTES, subtree: true });
    return watch;
  }

  // Compatibility API: it neither persists a request nor reloads the page.
  function setLocale() { return locale; }
  function options() { return [{ value: 'en', flag: FLAGS.en, name: NAMES.en, on: true }]; }
  const SEARCH_KEYS = {
    'stats.health': 'health', 'stats.mana': 'mana', 'stats.attack': 'attack',
    'stats.defense': 'defense', 'stats.speed': 'speed', 'stats.dexterity': 'dexterity',
    'stats.vitality': 'vitality', 'stats.wisdom': 'wisdom',
    'equipment.weapon': 'weapon', 'equipment.ability': 'ability', 'equipment.armor': 'armor',
    'equipment.ring': 'ring', 'equipment.sword': 'sword', 'equipment.dagger': 'dagger',
    'equipment.bow': 'bow', 'equipment.staff': 'staff', 'equipment.wand': 'wand',
    'equipment.katana': 'katana', 'equipment.robe': 'robe',
    'equipment.leatherArmor': 'leather armor', 'equipment.heavyArmor': 'heavy armor'
  };
  function canonicalSearch(value) {
    let query = String(value || '').toLocaleLowerCase('en').trim();
    for (const [key, canonical] of Object.entries(SEARCH_KEYS)) {
      const local = t(key).toLocaleLowerCase('en');
      if (local && local !== canonical) query = query.split(local).join(canonical);
    }
    const aliases = { 'dex pot': 'potion of dexterity', 'def pot': 'potion of defense',
      'att pot': 'potion of attack', 'spd pot': 'potion of speed', 'vit pot': 'potion of vitality',
      'wis pot': 'potion of wisdom' };
    return aliases[query] || query;
  }
  function init() {
    observe(document.body);
    global.dispatchEvent(new CustomEvent('realmtools:locale-ready', { detail: { locale } }));
  }
  global.RealmI18n = Object.freeze({
    locales: LOCALES, names: NAMES, flags: FLAGS,
    get locale() { return locale; }, get following() { return false; }, get detected() { return 'en'; },
    match, options, t, label: translatedSource, number, date, canonicalSearch, localize, observe, setLocale
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);

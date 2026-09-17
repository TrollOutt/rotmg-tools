(function (global) {
  'use strict';

  const LOCALES = ['en', 'fr', 'pt-BR', 'pt-PT', 'es', 'ru', 'pl', 'de', 'tr', 'fi', 'it', 'sv', 'zh-CN', 'da'];
  const NAMES = {
    en: 'English', fr: 'Français', 'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)',
    es: 'Español', ru: 'Русский', pl: 'Polski', de: 'Deutsch', tr: 'Türkçe', fi: 'Suomi',
    it: 'Italiano', sv: 'Svenska', 'zh-CN': '简体中文', da: 'Dansk'
  };
  /*
   * One flag per language, and a globe for "whatever the browser is set to".
   *
   * Decoration and nothing else: everywhere a flag is shown the language's own
   * name is shown beside it, and the flag itself is hidden from screen readers.
   * A flag is a country and a language is not, so it can only ever be a hint -
   * which is why it is never the whole of what is said.
   */
  const AUTO = 'auto';
  const FLAGS = {
    auto: '🌐', en: '🇬🇧', fr: '🇫🇷',
    'pt-BR': '🇧🇷', 'pt-PT': '🇵🇹', es: '🇪🇸',
    ru: '🇷🇺', pl: '🇵🇱', de: '🇩🇪',
    tr: '🇹🇷', fi: '🇫🇮', it: '🇮🇹',
    sv: '🇸🇪', 'zh-CN': '🇨🇳', da: '🇩🇰'
  };
  const STORE = 'realm-tools/locale';
  const messages = global.REALM_TOOLS_LOCALES || { en: {} };
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  let observer = null;

  /*
   * A language tag to one of the catalogues here, or nothing.
   *
   * Most of it is the ordinary thing: an exact match, then the base language,
   * so fr-CA, fr-BE and fr-FR all read as fr and every flavour of English as
   * en. Two families cannot be settled that way and are named here instead.
   *
   * Portuguese, because the two catalogues are two languages in practice and
   * the base tag has to land on one of them: pt-BR is Brazil, and pt on its
   * own - along with every other region - is Portugal. Browsers in Brazil say
   * pt-BR, so what is left for the plain tag to mean is the other one.
   *
   * Chinese, because the split is by script rather than by region. Simplified
   * - zh, zh-Hans, zh-CN, zh-SG - is the catalogue that exists. Traditional is
   * deliberately not folded into it: somebody reading Traditional is better
   * served by English than by a script they would have to decipher, so it
   * falls through to whatever they asked for next.
   */
  function match(value) {
    const raw = String(value || '').replace(/_/g, '-').trim();
    if (!raw) return null;
    const exact = LOCALES.find(locale => locale.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const parts = raw.toLowerCase().split('-');
    const base = parts[0];
    const rest = parts.slice(1);
    if (base === 'zh') {
      const traditional = rest.includes('hant') || ['tw', 'hk', 'mo'].some(where => rest.includes(where));
      return traditional ? null : 'zh-CN';
    }
    if (base === 'pt') return rest.includes('br') ? 'pt-BR' : 'pt-PT';
    return LOCALES.find(locale => locale.toLowerCase() === base) || null;
  }

  /*
   * What the browser is asking for, in the order it asks.
   *
   * This is the whole of the automatic side. There is no country lookup and no
   * call to anybody's geolocation service: the site is a static page on GitHub
   * Pages, so there is no request of ours for a header to ride on, and asking
   * a third party where somebody is in order to guess what they read would
   * send every visitor's address away to answer a question their own browser
   * has already answered better.
   */
  function fromBrowser() {
    const list = [];
    if (navigator.languages && navigator.languages.length) list.push(...navigator.languages);
    if (navigator.language) list.push(navigator.language);
    for (const candidate of list) {
      const locale = match(candidate);
      if (locale) return locale;
    }
    return null;
  }

  function saved() {
    try { return localStorage.getItem(STORE); } catch (_) { return null; }
  }

  function inAddress() {
    try { return new URL(location.href).searchParams.get('lang'); } catch (_) { return null; }
  }

  /*
   * Which language this page is in, and whether anybody chose it.
   *
   * A choice outlives a browser setting: somebody who asked for English while
   * their browser says French meant it, and meant it on their next visit too.
   * So a stored language wins over everything. `auto` stored means they asked
   * for the detection back, and it runs again on every visit. Nothing stored
   * is the same as `auto`, which is what makes a first visit land in the
   * reader's own language without anybody having to ask for it.
   *
   * `?lang=` sits under a stored choice and over the browser: it is how one
   * page is shown in one language without changing what this reader has said
   * they want, so it is never written down.
   */
  function resolve() {
    const kept = saved();
    const chosen = kept === AUTO ? null : match(kept);
    const found = fromBrowser();
    if (chosen) return { locale: chosen, auto: false, found };
    /* `REALM_I18N_WANT` is the same kind of answer said by a page that framed
       this one: the map inside the front page is in the front page's language,
       whether that came from a preference or from the address. */
    const wanted = match(global.REALM_I18N_WANT) || match(inAddress());
    if (wanted) return { locale: wanted, auto: false, found };
    return { locale: found || 'en', auto: true, found };
  }

  let settled = resolve();
  let locale = settled.locale;
  let auto = settled.auto;
  document.documentElement.lang = locale;

  function interpolate(value, params) {
    return String(value).replace(/\{(\w+)\}/g, (_, name) =>
      Object.prototype.hasOwnProperty.call(params || {}, name) ? params[name] : `{${name}}`);
  }

  function t(key, params) {
    const value = messages[locale]?.[key] ?? messages.en?.[key] ?? key;
    return interpolate(value, params);
  }

  function number(value, options) {
    return new Intl.NumberFormat(locale, options).format(value);
  }

  function date(value, options) {
    return new Intl.DateTimeFormat(locale, options).format(value);
  }

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
  const canonicalLabels = new Set([
    'Berserk','Speedy','Healing','Energized','Damaging','Invisible','Invulnerable','Invincible',
    'Armored','Inspired','Stunned','Paralyzed','Armor Broken','Stasis','Pet Stasis','Curse',
    'Slowed','Quiet','Silenced','Confused','Unstable','Blind','Darkness','Weak','Bleeding',
    'Dazed','Sick','Exposed','Heal','Magic Heal','Electric','Attack Far','Attack Mid',
    'Attack Close','Savage','Decoy','Rising Fury'
  ]);
  /*
   * A catalogue line with a hole in it, turned into something that recognises
   * the same line already filled in.
   *
   * What goes in the hole matters. A count is a number, and saying so is the
   * difference between "{count} thing" recognising "1,024 thing" and it
   * recognising "Kind of thing" - which it did, and answered with "Kind of
   * coisa", a phrase in no language at all. A pattern that swallows anything
   * ending in one common word will always find something to ruin.
   */
  const NUMBER = '(\\d[\\d\\s.,   ’\']*)';
  const ANYTHING = '(.+?)';
  const holeFor = name => /^(count|n|number|total|many|amount)$/i.test(name) ? NUMBER : ANYTHING;
  const patterns = Object.entries(messages.en || {}).flatMap(([key, value]) => {
    if (typeof value !== 'string' || !value.includes('{')) return [];
    const names = [];
    const expression = value.split(/(\{\w+\})/g).map(part => {
      const match = /^\{(\w+)\}$/.exec(part);
      if (match) { names.push(match[1]); return holeFor(match[1]); }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return [{ key, names, expression: new RegExp('^' + expression + '$') }];
  });

  function translatedSource(source) {
    const key = byEnglish.get(source);
    if (key) {
      const label = t(key);
      return locale !== 'en' && canonicalLabels.has(source) && label !== source ? `${label} (${source})` : label;
    }
    for (const pattern of patterns) {
      const match = pattern.expression.exec(source);
      if (!match) continue;
      const params = Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]));
      return t(pattern.key, params);
    }
    return source;
  }

  function translateTextNode(node) {
    if (!node || !node.nodeValue || node.parentElement?.closest('[data-i18n-skip]')) return;
    let saved = textSources.get(node);
    const current = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.nodeValue);
    if (!current || !current[2]) return;
    if (saved === undefined || current[2] !== saved.last) {
      const match = current;
      if (!match || !match[2]) return;
      saved = { before: match[1], value: match[2], after: match[3], last: match[2] };
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
      for (const record of records) {
        for (const node of record.addedNodes) localize(node);
      }
    });
    watch.observe(root, { childList: true, characterData: true, attributes: true,
      attributeFilter: ATTRIBUTES, subtree: true });
    return watch;
  }

  /*
   * Asked for a language, or asked for the detection back.
   *
   * Written down either way, because both are answers to the same question and
   * an answer only counts if it is still there on the next visit. What is
   * stored is the answer - `auto` or a language - rather than the language it
   * resolved to, which is the whole difference between "follow my browser" and
   * "keep showing me French because my browser said so once".
   */
  function setLocale(next) {
    const wanted = next === AUTO ? AUTO : (match(next) || 'en');
    try { localStorage.setItem(STORE, wanted); } catch (_) { /* storage may be disabled */ }
    const was = auto;
    auto = wanted === AUTO;
    const now = auto ? (fromBrowser() || 'en') : wanted;
    if (now === locale) {
      /* The same words on the screen either way, so there is nothing to draw
         again: only the control has changed its mind, and it says so itself. */
      if (was !== auto) paintSelector();
      return;
    }
    locale = now;
    document.documentElement.lang = locale;
    // Reload gives every calculator a clean render with locale-aware number formatting.
    location.reload();
  }

  /*
   * What the selector offers, as data rather than as elements.
   *
   * The control is built from this and so are its tests: what is on the list,
   * which row is ticked, and what automatic would pick are questions about the
   * language system, and answering them should not need a browser.
   */
  function options() {
    const found = fromBrowser() || 'en';
    const following = { value: AUTO, flag: FLAGS[AUTO], name: t('language.auto'), on: auto,
      found: { value: found, flag: FLAGS[found], name: NAMES[found] } };
    return [following].concat(LOCALES.map(code => ({
      value: code, flag: FLAGS[code], name: NAMES[code], on: !auto && code === locale
    })));
  }

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
    let query = String(value || '').toLocaleLowerCase(locale).trim();
    for (const [key, canonical] of Object.entries(SEARCH_KEYS)) {
      const local = t(key).toLocaleLowerCase(locale);
      if (local && local !== canonical) query = query.split(local).join(canonical);
    }
    const aliases = {
      'dex pot': 'potion of dexterity', 'def pot': 'potion of defense',
      'att pot': 'potion of attack', 'spd pot': 'potion of speed',
      'vit pot': 'potion of vitality', 'wis pot': 'potion of wisdom'
    };
    return aliases[query] || query;
  }

  /*
   * The language control, in the corner this site keeps its page-wide switches
   * in, immediately beside Feedback.
   *
   * Built here rather than written into the page, because the list is the
   * catalogue's list: a language added to `LOCALES` is a language in the menu
   * and there is no markup anywhere to remember. It is made of the same parts
   * as its neighbours - a `corner-button` and a panel shaped like the Feedback
   * one - so it reads as one of the site's own controls rather than as a
   * widget bolted to the top of it.
   */
  let trigger = null, menu = null, sign = null, caption = null;

  function paintSelector() {
    if (!trigger) return;
    const found = fromBrowser() || 'en';
    const shown = auto ? found : locale;
    /* Automatic wears the globe and the flag of what it found; a language
       chosen by hand wears its own flag and nothing else. */
    sign.textContent = auto ? FLAGS[AUTO] : '';
    sign.hidden = !auto;
    caption.innerHTML = '';
    const flag = document.createElement('span');
    flag.className = 'lang-flag';
    flag.setAttribute('aria-hidden', 'true');
    flag.textContent = FLAGS[shown];
    const name = document.createElement('span');
    name.className = 'corner-text lang-name';
    name.textContent = NAMES[shown];
    caption.append(flag, name);
    /* The flags are decoration, so what is read out is the whole of it: which
       language, and whether anybody chose it. */
    trigger.setAttribute('aria-label', t('language.label') + ': '
      + (auto ? t('language.auto') + ' (' + NAMES[found] + ')' : NAMES[locale]));
    trigger.title = trigger.getAttribute('aria-label');
    for (const row of menu.querySelectorAll('[data-locale]')) {
      const on = row.dataset.locale === (auto ? AUTO : locale);
      row.setAttribute('aria-checked', String(on));
      row.classList.toggle('is-on', on);
    }
  }

  function buildMenu() {
    menu.innerHTML = '';
    for (const one of options()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lang-pick';
      row.dataset.locale = one.value;
      row.setAttribute('role', 'menuitemradio');
      if (one.value !== AUTO) row.lang = one.value;
      const tick = document.createElement('span');
      tick.className = 'lang-tick';
      tick.setAttribute('aria-hidden', 'true');
      tick.textContent = '✓';
      const said = document.createElement('span');
      said.className = 'lang-said';
      const line = document.createElement('span');
      line.className = 'lang-line';
      const flag = document.createElement('span');
      flag.className = 'lang-flag';
      flag.setAttribute('aria-hidden', 'true');
      flag.textContent = one.flag;
      const name = document.createElement('span');
      name.textContent = one.name;
      line.append(flag, name);
      said.append(line);
      if (one.found) {
        /* Automatic says what it found, so the row is an answer rather than a
           promise: nobody should have to choose it to see what it would do. */
        const found = document.createElement('small');
        found.className = 'lang-found';
        found.textContent = t('language.detected', { language: one.found.flag + ' ' + one.found.name });
        said.append(found);
      }
      row.append(tick, said);
      menu.append(row);
    }
  }

  function showMenu(on) {
    menu.hidden = !on;
    trigger.setAttribute('aria-expanded', String(on));
    if (!on) return;
    const here = menu.querySelector('.is-on') || menu.querySelector('.lang-pick');
    if (here) here.focus();
  }

  function walk(from, step) {
    const rows = [...menu.querySelectorAll('.lang-pick')];
    if (!rows.length) return;
    const next = rows[(rows.indexOf(from) + step + rows.length) % rows.length];
    if (next) next.focus();
  }

  function mountSelector() {
    if (global.REALM_I18N_EMBEDDED) return;
    if (document.getElementById('langOpen')) return;
    const box = document.createElement('div');
    box.id = 'langBox';
    box.className = 'lang';
    /* Its own words are set here and nowhere else, so the page-wide translator
       has no business walking through it. */
    box.setAttribute('data-i18n-skip', '');

    trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'langOpen';
    trigger.className = 'corner-button lang-open';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');
    sign = document.createElement('span');
    sign.className = 'corner-glyph lang-sign';
    sign.setAttribute('aria-hidden', 'true');
    caption = document.createElement('span');
    caption.className = 'lang-caption';
    const arrow = document.createElement('span');
    arrow.className = 'lang-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▾';
    trigger.append(sign, caption, arrow);

    menu = document.createElement('div');
    menu.id = 'langMenu';
    menu.className = 'lang-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('language.selectAria'));

    box.append(trigger, menu);
    const corner = document.getElementById('corner');
    const say = document.getElementById('sayBox');
    if (corner && say && say.parentElement === corner) say.after(box);
    else if (corner) corner.prepend(box);
    else document.body.append(box);

    buildMenu();
    paintSelector();

    trigger.addEventListener('click', event => { event.stopPropagation(); showMenu(menu.hidden); });
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      showMenu(true);
    });
    menu.addEventListener('click', event => {
      event.stopPropagation();
      const row = event.target.closest('[data-locale]');
      if (!row) return;
      showMenu(false);
      trigger.focus();
      setLocale(row.dataset.locale);
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { showMenu(false); trigger.focus(); return; }
      const row = event.target.closest('.lang-pick');
      if (!row) return;
      const rows = [...menu.querySelectorAll('.lang-pick')];
      if (event.key === 'ArrowDown') { event.preventDefault(); walk(row, 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); walk(row, -1); }
      else if (event.key === 'Home') { event.preventDefault(); walk(row, -rows.indexOf(row)); }
      else if (event.key === 'End') { event.preventDefault(); walk(row, -1 - rows.indexOf(row)); }
      else if (event.key === 'Tab') showMenu(false);
    });
    /* Anywhere else, and it is answered - the same as the panel beside it. */
    document.addEventListener('click', event => {
      if (!menu.hidden && !box.contains(event.target)) showMenu(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) { showMenu(false); trigger.focus(); }
    });
  }

  function init() {
    mountSelector();
    observer = observe(document.body);
    global.dispatchEvent(new CustomEvent('realmtools:locale-ready', { detail: { locale } }));
  }

  global.RealmI18n = Object.freeze({
    locales: LOCALES, names: NAMES, flags: FLAGS, auto: AUTO,
    get locale() { return locale; },
    /* Whether this language was detected rather than chosen, and what the
       detection says right now - which the menu shows even when it is off. */
    get following() { return auto; },
    get detected() { return fromBrowser() || 'en'; },
    match, options,
    t, label: translatedSource, number, date, canonicalSearch, localize, observe, setLocale
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);

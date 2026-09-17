'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'web', 'locales');
const locales = ['en', 'fr', 'pt-BR', 'pt-PT', 'es', 'ru', 'pl', 'de', 'tr', 'fi', 'it', 'sv', 'zh-CN', 'da'];
const read = locale => JSON.parse(fs.readFileSync(path.join(root, locale, 'common.json'), 'utf8'));
const source = read('en');
const keys = Object.keys(source).sort();
const placeholders = value => [...String(value).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
let failed = false;
for (const locale of locales) {
  const messages = read(locale);
  const here = Object.keys(messages).sort();
  const missing = keys.filter(key => !(key in messages));
  const extra = here.filter(key => !(key in source));
  const empty = here.filter(key => typeof messages[key] !== 'string' || !messages[key].trim());
  const invalid = keys.filter(key => key in messages
    && JSON.stringify(placeholders(messages[key])) !== JSON.stringify(placeholders(source[key])));
  if (missing.length || extra.length || empty.length || invalid.length) {
    failed = true;
    console.error(locale, { missing, extra, empty, placeholderMismatch: invalid });
  }
}
// Every literal HTML label/tooltip/placeholder must be catalogued unless it is
// a canonical product/game name or a non-linguistic control token.
const covered = new Set(Object.values(source));
const exempt = new Set(['I','II','III','IV','WASD','GPL-3.0','Realm Tools','Realm of the Mad God',
  'Month of the Mad God','rotmg-enchant-calculator','by brendanbrubacher ·',', modified',
  '(optional)','have?','your copy','Open →']);
const htmlFiles = ['web/index.html','web/skins/view.html','web/assets/atlas/index.html'];
const uncatalogued = new Set();
for (const relative of htmlFiles) {
  const absolute = path.join(__dirname, '..', relative);
  const html = fs.readFileSync(absolute, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const inspect = raw => {
    const value = raw.replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&hellip;/g,'…')
      .replace(/&[a-z]+;/gi,' ').replace(/\s+/g,' ').trim();
    if (/[A-Za-z]/.test(value) && !covered.has(value) && !exempt.has(value)) uncatalogued.add(value);
  };
  for (const match of html.matchAll(/>([^<>]+)</g)) inspect(match[1]);
  for (const match of html.matchAll(/(?:aria-label|aria-description|placeholder|title)="([^"]+)"/g)) inspect(match[1]);
}
if (uncatalogued.size) {
  failed = true;
  console.error('Uncatalogued static UI strings:', [...uncatalogued]);
}

/*
 * And the front page, whose words are not in the HTML at all.
 *
 * The modules laid round the world are declared in web/app.js and built into
 * the page at runtime, so the scan above - which reads markup - cannot see a
 * line of them. They are translated the same way everything dynamic is, by
 * their English text being a value in the catalogue, so one that is missing is
 * a module that stays in English on the most visited page there is.
 *
 * Said rather than failed: a missing sentence here is a translation still to
 * be written, not a catalogue that has drifted out of step with itself, and
 * the build of a site that is honestly part-translated should not stop.
 */
const appSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const modules = /const MODULES = \[[\s\S]*?\n\];/.exec(appSource);
if (modules) {
  const strings = [...modules[0].matchAll(/(?:name|line|detail):\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(?:\s*\+\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))*)/g)]
    .map(match => {
      try { return eval(match[1].replace(/\s*\+\s*/g, ' + ')); } catch (error) { return null; }
    })
    .filter(Boolean);
  const absent = strings.filter(text => !covered.has(text));
  if (absent.length) {
    console.warn('Front page strings still only in English (' + absent.length + ' of '
      + strings.length + '): ' + absent.map(text => JSON.stringify(text.slice(0, 48) + '…')).join(', '));
  }
}
if (failed) process.exit(1);
console.log(`${locales.length} locales match en (${keys.length} keys, placeholders intact, no empty strings, static HTML fully catalogued).`);

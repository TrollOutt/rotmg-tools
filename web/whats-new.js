/*
 * What the update brought.
 *
 * The page is one place with a few ways through it. An Overview comes first:
 * the title, the numbers, a mosaic of what is new, and the seasonal modes -
 * the Crucible and the Blood Ritual - as they stood in that update. Then the
 * Summary, which tells the story of the update with the things it names, and
 * one table per kind of thing. A history selector reaches the updates before.
 *
 * Who owns what:
 *   - the Index knows what every thing IS - its picture, its figures, its
 *     words, the family it belongs to. The page reads all of that from there
 *     and keeps no second copy of it;
 *   - the update (tools/diff-client.js, two extractions of the client compared
 *     object for object) says what came, what changed and what left, what a
 *     rework moved, and the animation strips for things that move;
 *   - the account of why (data/Updates) is written by hand, because no client
 *     will ever tell you.
 *
 * A thing's Index card opens in a window of this page, and a skin can be
 * tried there, on the Skin Viewer's own stage.
 */
var WhatsNew = (function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* The order the kinds sit in: what you hold, what you wear, who you become, where you go. */
  const GROUPS = [
    ['weapons', 'Weapons'],
    ['abilities', 'Abilities'],
    ['armour', 'Armour'],
    ['rings', 'Rings'],
    ['skins', 'Skins'],
    ['consumables', 'Consumables'],
    ['places', 'Places']
  ];
  const WHY = { added: 'new', changed: 'changed', gone: 'gone' };
  const STATS = ['HP', 'MP', 'ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS'];

  /* The stat colours every player already reads. */
  const TINT = { HP: '#58cfda', MP: '#f4d24c', ATT: '#ca46dd', DEF: '#8b9cb3', SPD: '#58da6e', DEX: '#ff5f2a', VIT: '#dd0c32', WIS: '#4b9be7' };
  const TAG = { MAXHP: 'HP', MAXMP: 'MP' };
  const WORDS = { defense: 'DEF', defence: 'DEF', dexterity: 'DEX', vitality: 'VIT', wisdom: 'WIS' };
  const word = (text, key) => '<b class="pn-st" style="color:' + TINT[key] + '">' + text + '</b>';
  /* A sentence with every statistic it names in its own colour. */
  const tint = text => esc(text)
    .replace(/\b(HP|MP|ATT|DEF|SPD|DEX|VIT|WIS)\b/g, m => word(m, m))
    .replace(/\b(defen[cs]e|dexterity|vitality|wisdom)\b/gi, m => word(m, WORDS[m.toLowerCase()]));

  let data = null;                       // the update's own index.json
  let art = null;                        // bundled data URIs, when standalone
  let ix = null;                         // the Index's records, when it could be read
  let items = [];                        // every thing the update names, as the page draws it
  let byN = new Map();
  let fx = new Map();                    // status effects by name, for the rules' icons
  let fxRx = null;
  let thing = () => null;                // any Index record by name, as an item of its own

  const bundle = () => (typeof window !== 'undefined' && window.ROTMG_BUNDLE) || null;
  const stripUrl = file => (art && art[file]) ? art[file] : 'assets/whats-new/' + file;
  const sheetUrl = () => (bundle() && bundle().indexSheet) || 'assets/index/sheet.png';
  const statusUrl = () => (bundle() && bundle().statusSheet) || 'assets/index/status-icons.png';

  /* ---------------- what the Index says a thing is ---------------- */
  const HAND = { weapon: 'weapons', ability: 'abilities', armor: 'armour', ring: 'rings' };
  const BACKSLASH_N = String.fromCharCode(92) + 'n';
  const cut = s => String(s || '').split(BACKSLASH_N)[0].split(String.fromCharCode(10))[0];
  const SHELF = { 'skin unlocker': 'Skin unlocker', 'pet skin': 'Pet item', 'pet egg': 'Pet item', shard: 'Material', token: 'Material', material: 'Material', mark: 'Material',
    'enchant dust': 'Material', dye: 'Dye', emote: 'Emote', entrance: 'Emote', gravestone: 'Emote', title: 'Title', key: 'Key', artifact: 'Artifact', consumable: 'Consumable' };
  const GEAR_LABEL = { WEAPON: 'weapons', ABILITY: 'abilities', ARMOR: 'armour', RING: 'rings' };
  const KINDS = new Set(['item', 'skin', 'portal', 'place']);

  const nameOf = t => String(t.id).replace(/\s+/g, ' ').trim();
  const classOf = r => { const w = (r.out || []).find(x => x[0] === 'worn by'); return w ? String(w[1]).replace(/^class:/, '') : ''; };

  function indexLookups(index) {
    const byName = new Map();
    for (const r of index.all.values()) {
      if (!KINDS.has(r.kind)) continue;
      const n = r.said || r.name;
      const had = byName.get(n);
      if (!had || (had.hidden && !r.hidden)) byName.set(n, r);
    }
    const find = name => {
      const base = name.replace(/ x\d+$/, '');
      let r = byName.get(name) || byName.get(base);
      for (let k = 1; k <= 14 && !r; k++) r = byName.get(base + ' x' + k);
      return r || null;
    };
    const kindOf = r => {
      if (r.kind === 'skin') return 'Skin' + (classOf(r) ? ' · ' + classOf(r) : '');
      if (r.kind === 'portal') return 'Dungeon';
      if (r.hand) {
        const slot = ((index.slots || {})[r.slot] || [])[0] || ({ weapon: 'Weapon', ability: 'Ability', armor: 'Armour', ring: 'Ring' })[r.hand];
        const labels = r.labels || [];
        return slot + (r.tier !== undefined ? ' · T' + r.tier : labels.includes('UT') ? ' · UT' : labels.includes('ST') ? ' · ST' : '');
      }
      return SHELF[r.family] || 'Consumable';
    };
    const groupOf = r => r.kind === 'skin' ? 'skins' : r.kind === 'portal' || r.kind === 'place' ? 'places' : r.kind === 'item' ? (r.hand ? HAND[r.hand] : 'consumables') : null;
    /* The thing as the page draws it: the Index's record, in the shape the pieces below read. */
    const viewOf = (t, r) => {
      const f = {}, s = (r.fires || [])[0];
      if (s && s.low !== undefined) f.damage = s.low === s.high ? String(s.low) : s.low + '-' + s.high;
      if (s && s.reach !== undefined) f.range = s.reach;
      const rate = r.rate !== undefined ? r.rate : s && s.rate;
      if (rate !== undefined) f['rate of fire'] = rate;
      if (r.shots > 1) f.shots = r.shots;
      if (r.mp !== undefined) f['mp cost'] = r.mp;
      if (r.cool !== undefined) f.cooldown = r.cool;
      for (const k of Object.keys(r.worn || {})) f['on equip ' + k] = r.worn[k];
      if (r.sb) f.soulbound = true;
      if (s && s.pierce) f.pierces = true;
      if (r.kind === 'skin') { f.for = classOf(r); if (r.tier !== undefined) f.tier = r.tier; f.class = 'Skin'; }
      return { id: r.said || r.name, description: cut(r.about), labels: r.labels || [], facts: f, sheet: r.art && r.art[2] ? r.art : null,
        sprite: t.sprite, moved: t.moved, __kind: kindOf(r), __id: r.id };
    };
    return { find, groupOf, viewOf };
  }

  /* Without the Index, the update's own thinner copy of a thing has to do. */
  function plainGroup(drawer, t) {
    if (GROUPS.some(g => g[0] === drawer)) return drawer;
    for (const l of t.labels || []) if (GEAR_LABEL[l]) return GEAR_LABEL[l];
    return /Portal$/.test(nameOf(t)) ? 'places' : 'consumables';
  }

  function build() {
    const label = Object.fromEntries(GROUPS.map(g => [g[0], g[1]]));
    const look = ix ? indexLookups(ix) : null;
    items = [];
    const folded = new Map();
    let n = 0;
    for (const [drawerName, drawer] of Object.entries(data.drawers || {})) {
      for (const why of ['added', 'changed', 'gone']) for (const t of drawer[why] || []) {
        const cls = (t.facts || {}).class;
        // A pet and its skin's definition are the client's plumbing; what a player gets is the pet skin item, a consumable.
        if (cls === 'Pet' || cls === 'PetSkin' || drawerName === 'pets') continue;
        const name = nameOf(t), r = look && look.find(name);
        let g = r && look.groupOf(r), view = t;
        if (r && g) view = look.viewOf(t, r);
        else {
          g = plainGroup(drawerName, t);
          view = Object.assign({}, t, { description: cut(t.description) });
          if (look) view.__kind = g === 'places' ? 'Dungeon' : g === 'consumables' ? 'Consumable' : undefined;
        }
        const stack = /^(.*\S) x(\d+)$/.exec(name);
        if (g === 'consumables' && stack) {
          // Fourteen sizes of one shard are one shard.
          const key = why + '|' + stack[1];
          if (folded.has(key)) { folded.get(key).sizes.push(+stack[2]); continue; }
          view.id = stack[1];
          const one = { n: n++, g, label: label[g], why, t: view, sizes: [+stack[2]] };
          folded.set(key, one); items.push(one);
          continue;
        }
        items.push({ n: n++, g, label: label[g], why, t: view });
      }
    }
    for (const one of folded.values()) {
      const s = one.sizes.sort((a, b) => a - b);
      if (s.length > 1) one.t.__kind = (one.t.__kind || 'Consumable') + ' · in stacks of ' + s[0] + ' to ' + s[s.length - 1];
    }
    let extra = 0;
    byN = new Map(items.map(i => [i.n, i]));
    thing = (name, tag) => {
      const r = look && look.find(name);
      if (!r) return null;
      const i = { n: 100000 + extra++, g: 'extra', label: tag || 'Index', why: 'added', t: look.viewOf({}, r) };
      byN.set(i.n, i);
      return i;
    };
    fx = new Map();
    fxRx = null;
    if (ix) for (const r of ix.all.values()) if (r.kind === 'status' && r.statusArt) fx.set(r.name, { tone: r.tone, icon: r.statusArt });
    entries = null;
  }

  const inGroup = g => items.filter(i => i.g === g);

  /* ---------------- pictures ---------------- */
  const clipsOf = t => (t.sprite && t.sprite.clips) || null;
  const moves = t => { const c = clipsOf(t); return !!(c && c.walk && c.walk.frames > 1); };
  const hasArt = t => { const c = clipsOf(t); return !!(t.sheet || (c && (c.walk || c.stand || c.attack))); };
  const fileOf = t => { const c = clipsOf(t); return t.sheet ? 'sheet:' + t.sheet.join(',') : c ? Object.values(c)[0].file : t.id; };
  /*
   * A sprite, sized by whole numbers so the pixels stay square, and rounded
   * down so it never leaves its box: a sixteen-pixel walker asked to fit forty
   * pixels is drawn at thirty-two, not forty-eight. It walks as the game draws
   * it. (The attack strips are not laid out the way the data says - frames of
   * the walk's size in a grid - so only the walk is played.)
   */
  function picture(t, aim, max) {
    const clips = clipsOf(t);
    // The Index's own picture, unless the thing moves and the update has cut its walk.
    if (t.sheet && ix && ix.sheet && !moves(t)) {
      const [x, y, w, h] = t.sheet, z = Math.max(1, Math.min(max || 12, Math.floor((aim || 56) / Math.max(w, h, 8))));
      return '<span class="wn-art pn-sheet" style="width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(\'' + sheetUrl() + '\');background-size:'
        + ix.sheet.wide * z + 'px ' + ix.sheet.tall * z + 'px;background-position:' + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
    }
    const rest = clips && (clips.walk || clips.stand || clips.attack);
    if (!rest) {
      const side = Math.max(24, Math.round((aim || 56) * 0.6));
      return '<span class="pn-blank" style="width:' + side + 'px;height:' + side + 'px" aria-hidden="true">' + esc(nameOf(t).charAt(0)) + '</span>';
    }
    const scale = Math.max(1, Math.min(max || 12, Math.floor((aim || 56) / rest.height)));
    const style = ['width:' + (rest.tile * scale) + 'px', 'height:' + (rest.height * scale) + 'px',
      '--wn-rest:url(\'' + stripUrl(rest.file) + '\')', '--wn-rest-w:' + (rest.tile * rest.frames * scale) + 'px',
      '--wn-rest-steps:' + rest.frames, '--wn-rest-time:' + (rest.frames * 0.22).toFixed(2) + 's'];
    return '<span class="wn-art' + (rest.frames > 1 ? ' is-moving' : '') + '" style="' + style.join(';') + '"></span>';
  }

  /* ---------------- facts ---------------- */
  const GENERIC = /^(EQUIPMENT|WEAPON|ABILITY|ARMOR|RING|TAB_.*|POWERTIER_.*|XPBONUS|TRADEABLE|MPCOST|STATMOD|SOULBOUND|UT|ST|T\d+|REALMWHITE|COOLDOWN|RESKIN|AOO|LEGION_ELITE|SHINY|ORG_.*|SUMMONPOWERED|SET.*|HAS_.*|NUMPROJ.*|STGEN.*|ST_.*|ENCHANT.*|.*_ENCHANTABLE|CAUSE_.*|APPLY_.*|PROC|ONHIT|CONSUMABLE|LOOTABLE)$/;
  const title = s => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
  const tierOf = t => { const l = t.labels || []; return l.includes('UT') ? 'UT' : l.includes('ST') ? 'ST' : (l.find(x => /^T\d+$/.test(x)) || ''); };
  const kindOf = t => {
    const f = t.facts || {};
    if (t.__kind) return t.__kind;
    if (f.class === 'Skin') return 'Skin' + (f.for ? ' · ' + f.for : '');
    if (f.class === 'Portal') return 'Portal';
    const type = (t.labels || []).find(l => !GENERIC.test(l));
    return [type && title(type), tierOf(t)].filter(Boolean).join(' · ') || f.class || '';
  };
  const worn = t => {
    const f = t.facts || {}, out = [];
    for (const k of Object.keys(f)) if (k.startsWith('on equip ')) { const tag = TAG[k.slice(9)] || k.slice(9); out.push([tag, f[k]]); }
    return out.sort((a, b) => STATS.indexOf(a[0]) - STATS.indexOf(b[0]));
  };
  const pills = t => worn(t).map(([tag, v]) =>
    '<span class="pn-pill pn-stat' + (v < 0 ? ' is-cut' : '') + '" style="--tint:' + TINT[tag] + '"><b>' + (v > 0 ? '+' : '') + v + '</b> ' + tag + '</span>').join('');
  const dmg = v => String(v).replace('-', '–').replace(/^(\d+(?:\.\d+)?)–\1$/, '$1');
  const figures = t => {
    const f = t.facts || {}, out = [];
    if (f.damage) out.push(['Damage', dmg(f.damage)]);
    if (f['rate of fire'] !== undefined) out.push(['Rate', Math.round(f['rate of fire'] * 100) + '%']);
    if (f.range !== undefined) out.push(['Range', f.range + ' tiles']);
    if (f.shots > 1) out.push(['Shots', String(f.shots)]);
    if (f['mp cost'] !== undefined) out.push(['MP cost', String(f['mp cost'])]);
    if (f.cooldown !== undefined) out.push(['Cooldown', f.cooldown + ' s']);
    return out;
  };
  const flags = t => { const f = t.facts || {}; return [f.pierces && 'Pierces', f['passes cover'] && 'Passes cover', f.soulbound && 'Soulbound'].filter(Boolean); };
  const figureHtml = t => figures(t).map(([k, v]) => '<span class="pn-fig"><i>' + tint(k) + '</i> <b>' + esc(v) + '</b></span>').join('');

  /* What a rework changed, in a few plain words. */
  const diff = t => {
    const out = [];
    for (const m of t.moved || []) {
      if (m.fact === 'labels') {
        const a = new Set(String(m.was || '').split(',')), b = new Set(String(m.now || '').split(','));
        const tier = x => (String(x).split(',').find(l => /^POWERTIER_/.test(l)) || '').replace('POWERTIER_', '');
        if (tier(m.was) !== tier(m.now)) out.push(['Power tier', tier(m.was) || '—', tier(m.now) || '—']);
        for (const l of b) if (!a.has(l) && !/^POWERTIER_/.test(l)) out.push(['Now', null, title(l)]);
        for (const l of a) if (!b.has(l) && !/^POWERTIER_/.test(l)) out.push(['No longer', null, title(l)]);
      } else if (m.fact === 'soulbound' && m.now === null) out.push(['No longer', null, 'soulbound']);
      else out.push([m.fact, m.was === null ? '—' : String(m.was), m.now === null ? '—' : String(m.now)]);
    }
    return out;
  };
  const diffHtml = t => diff(t).map(([k, was, now]) => was === null
    ? '<span class="pn-diff"><i>' + esc(k) + '</i> <b>' + esc(now) + '</b></span>'
    : '<span class="pn-diff"><i>' + esc(k) + '</i> <s>' + esc(was) + '</s> → <b>' + esc(now) + '</b></span>').join('');
  const whyBadge = why => '<em class="pn-why is-' + why + '">' + WHY[why] + '</em>';

  /* The full detail of one thing, as a table row opens it. */
  function detail(i) {
    const t = i.t, fl = flags(t);
    return '<article class="pn-detail">'
      + (t.description ? '<p class="pn-desc">' + esc(t.description) + '</p>' : '')
      + (i.why === 'changed' && diff(t).length ? '<p class="pn-line pn-diffs">' + diffHtml(t) + '</p>' : '')
      + (figures(t).length ? '<div class="pn-figs">' + figures(t).map(([k, v]) => '<span><i>' + tint(k) + '</i><b>' + esc(v) + '</b></span>').join('') + '</div>' : '')
      + (worn(t).length ? '<p class="pn-line">' + pills(t) + '</p>' : '')
      + (fl.length ? '<p class="pn-line">' + fl.map(f => '<span class="pn-pill">' + esc(f) + '</span>').join('') + '</p>' : '')
      + (t.__id ? '<button type="button" class="pn-open" data-card="' + i.n + '">Index card</button>' : '')
      + '</article>';
  }

  /* ---------------- the account of the update ---------------- */
  const parts = () => (data && data.notes && data.notes.parts) || [];
  /* "Weapons — Doom Bow, …" reads with its lead word set apart. */
  const point = text => {
    const m = /^([A-Z][A-Za-z' ]{2,26}) — (.+)$/.exec(text);
    return m && m[1].split(' ').length <= 3 ? '<b class="pn-lead">' + esc(m[1]) + '</b> ' + tint(m[2]) : tint(text);
  };
  let entries = null;
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  /* The things a text names, in the order it names them: the pictures that settle what a name only suggests. */
  function mentions(text, limit) {
    if (!entries) {
      entries = [];
      for (const i of items) {
        if (i.why === 'gone' || !hasArt(i.t)) continue;
        const base = norm(nameOf(i.t));
        for (const v of new Set([base, base.replace(/^legacy /, '').replace(/ portal$/, ''), base.replace(/^venerable /, '').replace(/ \(sb\)$/, '')])) if (v.length >= 6) entries.push([v, i]);
      }
      entries.sort((a, b) => b[0].length - a[0].length);
    }
    const low = norm(text), found = [], seen = new Set(), files = new Set();
    let rest = low;
    for (const [v, i] of entries) {
      if (seen.has(i.n) || !rest.includes(v)) continue;
      const file = fileOf(i.t);
      if (files.has(file) && found.length > 3) continue;
      files.add(file); seen.add(i.n);
      found.push([low.indexOf(v), i]);
      rest = rest.split(v).join(' ');
      if (found.length >= (limit || 30)) break;
    }
    return found.sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }
  /* Two stories name nothing a name search can find; their things are linked by hand. */
  const BY_HAND = { 'Missions and campaigns': ['Decennial Chrono Wizard', 'Timekeeper Mystic'], 'Battle Pass — The Old Ways': ['Celestial Harmonist Bard', 'Celestial Sentinel Knight'] };
  function partThings(p, limit) {
    const found = mentions(p.title + ' ' + p.points.join(' '), limit), have = new Set(found.map(i => i.n));
    for (const name of BY_HAND[p.title] || []) {
      const i = items.find(x => nameOf(x.t) === name && x.g !== 'consumables');
      if (i && !have.has(i.n)) { found.push(i); have.add(i.n); }
    }
    return found;
  }
  /* What a story holds, said as a count by kind: "3 weapons · 1 armour". */
  function holds(list) {
    const by = new Map();
    for (const i of list) by.set(i.label, (by.get(i.label) || 0) + 1);
    const one = { Weapons: 'weapon', Abilities: 'ability', Rings: 'ring', Skins: 'skin', Consumables: 'consumable', Places: 'place' };
    return [...by].map(([label, n]) => n + ' ' + (n === 1 && one[label] ? one[label] : label.toLowerCase())).join(' · ');
  }

  /* Four to a kind's face: things that move first, no picture twice. */
  function lead(g, k) {
    const all = inGroup(g).filter(i => i.why !== 'gone');
    const ranked = all.slice().sort((a, b) => (moves(a.t) ? 0 : hasArt(a.t) ? 1 : 2) - (moves(b.t) ? 0 : hasArt(b.t) ? 1 : 2));
    const seen = new Set(), first = [], rest = [];
    for (const i of ranked) { const key = fileOf(i.t); (seen.has(key) ? rest : first).push(i); seen.add(key); }
    return first.concat(rest).slice(0, k || 4);
  }

  /* The numbers of the update. */
  function numbers() {
    const c = data.counts || { added: 0, changed: 0, gone: 0 };
    return '<div class="pn-numbers"><span><b>' + c.added + '</b> added</span><span><b>' + c.changed + '</b> changed</span><span><b>' + c.gone + '</b> gone</span></div>';
  }

  /*
   * A line of rules, in words: every stat it names in its colour, every status
   * with the picture the game gives it.
   */
  function rule(text) {
    const sheet = ix && ix.statusSheet;
    if (!fx.size || !sheet) return tint(text);
    if (!fxRx) fxRx = new RegExp('\\b(' + [...fx.keys()].filter(k => k !== 'Healing').sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'g');
    let out = '', at = 0;
    for (const m of text.matchAll(fxRx)) {
      const e = fx.get(m[1]), z = 2;
      out += tint(text.slice(at, m.index))
        + '<span class="pn-fx is-' + (e.tone === 'good' ? 'good' : 'bad') + '"><span class="pn-fxi" style="width:' + e.icon[2] * z + 'px;height:' + e.icon[3] * z + 'px;background-image:url(\'' + statusUrl() + '\');background-size:'
        + sheet.wide * z + 'px ' + sheet.tall * z + 'px;background-position:' + (-e.icon[0] * z) + 'px ' + (-e.icon[1] * z) + 'px"></span>' + esc(m[1]) + '</span>';
      at = m.index + m[0].length;
    }
    return out + tint(text.slice(at));
  }
  /* The same stat, drawn big: what a modifier does to you. */
  const statChip = s => {
    const v = (s.value > 0 ? '+' : '−') + Math.abs(s.value) + (s.pct ? '%' : '');
    return '<span class="pn-pill pn-stat pn-bigstat' + (s.value < 0 ? ' is-cut' : '') + '" style="--tint:' + TINT[s.stat] + '"><b>' + v + '</b> ' + s.stat + '</span>';
  };
  const BONUS = { loot: 'Loot', bxp: 'Bonus XP', xp: 'XP' };

  /* ================================================================== *
   * The page                                                            *
   * ================================================================== */
  let app = null;
  let groups = [];
  let updates = [];
  let uAt = 0, pages = ['overview'], at = 0;
  let menuOpen = false, fresh = false, story = 0, why = 'all', q = '', sort = null, open = new Set(), pinned = null;
  const upd = () => updates[uAt];
  const page = () => pages[at];

  /* ---------------- the updates: one per Crucible, newest first ---------------- */
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ymd = iso => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const fmt = (a, b) => {
    const x = ymd(a), y = ymd(b);
    return MONTH[x.m - 1] + ' ' + x.d + (x.y !== y.y ? ', ' + x.y : '') + ' – ' + MONTH[y.m - 1] + ' ' + y.d + ', ' + y.y;
  };
  const label = u => u.season ? 'Season ' + u.season + (u.part ? ' · Part ' + u.part : '') : (data.notes && data.notes.title) || "What's New";
  const titleOf = u => u.archived ? (data.notes && data.notes.title) || label(u) : label(u);
  const pagesFor = u => u.archived ? ['overview', 'summary'].concat(groups.map(g => g[0])) : ['overview'];
  const saidPage = p => p === 'overview' ? 'Overview' : p === 'summary' ? 'Summary' : (GROUPS.find(x => x[0] === p) || [])[1];
  /* What the Blood Ritual did in a season: nothing is assumed, only what was written down for that season. */
  const ritualOf = u => ((data.ritual && data.ritual.seasons) || []).find(s => s.season === u.season && (s.part || null) === (u.part || null)) || null;

  function setUpdates() {
    const date = data.notes && data.notes.date;
    const seasons = (data.crucible || []).map((s, i) => Object.assign({}, s, { latest: i === 0, archived: s.from === date }));
    // Without the seasons, the one update there is is the one the account tells.
    updates = seasons.length ? seasons : [{ season: 0, from: date || '', to: date || '', stats: [], bonuses: {}, rules: [], latest: true, archived: true }];
    uAt = 0;
    pages = pagesFor(updates[0]);
    at = 0;
  }

  /* ---------------- the columns of the tables ---------------- */
  const fact = (t, k) => (t.facts || {})[k];
  const avg = v => { const m = String(v).split('-').map(Number); return m.length === 2 ? (m[0] + m[1]) / 2 : Number(v); };
  const stat = tag => t => fact(t, 'on equip ' + (tag === 'HP' ? 'MAXHP' : tag === 'MP' ? 'MAXMP' : tag));
  const COL = {
    dmg: { say: 'Damage', get: t => fact(t, 'damage'), num: t => avg(fact(t, 'damage')), fmt: dmg },
    rate: { say: 'Rate', get: t => fact(t, 'rate of fire'), num: t => fact(t, 'rate of fire'), fmt: v => Math.round(v * 100) + '%' },
    range: { say: 'Range', get: t => fact(t, 'range'), num: t => fact(t, 'range'), fmt: v => v },
    shots: { say: 'Shots', get: t => fact(t, 'shots'), num: t => fact(t, 'shots'), fmt: v => v },
    mp: { say: 'MP cost', get: t => fact(t, 'mp cost'), num: t => fact(t, 'mp cost'), fmt: v => v, tint: 'MP' },
    cd: { say: 'Cooldown', get: t => fact(t, 'cooldown'), num: t => fact(t, 'cooldown'), fmt: v => v + ' s' },
    cls: { say: 'Class', get: t => fact(t, 'for'), num: t => fact(t, 'for'), fmt: v => esc(v), left: true },
    tier: { say: 'Tier', get: t => fact(t, 'tier'), num: t => fact(t, 'tier'), fmt: v => v },
    about: { say: 'About', get: t => t.description, num: () => 0, fmt: v => esc(cut(v)), left: true, about: true }
  };
  for (const s of STATS) COL[s] = { say: s, get: stat(s), num: stat(s), fmt: v => (v > 0 ? '+' : '') + v, tint: s, stat: true };
  const SETS = {
    weapons: ['dmg', 'rate', 'range', 'shots', ...STATS], abilities: ['mp', 'cd', 'dmg', 'range', ...STATS],
    armour: STATS, rings: STATS, skins: ['cls', 'tier'], consumables: ['about'], places: []
  };
  const rank = { changed: 0, added: 1, gone: 2 };

  /* ---------------- the header and the way through the updates ---------------- */
  function menuHtml() {
    return '<span class="pm-menu pn-hide" role="listbox">' + updates.map((x, i) =>
      '<button type="button" role="option" data-upd="' + i + '" class="' + (i === uAt ? 'is-on' : '') + '"><span><b>' + esc(label(x)) + '</b>'
      + (x.archived && x.season ? ' <span class="nm">' + esc(data.notes.title) + '</span>' : '') + '</span>'
      + (x.latest ? '<em>Latest</em>' : x.archived ? '<em class="is-soft">Notes</em>' : '') + '<small>' + esc(x.from ? fmt(x.from, x.to) : '') + '</small></button>').join('') + '</span>';
  }
  function headerDraw() {
    const u = upd(), notes = data.notes || {};
    const h1 = $('newsTitle'), sub = $('newsHead'), sel = $('newsUpd');
    if (h1) h1.innerHTML = '<a class="title" href="#news" data-at="0">' + esc(titleOf(u)) + '</a>';
    if (sub) sub.innerHTML = u.archived ? esc(notes.subtitle || '') + ' <span class="wn-dim">· ' + esc(notes.date || '') + '</span>' : esc(fmt(u.from, u.to));
    if (sel) {
      sel.hidden = updates.length < 2;
      sel.innerHTML = '<button type="button" class="pm-upd" data-menu aria-haspopup="listbox" aria-expanded="' + menuOpen + '">' + esc(label(u))
        + (u.latest ? '<em>Latest</em>' : '') + '<i>▾</i></button>' + (menuOpen ? menuHtml() : '');
    }
  }
  function tabsHtml() {
    const u = upd(), tab = (p, icon, say, count, cls) => '<button type="button" data-page="' + p + '" class="' + (cls || '') + (page() === p ? ' is-on' : '') + '">'
      + (icon ? '<span class="pic">' + icon + '</span>' : '') + esc(say) + (count !== undefined ? ' <small>' + count + '</small>' : '') + '</button>';
    return '<div class="pm-tabs">' + tab('overview', '⌂', 'Overview', undefined, 'home')
      + (u.archived ? tab('summary', '', 'Summary', undefined, 'story') + groups.map(([g, say]) => {
        const first = lead(g, 1)[0];
        return tab(g, first ? picture(first.t, 24, 3) : '', say, inGroup(g).length);
      }).join('') : '') + '</div>';
  }

  /* ---------------- the bar for what the pointer is on ---------------- */
  const capHtml = i => {
    if (!i) return '<span class="mute">Point at one</span>';
    const t = i.t, kept = pinned === i.n, table = pages.includes(i.g);
    return '<span class="pn-stage">' + picture(t, 56, 7) + '</span><div class="body"><div class="top"><p class="pn-kind">' + esc(kindOf(t)) + ' · ' + esc(i.label) + '</p>'
      + '<span class="go"><span class="hint">' + (kept ? 'Kept · click again to let go' : 'Click to keep') + '</span>' + (table ? '<button type="button" data-find="' + i.n + '">In the table</button>' : '')
      + (t.__id ? '<button type="button" data-card="' + i.n + '">Index card</button>' : '') + '</span></div>'
      + '<h3>' + esc(nameOf(t)) + (i.why === 'added' ? '' : whyBadge(i.why)) + '</h3>' + (t.description ? '<p class="d">' + esc(t.description) + '</p>' : '')
      + '<p class="pn-line">' + (i.why === 'changed' ? diffHtml(t) : '') + figureHtml(t) + pills(t) + '</p></div>';
  };
  const capBox = () => '<div class="pm-cap' + (pinned !== null ? ' is-pinned' : '') + '" id="newsCap">' + capHtml(pinned !== null ? byN.get(pinned) : null) + '</div>';
  const showCap = i => { const c = $('newsCap'); if (c) c.innerHTML = capHtml(i); };

  /* ---------------- the Crucible and the Blood Ritual, in the overview ---------------- */
  const statsHtml = u => u.stats && u.stats.length ? '<div class="pc-chips">' + u.stats.map(statChip).join('') + '</div>' : '';
  const bonusHtml = u => ['loot', 'bxp', 'xp'].filter(k => (u.bonuses || {})[k] !== undefined).map(k => '<span class="pc-fig"><b>+' + u.bonuses[k] + '%</b><i>' + BONUS[k] + '</i></span>').join('');
  const rulesHtml = u => (u.rules || []).map(r => '<p>' + rule(r) + '</p>').join('');
  const key = s => s.stat + (s.pct ? '%' : '');
  /* What this Crucible changed from the one before it, in a line. */
  function sinceHtml(u, prev) {
    if (!prev) return '';
    const out = [], pm = new Map(prev.stats.map(s => [key(s), s])), cm = new Map(u.stats.map(s => [key(s), s]));
    for (const [k, s] of cm) { const p = pm.get(k); if (!p) out.push(statChip(s)); else if (p.value !== s.value) out.push(statChip(p) + '<i>→</i>' + statChip(s)); }
    for (const [k, p] of pm) if (!cm.has(k)) out.push('<s>' + statChip(p) + '</s>');
    for (const k of ['loot', 'bxp', 'xp']) {
      const a = prev.bonuses[k], b = u.bonuses[k];
      if (a !== b) out.push('<span class="pc-bonus-change"><i>' + BONUS[k] + '</i> <s>' + (a === undefined ? '—' : '+' + a + '%') + '</s>→<b>' + (b === undefined ? '—' : '+' + b + '%') + '</b></span>');
    }
    const rules = u.rules.filter(r => !prev.rules.includes(r)).length + prev.rules.filter(r => !u.rules.includes(r)).length;
    if (rules) out.push('<span class="pc-bonus-change">rules changed</span>');
    return '<div class="pc-since"><h4>Since ' + esc(label(prev)) + '</h4>' + (out.length ? out.join('') : '<span class="pc-none">nothing changed</span>') + '</div>';
  }
  let crGear = [], riGear = [];
  const gearRow = list => '<span class="pc-gearrow">' + list.map(i => '<span class="pn-stage' + (pinned === i.n ? ' is-on' : '') + '" data-n="' + i.n + '">' + picture(i.t, 24, 3) + '</span>').join('') + '</span>';
  function crucibleBlock(u) {
    if (!u.season) return '';
    const prev = updates[updates.indexOf(u) + 1] || null;
    return '<section class="pc-block pc-crucible"><header><h3>Crucible</h3>' + gearRow(crGear) + '</header>'
      + statsHtml(u) + '<div class="pc-figs is-inline">' + bonusHtml(u) + '</div>'
      + (u.rules.length ? '<div class="pc-rules">' + rulesHtml(u) + '</div>' : '') + sinceHtml(u, prev) + '</section>';
  }
  function ritualBlock(u) {
    if (!u.season || !data.ritual) return '';
    const r = ritualOf(u);
    if (!r) return '<section class="pc-block pc-ritual is-off"><header><h3>Blood Ritual</h3></header><p class="pc-off">Not active this season</p></section>';
    return '<section class="pc-block pc-ritual"><header><h3>Blood Ritual</h3>' + gearRow(riGear) + '</header>' + statsHtml(r) + '<div class="pc-figs is-inline">' + bonusHtml(r) + '</div>'
      + ((r.rules || []).length ? '<div class="pc-rules">' + rulesHtml(r) + '</div>' : '') + '</section>';
  }

  /* ---------------- the overview ---------------- */
  function overviewHtml() {
    const u = upd(), notes = data.notes || {};
    const modes = (crucibleBlock(u) + ritualBlock(u)) ? '<div class="pc-stack">' + crucibleBlock(u) + ritualBlock(u) + '</div>' : '';
    if (!u.archived) {
      return '<section class="card pm-card"><div class="pm-cover pm-over"><div class="text pn-hide"><h2 class="pm-title">' + esc(label(u)) + '</h2><p class="pm-blurb">' + esc(fmt(u.from, u.to)) + '</p>'
        + '<p class="pm-lede">No record of what this update brought was kept.</p></div>'
        + '<div class="pm-right is-full">' + modes + capBox() + '</div></div></section>';
    }
    // A taste of every kind in turn, things that move first, no picture twice.
    const lists = groups.map(([g]) => inGroup(g).filter(i => i.why !== 'gone' && hasArt(i.t)).sort((x, y) => moves(y.t) - moves(x.t)));
    const seen = new Set(), shown = [], pos = lists.map(() => 0);
    for (let more = true; shown.length < 72 && more;) {
      more = false;
      lists.forEach((list, k) => {
        while (pos[k] < list.length && seen.has(fileOf(list[pos[k]].t))) pos[k]++;
        if (pos[k] < list.length && shown.length < 72) { const i = list[pos[k]++]; seen.add(fileOf(i.t)); shown.push(i); more = true; }
      });
    }
    return '<section class="card pm-card"><div class="pm-cover pm-over"><div class="text pn-hide"><h2 class="pm-title">' + esc(notes.title) + '</h2><p class="pm-blurb">' + esc(notes.subtitle || '')
      + ' <span class="wn-dim">· ' + esc(notes.date || '') + '</span></p>'
      + '<p class="pm-lede">' + tint(notes.lede || '') + '</p>' + numbers() + modes + '</div>'
      + '<div class="pm-right"><div class="pm-mosaic">' + shown.map(i => '<span class="pn-stage' + (pinned === i.n ? ' is-on' : '') + '" data-n="' + i.n + '">' + picture(i.t, 56) + '</span>').join('')
      + '</div>' + capBox() + '</div></div></section>';
  }

  function summaryHtml() {
    const all = parts();
    if (!all.length) return '<section class="card pm-card"><p class="pm-wait">No account of this update was written.</p></section>';
    const p = all[Math.min(story, all.length - 1)], found = partThings(p, 30);
    return '<section class="card pm-card"><div class="pl-story"><nav class="pn-hide">' + all.map((x, i) => {
      const own = partThings(x, 60);
      return '<button type="button" data-story="' + i + '" class="' + (i === story ? 'is-on' : '') + '">'
        + '<span class="sp">' + own.slice(0, 5).map(t => '<span class="pn-stage">' + picture(t.t, 36, 4) + '</span>').join('') + (own.length > 5 ? '<span class="more">+' + (own.length - 5) + '</span>' : '') + '</span>'
        + '<span><b>' + esc(x.title) + '</b><small>' + esc(x.blurb || '') + '</small></span>'
        + '<em>' + (own.length ? esc(holds(own)) : x.points.length + ' notes') + '</em></button>';
    }).join('') + '</nav>'
      + '<div class="pl-read"><div class="pl-text pn-hide"><h2>' + esc(p.title) + '</h2><p class="pj">' + esc(p.blurb || '') + '</p><div class="pts">' + p.points.map(x => '<p>' + point(x) + '</p>').join('') + '</div></div>'
      + '<div class="pl-side figs pn-hide">' + found.map(i => '<button type="button" class="pn-tile' + (pinned === i.n ? ' is-on' : '') + '" data-n="' + i.n + '"><span class="pn-stage">'
        + picture(i.t, 64) + '</span><span class="t">' + esc(nameOf(i.t)) + '</span></button>').join('') + '</div>' + capBox() + '</div></div></section>';
  }

  function tableHtml(g) {
    const list0 = inGroup(g);
    const cols = (SETS[g] || []).filter(k => list0.some(i => COL[k].get(i.t) !== undefined && COL[k].get(i.t) !== null));
    let list = list0.filter(i => (why === 'all' || i.why === why) && (!q || nameOf(i.t).toLowerCase().includes(q.toLowerCase())));
    list = list.slice().sort((a, b) => {
      if (sort) {
        const c = COL[sort.col], x = c.num(a.t), y = c.num(b.t);
        const nx = x === undefined || x === null, ny = y === undefined || y === null;
        if (nx !== ny) return nx ? 1 : -1;
        if (!nx && x !== y) return (typeof x === 'string' ? x.localeCompare(y) : x - y) * (sort.dir === 'asc' ? 1 : -1);
      }
      return rank[a.why] - rank[b.why] || nameOf(a.t).localeCompare(nameOf(b.t));
    });
    const count = { all: list0.length };
    for (const w of ['added', 'changed', 'gone']) count[w] = list0.filter(i => i.why === w).length;
    const head = '<tr><th class="l" colspan="2" data-sort="name">Name</th>' + cols.map(k => {
      const c = COL[k];
      return '<th data-sort="' + k + '" class="' + (c.left ? 'l ' : '') + (sort && sort.col === k ? 'is-sorted' + (sort.dir === 'asc' ? ' is-asc' : '') : '') + '"' + (c.tint ? ' style="color:' + TINT[c.tint] + '"' : '') + '>' + c.say + '</th>';
    }).join('') + '</tr>';
    const cell = (k, t) => {
      const c = COL[k], v = c.get(t);
      if (v === undefined || v === null) return '<td class="' + (c.left ? 'l ' : '') + 'pl-dim">·</td>';
      return '<td class="' + (c.left ? 'l' : '') + (c.stat && v < 0 ? ' pl-cut' : '') + (c.about ? ' pl-about' : '') + '">' + c.fmt(v) + '</td>';
    };
    const rows = list.map(i => {
      const isOpen = open.has(i.n);
      return '<tr class="pl-row pn-row' + (isOpen ? ' is-open' : '') + (i.why === 'gone' ? ' is-gone' : '') + '" data-n="' + i.n + '"><td class="art"><span class="cellart">' + picture(i.t, 40, 5) + '</span></td>'
        + '<td class="l"><span class="pl-name"><b class="nm">' + esc(nameOf(i.t)) + (i.why === 'added' ? '' : whyBadge(i.why)) + '</b><span class="pn-kind">' + esc(kindOf(i.t)) + '</span>'
        + (i.why === 'changed' ? '<span>' + diffHtml(i.t) + '</span>' : '') + '</span></td>' + cols.map(k => cell(k, i.t)).join('') + '</tr>'
        + (isOpen ? '<tr class="pl-more"><td colspan="' + (cols.length + 2) + '"><div class="wrap"><span class="pn-stage">' + picture(i.t, 96, 12) + '</span>' + detail(i) + '</div></td></tr>' : '');
    }).join('');
    return '<section class="card pm-card"><div class="pl-tools"><span class="pn-seg">' + [['all', 'All'], ['added', 'New'], ['changed', 'Changed'], ['gone', 'Gone']].filter(([k]) => k === 'all' || count[k]).map(([k, say]) =>
      '<button type="button" data-why="' + k + '" class="' + (why === k ? 'is-on' : '') + '">' + say + '<small>' + count[k] + '</small></button>').join('') + '</span>'
      + '<input class="pn-find" id="newsFind" type="search" placeholder="Search" value="' + esc(q) + '" autocomplete="off"><span class="grow"></span><span class="pl-count">' + list.length + ' of ' + list0.length + '</span></div>'
      + '<div class="pl-scroll pn-hide" id="newsScroll"><table class="pl-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  function navHtml() {
    return '<div class="pm-nav"><button type="button" class="arrow" data-step="-1" ' + (at === 0 ? 'disabled' : '') + ' aria-label="Previous">←</button>'
      + '<div class="pm-dots">' + pages.map((p, k) => '<button type="button" data-at="' + k + '" class="' + (k === at ? 'is-on' : '') + (k === 2 ? ' gap' : '') + '" title="' + esc(saidPage(p)) + '"></button>').join('') + '</div>'
      + '<button type="button" class="arrow" data-step="1" ' + (at === pages.length - 1 ? 'disabled' : '') + ' aria-label="Next">→</button></div>';
  }

  /* Only whole rows of pictures: what does not fit is left out, rather than cut. */
  function fitMosaic() {
    const m = app && app.querySelector('.pm-mosaic');
    if (!m) return;
    const kids = [...m.children];
    kids.forEach(k => { k.hidden = false; });
    const h = m.clientHeight;
    for (const k of kids) if (k.offsetTop + k.offsetHeight > h + 1) k.hidden = true;
  }

  function draw(keep) {
    if (!app || !data) return;
    const scroller = $('newsScroll');
    const sc = keep && scroller ? scroller.scrollTop : 0;
    const field = document.activeElement && document.activeElement.id === 'newsFind' ? document.activeElement.selectionStart : -1;
    const p = page();
    const body = p === 'overview' ? overviewHtml() : p === 'summary' ? summaryHtml() : tableHtml(p);
    headerDraw();
    app.innerHTML = tabsHtml() + body + navHtml();
    if (fresh) { const c = app.querySelector('.pm-card'); if (c) c.classList.add('is-in'); fresh = false; }
    const s = $('newsScroll');
    if (s && keep) s.scrollTop = sc;
    if (field >= 0) { const f = $('newsFind'); if (f) { f.focus(); f.setSelectionRange(field, field); } }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fitMosaic);
  }
  const go = k => { at = Math.max(0, Math.min(pages.length - 1, k)); why = 'all'; q = ''; sort = null; open = new Set(); pinned = null; fresh = true; draw(false); };
  /* Another update: the same page when it has one, else the overview. */
  const pick = i => {
    const here = page();
    uAt = i; pages = pagesFor(upd()); menuOpen = false; story = 0;
    go(Math.max(0, pages.indexOf(here)));
  };

  /* ---------------- the Index's own card, and the skin to try, in a window of the page ---------------- */
  let trail = [], ask = 0;
  const drawerEl = () => $('newsDrawer');
  const noSkin = () => { const box = $('newsSkin'), body = $('newsDBody'); if (box) box.hidden = true; if (body) body.classList.remove('has-skin'); };
  async function skinFor(target) {
    const box = $('newsSkin'), body = $('newsDBody'), root = $('newsSkinRoot');
    if (!window.SkinViewer || !box || !root) return noSkin();
    box.hidden = false;
    const head = $('newsSkinHead');
    if (head) head.textContent = 'Try it';
    body.classList.add('has-skin');
    try {
      // Only the stage: no list of skins to pick from, no dyes - the one thing asked about, to walk about with and shoot.
      const viewer = await window.SkinViewer.mount(root, { integrated: true, stageOnly: true });
      viewer.setActive(true);
      await viewer.select(target);
    } catch (e) { console.error(e); noSkin(); }
  }
  async function skinTest(html) {
    const door = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-skin-target]');
    if (!door) return noSkin();
    let target = null;
    try { target = JSON.parse(decodeURIComponent(door.dataset.skinTarget)); } catch (e) { return noSkin(); }
    return skinFor(target);
  }
  async function showCard(id) {
    const drawer = drawerEl(), host = $('newsIndexCard');
    if (!drawer || !host) return;
    const mine = ++ask;
    drawer.hidden = false;
    host.innerHTML = '<p class="pm-wait">Loading</p>';
    noSkin();
    let got = null;
    try { got = typeof RealmIndex !== 'undefined' ? await RealmIndex.card(id) : null; } catch (e) { console.error(e); }
    if (mine !== ask) return;
    if (!got) { host.innerHTML = '<p class="pm-wait">Nothing in the Index for this</p>'; return; }
    if (trail[trail.length - 1] !== got.id) trail.push(got.id);
    host.innerHTML = got.html;
    if (got.sheet) host.style.setProperty('--ix-sheet', got.sheet);
    // A set's door to the Skin Viewer tries the skin here instead of leaving the page.
    if (window.SkinViewer) host.querySelectorAll('[data-skin-target]').forEach(x => { x.textContent = 'Try it here'; });
    $('newsDTitle').textContent = got.name;
    $('newsDBack').hidden = trail.length < 2;
    $('newsDBody').scrollTop = 0;
    skinTest(got.html);
  }
  function shutCard() {
    const drawer = drawerEl();
    ask++; trail = [];
    if (drawer) drawer.hidden = true;
    noSkin();
    if (window.SkinViewer) window.SkinViewer.unmount();
  }

  /* ---------------- what the pointer and the keys do ---------------- */
  const POINT = '.pm-mosaic [data-n], .pl-read .pn-tile, .pc-gearrow [data-n]';
  const target = e => { const el = e.target.closest(POINT); return el ? { el, i: byN.get(+el.dataset.n) } : null; };

  function onOver(e) { const t = target(e); if (t && !t.el.contains(e.relatedTarget)) showCap(t.i); }
  function onOut(e) { const t = target(e); if (t && !t.el.contains(e.relatedTarget)) showCap(pinned !== null ? byN.get(pinned) : null); }
  function onInput(e) { if (e.target.id === 'newsFind') { q = e.target.value; draw(true); } }
  function onClick(e) {
    const el = e.target.closest('[data-menu],[data-upd],[data-card],[data-page],[data-at],[data-step],[data-story],[data-why],[data-sort],[data-find],tr.pl-row,' + POINT);
    if (!el) return;
    if (el.dataset.menu !== undefined) { menuOpen = !menuOpen; draw(true); return; }
    if (el.dataset.upd !== undefined) return pick(+el.dataset.upd);
    if (el.dataset.card !== undefined) { const i = byN.get(+el.dataset.card); if (i && i.t.__id) { trail = []; showCard(i.t.__id); } return; }
    if (el.dataset.find !== undefined) {
      const i = byN.get(+el.dataset.find);
      go(pages.indexOf(i.g)); open = new Set([i.n]); draw(false);
      const r = app.querySelector('.pl-row.is-open'); if (r) r.scrollIntoView({ block: 'center' });
      return;
    }
    if (el.matches(POINT)) {
      pinned = pinned === +el.dataset.n ? null : +el.dataset.n;
      app.querySelectorAll(POINT).forEach(x => x.classList.toggle('is-on', +x.dataset.n === pinned));
      const c = $('newsCap'); if (c) { c.classList.toggle('is-pinned', pinned !== null); c.innerHTML = capHtml(pinned !== null ? byN.get(pinned) : byN.get(+el.dataset.n)); }
      return;
    }
    if (el.dataset.at !== undefined) { e.preventDefault(); return go(+el.dataset.at); }
    if (el.dataset.page) return go(pages.indexOf(el.dataset.page));
    if (el.dataset.step) return go(at + +el.dataset.step);
    if (el.dataset.story !== undefined) { story = +el.dataset.story; pinned = null; draw(false); return; }
    if (el.dataset.why) { why = el.dataset.why; draw(false); return; }
    if (el.dataset.sort) {
      const k = el.dataset.sort;
      if (k === 'name') sort = null;
      else sort = sort && sort.col === k ? (sort.dir === 'desc' ? { col: k, dir: 'asc' } : null) : { col: k, dir: 'desc' };
      draw(true); return;
    }
    if (el.matches('tr.pl-row')) { const n = +el.dataset.n; if (open.has(n)) open.delete(n); else open.add(n); draw(true); }
  }
  /* The window of the Index card: a link inside it opens that record in it, a set's skin door tries the skin. */
  function onCard(e) {
    const door = e.target.closest('[data-skin-target]');
    if (door && window.SkinViewer) {
      e.preventDefault();
      try { skinFor(JSON.parse(decodeURIComponent(door.dataset.skinTarget))).then(() => { const box = $('newsSkin'); if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }); } catch (err) { console.error(err); }
      return;
    }
    const to = e.target.closest('[data-open]');
    if (to && to.dataset.open) { e.preventDefault(); showCard(to.dataset.open); }
  }

  /* The elements of the page exist from the start; what listens to them is attached once, after the first drawing. */
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    app.addEventListener('mouseover', onOver);
    app.addEventListener('mouseout', onOut);
    app.addEventListener('input', onInput);
    app.addEventListener('click', onClick);
    const top = $('newsTop');
    if (top) top.addEventListener('click', onClick);
    const host = $('newsIndexCard');
    if (host) {
      host.addEventListener('click', onCard);
      // The set's door to the Skin Viewer arrives a moment after the card does.
      new MutationObserver(() => { if (window.SkinViewer) host.querySelectorAll('[data-skin-target]').forEach(x => { if (x.textContent !== 'Try it here') x.textContent = 'Try it here'; }); })
        .observe(host, { childList: true, subtree: true });
    }
    const close = $('newsDClose'), back = $('newsDBack');
    if (close) close.addEventListener('click', shutCard);
    if (back) back.addEventListener('click', () => { trail.pop(); const id = trail.pop(); if (id) showCard(id); });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => requestAnimationFrame(fitMosaic)).observe(app);
  }

  const onScreen = () => { const p = $('pageNews'); return !!p && !p.hidden; };

  /*
   * Opening and closing, for the whole document and so attached exactly once:
   * a click on anything but the window closes the card, and the keys turn the
   * pages while this is the page you are looking at.
   */
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    document.addEventListener('click', event => {
      if (!data || !onScreen()) return;
      const drawer = drawerEl();
      if (drawer && !drawer.hidden && !event.target.closest('#newsDrawer, [data-card]')) shutCard();
      if (menuOpen && !event.target.closest('.pm-updwrap')) { menuOpen = false; draw(true); }
    }, true);
    document.addEventListener('keydown', event => {
      if (!data || !onScreen()) return;
      const drawer = drawerEl();
      if (event.key === 'Escape') {
        if (drawer && !drawer.hidden) { shutCard(); return; }
        if (menuOpen) { menuOpen = false; draw(true); }
        return;
      }
      const field = document.activeElement && document.activeElement.tagName;
      if (/INPUT|TEXTAREA|SELECT/.test(field || '') || (drawer && !drawer.hidden)) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); go(at + 1); }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); go(at - 1); }
      if (event.key === 'Home') go(0);
      if (event.key === 'End') go(pages.length - 1);
    });
  }

  /* ---------------- starting ---------------- */
  /* The Index's records, when they can be read: the page then knows every thing by what the Index says. */
  async function readIndex() {
    try {
      if (typeof RealmIndex === 'undefined' || !await RealmIndex.start()) return null;
      const d = RealmIndex.data();
      return d && d.all ? { all: d.all, slots: d.slots, sheet: d.sheet, statusSheet: d.statusSheet } : null;
    } catch (error) {
      return null;
    }
  }

  async function show(index, bundledArt) {
    data = index;
    art = bundledArt || null;
    app = $('newsApp');
    ix = await readIndex();
    build();
    groups = GROUPS.filter(([g]) => inGroup(g).length);
    crGear = ['Robotic Ring of the Crucible', 'Shattered Ring of the Crucible', 'Colossal Ring of the Crucible', 'Corrupted Ring of the Crucible'].map(n => thing(n, 'Crucible')).filter(Boolean);
    riGear = ((data.ritual && data.ritual.gear) || []).map(n => thing(n, 'Blood Ritual')).filter(Boolean);
    setUpdates();
    draw(false);
    bind();
  }

  let started = false;
  let startPromise = null;

  function init(bundled) {
    if (started) return Promise.resolve(true);
    if (startPromise) return startPromise;

    wire();

    startPromise = (
      bundled && bundled.index
        ? Promise.resolve().then(() => show(bundled.index, bundled.art))
        : fetch('assets/whats-new/index.json')
          .then(response => response.json())
          .then(index => show(index, null))
    )
      .then(() => {
        started = true;
        return true;
      })
      .catch(error => {
        started = false;
        const box = $('newsApp');
        if (box) box.innerHTML = '<p class="pm-wait">Nothing to show just now.</p>';
        return false;
      })
      .finally(() => {
        if (!started) startPromise = null;
      });

    return startPromise;
  }

  return { init };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WhatsNew;

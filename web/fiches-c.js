/*
 * Proposition C (maquette) — branchée sur la vraie page Index.
 *
 * Chaque fois que l'Index dessine une fiche dans #ixCard, on la relit (ses
 * lignes RealmEye / wiki / liens, déjà résolues par le site) et on la redessine
 * en deux colonnes : l'infobulle du jeu à gauche, le dossier à droite. Les
 * boutons et puces sont ceux du site, donc les clics marchent comme avant.
 * Aucun identifiant client (fichier, adresse) n'est affiché.
 */
(function () {
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Jersey+10&display=swap';
  document.head.appendChild(font);

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* Un seul affichage : la fiche harmonisée. */
  const mode = 'c2';
  /* La fiche attend toutes ses données : aucun second rendu visible quand l'une d'elles arrive. */
  let pending = 5;
  const settled = () => {
    if (--pending > 0) return;
    for (const box of hosts()) box.style.visibility = '';
    redraw();
  };
  let reRecords = null;
  fetch('assets/index/realmeye-enrichment.json').then(r => r.json())
    .then(j => { reRecords = j.records || {}; }).catch(() => { reRecords = {}; }).finally(settled);

  /* Ce que le client déclare et que l'Index ne porte pas encore : forge, feed power, XP, poussière. */
  let clientExtra = {};
  fetch('assets/index/client-forge.json').then(r => r.json())
    .then(j => { clientExtra = j || {}; }).catch(() => {}).finally(settled);
  const index = () => window.ROTMG_SHARED_DATA && window.ROTMG_SHARED_DATA.index;
  function recs() {
    const s = index();
    if (!s) return null;
    if (!s.__fcMap) s.__fcMap = new Map(s.records.map(r => [r.id, r]));
    return s.__fcMap;
  }
  const rec = id => (recs() || new Map()).get(id);

  function art(r, side) {
    const s = index();
    if (!r || !r.art || !s || !s.sheet) return '';
    const [x, y, w, h] = r.art, z = side / Math.max(w, h);
    return '<span class="ix-art" style="display:inline-block;width:' + w * z + 'px;height:' + h * z
      + 'px;background-size:' + s.sheet.wide * z + 'px ' + s.sheet.tall * z + 'px;background-position:'
      + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
  }

  /* ---------- ce que RealmEye sait ---------- */
  const SUMMARY_LABELS = ['Tier Grouped Drops', 'Blueprint', 'Drops From', 'Obtained Through', 'Tier', 'On Equip',
    'Effect(s)', 'MP Cost', 'XP Bonus', 'Soulbound', 'Feed Power', 'Forging Cost', 'Dismantling Value', 'Dust Type',
    'Loot Bag', 'Notes', 'Shots', 'Damage', 'Projectile Speed', 'Lifetime', 'Range', 'Rate of Fire', 'Reskin(s)',
    'Upgrade', 'Reactive Proc', 'Potion', 'Consumed with use', 'Amplitude', 'Frequency', 'Power Level', 'Cooldown'];
  const LABEL_RX = new RegExp('(?:^|\\s)(' + SUMMARY_LABELS.slice().sort((a, b) => b.length - a.length)
    .map(x => x.replace(/[()]/g, '\\$&')).join('|') + ')(?=\\s|$)', 'g');

  /*
   * 1 191 objets sur 3 134 n'ont que le résumé aplati de leur page RealmEye,
   * sans champs. On relit ce résumé pour les quelques champs sûrs ; dans le
   * vrai site, cela appartient au générateur, pas à la page.
   */
  function parseSummary(text, about) {
    let body = String(text || '');
    if (about && body.startsWith(about)) body = body.slice(about.length);
    const hits = [...body.matchAll(LABEL_RX)];
    if (hits.length < 2) return { prose: body.trim(), fields: {} };
    const fields = {};
    let blueprint = false;
    hits.forEach((m, i) => {
      const label = m[1];
      const from = m.index + m[0].length;
      const to = label === 'Notes' ? body.length : (hits[i + 1] ? hits[i + 1].index : body.length);
      const value = body.slice(from, to).trim();
      if (label === 'Blueprint') { blueprint = true; return; }
      const key = (blueprint && /Drops From|Obtained Through/.test(label) ? 'Blueprint ' : '') + label;
      if (!(key in fields)) fields[key] = value;
    });
    return { prose: '', fields };
  }

  function communityOf(r) {
    const data = (reRecords || {})[r.id] || null;
    const out = { facts: {}, notes: '', prose: [], variants: '' };
    if (!data) return out;
    const f = data.facts || {};
    const pick = (k, ...names) => { for (const n of names) if (f[n]) { out.facts[k] = f[n]; return; } };
    pick('power', 'power_level'); pick('xp', 'xp_bonus', 'total_xp_bonus'); pick('feed', 'feed_power');
    pick('dismantle', 'dismantling_value'); pick('forge', 'forging_cost'); pick('dust', 'dust_type');
    pick('bag', 'loot_bag'); pick('effect', 'effect_s'); pick('got', 'obtained_through');
    const summary = (data.presentation && data.presentation.summary) || '';
    const parsed = parseSummary(summary, r.about);
    const F = parsed.fields;
    const ok = (k, v, rx) => { if (!out.facts[k] && v && rx.test(v)) out.facts[k] = v; };
    ok('xp', F['XP Bonus'], /^\d+%$/);
    ok('feed', F['Feed Power'], /^[\d,]+$/);
    ok('dismantle', F['Dismantling Value'], /^[\d\s/]+$/);
    ok('forge', F['Forging Cost'], /^[\w\s/()]+$/);
    ok('power', F['Power Level'], /^\d+$/);
    if (F['Notes']) out.notes = F['Notes'].replace(/^TBA\s+/, '');
    out.variants = [F['Reskin(s)'] && 'Reskin: ' + F['Reskin(s)'], F['Upgrade'] && 'Upgrade: ' + F['Upgrade']]
      .filter(Boolean).join(' · ');
    /* De la prose seulement si c'en est : une table des matières n'en est pas. */
    if (parsed.prose && /[a-z]\.(\s|$)/.test(parsed.prose)) out.prose.push(parsed.prose);
    return out;
  }

  /* ---------- relire la fiche que le site vient de dessiner ---------- */
  function readCard(box) {
    const t = k => (window.RealmI18n ? RealmI18n.t(k) : k);
    const titles = {
      details: t('index.section.details'), links: t('index.section.links'), facts: t('index.section.facts'),
      description: t('index.section.description'), does: t('index.section.whatItDoes'),
      declarations: t('index.section.clientDeclarations')
    };
    const out = { rows: { details: [], links: [], facts: [] }, labels: [], dlDetails: [], others: [], prose: [] };
    const head = box.querySelector('.ix-card-head');
    out.cell = head && head.querySelector('.ix-cell') ? head.querySelector('.ix-cell').outerHTML : '';
    out.away = head && head.querySelector('.ix-away') ? head.querySelector('.ix-away').outerHTML : '';
    out.love = head && head.querySelector('.ix-love') ? head.querySelector('.ix-love').outerHTML : '';
    out.id = head && head.querySelector('[data-love]') ? head.querySelector('[data-love]').dataset.love : '';
    out.doors = box.querySelector('.ix-doors') ? box.querySelector('.ix-doors').outerHTML : '';
    out.kindHtml = head && head.querySelector('.ix-kind') ? head.querySelector('.ix-kind').outerHTML : '';
    out.name = head && head.querySelector('h3') ? head.querySelector('h3').textContent.trim() : '';
    out.guardian = head && head.querySelector('.ix-place-guardian') ? head.querySelector('.ix-place-guardian').outerHTML : '';
    out.factRows = [];
    out.warns = [...box.querySelectorAll(':scope > .ix-warn')].map(x => x.outerHTML).join('');
    const diff = box.querySelector('.ix-dungeon-difficulty');
    out.difficulty = diff ? Number((/(\d+)\s*\/\s*10/.exec(diff.textContent) || [])[1]) || 0 : 0;
    box.querySelectorAll(':scope > .ix-said-block').forEach(x => out.others.push(x.outerHTML));
    box.querySelectorAll(':scope > .ix-block').forEach(block => {
      const sum = block.querySelector('summary');
      const title = sum ? sum.childNodes[0].textContent.trim() : '';
      const rows = [...block.querySelectorAll('.ix-link-row')].map(row => ({
        label: row.querySelector('i').textContent.trim(),
        html: row.querySelector('span').innerHTML
      }));
      if (title === titles.details) {
        out.rows.details = rows;
        out.dlDetails = [...block.querySelectorAll('dl.ix-facts > div')].map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
        out.tables = [...block.querySelectorAll('.ix-realm-table')].map(x => x.outerHTML).join('');
      } else if (title === titles.links) out.rows.links = rows;
      else if (title === titles.facts) {
        out.labels = rows.filter(r => /label/i.test(r.label)).map(r => r.html);
        out.factRows = [...block.querySelectorAll('dl.ix-facts > div')].map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
      }
      else if (title === titles.description) out.prose = [...block.querySelectorAll('.ix-prose p')].map(p => p.textContent);
      else if (title === titles.does || title === titles.declarations) { /* redit par l'infobulle / les variantes */ }
      else out.others.push(block.outerHTML);
    });
    return out;
  }

  /* ---------- l'infobulle ---------- */
  const STAT_ORDER = ['MAXHP', 'MAXMP', 'ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS'];
  const STAT_NAME = { MAXHP: 'Max HP', MAXMP: 'Max MP', ATT: 'Attack', DEF: 'Defense', SPD: 'Speed', DEX: 'Dexterity', VIT: 'Vitality', WIS: 'Wisdom' };
  const CLASS_STAT = [['hp', 'Max HP'], ['mp', 'Max MP'], ['att', 'Attack'], ['def', 'Defense'], ['spd', 'Speed'], ['dex', 'Dexterity'], ['vit', 'Vitality'], ['wis', 'Wisdom']];
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const RE = what => '<sup class="re" title="' + esc(what) + ' — RealmEye, not the client">RE</sup>';
  const slotName = r => {
    const s = index();
    return r.slot !== undefined && s && s.slots && s.slots[r.slot] ? s.slots[r.slot][0] : (r.hand || '');
  };

  function tierOf(r) {
    const L = r.labels || [];
    if (r.use || r.kind !== 'item') return { b: '', cls: 't', color: '#ffffff' };
    if (L.includes('ST')) return { b: 'ST', cls: 'st', color: '#ff9a1f' };
    if (L.includes('UT')) return { b: 'UT', cls: 'ut', color: '#a13bff' };
    if (r.tier !== undefined) return { b: 'T' + r.tier, cls: 't', color: '#ffffff' };
    return { b: '', cls: 't', color: '#ffffff' };
  }
  const isDivine = r => (r.does || []).some(s => /always Divine/i.test(s[0]));
  function kindLine(r) {
    if (isDivine(r)) return ['Divine', '#ffd026'];
    const L = r.labels || [];
    if (r.kind === 'item') return [r.use ? 'Consumable' : slotName(r), '#9a9a9a'];
    if (r.kind === 'enemy') return [[L.includes('GOD') && 'God', L.includes('BOSS') ? 'Boss' : L.includes('MINIBOSS') ? 'Miniboss' : 'Enemy', L.includes('QUEST') && 'Quest'].filter(Boolean).join(' · '), '#ff6b5a'];
    if (r.kind === 'portal') return ['Dungeon', '#9a9a9a'];
    if (r.kind === 'class') return ['Class', '#9a9a9a'];
    if (r.kind === 'skin') return ['Skin', '#9a9a9a'];
    if (r.kind === 'set') return ['Set', '#ff9a1f'];
    if (r.kind === 'enchant') return ['Enchantment', '#ca7aff'];
    return [r.family || r.kind, '#9a9a9a'];
  }
  function rowByLabel(rows, rx) { return rows.find(x => rx.test(x.label)); }
  const namesIn = html => [...new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').querySelectorAll('.ix-jump, .ix-data-chip')].map(x => x.textContent.trim());

  function tooltip(r, card, com) {
    const t = tierOf(r), [kind, kindColor] = kindLine(r);
    const nameColor = isDivine(r) ? '#ffd026' : t.color;
    const sep = t.cls === 'ut' ? '#5a2f7a' : t.cls === 'st' ? '#7a4a24' : '#6b5a2a';
    let h = '<div class="fc-tt k-' + t.cls + '" style="--sep:' + sep + '">';
    h += '<div class="h"><div class="ic">' + (card.cell || art(r, 48)) + '</div><div>'
      + '<div class="rar" style="color:' + kindColor + '">' + esc(kind) + '</div>'
      + '<div class="nm" style="color:' + nameColor + '">' + esc(r.said || r.name) + '</div>'
      + (com.facts.power ? '<div style="color:' + nameColor + '">Power Level: ' + esc(com.facts.power) + RE('Power Level') + '</div>' : '')
      + '</div><div class="tb" style="color:' + t.color + '">' + esc(t.b)
      + (r.set && r.kind === 'item' ? '<small>' + esc(r.set) + '</small>' : '') + '</div></div>';

    const holds = rowByLabel(card.rows.links, /may hold/i);
    if (r.kind === 'item' && holds && !r.use) {
      const names = namesIn(holds.html);
      const allClasses = [...recs().values()].filter(x => x.kind === 'class').length;
      if (names.length && names.length < allClasses) h += '<div class="cls">' + esc(names.join(', ')) + '</div>';
    }
    if (r.kind === 'skin') {
      const by = rowByLabel(card.rows.links, /worn by/i);
      if (by) h += '<div class="cls">' + esc(namesIn(by.html).join(', ')) + '</div>';
    }

    let top = '<div class="b">', mid = '';
    const s = (r.fires || [])[0];
    if (s) {
      top += '<div class="lab">Damage</div><div class="big">' + s.low + (s.high !== s.low ? '–' + s.high : '') + '</div>';
    }
    if (r.kind === 'enemy') {
      top += '<div class="lab">Health</div><div class="big">' + Number(r.hp || 0).toLocaleString('en-US') + '</div>'
        + '<div class="ln">Defense: <span class="v">' + (r.def || 0) + '</span></div>';
    }
    if (r.kind === 'portal' && card.difficulty) {
      top += '<div class="lab">Difficulty' + RE('Difficulty') + '</div><div class="pips">'
        + Array.from({ length: 10 }, (_, i) => '<i class="' + (i < card.difficulty ? 'on' : '') + '"></i>').join('') + '</div>'
        + '<div class="ln"><span class="v">' + card.difficulty + ' / 10</span></div>';
    }
    if (r.sb) top += '<div class="sb">Soulbound</div>';
    if (r.about) top += '<p class="desc">' + esc(r.about.replace(/\\n\\n[\s\S]*$/, '').replace(/\n\n[\s\S]*$/, '')) + '</p>';

    for (const said of r.does || []) {
      if (said.length === 1) mid += '<div class="ln gold">' + esc(said[0]) + '</div>';
      else mid += '<div class="ln">' + esc(said[0]) + ': <span class="v">' + esc(said[1]) + '</span></div>';
    }
    for (const x of r.share || []) {
      mid += '<div class="ln">Bonus <span class="v">' + STAT_NAME[x.stat] + '</span>: Equal to <span class="v">'
        + signed(x.pct) + '%</span> of <span class="v">' + STAT_NAME[x.of] + '</span> Stat.</div>';
    }
    if (r.mp) mid += '<div class="ln">MP Cost: <span class="v">' + r.mp + '</span></div>';
    /* L'effet écrit par RealmEye, moins ce que le client dit déjà ligne par ligne. */
    const reEffect = String(com.facts.effect || '')
      .replace(/Shots hit multiple targets|Shots pass through obstacles|Ignores defense of target/g, '')
      .replace(new RegExp((r.conditions || []).filter(c => c.on === 'hit').map(c => c.effect + ' for ' + c.duration + ' seconds?').join('|') || '$^', 'g'), '')
      .replace(/\s+/g, ' ').trim();
    if (!(r.does || []).length && reEffect && !(r.use && r.about && r.about.includes(reEffect.replace(/^\+/, ''))))
      mid += '<div class="ln">Effect: <span class="v">' + esc(reEffect) + '</span>' + RE('Effect') + '</div>';
    for (const c of r.conditions || []) {
      if (c.on === 'hit') mid += '<div class="ln">Shot effect: <span class="v">' + esc(c.effect) + ' for ' + esc(c.duration) + ' seconds</span></div>';
    }
    if (s) {
      if (s.reach !== undefined) mid += '<div class="ln">Range: <span class="v">' + s.reach + '</span></div>';
      const many = r.shots || s.many || 1;
      if (many > 1) mid += '<div class="ln">Shots: <span class="v">' + many + '</span></div>';
      if (s.through) mid += '<div class="ln flag">Shots hit multiple targets</div>';
      if (s.pierce) mid += '<div class="ln flag">Ignores defense of target</div>';
      const rate = r.rate !== undefined ? r.rate : s.rate;
      if (rate !== undefined) mid += '<div class="ln">Rate of Fire: <span class="v">' + Math.round(rate * 100) + '%</span></div>';
    }
    if (r.kind === 'skin' && r.level) mid += '<div class="ln">Unlocks at level: <span class="v">' + r.level + '</span></div>';
    if (r.kind === 'portal') {
      const bosses = rowByLabel(card.rows.details, /^bosses$/i), minis = rowByLabel(card.rows.details, /minibosses/i);
      if (bosses) mid += '<div class="ln">Boss: <span class="v">' + esc(namesIn(bosses.html).join(', ')) + '</span>' + RE('Boss') + '</div>';
      if (minis) mid += '<div class="ln">Minibosses: <span class="v">' + esc(namesIn(minis.html).join(', ')) + '</span>' + RE('Minibosses') + '</div>';
    }
    if (com.facts.xp) mid += '<div class="ln">XP Bonus: <span class="v">' + esc(com.facts.xp) + '</span>' + RE('XP Bonus') + '</div>';

    const w = r.worn || {};
    const worn = STAT_ORDER.filter(k => w[k] !== undefined);
    if (worn.length && r.kind === 'item') {
      mid += '<div class="oe">On Equip:</div><div class="grid">' + worn.map(k =>
        '<span class="' + (w[k] < 0 ? 'neg' : '') + '">' + signed(w[k]) + ' ' + STAT_NAME[k] + '</span>').join('') + '</div>';
    }
    if (r.kind === 'class' && r.stats) {
      mid += '<div class="oe">Base → Max:</div><div class="grid two">' + CLASS_STAT.map(([k, n]) =>
        '<span>' + n + ' <span class="dim">' + r.stats[k] + ' →</span> ' + r.stats[k + 'Top'] + '</span>').join('') + '</div>';
    }
    h += top + (mid ? '<hr>' + mid : '');

    const set = r.set ? rec('set:' + r.set) : null;
    if (set && set.steps && Object.keys(set.steps).length) {
      h += '<hr><div class="set"><h5>' + esc(set.name) + '</h5><div class="cols">' + Object.keys(set.steps).map(n =>
        '<div><i>' + (n === '4' ? 'Full Set' : n + ' Pieces') + '</i>' + STAT_ORDER.filter(k => set.steps[n][k] !== undefined)
          .map(k => '<div>' + signed(set.steps[n][k]) + ' ' + STAT_NAME[k] + '</div>').join('') + '</div>').join('') + '</div></div>';
    }
    h += '</div>';
    const foot = [];
    if (com.facts.feed) foot.push('<span>Feed Power: ' + esc(com.facts.feed) + RE('Feed Power') + '</span>');
    if (com.facts.dismantle) foot.push('<small>Dismantle ' + esc(com.facts.dismantle) + RE('Dismantle') + '</small>');
    if (foot.length) h += '<div class="f">' + foot.join('') + '</div>';
    return h + '</div>';
  }

  /* Le butin d'un ennemi ou d'un donjon, rangé comme un sac du jeu. */
  function lootBag(card, used) {
    const rows = card.rows.details.filter(x => /dropping|drops of interest/i.test(x.label));
    if (!rows.length) return '';
    rows.forEach(x => used.add(x));
    const seen = new Set(), cells = [];
    for (const x of rows) {
      const doc = new DOMParser().parseFromString('<div>' + x.html + '</div>', 'text/html');
      doc.querySelectorAll('[data-open]').forEach(b => {
        if (seen.has(b.dataset.open)) return;
        seen.add(b.dataset.open);
        const pic = b.querySelector('.ix-art, img');
        const name = b.textContent.trim();
        cells.push('<button type="button" class="fc-slot" data-open="' + esc(b.dataset.open) + '" title="' + esc(name) + '">'
          + (pic ? pic.outerHTML : esc(name.slice(0, 2))) + '</button>');
      });
    }
    return cells.length ? '<div class="fc-bag"><div class="fc-bag-h">Loot<sup class="re" title="Loot listed by RealmEye">RE</sup><span>' + cells.length + '</span></div>'
      + '<div class="fc-bag-grid">' + cells.join('') + '</div></div>' : '';
  }

  /* ---------- le dossier ---------- */
  function dos(title, body, src) {
    return body ? '<section class="fc-dos"><h4><span>' + esc(title) + '</span>'
      + (src ? '<span class="fc-src' + (src === 'RealmEye' ? ' re' : '') + '">' + esc(src) + '</span>' : '') + '</h4>' + body + '</section>' : '';
  }
  const kvRows = rows => rows.length ? '<dl class="fc-kv">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>' : '';

  function dossier(r, card, com) {
    let out = '';
    const used = card.__used || new Set();
    const take = (rows, rx) => rows.filter(x => rx.test(x.label) && !used.has(x) && used.add(x));

    /* Où l'obtenir : les lignes RealmEye/wiki déjà résolues par le site, puis les champs sans lien. */
    const getRows = take(card.rows.details, /dropped by|obtained through|drop locations|blueprint|found in|sold|shop/i)
      .map(x => [x.label, x.html]);
    const bag = com.facts.bag ? com.facts.bag.replace(/^Assigned to /, '') : '';
    const plain = [['Loot bag', esc(bag)], ['Dust', esc(com.facts.dust)], ['Forge', esc(com.facts.forge)]].filter(x => x[1]);
    out += dos(r.kind === 'enemy' ? 'Where to find it' : r.kind === 'portal' ? 'Access' : 'Where to get it',
      kvRows(getRows.concat(plain)), 'RealmEye');

    if (r.kind === 'enemy' || r.kind === 'portal') {
      const loot = take(card.rows.details, /dropping|drops of interest|tier drops|loot/i).map(x => [x.label, x.html]);
      out += dos(r.kind === 'enemy' ? 'Drops' : 'Loot', kvRows(loot), 'RealmEye');
      const who = take(card.rows.details, /enemies|bosses|minibosses/i).map(x => [x.label, x.html]);
      out += dos('Inhabitants', kvRows(who), 'RealmEye');
    }

    /* Qui peut s'en servir : toutes les classes, celles qui ne peuvent pas en gris. */
    const holds = rowByLabel(card.rows.links, /may hold/i);
    if (r.kind === 'item' && !r.use && r.slot !== undefined && holds) {
      used.add(holds);
      const names = new Set(namesIn(holds.html));
      const classes = [...recs().values()].filter(x => x.kind === 'class');
      out += dos('Usable by · ' + names.size + '/' + classes.length, '<div class="fc-classes">' + classes.map(c =>
        '<button type="button" title="' + esc(c.name) + '" class="fc-cl' + (names.has(c.name) ? '" data-open="' + esc(c.id) + '"' : ' off" disabled') + '>'
        + art(c, 16) + esc(c.name) + '</button>').join('') + '</div>', 'client');
    }

    /* L'enchantement, sans supposer qu'il y en a un sur l'objet. */
    if (r.kind === 'item' && !r.use && r.slot !== undefined) {
      const wakes = take(card.rows.links, /^wakes$/i)[0];
      const pool = take(card.rows.links, /rolls from/i)[0];
      let body = '<div class="fc-ench"><div class="st">' + (r.ench
        ? '<span class="fc-pill ok">Enchantable</span><span class="fc-pill">4 slots</span>'
        : '<span class="fc-pill no">Not enchantable</span>') + '</div>';
      if (pool) body += kvRows([['Rolls from', pool.html]]);
      if (wakes) body += kvRows([['Can awaken', wakes.html]]);
      body += '</div>';
      out += dos('Enchantment', body, 'client');
    }

    /* Les autres formes sous le même nom, et ce que RealmEye en dit. */
    const same = take(card.rows.links, /same name/i)[0];
    const varRows = [];
    const many = same ? namesIn(same.html).length : 0;
    if (same) varRows.push(['Variants', many > 4 ? '<details><summary style="text-transform:none;letter-spacing:0;font-weight:400">'
      + many + ' declarations under this name</summary>' + same.html + '</details>' : same.html]);
    if (com.variants) varRows.push(['RealmEye', esc(com.variants)]);
    out += dos('Variants', kvRows(varRows), same ? 'client' : 'RealmEye');

    /* Ce que la communauté écrit en toutes lettres. */
    const prose = [];
    if (com.notes) prose.push('<p class="fc-prose">' + esc(com.notes) + '</p>');
    for (const p of com.prose) prose.push('<p class="fc-prose">' + esc(p) + '</p>');
    out += dos(com.notes ? 'Notes' : 'According to RealmEye', prose.join(''), 'RealmEye');

    const dl = card.dlDetails.filter(([k]) => !/drops from|obtained through|feed power|dust|loot bag|on equip|power level|tier$|xp bonus|soulbound|forging|dismantl|effect|damage|range|shots|mp cost|reactive|^set$|lifetime|projectile|amplitude|frequency|potion|technical/i.test(k));
    if (dl.length || card.tables) out += dos('Other data', kvRows(dl.map(([k, v]) => [k, esc(v)])) + (card.tables || ''), 'RealmEye');

    const rest = card.rows.details.filter(x => !used.has(x)).map(x => [x.label, x.html])
      .concat(card.rows.links.filter(x => !used.has(x)).map(x => [x.label, x.html]));
    out += dos('Links', kvRows(rest));
    out += card.others.map(x => '<div class="fc-legacy">' + x + '</div>').join('');
    if (card.labels.length) out += '<section class="fc-dos"><details><summary>Tags</summary><div class="fc-labels">'
      + card.labels.join('') + '</div></details></section>';
    return out;
  }


  /* =====================================================================
     C harmonisée : l'ordre de l'infobulle du jeu, les composants de l'Index.
     Chaque bloc est un .ix-block / .ix-part comme partout ailleurs sur la
     fiche ; les valeurs RealmEye sont rangées ensemble plutôt que marquées
     une par une ; rien n'est dit deux fois.
     ===================================================================== */
  const part = (title, body, opts = {}) => body
    ? '<details class="ix-part' + (opts.cls ? ' ' + opts.cls : '') + '"' + (opts.closed ? '' : ' open') + '><summary>' + esc(title)
      + (opts.tag ? ' <span class="fc2-tag">' + esc(opts.tag) + '</span>' : '') + '</summary>' + body + '</details>'
    : '';
  const blockOf = (parts, cls, style) => {
    const body = parts.filter(Boolean).join('');
    return body ? '<div class="ix-block' + (cls ? ' ' + cls : '') + '"' + (style ? ' style="' + style + '"' : '') + '>' + body + '</div>' : '';
  };
  const factsDl = rows => rows.length ? '<dl class="ix-facts">' + rows.map(([k, v]) =>
    '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>' : '';
  const linkRows = rows => rows.length ? '<div class="ix-links">' + rows.map(([k, v]) =>
    '<div class="ix-link-row"><i>' + esc(k) + '</i><span>' + v + '</span></div>').join('') + '</div>' : '';
  const chip = (text, cls) => '<span class="ix-data-chip' + (cls ? ' ' + cls : '') + '">' + text + '</span>';
  const TINT = { MAXHP: '#58cfda', MAXMP: '#f4d24c', ATT: '#ca46dd', DEF: '#8b9cb3',
    SPD: '#58da6e', DEX: '#ff5f2a', VIT: '#dd0c32', WIS: '#4b9be7' };
  /* Les icônes d'interface de la Forge, prises dans le GUI Atlas du client. */
  const UI = { common: 0, rare: 1, legendary: 2, mythical: 3, redDust: 4, purpleDust: 5, greenDust: 6, forgefire: 7 };
  const uiIcon = (key, say) => '<span class="fc2-ui" style="--i:' + UI[key] + '" role="img" aria-label="' + esc(say) + '"></span>';
  const STAT_SHORT_FR = { MAXHP: 'HP', MAXMP: 'MP', ATT: 'ATT', DEF: 'DEF', SPD: 'SPD', DEX: 'DEX', VIT: 'VIT', WIS: 'WIS' };

  function tierColor(r) {
    const t = tierOf(r);
    if (isDivine(r)) return 'var(--divine)';
    return t.cls === 'ut' ? 'var(--legendary)' : t.cls === 'st' ? '#ffa53a' : 'var(--title)';
  }

  function ecoForge(r, com) {
    /* L'économie de l'objet, telle que le client la déclare. */
    const cx = clientExtra[r.clientId || r.name] || {};
    const f = com.facts;
    const eco = [];
    /* Le bonus d'XP va avec les stats équipées quand il y en a ; sinon il rejoint l'économie plutôt que d'occuper un bloc seul. */
    if ((!isGear(r) || !Object.keys(r.worn || {}).length) && cx.xp !== undefined) eco.push(['XP bonus', cx.xp + ' %']);
    if (cx.feed !== undefined) eco.push(['Feed power', cx.feed.toLocaleString('en-US')]);
    if (cx.bag !== undefined && cx.bag >= 0 && cx.bag <= 9) eco.push(['Loot bag',
      '<span class="fc2-bag" style="--i:' + cx.bag + '" role="img" aria-label="Loot bag ' + cx.bag + '" title="Loot Bag ' + cx.bag + '"></span>']);
    const community = part('Economy', factsDl(eco));

    /* La Forge : ce que l'objet rend quand on le démonte, ce qu'il coûte à fabriquer. */
    const fg = cx.forge;
    let forgePart = '';
    if (fg) {
      const MAT = [['common', 'Common', 0], ['rare', 'Rare', 1], ['legendary', 'Legendary', 2], ['mythical', 'Mythical', 3]];
      const mats = (bag, fire) => {
        const out = MAT.filter(([k]) => bag[k]).map(([k, say, i]) => '<span class="ix-data-chip fc2-matchip" title="' + say + ' material">'
          + uiIcon(k, say) + '<b>' + bag[k].toLocaleString('en-US') + '</b></span>');
        if (fire) out.push('<span class="ix-data-chip fc2-matchip" title="Forgefire">' + uiIcon('forgefire', 'Forgefire')
          + '<b>' + fire.toLocaleString('en-US') + '</b></span>');
        return out.join('');
      };
      const rows = [];
      if (fg.canDismantle) {
        const back = mats(fg.dismantle, fg.forgefireBack);
        rows.push(['Dismantling gives', back || chip('nothing')]);
      }
      if (fg.canCraft) {
        const cost = [mats(fg.craft, fg.forgefire)];
        /* Le blueprint que le client déclare pour ce gear, avec son sprite. */
        if (fg.blueprint) {
          const prints = (cx.blueprints || []).map(id => byClient(id)).filter(Boolean);
          cost.push(prints.length ? prints.map(bp => '<button type="button" class="ix-jump" data-open="' + esc(bp.id) + '">'
            + art(bp, 14) + esc(bp.said || bp.name) + '</button>').join('') : chip('Blueprint required'));
        }
        for (const n of fg.needs) {
          /* « Agents of Oryx Shard x15 » est une pile : on dit 15 éclats, et on montre l'éclat. */
          const stack = /^(.*) x(\d+)$/.exec(n.id || '');
          const many = n.quantity * (stack ? Number(stack[2]) : 1);
          const target = [...recs().values()].find(x => x.clientId === n.id || x.name === n.id)
            || (stack && [...recs().values()].find(x => x.name === stack[1] && !x.twin));
          cost.push(target
            ? '<button type="button" class="ix-jump" data-open="' + esc(target.id) + '">' + art(target, 14) + ' ' + many + ' × ' + esc(stack ? stack[1] : (target.said || target.name)) + '</button>'
            : chip(many + ' × ' + esc(stack ? stack[1] : (n.id || n.type))));
        }
        rows.push(['Forging costs', cost.join('')]);
        for (const x of fg.sacrifice) {
          /* Ce que la Forge accepte : le label demandé, aucun label caché, et un objet que le client dit démontable. */
          const pool = [...recs().values()].filter(o => isGear(o) && !o.twin && !o.folded
            && (o.labels || []).includes(x.label) && !(fg.hide || []).some(h => (o.labels || []).includes(h))
            && ((clientExtra[o.clientId || o.name] || {}).forge || {}).canDismantle);
          const shown = pool.slice(0, 8).map(o => '<button type="button" class="ix-jump" data-open="' + esc(o.id) + '" title="' + esc(o.said || o.name) + '">'
            + art(o, 14) + esc(o.said || o.name) + '</button>').join('');
          /* La famille se reconnaît à son icône : c'est celle que portent tous les objets qu'on peut sacrifier. */
          const fams = new Set(pool.map(o => (clientExtra[o.clientId || o.name] || {}).family).filter(v => v !== undefined));
          const fam = fams.size === 1 ? [...fams][0] : undefined;
          rows.push([fam !== undefined ? 'Sacrificing ' + x.amount + ' items of the family' : 'Sacrificing ' + x.amount + ' of',
            (fam !== undefined ? famIcon(fam, 'fc2-fam-inline') : '') + shown + (pool.length > 8 ? '<em>and ' + (pool.length - 8) + ' more</em>' : '')]);
        }
      } else rows.push(['Crafting', chip('Cannot be forged')]);
      forgePart = linkRows(rows);
    }

    /* Un bloc, pas deux : ce que l'objet vaut, et ce que la Forge en fait. */
    return [part(forgePart ? 'Economy & forge' : 'Economy', factsDl(eco) + forgePart, { cls: 'fc2-forge' }), ''];
  }


  /* ---------- aides communes ---------- */
  let clientMap = null;
  const byClient = id => {
    if (!clientMap) { clientMap = new Map(); for (const x of recs().values()) if (x.clientId && !clientMap.has(x.clientId)) clientMap.set(x.clientId, x); }
    return clientMap.get(id);
  };
  let famSheet = null;
  fetch('assets/index/collection-icons.json').then(r => r.json()).then(j => { famSheet = j; }).catch(() => {}).finally(settled);
  /* L'icône de famille du client (CollectionIcon_N), la même que dans l'infobulle du jeu. */
  function famIcon(n, cls) {
    if (n === undefined || !famSheet || !famSheet.have.includes(n)) return '';
    const z = 24 / famSheet.size;
    return '<span class="fc2-fam' + (cls ? ' ' + cls : '') + '" role="img" aria-label="Family ' + n + '" title="Item family ' + n
      + ': items of this family can be sacrificed to forge another item of the same family" style="background-size:' + famSheet.wide * z + 'px ' + famSheet.tall * z
      + 'px;background-position:' + (-(n % famSheet.cols) * 24) + 'px ' + (-Math.floor(n / famSheet.cols) * 24) + 'px"></span>';
  }
  const marks = (r, tier) => {
    const fam = famIcon((clientExtra[r.clientId || r.name] || {}).family);
    /* Not yet in the game, by RealmEye's list: the tools leave it out, the card says so up front. */
    const out = r.availability === 'unreleased'
      ? '<span class="fc2-unreleased" title="Listed by RealmEye as unreleased: not yet obtainable, so no tool offers it">Unreleased</span>' : '';
    return tier || fam || out ? '<div class="fc2-marks">' + tier + out + fam + '</div>' : '';
  };
  const CLASS_TINT = { hp: 'MAXHP', mp: 'MAXMP', att: 'ATT', def: 'DEF', spd: 'SPD', dex: 'DEX', vit: 'VIT', wis: 'WIS' };
  const tintChip = (key, text) => '<span class="ix-data-chip fc2-stat" style="--tint:' + TINT[key] + '">' + text + '</span>';

  /* ---------- la fiche de gauche pour tout ce qui n'est pas du gear ---------- */
  function sheetAny(r, card, com) {
    const kindTag = card.kindHtml || '<span class="ix-kind">' + esc(r.kind) + '</span>';
    const L = r.labels || [];
    let sub = '';
    if (r.kind === 'enemy') sub = [L.includes('GOD') && 'God', L.includes('BOSS') ? 'Boss' : L.includes('MINIBOSS') ? 'Miniboss' : '', L.includes('QUEST') && 'Quest']
      .filter(Boolean).join(' · ');
    if (r.kind === 'skin') {
      const by = rowByLabel(card.rows.links, /worn by/i);
      sub = by ? namesIn(by.html).join(', ') : '';
    }
    if (r.kind === 'item' && r.sb) sub = 'Soulbound';
    const head = '<div class="ix-part fc2-head">' + (card.cell || art(r, 44))
      + '<div class="fc2-name">' + kindTag + '<h3>' + esc(card.name || r.said || r.name) + '</h3>'
      + (sub ? '<div class="fc2-sub">' + esc(sub) + '</div>' : '') + card.guardian + '</div>'
      + marks(r, r.tier !== undefined && r.kind === 'item' && !r.use ? '<b class="fc2-tier">T' + r.tier + '</b>' : '') + '</div>';
    const parts = [head];

    if (r.kind === 'enemy' && r.hp) {
      const tags = ['BOSS', 'MINIBOSS', 'GOD', 'QUEST', 'UNDEAD', 'STASISIMMUNE'].filter(x => L.includes(x)).map(x => chip(esc(x.toLowerCase()))).join('');
      parts.push(part('Combat', '<div class="fc2-dmg">' + Number(r.hp).toLocaleString('en-US') + '<small>HP</small></div>'
        + factsDl([['Defense', String(r.def || 0)]]) + (tags ? '<div class="fc2-chips">' + tags + '</div>' : '')));
    }
    if (r.kind === 'portal' && card.difficulty) {
      parts.push(part('Difficulty', '<div class="fc2-dmg">' + card.difficulty + '<small>/ 10</small></div><div class="fc2-pips">'
        + Array.from({ length: 10 }, (_, i) => '<i class="' + (i < card.difficulty ? 'on' : '') + '"></i>').join('') + '</div>', { tag: 'RealmEye' }));
    }
    if (r.kind === 'class' && r.stats) {
      parts.push(part('Stats · base → max', '<div class="fc2-chips fc2-stats">' + Object.keys(CLASS_TINT).filter(k => r.stats[k] !== undefined)
        .map(k => tintChip(CLASS_TINT[k], '<span class="dim">' + r.stats[k] + ' →</span> <b>' + r.stats[k + 'Top'] + '</b> ' + STAT_NAME[CLASS_TINT[k]])).join('') + '</div>'));
      parts.push(classCompare(r));
    }
    if (r.kind === 'skin') parts.push(part('Preview', '<div class="fc2-setskin"><span class="fc2-bigart">' + skinCanvas(r.id) + '</span></div>'));
    if (r.kind === 'skin' && (r.level || r.tier !== undefined)) {
      parts.push(part('Unlock', factsDl([r.level && ['Level', String(r.level)], r.tier !== undefined && ['Tier', 'T' + r.tier]].filter(Boolean))));
    }
    if (r.kind === 'enchant') {
      const rows = [];
      if (r.weight !== undefined) rows.push(['Roll weight', r.weight.toLocaleString('en-US')]);
      const fits = (r.fits || '').split(',').filter(Boolean).map(x => chip(esc(x))).join('');
      const never = (r.refuses || '').split(',').filter(Boolean).map(x => chip(esc(x), 'fc2-no')).join('');
      parts.push(part('Effect', (r.about ? '<ul class="ix-does"><li>' + esc(r.about) + '</li></ul>' : '') + factsDl(rows)
        + (fits ? linkRows([['Goes on', fits]]) : '') + (never ? linkRows([['Never on', never]]) : '')));
    }
    if (r.kind === 'set') {
      parts.push(part('Full set skin', setSkin(r, true)));
      parts.push(part('Set bonus', setTable(r)));
      parts.push(part('Pieces', setPieces(r, null, false)));
    }
    const about = r.kind !== 'enchant' && r.about ? r.about.replace(/\\n\\n[\s\S]*$/, '').replace(/\n\n[\s\S]*$/, '') : '';
    const prose = [about].concat(r.kind === 'item' ? [] : com.prose).filter(Boolean);
    if (prose.length) parts.push('<div class="ix-part"><div class="ix-prose">' + prose.map(x => '<p>' + esc(x) + '</p>').join('') + '</div></div>');

    if (r.kind === 'item') {
      const items = [];
      for (const said of r.does || []) {
        if (said.length === 1) items.push('<li class="fc2-always">' + esc(said[0]) + '</li>');
        else items.push('<li><b>' + esc(said[0]) + '</b> ' + esc(said[1]) + '</li>');
      }
      if (!items.length && com.facts.effect) items.push('<li>' + esc(com.facts.effect) + ' <em>· RealmEye</em></li>');
      parts.push(part('Effects', items.length ? '<ul class="ix-does">' + items.join('') + '</ul>' : ''));
      /* Un blueprint dit ce qu'il débloque : le gear, cliquable, avec son sprite. */
      const unlocks = Object.entries(clientExtra).filter(([, v]) => (v.blueprints || []).includes(r.clientId)).map(([id]) => byClient(id)).filter(Boolean);
      if (unlocks.length) parts.push(part('Unlocks in the Forge', '<div class="fc2-chips">' + unlocks.map(g => '<button type="button" class="ix-jump" data-open="'
        + esc(g.id) + '">' + art(g, 14) + esc(g.said || g.name) + '</button>').join('') + '</div>'));
      const [community, forgePart] = ecoForge(r, com);
      parts.push(community, forgePart);
    }
    /* Ce que la fiche actuelle dit et qu'aucun bloc ci-dessus n'a repris. */
    const said = /^(slot|tier|soulbound|wearing it|life|armour|unlocks at level|picture|(the )?four pieces give|\d+ pieces|pieces|turns you into|for wearing all four|how often it rolls|goes on|never on|not beside)$/i;
    const rest = card.factRows.filter(([k]) => !said.test(k) && !/^[a-z]+ \(\d\)$/i.test(k) && !(r.kind === 'class' && /^(life|magic|attack|defence|speed|dexterity|vitality|wisdom)$/i.test(k)));
    if (rest.length) parts.push(part('Facts', factsDl(rest.map(([k, v]) => [k, esc(v)]))));
    return blockOf(parts, 'fc2-sheet');
  }

  /* Ce qui manque est dit, pas laissé en blanc ; la boîte ne s'affiche que quand il y a deux colonnes. */
  const emptyBox = (title, say) => '<div class="ix-block fc2-empty"><div class="ix-part"><h4>' + esc(title) + '</h4><p>' + esc(say) + '</p></div></div>';
  const powerOf = (r, com) => { const cx = clientExtra[r.clientId || r.name] || {}; return cx.power !== undefined ? String(cx.power) : com.facts.power || ''; };
  function sheet2(r, card, com) {
    const t = tierOf(r), tc = tierColor(r);
    const holds = rowByLabel(card.rows.links, /may hold/i);
    const names = holds ? namesIn(holds.html) : [];
    const allClasses = [...recs().values()].filter(x => x.kind === 'class').length;
    const sub = [isDivine(r) ? 'Divine' : '', r.sb ? 'Soulbound' : '', r.set ? esc(r.set) : ''].filter(Boolean).join(' · ');
    const head = '<div class="ix-part fc2-head">' + (card.cell || art(r, 44))
      + '<div class="fc2-name"><span class="ix-kind is-item">' + esc(slotName(r)) + '</span>'
      + '<h3 style="color:' + tc + '">' + esc(r.said || r.name) + '</h3>'
      + (sub ? '<div class="fc2-sub">' + sub + '</div>' : '')
      + (powerOf(r, com) ? '<div class="fc2-sub">Power Level ' + esc(powerOf(r, com)) + '</div>' : '')
      + (names.length && names.length < allClasses ? '<div class="fc2-sub">' + esc(names.join(', ')) + '</div>'
        : names.length ? '<div class="fc2-sub">All classes</div>' : '')
      + '</div>' + marks(r, t.b ? '<b class="fc2-tier" style="color:' + tc + '">' + esc(t.b) + '</b>' : '') + '</div>';

    /* L'attaque : le chiffre qu'on vient chercher, puis ce qui le qualifie. */
    const s = (r.fires || [])[0];
    let attack = '', damage = '';
    if (s || r.mp) {
      const rows = [];
      if (s && s.reach !== undefined) rows.push(['Range', s.reach + ' tiles']);
      const many = s ? (r.shots || s.many || 1) : 1;
      if (many > 1) rows.push(['Shots', String(many)]);
      const rate = s ? (r.rate !== undefined ? r.rate : s.rate) : undefined;
      if (rate !== undefined) rows.push(['Rate of fire', Math.round(rate * 100) + '%']);
      if (r.mp) rows.push(['MP cost', String(r.mp)]);
      const proj = projOf(r);
      const flags = (proj && proj.shots.length ? shotBehaviour(r, proj)
        : [s && s.through && 'Hits multiple targets', s && s.pierce && 'Ignores defense'].filter(Boolean).map(x => chip(esc(x))).join(''))
        + (r.conditions || []).filter(c => c.on === 'hit').map(c => chip(esc(c.effect + ' ' + c.duration + ' s'))).join('');
      /* Comme l'infobulle du jeu : les dégâts sous le nom, la portée et la cadence après la description. */
      damage = s ? '<div class="ix-part"><div class="fc2-dmg">' + s.low + (s.high !== s.low ? '–' + s.high : '') + '<small>damage</small></div></div>' : '';
      attack = part(s ? 'Shot' : 'Ability',
        factsDl(rows.filter(([k]) => !(proj && k === 'Shots'))) + (flags ? '<div class="fc2-chips">' + flags + '</div>' : ''));
    }

    const about = r.about ? r.about.replace(/\\n\\n[\s\S]*$/, '').replace(/\n\n[\s\S]*$/, '') : '';
    const desc = about ? '<div class="ix-part"><div class="ix-prose"><p>' + esc(about) + '</p></div></div>' : '';

    /* Les effets, dans la liste que la fiche utilise déjà. */
    const items = [];
    for (const said of r.does || []) {
      if (said.length === 1) items.push('<li class="fc2-always">' + esc(said[0]) + '</li>');
      else if (said[0] === 'Cooldown' && items.length) items[items.length - 1] = items[items.length - 1]
        .replace('</li>', ' <em>· recharge ' + esc(said[1].replace(/\.$/, '').replace(' seconds', ' s')) + '</em></li>');
      else items.push('<li><b>' + esc(said[0]) + '</b> ' + esc(said[1]) + '</li>');
    }
    for (const x of r.share || []) items.push('<li><b>Bonus ' + STAT_NAME[x.stat] + '</b> equal to ' + signed(x.pct) + '% of ' + STAT_NAME[x.of] + '</li>');
    const reEffect = String(com.facts.effect || '')
      .replace(/Shots hit multiple targets|Shots pass through obstacles|Ignores defense of target/g, '')
      .replace(new RegExp((r.conditions || []).filter(c => c.on === 'hit').map(c => c.effect + ' for ' + c.duration + ' seconds?').join('|') || '$^', 'g'), '')
      .replace(/\s+/g, ' ').trim();
    if (!(r.does || []).length && reEffect) items.push('<li>' + esc(reEffect) + ' <em>· RealmEye</em></li>');
    const effects = part('Effects', items.length ? '<ul class="ix-does">' + items.join('') + '</ul>' : '');

    /* Une fois équipé : la grille du jeu, en puces du site. */
    const w = r.worn || {};
    const worn = STAT_ORDER.filter(k => w[k] !== undefined);
    const xp = (clientExtra[r.clientId || r.name] || {}).xp;
    const equip = part('On equip', worn.length ? (xp ? '<p class="fc2-xp">XP bonus <b>' + xp + ' %</b></p>' : '') + '<div class="fc2-chips fc2-stats">' + worn.map(k =>
      '<span class="ix-data-chip fc2-stat' + (w[k] < 0 ? ' is-cut' : '') + '" style="--tint:' + TINT[k] + '"><b>' + signed(w[k]) + '</b> ' + STAT_NAME[k] + '</span>').join('') + '</div>'
 : '');

    const set = r.set ? rec('set:' + r.set) : null;
    let setPart = '';
    if (set && set.steps && Object.keys(set.steps).length) {
      setPart = part('Set · ' + set.name, setTable(set) + setPieces(set, r, false) + setSkin(set));
    }

    const [community, forgePart] = ecoForge(r, com);

    const sim = weaponSim(r, card);
    return {
      left: blockOf([head, damage, desc, effects, attack, equip, community, forgePart], 'fc2-sheet', '--tc:' + tc),
      right: (sim ? blockOf([part('Simulation', sim)]) : emptyBox('Simulation', 'No simulation available'))
        + (setPart ? blockOf([setPart]) : emptyBox('Set', 'Not part of a set'))
    };
  }

  /* Une ligne de plus de douze puces en montre douze et replie le reste, comme « et 12 autres ». */
  function trimChips(html, max = 12) {
    const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    const chips = [...doc.body.firstChild.children].filter(x => x.matches('.ix-jump, .ix-data-chip'));
    if (chips.length <= max) return html;
    const tail = [...doc.body.firstChild.children].filter(x => !chips.includes(x)).map(x => x.outerHTML).join('');
    return chips.slice(0, max).map(x => x.outerHTML).join('') + '<details class="fc2-more"><summary>+' + (chips.length - max)
      + '</summary><span>' + chips.slice(max).map(x => x.outerHTML).join('') + tail + '</span></details>';
  }
  function dossier2(r, card, com, max = 12) {
    card = { ...card, rows: { details: card.rows.details.map(x => ({ ...x, html: trimChips(x.html, max) })),
      links: card.rows.links.map(x => ({ ...x, html: /same name/i.test(x.label) ? x.html : trimChips(x.html, max) })), facts: [] } };
    const used = new Set();
    const take = (rows, rx) => rows.filter(x => rx.test(x.label) && !used.has(x) && used.add(x));
    const blocks = [];

    /* Où l'obtenir : les lignes que la fiche actuelle montre déjà, telles quelles. */
    const got = take(card.rows.details, /dropped by|obtained through|drop locations|blueprint|found in|sold|shop/i);
    const whereTitle = r.kind === 'enemy' ? 'Where to find it' : r.kind === 'portal' ? 'Access' : 'Where to get it';
    blocks.push(blockOf([part(whereTitle, linkRows(got.map(x => [x.label, x.html])), { tag: 'RealmEye' })]));
    if (r.kind !== 'item') {
      /* Deux sources listent souvent le même butin : chaque objet une seule fois, dans la première ligne qui le nomme. */
      const seen = new Set();
      const loot = take(card.rows.details, /dropping|drops of interest|tier drops|loot/i).map(x => {
        const doc = new DOMParser().parseFromString('<div>' + x.html + '</div>', 'text/html');
        doc.querySelectorAll('.fc2-more').forEach(m => m.replaceWith(...m.querySelector('span').childNodes));
        doc.querySelectorAll('[data-open]').forEach(b => { if (seen.has(b.dataset.open)) b.remove(); else seen.add(b.dataset.open); });
        return { ...x, html: trimChips(doc.body.firstChild.innerHTML) };
      }).filter(x => /ix-jump|ix-data-chip/.test(x.html));
      const who = take(card.rows.details, /^(enemies|bosses|minibosses|enemies found here)$/i);
      blocks.push(blockOf([part(r.kind === 'enemy' ? 'Drops' : 'Loot', linkRows(loot.map(x => [x.label, x.html])), { tag: 'RealmEye' }),
        part('Inhabitants', linkRows(who.map(x => [x.label, x.html])), { tag: 'RealmEye' })]));
    }

    /* Enchantement : ce que l'objet permet, pas ce qu'un exemplaire porte. */
    const wakes = take(card.rows.links, /^wakes$/i)[0];
    const pool = take(card.rows.links, /rolls from/i)[0];
    const encRows = [['Status', r.ench ? chip('Enchantable') + chip('4 slots') : chip('Not enchantable')]];
    const cx = clientExtra[r.clientId || r.name] || {};
    const DUST = { redDust: 'red', purpleDust: 'purple', greenDust: 'green', blueDust: 'blue', yellowDust: 'yellow', orangeDust: 'orange' };
    if (r.ench && cx.dust && UI[cx.dust] !== undefined) encRows.push(['Dust per slot',
      (cx.dustAmounts || []).map((n, i) => '<span class="ix-data-chip fc2-matchip" title="Slot ' + (i + 1) + ': ' + n
        + ' ' + (DUST[cx.dust] || '') + ' dust">' + uiIcon(cx.dust, (DUST[cx.dust] || '') + ' dust') + '<b>' + n + '</b></span>').join('')]);
    if (pool) encRows.push([pool.label, pool.html]);
    if (wakes) encRows.push(['Can awaken', wakes.html]);
    if (isGear(r)) blocks.push(blockOf([part('Enchantment', linkRows(encRows))]));

    /* Les autres formes sous ce nom, et ce que la communauté en écrit. */
    const same = take(card.rows.links, /same name/i)[0];
    const holds = take(card.rows.links, /may hold/i)[0];
    const varRows = [];
    if (same) varRows.push(['Variants', same.html]);
    if (com.variants) varRows.push(['According to RealmEye', chip(esc(com.variants))]);
    const notes = com.notes ? '<div class="ix-prose"><p>' + esc(com.notes) + '</p></div>' : '';
    blocks.push(blockOf([part('Variants', linkRows(varRows)), part('Notes', notes, { tag: 'RealmEye' })]));

    /* Ce que la fiche de gauche montre déjà (pièces, skin du set, set d'une pièce, classe d'un skin) ne revient pas ici. */
    const shownLeft = x => (r.kind === 'set' && /made of|dresses you as/i.test(x.label))
      || (isGear(r) && r.set && /made of/i.test(x.label))
      || (r.kind === 'skin' && /worn by/i.test(x.label));
    const rest = card.rows.details.filter(x => !used.has(x)).concat(card.rows.links.filter(x => !used.has(x) && x !== holds && !shownLeft(x)));
    const dl = card.dlDetails.filter(([k]) => !/drops from|obtained through|feed power|dust|loot bag|on equip|power level|tier$|xp bonus|soulbound|forging|dismantl|effect|damage|range|shots|mp cost|reactive|^set$|lifetime|projectile|amplitude|frequency|potion|technical|rate of fire/i.test(k));
    blocks.push(blockOf([
      part('Links', linkRows(rest.map(x => [x.label, x.html]))),
      part('Other data', factsDl(dl.map(([k, v]) => [k, esc(v)])) + (card.tables || ''), { tag: 'RealmEye', closed: true }),
      part('Tags', card.labels.length ? '<div class="fc2-chips">' + card.labels.join('') + '</div>' : '', { closed: true })
    ]));
    return blocks.join('') + card.others.join('');
  }


  /* =====================================================================
     Sets, classes, simulation d'arme — ajouts de la maquette.
     ===================================================================== */
  const statChips = w => '<div class="fc2-chips fc2-stats">' + STAT_ORDER.filter(k => w[k]).map(k =>
    '<span class="ix-data-chip fc2-stat' + (w[k] < 0 ? ' is-cut' : '') + '" style="--tint:' + TINT[k] + '"><b>' + signed(w[k]) + '</b> '
    + STAT_SHORT_FR[k] + '</span>').join('') + '</div>';
  const addStats = (into, w) => { for (const [k, v] of Object.entries(w || {})) into[k] = (into[k] || 0) + v; return into; };
  const jump = (o, side = 14) => '<button type="button" class="ix-jump" data-open="' + esc(o.id) + '">' + art(o, side) + esc(o.said || o.name) + '</button>';

  /* Les bonus du set palier par palier, puis ce que le set complet donne avec les stats de ses pièces. */
  function setTable(set) {
    const ks = Object.keys(set.steps || {});
    if (!ks.length) return '';
    const pieces = (set.pieces || []).map(n => rec('item:' + n)).filter(Boolean);
    const withPieces = pieces.length && pieces.length <= 6;
    const total = {};
    if (withPieces) { pieces.forEach(o => addStats(total, o.worn)); ks.forEach(n => addStats(total, set.steps[n])); }
    const used = STAT_ORDER.filter(k => ks.some(n => set.steps[n][k] !== undefined) || (withPieces && total[k]));
    const cell = (k, v) => '<td style="--tint:' + TINT[k] + '">' + (v ? signed(v) : '') + '</td>';
    return '<div class="ix-realm-table"><table><thead><tr><th></th>' + used.map(k => '<th style="--tint:' + TINT[k] + '">' + STAT_SHORT_FR[k] + '</th>').join('')
      + '</tr></thead><tbody>' + ks.map(n => '<tr><td>' + (n === '4' ? 'Full set' : n + ' pieces') + '</td>' + used.map(k => cell(k, set.steps[n][k])).join('') + '</tr>').join('')
      + (withPieces ? '<tr class="fc2-settotal"><td>Full set + pieces</td>' + used.map(k => cell(k, total[k])).join('') + '</tr>' : '')
      + '</tbody></table></div>';
  }

  /* Le skin du set complet, animé, et la porte vers le Skin Viewer (remplie après coup, depuis la fiche du set). */
  /* La même porte que la fiche du set : cible { kind, id, type, via: 'set' } du Skin Viewer. */
  function viewerDoor(skin) {
    const type = skinTypes && skinTypes.get(skin.id);
    if (!type) return '';
    const target = { kind: 'skin', id: skin.name, type: parseInt(type, 16), via: 'set' };
    const say = window.RealmI18n ? RealmI18n.t('index.door.skinViewer') : 'Open in Skin Viewer';
    return '<button type="button" class="ix-door" data-skin-target="' + esc(encodeURIComponent(JSON.stringify(target))) + '">' + esc(say) + '</button>';
  }
  function setSkin(set, own) {
    const skinId = ((set.out || []).find(([how]) => how === 'dresses you as') || [])[1];
    const skin = skinId ? rec(skinId) : null;
    if (!skin) return '';
    return '<div class="fc2-setskin"><span class="fc2-bigart">' + skinCanvas(skin.id) + '</span><div>'
      + (skin ? jump(skin) : '') + (own ? '' : viewerDoor(skin)) + '</div></div>';
  }

  /* Les pièces en une rangée de sprites ; le total du set complet, une fois, là où on le demande. */
  function setPieces(set, current, withTotal) {
    const pieces = (set.pieces || []).map(n => rec('item:' + n)).filter(Boolean);
    if (!pieces.length) return '';
    const icons = pieces.length > 4;
    const row = '<div class="fc2-chips fc2-piecerow' + (icons ? ' is-icons' : '') + '">' + trimChips(pieces.map(o => '<button type="button" class="ix-jump' + (current && o.id === current.id ? ' is-me' : '')
      + '" data-open="' + esc(o.id) + '" title="' + esc(o.said || o.name) + '">' + art(o, icons ? 18 : 16) + (icons ? '' : esc(o.said || o.name)) + '</button>').join(''), icons ? 24 : 12) + '</div>';
    if (!withTotal || pieces.length > 6) return row;
    const total = {};
    pieces.forEach(o => addStats(total, o.worn));
    for (const n of Object.keys(set.steps || {})) addStats(total, set.steps[n]);
    return row + linkRows([['Full set total', statChips(total)]]);
  }

  /* Une classe face aux autres : son maximum, rapporté au meilleur maximum de toutes les classes. */
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  function classCompare(r) {
    const classes = [...recs().values()].filter(x => x.kind === 'class' && x.stats);
    const rows = Object.keys(CLASS_TINT).filter(k => r.stats[k + 'Top'] !== undefined).map(k => {
      const mine = r.stats[k + 'Top'];
      const tops = classes.map(c => c.stats[k + 'Top']).filter(v => v !== undefined);
      const best = Math.max(...tops), worst = Math.min(...tops);
      const rank = 1 + tops.filter(v => v > mine).length;
      const tag = mine === best ? '<em class="is-best">highest</em>' : mine === worst ? '<em class="is-worst">lowest</em>'
        : rank <= 3 ? '<em class="is-good">' + ord(rank) + '</em>' : rank >= tops.length - 2 ? '<em class="is-weak">' + ord(rank) + '</em>' : '<em>' + ord(rank) + '</em>';
      return '<div class="fc2-cmp" style="--tint:' + TINT[CLASS_TINT[k]] + '"><i>' + STAT_SHORT_FR[CLASS_TINT[k]] + '</i>'
        + '<span class="fc2-bar"><b style="width:' + (100 * mine / best).toFixed(1) + '%"></b><s style="left:' + (100 * worst / best).toFixed(1) + '%"></s></span>'
        + '<span class="fc2-num"><b>' + mine + '</b> / ' + best + '</span>' + tag + '</div>';
    }).join('');
    return part('Against all ' + classes.length + ' classes', '<div class="fc2-cmps">' + rows + '</div>'
      + '<p class="fc2-note">Class maximum against the highest maximum of any class; the mark shows the lowest.</p>');
  }

  /* ---------- le projectile, tel qu'il part de l'arme ---------- */
  let projData = null;
  fetch('assets/index/projectiles.json').then(r => r.json()).then(j => { projData = j; }).catch(() => {}).finally(settled);
  const projOf = r => projData && projData.items[r.clientId || r.name];

  /* Ce que fait le tir, dit une fois, sous l'animation. */
  function shotBehaviour(r, p) {
    const s = p.shots[0];
    const out = [];
    if (p.many > 1) out.push(p.many + ' projectiles' + (p.arc ? ' · ' + p.arc + '° apart' : ' in parallel'));
    if (s.amp) out.push('Waves: ' + s.amp + ' tile, ' + s.freq + ' cycle' + (s.freq > 1 ? 's' : '') + ' per shot');
    if (s.wavy) out.push('Wobbles');
    if (s.param) out.push('Figure-eight path');
    if (s.boom) out.push('Comes back like a boomerang');
    if (s.accel) out.push(s.accel > 0 ? 'Speeds up' : 'Slows down');
    if (s.multi) out.push('Hits multiple targets');
    if (s.cover) out.push('Passes through obstacles');
    if (s.pierce) out.push('Ignores defense');
    if (s.size && s.size !== 100) out.push('Size ' + s.size + '%');
    return out.map(x => chip(esc(x))).join('');
  }

  function weaponSim(r, card) {
    const p = projOf(r);
    if (!p || !p.shots.length || !p.shots[0].pic) return '';
    const set = r.set ? projData.sets['set:' + r.set] : null;
    return '<div class="fc2-sim" data-sim="' + esc(r.id) + '"><canvas class="fc2-sim-canvas"></canvas>'
      + '<div class="fc2-sim-ctl">'
      + (set && (set.skin || set.bullet) ? '<span class="fc-mode fc2-setmode"><button type="button" data-setmode="0" aria-pressed="true">Weapon</button>'
        + '<button type="button" data-setmode="1" aria-pressed="false">Full set</button></span>' : '')
      + '<span class="fc-mode fc2-speed"><button type="button" data-speed="1" aria-pressed="true">1×</button>'
      + '<button type="button" data-speed="0.25" aria-pressed="false">¼×</button></span>'
      + '</div></div>';
  }

  const sheetImages = {};
  const image = src => sheetImages[src] || (sheetImages[src] = Object.assign(new Image(), { src }));

  /*
   * La trajectoire, comme le client la calcule : la distance parcourue à la
   * vitesse du tir (avec son accélération), le retour d'un boomerang, le huit
   * d'un tir paramétrique, l'oscillation d'un tir « wavy », et l'ondulation
   * d'amplitude A et de fréquence F cycles par durée de vie.
   */
  function shotAt(s, o) {
    const cos = Math.cos(o.angle), sin = Math.sin(o.angle);
    if (s.param) {
      const t = o.age / s.life * 2 * Math.PI;
      const a = Math.sin(t) * (o.n % 2 ? 1 : -1), b = Math.sin(2 * t) * (o.n % 4 < 2 ? 1 : -1);
      return { x: (a * cos - b * sin) * s.mag, y: (a * sin + b * cos) * s.mag };
    }
    let dist = o.dist;
    if (s.boom) { const half = o.full / 2; if (dist > half) dist = half - (dist - half); }
    if (s.wavy) {
      const th = o.angle + Math.PI / 64 * Math.sin(o.phase + 6 * Math.PI * o.age);
      return { x: dist * Math.cos(th), y: dist * Math.sin(th) };
    }
    let x = dist * cos, y = dist * sin;
    if (s.amp) {
      const d = s.amp * Math.sin(o.phase + o.age / s.life * s.freq * 2 * Math.PI);
      x += d * Math.cos(o.angle + Math.PI / 2); y += d * Math.sin(o.angle + Math.PI / 2);
    }
    return { x, y };
  }

  /* Une image d'un sprite animé de Theory Crafting : les poses sont rangées « orientation/action ». */
  const poseFrames = (pic, doing) => (pic && pic.poses && (pic.poses['0/' + doing] || pic.poses['0/0'])) || [0];

  function bootSims(box) {
    for (const host of box.querySelectorAll('.fc2-sim:not([data-on])')) {
      host.dataset.on = '1';
      const r = rec(host.dataset.sim), p = projOf(r), base = p.shots[0];
      const setData = r.set ? projData.sets['set:' + r.set] : null;
      const ts = index().theorySheet || { pics: {} };
      const theory = image((window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.theorySheet) || 'assets/theory/sheet.png'), bolts = image('assets/index/projectiles.png'), skins = image('assets/skins/textures/looks.png');
      const canvas = host.querySelector('canvas'), pen = canvas.getContext('2d');
      const holder = [...recs().values()].find(c => c.kind === 'class' && (c.slots || []).includes(r.slot));
      const classPic = holder && ts.pics['c:' + holder.name];
      const range = base.speed * base.life;
      const arc = (p.arc !== undefined ? p.arc : (p.many > 1 ? 11.25 : 0)) * Math.PI / 180;
      const every = 1 / ((1.5 + 6.5 * 50 / 75) * (p.rate || 1));
      const state = { speed: 1, withSet: false, shots: [], cool: 0, fired: 0, clock: 0, swing: 0, hit: 0 };
      host.addEventListener('click', e => {
        const sp = e.target.closest('[data-speed]'), sm = e.target.closest('[data-setmode]');
        if (sp) { state.speed = Number(sp.dataset.speed); host.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === sp))); }
        if (sm) { state.withSet = sm.dataset.setmode === '1'; state.shots.length = 0; host.querySelectorAll('[data-setmode]').forEach(x => x.setAttribute('aria-pressed', String(x === sm))); }
      });
      /* Le skin du set complet, de profil : ses images d'attente et d'attaque. */
      const setLook = setData && setData.skin && looks && looks.skins[setData.skin];

      /*
       * PERF: these frames never change during the lifetime of a fiche.
       * Building them inside draw() created arrays every animation frame.
       */
      const setIdleFrames = [];
      const setAttackFrames = [];

      if (setLook) {
        for (const f of setLook.frames) {
          if (f[2] !== 0) continue;

          const frame = {
            x: f[3],
            y: f[4],
            w: f[5],
            h: f[6]
          };

          if (f[1] === 0) {
            setIdleFrames.push(frame);
          } else if (f[1] === 2) {
            setAttackFrames.push(frame);
          }
        }
      }
      /*
       * PERF:
       * Geometry belongs to resizing, not animation.
       *
       * Reading clientWidth from every animation frame can force the browser
       * to settle layout before the canvas is painted. Measure it once, then
       * let ResizeObserver update the cached drawing geometry only when the
       * element actually changes size.
       */
      const simSize = { W: 0, T: 0, H: 0 };

      /*
       * PERF:
       * The checkerboard, range marker and label are completely static for
       * one fiche. Render them once per geometry/DPR instead of rebuilding
       * dozens of canvas primitives on every projectile frame.
       */
      const simBackdrop =
        document.createElement('canvas');

      const simBackdropPen =
        simBackdrop.getContext('2d');

      let simBackdropKey = '';

      const paintSimBackdrop = (
        W,
        T,
        H,
        dpr
      ) => {
        const key =
          [
            W,
            T,
            H,
            dpr
          ].join('|');

        if (
          key === simBackdropKey
        ) {
          return;
        }

        simBackdropKey = key;

        simBackdrop.width =
          Math.round(W * dpr);

        simBackdrop.height =
          Math.round(H * dpr);

        const bg =
          simBackdropPen;

        bg.setTransform(
          dpr,
          0,
          0,
          dpr,
          0,
          0
        );

        bg.clearRect(
          0,
          0,
          W,
          H
        );

        bg.imageSmoothingEnabled =
          false;

        const x0 =
          14 + T;

        const y0 =
          Math.round(H / 2);

        for (
          let i = -1;
          i * T < W;
          i++
        ) {
          for (
            let j = -Math.ceil(H / T);
            j * T < H;
            j++
          ) {
            if (
              (i + j) % 2 === 0
            ) {
              continue;
            }

            bg.fillStyle =
              'rgba(255,255,255,.028)';

            bg.fillRect(
              x0 - T / 2 + i * T,
              y0 - T / 2 + j * T,
              T,
              T
            );
          }
        }

        bg.strokeStyle =
          'rgba(121,197,232,.35)';

        bg.setLineDash(
          [3, 4]
        );

        bg.beginPath();

        bg.moveTo(
          x0 + range * T,
          6
        );

        bg.lineTo(
          x0 + range * T,
          H - 6
        );

        bg.stroke();

        bg.setLineDash([]);

        bg.fillStyle =
          'rgba(236,231,220,.5)';

        bg.font =
          '11px system-ui';

        bg.fillText(
          String(
            Math.round(range * 10) / 10
          ) + ' tiles',
          Math.min(
            W - 58,
            x0 + range * T + 4
          ),
          14
        );
      };

      const fitSim = width => {
        const W = Math.max(1, Math.round(width || 360));
        const T = Math.max(
          14,
          Math.min(
            40,
            Math.floor((W - 40) / (range + 2.5))
          )
        );

        const reachY =
          base.param
            ? base.mag
            : base.amp || 0;

        const H = Math.max(
          96,
          Math.min(
            180,
            Math.round(
              T * (
                3.5
                + 2 * reachY
                + Math.max(
                  1,
                  p.many * arc * range / 2
                )
              )
            )
          )
        );

        simSize.W = W;
        simSize.T = T;
        simSize.H = H;

        const cssHeight = H + 'px';

        if (canvas.style.height !== cssHeight) {
          canvas.style.height = cssHeight;
        }
      };

      /*
       * One unavoidable initial measurement.
       * Every following measurement comes from ResizeObserver.
       */
      fitSim(canvas.clientWidth || 360);

      const simResizeObserver =
        typeof ResizeObserver === 'function'
          ? new ResizeObserver(entries => {
              const entry = entries[0];

              if (entry) {
                fitSim(entry.contentRect.width);
              }
            })
          : null;

      if (simResizeObserver) {
        simResizeObserver.observe(canvas);
      }


      /*
       * PERF:
       * A fiche can stay connected while another record, another drawer or
       * another part of the page is being read.
       *
       * Connected does not mean visible. The old loop kept painting in that
       * state. IntersectionObserver lets the RAF disappear completely until
       * the simulation is close to the viewport again.
       */
      let last = performance.now();

      /*
       * PERF:
       * This is a small pixel-art preview, not the main game viewport.
       * 72 FPS keeps it completely fluid while avoiding refresh-rate-sized
       * CPU cost on 120/144/165/240 Hz displays.
       */
      const SIM_FRAME_MIN_MS =
        1000 / 72;

      let simDrawnAt =
        -1e9;

      let simVisible = true;
      let simFrame = 0;
      let simVisibilityObserver = null;


      const stopSimFrame = () => {
        if (!simFrame) return;

        cancelAnimationFrame(simFrame);
        simFrame = 0;
      };


      const cleanSim = () => {
        stopSimFrame();

        if (simResizeObserver) {
          simResizeObserver.disconnect();
        }

        if (simVisibilityObserver) {
          simVisibilityObserver.disconnect();
        }
      };


      const scheduleSimFrame = () => {
        if (
          simFrame
          || !simVisible
          || !canvas.isConnected
        ) {
          return;
        }

        simFrame =
          requestAnimationFrame(frame);
      };


      const frame = now => {
        simFrame = 0;

        if (!canvas.isConnected) {
          cleanSim();
          return;
        }

        if (!simVisible) {
          return;
        }

        if (
          now - simDrawnAt
          < SIM_FRAME_MIN_MS
        ) {
          scheduleSimFrame();
          return;
        }

        simDrawnAt =
          now;

        try {
          draw(now);
        } catch (err) {
          console.error(
            'fiches-c sim',
            err
          );
        }

        scheduleSimFrame();
      };


      const draw = now => {
        const dt =
          Math.min(
            0.05,
            (now - last) / 1000
          ) * state.speed;

        last = now;

        state.clock += dt;
        state.swing =
          Math.max(
            0,
            state.swing - dt
          );

        state.hit =
          Math.max(
            0,
            state.hit - dt
          );

        /* Ce que tire l'arme : son projectile, ou celui que le set complet lui donne. */
        const pic = projData.pics[state.withSet && setData && setData.bullet ? setData.bullet : base.pic];
        const size = state.withSet && setData && setData.bullet && !base.sizeDeclared ? setData.bulletSize : base.size;
        const tilt = pic.tilt || 0;

        const {
          W,
          T,
          H
        } = simSize;

        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
          canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + 'px';
        }
        paintSimBackdrop(
          W,
          T,
          H,
          dpr
        );

        pen.setTransform(
          dpr,
          0,
          0,
          dpr,
          0,
          0
        );

        pen.imageSmoothingEnabled =
          false;

        pen.clearRect(
          0,
          0,
          W,
          H
        );

        /*
         * One cached blit replaces the checkerboard/range/text primitives.
         */
        pen.drawImage(
          simBackdrop,
          0,
          0,
          W,
          H
        );

        const x0 =
          14 + T;

        const y0 =
          Math.round(H / 2);

        const floor =
          y0 + T / 2;

        /* Le tireur : la classe, ou le skin du set complet ; il attaque à chaque salve. */
        const doing = state.swing > 0 ? 2 : 0;
        if (state.withSet && setLook && skins.complete) {
          const list =
            doing === 2 && setAttackFrames.length
              ? setAttackFrames
              : setIdleFrames;
          const f = list[Math.floor(state.clock * 8) % list.length];
          if (f) {
            const z = T / 8 * (setData.skinSize || 100) / 100;
            pen.drawImage(skins, f.x, f.y, f.w, f.h, x0 - T / 2, floor - f.h * z, f.w * z, f.h * z);
          }
        } else if (classPic && theory.complete) {
          const list = poseFrames(classPic, doing);
          const f = list[Math.floor(state.clock * 8) % list.length];
          pen.drawImage(theory, classPic.x + f * classPic.w, classPic.y, classPic.w, classPic.h, x0 - T / 2, floor - classPic.h * T / 8, classPic.w * T / 8, classPic.h * T / 8);
        }

        state.cool -= dt;
        if (state.cool <= 0) {
          state.cool += every; state.swing = Math.min(every, 0.25);
          for (let n = 0; n < p.many; n++) {
            state.shots.push({ n: state.fired++, age: 0, dist: 0, full: range, angle: p.many > 1 ? (n - (p.many - 1) / 2) * arc : 0,
              phase: n % 2 ? Math.PI : 0, v: base.speed, px: 0, py: 0 });
          }
        }
        for (let i = state.shots.length - 1; i >= 0; i--) {
          const o = state.shots[i];
          o.age += dt;
          if (o.age >= base.life) {
            state.shots.splice(i, 1); continue;
          }
          if (base.accel && o.age * 1000 >= (base.accelDelay || 0)) {
            o.v = Math.max(0, o.v + base.accel / 10 * dt);
            if (base.speedClamp) o.v = base.accel > 0 ? Math.min(o.v, base.speedClamp / 10) : Math.max(o.v, base.speedClamp / 10);
          }
          o.dist += o.v * dt;
          const at = shotAt(base, o);
          const heading = Math.atan2(at.y - o.py, at.x - o.px) || o.angle;
          o.px = at.x; o.py = at.y;
          const z = T / (pic.cell || 8) * (size || 100) / 100;
          const w = pic.w * z, h = pic.h * z;
          const f = pic.frames > 1 ? Math.floor(o.age * (pic.fps || 12)) % pic.frames : 0;
          pen.save();
          pen.translate(x0 + T * 0.4 + at.x * T, y0 + at.y * T);
          pen.rotate(heading + tilt * Math.PI / 4 + (pic.spin ? o.age * 1000 / pic.spin : 0));
          if (bolts.complete) pen.drawImage(bolts, pic.x + f * pic.w, pic.y, pic.w, pic.h, -w / 2, -h / 2, w, h);
          pen.restore();
        }
      };


      if (
        typeof IntersectionObserver === 'function'
      ) {
        /*
         * A little margin lets the simulation wake before it actually enters
         * the viewport, so scrolling never exposes an unpainted canvas.
         */
        simVisible = false;

        simVisibilityObserver =
          new IntersectionObserver(
            entries => {
              const entry =
                entries[0];

              if (!canvas.isConnected) {
                cleanSim();
                return;
              }

              simVisible =
                Boolean(
                  entry
                  && entry.isIntersecting
                );

              if (simVisible) {
                /*
                 * Do not advance by the whole time spent asleep.
                 * draw() already clamps dt, but resetting here also keeps
                 * normal animation timing on the first resumed frame.
                 */
                last =
                  performance.now();

                scheduleSimFrame();
              } else {
                stopSimFrame();
              }
            },
            {
              root: null,
              rootMargin:
                '160px 0px'
            }
          );

        simVisibilityObserver.observe(
          canvas
        );
      } else {
        /*
         * Older browsers keep the original behaviour.
         */
        scheduleSimFrame();
      }
    }
  }

  /* ---------- le skin, animé depuis les images du Skin Viewer ---------- */
  let looks = null, skinTypes = null;
  Promise.all([fetch('assets/skins/generated/looks.json').then(r => r.json()), fetch('assets/skins/generated/skins.json').then(r => r.json())])
    .then(([l, s]) => { looks = l; skinTypes = new Map((s.skins || []).map(x => [x.id, x.type])); }).catch(() => {}).finally(settled);
  const skinCanvas = (skinId, big) => '<canvas class="fc2-skin' + (big ? ' is-big' : '') + '" data-skin="' + esc(skinId) + '" width="96" height="96"></canvas>';
  function bootSkins(box) {
    if (!looks) return;
    const sheet = image('assets/skins/textures/looks.png');
    for (const c of box.querySelectorAll('canvas.fc2-skin:not([data-on])')) {
      const type = skinTypes.get(c.dataset.skin);
      const look = type && looks.skins[type];
      if (!look) continue;
      c.dataset.on = '1';
      const F = look.frames.map(f => ({ action: f[1], dir: f[2], x: f[3], y: f[4], w: f[5], h: f[6] }));
      const walk = F.filter(f => f.dir === 3 && f.action === 1), hit = F.filter(f => f.dir === 3 && f.action === 2);
      const side = F.filter(f => f.dir === 0 && f.action === 1);
      const loop = [...walk, ...walk, ...side, ...side, ...hit, ...hit].filter(Boolean);
      if (!loop.length) continue;
      const pen = c.getContext('2d');

      /*
       * PERF:
       * The picture changes only every 160 ms. The former loop nevertheless
       * woke at the display refresh rate just to ask whether 160 ms had
       * elapsed. A timer expresses the real cadence directly.
       */
      let i = 0;
      let skinTimer = 0;
      let skinVisible = true;
      let skinVisibilityObserver = null;

      const drawSkinFrame = () => {
        i = (i + 1) % loop.length;

        const f = loop[i];

        pen.clearRect(
          0,
          0,
          c.width,
          c.height
        );

        pen.imageSmoothingEnabled = false;

        const z = Math.floor(
          Math.min(
            (c.width - 8) / Math.max(f.w, 16),
            (c.height - 8) / Math.max(f.h, 16)
          )
        );

        if (sheet.complete) {
          pen.drawImage(
            sheet,
            f.x,
            f.y,
            f.w,
            f.h,
            Math.round(
              (c.width - f.w * z) / 2
            ),
            c.height - 4 - f.h * z,
            f.w * z,
            f.h * z
          );
        }
      };

      const stopSkinTimer = () => {
        if (!skinTimer) return;

        clearTimeout(skinTimer);
        skinTimer = 0;
      };

      const cleanSkinTimer = () => {
        stopSkinTimer();

        if (skinVisibilityObserver) {
          skinVisibilityObserver.disconnect();
        }
      };

      const scheduleSkinFrame = () => {
        if (
          skinTimer
          || !skinVisible
          || !c.isConnected
        ) {
          return;
        }

        skinTimer =
          setTimeout(
            tickSkin,
            160
          );
      };

      const tickSkin = () => {
        skinTimer = 0;

        if (!c.isConnected) {
          cleanSkinTimer();
          return;
        }

        if (!skinVisible) {
          return;
        }

        drawSkinFrame();
        scheduleSkinFrame();
      };

      /*
       * Preserve the old immediate first paint.
       */
      drawSkinFrame();

      if (
        typeof IntersectionObserver === 'function'
      ) {
        skinVisible = false;

        skinVisibilityObserver =
          new IntersectionObserver(
            entries => {
              if (!c.isConnected) {
                cleanSkinTimer();
                return;
              }

              skinVisible =
                Boolean(
                  entries[0]
                  && entries[0].isIntersecting
                );

              if (skinVisible) {
                scheduleSkinFrame();
              } else {
                stopSkinTimer();
              }
            },
            {
              root: null,
              rootMargin: '120px 0px'
            }
          );

        skinVisibilityObserver.observe(c);
      } else {
        scheduleSkinFrame();
      }
    }
  }

  /* La porte du Skin Viewer d'un set, reprise de la fiche du set pour chacune de ses pièces. */
  async function bootViewers(box) {
    for (const slot of box.querySelectorAll('[data-fc-viewer]:not([data-on])')) {
      slot.dataset.on = '1';
      const c = await RealmIndex.card(slot.dataset.fcViewer);
      if (!c) continue;
      const doc = new DOMParser().parseFromString(c.html, 'text/html');
      const door = doc.querySelector('[data-skin-target]');
      if (door) slot.innerHTML = door.outerHTML;
    }
  }

  /* ---------- branchement ---------- */
  const isGear = r => Boolean(r && r.kind === 'item' && !r.use && !r.family && r.slot !== undefined && r.slot !== 10);
  /* The card the site drew, per host: the Index page, and the atlas's drawer on the left of the map. */
  const HOSTS = ['ixCard', 'atlasIndexCard'];
  const hosts = () => HOSTS.map(id => document.getElementById(id)).filter(Boolean);
  const drawn = new WeakMap();
  const widths = new WeakMap();
  const modeBar = () => '';
  function build(box) {
    const card = readCard(box);
    if (!card.id) return null;
    /* Un record que seul RealmEye connaît n'est pas dans l'Index du client : on le décrit par sa fiche. */
    const r = rec(card.id) || { id: card.id, kind: card.id.split(':')[0], name: card.name, communityOnly: true };
    const gear = isGear(r);
    const com = communityOf(r);
    card.__used = new Set();
    const bar = '<div class="fc-bar"><div class="fc-tools">' + card.doors + card.away + card.love + '</div>' + modeBar() + '</div>';
    if (mode === 'c2' && gear) {
      const sheet = sheet2(r, card, com);
      return '<div class="fc-root fc2 fc2-gear">' + bar + card.warns
        + '<div class="fc-cols"><div class="fc-left">' + sheet.left + '</div>'
        + '<div class="fc-right fc2-side">' + sheet.right + '<div class="fc2-dosmark" hidden></div>' + dossier2(r, card, com, 8) + '</div></div></div>';
    }
    if (mode === 'c2') {
      return '<div class="fc-root fc2">' + bar + card.warns
        + '<div class="fc-cols"><div class="fc-left">' + sheetAny(r, card, com) + '</div>'
        + '<div class="fc-right fc2-right">' + dossier2(r, card, com) + '</div></div></div>';
    }
    return '<div class="fc-root">' + bar + card.warns
      + '<div class="fc-cols"><div class="fc-left">' + tooltip(r, card, com)
      + '<p class="fc-note">Base values declared by the client: no rarity, no enchantment. <b style="color:#7aa6c2">RE</b> = RealmEye.</p></div>'
      + '<div class="fc-right">' + dossier(r, card, com) + '</div></div></div>';
  }
  /*
   * Deux colonnes de hauteur voisine : les derniers blocs du dossier passent au
   * bas de la colonne de gauche tant que la droite dépasse. Seulement quand il
   * y a vraiment deux colonnes, et jamais la simulation ni le set.
   */
  function balance(box) {
    const cols = box.querySelector('.fc2-gear .fc-cols');
    if (!cols) return;
    const left = cols.querySelector('.fc-left'), side = cols.querySelector('.fc2-side');
    if (!left || !side || getComputedStyle(cols).gridTemplateColumns.split(' ').length < 2) return;
    const mark = side.querySelector('.fc2-dosmark');
    for (let guard = 0; guard < 8; guard++) {
      const movable = mark ? [...side.children].slice([...side.children].indexOf(mark) + 1) : [];
      const last = movable[movable.length - 1];
      if (!last) break;
      const lh = left.getBoundingClientRect().height, sh = side.getBoundingClientRect().height;
      const bh = last.getBoundingClientRect().height;
      if (lh + bh + 8 >= sh) break;                      // le déplacer ne ferait pas baisser la colonne la plus haute
      left.insertBefore(last, left.querySelector('.fc2-moved'));
      last.classList.add('fc2-moved');
    }
  }
  /*
   * Plus grand quand il y a la place : la taille de base du texte monte par pas
   * de 5 % tant que la fiche tient sans défiler, jusqu'à +30 %, et revient d'un
   * pas au premier débordement. Mesuré, pas deviné : la place dépend de la
   * fenêtre, du record et de ce que l'équilibrage a déplacé.
   */
  function fitText(box) {
    const root = box.querySelector('.fc2-gear');
    const probe = root && root.querySelector('.fc-left .ix-prose, .fc-left .ix-facts dd, .fc-left .fc2-sub');
    if (!root || !probe) return;
    root.style.removeProperty('--ix-fs');
    balance(box);
    const base = parseFloat(getComputedStyle(probe).fontSize) / (probe.matches('.ix-prose') ? .92 : probe.matches('.fc2-sub') ? .86 : 1);
    const fits = () => box.scrollHeight <= box.clientHeight + 1;
    if (!base || !fits()) return;
    let k = 1;
    while (k < 1.3) {
      const next = Math.round((k + .05) * 100) / 100;
      root.style.setProperty('--ix-fs', (base * next).toFixed(2) + 'px');
      balance(box);
      if (!fits()) { root.style.setProperty('--ix-fs', (base * k).toFixed(2) + 'px'); break; }
      k = next;
    }
    if (k === 1) root.style.removeProperty('--ix-fs');
  }
  /* Tout se mesure dans la même tâche que l'insertion : le navigateur ne peint que le résultat. */
  function settle(box) {
    bootSims(box); bootViewers(box); bootSkins(box);
    /* The atlas drawer keeps one text size and scrolls, like the atlas panel beside it; only the Index page grows into its room. */
    if (box.id === 'atlasIndexCard') balance(box); else fitText(box);
    /* The width it was laid out for: only a later change lays it out again. */
    const was = widths.get(box) || {};
    clearTimeout(was.timer);
    widths.set(box, { wide: Math.round(box.getBoundingClientRect().width) });
  }
  function redraw() {
    if (mode === 'old') return;
    for (const box of hosts()) {
      const last = drawn.get(box);
      if (!last || !box.firstElementChild) continue;
      box.innerHTML = last;
      const html = build(box);
      if (html) { box.innerHTML = html; settle(box); }
    }
  }
  function onCard(box) {
    if (!box.firstElementChild || box.querySelector('.fc-root, .fc-oldbar')) return;
    drawn.set(box, box.innerHTML);
    if (pending > 0) { box.style.visibility = 'hidden'; return; }
    if (mode !== 'old') { const html = build(box); if (html) { box.innerHTML = html; settle(box); } }
    else box.insertAdjacentHTML('afterbegin', '<div class="fc-bar fc-oldbar"><span></span>' + modeBar() + '</div>');
  }
  /*
   * A host resized by its reader - the atlas drawer's handle, the window - lays
   * the card out again once the width holds still: the columns, their balance
   * and the text size all depend on it.
   */
  const resized = new ResizeObserver(entries => {
    for (const entry of entries) {
      const box = entry.target, wide = Math.round(box.getBoundingClientRect().width);
      const was = widths.get(box);
      if (!was || Math.abs(was.wide - wide) < 4) continue;
      was.wide = wide;
      clearTimeout(was.timer);
      was.timer = setTimeout(function again() {
        /* Not while the drawer's handle is still held: once, when it is let go. */
        if (box.closest('.is-sizing')) { was.timer = setTimeout(again, 120); return; }
        const last = drawn.get(box);
        if (!last || pending > 0 || !box.querySelector('.fc-root')) return;
        const keep = box.scrollTop;
        box.innerHTML = last;
        const html = build(box);
        if (html) { box.innerHTML = html; settle(box); box.scrollTop = keep; }
      }, 160);
    }
  });
  /* Each host is watched as soon as it exists. */
  const watched = new WeakSet();
  const wait = setInterval(() => {
    for (const box of hosts()) {
      if (watched.has(box)) continue;
      watched.add(box);
      new MutationObserver(() => onCard(box)).observe(box, { childList: true });
      resized.observe(box);
      if (box.firstElementChild) onCard(box);
    }
    if (hosts().length === HOSTS.length) clearInterval(wait);
  }, 100);
})();

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
  let pending = 8;
  const settled = () => {
    if (--pending > 0) return;
    for (const box of hosts()) box.style.visibility = '';
    redraw();
  };
  /*
   * Ce que l'équipement fait en plus de ses tirs et de ses statistiques : les balles qu'il lance quand on tire,
   * les grenades de poison, ce qu'il faut porter avec (tools/build-gear-effects.js). Partagé avec la seconde mise en page.
   */
  {
    const kept = window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.sources && window.ROTMG_BUNDLE.sources.gearText;
    (kept ? Promise.resolve(JSON.parse(kept)) : fetch('assets/index/gear-effects.json').then(r => r.json()))
      .then(j => { window.RealmGearEffects = j.items || {}; }).catch(() => { window.RealmGearEffects = {}; }).finally(settled);
  }
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
  /* Les monstres qui bougent : la boucle de marche que le client leur dessine, découpée pour l'Atlas
     (tools/generate-realm-animations.py) et rangée sous leur identifiant client. */
  let moving = {};
  fetch('assets/realm-monster-animations/index.json').then(r => r.json())
    .then(j => { moving = j || {}; }).catch(() => {}).finally(settled);
  /* A picture of someone - a skin, a class, a creature - wears the one outline every page lays on a character (web/outline.js). */
  const inkOf = (r, scale) => r && (r.kind === 'skin' || r.kind === 'class' || r.kind === 'enemy') && window.RealmOutline
    ? 'filter:' + window.RealmOutline.filter(scale) + ';' : '';
  function walk(r, side) {
    if (!r || r.kind !== 'enemy') return '';
    const id = [r.clientId, r.alias, r.name].find(one => one && moving[one]);
    if (!id) return '';
    const bundled = window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.realmMonsterAnimations;
    const src = (bundled && bundled[id]) || 'assets/realm-monster-animations/' + encodeURIComponent(moving[id]);
    return '<img class="ix-art fc2-walk" src="' + esc(src) + '" alt="" style="' + inkOf(r, side / 16) + 'width:' + side + 'px;height:' + side + 'px">';
  }

  /* ---------- les statuts (tools/build-status-effects.js) ---------- */
  let statusData = null;
  {
    const kept = window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.sources && window.ROTMG_BUNDLE.sources.statusText;
    (kept ? Promise.resolve(JSON.parse(kept)) : fetch('assets/index/status-effects.json').then(r => r.json()))
      .then(j => { statusData = { sheet: j.sheet, wiki: j.wiki, byName: new Map((j.effects || []).map(e => [e.name, e])) }; })
      .catch(() => {}).finally(settled);
  }
  function statusIcon(name, side) {
    const e = statusData && statusData.byName.get(name);
    if (!e || !e.icon) return '';
    const [x, y, w, h] = e.icon, z = side / Math.max(w, h, 8);
    const url = (window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.statusSheet) || 'assets/index/status-icons.png';
    return '<span class="ix-art ix-status-art" style="width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(' + url
      + ');background-size:' + statusData.sheet.wide * z + 'px ' + statusData.sheet.tall * z + 'px;background-position:'
      + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
  }
  /* Une pastille de statut : son icône, son nom, ce qui la qualifie ; elle ouvre la fiche du statut. */
  function statusChip(name, extra) {
    const e = statusData && statusData.byName.get(name);
    return '<button type="button" class="ix-jump fc2-status is-' + (e ? e.tone : 'bad') + '" data-open="status:' + esc(name) + '"'
      + (e && (e.enemy || e.player) ? ' title="' + esc(e.enemy || e.player) + '"' : '') + '>'
      + statusIcon(name, 14) + esc(name) + (extra ? ' <small>' + esc(extra) + '</small>' : '') + '</button>';
  }
  /* Ce que dit une condition : sa durée, sa chance, sa saignée. */
  const conditionSays = c => [c.duration && Number(c.duration) < 3600 ? Number(c.duration) + ' s' : '',
    c.proc && Number(c.proc) < 1 ? Math.round(Number(c.proc) * 100) + '%' : '',
    c.bleedDamage || c.amount ? (c.bleedDamage || c.amount) + '/s' : ''].filter(Boolean).join(' · ');
  /* Une fois chaque statut, avec la plus longue durée annoncée. */
  function conditionChips(list) {
    const best = new Map();
    for (const c of list) {
      const had = best.get(c.effect);
      if (!had || Number(c.duration || 0) > Number(had.duration || 0)) best.set(c.effect, c);
    }
    return [...best.values()].map(c => statusChip(c.effect, conditionSays(c))).join('');
  }
  /*
   * Les statuts d'une fiche, hors effets de tir déjà dits sous « Shot » :
   * ce qu'une capacité ou un déclencheur inflige, ce qu'un objet confère, et
   * pour une créature ce qu'elle inflige aux joueurs et ce à quoi elle résiste.
   */
  function statusPart(r) {
    const all = r.conditions || [];
    const rows = [];
    const onEnemy = all.filter(c => c.target === 'enemy' && c.on !== 'hit');
    const self = all.filter(c => c.target === 'self');
    const party = all.filter(c => c.target === 'allies');
    const onPlayers = all.filter(c => c.target === 'player');
    if (onEnemy.length) rows.push(['Inflicts', conditionChips(onEnemy)]);
    if (self.length) rows.push(['Grants you', conditionChips(self)]);
    if (party.length) rows.push(['Grants the party', conditionChips(party)]);
    if (onPlayers.length) rows.push(['Inflicts on players', conditionChips(onPlayers)]);
    if ((r.immune || []).length) rows.push(['Immune to', r.immune.map(x => statusChip(x)).join('')]);
    return rows.length ? part('Status effects', linkRows(rows.map(([k, v]) => [k, '<span class="fc2-chips">' + v + '</span>'])), { tag: 'client' }) : '';
  }

  function art(r, side) {
    const s = index();
    if (!r || !r.art || !s || !s.sheet) return '';
    const [x, y, w, h] = r.art, z = side / Math.max(w, h);
    return '<span class="ix-art" style="' + inkOf(r, z) + 'display:inline-block;width:' + w * z + 'px;height:' + h * z
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
    // Half points too: "8.5/10" is eight and a half, not five.
    out.difficulty = diff ? Number((/(\d+(?:\.\d+)?)\s*\/\s*10/.exec(diff.textContent) || [])[1]) || 0 : 0;
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
      mid += '<div class="ln">Bonus ' + statWord(x.stat) + ': Equal to <span class="v">'
        + signed(x.pct) + '%</span> of ' + statWord(x.of) + ' Stat.</div>';
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
      const many = r.volley ? r.volley.map(n => n || 'pause').join(' / ') : r.shots || s.many || 1;
      if (r.volley || many > 1) mid += '<div class="ln">Shots: <span class="v">' + many + '</span></div>';
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
        '<span class="' + (w[k] < 0 ? 'neg' : '') + '">' + signed(w[k]) + ' ' + statWord(k) + '</span>').join('') + '</div>';
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
          .map(k => '<div>' + signed(set.steps[n][k]) + ' ' + statWord(k) + '</div>').join('') + '</div>').join('') + '</div></div>';
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
  // A third entry names a row's class: 'is-wide' for a sentence that needs the whole line.
  const factsDl = rows => rows.length ? '<dl class="ix-facts">' + rows.map(([k, v, cls]) =>
    '<div' + (cls ? ' class="' + cls + '"' : '') + '><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>' : '';
  const linkRows = rows => rows.length ? '<div class="ix-links">' + rows.map(([k, v]) =>
    '<div class="ix-link-row"><i>' + esc(k) + '</i><span>' + v + '</span></div>').join('') + '</div>' : '';
  const chip = (text, cls) => '<span class="ix-data-chip' + (cls ? ' ' + cls : '') + '">' + text + '</span>';
  const TINT = { MAXHP: '#58cfda', MAXMP: '#f4d24c', ATT: '#ca46dd', DEF: '#8b9cb3',
    SPD: '#58da6e', DEX: '#ff5f2a', VIT: '#dd0c32', WIS: '#4b9be7' };
  /* A stat named in a sentence wears its own colour, as it does everywhere else on the site. */
  const statWord = (k, text) => '<b class="fc2-statword" style="color:' + TINT[k] + '">' + (text === undefined ? STAT_NAME[k] : text) + '</b>';
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
    const head = '<div class="ix-part fc2-head">' + (walk(r, 44) || card.cell || art(r, 44))
      + '<div class="fc2-name">' + kindTag + '<h3>' + esc(card.name || r.said || r.name) + '</h3>'
      + (sub ? '<div class="fc2-sub">' + esc(sub) + '</div>' : '') + card.guardian + '</div>'
      + marks(r, r.tier !== undefined && r.kind === 'item' && !r.use ? '<b class="fc2-tier">T' + r.tier + '</b>' : '') + '</div>';
    const parts = [head];

    if (r.kind === 'enemy' && r.hp) {
      const tags = ['BOSS', 'MINIBOSS', 'GOD', 'QUEST', 'UNDEAD', 'STASISIMMUNE'].filter(x => L.includes(x)).map(x => chip(esc(x.toLowerCase()))).join('');
      parts.push(part('Combat', '<div class="fc2-dmg">' + Number(r.hp).toLocaleString('en-US') + '<small>HP</small></div>'
        + factsDl([['Defense', String(r.def || 0)]]) + (tags ? '<div class="fc2-chips">' + tags + '</div>' : '')));
    }
    if (r.kind === 'enemy' || r.kind === 'item') parts.push(statusPart(r));
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
      if (!penaltyOf(r)) parts.push(part('Full set skin', setSkin(r, true)));
      parts.push(part(penaltyOf(r) ? 'Worn together' : 'Set bonus', setTable(r)));
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
      const many = s ? (r.volley ? r.volley.map(n => n || 'pause').join(' / ') : r.shots || s.many || 1) : 1;
      if ((s && r.volley) || many > 1) rows.push(['Shots', String(many)]);
      const rate = s ? (r.rate !== undefined ? r.rate : s.rate) : undefined;
      if (rate !== undefined) rows.push(['Rate of fire', Math.round(rate * 100) + '%']);
      if (r.mp) rows.push(['MP cost', String(r.mp)]);
      /* What a stat over a floor adds to each use: the client's own figures, for the stat it names. */
      const grow = r.cast && r.cast.from !== undefined ? [
        r.cast.dmg ? '+' + r.cast.dmg + ' damage' : '',
        r.cast.more >= 0.001 ? '+' + r.cast.more + ' shot' + (r.cast.more === 1 ? '' : 's') : ''
      ].filter(Boolean) : [];
      if (grow.length) rows.push(['Scales with', statWord(r.cast.stat || 'WIS') + ' above ' + r.cast.from + ': ' + grow.join(', ') + ' per point', 'is-wide']);
      const proj = projOf(r);
      const flags = (proj && proj.shots.length ? shotBehaviour(r, proj)
        : [s && s.through && 'Hits multiple targets', s && s.pierce && 'Ignores defense'].filter(Boolean).map(x => chip(esc(x))).join(''))
        + conditionChips((r.conditions || []).filter(c => c.on === 'hit'));
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
    for (const x of r.share || []) items.push('<li><b>Bonus</b> ' + statWord(x.stat) + ' equal to ' + signed(x.pct) + '% of ' + statWord(x.of) + '</li>');
    const reEffect = String(com.facts.effect || '')
      .replace(/Shots hit multiple targets|Shots pass through obstacles|Ignores defense of target/g, '')
      .replace(new RegExp((r.conditions || []).filter(c => c.on === 'hit').map(c => c.effect + ' for ' + c.duration + ' seconds?').join('|') || '$^', 'g'), '')
      .replace(/\s+/g, ' ').trim();
    if (!(r.does || []).length && reEffect) items.push('<li>' + esc(reEffect) + ' <em>· RealmEye</em></li>');
    const effects = part('Effects', items.length ? '<ul class="ix-does">' + items.join('') + '</ul>' : '') + statusPart(r);

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
      setPart = part((penaltyOf(set) ? 'Worn together · ' : 'Set · ') + set.name, setTable(set) + setPieces(set, r, false) + setSkin(set));
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

  /*
   * A "set" whose every step takes stats away is no set: the client uses one to make
   * pieces costly to wear together (the Heirlooms). Its steps are a price, they add up,
   * and a total with the pieces' own stats would mean nothing.
   */
  const penaltyOf = set => {
    const steps = Object.values((set && set.steps) || {});
    return steps.length > 0 && steps.every(w => Object.values(w).length && Object.values(w).every(v => v < 0));
  };

  /* Les bonus du set palier par palier, puis ce que le set complet donne avec les stats de ses pièces. */
  function setTable(set) {
    const ks = Object.keys(set.steps || {});
    if (!ks.length) return '';
    const penalty = penaltyOf(set);
    const pieces = (set.pieces || []).map(n => rec('item:' + n)).filter(Boolean);
    const withPieces = !penalty && pieces.length && pieces.length <= 6;
    const total = {};
    if (withPieces) { pieces.forEach(o => addStats(total, o.worn)); ks.forEach(n => addStats(total, set.steps[n])); }
    const used = STAT_ORDER.filter(k => ks.some(n => set.steps[n][k] !== undefined) || (withPieces && total[k]));
    const cell = (k, v) => '<td style="--tint:' + TINT[k] + '">' + (v ? signed(v) : '') + '</td>';
    return '<div class="ix-realm-table"><table><thead><tr><th></th>' + used.map(k => '<th style="--tint:' + TINT[k] + '">' + STAT_SHORT_FR[k] + '</th>').join('')
      + '</tr></thead><tbody>' + ks.map(n => '<tr><td>' + (penalty ? (n === '4' ? 'Four worn' : (n === '2' ? 'Two' : 'Three') + ' worn') : n === '4' ? 'Full set' : n + ' pieces') + '</td>' + used.map(k => cell(k, set.steps[n][k])).join('') + '</tr>').join('')
      + (withPieces ? '<tr class="fc2-settotal"><td>Full set + pieces</td>' + used.map(k => cell(k, total[k])).join('') + '</tr>' : '')
      + '</tbody></table></div>'
      + (penalty ? '<p class="fc2-note">Not a bonus: wearing more than one costs these stats, and each line adds to the one above it.</p>' : '');
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
  /*
   * A sheet and its rectangles are one artifact: a rebuild repacks the sheet, and a
   * browser-cached old PNG under new coordinates draws the wrong sprite at the wrong
   * size. The rectangles are revalidated on every load and the sheet is asked for by
   * a mark of the rectangles it belongs to.
   */
  const markOf = text => {
    let h = 0;
    for (let i = 0; i < text.length; i += 5) h = (h * 31 + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + text.length.toString(36);
  };
  const marked = (url, mark) => url + (mark ? '?v=' + encodeURIComponent(mark) : '');
  let projData = null, projMark = '';
  fetch('assets/index/projectiles.json', { cache: 'no-cache' }).then(r => r.text()).then(t => { projData = JSON.parse(t); projMark = markOf(t); }).catch(() => {}).finally(settled);
  const projOf = r => projData && projData.items[r.clientId || r.name];

  /* Ce que fait le tir, dit une fois, sous l'animation. */
  function shotBehaviour(r, p) {
    const s = p.shots[0];
    const out = [];
    /* Un cycle se dit comme un cycle ; plusieurs Subattacks, par le total de ce qu'elles tirent. */
    if (r.volley) out.push('Volleys of ' + r.volley.map(n => n || 'pause').join(' / ') + ', in turn');
    else if (p.attacks && p.attacks.length > 1) {
      const total = p.attacks.reduce((sum, a) => sum + (a.many || 1), 0);
      if (total > 1) out.push(total + ' projectiles');
    } else {
      const one = (p.attacks && p.attacks[0]) || p;
      if (one.many > 1) out.push(one.many + ' projectiles' + (one.arc ? ' · ' + one.arc + '° apart' : ' in parallel'));
    }
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
      const theory = image((window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.theorySheet) || marked('assets/theory/sheet.png', index() && (index().built || (index().from && index().from.build))));
      const bolts = image(marked('assets/index/projectiles.png', projMark)), skins = image(marked('assets/skins/textures/looks.png', looks && looks.built));
      const canvas = host.querySelector('canvas'), pen = canvas.getContext('2d');
      const holder = [...recs().values()].find(c => c.kind === 'class' && (c.slots || []).includes(r.slot));
      const classPic = holder && ts.pics['c:' + holder.name];
      /* Chaque Subattack tire à sa propre cadence ; avec des motifs, chaque attaque tire le motif suivant. */
      const byPid = new Map(p.shots.map(s => [s.pid, s]));
      const specOf = pid => byPid.get(pid) || base;
      const volleys = (p.attacks && p.attacks.length ? p.attacks : [{ pid: base.pid, many: p.many, arc: p.arc, rate: p.rate }])
        .map(v => ({ ...v, cool: 0, at: 0 }));
      const gapOf = (a, v) => ((a.arc !== undefined ? a.arc : v.arc !== undefined ? v.arc : ((a.many || 1) > 1 ? 11.25 : 0)) * Math.PI / 180);
      const turnOf = (a, v) => (((a.angle !== undefined ? a.angle : v.angle) || 0) * Math.PI / 180);
      const everyOf = v => 1 / ((1.5 + 6.5 * 50 / 75) * (v.rate || p.rate || 1));
      const used = [...new Set(volleys.flatMap(v => (v.patterns || [v]).map(a => specOf(a.pid || v.pid))))]
        .filter(s => s.speed > 0 && s.life > 0);
      /* La portée de l'Index, qui suit l'accélération et le retour d'un boomerang ; le trajet brut sinon. */
      const range = Math.max(0, ...(r.fires || []).map(f => f.reach || 0))
        || Math.max(0, ...used.map(s => s.speed * s.life)) || base.speed * base.life;
      const fan = Math.max(0, ...volleys.flatMap(v => (v.patterns || [v]).map(a => (a.many || 1) * gapOf(a, v) + 2 * Math.abs(turnOf(a, v)))));
      const state = { speed: 1, withSet: false, shots: [], fired: 0, clock: 0, swing: 0, hit: 0 };
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

        const reachY = Math.max(0, ...(used.length ? used : [base]).map(s => (s.param ? s.mag : Math.abs(s.amp || 0))))
          + Math.max(0, ...volleys.map(v => Math.abs((v.offset && v.offset[0]) || 0)));

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
                  fan * range / 2
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

        /* Ce que tire l'arme : ses projectiles, ou celui que le set complet lui donne. */
        const bullet = state.withSet && setData && setData.bullet;

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
            RealmOutline.draw(pen, skins, f.x, f.y, f.w, f.h, x0 - T / 2, floor - f.h * z, f.w * z, f.h * z);
          }
        } else if (classPic && theory.complete) {
          const list = poseFrames(classPic, doing);
          const f = list[Math.floor(state.clock * 8) % list.length];
          RealmOutline.draw(pen, theory, classPic.x + f * classPic.w, classPic.y, classPic.w, classPic.h, x0 - T / 2, floor - classPic.h * T / 8, classPic.w * T / 8, classPic.h * T / 8);
        }

        for (const v of volleys) {
          v.cool -= dt;
          if (v.cool > 0) continue;
          const every = everyOf(v);
          v.cool += every; state.swing = Math.min(every, 0.25);
          const a = v.patterns ? v.patterns[v.at++ % v.patterns.length] : v;
          const spec = specOf(a.pid || v.pid);
          // Un motif qui ne tire rien (la pause de la Razorthorn) compte quand même son tour.
          if (!(spec.speed > 0 && spec.life > 0)) continue;
          const many = a.many || 1, gap = gapOf(a, v), turn = turnOf(a, v);
          const side = (v.offset && v.offset[0]) || 0;
          for (let n = 0; n < many; n++) {
            state.shots.push({ spec, side, n: state.fired++, age: 0, dist: 0, full: spec.speed * spec.life,
              angle: turn + (many > 1 ? (n - (many - 1) / 2) * gap : 0),
              phase: n % 2 ? Math.PI : 0, v: spec.speed, px: 0, py: 0 });
          }
        }
        for (let i = state.shots.length - 1; i >= 0; i--) {
          const o = state.shots[i];
          o.age += dt;
          const spec = o.spec;
          if (o.age >= spec.life) {
            state.shots.splice(i, 1); continue;
          }
          if (spec.accel && o.age * 1000 >= (spec.accelDelay || 0)) {
            // Sans plafond, un tir freiné s'arrête puis revient (la Steam Pipe).
            o.v += spec.accel / 10 * dt;
            if (spec.speedClamp) o.v = spec.accel > 0 ? Math.min(o.v, spec.speedClamp / 10) : Math.max(o.v, spec.speedClamp / 10);
          }
          o.dist += o.v * dt;
          const pic = projData.pics[bullet ? setData.bullet : spec.pic];
          if (!pic) continue;
          const size = bullet && !spec.sizeDeclared ? setData.bulletSize : spec.size;
          const tilt = pic.tilt || 0;
          const at = shotAt(spec, o);
          const heading = Math.atan2(at.y - o.py, at.x - o.px) || o.angle;
          o.px = at.x; o.py = at.y;
          const z = T / (pic.cell || 8) * (size || 100) / 100;
          const w = pic.w * z, h = pic.h * z;
          const f = pic.frames > 1 ? Math.floor(o.age * (pic.fps || 12)) % pic.frames : 0;
          pen.save();
          pen.translate(x0 + T * 0.4 + at.x * T, y0 + (at.y + o.side) * T);
          pen.rotate(heading + tilt * Math.PI / 4 + (pic.spin ? o.age * 1000 / pic.spin : 0));
          if (bolts.complete) RealmOutline.draw(pen, bolts, pic.x + f * pic.w, pic.y, pic.w, pic.h, -w / 2, -h / 2, w, h);
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
  Promise.all([fetch('assets/skins/generated/looks.json', { cache: 'no-cache' }).then(r => r.json()), fetch('assets/skins/generated/skins.json', { cache: 'no-cache' }).then(r => r.json())])
    .then(([l, s]) => { looks = l; skinTypes = new Map((s.skins || []).map(x => [x.id, x.type])); }).catch(() => {}).finally(settled);
  const skinCanvas = (skinId, big) => '<canvas class="fc2-skin' + (big ? ' is-big' : '') + '" data-skin="' + esc(skinId) + '" width="96" height="96"></canvas>';
  function bootSkins(box) {
    if (!looks) return;
    const sheet = image(marked('assets/skins/textures/looks.png', looks.built));
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
          RealmOutline.draw(
            pen,
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

  /* ---------- la fiche d'un statut ---------- */
  const MODEL_SAY = { def: 'Defence', taken: 'Damage taken', damage: 'Weapon damage', rate: 'Attack speed', bleed: 'Life lost a second',
    range: 'Shot range', speed: 'Walking speed', shots: 'Shots a volley', dealt: 'Damage dealt', hpregen: 'Life a second', mpregen: 'Magic a second' };
  const modelSays = m => (MODEL_SAY[m.what] || m.what) + (m.op === 'zero' ? ' counts as 0' : m.op === 'x' ? ' ×' + m.value : ' ' + (m.value > 0 ? '+' : '') + m.value);
  // What Theory Crafting's damage figures take into account.
  const COUNTED = new Set(['def', 'taken', 'damage', 'rate', 'bleed']);
  function sheetStatus(name) {
    const e = statusData.byName.get(name);
    const head = '<div class="ix-part fc2-head"><span class="ix-cell fc2-status-cell">' + statusIcon(name, 40) + '</span>'
      + '<div class="fc2-name"><span class="ix-kind is-status">Status effect</span><h3>' + esc(name) + '</h3>'
      + '<div class="fc2-sub">' + (e.tone === 'good' ? 'Helpful to whoever carries it' : 'Harmful to whoever carries it') + '</div></div></div>';
    // Sentences, not values: each side in a paragraph of its own.
    const what = '<div class="ix-prose">' + [e.player && ['On a player', e.player], e.enemy && ['On an enemy', e.enemy]].filter(Boolean)
      .map(([k, v]) => '<p><b>' + esc(k) + '</b> ' + esc(v) + '</p>').join('') + '</div>';
    const wiki = '<p class="fc-note"><a href="' + esc(statusData.wiki + '#' + e.anchor) + '" target="_blank" rel="noopener">RealmEye: Status Effects ↗</a></p>';
    const model = (e.model || []).length
      ? '<div class="fc2-chips">' + e.model.map(m => chip(esc(modelSays(m)))).join('') + '</div>'
        + (e.model.some(m => COUNTED.has(m.what)) ? '<p class="fc-note">Theory Crafting counts it in damage a second.</p>' : '')
      : '';
    return blockOf([head, part('What it does', what + wiki, { tag: 'RealmEye' }), part('In the numbers', model)], 'fc2-sheet');
  }
  function statusDossier(name) {
    const e = statusData.byName.get(name);
    /* Ce qui est rangé hors des catégories (les procs, les objets techniques) est compté, pas montré. */
    const list = (entries, title, max = 60) => {
      const shown = [], quiet = [];
      for (const x of entries) {
        const o = rec(typeof x === 'string' ? x : x.id);
        if (!o) continue;
        (o.hidden ? quiet : shown).push([o, typeof x === 'string' ? '' : conditionSays(x)]);
      }
      if (!shown.length && !quiet.length) return '';
      shown.sort((a, b) => (a[0].said || a[0].name).localeCompare(b[0].said || b[0].name));
      const chips = shown.slice(0, max).map(([o, say]) => '<button type="button" class="ix-jump" data-open="' + esc(o.id) + '">'
        + art(o, 14) + esc(o.said || o.name) + (say ? ' <small>' + esc(say) + '</small>' : '') + '</button>').join('');
      const more = [shown.length > max ? (shown.length - max) + ' more' : '', quiet.length ? quiet.length + ' technical' : ''].filter(Boolean).join(', ');
      return part(title + ' · ' + shown.length, '<div class="fc2-chips">' + chips + '</div>' + (more ? '<p class="fc-note">and ' + esc(more) + '</p>' : ''), { tag: 'client' });
    };
    const blocks = [
      list(e.inflicts, 'Gear that inflicts it'),
      list(e.grants, 'Gear that grants it'),
      list(e.inflictedBy, 'Creatures that inflict it', 40),
      list(e.immune, 'Creatures immune to it', 40)
    ].filter(Boolean);
    return blocks.length ? blocks.map(b => blockOf([b])).join('')
      : emptyBox('Who uses it', 'Nothing in the client declares it: the game applies it from its own code.');
  }

  /* ---------- la fiche d'un événement (tools/build-realm-events.js) ---------- */
  /* Les événements sont créés à l'exécution par la page de l'Index, comme les statuts : on les lit là, pas dans index.json. */
  const eventRec = id => { const d = typeof RealmIndex !== 'undefined' && RealmIndex.data && RealmIndex.data(); return d && d.all.get(id); };
  const initialsOf = name => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const markSay = at => at === '?' ? 'score not known' : Array.isArray(at) ? at.map(m => m + '%').join(' · ') : '';
  /* Qui sort : sa fiche quand l'Index la connaît, son nom sinon. */
  function whoIs(s, side) {
    const o = s.id && rec(s.id);
    const pic = o && art(o, side) || '<span class="fc2-mono" style="width:' + side + 'px;height:' + side + 'px">' + esc(initialsOf(s.name)) + '</span>';
    return o ? '<button type="button" class="ix-jump fc2-who" data-open="' + esc(o.id) + '">' + pic + '<b>' + esc(s.name) + '</b></button>'
      : '<span class="fc2-who">' + pic + '<b>' + esc(s.name) + '</b></span>';
  }
  /* Une ligne de la piste : qui, et les repères du score du royaume où il sort. */
  const scoreRow = (who, marks) => '<div class="fc2-score"><span class="fc2-scorewho">' + who + '</span><span class="fc2-track">'
    + marks.map(m => '<i style="--at:' + m + '%"><span>' + m + '%</span></i>').join('') + '</span></div>';
  function sheetEvent(r) {
    const e = r.event, face = r.artOf && rec(r.artOf);
    const pic = face && art(face, 40) || '<span class="fc2-mono" style="width:40px;height:40px">' + esc(initialsOf(e.name)) + '</span>';
    const head = '<div class="ix-part fc2-head"><span class="ix-cell">' + pic + '</span>'
      + '<div class="fc2-name"><span class="ix-kind is-event">Event</span><h3>' + esc(e.name) + '</h3>'
      + '<div class="fc2-sub">' + esc(e.when) + '</div></div></div>';
    const prose = '<div class="ix-prose"><p>' + esc(e.summary) + '</p></div>';
    // Everything that has marks goes on one axis, the event's own start first.
    const rows = [];
    if (e.begins !== undefined) rows.push(scoreRow('<span class="fc2-who"><b>The event begins</b></span>', [e.begins]));
    for (const s of e.spawns) if (Array.isArray(s.at)) rows.push(scoreRow(whoIs(s, 28), s.at));
    const track = rows.length
      ? '<div class="fc2-scores">' + rows.join('') + '<div class="fc2-score is-axis"><span></span><span class="fc2-axis"><span>realm score 0%</span><span>100%</span></span></div></div>'
      : '';
    const unknown = e.spawns.filter(s => s.at === '?');
    const noMark = unknown.length
      ? '<p class="fc-note">' + unknown.map(s => esc(s.name)).join(', ') + ': the score is not known yet.</p>' : '';
    return blockOf([head, part('What it is', prose), part('At what score of the realm', track + noMark, { tag: 'RealmEye' })], 'fc2-sheet');
  }
  function eventDossier(r) {
    const e = r.event;
    const lines = e.spawns.map(s => '<div class="fc2-spawn">' + whoIs(s, 32)
      + '<span class="fc2-spawnsay">' + (markSay(s.at) ? '<b>' + esc(markSay(s.at)) + '</b>' : '') + (s.where ? '<span>' + esc(s.where) + '</span>' : '')
      + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span></div>').join('');
    const waves = (e.waves || []).map(w => '<div class="fc2-wave"><h5>' + esc(w.tier) + ' biomes · wave ' + w.wave + '</h5>'
      + '<div class="fc2-chips">' + w.enemies.map(x => {
        const o = rec(x.id);
        return '<button type="button" class="ix-jump" data-open="' + esc(x.id) + '">' + (o ? art(o, 16) : '') + esc(x.name)
          + (x.hp ? ' <small>' + x.hp.toLocaleString('en-US') + ' ' + statWord('MAXHP', 'HP') + '</small>' : '') + '</button>';
      }).join('') + '</div><small>' + esc(w.terrain.join(', ')) + '</small></div>').join('');
    const sources = [...new Map([...e.sources, ...e.spawns.flatMap(s => s.sources)].map(s => [s.label, s])).values()]
      .map(s => s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + ' ↗</a>' : esc(s.label)).join(' · ');
    return [
      blockOf([part('Who comes out · ' + e.spawns.length, lines, { tag: 'RealmEye' })]),
      waves ? blockOf([part('The invasion waves', waves + '<p class="fc-note">Which aliens belong to which wave, and where, is declared by the client. How many kills each wave takes is not published.</p>', { tag: 'client' })]) : '',
      blockOf([part('Where this is written', '<p class="fc-note">' + sources + '</p><p class="fc-note">The marks are the community\'s word: the client does not state them, the server watches the realm\'s score.</p>')])
    ].filter(Boolean).join('');
  }

  /* ---------- branchement ---------- */
  const isGear = r => Boolean(r && r.kind === 'item' && !r.use && !r.family && r.slot !== undefined && r.slot !== 10);
  /* The card the site drew, per host: the Index page, and the atlas's drawer on the left of the map. */
  const HOSTS = ['ixCard', 'atlasIndexCard', 'newsIndexCard'];
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
    /* Un événement a sa propre fiche, tirée du catalogue des événements. */
    const happening = card.id.startsWith('event:') ? eventRec(card.id) : null;
    if (happening && happening.event) {
      return '<div class="fc-root fc2">' + bar + card.warns
        + '<div class="fc-cols"><div class="fc-left">' + sheetEvent(happening) + '</div>'
        + '<div class="fc-right fc2-right">' + eventDossier(happening) + '</div></div></div>';
    }
    /* Un statut a sa propre fiche, tirée du catalogue des statuts. */
    if (card.id.startsWith('status:') && statusData && statusData.byName.has(card.id.slice(7))) {
      const name = card.id.slice(7);
      return '<div class="fc-root fc2">' + bar + card.warns
        + '<div class="fc-cols"><div class="fc-left">' + sheetStatus(name) + '</div>'
        + '<div class="fc-right fc2-right">' + statusDossier(name) + '</div></div></div>';
    }
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
    if (box.id !== 'ixCard') balance(box); else fitText(box);
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
  /* "+N more" under "Where it comes from": the other source cards are already in the grid, hidden. */
  document.addEventListener('click', e => {
    const more = e.target.closest && e.target.closest('.pg-more');
    if (!more) return;
    more.parentNode.querySelectorAll('.pg-src[hidden]').forEach(c => { c.hidden = false; });
    more.remove();
  });
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

/*
 * The Index card, laid out again once fiches-c.js has drawn it.
 *
 * The site draws its card as it always has (index-page.js, then the code
 * above); this takes the finished card and lays it out in the Index's own
 * frame: who the thing is, the few figures that decide it said large and read
 * against the rest of its kind, then what there is to know about it in
 * columns that end level. The blocks the card already had (simulation, set,
 * enchantment, preview...) are moved, not redrawn, so nothing they do is lost.
 * A dungeon is drawn as the run through it, from the door to the last boss.
 */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const TINT = { MAXHP: '#58cfda', MAXMP: '#f4d24c', ATT: '#ca46dd', DEF: '#8b9cb3', SPD: '#58da6e', DEX: '#ff5f2a', VIT: '#dd0c32', WIS: '#4b9be7' };
  const STAT_SHORT = { MAXHP: 'HP', MAXMP: 'MP', ATT: 'ATT', DEF: 'DEF', SPD: 'SPD', DEX: 'DEX', VIT: 'VIT', WIS: 'WIS' };
  const STAT_ORDER = ['MAXHP', 'MAXMP', 'ATT', 'DEF', 'SPD', 'DEX', 'VIT', 'WIS'];
  const BAG_SAY = ['Brown', 'Pink', 'Purple', 'Egg', 'Cyan', 'Blue', 'White', 'Gold', 'Orange', 'Red'];

  /* ---------------- what is read ---------------- */
  let D = null, projectiles = null, forge = {}, moving = {};
  fetch('assets/index/projectiles.json').then(r => r.json()).then(j => { projectiles = j; }).catch(() => {});
  fetch('assets/index/client-forge.json').then(r => r.json()).then(j => { forge = j || {}; }).catch(() => {});
  fetch('assets/realm-monster-animations/index.json').then(r => r.json()).then(j => { moving = j || {}; }).catch(() => {});
  const rec = id => D && D.all.get(id);
  const isSomeone = r => r && (r.kind === 'skin' || r.kind === 'class' || r.kind === 'enemy');
  const extra = r => forge[r.clientId] || forge[r.name] || {};
  /*
   * A picture cut to what is drawn in it.
   *
   * A rectangle of the sheet is often far larger than its drawing - a boss
   * declared in a 32-pixel cell with a 12-pixel body - so drawn whole it is a
   * speck in the middle of its box, and drawn beside an 8-pixel creature the
   * two are nothing alike in size. The sheet's own pixels say where the
   * drawing is: it is cut to that, and grown by whole steps to fill the box.
   * A drawing that is a line or a dot (the invisible summoner the client puts
   * where a boss will appear) is no picture; the initials stand in for it.
   */
  let alpha = null;
  (async () => {
    try {
      const img = new Image();
      img.src = 'assets/index/sheet.png';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      alpha = { w: c.width, data: g.getImageData(0, 0, c.width, c.height).data };
    } catch (e) { alpha = null; }
  })();
  const drawnMemo = new Map();
  function drawnIn(rect) {
    if (!alpha) return null;
    const key = rect.join(',');
    if (drawnMemo.has(key)) return drawnMemo.get(key);
    const [x, y, w, h] = rect;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, many = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (alpha.data[((y + j) * alpha.w + x + i) * 4 + 3] < 24) continue;
      many++;
      if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
    }
    const out = x1 < 0 ? { blank: true } : { x: x + x0, y: y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    // A one-pixel line or a few dots is no picture; a small drawing (a coal, a carrot, a fragment) is.
    if (!out.blank && (out.w === 1 || out.h === 1 || many <= 4)) out.blank = true;
    drawnMemo.set(key, out);
    return out;
  }
  const initials = (r, px) => '<span class="pc-noart" style="width:' + px + 'px;height:' + px + 'px;font-size:' + Math.max(9, px * .36) + 'px">'
    + esc(String((r && r.name) || '?').split(/\s+/).filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('')) + '</span>';
  /*
   * The picture of a thing the client files under several objects. A record
   * of the Index is one name over several client objects (the boss, its
   * summoner, its anchor); the one the record happens to be headed by may be
   * the invisible summoner. The others are looked at too, and the one that is
   * really drawn - the one with the most life when several are - is the face.
   */
  let variants = null;
  // Every record by its name: a RealmEye-only record ("Prismimic (Boss)", "The Third Dimension (Original)") is drawn as the client's own of that name.
  let byName = null;
  const recNamed = name => {
    if (!byName) { byName = new Map(); for (const x of D.all.values()) { if (!x.art || x.folded) continue; const k = String(x.name).toLowerCase(); if (!byName.has(k)) byName.set(k, x); } }
    return byName.get(String(name).toLowerCase()) || null;
  };
  // "Stromwell's Rift Enemies" is RealmEye's page for the creatures of the Rift: the Rift's first portal stands for it.
  const namesake = r => {
    const seen = x => x && x !== r && x.art && drawnIn(x.art) && !drawnIn(x.art).blank;
    const base = String(r.name).replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+(Enemies|Guide|Deux)$/, '');
    if (seen(recNamed(base))) return recNamed(base);
    // A heroic or legacy copy the client draws nothing for is drawn as the dungeon it copies.
    const plainBase = base.replace(/^(Heroic|Legacy|Infernal)\s+/, '').replace(/\s+Portal$/, '');
    if (plainBase !== base && seen(recNamed(plainBase))) return recNamed(plainBase);
    for (const x of D.all.values()) if (x.kind === r.kind && seen(x) && !x.folded && String(x.name).indexOf(base + ' ') === 0) return x;
    // A portal drawn as nothing (The Inner Workings) is shown by its key.
    if (r.kind === 'portal' && seen(recNamed(base + ' Key'))) return recNamed(base + ' Key');
    // An event dungeon the client draws nothing for (Oryxmania) is shown by its first boss that is drawn.
    if (r.kind === 'portal') for (const l of (r.realmeyeArchive && r.realmeyeArchive.relations) || []) { const x = l.type === 'dungeon_boss' && l.to && D.all.get(l.to); if (seen(x)) return x; }
    // "Gumballs", "Pails": RealmEye's page for a family, drawn as the client's first one of it ("Red Gumball", "Sand Pail").
    const one = /s$/.test(base) && base.slice(0, -1);
    if (one) for (const x of D.all.values()) if (x.kind === r.kind && x.art && !x.folded && (x.name === one || String(x.name).endsWith(' ' + one))) return x;
    // A set's page ("Crystal Necromancer Set") links its pieces: the first one drawn stands for the set.
    for (const l of (r.realmeyeArchive && r.realmeyeArchive.relations) || []) { const x = l.to && /^item:/.test(l.to) && D.all.get(l.to); if (x && x.art && /Set$/.test(r.name)) return x; }
    return null;
  };
  function faceOf(r) {
    if (!r) return r;
    const own = r.art && drawnIn(r.art);
    if (own && !own.blank) return r;
    if (r.kind !== 'enemy') return namesake(r) || r;
    if (!variants) { variants = new Map(); for (const [id, x] of D.all) { const at = id.indexOf('#'); if (at > 0) { const k = id.slice(0, at); (variants.get(k) || variants.set(k, []).get(k)).push(x); } } }
    const drawn = (variants.get(r.id) || []).filter(x => x.art && drawnIn(x.art) && !drawnIn(x.art).blank).sort((a, b) => (b.hp || 0) - (a.hp || 0));
    return drawn[0] || namesake(r) || r;
  }
  const hasFace = r => { const f = faceOf(r); return Boolean(f && ((f.art && (!drawnIn(f.art) || !drawnIn(f.art).blank)) || f.icon)); };
  const lifeOf = r => r.hp || (faceOf(r) || {}).hp || 0;
  function art(r, px, cls = '') {
    if (r && D && alpha) { const f = faceOf(r); if (f !== r) r = Object.assign({}, r, { art: f.art }); }
    if (!r || !r.art || !D || !D.sheet) return r && r.icon ? '<img class="pc-art" src="' + esc(r.icon) + '" alt="" style="width:' + px + 'px;height:' + px + 'px;object-fit:contain">' : initials(r, px);
    const cut = drawnIn(r.art);
    if (cut && cut.blank) return r.icon ? '<img class="pc-art" src="' + esc(r.icon) + '" alt="" style="width:' + px + 'px;height:' + px + 'px;object-fit:contain">' : initials(r, px);
    const [x, y, w, h] = cut ? [cut.x, cut.y, cut.w, cut.h] : r.art;
    const big = Math.max(w, h);
    const z = big <= px ? Math.max(1, Math.floor(px / big)) : px / big;
    const ink = isSomeone(r) && window.RealmOutline ? 'filter:' + RealmOutline.filter(z) + ';' : '';
    return '<span class="pc-art ' + cls + '" style="' + ink + 'width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(assets/index/sheet.png);background-size:'
      + D.sheet.wide * z + 'px ' + D.sheet.tall * z + 'px;background-position:' + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
  }
  // The moving loops are kept for the small pictures; a large one is the still, cut to its drawing, which never fails to load.
  function alive(r, px) {
    const key = px <= 32 && [r.clientId, r.alias, r.name].find(k => k && moving[k]);
    if (!key) return art(r, px);
    const ink = window.RealmOutline ? 'filter:' + RealmOutline.filter(px / 16) + ';' : '';
    return '<img class="pc-art" src="assets/realm-monster-animations/' + encodeURIComponent(moving[key]) + '" alt="" style="' + ink + 'width:' + px + 'px;height:' + px + 'px;object-fit:contain" onerror="this.style.visibility=\'hidden\'">';
  }
  function statusArt(name, px) {
    const s = rec('status:' + name);
    if (!s || !s.statusArt || !D.statusSheet) return '';
    const [x, y, w, h] = s.statusArt, z = px / Math.max(w, h, 8);
    return '<span class="pc-art" style="width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(assets/index/status-icons.png);background-size:'
      + D.statusSheet.wide * z + 'px ' + D.statusSheet.tall * z + 'px;background-position:' + (-x * z) + 'px ' + (-y * z) + 'px"></span>';
  }
  const bagArt = (i, px = 24) => i >= 0 && i <= 9 ? '<span class="pc-bag" style="--i:' + i + ';--px:' + px + 'px" title="' + BAG_SAY[i] + ' bag"></span>' : '';
  function shotOf(r) {
    const it = projectiles && projectiles.items && (projectiles.items[r.clientId] || projectiles.items[r.name]);
    return it ? { many: it.many, rate: it.rate, shot: (it.shots || [])[0] || null } : null;
  }
  function shotArt(r, px) {
    const s = shotOf(r), pic = s && s.shot && projectiles.pics[s.shot.pic];
    if (!pic) return '';
    const z = Math.max(1, Math.floor(px / Math.max(pic.w, pic.h, 8)));
    return '<span class="pc-art" style="width:' + pic.w * z + 'px;height:' + pic.h * z + 'px;background-image:url(assets/index/projectiles.png);background-size:'
      + projectiles.wide * z + 'px ' + projectiles.tall * z + 'px;background-position:' + (-pic.x * z) + 'px ' + (-pic.y * z) + 'px"></span>';
  }
  const tierOf = r => {
    const L = r.labels || [];
    if (L.includes('ST')) return { say: 'ST', cls: 'st' };
    if (L.includes('UT')) return { say: 'UT', cls: 'ut' };
    if (r.tier !== undefined) return { say: 'T' + r.tier, cls: 't' };
    return { say: '', cls: 't' };
  };
  const facts = r => (r.realmeyeArchive && r.realmeyeArchive.facts) || {};
  const relations = r => (r.realmeyeArchive && r.realmeyeArchive.relations) || [];
  const n = v => Number.isInteger(v) ? v.toLocaleString('en-US') : String(+Number(v).toFixed(2));
  const slotSay = r => D && D.slots && D.slots[r.slot] ? D.slots[r.slot][0] : (r.hand || '');
  const open = (r, inner, cls = '') => '<button type="button" class="ix-jump ' + cls + '" data-open="' + esc(r.id) + '" title="' + esc(r.said || r.name) + '">' + inner + '</button>';

  /* ---------------- the card the site drew ---------------- */
  function blocksOf(root) {
    const out = new Map();
    root.querySelectorAll('.ix-block').forEach(b => {
      const t = b.querySelector('summary, h4');
      const title = t ? t.childNodes[0].textContent.trim() : '';
      if (title && !out.has(title)) out.set(title, b);
    });
    return out;
  }
  // The rows of a block: label, the records its chips open, and the words of the chips that open nothing.
  function rowsOf(block) {
    if (!block) return [];
    return [...block.querySelectorAll('.ix-link-row')].map(row => {
      const label = (row.querySelector('i') || {}).textContent || '';
      const ids = [...row.querySelectorAll('[data-open]')].map(b => b.dataset.open);
      const words = [...row.querySelectorAll('.ix-data-chip, a.ix-jump')].filter(x => !x.dataset.open).map(x => x.textContent.trim()).filter(Boolean);
      return { label: label.trim(), ids: [...new Set(ids)], words };
    });
  }
  function rowIds(root, rx) {
    const ids = [];
    root.querySelectorAll('.ix-link-row').forEach(row => {
      const l = row.querySelector('i');
      if (!l || !rx.test(l.textContent)) return;
      row.querySelectorAll('[data-open]').forEach(b => { if (!ids.includes(b.dataset.open)) ids.push(b.dataset.open); });
    });
    return ids;
  }

  /* ================================================================ *
   * Gear                                                               *
   * ================================================================ */
  /*
   * A weapon's damage a second with the stats at their cap and nothing in the
   * way: the one number that ranks weapons against each other. The client's
   * own rules - shots a second 1.5 + 6.5 x DEX/75 times the rate of fire,
   * damage x (0.5 + ATT/50) - at 75 and 75.
   */
  /*
   * The figures, done as Theory does them (weaponRate, web/theorycraft.js) at
   * 75 ATT and 75 DEX against no armour: a weapon made of several channels
   * (Damnation's ball and its two chains) fires them together, each at its
   * own rate, and their damage is added; a burst (a longbow) is counted over
   * its whole cycle, the pause included.
   */
  const AT_DEX = 1.5 + 6.5 * (75 / 75), AT_ATT = 0.5 + 75 / 50;
  const channelsOf = r => { const f = r.fires || []; const sub = f.filter(x => x.subattack); return sub.length ? sub : f.slice(0, 1); };
  const ownRate = (r, f) => f.rate === undefined ? (r.rate === undefined ? 1 : r.rate) : f.rate;
  const manyOf = (r, f, ch) => (ch.length > 1 || f.subattack ? f.many || r.many : r.many || f.many) || 1;
  function cycleOf(burst, rate) {
    if (!burst || !(burst.many > 1) || !(rate > 0)) return null;
    const wait = burst.wait + (burst.rush - burst.wait) * 1;
    return { every: Math.max(burst.many / rate, wait), shots: burst.many };
  }
  const dpsOf = r => {
    const ch = channelsOf(r);
    let dps = 0;
    for (const f of ch) {
      if (!f.high && !f.low) continue;
      const each = ((f.low + (f.high === undefined ? f.low : f.high)) / 2) * AT_ATT;
      const rate = AT_DEX * ownRate(r, f), many = manyOf(r, f, ch);
      const cycle = cycleOf(f.burst || r.burst, rate);
      dps += cycle ? each * many * cycle.shots / cycle.every : each * many * rate;
    }
    return dps;
  };
  // How many shots one press fires, and at what rate: every channel's shots, the first channel's rate.
  const shotsOf = r => { const ch = channelsOf(r); return ch.length ? ch.reduce((s, f) => s + manyOf(r, f, ch), 0) : Math.max(r.shots || 0, 1); };
  const rateOf = r => { const f = channelsOf(r)[0]; return f ? ownRate(r, f) : (parseFloat(facts(r).rate_of_fire) / 100) || 1; };
  const peersMemo = new Map();
  function peers(r) {
    if (peersMemo.has(r.slot)) return peersMemo.get(r.slot);
    const list = [...D.all.values()].filter(x => x.kind === 'item' && x.slot === r.slot && !x.hidden && !x.folded && !x.use && x.hand);
    peersMemo.set(r.slot, list);
    return list;
  }
  // Where a number stands among the same kind of item: its place, and how far along the range it is.
  function standing(r, value, of) {
    const all = peers(r).map(of).filter(v => v > 0).sort((a, b) => b - a);
    if (!all.length || !(value > 0)) return null;
    const place = all.findIndex(v => v <= value) + 1 || all.length;
    return { place, of: all.length, part: (value - all[all.length - 1]) / Math.max(1e-9, all[0] - all[all.length - 1]) };
  }
  const ordinal = k => k + ((k % 100 >= 11 && k % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th');
  const rangeWord = t => t < 4.6 ? 'close' : t < 7 ? 'mid range' : 'long range';
  function figure(label, value, sub, stand, color) {
    return '<div class="pg-fig"><span class="pg-fig-l">' + label + '</span><b' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</b>'
      + (sub ? '<span class="pg-fig-s">' + sub + '</span>' : '')
      + (stand ? '<span class="pg-rank" title="' + stand.place + ' of ' + stand.of + '"><i style="width:' + Math.round(8 + stand.part * 92) + '%"></i></span><span class="pg-fig-r">'
        + (stand.place === 1 ? 'The best of ' + stand.of : ordinal(stand.place) + ' of ' + stand.of) + '</span>' : '')
      + '</div>';
  }
  function gearFigures(r) {
    const f = (r.fires || [])[0], s = shotOf(r), kind = slotSay(r).toLowerCase() + 's';
    const out = [];
    if (r.hand === 'weapon' && f && f.high) {
      const dps = dpsOf(r);
      out.push(figure('Damage a second', n(Math.round(dps)), 'with 75 <b style="color:' + TINT.ATT + '">ATT</b> and 75 <b style="color:' + TINT.DEX + '">DEX</b>', standing(r, dps, dpsOf)));
      out.push(figure('Each shot', n(f.low) + (f.low !== f.high ? '–' + n(f.high) : ''), (shotsOf(r) > 1 ? shotsOf(r) + ' shots · ' : '1 shot · ') + Math.round(rateOf(r) * 100) + '% rate',
        standing(r, (f.low + f.high) / 2, x => { const y = (x.fires || [])[0]; return y && y.high ? (y.low + y.high) / 2 : 0; })));
      out.push(figure('Range', n(f.reach) + '<small> tiles</small>', rangeWord(f.reach), standing(r, f.reach, x => ((x.fires || [])[0] || {}).reach || 0)));
    } else if (r.hand === 'ability') {
      if (r.mp) out.push(figure('Costs', r.mp + '<small> MP</small>', r.cool ? n(r.cool) + 's cooldown' : '', null, TINT.MAXMP));
      // An ability throws what its activation says (Primal Arcana: eight), not what the projectile it names would on its own.
      // The bolts it releases when it goes off count too (Wandering Souls Spell: six).
      const own = (((window.RealmGearEffects || {})[r.name] || {}).procs || []).filter(p => p.on === 'ability' && p.kind === 'bullets').reduce((all, p) => all + p.shots * (p.proc || 1), 0);
      const thrown = ((r.cast && r.cast.shots) || shotsOf(r)) + own;
      if (f && f.high) out.push(figure('Damage', n(f.low) + (f.low !== f.high ? '–' + n(f.high) : ''),
        thrown > 1 ? thrown + ' shots · ' + n(thrown * (f.low + f.high) / 2) + ' in all' : ''));
      const heal = (r.conditions || []).find(c => c.effect === 'Healing' && c.amount);
      if (heal) out.push(figure('Heals', String(+heal.amount), 'over ' + heal.duration + 's · ' + (heal.range ? heal.range + ' tiles' : 'the party'), null, TINT.MAXHP));
    }
    const worn = r.worn || {};
    const stats = STAT_ORDER.filter(k => worn[k]);
    if (stats.length && out.length < 4) {
      out.push('<div class="pg-fig pg-stats"><span class="pg-fig-l">On equip</span><div>' + stats.map(k => '<b style="color:' + TINT[k] + '">' + (worn[k] > 0 ? '+' : '') + worn[k] + ' <small>' + STAT_SHORT[k] + '</small></b>').join('') + '</div></div>');
    }
    return out.length ? '<div class="pg-figs">' + out.join('') + '</div>' : '';
  }
  /*
   * What makes it more than its numbers, each thing said as a line with a
   * picture: an effect the client names, a status it deals or gives (its own
   * icon), the way its shot flies (a sign), the set it belongs to, and the
   * note players wrote about it.
   */
  function shotTraits(r) {
    const p = shotOf(r), sh = p && p.shot;
    if (!sh) return [];
    const out = [];
    const many = shotsOf(r), kinds = channelsOf(r).length;
    if (kinds > 1) out.push(['⋔', kinds + ' different shots together', 'each with its own damage and reach, see its simulation']);
    else if (many > 1) out.push(['⋔', many + ' shots at once', 'fanned out in front of you']);
    if (sh.pierce) out.push(['⛨', 'Ignores defense', 'every hit lands in full, whatever the armour']);
    if (sh.multi) out.push(['⇶', 'Goes through enemies', 'one shot can hit several of them']);
    if (sh.cover) out.push(['▦', 'Goes through walls', 'and through anything else in its way']);
    if (sh.boom) out.push(['↺', 'Comes back', 'like a boomerang, hitting on the way back too']);
    if (sh.amp || sh.wavy || sh.param) out.push(['∿', 'Weaves', sh.param ? 'in a figure of eight' : 'from side to side as it flies']);
    if (sh.accel) out.push([sh.accel > 0 ? '»' : '«', sh.accel > 0 ? 'Speeds up' : 'Slows down', sh.accel > 0 ? 'and reaches further than it starts' : 'and lingers where it stops']);
    return out;
  }
  /*
   * Ce que l'objet lance ou inflige en plus, dit comme RealmEye le dit : les balles qu'il tire avec l'arme, leurs
   * dégâts, ce qui les fait grandir, la défense qu'elles ignorent, et avec quoi il faut le porter.
   * Les lignes identiques sont une seule ligne : trois balles qui partent chacune à leur tour ne sont pas trois effets.
   */
  const STAT_WORD = { ATT: 'ATT', DEF: 'DEF', SPD: 'SPD', DEX: 'DEX', VIT: 'VIT', WIS: 'WIS', MAXHP: 'HP', MAXMP: 'MP' };
  const tinted = tag => '<b style="color:' + (TINT[tag] || 'inherit') + '">' + esc(STAT_WORD[tag] || tag) + '</b>';
  const WHEN = { hit: 'when a shot of yours lands', shoot: 'when you shoot', ability: 'when you use your ability', use: 'each time you use it' };
  // What an item hands out each time it goes off, or raises for a while: said with its chance, its wait and what it needs.
  function giveRows(r) {
    const mine = (window.RealmGearEffects || {})[r.name];
    if (!mine) return [];
    const needsText = needs => needs ? [
      needs.wear && needs.wear.length ? 'worn with ' + needs.wear.map(esc).join(' and ') : '',
      needs.wearAny && needs.wearAny.length ? 'worn with ' + needs.wearAny.map(esc).join(' or ') : '',
      needs.notWear && needs.notWear.length ? 'not beside ' + needs.notWear.map(esc).join(' or ') : '',
      needs.status && needs.status.length ? 'while you are ' + needs.status.map(esc).join(' and ') : '',
      needs.notStatus && needs.notStatus.length ? 'not while ' + needs.notStatus.map(esc).join(' or ') : '',
      ...(needs.other || []).map(esc)
    ].filter(Boolean).join(', ') : '';
    const often = x => (x.proc < 1 ? 'on ' + Math.round(x.proc * 100) + '% of them' : 'every time') + (x.cooldown ? ', at most every ' + x.cooldown + ' s' : '');
    const out = [];
    for (const g of mine.gains || []) out.push(['✚', 'Gives back ' + n(g.amount) + ' ' + (g.give === 'mp' ? tinted('MAXMP') : tinted('MAXHP')) + ' ' + WHEN[g.on], often(g) + (needsText(g.needs) ? ' · ' + needsText(g.needs) : '')]);
    for (const b of mine.boosts || []) out.push(['⇧', (b.amount > 0 ? 'Raises ' : 'Lowers ') + tinted(b.stat) + ' by ' + n(Math.abs(b.amount)) + ' for ' + b.duration + ' s ' + WHEN[b.on], often(b) + (needsText(b.needs) ? ' · ' + needsText(b.needs) : '')]);
    return out;
  }
  function procRows(r) {
    const mine = (window.RealmGearEffects || {})[r.name];
    if (!mine || !mine.procs) return [];
    const groups = new Map();
    for (const p of mine.procs) {
      if (r.hand === 'ability' && p.on === 'ability') continue;       // an ability's own bolts, said in its figures
      const key = JSON.stringify([p.kind, p.on, p.needs || null, p.low, p.high, p.pierce, p.by, p.from, p.per, p.total, p.impact, p.duration]);
      (groups.get(key) || groups.set(key, []).get(key)).push(p);
    }
    const out = [];
    for (const list of groups.values()) {
      const p = list[0], when = WHEN[p.on];
      const needs = p.needs || {};
      const only = [
        needs.wear && needs.wear.length ? 'worn with ' + needs.wear.map(esc).join(' and ') : '',
        needs.wearAny && needs.wearAny.length ? 'worn with ' + needs.wearAny.map(esc).join(' or ') : '',
        needs.notWear && needs.notWear.length ? 'not beside ' + needs.notWear.map(esc).join(' or ') : '',
        needs.status && needs.status.length ? 'while you are ' + needs.status.map(esc).join(' and ') : '',
        needs.notStatus && needs.notStatus.length ? 'not while ' + needs.notStatus.map(esc).join(' or ') : '',
        ...(needs.other || []).map(esc)
      ].filter(Boolean).join(', ');
      // Each entry is one bolt, with its own wait; say how often each goes.
      const kinds = new Map();
      for (const x of list) { const k = x.proc + '|' + x.cooldown; (kinds.get(k) || kinds.set(k, { x, bolts: 0 }).get(k)).bolts += x.shots; }
      const often = [...kinds.values()].map(({ x, bolts }) => (x.kind === 'poison' ? '' : (bolts === 1 ? 'one bolt ' : bolts + ' bolts '))
        + (x.proc < 1 ? 'on ' + Math.round(x.proc * 100) + '% of shots' : 'every shot') + (x.cooldown ? ', each at most every ' + x.cooldown + ' s' : '')).join('; ');
      if (p.kind === 'poison') {
        out.push(['☣', 'Throws a grenade of poison ' + when,
          n(p.total) + ' damage over ' + p.duration + ' s' + (p.impact ? ', ' + n(p.impact) + ' of it on impact' : '') + ' · ' + often + (only ? ' · ' + only : '')]);
        continue;
      }
      const count = list.reduce((all, x) => all + x.shots, 0);
      const damage = n(p.low) + (p.low !== p.high ? '–' + n(p.high) : '') + (p.per ? ' (+' + +(p.per * 1).toFixed(2) + ' per ' + tinted(p.by) + ' over ' + p.from + ')' : '');
      out.push(['⋔', 'Fires ' + (count === 1 ? 'one more bolt' : count + ' more bolts') + ' ' + when,
        'each ' + damage + (p.pierce ? ', ignoring defense' : '') + (p.reach ? ', reaching ' + p.reach + ' tiles' : '') + ' · ' + often + (only ? ' · ' + only : '')]);
    }
    return out;
  }
  function gearSpecial(r, root, blocks) {
    const rows = [];
    const row = (pic, title, text, cls = '') => rows.push('<li class="pg-row ' + cls + '"><span class="pg-ico">' + pic + '</span><div><b>' + title + '</b>' + (text ? '<span>' + text + '</span>' : '') + '</div></li>');
    for (const d of r.does || []) row('✦', esc(d[0]), d[1] ? esc(d[1]) : '');
    const seen = new Set();
    for (const c of r.conditions || []) {
      if (!c.effect || c.effect === 'Healing' || seen.has(c.effect)) continue;
      seen.add(c.effect);
      const verb = c.target === 'enemy' ? 'Inflicts' : 'Gives';
      const who = c.target === 'enemy' ? (c.on === 'hit' ? 'to what it hits' : 'to enemies around') : c.target === 'self' ? 'to you' : c.target === 'allies' ? 'to the party' : '';
      row(statusArt(c.effect, 28) || '✦', verb + ' ' + esc(c.effect), [who, c.duration ? 'for ' + c.duration + ' seconds' : ''].filter(Boolean).join(' '), 'is-status');
    }
    for (const [sign, title, text] of procRows(r).concat(giveRows(r))) row(sign, title, text, 'is-proc');
    const fx = (window.RealmGearEffects || {})[r.name] || {};
    // What an ability deals besides bolts (tools/build-gear-effects.js): said as RealmEye says it, per part.
    for (const a of fx.ability || []) {
      const dmg = n(a.low) + (a.high !== a.low ? '–' + n(a.high) : '') + (a.per ? ' (+' + +a.per.toFixed(3) + ' per ' + tinted(a.by) + ' over ' + a.from + ')' : '');
      const more = {
        lightning: 'on the first target' + (a.falls ? ', ' + n(a.falls) + ' less for each one after it' : '') + (a.targets ? ', up to ' + a.targets + ' targets' : ''),
        shockblast: (a.count > 1 ? a.count + ' times, ' : '') + 'around the first target' + (a.pierce ? ', ignoring defense' : ''),
        trap: 'when an enemy steps on it', bomb: 'a sticky bomb on what sets it off',
        impact: 'where the grenade lands', poison: 'over ' + a.duration + ' s, ignoring defense',
        nova: 'explodes ' + (a.count || 1) + (a.count > 1 ? ' times, each' : ' time') + ' around you',
        raise: (a.count > 1 ? 'each of the ' + a.count + ' it raises shoots' : 'the one it raises shoots') + (a.pierce ? ' ignoring defense' : '') + (a.leech ? ', stealing ' + Math.round(a.leech * 100) + '% of what it deals' : '') + ' · how often it shoots and how long it stays is up to the game server',
        creep: 'a summoned creature that shoots for ' + a.life + ' s, costing ' + a.cost + ' summon points' + (a.pierce ? ', ignoring defense' : ''),
        blast: (a.radius ? 'within ' + a.radius + ' tiles' : '') + (a.heal ? ', healing you ' + a.heal : '') + (a.ignores ? ', ignoring ' + a.ignores + ' defense' : '') + (a.meter ? ' · only with its meter full (' + n(a.meter) + ')' : ''),
        hex: 'when it goes off, plus ' + a.stack + ' (+' + a.stackPer + ' per ' + tinted(a.by) + ') and ' + +(a.share * 100).toFixed(2) + '% more for each Hex on the enemy · radius ' + a.radius,
        heal: 'to you'
      }[a.kind] || '';
      const title = { lightning: 'Lightning', shockblast: 'Shockblast', trap: 'Trap', bomb: 'Sticky bomb', impact: 'Poison impact', poison: 'Poison', nova: 'Damage nova', raise: 'Raises the dead:', creep: 'Summons:', blast: 'Vampire blast', hex: 'Hex blast', heal: 'Heals' }[a.kind];
      if (title) row('ϟ', title + ' ' + dmg, more, 'is-proc');
    }
    if (fx.combat) row('⚔', 'In combat it costs you', Object.entries(fx.combat).map(([s, v]) => tinted(s) + ' ' + (v < 0 ? '−' : '+') + Math.abs(v)).join(', ') + ' · while you are in combat, so every fight is fought with it', 'is-proc');
    if (fx.thrown) row('✧', 'Held, then thrown', (fx.thrown.held ? n(fx.thrown.held) + ' ' + tinted('MAXMP') + ' a second while you hold it, and ' : '') + n(fx.thrown.end) + ' ' + tinted('MAXMP') + ' when you let go · the quickest throw costs only the last, so that is how often the damage here can come', 'is-proc');
    if (fx.cost) row('✧', fx.cost < 1 ? 'Abilities cost less magic' : 'Abilities cost more magic', Math.round(Math.abs(1 - fx.cost) * 100) + '% ' + (fx.cost < 1 ? 'less' : 'more') + ' of the ' + tinted('MAXMP') + ' an ability costs, each use, while worn', 'is-proc');
    if (!rows.length && facts(r).effect_s) row('✦', esc(facts(r).effect_s), '');
    for (const [sign, title, text] of shotTraits(r)) row(sign, title, text, 'is-shot');
    const note = blocks.get('Notes');
    const said = note ? (note.querySelector('.ix-prose, p') || note).textContent.replace(/^\s*Notes\s*RealmEye\s*/, '').trim() : '';
    const set = r.set && rec('set:' + r.set);
    if (set) row(art(set, 28), 'Part of the ' + esc(set.name), 'the full set changes its shot and adds to your stats', 'is-set');
    if (!rows.length && !said) return '';
    return '<section class="pg-sec pg-special">' + (rows.length ? '<ul class="pg-rows">' + rows.join('') + '</ul>' : '')
      + (said && !/^Part of the .* Set\.?$/.test(said) ? '<blockquote class="pg-note">' + esc(said) + '<cite>RealmEye</cite></blockquote>' : '') + '</section>';
  }
  /*
   * Where it comes from, read from RealmEye's own links rather than from the
   * card's chips: who drops it and where they live, what it is bought or
   * opened from, and its blueprint apart. Each source a card with its picture.
   */
  const pretty = slug => String(slug).replace(/^[a-z]+:/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  let portalByName = null;
  // A dungeon whose bosses come from more than three of the client's files borrows them from elsewhere.
  const gatherMemo = new Map();
  const gathers = p => {
    if (gatherMemo.has(p.id)) return gatherMemo.get(p.id);
    const files = new Set();
    for (const x of relations(p)) if (/^dungeon_(boss|miniboss|treasure)/.test(x.type) && x.to && rec(x.to) && rec(x.to).from) files.add(rec(x.to).from[0]);
    gatherMemo.set(p.id, files.size > 3);
    return files.size > 3;
  };
  function homeOf(enemy) {
    const lives = D.archive && D.archive() && D.archive().livesIn;
    const at = lives && lives.get(enemy.id);
    const places = at ? [...at].map(rec).filter(Boolean) : [];
    if (places.length) {
      const score = p => (p.kind === 'portal' ? 0 : 4) + (gathers(p) ? 2 : 0) + (/^Legacy /.test(p.name) ? 1 : 0);
      return places.slice().sort((a, b) => score(a) - score(b))[0];
    }
    // RealmEye's sidebar says it in words ("… EXP: 4,000 Location: Lost Halls") when no link does.
    const said = (Object.values(facts(enemy)).filter(v => typeof v === 'string').join(' ').split('Location: ')[1] || '').split(' ');
    // The words after it run on into the next field: the longest run that names a dungeon is the place.
    for (let k = Math.min(said.length, 8); k > 0; k--) {
      const name = said.slice(0, k).join(' ').replace(/[.,;]$/, '');
      if (!portalByName) { portalByName = new Map(); for (const x of D.all.values()) if (x.kind === 'portal' && !x.folded && !portalByName.has(x.name)) portalByName.set(x.name, x); }
      if (portalByName.has(name)) return portalByName.get(name);
    }
    return null;
  }
  const STANDS = [
    [/experience|fame/i, 'item:XP Booster', 'earned by playing'],
    [/^shop$/i, 'item:Realm Gold', 'bought with Realm Gold'],
    [/crucible/i, 'item:Crucible Mystery Chest', 'a reward of the Crucible'],
    [/mystery box/i, 'item:Wooden Zodiac Mystery Chest', 'from the shop’s mystery boxes'],
    [/tinkerer/i, 'item:Cured Tinkerer Pet Skin', 'a reward for his quests in the Nexus'],
    [/^forge$/i, 'item:Forge Chest Unlocker', 'made at the Forge'],
    [/exaltation/i, 'item:Exaltation Banner of Attack', 'a reward for exalting a class'],
  ];
  function gearSource(r) {
    const rel = relations(r), f = facts(r), cx = extra(r);
    const cards = [], blue = [];
    const card = (into, pic, title, sub, id) => into.push((id ? '<button type="button" class="ix-jump pg-src" data-open="' + esc(id) + '">' : '<div class="pg-src is-plain">')
      + '<span class="pg-src-pic">' + pic + '</span><span class="pg-src-t"><b>' + title + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + (id ? '</button>' : '</div>'));
    const seenNames = new Set();
    const places = new Map();
    for (const x of rel) {
      const blueprint = x.type.startsWith('blueprint_');
      const kind = x.type.replace(/^blueprint_/, '');
      if (kind !== 'dropped_by' && kind !== 'obtained_through') continue;
      const into = blueprint ? blue : cards;
      const o = x.to && rec(x.to);
      if (o) {
        const base = String(o.name).replace(/^Heroic /, '');
        if (seenNames.has(base + blueprint)) continue;
        seenNames.add(base + blueprint);
        if (o.kind === 'enemy') {
          // Gathered by the place they live in: a player farms a dungeon, not a creature.
          const home = homeOf(o), key = (home ? home.id : o.id) + '|' + blueprint;
          const at = places.get(key) || places.set(key, { home, into, who: [] }).get(key);
          at.who.push(o);
        } else if (o.kind === 'portal' && /Nexus/.test(o.name) && f.obtained_through) {
          // "Nexus Portal" stands for the Nexus's shop: RealmEye's sentence says what is bought there.
          const box = [...D.all.values()].find(it => it.kind === 'item' && f.obtained_through.indexOf(it.name) === 0);
          if (box) card(into, art(box, 40), esc(box.name), 'bought in the Nexus, it can hold this', box.id);
          else card(into, art(o, 40), 'The Nexus', esc(f.obtained_through), o.id);
        } else card(into, art(o, 40), esc(o.said || o.name), kind === 'dropped_by' ? 'drops it' : 'gives it', o.id);
      } else if (x.toRealmEye && recNamed(pretty(x.toRealmEye))) {
        // A page RealmEye links by name only: the client's own record of that name, with its picture.
        const o2 = recNamed(pretty(x.toRealmEye));
        if (seenNames.has(o2.name + blueprint)) continue;
        seenNames.add(o2.name + blueprint);
        card(into, art(o2, 40), esc(o2.said || o2.name), /chest/i.test(o2.name) ? 'a reward chest that can hold it' : kind === 'dropped_by' ? 'drops it' : 'gives it', o2.id);
      } else if (x.toRealmEye) {
        const word = pretty(x.toRealmEye);
        if (seenNames.has(word + blueprint)) continue;
        seenNames.add(word + blueprint);
        // A part of the game rather than a thing in it: the client's own picture that players know it by.
        const said = STANDS.find(([rx]) => rx.test(word));
        const stand = said && rec(said[1]);
        card(into, stand ? art(stand, 40) : '<span class="pg-src-glyph">' + (/chest/i.test(word) ? '▣' : '✦') + '</span>', esc(word.replace(/ And /, ' and ')), stand ? said[2] : /chest/i.test(word) ? 'a reward chest' : '', null);
      }
    }
    for (const { home, into, who } of places.values()) {
      const names = who.map(e => e.name);
      const sub = '<span class="pg-src-who">' + who.filter(hasFace).slice(0, 4).map(e => alive(e, 20)).join('') + '</span>' + esc(names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : ''));
      if (home) card(into, art(home, 40), esc(home.said || home.name), sub, home.id);
      else card(into, alive(who[0], 40), esc(who[0].name), 'drops it', who[0].id);
    }
    // Places first, the creatures with no known home after, chests last.
    if (!cards.length) return '';
    const MAX = 8, more = cards.length - MAX;
    const bagName = cx.bag === undefined ? '' : BAG_SAY[cx.bag] === 'Egg' ? 'an egg basket' : ('a' + (/^[AEIOU]/.test(BAG_SAY[cx.bag]) ? 'n ' : ' ') + BAG_SAY[cx.bag].toLowerCase() + ' bag');
    return '<section class="pg-sec pg-source"><h3>Where it comes from</h3>'
      + (bagName ? '<p class="pg-bagsay">' + bagArt(cx.bag, 32) + '<span>Drops in <b>' + bagName + '</b></span></p>' : '')
      + '<div class="pg-srcs">' + cards.slice(0, MAX).join('')
      + cards.slice(MAX).map(c => c.replace(/^<(button|div) /, '<$1 hidden ')).join('')
      + (more > 0 ? '<button type="button" class="pg-src is-more pg-more">+' + more + ' more</button>' : '') + '</div>'
      + '</section>';
  }
  /* The rest of what the client says about it, each a figure of its own at a size that can be read. */
  const DUST_TINT = { red: '#ff6b6b', blue: '#6aa8ff', green: '#6ee07a', purple: '#c084ff' };
  /*
   * What it is worth and what can be done with it, said as the game shows it
   * rather than as a list: its worth on one line of figures, the forge as a
   * recipe (what goes in, what comes out), the enchanting as its slots.
   */
  function gearCraft(r, root, ench) {
    const cx = extra(r), parts = [];
    const fig = (value, label, tint) => '<span class="pc-fig"><b' + (tint ? ' style="color:' + tint + '"' : '') + '>' + value + '</b><small>' + label + '</small></span>';
    const figs = [fig(r.sb ? 'Soulbound' : 'Tradeable', r.sb ? 'stays with the character' : 'can be traded')];
    if (cx.feed) figs.push(fig(n(cx.feed), 'feed power'));
    if (cx.xp) figs.push(fig('+' + cx.xp + '%', 'XP while worn'));
    if (cx.power !== undefined) figs.push(fig(String(cx.power), 'power level'));
    parts.push('<div class="pc-figs">' + figs.join('') + '</div>');
    // The forge, read from the site's own rows.
    const rows = new Map();
    const links = root.querySelector('.fc2-forge .ix-links');
    if (links) links.querySelectorAll('.ix-link-row').forEach(row => { const l = row.querySelector('i'), v = row.querySelector('span'); if (l && v) rows.set(l.textContent.trim().toLowerCase(), v); });
    const pick = rx => { for (const [k, v] of rows) if (rx.test(k)) return v; return null; };
    const mats = v => [...v.querySelectorAll('.fc2-matchip')].map(c => '<span class="pc-mat" title="' + esc(c.title || '') + '">' + c.innerHTML + '</span>').join('');
    const thing = (id, px = 36) => { const x = rec(id); return x ? open(x, '<span class="pc-thing-pic">' + art(x, px) + '</span>', 'pc-thing') : ''; };
    const plus = '<i class="pc-op">+</i>', gives = '<i class="pc-op">→</i>';
    const cost = pick(/forging cost/), fam = pick(/sacrific/), dis = pick(/dismantl/);
    const recipes = [];
    if (cost) {
      const bp = [...cost.querySelectorAll('.ix-jump[data-open]')].map(b => thing(b.dataset.open)).join('');
      recipes.push('<div class="pc-recipe"><span class="pc-recipe-say">Forged from</span><div class="pc-recipe-line">' + mats(cost) + (bp ? '<span class="pc-keep">' + plus + bp + '</span>' : '') + '<span class="pc-keep">' + gives + thing(r.id, 40) + '</span></div></div>');
    }
    if (fam) {
      const many = (/(\d+)/.exec([...rows.keys()].find(k => /sacrific/.test(k)) || '') || [])[1] || '2';
      const kin = [...fam.querySelectorAll('.ix-jump[data-open]')].filter(b => b.dataset.open !== r.id).map(b => thing(b.dataset.open, 32)).join('');
      recipes.push('<div class="pc-recipe"><span class="pc-recipe-say">or by sacrificing ' + many + ' of its family</span><div class="pc-recipe-line is-kin">' + kin + '</div></div>');
    }
    if (dis) recipes.push('<div class="pc-recipe"><span class="pc-recipe-say">Dismantled</span><div class="pc-recipe-line">' + '<span class="pc-keep">' + thing(r.id, 40) + gives + '</span>' + mats(dis) + '</div></div>');
    if (recipes.length) parts.push('<div class="pc-forge"><h4 class="pc-h">At the forge</h4>' + recipes.join('') + '</div>');
    // The enchanting, read from the site's block: a slot drawn for each, with what it costs.
    if (ench) {
      const er = new Map();
      ench.querySelectorAll('.ix-link-row').forEach(row => { const l = row.querySelector('i'), v = row.querySelector('span'); if (l && v) er.set(l.textContent.trim().toLowerCase(), v); });
      const status = er.get('status'), dust = er.get('dust per slot');
      const slots = +((/(\d+) slots/.exec(status ? status.textContent : '') || [])[1] || 0);
      const costs = dust ? [...dust.querySelectorAll('.fc2-matchip')] : [];
      let h = '<div class="pc-ench"><h4 class="pc-h">Enchanting</h4>';
      if (slots) h += '<div class="pc-slots">' + Array.from({ length: slots }, (_, i) => '<span class="pc-slot">' + (costs[i] ? '<span class="pc-mat">' + costs[i].innerHTML + '</span>' : '') + '<i>slot ' + (i + 1) + '</i></span>').join('') + '</div>';
      else if (status) h += '<p class="pc-line">' + esc(status.textContent.trim()) + '</p>';
      const line = (key, say) => { const v = er.get(key); return v ? '<p class="pc-line"><span>' + say + '</span>' + v.innerHTML + '</p>' : ''; };
      h += line('rolls from', 'Rolls from') + line('can awaken', 'Can awaken') + '</div>';
      parts.push(h);
    }
    return '<section class="pg-sec pc-craft">' + parts.join('') + '</section>';
  }
  /* ---------------- the three gear cards ---------------- */
  function gearHero(r, root, compact) {
    const t = tierOf(r), f = facts(r);
    const set = r.set && rec('set:' + r.set);
    const classes = [...D.all.values()].filter(c => c.kind === 'class' && (c.slots || []).includes(r.slot));
    const prose = root.querySelector('.fc2-sheet .ix-prose');
    const shot = shotArt(r, compact ? 32 : 40);
    return '<header class="pg-hero' + (compact ? ' is-compact' : '') + '">'
      + '<div class="pg-stage">' + art(r, compact ? 64 : 96) + (shot ? '<span class="pg-shot" title="Its shot">' + shot + '</span>' : '') + '</div>'
      + '<div class="pg-id"><p class="pg-eyebrow"><span>' + esc(slotSay(r)) + '</span>' + (t.say ? '<span class="pg-tier is-' + t.cls + '">' + esc(f.tier || t.say) + '</span>' : '') + '</p>'
      + '<h2 class="pg-name is-' + t.cls + '">' + esc(r.said || r.name) + '</h2>'
      + '<div class="pg-who">' + classes.map(c => open(c, art(c, 24), 'pg-class')).join('')
      + (set ? open(set, art(set, 20) + '<span>' + esc(set.name) + '</span>', 'pg-set') : '') + '</div>'
      + (prose && !compact ? '<p class="pg-desc">' + esc(prose.textContent) + '</p>' : '') + '</div></header>';
  }
  // The site's own blocks, the ones a reader opens first first, an empty one ("Not part of a set") left out.
  function siteBlocks(blocks) {
    const ORDER = ['Simulation', 'Set', 'Enchantment', 'Variants', 'Other data', 'Tags'];
    const weight = b => { const t = (b.querySelector('summary, h4') || {}).textContent || ''; const k = ORDER.findIndex(o => t.trim().startsWith(o)); return k < 0 ? 9 : k; };
    return [...blocks].filter(([title, b]) => !b.classList.contains('fc2-sheet') && !b.classList.contains('fc2-empty') && !/Not part of a set/.test(b.textContent)
      && !['Where to get it', 'Effects', 'Notes'].includes(title)).map(([, b]) => b).sort((a, b) => weight(a) - weight(b));
  }
  const blockTitled = (list, rx) => list.find(b => rx.test(((b.querySelector('summary, h4') || {}).textContent || '').trim()));

  /* What is under the head and its figures: the simulation, what makes it special, where it comes from, what it is worth. */
  function lowerParts(r, root, blocks) {
    const list = siteBlocks(blocks);
    const take = rx => { const b = blockTitled(list, rx); if (b) list.splice(list.indexOf(b), 1); return b; };
    const sim = take(/^Simulation/), set = take(/^Set/), ench = take(/^Enchantment/);
    const special = gearSpecial(r, root, blocks), source = gearSource(r);
    return { sim, set, ench, rest: list, special, source, craft: gearCraft(r, root, ench) };
  }
  // A section's own heading is said by the tab or the question that holds it.
  const bare = html => html.replace(/<h3>[\s\S]*?<\/h3>/, '');
  const node = html => { const b = document.createElement('div'); b.className = 'pq-body'; b.innerHTML = html; return b; };

  function lowerColumns(host, p) {
    const parts = [p.sim, p.source && node(p.source).firstElementChild, p.special && node(p.special).firstElementChild, p.craft && node(p.craft).firstElementChild, p.set];
    host.appendChild(columnsOf(parts));
    if (p.rest.length) {
      const more = document.createElement('details'); more.className = 'pg-sec pk-more';
      more.innerHTML = '<summary>More about it</summary>';
      p.rest.forEach(b => more.appendChild(b));
      host.appendChild(more);
    }
  }
  // The parts of a card's lower half, waiting in the first column until the card is on the page and they can be measured (balanceColumns).
  function columnsOf(parts) {
    const grid = document.createElement('div'); grid.className = 'pk-grid';
    for (let i = 0; i < 3; i++) { const col = document.createElement('div'); col.className = 'pk-col'; grid.appendChild(col); }
    parts.filter(Boolean).forEach(x => { x.dataset.pk = ''; grid.firstElementChild.appendChild(x); });
    return grid;
  }
  /*
   * Columns that end level: two in a half window, three when the card has the
   * whole screen. Every part is measured at a column's width, then laid out the
   * way whose tallest column is the shortest, keeping their order within each
   * column; the first part (the simulation, the combat) opens the first column.
   * Columns left empty are not drawn, so a card with little to say is narrower.
   */
  function balanceColumns(card) {
    for (const grid of card.querySelectorAll('.pk-grid')) {
      const cols = [...grid.children];
      const parts = [...grid.querySelectorAll('[data-pk]')];
      cols.forEach(c => { c.hidden = false; });
      grid.style.removeProperty('grid-template-columns');
      const many = Math.min(getComputedStyle(grid).gridTemplateColumns.split(' ').length, 3, parts.length);
      if (many < 2) { parts.forEach(x => cols[0].appendChild(x)); cols.slice(1).forEach(c => { c.hidden = true; }); grid.style.gridTemplateColumns = 'minmax(0, 1fr)'; continue; }
      parts.forEach(x => cols[0].appendChild(x));
      const tall = parts.map(x => x.offsetHeight + 12);
      let best = null;
      const ways = Math.pow(many, parts.length);
      for (let w = 0; w < ways; w++) {
        let rest = w; const into = [], sums = new Array(many).fill(0);
        for (let i = 0; i < parts.length; i++) { into.push(rest % many); rest = Math.floor(rest / many); }
        if (into[0] !== 0) continue;
        into.forEach((c, i) => { sums[c] += tall[i]; });
        if (sums.some(x => !x)) continue;
        const score = Math.max(...sums) * 1000 + (Math.max(...sums) - Math.min(...sums));
        if (!best || score < best.score) best = { into, score };
      }
      if (!best) best = { into: parts.map(() => 0) };
      parts.forEach((x, i) => cols[best.into[i]].appendChild(x));
      const used = cols.filter(c => c.children.length).length;
      cols.forEach(c => { c.hidden = !c.children.length; });
      grid.style.gridTemplateColumns = 'repeat(' + used + ', minmax(0, 1fr))';
    }
  }

  function gear(root, r) {
    const blocks = blocksOf(root);
    const host = document.createElement('div');
    host.innerHTML = '<div class="pc pg pg-columns">' + gearHero(r, root) + gearFigures(r) + '<div data-pclow class="pg-low"></div></div>';
    lowerColumns(host.querySelector('[data-pclow]'), lowerParts(r, root, blocks));
    const card = host.firstElementChild;
    root.querySelector('.fc-cols').replaceWith(card);
    requestAnimationFrame(() => balanceColumns(card));
  }

  /* ================================================================ *
   * Dungeons                                                           *
   * ================================================================ */
  const ROLE = { dungeon_boss: 'Boss', dungeon_miniboss: 'Miniboss', dungeon_treasure_boss: 'Treasure room', dungeon_enemy: 'Enemy', dungeon_boss_minion: 'Minion', dungeon_minion: 'Minion', dungeon_hazard: 'Hazard' };
  const everywhere = it => relations(it).filter(x => x.type === 'dropped_by' && /^enemy:/.test(x.to || '')).length >= 15;
  const notable = it => { if (everywhere(it)) return false; const L = it.labels || []; return (it.hand && (L.includes('UT') || L.includes('ST'))) || /Engraving/i.test(it.name) || L.includes('ENGRAVING') || L.includes('FORGESTORE') || ['mark', 'shard', 'artifact'].includes(it.family); };
  function dungeonData(r, root) {
    const rel = relations(r);
    const roster = new Map();
    for (const x of rel) if (ROLE[x.type] && x.to && rec(x.to) && !/^Test |\((Rehearsal|Test)\)$/.test(rec(x.to).name) && !roster.has(x.to)) roster.set(x.to, ROLE[x.type]);
    const interest = rel.filter(x => x.type === 'dungeon_drop_interest' && x.to && rec(x.to)).map(x => rec(x.to));
    const givers = new Map();
    for (const it of D.all.values()) {
      if (it.kind !== 'item') continue;
      for (const x of relations(it)) if (x.type === 'dropped_by' && x.to && roster.has(x.to)) (givers.get(it.id) || givers.set(it.id, []).get(it.id)).push(x.to);
    }
    // Rehearsal copies are the same thing again for the test server: shown once, as the real one.
    // "Marks", "Themed Sets", "Mystery Items" are RealmEye's pages about a kind of thing, not things that drop; their own pieces are listed.
    const family = it => !it.art && /^(Marks|Themed Sets|Mystery Items)$/.test(it.name);
    const items = [...new Map([...interest, ...[...givers.keys()].map(rec)].filter(it => it && !it.hidden && !family(it) && !/\((Rehearsal|Test)\)$/.test(it.name)).map(it => [it.id, it])).values()];
    const doors = rowIds(root, /Dropped by/i).map(rec).filter(Boolean);
    const esc2 = String(r.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const key = [...D.all.values()].find(it => it.kind === 'item' && new RegExp('^' + esc2 + ' Key$', 'i').test(it.name));
    const byGiver = new Map();
    for (const it of items) for (const g of givers.get(it.id) || []) (byGiver.get(g) || byGiver.set(g, []).get(g)).push(it);
    /*
     * Who drops a thing RealmEye lists here without linking its dropper to the dungeon. The client
     * keeps a dungeon's creatures together in one of its files (the Shatters' Pyro Warlock beside its
     * Forgotten King): a dropper from the file of this dungeon's bosses lives here, unless RealmEye
     * places it in another dungeon (Esben the Neurotic shares the Ice Cave's file but lives in the Ice
     * Citadel). A dungeon whose bosses come from many files (the Trials of Cronus borrows them) is
     * not judged by file. RealmEye's own words ("Location: Lost Halls") count as well.
     */
    const marks = new Set([...D.all.values()].filter(x => x.kind === 'item' && x.family === 'mark').flatMap(x => relations(x).filter(l => l.type === 'dropped_by' && l.to).map(l => l.to)));
    // One that gives a Mark is a boss, one that drops an untiered item a miniboss (the Interregnum's four), the rest the crowd.
    const roleFound = (e, it, how) => marks.has(e.id) ? 'Boss' : how === 'dropped_by' && notable(it) && tierOf(it).cls === 'ut' ? 'Miniboss' : 'Enemy';
    const found = new Set();
    const files = new Set();
    for (const [id, role] of roster) { const e = rec(id); if (e && e.from && role !== 'Enemy' && role !== 'Minion' && role !== 'Hazard') files.add(e.from[0]); }
    const byFile = files.size > 0 && files.size <= 3;
    const plain = n => String(n).replace(/^Legacy\s+/i, '').replace(/\s+Portal$/, '').replace(/\s*\([^)]*\)$/, '').trim();
    const livesHere = e => {
      if (roster.has(e.id)) return true;
      const home = homeOf(e);
      if (home) return home.id === r.id || plain(home.name) === plain(r.name);
      return byFile ? Boolean(e.from && files.has(e.from[0])) : true;
    };
    for (const it of items) {
      if (givers.has(it.id)) continue;
      for (const x of relations(it)) {
        const e = (x.type === 'dropped_by' || x.type === 'obtained_through') && x.to && rec(x.to);
        if (!e || e.kind !== 'enemy' || !livesHere(e)) continue;
        const role = roleFound(e, it, x.type);
        if (!roster.has(e.id)) { roster.set(e.id, role); found.add(e.id); }
        else if (found.has(e.id) && rank[role] < rank[roster.get(e.id)]) roster.set(e.id, role);
        (givers.get(it.id) || givers.set(it.id, []).get(it.id)).push(e.id);
        (byGiver.get(e.id) || byGiver.set(e.id, []).get(e.id)).push(it);
      }
    }
    const loose = items.filter(it => !givers.has(it.id));
    return { r, roster, items, givers, byGiver, loose, doors, key, diff: D.difficulty ? D.difficulty(r) : 0 };
  }
  const roleOf = (d, id) => d.roster.get(id) || '';
  const rank = { Boss: 0, 'Treasure room': 1, Miniboss: 2, Enemy: 3, Minion: 4, Hazard: 5 };
  // RealmEye's summary starts with the page's sidebar (version, music, dust drops): the prose begins where the dungeon is named in a sentence.
  const desc = (root, r) => {
    const p = root.querySelector('.ix-prose');
    if (!p) return '';
    const text = p.textContent, name = String(r.name);
    const at = [name + ' is ', name + ' was ', name + ' are '].map(x => text.indexOf(x)).filter(i => i >= 0).sort((a, b) => a - b)[0];
    const from = at === undefined ? 0 : (text.slice(Math.max(0, at - 4), at) === 'The ' ? at - 4 : at);
    return text.slice(from).trim();
  };
  function doorsHtml(d, px = 40) {
    const list = d.doors.map(x => open(x, alive(x, px) + '<span><b>' + esc(x.said || x.name) + '</b><small>drops the portal</small></span>', 'pd-door'));
    if (d.key) list.push(open(d.key, art(d.key, px) + '<span><b>' + esc(d.key.name) + '</b><small>opens it from the Nexus</small></span>', 'pd-door'));
    return list.length ? list.join('') : '<span class="pd-none">Nobody is written down as dropping it.</span>';
  }

  /*
   * The run, from the door to the last boss.
   *
   * One line down the card, a stop for each part of the dungeon a player
   * actually goes through: how to get in, the creatures on the way (who they
   * are, what they drop), each miniboss, the treasure room, the boss. A stop
   * shows who is there, large and moving, with its life and armour, and what it
   * drops worth the trip as pictures with their names, so the card reads as
   * "what do I get for going". What nobody comes for is at the end, folded.
   */
  const itemTile = (it, px = 48, from = '') => {
    const t = tierOf(it);
    return open(it, '<span class="pd-tile-pic is-' + t.cls + '">' + art(it, px) + (t.cls !== 't' ? '<i class="pd-t is-' + t.cls + '">' + t.say + '</i>' : '') + '</span><span class="pd-tile-name">' + esc(it.said || it.name) + '</span>' + (from ? '<small class="pd-tile-from">' + from + '</small>' : ''), 'pd-tile');
  };
  const vitals = e => (lifeOf(e) ? '<span class="pd-vital"><b style="color:' + TINT.MAXHP + '">' + n(lifeOf(e)) + '</b> HP</span>' : '')
    + (e.def ? '<span class="pd-vital"><b style="color:' + TINT.DEF + '">' + e.def + '</b> DEF</span>' : '');
  function runHtml(d, root) {
    /*
     * A creature earns a stop of its own only for what it drops that is worth the trip; the rest,
     * minibosses included, are the crowd you go through. Creatures that drop the very same things
     * share one stop (the three golems and their cuffs), weakest first, the last boss last.
     */
    const big = role => role === 'Boss' || role === 'Miniboss' || role === 'Treasure room';
    const worthOf = g => (d.byGiver.get(g) || []).filter(notable);
    const groups = new Map();
    for (const [g, role] of d.roster) {
      const w = worthOf(g);
      if (!big(role) || !w.length) continue;
      const k = w.map(x => x.id).sort().join('|');
      (groups.get(k) || groups.set(k, []).get(k)).push(g);
    }
    const topRole = gs => gs.map(g => roleOf(d, g)).sort((a, b) => rank[a] - rank[b])[0];
    const order = [...groups.values()].map(gs => gs.sort((a, b) => lifeOf(rec(a)) - lifeOf(rec(b))))
      .sort((a, b) => (rank[topRole(b)] - rank[topRole(a)]) || (lifeOf(rec(a[a.length - 1])) - lifeOf(rec(b[b.length - 1]))));
    const staged = new Set(order.flat());
    const crowd = [...d.roster].filter(([id, role]) => !staged.has(id) && role !== 'Hazard').map(([id]) => rec(id))
      .sort((a, b) => (rank[roleOf(d, a.id)] - rank[roleOf(d, b.id)]) || (lifeOf(b) - lifeOf(a)));
    // What the crowd drops that is worth having, together under it.
    const along = [...new Map(crowd.flatMap(e => worthOf(e.id)).map(x => [x.id, x])).values()];
    const stop = (node, title, sub, body, cls = '') => '<li class="pd-stop ' + cls + '"><span class="pd-node">' + node + '</span><div class="pd-stop-body">'
      + '<div class="pd-stop-h"><b>' + title + '</b>' + (sub ? '<span class="pd-stop-sub">' + sub + '</span>' : '') + '</div>' + body + '</div></li>';
    const text = desc(root, d.r);
    let h = '<div class="pc pd pd-run"><header class="pd-head"><span class="pd-portal">' + art(d.r, 72) + '</span><div><p class="pd-eyebrow">Dungeon</p><h2>' + esc(d.r.said || d.r.name) + '</h2>'
      + (text ? '<p class="pd-desc is-clamped" title="Click to read it all" onclick="this.classList.toggle(\'is-clamped\')">' + esc(text) + '</p>' : '') + '</div>' + '</header>';
    const worth = d.items.filter(notable).length;
    // The difficulty, said once, where the summary was: a figure and a bar of ten, as RealmEye rates it.
    if (d.diff) h += '<p class="pd-sum" title="Difficulty, as RealmEye rates it"><span class="pd-sum-l">Difficulty</span><b>' + d.diff + '</b><small>/ 10</small><span class="pd-diffbar">' + Array.from({ length: 10 }, (_, i) => '<i class="' + (i < Math.floor(d.diff) ? 'is-on' : i < d.diff ? 'is-half' : '') + '"></i>').join('') + '</span></p>';
    h += '<ol class="pd-line">';
    h += stop('<span class="pd-node-icon">⟶</span>', 'Getting in', '', '<div class="pd-doors">' + doorsHtml(d, 44) + '</div>', 'is-start');
    if (crowd.length) {
      // Creatures the client draws nothing for are counted, not drawn: initials in a row of pictures read as noise.
      const seen = crowd.filter(hasFace), shown = seen.slice(0, 16), unseen = crowd.length - shown.length;
      const body = '<div class="pd-crowdline">' + shown.map(e => open(e, alive(e, 28))).join('')
        + (unseen > 0 ? '<span class="pd-more-n" title="' + esc(crowd.filter(e => !shown.includes(e)).map(e => e.name).join(', ')) + '">+' + unseen + '</span>' : '') + '</div>'
        + (along.length ? '<div class="pd-tiles">' + along.map(it => itemTile(it, 40)).join('') + '</div>' : '');
      h += stop('<span class="pd-node-icon">⚔</span>', 'On the way', 'the creatures you go through' + (along.length ? ', and what they drop' : ''), body);
    }
    for (const gs of order) {
      const role = topRole(gs), boss = role === 'Boss', lead = rec(gs[gs.length - 1]);
      const gives = [...new Map(gs.flatMap(g => d.byGiver.get(g) || []).map(x => [x.id, x])).values()];
      const special = gives.filter(notable), rest = gives.filter(x => !notable(x));
      const body = '<div class="pd-tiles">' + special.map(it => itemTile(it, boss ? 52 : 44)).join('') + '</div>'
        + (rest.length ? '<p class="pd-also">also ' + rest.slice(0, 4).map(x => esc(x.name)).join(', ') + (rest.length > 4 ? ' and ' + (rest.length - 4) + ' more' : '') + '</p>' : '');
      const faces = gs.length > 1 ? '<span class="pd-faces">' + gs.slice(-3).map(g => alive(rec(g), 32)).join('') + '</span>' : alive(lead, boss ? 64 : 48);
      const title = gs.map(g => open(rec(g), esc(rec(g).name), 'pd-plain pd-who')).join('<span class="pd-and">, </span>');
      const say = { Enemy: ['Creature', 'Creatures'], Minion: ['Creature', 'Creatures'], Miniboss: ['Miniboss', 'Minibosses'], Boss: ['Boss', 'Bosses'], 'Treasure room': ['Treasure room', 'Treasure room'] }[role] || [role, role];
      const sub = '<span class="pd-role">' + say[gs.length > 1 ? 1 : 0] + '</span>' + (gs.length === 1 ? vitals(lead) : '');
      h += stop(faces, title, sub, body, boss ? 'is-boss' : 'is-mini');
    }
    const loose = d.loose.filter(notable);
    // A Legacy page's name said the way a player says it: "Heroic Undead Lair (Legacy)".
    const placeSay = n => String(n).replace(/^Legacy\s+(.*?)(?:\s+Portal)?$/, '$1 (Legacy)');
    const samePlace = p => p && p.kind === 'portal' && (p.id === d.r.id || placeSay(p.name).replace(/ \(Legacy\)$/, '') === placeSay(d.r.name).replace(/ \(Legacy\)$/, ''));
    // What RealmEye says the dungeon itself drops, without naming a creature.
    const inside = loose.filter(it => relations(it).some(x => x.type === 'dropped_by' && x.to && samePlace(rec(x.to))));
    const away = loose.filter(it => !inside.includes(it));
    if (inside.length) h += stop('<span class="pd-node-icon">✦</span>', 'Anywhere inside', 'RealmEye says the dungeon drops these, not which creature', '<div class="pd-tiles">' + inside.map(it => itemTile(it, 44)).join('') + '</div>');
    if (away.length) {
      // RealmEye lists these on the dungeon's page, but what drops them lives somewhere else: each says where.
      const whence = it => {
        const from = relations(it).filter(x => x.type === 'dropped_by' && x.to && rec(x.to) && rec(x.to).kind === 'enemy').map(x => rec(x.to));
        const place = from.map(e => homeOf(e)).find(Boolean);
        if (from.length) return 'from ' + esc(from[0].name) + (place ? ' · ' + esc(placeSay(place.name)) : '');
        const portal = relations(it).map(x => x.type === 'dropped_by' && x.to && rec(x.to)).find(x => x && x.kind === 'portal');
        if (portal) return 'from ' + esc(placeSay(portal.name));
        return relations(it).some(x => /quest-chest/.test(x.toRealmEye || '')) ? 'from a quest chest' : '';
      };
      const said = away.map(whence), elsewhere = said.every(Boolean);
      h += stop('<span class="pd-node-icon">↗</span>', 'Also on its page', elsewhere ? 'RealmEye lists these here, but what drops them lives elsewhere' : 'RealmEye lists these here without saying who drops them', '<div class="pd-tiles">' + away.map((it, i) => itemTile(it, 44, said[i])).join('') + '</div>');
    }
    h += '</ol>';
    const rest = d.items.filter(it => !notable(it));
    if (rest.length) h += '<details class="pd-rest"><summary>Everything else that drops here <small>' + rest.length + '</small></summary><div class="pd-chips">' + rest.map(it => open(it, art(it, 20) + '<span>' + esc(it.name) + '</span>', 'pd-chip')).join('') + '</div></details>';
    h += '<div data-pcside class="pd-more"></div></div>';
    return h;
  }

  function dungeon(root, r) {
    const d = dungeonData(r, root);
    const blocks = blocksOf(root);
    const keep = [...blocks].filter(([t]) => /Links|Other/i.test(t)).map(([, b]) => b);
    const host = document.createElement('div');
    host.innerHTML = runHtml(d, root);
    const side = host.querySelector('[data-pcside]');
    keep.forEach(b => side.appendChild(b));
    const card = host.firstElementChild;
    root.querySelector('.fc-cols').replaceWith(card);
    requestAnimationFrame(() => balanceColumns(card));
  }

  /* ================================================================ *
   * Every other kind of card, in the gear card's frame                *
   * ================================================================ */
  /*
   * The same three floors as the gear card: who it is (its picture large, what
   * kind of thing, its name, the chips that place it), the few figures a
   * player wants first, large, then what there is to know about it in columns
   * that end level. The site's own blocks are kept where they already say a
   * thing well (a set's bonus table, a skin's preview, a class's stats); the
   * links and tags nobody reads first are folded at the end.
   */
  const sec = (title, body, cls = '') => body ? '<section class="pg-sec ' + cls + '">' + (title ? '<h3>' + title + '</h3>' : '') + body + '</section>' : '';
  const chipOf = (x, px = 20) => open(x, art(x, px) + '<span>' + esc(x.said || x.name) + '</span>', 'pg-set');
  const statChips = (stats, sign = true) => STAT_ORDER.filter(k => stats && stats[k]).map(k => '<b style="color:' + TINT[k] + '">' + (sign && stats[k] > 0 ? '+' : '') + n(stats[k]) + ' <small>' + STAT_SHORT[k] + '</small></b>').join('');
  const statFigure = (label, stats) => statChips(stats) ? '<div class="pg-fig pg-stats"><span class="pg-fig-l">' + label + '</span><div>' + statChips(stats) + '</div></div>' : '';
  const srcCard = (x, sub, px = 40) => open(x, '<span class="pg-src-pic">' + (x.kind === 'enemy' ? alive(x, px) : art(x, px)) + '</span><span class="pg-src-t"><b>' + esc(x.said || x.name) + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>', 'pg-src');
  const faceRow = (list, px = 32, max = 18) => {
    const seen = list.filter(hasFace), shown = seen.slice(0, max), more = list.length - shown.length;
    return '<div class="pd-crowdline pk-faces">' + shown.map(e => open(e, alive(e, px))).join('')
      + (more > 0 ? '<span class="pd-more-n" title="' + esc(list.filter(e => !shown.includes(e)).map(e => e.name).join(', ')) + '">+' + more + '</span>' : '') + '</div>';
  };
  const tilesOf = (items, px = 44) => {
    const top = items.filter(notable), rest = items.filter(x => !notable(x));
    return (top.length ? '<div class="pd-tiles">' + top.map(it => itemTile(it, px)).join('') + '</div>' : '')
      + (rest.length ? '<div class="pd-chips pk-chips">' + rest.map(it => open(it, art(it, 20) + '<span>' + esc(it.said || it.name) + '</span>', 'pd-chip')).join('') + '</div>' : '');
  };
  const titleOf = b => ((b.querySelector('summary, h4') || {}).textContent || '').trim();
  const linkIds = (blocks, rx) => { const out = []; for (const b of blocks.values()) for (const row of rowsOf(b)) if (rx.test(row.label)) row.ids.forEach(id => { if (!out.includes(id)) out.push(id); }); return out.map(rec).filter(Boolean); };
  // What drops it, read once for every creature: the items whose RealmEye page says they drop from it.
  let dropsBy = null;
  const dropsOf = id => {
    if (!dropsBy) {
      dropsBy = new Map();
      for (const it of D.all.values()) if (it.kind === 'item' && !it.folded && !it.hidden) for (const x of relations(it)) if (x.type === 'dropped_by' && x.to) (dropsBy.get(x.to) || dropsBy.set(x.to, []).get(x.to)).push(it);
    }
    // RealmEye's pages about a kind of thing ("Themed Sets") are not things that drop.
    return [...new Map((dropsBy.get(id) || []).filter(x => x.art || !/^(Marks|Themed Sets|Mystery Items)$/.test(x.name)).map(x => [x.id, x])).values()];
  };
  // Every place a creature lives, the real dungeon first.
  const homesOf = e => {
    const lives = D.archive && D.archive() && D.archive().livesIn;
    const at = lives && lives.get(e.id);
    const places = at ? [...at].map(rec).filter(Boolean) : [];
    const one = homeOf(e);
    if (one && !places.includes(one)) places.unshift(one);
    return places.sort((a, b) => (a === one ? -1 : b === one ? 1 : 0));
  };

  function kindHero(r, root, eyebrow, chips, tone = '') {
    const text = ((root.dataset.said || '') || (r.about || '').replace(/\r?\n/g, ' ')).trim();
    return '<header class="pg-hero"><div class="pg-stage">' + (r.kind === 'enemy' ? alive(r, 96) : art(r, 96)) + '</div>'
      + '<div class="pg-id"><p class="pg-eyebrow">' + eyebrow.map((e, i) => '<span' + (i ? ' class="pg-tier is-' + (tone || 't') + '"' : '') + '>' + e + '</span>').join('') + '</p>'
      + '<h2 class="pg-name' + (tone ? ' is-' + tone : '') + '">' + esc(r.said || r.name) + '</h2>'
      + (chips ? '<div class="pg-who">' + chips + '</div>' : '')
      + (text ? '<p class="pg-desc">' + esc(text) + '</p>' : '') + '</div></header>';
  }

  /* -- each kind: its eyebrow, its chips, its figures, its parts -- */
  const KINDS = {
    enemy(r, root, blocks) {
      const f = facts(r), say = Object.values(f).filter(v => typeof v === 'string').join(' ');
      const exp = (/EXP: ([\d,]+)/.exec(say) || [])[1];
      const homes = homesOf(r);
      const role = r.god ? 'God' : (r.labels || []).includes('QUEST') ? 'Quest' : '';
      const immune = r.immune || [];
      const chips = homes.slice(0, 3).map(p => chipOf(p)).join('') + immune.map(s => '<span class="pg-chip">' + statusArt(s, 16) + '<span>Immune to ' + esc(s) + '</span></span>').join('');
      const figs = [];
      if (r.hp) figs.push(figure('Life', n(r.hp) + '<small> HP</small>', 'before the party scales it', null, TINT.MAXHP));
      if (r.def !== undefined) figs.push(figure('Defense', n(r.def), r.def >= 100 ? 'only armour-piercing shots get through' : r.def ? 'taken off every hit' : 'every hit lands in full', null, TINT.DEF));
      if (exp) figs.push(figure('Experience', exp, 'shared by who hits it'));
      // What its own page lists as dropping (the potions) and what the items' pages say drop from it.
      const drops = [...new Map(linkIds(blocks, /dropping/i).filter(x => x.kind === 'item').concat(dropsOf(r.id)).map(x => [x.id, x])).values()];
      const parts = [];
      const combat = [...blocks.values()].find(b => /^(Attacks|Other data)/.test(titleOf(b)) && b.querySelector('table'));
      if (combat) parts.push(combat);
      const tiers = [...blocks.values()].filter(b => /^Drops/.test(titleOf(b))).flatMap(b => rowsOf(b)).filter(row => /tier/i.test(row.label)).flatMap(row => row.words);
      if (drops.length || tiers.length) parts.push(sec('What it drops', tilesOf(drops) + (tiers.length ? '<div class="pd-chips pk-chips">' + tiers.map(w => '<span class="pg-chip">' + esc(w) + '</span>').join('') + '</div>' : '')));
      // The events that bring it out, and at what mark of the realm's score (tools/build-realm-events.js).
      const seen = (r.outLinks || []).filter(l => l[0] === 'appears in').map(l => rec(l[1])).filter(x => x && x.event);
      if (seen.length) {
        const say = ev => {
          const s = ev.event.spawns.find(x => x.id === r.id);
          if (s && Array.isArray(s.at)) return s.at.map(m => m + '%').join(' · ') + ' of the realm’s score';
          if (s && s.at === '?') return 'at a score nobody has written down';
          return (ev.event.waves || []).some(w => w.enemies.some(x => x.id === r.id)) ? 'in a wave of the invasion' : 'once the event is under way';
        };
        parts.push(sec('When it comes out', '<div class="pg-srcs">' + seen.map(ev => {
          const face = ev.artOf && rec(ev.artOf);
          return open(ev, '<span class="pg-src-pic">' + (face ? alive(face, 40) : '') + '</span><span class="pg-src-t"><b>' + esc(ev.name) + '</b><small>' + esc(say(ev)) + '</small></span>', 'pg-src');
        }).join('') + '</div>'));
      }
      if (homes.length) parts.push(sec('Where it lives', '<div class="pg-srcs">' + homes.map(p => srcCard(p, p.kind === 'portal' ? 'dungeon' : 'biome')).join('') + '</div>'));
      const near = linkIds(blocks, /spawn/i).filter(x => x.kind === 'enemy' && x.id !== r.id);
      if (near.length) parts.push(sec('Comes with', faceRow(near) + '<p class="pd-also">' + esc(near.slice(0, 6).map(x => x.name).join(', ')) + (near.length > 6 ? ' and ' + (near.length - 6) + ' more' : '') + '</p>'));
      const deals = [...blocks.values()].find(b => /^Status effects/.test(titleOf(b)));
      if (deals && rowsOf(deals).some(row => !/immune/i.test(row.label))) parts.push(deals);
      return { eyebrow: ['Enemy'].concat(role ? [role] : []), chips, figs, parts, keep: [/^Links|^Tags|^Drops|^Where to find it|^Combat|^Status effects/] };
    },
    set(r, root, blocks) {
      const f = facts(r), pieces = (r.pieces || []).map(p => rec('item:' + p)).filter(Boolean);
      const cls = linkIds(blocks, /^Class/i).filter(x => x.kind === 'class');
      const figs = [statFigure('Full set adds', r.worn), figure('Pieces', String(pieces.length), pieces.length ? 'bonuses from 2 worn' : '')];
      if (f.total_xp_bonus) figs.push(figure('XP bonus', esc(f.total_xp_bonus), 'with every piece worn'));
      const parts = [];
      parts.push(sec('Its pieces', '<div class="pd-tiles">' + pieces.map(it => itemTile(it, 48)).join('') + '</div>'));
      const bonus = blocks.get('Set bonus'); if (bonus) parts.push(bonus);
      const skin = blocks.get('Full set skin'), stage = skin && skin.querySelector('.fc2-bigart');
      if (skin && !stage) parts.push(skin);
      const src = gearSource(r); if (src) parts.push(node(src).firstElementChild);
      const note = blocks.get('Notes'); if (note) parts.push(note);
      return { eyebrow: ['Set'].concat(f.set_generation ? [esc(f.set_generation)] : []), chips: cls.map(c => chipOf(c, 24)).join('') + (f.soulbound ? '<span class="pg-chip">Soulbound</span>' : ''), figs, parts, stage, keep: [/^Links|^Other data|^Tags|^Where to get it|^Pieces|^Full set skin/] };
    },
    skin(r, root, blocks) {
      const cls = (r.outLinks || []).filter(l => l[0] === 'worn by').map(l => rec(l[1])).filter(Boolean);
      const unlock = (r.inLinks || []).filter(l => l[0] === 'unlocks').map(l => rec(l[1])).filter(Boolean);
      const set = [...D.all.values()].find(x => x.kind === 'set' && (x.skin === r.name || x.drawnAs === r.name));
      const figs = [];
      if (r.tier !== undefined) figs.push(figure('Rarity', 'T' + r.tier, 'as the client ranks it'));
      if (cls.length) figs.push(figure('Worn by', cls.map(c => art(c, 28)).join(' '), cls.map(c => esc(c.name)).join(', ')));
      if (unlock.length) figs.push(figure('Unlocked by', art(unlock[0], 28), esc(unlock[0].name)));
      const parts = [];
      const preview = blocks.get('Preview'), stage = preview && preview.querySelector('.fc2-bigart');
      for (const u of unlock) { const src = gearSource(u); parts.push(sec('Where its unlock comes from', '<div class="pg-srcs">' + srcCard(u, 'the item that unlocks it') + '</div>' + (src ? bare(src) : ''))); }
      if (set) parts.push(sec('Its set', '<div class="pg-srcs">' + srcCard(set, 'wearing the whole set gives this look') + '</div>'));
      return { eyebrow: ['Skin'], chips: cls.map(c => chipOf(c, 24)).join(''), figs, parts, stage, keep: [/^Unlock|^Links|^Tags|^Preview/] };
    },
    item(r, root, blocks) {
      const f = facts(r), cx = extra(r);
      const effect = [].concat(f.effect_s || []).join(' · ');
      const stat = /([+-]\d+) maximum (\w+)/.exec(effect || r.about || '');
      const KEY = { HP: 'MAXHP', MP: 'MAXMP', ATT: 'ATT', DEF: 'DEF', SPD: 'SPD', DEX: 'DEX', VIT: 'VIT', WIS: 'WIS', Life: 'MAXHP', Mana: 'MAXMP' };
      const figs = [];
      if (stat && KEY[stat[2]]) figs.push(figure('Gives', stat[1] + ' <small>' + STAT_SHORT[KEY[stat[2]]] + '</small>', 'for good, to the character who drinks it', null, TINT[KEY[stat[2]]]));
      else if (effect) figs.push(figure('Does', esc(effect.length > 40 ? effect.slice(0, 38) + '…' : effect), ''));
      if (cx.feed || f.feed_power) figs.push(figure('Feed power', n(+cx.feed || +f.feed_power), 'to a pet'));
      if (cx.bag !== undefined) figs.push(figure('Drops in', bagArt(cx.bag, 28), (BAG_SAY[cx.bag] || '') + ' bag'));
      const t = tierOf(r);
      const parts = [];
      const special = gearSpecial(r, root, blocks); if (special) parts.push(node(special).firstElementChild);
      const src = gearSource(r); if (src) parts.push(node(src).firstElementChild);
      const craft = gearCraft(r, root, null);
      if (craft && /pc-recipe|pc-slot/.test(craft)) { const el = node(craft).firstElementChild; const figs = el.querySelector('.pc-figs'); if (figs) figs.remove(); parts.push(el); }
      for (const b of blocks.values()) if (/^Facts/.test(titleOf(b))) parts.push(b);
      return { eyebrow: [esc(slotSay(r) || (r.use ? 'Consumable' : 'Item'))].concat(t.say ? [t.say] : []), tone: t.cls !== 't' ? t.cls : '', chips: r.sb ? '<span class="pg-chip">Soulbound</span>' : '', figs, parts, keep: [/^Economy|^Links|^Tags|^Other data|^Where to get it|^Effects|^Notes/] };
    },
    enchant(r, root, blocks) {
      const fits = String(r.fits || '').split(',').filter(Boolean).map(x => x.charAt(0) + x.slice(1).toLowerCase());
      const pools = (r.outLinks || []).filter(l => /favoured|pool/i.test(l[0])).map(l => rec(l[1])).filter(Boolean);
      const rare = r.weight >= 1000 ? 'common' : r.weight >= 500 ? 'uncommon' : r.weight >= 100 ? 'rare' : 'very rare';
      const figs = [figure('Goes on', fits.join(', ') || 'any gear', r.refuses ? 'never on ' + String(r.refuses).toLowerCase().replace(/,/g, ', ') : '')];
      if (r.weight) figs.push(figure('Rolls', rare, 'weight ' + n(r.weight) + ' in its pools'));
      if (r.pools) figs.push(figure('Pools', n(r.pools), 'that can roll it'));
      const parts = [sec('What it does', '<p class="pk-big">' + esc(r.about || '').replace(/\r?\n/g, '<br>') + '</p>')];
      // A pool has no picture of its own: it is shown with the enchantment it favours.
      if (pools.length) parts.push(sec('Favoured by', '<div class="pg-srcs">' + pools.map(p => srcCard(p.art ? p : Object.assign({}, p, { art: r.art }), 'rolls it more often')).join('') + '</div>'));
      const awaken = linkIds(blocks, /awaken/i).filter(x => x.kind === 'item');
      if (awaken.length) parts.push(sec('Awakens on', tilesOf(awaken)));
      return { eyebrow: ['Enchantment'].concat((r.labels || []).includes('UNIQUE') ? ['Unique'] : []), chips: '', figs, parts, quiet: true, keep: [/^Effect|^Links|^Tags/] };
    },
    status(r, root, blocks) {
      const bad = r.tone === 'bad';
      const find = rx => [...blocks.values()].find(x => rx.test(titleOf(x)));
      // A block's count is in its title ("Creatures that inflict it · 147"); its list may be cut short.
      const count = b => b ? +((/·\s*([\d,]+)/.exec(titleOf(b)) || [])[1] || '0').replace(/,/g, '') || b.querySelectorAll('[data-open]').length : 0;
      const hurt = find(/^Gear that inflicts/), help = find(/^Gear that grants/), beasts = find(/^Creatures that inflict/);
      // Each piece of gear with how long and how hard, as the site wrote it beside its name.
      const gearTiles = b => '<div class="pd-tiles">' + [...b.querySelectorAll('[data-open]')].map(x => {
        const it = rec(x.dataset.open); if (!it) return '';
        const said = x.textContent.replace(it.name, '').trim();
        return itemTile(it, 40, esc(said));
      }).join('') + '</div>';
      const figs = [figure('It is', bad ? 'Harmful' : 'Helpful', bad ? 'to whoever carries it' : 'to whoever carries it', null, bad ? '#ff6b6b' : '#6ee07a'),
        figure('Gear', String(count(hurt) + count(help)), 'that inflicts or grants it'),
        figure('Creatures', String(count(beasts)), 'that inflict it')];
      const parts = [];
      for (const b of blocks.values()) if (/^(What it does|In the numbers)/.test(titleOf(b))) parts.push(b);
      if (hurt) parts.push(sec('Gear that inflicts it <small>' + count(hurt) + '</small>', gearTiles(hurt)));
      if (help) parts.push(sec('Gear that grants it <small>' + count(help) + '</small>', gearTiles(help)));
      if (beasts) { const list = [...beasts.querySelectorAll('[data-open]')].map(x => rec(x.dataset.open)).filter(Boolean); parts.push(sec('Creatures that inflict it <small>' + count(beasts) + '</small>', faceRow(list, 32, 40))); }
      return { eyebrow: ['Status effect'], chips: '', figs, parts, keep: [/^Links|^Tags|^Gear that|^Creatures that/], art: statusArt(r.name, 72) };
    },
    event(r, root, blocks) {
      const e = r.event, face = r.artOf && rec(r.artOf);
      const find = rx => [...blocks.values()].find(x => rx.test(titleOf(x)));
      const marks = [...new Set(e.spawns.flatMap(s => Array.isArray(s.at) ? s.at : []))].sort((a, b) => a - b);
      const first = e.begins !== undefined ? e.begins : marks[0];
      const figs = [
        figure('First mark', first !== undefined ? first + '%' : 'not known', e.begins !== undefined ? 'of the realm’s score, where it begins' : 'of the realm’s score'),
        figure('Creatures', String(e.spawns.length), 'it brings out'),
        e.waves ? figure('Waves', String(e.waves.length), 'declared by the client, Adept then Veteran')
          : figure('Marks', String(marks.length), marks.length ? marks.slice(0, 6).join('%, ') + '%' + (marks.length > 6 ? '…' : '') : 'none given')
      ];
      const parts = [];
      for (const rx of [/^At what score/, /^Who comes out/, /^The invasion waves/, /^Where this is written/]) { const b = find(rx); if (b) parts.push(b); }
      return { eyebrow: ['Event'], chips: '<span class="pg-chip">' + esc(e.when) + '</span>', figs, parts, art: face ? alive(face, 96) : '', keep: [/^What it is|^Links|^Tags/] };
    },
    place(r, root, blocks) {
      const rel = relations(r), get = t => rel.filter(x => x.type === t && x.to && rec(x.to)).map(x => rec(x.to));
      const crowd = get('biome_regular_enemy'), meet = get('biome_encounter'), loot = get('biome_drop_interest');
      const figs = [figure('Creatures', String(crowd.length), 'that roam it'), figure('Encounters', String(meet.length), 'events and bosses that appear'), figure('Worth the trip', String(loot.filter(notable).length), 'things it drops')];
      const parts = [];
      if (meet.length) parts.push(sec('What appears there', faceRow(meet, 40) + '<p class="pd-also">' + esc(meet.slice(0, 6).map(x => x.name).join(', ')) + (meet.length > 6 ? ' and ' + (meet.length - 6) + ' more' : '') + '</p>'));
      if (crowd.length) parts.push(sec('What roams it', faceRow(crowd, 32)));
      if (loot.length) parts.push(sec('What it drops', tilesOf(loot)));
      return { eyebrow: ['Biome'], chips: '', figs, parts, keep: [/^Population|^Loot|^Links|^Tags/], art: r.icon ? '<img class="pc-art" src="' + esc(r.icon) + '" alt="" style="width:96px;height:96px;object-fit:contain">' : '' };
    },
    class(r, root, blocks) {
      const s = r.stats || {};
      const top = { MAXHP: s.hpTop, MAXMP: s.mpTop, ATT: s.attTop, DEF: s.defTop, SPD: s.spdTop, DEX: s.dexTop, VIT: s.vitTop, WIS: s.wisTop };
      const kit = (r.kit || []).filter(Boolean).map(k => rec('item:' + k)).filter(Boolean);
      const skins = (r.inLinks || []).filter(l => l[0] === 'worn by').map(l => rec(l[1])).filter(Boolean);
      const figs = ['<div class="pg-fig pg-stats pk-wide"><span class="pg-fig-l">At its best (8/8)</span><div>' + statChips(top, false) + '</div></div>'];
      const parts = [];
      const stats = [...blocks.values()].find(b => /^Stats/.test(titleOf(b))); if (stats) parts.push(stats);
      if (kit.length) parts.push(sec('Starts with', '<div class="pd-tiles">' + kit.map(it => itemTile(it, 44)).join('') + '</div>'));
      const vs = [...blocks.values()].find(b => /^Against all/.test(titleOf(b))); if (vs) parts.push(vs);
      if (skins.length) parts.push(sec('Its skins <small>' + skins.length + '</small>', faceRow(skins, 32, 30)));
      return { eyebrow: ['Class'], chips: '', figs, parts, keep: [/^Links|^Other data|^Tags/] };
    }
  };

  KINDS.pool = (r, root, blocks) => {
    const ids = linkIds(blocks, /./).filter(x => x.kind === 'enchant');
    return { eyebrow: ['Enchantment pool'], chips: '', art: ids[0] ? art(ids[0], 96) : '', figs: [figure('Enchantments', String(ids.length), 'it can roll')], parts: ids.length ? [sec('What it rolls', '<div class="pd-chips">' + ids.map(x => open(x, art(x, 20) + '<span>' + esc(x.name) + '</span>', 'pd-chip')).join('') + '</div>')] : [], keep: [/^Links|^Tags/] };
  };
  KINDS.pet = (r, root, blocks) => ({ eyebrow: ['Pet'], chips: '', figs: [], parts: [], keep: [/^Tags/] });
  /*
   * The site's blocks, with its first one (the sheet: name, prose, and the parts that
   * follow them, "Set bonus", "Preview", "Stats") opened into its parts, each a block
   * of its own: the hero says the name and the prose, the parts go to the columns.
   */
  function kindBlocks(root) {
    const out = new Map();
    const sheet = root.querySelector('.fc2-sheet');
    if (sheet) sheet.querySelectorAll('details.ix-part').forEach(d => {
      if (d.parentElement.closest('details.ix-part')) return;
      const t = d.querySelector('summary');
      const title = t ? t.childNodes[0].textContent.trim() : '';
      if (!title || out.has(title)) return;
      const box = document.createElement('div'); box.className = 'ix-block'; box.appendChild(d);
      out.set(title, box);
    });
    for (const [title, b] of blocksOf(root)) if (!b.classList.contains('fc2-sheet') && !out.has(title)) out.set(title, b);
    return out;
  }
  function kindCard(root, r) {
    const prose = root.querySelector('.fc2-sheet .ix-prose');
    const said = prose ? desc(root.querySelector('.fc2-sheet'), r) : '';
    const blocks = kindBlocks(root);
    const make = KINDS[r.kind === 'item' ? 'item' : r.kind];
    if (!make) return false;
    root.dataset.said = said;
    const spec = make(r, root, blocks);
    const host = document.createElement('div');
    if (spec.quiet) root.dataset.said = ' ';
    const hero = kindHero(r, root, spec.eyebrow, spec.chips, spec.tone);
    // Nothing drawn (an invisible spawner): no frame with initials in it, the name says it.
    const pic = spec.art !== undefined && spec.art !== '' ? spec.art : null;
    let top = pic ? hero.replace(/<div class="pg-stage">[\s\S]*?<\/div>/, '<div class="pg-stage">' + pic + '</div>') : hero;
    if (!spec.stage && /<div class="pg-stage"><span class="pc-noart/.test(top)) top = top.replace(/<div class="pg-stage">[\s\S]*?<\/span><\/div>/, '').replace('<header class="pg-hero">', '<header class="pg-hero is-bare">');
    host.innerHTML = '<div class="pc pg pg-columns pk-kind pk-' + r.kind + '">' + top
      + (spec.figs.filter(Boolean).length ? '<div class="pg-figs">' + spec.figs.filter(Boolean).join('') + '</div>' : '') + '<div data-pclow class="pg-low"></div></div>';
    const low = host.querySelector('[data-pclow]');
    const used = new Set(spec.parts.filter(x => x && x.nodeType));
    const parts = spec.parts.filter(Boolean).map(x => typeof x === 'string' ? node(x).firstElementChild : x).filter(Boolean);
    // What the card did not say in its own words, and the site's blocks it left: shown under, the links and tags folded.
    const rest = [...blocks.values()].filter(b => !used.has(b) && !b.classList.contains('fc2-sheet') && !b.classList.contains('fc2-empty') && !parts.includes(b));
    const folded = rest.filter(b => (spec.keep || []).some(rx => rx.test(titleOf(b))) || !b.textContent.trim());
    rest.filter(b => !folded.includes(b)).forEach(b => parts.push(b));
    low.appendChild(columnsOf(parts));
    if (folded.length) {
      const more = document.createElement('details'); more.className = 'pg-sec pk-more';
      more.innerHTML = '<summary>More about it</summary>';
      folded.forEach(b => more.appendChild(b));
      low.appendChild(more);
    }
    if (spec.stage) { const at = host.querySelector('.pg-stage'); at.textContent = ''; at.appendChild(spec.stage); at.classList.add('is-live'); }
    const card = host.firstElementChild;
    root.querySelector('.fc-cols').replaceWith(card);
    requestAnimationFrame(() => balanceColumns(card));
    return true;
  }

  /* ---------------- when the site has drawn a card ---------------- */
  function apply(box) {
    const root = box.querySelector('.fc-root');
    if (!root || root.dataset.laid || typeof RealmIndex === 'undefined') return;
    D = D || RealmIndex.data();
    if (!D) return;
    const love = root.querySelector('[data-love]');
    const r = rec(love ? love.dataset.love : '');
    root.dataset.laid = '1';
    if (!r) return;
    const isGear = r.kind === 'item' && r.hand && !r.use;
    try {
      if (isGear) { gear(root, r); box.classList.add('pc-host'); }
      else if (r.kind === 'portal') { dungeon(root, r); box.classList.add('pc-host'); }
      else if (root.querySelector('.fc-cols') && kindCard(root, r)) box.classList.add('pc-host');
    } catch (err) { console.error('index card', err); }
  }
  // RealmEye's archive arrives after the first card: the card is drawn again with it.
  document.addEventListener('realmindex:realmeye', () => {
    dropsBy = null;
    const box = document.getElementById('ixCard'), root = box && box.querySelector('.fc-root');
    const love = root && root.querySelector('[data-love]');
    if (!love) return;
    const id = love.dataset.love;
    RealmIndex.close();
    setTimeout(() => RealmIndex.open(id), 0);
  });
  const wait = setInterval(() => {
    const box = document.getElementById('ixCard');
    if (!box) return;
    clearInterval(wait);
    new MutationObserver(() => apply(box)).observe(box, { childList: true });
    apply(box);
    // A card laid out for one width is laid out again for another (half window to full screen).
    let wasWide = 0;
    new ResizeObserver(() => {
      const w = Math.round(box.clientWidth / 40);
      if (w === wasWide) return;
      wasWide = w;
      const card = box.querySelector('.pc');
      if (card) requestAnimationFrame(() => balanceColumns(card));
    }).observe(box);
  }, 200);
})();

'use strict';
/*
 * The review page: each finding of the validation, RealmEye on the left and
 * the site's own card on the right, and a verdict a person gives on it.
 * Served by tools/review-server.js, which writes the verdicts.
 */
(() => {
  const CHECKS = {
    'enemy-stats': {
      label: 'PV / DEF des ennemis',
      what: 'RealmEye et la fiche du site ne donnent pas les mêmes <span class="stat-hp">PV</span> ou la même <span class="stat-def">DEF</span>.',
      shown: 'affichée par le site', candidate: 'correspond à RealmEye'
    },
    'enemy-attacks': {
      label: 'Attaques des ennemis',
      what: 'Les tirs montrés sur la page RealmEye ne sont tirés par aucun objet client rattaché à cette page.',
      shown: 'affichée par le site', candidate: 'tire ces projectiles'
    },
    'item-stats': {
      label: 'Stats des objets',
      what: 'Le palier ou les bonus d\'équipement annoncés par RealmEye diffèrent de ceux du client.',
      shown: 'affichée par le site', candidate: 'autre objet de la même page'
    },
    'folded-target': {
      label: 'Liens vers une fiche repliée',
      what: 'Des liens RealmEye mènent à une fiche repliée sous une autre qui ne lui ressemble pas (image, <span class="stat-hp">PV</span> ou <span class="stat-def">DEF</span>) : le site montre la fiche repliée.',
      shown: 'cible des liens', candidate: 'porte la ligne'
    },
    'client-drift': {
      label: 'Index ↔ scrape du client',
      what: 'L\'Index publié et le dernier scrape du client ne concordent pas pour cet objet.',
      shown: 'dans l\'Index', candidate: ''
    }
  };
  const STAT = {
    MAXHP: ['PV', 'hp'], MAXMP: ['PM', 'mp'], ATT: ['ATT', 'att'], DEF: ['DEF', 'def'],
    SPD: ['SPD', 'spd'], DEX: ['DEX', 'dex'], VIT: ['VIT', 'vit'], WIS: ['WIS', 'wis']
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => (value === undefined || value === null ? '—' : Number(value).toLocaleString('fr-FR'));
  const store = {
    get(key, fallback) { try { return localStorage.getItem('review.' + key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('review.' + key, value); } catch { /* private window */ } }
  };

  let state = null;
  let current = null;           // the finding's full key
  let shownRecord = null;       // the record the site pane shows

  const keyOf = one => one.check + '|' + one.key;
  function statusOf(one) {
    const verdict = state.verdicts[keyOf(one)];
    if (!verdict) return 'todo';
    return verdict.message === one.message ? verdict.verdict : 'stale';
  }
  function titleOf(one) {
    const page = one.data && one.data.page && state.report.pages[one.data.page];
    if (page) return page.title;
    const record = state.records[(one.data && one.data.shown || [])[0]];
    return record ? (record.said || record.name) : one.key;
  }
  function visible() {
    const check = $('check').value;
    const status = $('status').value;
    return state.report.findings.filter(one => {
      if (one.level === 'INFO') return false;
      if (check !== 'all' && one.check !== check) return false;
      const s = statusOf(one);
      if (status === 'todo') return s === 'todo' || s === 'stale';
      return status === 'all' || s === status;
    });
  }

  /* ---------------- drawing ---------------- */
  function sprite(record) {
    const art = record && record.art;
    if (!art || !state.sheet) return '<div class="sprite" aria-hidden="true"></div>';
    const [x, y, w, h] = art;
    const scale = 40 / Math.max(w, h);
    return '<div class="sprite" role="img" aria-label="' + esc(record.name) + '" style="'
      + 'width:' + (w * scale) + 'px;height:' + (h * scale) + 'px;'
      + 'background-image:url(/web/assets/index/sheet.png);'
      + 'background-size:' + (state.sheet.wide * scale) + 'px ' + (state.sheet.tall * scale) + 'px;'
      + 'background-position:' + (-x * scale) + 'px ' + (-y * scale) + 'px"></div>';
  }
  function worn(record) {
    if (!record || !record.worn) return '';
    return Object.entries(record.worn).filter(([key]) => STAT[key])
      .map(([key, value]) => '<span class="stat-' + STAT[key][1] + '">' + (value > 0 ? '+' : '') + value + ' ' + STAT[key][0] + '</span>')
      .join(', ');
  }
  function matchClass(value, wanted) {
    if (!wanted.length || value === undefined || value === null) return '';
    return wanted.includes(value) ? ' match' : ' miss';
  }

  function recordRows(one, roles) {
    const stated = (one.data && one.data.stated) || [];
    const hps = stated.map(pair => pair[0]);
    const defs = stated.map(pair => pair[1]).filter(value => value !== null && value !== undefined);
    const isItem = one.check === 'item-stats';
    let rows = '';
    if (stated.length) {
      rows += '<tr class="realmeye"><td></td><td class="name"><b>RealmEye</b><span class="role">la page annonce</span></td>'
        + '<td class="num stat-hp">' + hps.map(num).join(' / ') + '</td>'
        + '<td class="num stat-def">' + (defs.length ? defs.map(num).join(' / ') : '—') + '</td><td></td></tr>';
    }
    for (const [id, role] of roles) {
      const record = state.records[id];
      const name = record ? (record.said || record.name) : id;
      const client = record && record.alias ? record.alias : '';
      rows += '<tr data-record="' + esc(id) + '" aria-selected="' + (id === shownRecord) + '">'
        + '<td>' + sprite(record) + '</td>'
        + '<td class="name"><b>' + esc(name) + '</b>'
        + (client ? '<small>client : ' + esc(client) + '</small>' : '')
        + '<span class="role">' + esc(role) + (record && record.folded ? ' · repliée sous « ' + esc(record.foldedName || record.folded) + ' »' : '') + '</span></td>'
        + (isItem
          ? '<td class="num" colspan="2">' + (record && record.tier !== undefined ? 'T' + record.tier + ' · ' : '') + worn(record) + '</td>'
          : '<td class="num stat-hp' + matchClass(record && record.hp, hps) + '">' + num(record && record.hp) + '</td>'
            + '<td class="num stat-def' + matchClass(record && record.def, defs) + '">' + num(record && record.def) + '</td>')
        + '<td><button type="button" data-show="' + esc(id) + '">Voir à droite</button></td></tr>';
    }
    const head = isItem
      ? '<tr><th></th><th>Fiche</th><th class="num" colspan="2">Palier · bonus</th><th></th></tr>'
      : '<tr><th></th><th>Fiche</th><th class="num stat-hp">PV</th><th class="num stat-def">DEF</th><th></th></tr>';
    return '<table class="rows"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }

  function realmeyeCard(one) {
    const page = one.data && one.data.page && state.report.pages[one.data.page];
    if (!one.data || !one.data.page) return '';
    if (!page) {
      return '<div class="card"><h3>RealmEye</h3><p class="re-title"><a href="https://www.realmeye.com/wiki/'
        + esc(one.data.page) + '" target="_blank" rel="noopener">' + esc(one.data.page) + ' ↗</a></p></div>';
    }
    const pics = page.images.map(image => '<figure><img src="' + esc(image.src) + '" alt="' + esc(image.alt)
      + '" loading="lazy" referrerpolicy="no-referrer"><figcaption>' + esc(image.alt) + '</figcaption></figure>').join('');
    const facts = page.facts.map(fact => '<div><b>' + esc(fact.key) + ' :</b> ' + esc(fact.value) + '</div>').join('');
    return '<div class="card"><h3>RealmEye</h3>'
      + '<p class="re-title"><a href="' + esc(page.url) + '" target="_blank" rel="noopener">' + esc(page.title) + ' ↗</a>'
      + (page.version || page.date ? '<small>mise à jour : ' + esc([page.version, page.date].filter(Boolean).join(', ')) + '</small>' : '') + '</p>'
      + (pics ? '<div class="re-pics">' + pics + '</div>' : '')
      + (facts ? '<div class="facts">' + facts + '</div>' : '') + '</div>';
  }

  function drawDetail(one) {
    const meta = CHECKS[one.check] || { label: one.check, what: '', shown: '', candidate: '' };
    const data = one.data || {};
    const status = statusOf(one);
    const roles = [
      ...(data.shown || []).map(id => [id, meta.shown]),
      ...(data.candidates || []).filter(id => !(data.shown || []).includes(id)).map(id => [id, meta.candidate])
    ];
    let extra = '';
    if (one.check === 'enemy-attacks' && data.shots) {
      extra = '<div class="card"><h3>Tirs montrés par RealmEye</h3><div class="shots">'
        + data.shots.map(shot => '<span>' + esc(shot) + '</span>').join('') + '</div></div>';
    }
    if (one.check === 'item-stats' && data.problems) {
      extra = '<div class="card"><h3>Écarts</h3><ul class="plain">'
        + data.problems.map(problem => '<li>' + esc(problem) + '</li>').join('') + '</ul></div>';
    }
    if (one.check === 'folded-target' && data.from) {
      extra = '<div class="card"><h3>Liens venant de</h3><ul class="plain">'
        + data.from.map(id => '<li>' + esc(id) + '</li>').join('') + '</ul></div>';
    }
    const verdict = state.verdicts[keyOf(one)];
    $('detail').innerHTML = ''
      + '<span class="badge">' + esc(meta.label) + '</span> '
      + '<span class="badge ' + (one.level === 'ERROR' ? 'error' : '') + '">'
      + (one.level === 'ERROR' ? 'le validateur pense que le site a tort' : 'à trancher') + '</span>'
      + '<p class="what">' + meta.what + '</p>'
      + (status === 'stale' ? '<p class="stale-note">Un avis a été donné sur une version précédente de ce constat ('
        + (verdict.verdict === 'ok' ? 'pas d\'erreur' : 'erreur') + ', le ' + esc(verdict.at) + ') : les données ont changé depuis.</p>' : '')
      + realmeyeCard(one)
      + '<div class="card"><h3>Ce que le client déclare</h3>' + recordRows(one, roles) + '</div>'
      + extra
      + '<details class="raw"><summary>Constat brut du validateur</summary><p>' + esc(one.message) + '</p></details>';
    drawRecords(roles);
  }

  function drawRecords(roles) {
    $('records').innerHTML = roles.map(([id, role]) => {
      const record = state.records[id];
      return '<button type="button" data-show="' + esc(id) + '" aria-pressed="' + (id === shownRecord) + '" title="' + esc(role) + '">'
        + esc(record ? (record.alias || record.said || record.name) : id) + '</button>';
    }).join('');
  }

  function showOnSite(id) {
    shownRecord = id;
    const hash = '#index?' + new URLSearchParams({ open: id }).toString();
    $('site').src = '/web/' + hash;
    $('site-open').href = '/web/' + hash;
    for (const node of document.querySelectorAll('[data-show]')) {
      if (node.closest('.records')) node.setAttribute('aria-pressed', String(node.dataset.show === id));
    }
    for (const row of document.querySelectorAll('tr[data-record]')) row.setAttribute('aria-selected', String(row.dataset.record === id));
  }

  function drawList(items) {
    if (!items.length) {
      $('list').innerHTML = '<p class="none">Rien dans ce filtre.</p>';
      return;
    }
    $('list').innerHTML = items.map(one => {
      const status = statusOf(one);
      return '<button type="button" data-key="' + esc(keyOf(one)) + '" aria-current="' + (keyOf(one) === current) + '">'
        + '<span class="dot ' + status + '" aria-hidden="true"></span>'
        + '<span><span class="t">' + esc(titleOf(one)) + '</span><span class="k">' + esc((CHECKS[one.check] || {}).label || one.check)
        + (one.level === 'ERROR' ? ' · probable' : '') + '</span></span></button>';
    }).join('');
  }

  function drawTally() {
    const all = state.report.findings.filter(one => one.level !== 'INFO');
    const count = status => all.filter(one => (status === 'todo' ? ['todo', 'stale'].includes(statusOf(one)) : statusOf(one) === status)).length;
    $('tally').innerHTML = '<span class="t-todo">À vérifier <b>' + count('todo') + '</b></span>'
      + '<span class="t-error">Erreurs confirmées <b>' + count('error') + '</b></span>'
      + '<span class="t-ok">Sans erreur <b>' + count('ok') + '</b></span>';
  }

  function select(key) {
    const items = visible();
    const one = items.find(item => keyOf(item) === key) || items[0];
    current = one ? keyOf(one) : null;
    drawList(items);
    drawTally();
    if (!one) {
      $('detail').innerHTML = '<p class="empty">Rien à vérifier dans ce filtre. Changez de statut ou de contrôle en haut.</p>';
      $('records').innerHTML = '';
      $('position').textContent = '0 / 0';
      $('site').src = 'about:blank';
      setVerdictButtons(null);
      return;
    }
    const at = items.indexOf(one);
    $('position').textContent = (at + 1) + ' / ' + items.length;
    shownRecord = (one.data && one.data.shown || [])[0] || null;
    drawDetail(one);
    if (shownRecord) showOnSite(shownRecord);
    const verdict = state.verdicts[current];
    $('note').value = verdict && verdict.message === one.message ? verdict.note || '' : '';
    setVerdictButtons(verdict && verdict.message === one.message ? verdict.verdict : null);
    $('saved').textContent = '';
    const node = $('list').querySelector('[aria-current="true"]');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  function setVerdictButtons(verdict) {
    for (const button of document.querySelectorAll('.verdict [data-verdict]')) {
      if (button.dataset.verdict !== 'skip') button.setAttribute('aria-pressed', String(button.dataset.verdict === verdict));
    }
  }

  function step(delta) {
    const items = visible();
    if (!items.length) return;
    const at = Math.max(0, items.findIndex(one => keyOf(one) === current));
    select(keyOf(items[(at + delta + items.length) % items.length]));
  }

  /* ---------------- talking to the server ---------------- */
  async function api(action, body) {
    const response = await fetch('/review/api/' + action, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  }

  async function giveVerdict(verdict) {
    if (!current) return;
    if (verdict === 'skip') { step(1); return; }
    const items = visible();
    const at = items.findIndex(one => keyOf(one) === current);
    const was = state.verdicts[current];
    const same = was && was.verdict === verdict && was.message === items[at].message;
    try {
      const { verdicts } = await api('verdict', { key: current, verdict: same ? null : verdict, note: $('note').value });
      state.verdicts = verdicts;
    } catch (error) {
      $('saved').textContent = 'Non enregistré : ' + error.message;
      return;
    }
    const left = visible();
    const next = left.find(one => keyOf(one) === current) && !same
      ? left[(left.findIndex(one => keyOf(one) === current) + 1) % left.length]
      : left[Math.min(at, left.length - 1)];
    const said = same ? 'Avis retiré.' : verdict === 'ok' ? 'Enregistré : pas d\'erreur.' : 'Enregistré : erreur sur le site.';
    select(next ? keyOf(next) : null);
    $('saved').textContent = said + ' (tools/validation-review.json)';
  }

  async function load(rerun) {
    $('rerun').disabled = true;
    try {
      state = await api(rerun ? 'rerun' : 'state', rerun ? {} : undefined);
    } catch (error) {
      $('detail').innerHTML = '<p class="empty">Impossible de lire le rapport : ' + esc(error.message) + '</p>';
      return;
    } finally {
      $('rerun').disabled = false;
    }
    if (!state.report) {
      $('detail').innerHTML = '<p class="empty">Pas encore de rapport. Cliquez « Relancer la validation ».</p>';
      return;
    }
    const checks = [...new Set(state.report.findings.filter(one => one.level !== 'INFO').map(one => one.check))];
    const chosen = store.get('check', 'all');
    $('check').innerHTML = '<option value="all">Tous</option>' + checks.map(check =>
      '<option value="' + esc(check) + '">' + esc((CHECKS[check] || {}).label || check) + '</option>').join('');
    $('check').value = checks.includes(chosen) ? chosen : 'all';
    select(current);
  }

  /* ---------------- wiring ---------------- */
  $('status').value = store.get('status', 'todo');
  if (store.get('list', '1') === '0') { $('layout').classList.add('no-list'); $('list-toggle').setAttribute('aria-pressed', 'false'); }
  $('check').addEventListener('change', () => { store.set('check', $('check').value); select(current); });
  $('status').addEventListener('change', () => { store.set('status', $('status').value); select(current); });
  $('list-toggle').addEventListener('click', () => {
    const hidden = $('layout').classList.toggle('no-list');
    $('list-toggle').setAttribute('aria-pressed', String(!hidden));
    store.set('list', hidden ? '0' : '1');
  });
  $('rerun').addEventListener('click', () => load(true));
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('list').addEventListener('click', event => {
    const button = event.target.closest('[data-key]');
    if (button) select(button.dataset.key);
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-show]');
    if (button) showOnSite(button.dataset.show);
  });
  $('verdict').addEventListener('click', event => {
    const button = event.target.closest('[data-verdict]');
    if (button) giveVerdict(button.dataset.verdict);
  });
  $('verdict').addEventListener('submit', event => event.preventDefault());
  function shortcut(event) {
    const target = event.target;
    if ((target && target.matches && target.matches('input, select, textarea, [contenteditable="true"]'))
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'e' || event.key === 'E') { event.preventDefault(); giveVerdict('error'); }
    else if (event.key === 'o' || event.key === 'O') { event.preventDefault(); giveVerdict('ok'); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
  }
  document.addEventListener('keydown', shortcut);
  /* The site on the right is served from here too, so the keys still work after a click in it. */
  $('site').addEventListener('load', () => {
    try { $('site').contentWindow.addEventListener('keydown', shortcut); } catch { /* another origin */ }
  });
  load(false);
})();

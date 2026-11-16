'use strict';
/*
 * The review page. One question per finding: do the RealmEye page and the
 * site's card show the same thing? The pictures answer it; the client's values
 * are right by definition and only hint at a wrong join. When they are not the
 * same, the person picks the client object RealmEye means. Served by
 * tools/review-server.js, which writes the answers.
 */
(() => {
  const CHECKS = {
    'page-pictures': {
      label: 'Images à comparer',
      what: 'Cette page RealmEye est reliée à plusieurs objets du client qui n\'ont pas la même image.'
    },
    'enemy-stats': {
      label: 'Ennemi : valeurs différentes',
      what: 'RealmEye ne donne pas les mêmes <span class="stat-hp">PV</span> ou la même <span class="stat-def">DEF</span> que la fiche. Le client fait foi : l\'écart dit seulement que la page est peut-être reliée au mauvais objet.'
    },
    'enemy-attacks': {
      label: 'Ennemi : tirs différents',
      what: 'Les tirs montrés par RealmEye ne sont tirés par aucun objet du client relié à la page : elle est peut-être reliée au mauvais objet.'
    },
    'item-stats': {
      label: 'Objet : valeurs différentes',
      what: 'Le palier ou les bonus annoncés par RealmEye diffèrent du client. Le client fait foi : l\'écart dit seulement que la page décrit peut-être une autre version de l\'objet.'
    },
    'folded-target': {
      label: 'Lien vers une fiche repliée',
      what: 'Des liens RealmEye mènent à une fiche repliée sous une autre qui ne lui ressemble pas.'
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
  let picking = false;          // "not the same": choosing the right record
  /* Every answer given, newest last, with what was there before: "go back" puts it back. */
  let history = [];
  try { history = JSON.parse(localStorage.getItem('review.history') || '[]'); } catch { history = []; }
  function keepHistory() {
    history = history.slice(-200);
    try { localStorage.setItem('review.history', JSON.stringify(history)); } catch { /* private window */ }
    $('undo').disabled = !history.length;
    const last = history[history.length - 1];
    $('undo').title = last ? 'Annule la réponse donnée sur « ' + last.title + ' » et y revient (raccourci : Z)' : 'Aucune réponse à annuler';
  }

  const keyOf = one => one.check + '|' + one.key;
  const findingOf = key => state.report.findings.find(one => keyOf(one) === key);
  function verdictOf(one) {
    const verdict = state.verdicts[keyOf(one)];
    return verdict && verdict.message === one.message ? verdict : null;
  }
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
  const others = one => ((one.data && one.data.candidates) || []).filter(id => !((one.data && one.data.shown) || []).includes(id));
  function visible() {
    const check = $('check').value;
    const status = $('status').value;
    return state.report.findings.filter(one => {
      if (!one.review) return false;
      if (check !== 'all' && one.check !== check) return false;
      const s = statusOf(one);
      if (status === 'todo') return s === 'todo' || s === 'stale';
      return status === 'all' || s === status;
    });
  }

  /* ---------------- drawing ---------------- */
  function sprite(record, box) {
    const art = record && record.art;
    if (!art || !state.sheet) return '<div class="sprite none" style="width:' + box + 'px;height:' + box + 'px" aria-label="pas d\'image"></div>';
    const [x, y, w, h] = art;
    const scale = Math.max(1, Math.floor(box / Math.max(w, h)));
    return '<div class="sprite" role="img" aria-label="' + esc(record.name) + '" style="'
      + 'width:' + (w * scale) + 'px;height:' + (h * scale) + 'px;'
      + 'background-image:url(/web/assets/index/sheet.png);'
      + 'background-size:' + (state.sheet.wide * scale) + 'px ' + (state.sheet.tall * scale) + 'px;'
      + 'background-position:' + (-x * scale) + 'px ' + (-y * scale) + 'px"></div>';
  }
  function nameOf(id) {
    const record = state.records[id];
    return record ? (record.said || record.name) : id;
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

  /* The two pictures side by side: the whole point of the page. */
  function picturePair(one) {
    const page = one.data && one.data.page && state.report.pages[one.data.page];
    const shown = (one.data && one.data.shown || [])[0];
    const main = page && page.images[0];
    const left = main
      ? '<img src="' + esc(main.src) + '" alt="' + esc(main.alt) + '" referrerpolicy="no-referrer">'
      : '<div class="sprite none" style="width:128px;height:128px"></div>';
    const record = state.records[shown];
    return '<div class="pair">'
      + '<figure><div class="frame">' + left + '</div><figcaption><b>RealmEye</b>'
      + (page ? '<a href="' + esc(page.url) + '" target="_blank" rel="noopener">' + esc(page.title) + ' ↗</a>'
        + (page.version || page.date ? '<small>page de ' + esc([page.version, page.date].filter(Boolean).join(', ')) + '</small>' : '')
        : '<small>pas de page dans l\'archive</small>') + '</figcaption></figure>'
      + '<figure><div class="frame">' + sprite(record, 128) + '</div><figcaption><b>Le site</b>'
      + '<span>' + esc(nameOf(shown)) + '</span>'
      + (record && record.alias ? '<small>client : ' + esc(record.alias) + '</small>' : '') + '</figcaption></figure>'
      + '</div>'
      + (page && page.images.length > 1 ? '<div class="re-pics" aria-label="Autres images de la page">'
        + page.images.slice(1).map(image => '<figure><img src="' + esc(image.src) + '" alt="' + esc(image.alt)
          + '" loading="lazy" referrerpolicy="no-referrer"><figcaption>' + esc(image.alt) + '</figcaption></figure>').join('')
        + '</div>' : '');
  }

  function hints(one) {
    const data = one.data || {};
    const stated = data.stated || [];
    const hps = stated.map(pair => pair[0]);
    const defs = stated.map(pair => pair[1]).filter(value => value !== null && value !== undefined);
    const isItem = one.check === 'item-stats' || (state.records[(data.shown || [])[0]] || {}).kind === 'item';
    const ids = [...(data.shown || []), ...others(one)];
    let rows = '';
    if (stated.length) {
      rows += '<tr class="realmeye"><td></td><td class="name"><b>RealmEye</b><span class="role">la page annonce</span></td>'
        + '<td class="num stat-hp">' + hps.map(num).join(' / ') + '</td>'
        + '<td class="num stat-def">' + (defs.length ? defs.map(num).join(' / ') : '—') + '</td><td></td></tr>';
    }
    for (const id of ids) {
      const record = state.records[id];
      const role = (data.shown || []).includes(id) ? 'montrée par le site' : 'autre objet du client';
      rows += '<tr data-record="' + esc(id) + '" aria-selected="' + (id === shownRecord) + '">'
        + '<td>' + sprite(record, 40) + '</td>'
        + '<td class="name"><b>' + esc(nameOf(id)) + '</b>'
        + (record && record.alias ? '<small>client : ' + esc(record.alias) + '</small>' : '')
        + '<span class="role">' + role + '</span></td>'
        + (isItem
          ? '<td class="num" colspan="2">' + (record && record.tier !== undefined ? 'T' + record.tier + ' · ' : '') + worn(record) + '</td>'
          : '<td class="num stat-hp' + matchClass(record && record.hp, hps) + '">' + num(record && record.hp) + '</td>'
            + '<td class="num stat-def' + matchClass(record && record.def, defs) + '">' + num(record && record.def) + '</td>')
        + '<td><button type="button" data-show="' + esc(id) + '">Voir à droite</button></td></tr>';
    }
    const head = isItem
      ? '<tr><th></th><th>Objet du client</th><th class="num" colspan="2">Palier · bonus</th><th></th></tr>'
      : '<tr><th></th><th>Objet du client</th><th class="num stat-hp">PV</th><th class="num stat-def">DEF</th><th></th></tr>';
    let extra = '';
    if (data.shots) extra += '<p class="hint-line">Tirs montrés par RealmEye : ' + data.shots.map(esc).join(', ') + '</p>';
    if (data.problems) extra += '<ul class="plain">' + data.problems.map(problem => '<li>' + esc(problem) + '</li>').join('') + '</ul>';
    if (data.from) extra += '<p class="hint-line">Liens venant de : ' + data.from.map(esc).join(', ') + '</p>';
    return '<details class="card hints"' + (one.check === 'page-pictures' ? '' : ' open') + '>'
      + '<summary>Indices · les valeurs du client font foi</summary>'
      + '<table class="rows"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' + extra
      + '<details class="raw"><summary>Constat brut du validateur</summary><p>' + esc(one.message) + '</p></details></details>';
  }

  function drawDetail(one) {
    const meta = CHECKS[one.check] || { label: one.check, what: '' };
    const verdict = state.verdicts[keyOf(one)];
    const stale = verdict && verdict.message !== one.message;
    $('detail').innerHTML = '<span class="badge">' + esc(meta.label) + '</span>'
      + '<p class="what">' + meta.what + '</p>'
      + (stale ? '<p class="stale-note">Un avis avait été donné le ' + esc(verdict.at) + ' (' + (verdict.verdict === 'ok' ? 'même chose' : 'pas la même chose')
        + ') ; les données ont changé depuis, il faut regarder à nouveau.</p>' : '')
      + picturePair(one)
      + hints(one);
    $('records').innerHTML = [...((one.data && one.data.shown) || []), ...others(one)].map(id =>
      '<button type="button" data-show="' + esc(id) + '" aria-pressed="' + (id === shownRecord) + '">'
      + esc((state.records[id] && state.records[id].alias) || nameOf(id)) + '</button>').join('');
  }

  function drawVerdict(one) {
    const verdict = one ? verdictOf(one) : null;
    const candidates = one ? others(one) : [];
    for (const button of document.querySelectorAll('.verdict [data-verdict]')) {
      if (button.dataset.verdict !== 'skip') {
        button.setAttribute('aria-pressed', String(Boolean(verdict) && button.dataset.verdict === verdict.verdict));
      }
    }
    const picker = $('picker');
    if (!one || !(picking || (verdict && verdict.verdict === 'error' && candidates.length))) { picker.hidden = true; picker.innerHTML = ''; return; }
    picker.hidden = false;
    picker.innerHTML = '<p class="question">Lequel est l\'objet de l\'image RealmEye ?</p><div class="tiles">'
      + candidates.map((id, at) => '<button type="button" data-pick="' + esc(id) + '" aria-pressed="' + Boolean(verdict && verdict.pick === id) + '">'
        + sprite(state.records[id], 64) + '<span>' + esc(nameOf(id)) + '</span>'
        + (state.records[id] && state.records[id].alias ? '<small>' + esc(state.records[id].alias) + '</small>' : '')
        + (at < 9 ? '<kbd>' + (at + 1) + '</kbd>' : '') + '</button>').join('')
      + '<button type="button" data-pick="" class="none" aria-pressed="' + Boolean(verdict && verdict.verdict === 'error' && !verdict.pick) + '">'
      + '<span>Aucun de ceux-ci</span><kbd>0</kbd></button></div>';
  }

  function showOnSite(id) {
    shownRecord = id;
    const hash = '#index?' + new URLSearchParams({ open: id }).toString();
    $('site').src = '/web/' + hash;
    $('site-open').href = '/web/' + hash;
    for (const node of $('records').querySelectorAll('[data-show]')) node.setAttribute('aria-pressed', String(node.dataset.show === id));
    for (const row of document.querySelectorAll('tr[data-record]')) row.setAttribute('aria-selected', String(row.dataset.record === id));
  }

  function drawList(items) {
    if (!items.length) {
      $('list').innerHTML = '<p class="none">Rien dans ce filtre.</p>';
      return;
    }
    $('list').innerHTML = items.map(one => '<button type="button" data-key="' + esc(keyOf(one)) + '" aria-current="' + (keyOf(one) === current) + '">'
      + '<span class="dot ' + statusOf(one) + '" aria-hidden="true"></span>'
      + '<span><span class="t">' + esc(titleOf(one)) + '</span><span class="k">' + esc((CHECKS[one.check] || {}).label || one.check)
      + '</span></span></button>').join('');
  }

  function drawTally() {
    const all = state.report.findings.filter(one => one.review);
    const count = status => all.filter(one => (status === 'todo' ? ['todo', 'stale'].includes(statusOf(one)) : statusOf(one) === status)).length;
    $('tally').innerHTML = '<span class="t-todo">À regarder <b>' + count('todo') + '</b></span>'
      + '<span class="t-error">Pas la même chose <b>' + count('error') + '</b></span>'
      + '<span class="t-ok">Même chose <b>' + count('ok') + '</b></span>';
  }

  function select(key) {
    const items = visible();
    const one = items.find(item => keyOf(item) === key) || items[0];
    current = one ? keyOf(one) : null;
    picking = false;
    drawList(items);
    drawTally();
    if (!one) {
      $('detail').innerHTML = '<p class="empty">Rien à regarder dans ce filtre. Changez de statut ou de contrôle en haut.</p>';
      $('records').innerHTML = '';
      $('position').textContent = '0 / 0';
      $('site').src = 'about:blank';
      drawVerdict(null);
      return;
    }
    $('position').textContent = (items.indexOf(one) + 1) + ' / ' + items.length;
    shownRecord = (one.data && one.data.shown || [])[0] || null;
    drawDetail(one);
    if (shownRecord) showOnSite(shownRecord);
    const verdict = verdictOf(one);
    $('note').value = verdict ? verdict.note || '' : '';
    drawVerdict(one);
    $('saved').textContent = '';
    const node = $('list').querySelector('[aria-current="true"]');
    if (node) node.scrollIntoView({ block: 'nearest' });
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

  async function save(verdict, pick) {
    const one = findingOf(current);
    const items = visible();
    const at = items.findIndex(item => keyOf(item) === current);
    const was = verdictOf(one);
    const same = was && was.verdict === verdict && (verdict === 'ok' || (was.pick || null) === (pick || null));
    try {
      const body = { key: current, verdict: same ? null : verdict, note: $('note').value };
      if (!same && pick) body.pick = pick;
      const before = state.verdicts[current] || null;
      state.verdicts = (await api('verdict', body)).verdicts;
      history.push({ key: current, title: titleOf(one), before });
      keepHistory();
    } catch (error) {
      $('saved').textContent = 'Non enregistré : ' + error.message;
      return;
    }
    const left = visible();
    const still = left.findIndex(item => keyOf(item) === current);
    const next = still >= 0 && !same ? left[(still + 1) % left.length] : left[Math.min(at, left.length - 1)];
    const said = same ? 'Avis retiré.'
      : verdict === 'ok' ? 'Enregistré : même chose.'
        : pick ? 'Enregistré : pas la même chose, c\'est « ' + nameOf(pick) + ' ». La prochaine mise à jour des données l\'utilisera.'
          : 'Enregistré : pas la même chose.';
    select(next ? keyOf(next) : null);
    $('saved').textContent = said;
  }

  function answer(verdict) {
    if (!current) return;
    if (verdict === 'skip') { step(1); return; }
    const one = findingOf(current);
    if (verdict === 'error' && others(one).length && !picking) {
      picking = true;                         // first say which one it is
      drawVerdict(one);
      $('saved').textContent = 'Cliquez l\'objet qui correspond à l\'image RealmEye (ou « Aucun »).';
      return;
    }
    save(verdict, null);
  }

  async function undo() {
    const last = history[history.length - 1];
    if (!last || !state) return;
    const before = last.before;
    try {
      const body = { key: last.key, verdict: before ? before.verdict : null, note: before ? before.note || '' : '' };
      if (before && before.pick) body.pick = before.pick;
      state.verdicts = (await api('verdict', body)).verdicts;
    } catch (error) {
      // The finding is gone from the report (data changed): drop it from the history.
      history.pop();
      keepHistory();
      $('saved').textContent = 'Impossible de revenir sur « ' + last.title + ' » : ' + error.message;
      return;
    }
    history.pop();
    keepHistory();
    const one = findingOf(last.key);
    if (one && !visible().includes(one)) {          // put it where it can be seen again
      $('status').value = statusOf(one) === 'todo' || statusOf(one) === 'stale' ? 'todo' : 'all';
      if ($('check').value !== 'all' && $('check').value !== one.check) $('check').value = 'all';
    }
    select(last.key);
    $('saved').textContent = 'Réponse annulée sur « ' + last.title + ' »'
      + (before ? " : l'avis précédent (" + (before.verdict === 'ok' ? 'même chose' : 'pas la même chose') + ') est remis.' : ' : de nouveau à regarder.');
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
    const checks = [...new Set(state.report.findings.filter(one => one.review).map(one => one.check))];
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
  $('undo').addEventListener('click', undo);
  keepHistory();
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('list').addEventListener('click', event => {
    const button = event.target.closest('[data-key]');
    if (button) select(button.dataset.key);
  });
  document.addEventListener('click', event => {
    const show = event.target.closest('[data-show]');
    if (show) showOnSite(show.dataset.show);
  });
  $('verdict').addEventListener('click', event => {
    const pick = event.target.closest('[data-pick]');
    if (pick) { save('error', pick.dataset.pick || null); return; }
    const button = event.target.closest('[data-verdict]');
    if (button) answer(button.dataset.verdict);
    if (picking && event.target.closest('#undo')) { picking = false; drawVerdict(findingOf(current)); }
  });
  $('verdict').addEventListener('submit', event => event.preventDefault());
  function shortcut(event) {
    const target = event.target;
    if ((target && target.matches && target.matches('input, select, textarea, [contenteditable="true"]'))
      || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'o' || key === 'O') { event.preventDefault(); answer('ok'); }
    else if (key === 'e' || key === 'E') { event.preventDefault(); answer('error'); }
    else if (key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (key === 'z' || key === 'Z' || key === 'Backspace') { event.preventDefault(); undo(); }
    else if (key === 'Escape' && picking) { event.preventDefault(); picking = false; drawVerdict(findingOf(current)); $('saved').textContent = ''; }
    else if (picking && /^[0-9]$/.test(key)) {
      const one = findingOf(current);
      const candidates = others(one);
      if (key === '0') { event.preventDefault(); save('error', null); }
      else if (candidates[Number(key) - 1]) { event.preventDefault(); save('error', candidates[Number(key) - 1]); }
    }
  }
  document.addEventListener('keydown', shortcut);
  /* The site on the right is served from here too, so the keys still work after a click in it. */
  $('site').addEventListener('load', () => {
    try { $('site').contentWindow.addEventListener('keydown', shortcut); } catch { /* another origin */ }
  });
  load(false);
})();

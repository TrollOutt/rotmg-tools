'use strict';
/*
 * The White Snake Invasion leaderboard, read live from DECA's own sheet.
 *
 * Nothing is copied into the repository: the sheet is fetched each time the
 * panel opens and every two minutes while it stays open, so the standings
 * are DECA's latest without anyone republishing the site. The rules, the
 * reward tiers and the window are read from the sheet's own side notes too,
 * and the values below are only what is shown if one of them cannot be read.
 *
 * To retire it, delete the #snakeNote button from index.html (or let
 * HIDE_AFTER pass: the button hides itself).
 */
(() => {
  /*
   * The page itself. The type check runs without the DOM library
   * (tsconfig.json), so the browser's objects are reached through globalThis
   * and typed loosely; everything this file computes is typed below.
   */
  /** @type {any} */
  const host = globalThis;
  const document = host.document;

  /** @typedef {{ pct: number, items: string[], above: boolean }} Tier */
  /** @typedef {{ name: string, points: number, rank: number, tier: Tier | null }} Player */
  /** @typedef {{ start: number, end: number, points: Array<[string, number]>, tiers: Tier[], fine: string[] }} Info */
  /** @typedef {Info & { players: Player[] }} Board */
  /** @typedef {{ id: string, art?: number[] }} IndexRecord */

  const note = document.getElementById('snakeNote');
  if (!note) return;

  /*
   * The one remote origin this file reads. tools/build-standalone.js copies it
   * into the published page's security policy (connect-src), so it
   * must stay written exactly like this. The gviz route answers from this
   * origin; the CSV export redirects to a googleusercontent.com host that the
   * policy does not open, so it is not used.
   */
  const SHEET_ORIGIN = 'https://docs.google.com';
  const SHEET = '1abJ5b1rOG-dB-cDHUr11cADoeWqxT7WB0lo-CntcsE8';
  const GID = '0';
  const VIEW = `${SHEET_ORIGIN}/spreadsheets/d/${SHEET}/edit?gid=${GID}#gid=${GID}`;
  const SOURCES = [`${SHEET_ORIGIN}/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&gid=${GID}`];
  const YEAR = 2026;
  /** @type {Info} */
  const FALLBACK = {
    start: Date.UTC(YEAR, 10, 24, 9),
    end: Date.UTC(YEAR, 11, 1, 9),
    points: [['White Snake Invasion I', 1], ['White Snake Invasion II', 2], ['White Snake Invasion III', 3]],
    tiers: [
      { pct: 5, items: ['2x Rare Epic Quest Chest', "3x Legend of the White Snake Mystery Chest", "1x Eden's Embrace", '1x Seasonal Vault Unlocker'], above: true },
      { pct: 15, items: ['1x Backpack Extender', '1x Medium Dust Selection Chest', '1x Paramount Sulphur', '3x The Mystery Chest'], above: true },
      { pct: 30, items: ['1x Lucky Clover', '1x Backpack', "1x Adventurer's Belt", '10x Mystery Stat Pot', "2x Legend of the White Snake Mystery Chest"], above: false }
    ],
    fine: []
  };
  /* Rewards go out when the next season starts; the note stays until then. */
  const HIDE_AFTER = Date.UTC(YEAR, 11, 22);
  const REFRESH = 120e3, SHOWN = 1000;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /** @param {unknown} s */
  const esc = s => String(s).replace(/[&<>"']/g, c => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = {
    /** @param {string} k @returns {string} */
    get(k) { try { return host.localStorage.getItem(k) || ''; } catch (_) { return ''; } },
    /** @param {string} k @param {string} v */
    set(k, v) { try { host.localStorage.setItem(k, v); } catch (_) {} }
  };

  /** @type {Board | null} */
  let board = null;
  /** @type {Promise<Board | null> | null} */
  let reading = null;
  /** @type {any} the panel, once built */
  let veil = null;
  /** @type {Map<string, IndexRecord> | null} */
  let records = null;
  /** @type {{ sheet: { wide: number, tall: number } } | null} the Index's picture sheet */
  let itemArt = null;
  let readAt = 0, failed = false, recordsAsked = false;
  /** @type {unknown} */
  let timer = 0;
  let query = store.get('snake-board-search');

  if (Date.now() > HIDE_AFTER) { note.remove(); return; }
  note.hidden = false;

  /* ---- reading the sheet ------------------------------------------------ */

  /** @param {string} text @returns {string[][]} */
  function parseCsv(text) {
    /** @type {string[][]} */
    const rows = [];
    /** @type {string[]} */
    let row = [];
    let cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /** @param {unknown} s */
  const number = s => { const n = Number(String(s).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };

  /** @param {string} month @param {string} day @param {string} h @param {string} m */
  function stamp(month, day, h, m) {
    const at = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
    return at < 0 ? NaN : Date.UTC(YEAR, at, +day, +h, +m);
  }

  /** @param {string[]} notes @returns {Info} */
  function readNotes(notes) {
    /** @type {Info} */
    const out = { start: FALLBACK.start, end: FALLBACK.end, points: [], tiers: [], fine: [] };
    for (const text of notes) {
      const dates = [...text.matchAll(/([A-Z][a-z]{2,8})\.?\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*\(UTC\)/g)]
        .map(m => stamp(m[1], m[2], m[3], m[4]));
      if (dates.length >= 2 && dates.every(Number.isFinite)) { [out.start, out.end] = dates; continue; }
      const point = /^Each (.+?) completion equals to (\d+) points?/i.exec(text.trim());
      if (point) { out.points.push([point[1], +point[2]]); continue; }
      if (/Top\s+\d+\s*%/i.test(text)) {
        for (const block of text.split(/\n\s*\n/)) {
          const lines = block.split('\n').map(s => s.trim()).filter(Boolean);
          const head = /Top\s+(\d+)\s*%/i.exec(lines[0] || '');
          if (!head) continue;
          const rest = lines.slice(1);
          out.tiers.push({ pct: +head[1], items: rest.filter(l => !/^\+\s*above/i.test(l)), above: rest.some(l => /^\+\s*above/i.test(l)) });
        }
        continue;
      }
      if (/^disclaimer:?$/i.test(text.trim())) continue;
      out.fine.push(...text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean));
    }
    if (!out.points.length) out.points = FALLBACK.points;
    if (!out.tiers.length) out.tiers = FALLBACK.tiers;
    out.tiers.sort((a, b) => a.pct - b.pct);
    return out;
  }

  /** @param {string} text @returns {Board} */
  function readBoard(text) {
    const rows = parseCsv(text);
    const headAt = rows.findIndex(r => r.some(c => c.trim().toLowerCase() === 'name'));
    const head = headAt < 0 ? [] : rows[headAt].map(c => c.trim().toLowerCase());
    /** @param {string} name */
    const col = name => head.indexOf(name);
    const NAME = col('name');
    /* gviz types a mostly numeric column as numbers and blanks its text
       heading, so a missing heading falls back on the sheet's own order. */
    const POINTS = col('points') >= 0 ? col('points') : NAME >= 0 ? NAME + 1 : -1;
    const RANK = col('rank') >= 0 ? col('rank') : NAME >= 0 ? NAME + 2 : -1;
    const table = new Set([NAME, POINTS, RANK].filter(i => i >= 0));
    /** @type {string[]} */
    const notes = [];
    for (const row of rows) row.forEach((cell, i) => { if (!table.has(i) && cell.trim()) notes.push(cell); });
    /** @type {Player[]} */
    const players = [];
    if (NAME >= 0) for (const row of rows.slice(headAt + 1)) {
      const name = (row[NAME] || '').trim();
      if (!name) continue;
      players.push({ name, points: number(row[POINTS]), rank: RANK >= 0 ? number(row[RANK]) : 0, tier: null });
    }
    if (players.some(p => !p.rank)) {
      players.sort((a, b) => b.points - a.points);
      players.forEach((p, i) => { p.rank = i && p.points === players[i - 1].points ? players[i - 1].rank : i + 1; });
    } else players.sort((a, b) => a.rank - b.rank);
    const info = readNotes(notes);
    for (const p of players) p.tier = info.tiers.find(t => p.rank <= Math.floor(players.length * t.pct / 100)) || null;
    return { players, ...info };
  }

  /** @returns {Promise<Board | null>} */
  async function read() {
    if (reading) return reading;
    reading = (async () => {
      for (const url of SOURCES) {
        try {
          const res = await host.fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          board = readBoard(await res.text());
          readAt = Date.now(); failed = false;
          return board;
        } catch (_) { /* the next route, then the error state */ }
      }
      failed = true;
      return board;
    })();
    try { return await reading; } finally { reading = null; }
  }

  /* ---- what the Index holds of each reward and dungeon ------------------
   * The same served Index the voucher and the Index page read (app.js shares
   * one request). A reward the Index does not hold yet links to its RealmEye
   * page instead, and picks up its picture and card once a scrape brings it. */

  function loadRecords() {
    if (recordsAsked) return;
    recordsAsked = true;
    (async () => {
      const shared = host.ROTMG_SHARED_DATA || (host.ROTMG_SHARED_DATA = {});
      /** @type {{ records: IndexRecord[] } | null} */
      let said = shared.index || null;
      if (!said) {
        let raw = host.ROTMG_BUNDLE && host.ROTMG_BUNDLE.sources && host.ROTMG_BUNDLE.sources.indexText;
        if (!raw && typeof host.sharedIndexText === 'function') raw = await host.sharedIndexText().catch(() => '');
        if (!raw) return;
        said = /** @type {{ records: IndexRecord[] }} */ (JSON.parse(raw));
        shared.index = said;
      }
      /* app.js's loader of the Index pictures, which answers with their sheet. */
      if (typeof host.ensureItemArt === 'function') itemArt = await host.ensureItemArt();
      records = new Map(said.records.map(one => [one.id, one]));
      if (veil && !veil.hidden) paint();
    })().catch(() => { recordsAsked = false; });
  }

  /** @param {string} name @param {string[]} kinds @returns {IndexRecord | null} */
  function recordFor(name, kinds) {
    if (!records) return null;
    for (const kind of kinds) { const one = records.get(kind + ':' + name); if (one) return one; }
    return null;
  }

  /** @param {IndexRecord | null} one @param {number} side */
  function art(one, side) {
    const sheet = itemArt && itemArt.sheet;
    if (!one || !one.art || !sheet) return '';
    const [x, y, w, h] = one.art, zoom = side / Math.max(w, h);
    return `<span class="ix-cell"><span class="ix-art" style="width:${w * zoom}px;height:${h * zoom}px;`
      + `background-image:var(--ix-sheet,var(--sheet));background-size:${sheet.wide * zoom}px ${sheet.tall * zoom}px;`
      + `background-position:${-x * zoom}px ${-y * zoom}px"></span></span>`;
  }

  /*
   * DECA's sheet names some rewards loosely. These are the client's names for
   * them, so they find their Index record. The Seasonal Vault Expansion is the
   * "unlocker": unused when its season ends, it turns into a Vault Chest Unlocker.
   * The client has no "Rare" Epic Quest Chest; the Mystery Quest Chest gives a
   * random Epic Quest Chest, which is what the sheet means by it.
   */
  /** @type {Record<string, string>} */
  const SAME_AS = {
    'Seasonal Vault Unlocker': 'Seasonal Vault Expansion',
    'Medium Dust Selection Chest': 'Medium Dust Chest',
    'Rare Epic Quest Chest': 'Mystery Quest Chest'
  };
  /** @param {string} name */
  const realmeye = name => 'https://www.realmeye.com/wiki/'
    + name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /* One reward or dungeon: its picture, its name, and where it leads. */
  /** @param {string} listed @param {string[]} kinds @param {string} [extra] */
  function thing(listed, kinds, extra) {
    const name = SAME_AS[listed] || listed;
    const one = recordFor(name, kinds);
    const hash = one && host.RealmRoutes ? host.RealmRoutes.indexHash(one.id) : '';
    const said = name !== listed ? `${listed} in DECA's sheet · ` : '';
    const where = hash ? `href="#${esc(hash)}" title="${esc(said)}Open in the Index"`
      : `href="${esc(realmeye(name))}" target="_blank" rel="noopener" title="${esc(said)}Open on RealmEye"`;
    return `<a class="snake-thing${hash ? ' is-index' : ''}" ${where}>`
      + `<span class="snake-art">${art(one, 28)}</span><span class="snake-what">${esc(name)}`
      + `${hash ? '' : ' <span class="snake-out" aria-hidden="true">↗</span>'}</span>${extra || ''}</a>`;
  }

  /* ---- time ------------------------------------------------------------- */

  /** @param {number} ms */
  function span(ms) {
    const m = Math.max(0, Math.round(ms / 60e3));
    const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), r = m % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${r}m` : `${r}m`;
  }
  const window_ = () => board || FALLBACK;
  function phase() {
    const { start, end } = window_(), now = Date.now();
    if (now < start) return { kick: `Starts in ${span(start - now)}`, live: false };
    if (now < end) return { kick: `Live · ${span(end - now)} left`, live: true };
    return { kick: 'Final standings', live: false };
  }
  /** @param {number} t */
  const day = t => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(t);
  /** @param {number} t */
  const utc = t => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(t);
  /** @param {number} t */
  const clock = t => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(t);

  function paintNote() {
    const p = phase();
    note.querySelector('.news-bell-kick').textContent = p.kick;
    note.classList.toggle('is-live', p.live);
  }

  /* ---- the panel -------------------------------------------------------- */

  /** @param {Tier | null} t */
  const tierChip = t => t ? `<span class="snake-tier snake-tier-${t.pct <= 5 ? 'a' : t.pct <= 15 ? 'b' : 'c'}">Top ${t.pct}%</span>` : '';

  function build() {
    veil = document.createElement('div');
    veil.className = 'voucher-veil snake-veil'; veil.hidden = true;
    veil.innerHTML = `<div class="snake-panel" role="dialog" aria-modal="true" aria-labelledby="snakeTitle">
      <button type="button" class="voucher-x" aria-label="Close">×</button>
      <header class="snake-head">
        <p class="snake-kick">Event leaderboard · live from DECA's sheet</p>
        <h2 id="snakeTitle">White Snake Invasion 2026</h2>
        <p class="snake-when"></p>
      </header>
      <div class="snake-body">
        <section class="snake-standings" aria-label="Standings">
          <div class="snake-tools">
            <input type="search" class="snake-find" placeholder="Find your name" aria-label="Find a player" autocomplete="off" spellcheck="false">
            <span class="snake-count"></span>
          </div>
          <div class="snake-scroll"><table class="snake-table">
            <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col"><span class="sr-only">Reward tier</span></th></tr></thead>
            <tbody></tbody>
          </table><p class="snake-empty" hidden></p></div>
        </section>
        <aside class="snake-side">
          <h3>Points</h3><ul class="snake-points"></ul>
          <h3>Rewards</h3><div class="snake-rewards"></div>
          <p class="snake-small">Tiers are worked out from each rank among the players listed; DECA's count decides.</p>
          <details class="snake-fine"><summary>Disclaimer</summary><div></div></details>
        </aside>
      </div>
      <footer class="snake-foot">
        <span class="snake-stamp"></span>
        <button type="button" class="snake-again">Refresh</button>
        <a class="snake-open" href="${VIEW}" target="_blank" rel="noopener">Open the sheet <span aria-hidden="true">↗</span></a>
      </footer>
    </div>`;
    document.body.appendChild(veil);
    const find = veil.querySelector('.snake-find');
    find.value = query;
    find.addEventListener('input', () => { query = find.value; store.set('snake-board-search', query); paintRows(); });
    veil.querySelector('.voucher-x').addEventListener('click', close);
    veil.querySelector('.snake-again').addEventListener('click', () => refresh(true));
    veil.addEventListener('click', /** @param {any} e */ e => {
      if (e.target === veil) close();
      else if (e.target.closest('a.snake-thing.is-index')) close(); // the hash takes it to the Index
    });
    veil.addEventListener('keydown', /** @param {any} e */ e => { if (e.key === 'Escape') close(); });
  }

  function paintRows() {
    const body = veil.querySelector('tbody'), empty = veil.querySelector('.snake-empty');
    const count = veil.querySelector('.snake-count');
    const players = board ? board.players : [];
    const q = query.trim().toLowerCase();
    const hits = q ? players.filter(p => p.name.toLowerCase().includes(q)) : players;
    body.innerHTML = hits.slice(0, SHOWN).map(p => `<tr${p.rank <= 3 ? ` class="snake-podium snake-p${p.rank}"` : ''}>
      <td class="snake-rank">${p.rank}</td><td class="snake-name">${esc(p.name)}</td>
      <td class="snake-pts">${p.points.toLocaleString('en')}</td><td class="snake-t">${tierChip(p.tier)}</td></tr>`).join('');
    count.textContent = !players.length ? '' : q ? `${hits.length} of ${players.length.toLocaleString('en')}`
      : `${players.length.toLocaleString('en')} player${players.length === 1 ? '' : 's'}`;
    empty.hidden = !!hits.length && !(hits.length > SHOWN);
    empty.textContent = !board && failed ? "The sheet could not be read just now. Try Refresh, or open it on Google Sheets."
      : !board ? 'Reading the sheet…'
      : !players.length ? (Date.now() < board.start ? 'The leaderboard opens when the event starts.' : 'No one is on the board yet: DECA fills it as runs are recorded, so look again later.')
      : !hits.length ? 'No player by that name on the board.'
      : `Showing the first ${SHOWN.toLocaleString('en')}. Search for a name to find anyone further down.`;
    veil.querySelector('.snake-table').hidden = !hits.length;
  }

  function paint() {
    const info = window_(), p = phase();
    veil.querySelector('.snake-when').innerHTML = `${esc(day(info.start))} – ${esc(day(info.end))}, ${esc(utc(info.end))} UTC`
      + ` · <b class="${p.live ? 'is-live' : ''}">${esc(p.kick)}</b>`;
    veil.querySelector('.snake-points').innerHTML = info.points.map(([run, n]) =>
      `<li>${thing(run, ['portal', 'dungeon'], `<b class="snake-n">${n} pt${n === 1 ? '' : 's'}</b>`)}</li>`).join('');
    veil.querySelector('.snake-rewards').innerHTML = info.tiers.map((t, i) => `<div class="snake-reward">
      <p>${tierChip(t)}${t.above && info.tiers[i + 1] ? `<span class="snake-plus">+ everything in Top ${info.tiers[i + 1].pct}%</span>` : ''}</p>
      <ul>${t.items.map(item => { const m = /^(\d+)\s*x\s+(.+)$/i.exec(item);
        return `<li>${thing(m ? m[2].trim() : item, ['item'], m ? `<b class="snake-n">×${m[1]}</b>` : '')}</li>`; }).join('')}</ul></div>`).join('');
    const fine = veil.querySelector('.snake-fine');
    fine.hidden = !(board && board.fine.length);
    fine.querySelector('div').innerHTML = board ? board.fine.map(s => `<p>${esc(s)}</p>`).join('') : '';
    veil.querySelector('.snake-stamp').textContent = failed ? (readAt ? `Could not refresh · last read ${clock(readAt)}` : 'Could not read the sheet')
      : readAt ? `Read ${clock(readAt)} · refreshes every 2 min` : 'Reading…';
    paintRows();
  }

  /** @param {boolean} force */
  async function refresh(force) {
    if (!force && board && Date.now() - readAt < 60e3) return paint();
    const again = veil.querySelector('.snake-again');
    again.disabled = true; veil.classList.add('is-reading');
    await read();
    again.disabled = false; veil.classList.remove('is-reading');
    if (!veil.hidden) paint();
    paintNote();
  }

  function open() {
    if (!veil) build();
    veil.hidden = false;
    document.documentElement.classList.add('snake-open');
    paint();
    loadRecords();
    refresh(false);
    host.clearInterval(timer);
    timer = host.setInterval(() => refresh(true), REFRESH);
    (query ? veil.querySelector('.snake-find') : veil.querySelector('.voucher-x')).focus();
  }
  function close() {
    if (!veil || veil.hidden) return;
    veil.hidden = true;
    host.clearInterval(timer);
    document.documentElement.classList.remove('snake-open');
    note.focus();
  }

  note.addEventListener('click', open);
  paintNote();
  host.setInterval(paintNote, 30e3);
})();

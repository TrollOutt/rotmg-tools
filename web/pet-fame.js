/*
 * The Pet Fame Calculator's page: picking a pet, three abilities that rise together along a
 * road to Divine, what each level does, what the yard and the fusions cost, and which food is
 * the cheapest way there. The arithmetic is pet-fame-engine.js; what the client says about
 * pets and food is pet-fame-data.js (tools/build-pet-fame.js). Loaded the first time the page
 * is opened, by ensurePetsPage in app.js.
 */

var PetFame = (function () {
  'use strict';
  const PE = PetFameEngine, D = PetFameData;
  const $ = id => document.getElementById(id);
  const A = { cell: D.pets.cell, cols: D.pets.cols, pets: D.pets.list };
  const F = { cell: D.foods.cell, cols: D.foods.cols, items: D.foods.list };
  const petSheet = new Image(), foodSheet = new Image();   // set in start(), so nobody pays for them before the page is opened
  const GEM = ['', 'uncommon', 'rare', 'legendary', 'divine'];
  const gem = k => GEM[k] ? '<img class="gem" src="' + asset('GUI Files', 'Item Rarities', GEM[k] + '_scaled_8x.png') + '" alt="">' : '';
  const LOOK = { Common: 0, Rare: 2, Divine: 4 };
  const ORD = ['1st', '2nd', '3rd'];
  const RCOL = k => 'var(--' + PE.RARITY[k].toLowerCase() + ')';

  /*
   * One timeline. The pet is a point on the road from a fresh common egg
   * (1st ability at 1) to a maxed Divine: `fp` is the feed power fed so far.
   * Every level, the rarity, the cost and the white line are read from it;
   * dragging a level finds the point where that level is reached, and
   * dragging the line moves the point itself.
   */
  const S = {
    foodSort: 'value',                             // food order: value, feed power or price
    pet: A.pets.find(p => p.n === 'Black Cat'),   // the pet last picked in the list
    locked: false,                                 // locked: that pet everywhere; unlocked: the road's own look
    group: 'family',                               // the list of pets by 'family' or by 'rarity'
    fam: 'Feline', open: new Set(['Feline']),      // the family followed, and the families unfolded in the list
    abil: ['Heal', 'Magic Heal', 'Electric'],
    fp: 0, upTo: 3, pay: 'fame', mode: 'action', yard: 0,   // yard: the tier already bought
    // The food the whole road is priced with: a 750 feed power item to begin with (Cloak of the Planewalker).
    food: F.items.find(f => f.name === 'Cloak of the Planewalker') || F.items.find(f => f.fp === 750) || F.items[0]
  };

  /* ---------- the timeline ---------- */
  let segs = [], total = 0;
  function build() {
    segs = PE.road(0, [1, 1, 1], S.upTo);
    total = segs.reduce((s, g) => s + g.fp, 0);
    S.fp = Math.min(S.fp, total);
  }
  // Exact (fractional) levels and the stage at a point of the road.
  function at(fp) {
    let left = fp;
    for (const g of segs) {
      if (left <= g.fp || g.k === 4) {
        const f = Math.min(left, g.fp);
        const exact = g.start.map((l, n) => (n < g.open ? PE.levelAfter(n, l, f, PE.CAP[g.k]) : 0));
        return { k: g.k, fpIn: f, exact, lv: exact.map(Math.floor) };
      }
      left -= g.fp;
    }
  }
  // The first point of the road where ability n reaches level L.
  function fpForLevel(n, L) {
    if (at(total).lv[n] < L) return total;
    let lo = 0, hi = total;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (at(mid).lv[n] >= L) hi = mid; else lo = mid; }
    return hi;
  }
  const cost = (k, items) => items * PE.FEED[k][S.pay] + (S.pay === 'gold' ? items * S.food.gold : 0);
  const cur = () => S.pay;
  // What the road has cost up to fp: feeding with the chosen food, plus each fusion and yard passed.
  // Getting to stage k (k > 0): fusing two pets of the stage before, in a yard one tier up.
  const fuseInto = k => PE.FUSE[k - 1][S.pay];
  const yardFor = k => (k <= S.yard ? 0 : PE.YARD[k][S.pay]);
  function spentTo(fp) {
    let left = fp;
    const out = { feed: 0, fuse: 0, yard: 0 };
    for (const g of segs) {
      if (left <= 0) break;
      const f = Math.min(left, g.fp); left -= f;
      out.feed += cost(g.k, Math.ceil(f / S.food.fp));
      if (left > 0 && g.k < 4) { out.fuse += fuseInto(g.k + 1); out.yard += yardFor(g.k + 1); }
    }
    out.all = out.feed + out.fuse + out.yard;
    return out;
  }

  /* ---------- sprites ---------- */
  const framesOf = (p, act) => p.a.map((a, i) => ({ a, i })).filter(x => x.a === act).map(x => x.i);
  const body = p => p.bw || (p.bw = Math.min(...p.fw.filter((w, i) => p.a[i] !== 2).concat(p.a.every(a => a === 2) ? p.fw : [])));
  const spriteSize = p => Math.max(body(p), p.ht);
  // The scale that draws a pet `target` pixels tall, so an 8, 16 or 32 pixel sprite all come out
  // the same size. A whole number when one is close, so most pixels stay square.
  const petScale = (p, target) => { const k = target / spriteSize(p), w = Math.round(k); return w >= 1 && Math.abs(k - w) / k < .15 ? w : k; };
  function drawPet(ctx, p, i, x, y, k, flip) {
    const cell = p.c + i, sx = (cell % A.cols) * A.cell, sy = Math.floor(cell / A.cols) * A.cell + (A.cell - p.ht);
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); if (flip) ctx.scale(-1, 1);
    ctx.drawImage(petSheet, sx, sy, p.fw[i], p.ht, Math.round(-body(p) / 2 * k), -p.ht * k, p.fw[i] * k, p.ht * k);
    ctx.restore();
  }
  function petThumb(p, px) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const go = () => { const i = framesOf(p, 0)[0] ?? framesOf(p, 1)[0] ?? 0; drawPet(g, p, i, px / 2, px - 2, Math.max(1, Math.floor((px - 4) / spriteSize(p))), false); };
    petSheet.complete ? go() : petSheet.addEventListener('load', go);
    return c;
  }
  function foodIcon(f, px) {
    const c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const go = () => g.drawImage(foodSheet, (f.i % F.cols) * F.cell, Math.floor(f.i / F.cols) * F.cell, F.cell, F.cell, 0, 0, px, px);
    foodSheet.complete ? go() : foodSheet.addEventListener('load', go);
    return c;
  }

  /* ---------- 1 · pets by family ---------- */
  const fams = [...new Set(A.pets.map(p => p.f || '?'))].sort((a, b) => a.localeCompare(b));
  fams.forEach(f => $('pfFam').add(new Option(f, f)));
  /*
   * The list of pets, by family or by rarity of look. Either way a group folds when its title is
   * clicked, a search unfolds what it finds, and a family can be picked to show only that one.
   */
  const LOOKS = ['Common', 'Rare', 'Divine'];
  const LOOK_NAME = { Common: 'Common', Rare: 'Rare', Divine: 'Divine' };
  function renderPets() {
    const q = $('pfQ').value.trim().toLowerCase(), fam = $('pfFam').value, list = $('pfPetList');
    const byRarity = S.group === 'rarity';
    list.innerHTML = '';
    const matches = A.pets.filter(p => (!fam || (p.f || '?') === fam) && (!q || p.n.toLowerCase().includes(q)));
    const groups = byRarity
      ? LOOKS.map(r => ({ key: 'r:' + r, title: r, gem: gem(LOOK[r]), cur: S.pet && S.pet.r === r, pets: matches.filter(p => p.r === r).sort((x, y) => (x.f || '').localeCompare(y.f || '') || x.n.localeCompare(y.n)) }))
      : fams.map(f => ({ key: f, title: f, cur: f === S.fam, pets: matches.filter(p => (p.f || '?') === f).sort((x, y) => (ORDER[x.r] ?? 3) - (ORDER[y.r] ?? 3) || x.n.localeCompare(y.n)) }));
    let n = 0;
    groups.forEach(g => {
      if (!g.pets.length) return;
      n += g.pets.length;
      // A search unfolds what it finds; otherwise a group shows its pets only once unfolded.
      const open = q || S.open.has(g.key);
      const head = document.createElement('div');
      head.className = 'fam' + (open ? ' open' : '') + (g.cur ? ' cur' : '');
      head.innerHTML = '<span><span class="tw">▸</span>' + (g.gem || '') + ' ' + g.title + '</span><b>' + g.pets.length + '</b>';
      head.onclick = () => { S.open.has(g.key) ? S.open.delete(g.key) : S.open.add(g.key); renderPets(); };
      list.appendChild(head);
      if (!open) return;
      g.pets.forEach(p => {
        const row = document.createElement('div');
        const locked = S.locked && p === S.pet;
        row.className = 'pet' + (locked ? ' on' : '');
        row.title = locked ? 'Locked — click again to let the road choose the look' : 'Lock this pet';
        row.appendChild(petThumb(p, 34));
        // By family the look is the badge; by rarity the family is, since the look is already the title.
        row.insertAdjacentHTML('beforeend', '<span>' + p.n + '</span>' + (locked ? '<span class="lock">🔒</span>' : byRarity ? '<span class="famtag">' + (p.f || '?') + '</span>' : gem(LOOK[p.r])));
        row.onclick = () => {
          if (locked) S.locked = false;
          else { S.pet = p; S.fam = p.f || '?'; S.locked = true; S.open.add(byRarity ? 'r:' + p.r : S.fam); }
          renderPets(); render();
        };
        list.appendChild(row);
      });
    });
    $('pfPetCount').textContent = n + ' / ' + A.pets.length;
  }
  // Common first, then Rare, then Divine, inside a family.
  const ORDER = { Common: 0, Rare: 1, Divine: 2 };
  $('pfGroup').onclick = e => {
    const g = e.target.dataset.g;
    if (!g || g === S.group) return;
    S.group = g;
    if (g === 'rarity' && !S.open.has('r:' + S.pet.r)) S.open.add('r:' + S.pet.r);
    [...$('pfGroup').children].forEach(b => b.classList.toggle('on', b.dataset.g === g));
    renderPets();
    const on = $('pfPetList').querySelector('.pet.on, .fam.cur');
    if (on) on.scrollIntoView({ block: 'start' });
  };
  ['pfQ', 'pfFam'].forEach(id => $(id).addEventListener('input', renderPets));

  /* ---------- 2 · your pet: three levels that are the timeline ---------- */
  function buildAbilities() {
    $('pfAbs').innerHTML = '';
    S.abil.forEach((name, n) => {
      const row = document.createElement('div');
      row.className = 'ab'; row.style.setProperty('--c', 'var(--s' + (n + 1) + ')');
      row.innerHTML = '<span class="ord">' + ORD[n] + '</span><select>' + PE.ABILITIES.map(a => '<option' + (a === name ? ' selected' : '') + (S.abil.includes(a) && a !== name ? ' disabled' : '') + '>' + a + '</option>').join('') + '</select>' +
        '<input type="range" min="0" max="100" value="0"><input type="number" min="0" max="100" value="0"><span class="cap"></span>';
      row.querySelector('select').onchange = e => { S.abil[n] = e.target.value; buildAbilities(); render(); };
      row.querySelectorAll('input[type=range]').forEach(i => {
        i.addEventListener('pointerdown', () => { document.body.classList.add('pets-dragging'); getSelection().removeAllRanges(); });
        ['pointerup', 'pointercancel'].forEach(n => i.addEventListener(n, () => document.body.classList.remove('pets-dragging')));
      });
      row.querySelectorAll('input').forEach(i => i.oninput = e => {
        const L = Math.max(1, Math.min(100, +e.target.value || 1));
        S.fp = fpForLevel(n, L);
        schedule();
      });
      $('pfAbs').appendChild(row);
    });
  }
  function syncAbilities(h) {
    [...$('pfAbs').children].forEach((row, n) => {
      const l = h.lv[n], open = n < PE.unlocked(h.k);
      row.classList.toggle('closed', !open);
      row.querySelectorAll('input').forEach(i => { if (document.activeElement !== i || i.type === 'range') i.value = l; });
      row.querySelector('.cap').textContent = open ? 'cap ' + PE.CAP[h.k] + ' at ' + PE.RARITY[h.k] : 'opens at ' + PE.RARITY[PE.UNLOCK[n]] + ' — drag to jump there';
    });
  }
  let whoKey = '';
  function renderWho(h) {
    const p = shownPet(), key = [p.n, h.k, S.locked].join('|');
    if (key !== whoKey) {
      whoKey = key;
      $('pfWho').innerHTML = '';
      $('pfWho').appendChild(petThumb(p, 48));
      const n = (looks[h.k] || []).length;
      $('pfWho').insertAdjacentHTML('beforeend', '<div><b>' + p.n + '</b><i>' + S.fam + ' family' + (S.locked ? '' : ' · ' + (n > 1 ? 'one of ' + n + ' looks' : 'the look') + ' at ' + PE.RARITY[h.k]) + '</i></div>' +
        '<button type="button" class="lockbtn' + (S.locked ? ' on' : '') + '" title="' + (S.locked ? 'Unlock: the road picks the look of each stage' : 'Lock this look everywhere') + '">' + (S.locked ? '🔒 locked' : '🔓 follows the road') + '</button>' +
        '<span class="rar" style="--c:' + RCOL(h.k) + '">' + gem(h.k) + PE.RARITY[h.k] + '</span>');
      $('pfWho').querySelector('.lockbtn').onclick = () => {
        if (!S.locked) { S.pet = shownPet(); S.fam = S.pet.f || '?'; }
        S.locked = !S.locked; renderPets(); render();
      };
    }
    const g = segs[h.k], done = g.fp ? Math.round(100 * h.fpIn / g.fp) : 100;
    $('pfHint').textContent = PE.RARITY[h.k] + ' stage ' + done + '% fed' + (h.k < 4 && done >= 100 ? ' — next: fuse into ' + PE.RARITY[h.k + 1] : '') + '.';
  }

  /* ---------- 3 · road ---------- */
  const pads = [];
  /*
   * What the pet looks like at each stage. A fusion into Rare and into Divine
   * gives the pet a new look from its family, and which one is not known in
   * advance. So a stage shows the chosen pet when its look belongs there, and
   * otherwise takes turns through every look the family can have there.
   */
  const TIER = k => (k < 2 ? 'Common' : k < 4 ? 'Rare' : 'Divine');
  let looks = [];
  function buildLooks() {
    const fam = A.pets.filter(p => (p.f || '?') === S.fam);
    looks = PE.RARITY.map((_, k) => {
      if (S.locked && S.pet.r === TIER(k)) return [S.pet];
      const can = fam.filter(p => p.r === TIER(k) && p.h), any = fam.filter(p => p.r === TIER(k));
      return can.length ? can : any.length ? any : [S.locked ? S.pet : fam[0] || S.pet];
    });
  }
  // The look a stage is showing right now: unknown looks take turns every 1.6 seconds.
  /*
   * The stage the white line is on keeps one look for as long as the line stays
   * in it: the look it was showing when the line arrived, or the next one after
   * a click on its picture. The other stages go on taking turns.
   */
  const turn = k => Math.floor(Y.t / 1.6) % (looks[k] || [S.pet]).length;
  const stage = { k: -1, i: 0, fam: '' };
  const lookIndex = k => (curH && k === curH.k ? stage.i : turn(k));
  const lookAt = k => (looks[k] || [S.pet])[lookIndex(k)];
  function settleStage(h) {
    if (stage.k === h.k && stage.fam === S.fam) { stage.i = Math.min(stage.i, (looks[h.k] || [S.pet]).length - 1); return; }
    stage.k = h.k; stage.fam = S.fam; stage.i = turn(h.k);        // freeze what was showing as the line arrived
  }
  let curH = null;
  const shownPet = () => (S.locked || !curH ? S.pet : lookAt(curH.k));
  let roadKey = '';
  // The stage the line is in counts down as it moves: what is left of it, not the whole of it.
  // Two lines, and only one of them moves: the first is the feed power the whole phase takes, whatever the line does;
  // the second, on the phase the line is in, is what is left of it.
  const totalLine = k => PE.short(segs[k].fp) + ' FP total';
  function updateNow(h) {
    const node = $('pfRoad').querySelector('.node.here');
    if (!node) return;
    const g = segs[h.k], left = Math.max(0, g.fp - h.fpIn);
    const c = node.querySelector('.costnow');
    const b = left ? PE.short(left) + ' FP left' : 'fed · ready to fuse';
    if (c && c.textContent !== b) c.textContent = b;
  }
  function renderRoad(h) {
    const key = [h.k, S.pay, S.food.name, S.upTo, S.yard, S.pet.n, S.locked, S.fam].join('|');
    if (key === roadKey) { updateNow(h); return; }
    roadKey = key;
    buildLooks();
    settleStage(h);
    $('pfRoad').innerHTML = ''; pads.length = 0;
    PE.RARITY.forEach((name, k) => {
      const g = segs[k], d = document.createElement('div');
      d.className = 'node' + (k < h.k ? ' done' : '') + (k === h.k ? ' here' : '');
      d.style.setProperty('--c', RCOL(k));
      const pad = document.createElement('div'); pad.className = 'pad';
      const c = document.createElement('canvas'); c.width = c.height = 64; pad.appendChild(c); pads.push(c);
      d.appendChild(pad);
      if (k === h.k) d.insertAdjacentHTML('afterbegin', '<span class="tagx">you</span>');
      if (k === h.k && looks[k].length > 1) { pad.style.cursor = 'pointer'; pad.title = 'This look is kept while the line is here — click for the next one'; pad.onclick = () => { stage.i = (stage.i + 1) % looks[k].length; renderWho(curH); }; }
      // Every phase has this line, even with one look only, so no phase is taller than another and the chart below never moves.
      d.insertAdjacentHTML('afterbegin', '<span class="looks" title="' + looks[k].map(p => p.n).join(', ') + '">' + (looks[k].length > 1 ? '1 of ' + looks[k].length : looks[k][0].n) + '</span>');
      const items = Math.ceil(g.fp / S.food.fp), gc = S.pay === 'gold' ? ' g' : '';
      const unlock = k ? '<span class="unlock' + gc + '">fuse <em>' + PE.short(fuseInto(k)) + '</em> · yard <em>' + (yardFor(k) ? PE.short(yardFor(k)) : 'owned') + '</em></span>' : '<span class="unlock">from an egg</span>';
      d.insertAdjacentHTML('beforeend', '<b>' + gem(k) + name + '</b>' + unlock + '<span class="whole' + gc + '">' + (k < h.k ? '✓ done · ' : '') + totalLine(k) + '</span>' + (k === h.k ? '<span class="cost' + gc + ' costnow"></span>' : '<span class="cost">&nbsp;</span>'));
      $('pfRoad').appendChild(d);
    });
    updateNow(h);
  }
  let chartKey = '', chartSize = { w: 600, h: 200 };
  function renderChart(h) {
    const svg = $('pfChart'), W = chartSize.w, H = chartSize.h, T = 16, B = 16;
    const cw = W / 5, y = l => T + (H - T - B) * (1 - l / 100);
    const key = [W, H, S.upTo, h.k].join('|');
    if (key !== chartKey) { chartKey = key; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = '<g>' + chartCurves(h, W, H, T, B, cw, y) + '</g><g></g>'; }
    const g = segs[h.k], hx = h.k * cw + (g.fp ? cw * h.fpIn / g.fp : 0);
    let s = '<rect x="0" y="' + T + '" width="' + hx + '" height="' + (H - T - B) + '" fill="rgb(0 0 0 / .18)"/>';
    s += '<line x1="' + hx + '" x2="' + hx + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#fff" stroke-width="2"/>';
    h.exact.forEach((l, n) => { if (l) s += '<circle cx="' + hx + '" cy="' + y(l) + '" r="5" fill="' + PE.SLOT_COLOR[n] + '" stroke="#111" stroke-width="2"/>'; });
    s += '<rect x="' + (hx - 7) + '" y="' + (H - B - 2) + '" width="14" height="10" rx="3" fill="#fff"/>';
    svg.lastChild.innerHTML = s;
  }
  function chartCurves(h, W, H, T, B, cw, y) {
    const col = k => getComputedStyle(document.documentElement).getPropertyValue('--' + PE.RARITY[k].toLowerCase()).trim() || '#ccc';
    let s = '';
    segs.forEach((g, k) => {
      const x0 = k * cw, c = col(k);
      s += '<rect x="' + x0 + '" y="' + T + '" width="' + cw + '" height="' + (H - T - B) + '" fill="' + c + '" opacity="' + (k === h.k ? .11 : .04) + '"/>';
      s += '<line x1="' + x0 + '" x2="' + (x0 + cw) + '" y1="' + y(PE.CAP[k]) + '" y2="' + y(PE.CAP[k]) + '" stroke="' + c + '" stroke-dasharray="4 4" opacity=".6"/>';
      s += '<text x="' + (x0 + 4) + '" y="' + (y(PE.CAP[k]) - 3) + '" style="fill:' + c + '">' + PE.CAP[k] + '</text>';
      if (k) s += '<line x1="' + x0 + '" x2="' + x0 + '" y1="' + T + '" y2="' + (H - B) + '" stroke="rgb(255 255 255 / .12)"/>';
      s += '<text x="' + (x0 + cw / 2) + '" y="' + (H - 3) + '" text-anchor="middle">' + PE.short(g.fp) + ' FP</text>';
      for (let n = 0; n < g.open; n++) {
        const pts = [];
        for (let i = 0; i <= 40; i++) pts.push((x0 + cw * i / 40).toFixed(1) + ',' + y(PE.levelAfter(n, g.start[n], g.fp * i / 40, PE.CAP[k])).toFixed(1));
        s += '<polyline fill="none" stroke="' + PE.SLOT_COLOR[n] + '" stroke-width="2.4" stroke-linejoin="round" points="' + pts.join(' ') + '"' + (n >= S.upTo ? ' stroke-dasharray="3 3" opacity=".65"' : '') + '/>';
      }
    });
    return s;
  }
  function drag(ev) {
    const r = $('pfChart').getBoundingClientRect(), cw = r.width / 5, x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
    const k = Math.min(4, Math.floor(x / cw));
    let fp = 0; for (let i = 0; i < k; i++) fp += segs[i].fp;
    S.fp = fp + segs[k].fp * Math.min(1, (x - k * cw) / cw);
    schedule();
  }
  const dragging = on => document.body.classList.toggle('pets-dragging', on);
  $('pfChart').addEventListener('pointerdown', e => { e.preventDefault(); $('pfChart').setPointerCapture(e.pointerId); dragging(true); getSelection().removeAllRanges(); drag(e); });
  $('pfChart').addEventListener('pointermove', e => { if (e.buttons) drag(e); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => $('pfChart').addEventListener(n, () => dragging(false)));
  $('pfChart').addEventListener('selectstart', e => e.preventDefault());

  function renderReadout() {
    const spent = spentTo(S.fp), all = spentTo(total), cls = S.pay === 'gold' ? 'g' : 'f';
    const left = { feed: all.feed - spent.feed, fuse: all.fuse - spent.fuse, yard: all.yard - spent.yard };
    const split = o => 'feeding ' + PE.short(o.feed) + ' · fuses ' + PE.short(o.fuse) + ' · yard ' + PE.short(o.yard);
    put($('pfReadout'),
      '<div><b>' + PE.short(S.fp) + '</b><span>FP fed since the egg</span></div>' +
      '<div><b class="' + cls + '">' + PE.short(spent.all) + '</b><span>' + cur() + ' spent: ' + split(spent) + '</span></div>' +
      '<div><b>' + PE.short(total - S.fp) + '</b><span>FP left · ' + PE.fmt(Math.ceil((total - S.fp) / S.food.fp)) + '× ' + S.food.name + '</span></div>' +
      '<div><b class="' + cls + '">' + PE.short(left.feed + left.fuse + left.yard) + '</b><span>' + cur() + ' left: ' + split(left) + '</span></div>');
    put($('pfLegend'), S.abil.map((a, n) => '<span style="--c:' + PE.SLOT_COLOR[n] + '"><i></i>' + ORD[n] + ' ' + a + (n >= S.upTo ? ' (not maxed)' : '') + '</span>').join('') +
      '<span style="margin-left:auto">priced with <b class="usedfood">' + S.food.name + ' · ' + PE.fmt(S.food.fp) + ' FP</b> · one item feeds every open ability at once</span>');
    // What is cut off to keep the line short is still there to read.
    $('pfReadout').querySelectorAll('span').forEach(s => { s.title = s.textContent; });
  }

  /* ---------- 4 · effects ---------- */
  /*
   * Each ability on a card of its own, small enough for all three to stand in the column without
   * scrolling: its name and level on one line, then its numbers two to a row, each as what it is
   * at your level, and what it will be at level 100.
   */
  function renderEffects(h) {
    put($('pfEff'), S.abil.map((a, n) => {
      const l = h.lv[n], e = PE.effect(a, Math.max(1, l)), m = PE.effect(a, 100);
      const v = (x, lv) => (lv ? PE.num(x.value, x.digits) + (x.unit ? ' ' + x.unit : '') : '—');
      const head = '<span style="color:' + PE.SLOT_COLOR[n] + '">' + ORD[n] + '</span> ' + a + '<em>' + (l ? 'level ' + l : 'opens at ' + PE.RARITY[PE.UNLOCK[n]]) + '</em>';
      const cells = e.map((x, i) => '<div><span>' + x.label + (x.mapped ? '' : ' <span class="ap">≈</span>') + '</span><b>' + v(x, l) + '</b><i>→ ' + v(m[i], 1) + '</i></div>').join('');
      return '<div style="--c:' + PE.SLOT_COLOR[n] + '" class="' + (l ? '' : 'off') + '"><h3>' + head + '</h3><div class="st">' + cells + '</div></div>';
    }).join(''));
  }

  /* ---------- 5 · food ---------- */
  let hover = null;
  // The shop food whose feed power is closest to `fp`: what takes over when you pay in gold with something that cannot be bought.
  const nearestSold = fp => F.items.filter(f => f.gold).sort((a, b) => Math.abs(a.fp - fp) - Math.abs(b.fp - fp))[0];
  let scrollToFood = true;
  let foodKey = '';
  const iconOf = {};
  /*
   * Feed power per fame or per gold. With a rarity chosen the feeding fee is in it. With "All" no
   * rarity is chosen, so no fee is: fame has nothing to divide by (every rarity multiplies the
   * same fee, so the order is the feed power's), and gold is the item's own feed power per shop gold.
   */
  // Fame: feed power over the fee of the stage the pet is at (the same fee for every item, so the order is the feed power's).
  // Gold: feed power over the item's own shop price, which does not depend on any rarity.
  const stageFee = () => PE.FEED[curH ? curH.k : 0].fame;
  const worth = (f, r) => (r < 0 ? (S.pay === 'fame' ? f.fp / stageFee() : f.gold ? f.fp / f.gold : null) : PE.value(f, r, S.pay));
  const fmtWorth = v => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1) : v.toFixed(2));
  function renderFood(h) {
    // The list does not depend on the pet's rarity: r stays -1, every rarity at once.
    const r = -1;
    const key = [S.pay, S.food.name, S.foodSort, S.pay === 'fame' ? h.k : 0].join('|');
    if (key === foodKey) return;
    foodKey = key;
    $('pfFoodHead').textContent = '';
    renderUsed();
    // The order follows what you pay with: feed power per fame, or per gold.
    [...$('pfFoodSort').children].forEach(b => { if (b.dataset.s === 'value') b.textContent = 'FP per ' + cur(); b.classList.toggle('on', b.dataset.s === S.foodSort); });
    const by = { value: (a, b) => (b.v || 0) - (a.v || 0), fp: (a, b) => b.f.fp - a.f.fp };
    const sortKey = S.foodSort;
    const list = F.items.map(f => ({ f, v: worth(f, r) })).sort((a, b) => by[sortKey](a, b) || b.f.fp - a.f.fp);
    const el = $('pfFoods'); el.innerHTML = '';
    list.forEach((x, i) => {
      const d = document.createElement('div');
      d.className = 'it' + (x.f === S.food ? ' on' : '') + (x.v ? '' : ' no');
      d.appendChild(iconOf[x.f.name] || (iconOf[x.f.name] = foodIcon(x.f, 32)));   // drawn once, moved after
      if (x.v && i < 3) d.insertAdjacentHTML('beforeend', '<span class="rk">' + (i + 1) + '</span>');
      // The small number is what the filter asks for: FP per fame or per gold, or the FP given.
      d.insertAdjacentHTML('beforeend', '<span class="fp">' + (S.foodSort === 'fp' ? PE.short(x.f.fp) : x.v ? fmtWorth(x.v) : '—') + '</span>');
      d.onmouseenter = e => { hover = x; tip(e, x, r); detail(r); };
      d.onmousemove = e => tip(e, x, r);
      d.onmouseleave = () => { hover = null; $('pfTip').hidden = true; detail(r); };
      d.onclick = () => { if (PE.value(x.f, Math.max(r, 0), S.pay)) { S.food = x.f; render(); } };
      if (x.f === S.food) d.insertAdjacentHTML('beforeend', '<span class="ck">✓</span>');
      el.appendChild(d);
    });
    // Bring the chosen food into view when the list was rearranged by a sort or a currency, not on every click.
    if (scrollToFood) { scrollToFood = false; const on = el.querySelector('.it.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
    detail(r);
  }
  function line(f, r) {
    if (r < 0) return PE.fmt(f.fp) + ' FP given · ' + (f.gold ? f.gold + ' gold in the shop' : 'not sold for gold') + ' · ' + f.where + '<br>' +
      (S.pay === 'fame' ? '<b>' + fmtWorth(f.fp / stageFee()) + ' FP per fame</b> at ' + PE.RARITY[curH ? curH.k : 0] + ' (' + stageFee() + ' fame per item)'
        : f.gold ? '<b>' + fmtWorth(f.fp / f.gold) + ' FP per gold</b> of shop price, before the feeding fee' : 'cannot be bought for gold');
    const fee = PE.FEED[r][S.pay], v = PE.value(f, r, S.pay);
    return PE.fmt(f.fp) + ' FP · ' + (f.gold ? f.gold + ' gold in the shop' : 'not sold for gold') + ' · ' + f.where +
      '<br>' + (v ? (S.pay === 'fame' ? fee + ' fame' : (fee + f.gold) + ' gold') + ' per item → <b>' + v.toFixed(1) + ' FP per ' + cur() + '</b>' : 'cannot be bought for gold');
  }
  // Which food the road is priced with, said where the eye is: above the list, and under the road.
  function renderUsed() {
    const f = S.food, box = $('pfUsed');
    box.innerHTML = '';
    box.appendChild(foodIcon(f, 32));
    const v = worth(f, -1);
    box.insertAdjacentHTML('beforeend', '<span><small>The road is priced with</small><b>' + f.name + '</b></span><em>' + PE.fmt(f.fp) + ' FP' + (v ? '<br>' + fmtWorth(v) + ' per ' + cur() : '<br>not sold for gold') + '</em>');
  }
  const detail = () => {};   // the tooltip says what a hovered item is; the chosen one is in the banner
  function tip(e, x, r) {
    const t = $('pfTip'); t.hidden = false;
    t.innerHTML = '<b>' + x.f.name + '</b><span>' + line(x.f, r) + '</span>';
    t.style.left = Math.min(innerWidth - t.offsetWidth - 6, e.clientX + 14) + 'px';
    t.style.top = Math.min(innerHeight - t.offsetHeight - 6, e.clientY + 14) + 'px';
  }

  /* ---------- the yard ---------- */
  /*
   * A small stretch of yard, measured in tiles, with a dummy in the middle.
   * You walk a round of stops: some far off, some right next to the dummy,
   * and you wait at each one. That way every ability gets its chance: the
   * attacks find the dummy in range, Electric touches it, and Rising Fury,
   * which only charges while the pet stands still, has time to charge.
   */
  const cv = $('pfArena'), ctx = cv.getContext('2d');
  const STOPS = [[-6, 1.2], [-1.4, .6], [1.6, -.4], [6, -1.4], [2.2, 2], [-1.8, 2.2]];   // tiles from the dummy
  const WALK = 3, WAIT = 1.8;                                                              // tiles a second, seconds at a stop
  const Y = {
    t: 0, pl: { x: 0, y: 0, leg: 0, wait: WAIT, from: null }, trail: [], fx: [], hits: [], timers: [0, 0, 0],
    pet: { x: 0, y: 0, vx: 0, vy: 0, face: 1, moving: false, act: 0, dash: null, charge: 0, cd: 0 }
  };
  let AW = 200, AH = 120, TILE = 12, yardLv = [1, 0, 0];
  const dummy = () => ({ x: AW * .5, y: AH * .55 });
  const stopAt = i => { const d = dummy(), s = STOPS[i % STOPS.length]; return { x: d.x + s[0] * TILE, y: d.y + s[1] * TILE }; };
  function fit() {
    const b = cv.parentElement.getBoundingClientRect();
    AW = cv.width = Math.max(160, Math.floor(b.width)); AH = cv.height = Math.max(100, Math.floor(b.height));
    // Wide enough for the longest reach (Attack Far, 9 tiles) to show between a stop and the dummy.
    TILE = Math.max(10, Math.min(Math.round(AH / 7), Math.round(AW / 15)));
    ctx.imageSmoothingEnabled = false;
    const s = stopAt(Y.pl.leg); Object.assign(Y.pl, s); Y.pl.from = s;
    if (!Y.pet.x) { Y.pet.x = s.x - TILE; Y.pet.y = s.y + TILE * .3; }
    Y.trail = [];
  }
  $('pfModes').onclick = e => { const m = e.target.dataset.m; if (!m) return; S.mode = m; [...$('pfModes').children].forEach(b => b.classList.toggle('on', b === e.target)); };

  const stat = (a, l, label) => PE.effect(a, Math.max(1, l)).find(x => x.label === label).value;
  // How each ability's clock runs, in the client's own terms.
  function summary(a, l) {
    const e = PE.EFFECT[a], s = label => stat(a, l, label), n = (v, d) => PE.num(v, d === undefined ? 1 : d);
    switch (e.fx) {
      case 'heal': return a + ' ' + l + ': ' + n(s('Heals'), 0) + ' HP every ' + n(s('Every'), 2) + ' s';
      case 'mana': return a + ' ' + l + ': ' + n(s('Restores'), 0) + ' MP every ' + n(s('Every'), 2) + ' s';
      case 'shoot': return a + ' ' + l + ': ' + n(s('Damage'), 0) + ' every ' + n(s('Every'), 2) + ' s within ' + n(s('Range')) + ' tiles';
      case 'zap': return a + ' ' + l + ': ' + n(s('Damage'), 0) + ' every ' + n(s('Zaps every'), 2) + ' s to what touches it';
      case 'decoy': return a + ' ' + l + ': lures ' + n(s('Lures for')) + ' s, every ' + n(s('Cooldown')) + ' s';
      case 'savage': return a + ' ' + l + ': charges ' + n(s('Charges up to')) + ' tiles every ' + n(s('Every')) + ' s';
      case 'fury': return a + ' ' + l + ': up to ' + n(s('Blast up to'), 0) + ' after ' + n(s('Full charge in')) + ' s still';
    }
  }
  const txt = (x, y, text, color, life) => Y.fx.push({ k: 'text', x: x + (Math.random() - .5) * TILE * .7, y, text, color, t: 0, life: life || .9 });
  const ring = (x, y, r0, r1, color, life) => Y.fx.push({ k: 'ring', x, y, r0, r1, color, t: 0, life });
  function hit(dmg, color) { const d = dummy(); Y.hits.push({ t: Y.t, dmg }); if (Y.log) Y.log.push({ t: +Y.t.toFixed(2), dmg: Math.round(dmg), color }); txt(d.x, d.y - TILE * 1.6, '-' + Math.round(dmg), color || '#ff8a7a'); }

  // One tick of an ability whose own clock has run out. Returns false to try again next frame.
  function fire(a, l) {
    const e = PE.EFFECT[a], p = Y.pet, d = dummy(), pl = Y.pl, s = label => stat(a, l, label);
    const dist = Math.hypot(d.x - p.x, d.y - p.y) / TILE;
    const face = () => { p.face = d.x >= p.x ? 1 : -1; p.act = .3; };
    if (e.fx === 'heal' || e.fx === 'mana') {
      const c = e.fx === 'heal' ? '#7dff7a' : '#6fb8ff';
      Y.fx.push({ k: 'text', x: pl.x + (e.fx === 'mana' ? TILE * .9 : -TILE * .3), y: pl.y - TILE * (e.fx === 'mana' ? 1.5 : 1.9), text: '+' + Math.round(s(e.fx === 'heal' ? 'Heals' : 'Restores')), color: c, t: 0, life: 1 });
      ring(pl.x, pl.y - TILE * .5, 2, TILE * .9, c, .5);
    } else if (e.fx === 'shoot') {
      if (dist > s('Range')) return false;
      face();
      Y.fx.push({ k: 'shot', x: p.x, y: p.y - TILE * .5, tx: d.x, ty: d.y - TILE * .6, t: 0, life: Math.max(.08, dist / 14), dmg: s('Damage') });
    } else if (e.fx === 'zap') {
      if (dist > s('Reach') + .5) return false;                       // the dummy is half a tile wide
      face();
      ring(p.x, p.y - TILE * .3, 2, s('Reach') * TILE + TILE * .5, '#c6e8ff', .3);
      hit(s('Damage'), '#c6e8ff');
      if (Math.random() * 100 < s('Paralyze')) txt(d.x, d.y - TILE * 2.3, 'paralyzed ' + PE.num(s('for'), 1) + ' s', '#c6e8ff', 1.2);
    } else if (e.fx === 'decoy') {
      ring(p.x, p.y - TILE * .3, TILE * .5, s('Radius') * TILE, '#ff8de0', Math.min(2.5, s('Lures for')));
      txt(p.x, p.y - TILE * 1.6, 'decoy ' + PE.num(s('Lures for'), 1) + ' s', '#ff8de0', 1.2);
    } else if (e.fx === 'savage') {
      if (dist > s('Charges up to')) return false;
      p.dash = { t: 0, from: { x: p.x, y: p.y }, to: { x: d.x - TILE * .9 * Math.sign(d.x - p.x || 1), y: d.y + 2 } };
      txt(p.x, p.y - TILE * 1.4, 'savage', '#ffd27a');
    }
    return true;
  }
  // Every ability but Rising Fury runs on its own interval.
  const delayOf = (a, l) => { const d = PE.effect(a, Math.max(1, l)).find(x => /every|Cooldown/i.test(x.label)); return d ? d.value : 3; };

  /*
   * Rising Fury is not an interval: standing still charges it, up to its full
   * charge time; moving again releases a blast whose power grows with the
   * charge. Then its cooldown runs before it can charge again.
   */
  function fury(a, l, dt) {
    const p = Y.pet, d = dummy(), full = stat(a, l, 'Full charge in'), r = stat(a, l, 'Radius');
    if (p.cd > 0) { p.cd -= dt; return; }
    if (!p.moving && !p.dash) { p.charge = Math.min(full, p.charge + dt); return; }
    if (p.charge < .25) { p.charge = 0; return; }
    const part = p.charge / full;
    ring(p.x, p.y - TILE * .3, TILE * .3, r * TILE * part, '#ff7b4a', .45);
    if (Math.hypot(d.x - p.x, d.y - p.y) / TILE <= r * part + .5) hit(stat(a, l, 'Blast up to') * part, '#ff9a55');
    p.act = .3; p.charge = 0; p.cd = stat(a, l, 'Cooldown');
  }

  let last = performance.now();
  let running = false;
  function frame(now) {
    if (document.body.dataset.page !== 'pets') { running = false; return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now; Y.t += dt;
    for (let x = 0; x < AW; x += TILE) for (let yy = 0; yy < AH; yy += TILE) { ctx.fillStyle = ((x + yy) / TILE) % 2 ? '#1f3a1d' : '#24421f'; ctx.fillRect(x, yy, TILE, TILE); }
    const p = shownPet();
    if (petSheet.complete) {
      if (S.mode !== 'action') {
        const act = S.mode === 'walk' ? 1 : 2;
        let fr = framesOf(p, act); if (!fr.length) fr = framesOf(p, 1).length ? framesOf(p, 1) : [0];
        const k = petScale(p, AH * .5);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(AW / 2, AH * .82, body(p) * k * .45, 3, 0, 0, 7); ctx.fill();
        drawPet(ctx, p, fr[Math.floor(Y.t * (act === 2 ? 4 : 6)) % fr.length], AW / 2, AH * .82, k, false);
        $('pfArenaTag').textContent = fr.length + ' ' + S.mode + ' frame' + (fr.length > 1 ? 's' : '') + ', as the client stores them';
      } else yard(dt);
      pads.forEach((c, k) => {
        // Unknown looks take turns, one every 1.6 seconds, and the badge says which one is showing.
        const list = looks[k] || [p], n = lookIndex(k), q = list[n];
        const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 64, 64);
        const fr = framesOf(q, 1).length ? framesOf(q, 1) : framesOf(q, 0).length ? framesOf(q, 0) : [0];
        drawPet(g, q, fr[Math.floor(Y.t * 6 + k) % fr.length], 32, 60, petScale(q, 48), false);
        const badge = list.length > 1 && c.closest('.node').querySelector('.looks');
        const here = curH && k === curH.k;
        if (badge && badge.dataset.n !== n + '|' + here) { badge.dataset.n = n + '|' + here; badge.textContent = (n + 1) + ' / ' + list.length + ' · ' + q.n + (here ? ' 🔒' : ''); }
      });
    }
    if (!S.locked && curH && whoKey.split('|')[0] !== shownPet().n) renderWho(curH);
    requestAnimationFrame(frame);
  }
  function walk(dt) {
    const pl = Y.pl, to = stopAt(pl.leg + 1);
    if (pl.wait > 0) { pl.wait -= dt; return; }
    const dx = to.x - pl.x, dy = to.y - pl.y, d = Math.hypot(dx, dy), step = WALK * TILE * dt;
    if (d <= step) { pl.x = to.x; pl.y = to.y; pl.leg++; pl.wait = WAIT; return; }
    pl.x += dx / d * step; pl.y += dy / d * step;
  }
  function follow(dt) {
    const pet = Y.pet, pl = Y.pl;
    if (pet.dash) {
      pet.dash.t += dt; const back = pet.dash.t > .7;
      const from = back ? pet.dash.to : pet.dash.from, to = back ? { x: pl.x - TILE, y: pl.y + 2 } : pet.dash.to, tt = Math.min(1, back ? (pet.dash.t - .7) / .5 : pet.dash.t / .3);
      pet.x = from.x + (to.x - from.x) * tt; pet.y = from.y + (to.y - from.y) * tt; pet.face = to.x >= from.x ? 1 : -1; pet.moving = true; pet.vx = pet.vy = 0;
      if (pet.dash.t > 1.2) pet.dash = null;
      return;
    }
    // Walk where you were a moment ago, but never onto you: keep about a tile away.
    let goal = Y.trail[0];
    const gx = goal.x - pl.x, gy = goal.y - pl.y, gd = Math.hypot(gx, gy);
    if (gd < TILE) goal = gd > .01 ? { x: pl.x + gx / gd * TILE, y: pl.y + gy / gd * TILE } : { x: pl.x - TILE * pet.face, y: pl.y + 2 };
    const dx = goal.x - pet.x, dy = goal.y - pet.y, max = TILE * 6;
    const want = { x: Math.max(-max, Math.min(max, dx * 4)), y: Math.max(-max, Math.min(max, dy * 4)) }, ease = Math.min(1, dt * 6);
    pet.vx += (want.x - pet.vx) * ease; pet.vy += (want.y - pet.vy) * ease;
    pet.x += pet.vx * dt; pet.y += pet.vy * dt;
    const speed = Math.hypot(pet.vx, pet.vy);
    pet.moving = pet.moving ? speed > TILE * .25 : speed > TILE * .5;     // a margin, so it does not flicker
    if (Math.abs(pet.vx) > TILE * .3 && !(pet.act > 0)) pet.face = pet.vx > 0 ? 1 : -1;
  }
  function yard(dt) {
    const p = shownPet(), pet = Y.pet, pl = Y.pl, lv = yardLv, d = dummy();
    walk(dt);
    Y.trail.push({ t: Y.t, x: pl.x, y: pl.y });
    while (Y.trail.length > 2 && Y.trail[1].t < Y.t - .35) Y.trail.shift();
    follow(dt);
    S.abil.forEach((ab, n) => {
      if (!lv[n]) return;
      if (PE.EFFECT[ab].fx === 'fury') return fury(ab, lv[n], dt);
      Y.timers[n] += dt;
      if (Y.timers[n] >= delayOf(ab, lv[n]) && fire(ab, lv[n]) !== false) Y.timers[n] = 0;
    });
    if (pet.act > 0) pet.act -= dt;

    // the dummy, and what it has taken over the last four seconds
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(d.x, d.y, TILE * .5, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#7b4a2a'; ctx.fillRect(d.x - TILE * .1, d.y - TILE * 1.2, TILE * .2, TILE * 1.2);
    ctx.fillStyle = '#d6b37a'; ctx.fillRect(d.x - TILE * .45, d.y - TILE * 1.3, TILE * .9, TILE * .7);
    Y.hits = Y.hits.filter(h => h.t > Y.t - 4);
    const span = Math.min(4, Y.t), dps = span > .5 ? Y.hits.reduce((s, h) => s + h.dmg, 0) / span : 0;
    ctx.textAlign = 'center'; ctx.font = 'bold ' + Math.max(9, Math.round(TILE * .55)) + 'px Segoe UI';
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(d.x - TILE * 1.4, d.y + TILE * .2, TILE * 2.8, TILE * .7);
    ctx.fillStyle = dps ? '#ffb4a8' : '#9a948a'; ctx.fillText(dps ? Math.round(dps) + ' dmg/s' : 'dummy', d.x, d.y + TILE * .72);

    // the Rising Fury charge, growing under the pet while it stands still
    const furyN = S.abil.findIndex(a => PE.EFFECT[a].fx === 'fury');
    if (furyN >= 0 && lv[furyN] && pet.charge > 0) {
      const part = pet.charge / stat(S.abil[furyN], lv[furyN], 'Full charge in');
      ctx.strokeStyle = 'rgba(255,123,74,' + (.3 + .5 * part) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pet.x, pet.y - TILE * .3, stat(S.abil[furyN], lv[furyN], 'Radius') * TILE * part, 0, 7); ctx.stroke();
    }
    // you
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(pl.x, pl.y, TILE * .4, 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f2e6c9'; ctx.fillRect(pl.x - TILE * .3, pl.y - TILE * .9, TILE * .6, TILE * .9);
    ctx.fillStyle = '#3a6fd8'; ctx.fillRect(pl.x - TILE * .3, pl.y - TILE * .45, TILE * .6, TILE * .45);
    // the pet
    const fr = pet.act > 0 ? framesOf(p, 2) : pet.moving ? framesOf(p, 1) : framesOf(p, 0);
    const use = fr.length ? fr : (framesOf(p, 1).length ? framesOf(p, 1) : [0]);
    const i = pet.act > 0 ? use[Math.min(use.length - 1, Math.floor((.3 - pet.act) / .3 * use.length))] : use[Math.floor(Y.t * (pet.moving ? 7 : 2)) % use.length];
    const k = petScale(p, TILE * 1.5);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(pet.x, pet.y, body(p) * k * .4, 2, 0, 0, 7); ctx.fill();
    drawPet(ctx, p, i, pet.x, pet.y, k, pet.face < 0);
    // what the abilities did
    Y.fx = Y.fx.filter(f => (f.t += dt) < f.life);
    Y.fx.forEach(f => {
      const t = f.t / f.life;
      if (f.k === 'text') { ctx.globalAlpha = 1 - t * t; ctx.font = 'bold ' + Math.max(9, Math.round(TILE * .62)) + 'px Segoe UI'; ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x + 1, f.y - t * TILE + 1); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - t * TILE); ctx.globalAlpha = 1; }
      if (f.k === 'ring') { ctx.globalAlpha = 1 - t; ctx.strokeStyle = f.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * Math.min(1, t * 2), 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      if (f.k === 'shot') { ctx.fillStyle = '#ffe08a'; ctx.fillRect(f.x + (f.tx - f.x) * t - 2, f.y + (f.ty - f.y) * t - 2, 4, 4); if (f.t + dt >= f.life) hit(f.dmg); }
    });
    const tag = S.abil.map((ab, n) => lv[n] ? summary(ab, lv[n]) : null).filter(Boolean).join('   ·   ');
    if ($('pfArenaTag').textContent !== tag) $('pfArenaTag').textContent = tag;
  }

  /* ---------- render ---------- */
  // Leave a box alone when its content has not changed: every write costs the browser a new layout.
  function put(el, html) { if (el.__html !== html) { el.__html = html; el.innerHTML = html; } }
  let pending = false;
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }
  function render() {
    const h = at(S.fp);
    curH = h;
    yardLv = h.lv;
    syncAbilities(h); renderRoad(h); renderWho(h); renderChart(h); renderReadout(); renderEffects(h); renderFood(h);
    [...$('pfUpTo').children].forEach(b => b.classList.toggle('on', +b.dataset.v === S.upTo));
    [...$('pfPay').children].forEach(b => b.classList.toggle('on', b.dataset.v === S.pay));
    // At a stage you have at least that stage's yard, so the list shows the higher of the two
    // and cannot go below it; what you pick is the yard you had before this pet.
    const ys = $('pfYard'), shown = Math.max(S.yard, h.k);
    if (+ys.value !== shown) ys.value = shown;
    [...ys.options].forEach((o, i) => { o.disabled = i < h.k; });
  }
  // Changing the goal changes the road: keep the 1st ability where it was.
  $('pfUpTo').onclick = e => { if (!e.target.dataset.v) return; const l1 = at(S.fp).lv[0]; S.upTo = +e.target.dataset.v; build(); S.fp = fpForLevel(0, l1); render(); };
  $('pfYard').onchange = e => { S.yard = +e.target.value; render(); };
  $('pfFoodSort').onclick = e => { if (e.target.dataset.s) { S.foodSort = e.target.dataset.s; scrollToFood = true; render(); } };
  $('pfPay').onclick = e => { if (!e.target.dataset.v) return; S.pay = e.target.dataset.v; if (S.pay === 'gold' && !S.food.gold) S.food = nearestSold(S.food.fp); scrollToFood = true; render(); };
  // Redraw whenever a box changes size, not only the window: the chart and the yard are drawn to theirs.
  let queued = false;
  new ResizeObserver(entries => {
    const r = entries[entries.length - 1].contentRect;
    chartSize = { w: Math.max(100, Math.round(r.width)), h: Math.max(60, Math.round(r.height)) };
    if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fit(); render(); });
  }).observe($('pfChart'));
  new ResizeObserver(() => fit()).observe(cv.parentElement);
  /*
   * Opened for the first time: read the pictures, work out the road, draw. Opened again: only
   * make sure the yard is running, since it stops itself while another page is shown.
   */
  let started = null;
  function start() {
    if (!started) {
      const loaded = img => new Promise(resolve => { img.onload = img.onerror = resolve; });
      const ready = Promise.all([loaded(petSheet), loaded(foodSheet)]);
      // The kept copy of the site carries its pictures inside it; the served one fetches them.
      const kept = typeof BUNDLE !== 'undefined' && BUNDLE && BUNDLE.petImages;
      petSheet.src = kept ? BUNDLE.petImages.pets : 'assets/pets/pets.png';
      foodSheet.src = kept ? BUNDLE.petImages.foods : 'assets/pets/foods.png';
      build();
      S.fp = fpForLevel(0, 42);          // open on an uncommon pet at 42, mid-road
      renderPets(); buildAbilities(); fit(); render();
      started = ready.then(() => {
        render(); renderPets();
        const on = $('pfPetList').querySelector('.pet.on, .fam.cur');
        if (on) on.scrollIntoView({ block: 'start' });
        return true;
      });
    }
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
    fit();
    return started;
  }
  return { start };
})();

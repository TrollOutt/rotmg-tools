/*
 * The Realm Atlas.
 *
 * The New Realm is the same map every time, so it can be drawn. The shape
 * comes from data/Realm/realm-terrain.txt — a grid of terrain classes traced
 * by tools/trace-realm-map.js — and everything in it comes from the installed
 * client by way of tools/generate-realm.js: which creatures live where, what
 * they have for health, what a beacon guardian is worth.
 *
 * The two are joined by REGIONS below, which is a reading of the map rather
 * than a fact out of the client, and says so.
 */
var RealmMap = (function () {
  'use strict';

  // World units per traced cell. The grid is 248 across, so the realm is a
  // little under a thousand units wide whatever the window does.
  const CELL = 4;

  /*
   * What each terrain class looks like.
   *
   * Two colours: the ground, and the shade it takes in the low light the
   * atlas is drawn in. Every cell picks between them on a hash of where it
   * is, which is what stops a hundred cells of the same sand reading as one
   * flat shape.
   */
  const GROUND = {
    '~': null,                                    // sea, drawn as water
    '-': null,                                    // shallow, drawn as water
    '^': ['#5b6672', '#4a545f', 'mountain'],
    '*': ['#cfe4f2', '#b4cee2', 'snowfield'],
    'g': ['#7d9c37', '#6d8b30', 'grassland'],
    'p': ['#66754e', '#59683f', 'plains'],
    'f': ['#3b4a24', '#32401e', 'forest'],
    'F': ['#2a6b2b', '#215a24', 'deep forest'],
    'y': ['#8f9124', '#7c7e1e', 'scrubland'],
    's': ['#c3a98e', '#b39a80', 'sands'],
    'S': ['#f3d3a6', '#e4c294', 'pale sands'],
    'd': ['#8a6329', '#775422', 'desert'],
    'h': ['#2e2154', '#251a45', 'highland'],
    'n': ['#2b3448', '#232b3c', 'night moor'],
    'x': ['#3a241d', '#2f1c16', 'thicket'],
    'r': ['#4a1618', '#3b1113', 'ember flats'],
    'c': ['#94766a', '#836659', 'clay downs'],
    'm': ['#38443b', '#2d3830', 'murk'],
    'v': ['#856a70', '#745a60', 'mauve wastes']
  };
  const WATER = new Set(['~', '-']);

  /*
   * Which client biome a stretch of ground belongs to.
   *
   * This is the one part of the atlas that is neither read from the client
   * nor traced from the map: the picture shows what kind of ground is where,
   * and the client says which creatures live in which biome, but nothing
   * joins the two. So it is joined here, by hand, and it is a reading — good
   * enough that the topology is right and a region shows a plausible roster,
   * not good enough to be called a fact.
   *
   * Where one class covers two biomes the north-south split decides, because
   * the realm runs from shore at the rim to highland at the heart.
   */
  const REGIONS = {
    '*': ['runic-tundra'],
    'g': ['low-forest'],
    'p': ['mid-plains'],
    'f': ['mid-forest'],
    'F': ['high-forest'],
    'y': ['low-plains'],
    's': ['shore-sand'],
    'S': ['shore-plains'],
    'd': ['low-desert', 'high-desert'],
    'h': ['high-plains'],
    'n': ['haunted-hallows'],
    'x': ['sprite-forest'],
    'r': ['risen-hell'],
    'c': ['abandoned-city'],
    'm': ['carboniferous'],
    'v': ['dead-church']
  };

  const html = value => String(value || '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const num = value => Number(value || 0).toLocaleString('en-US');

  let canvas, ctx, details, reset;
  let grid = null, cols = 0, rows = 0;
  // The land's own bounding box. The traced grid is mostly sea — the realm
  // sits in the middle of an ocean — so the view is fitted to this instead,
  // or the atlas opens on a lot of empty water.
  let coast = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 1, height: 1 };
  let terrain = null;                             // the painted map, drawn once
  let regions = [];
  let active = false, frame = 0, selected = null, lastTime = 0;
  let view = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 };
  let drag = null, pointer = { x: -1e4, y: -1e4 };

  const zoneOf = id => (RealmData.zones || []).find(entry => entry.id === id);
  const beaconOf = name => (RealmData.beacons || []).find(entry => entry.name === name);

  /* ---------------------------------------------------------------- *
   * Reading the traced map                                            *
   * ---------------------------------------------------------------- */
  function parse(text) {
    const lines = String(text).replace(/\r/g, '').split('\n')
      .filter(line => line && !line.startsWith('##'));
    grid = lines;
    rows = lines.length;
    cols = lines.reduce((widest, line) => Math.max(widest, line.length), 0);
  }
  const at = (col, row) => (row < 0 || row >= rows || col < 0 || col >= cols) ? '~' : (grid[row][col] || '~');

  function findCoast() {
    let minX = cols, minY = rows, maxX = 0, maxY = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (WATER.has(at(col, row))) continue;
        if (col < minX) minX = col; if (col > maxX) maxX = col;
        if (row < minY) minY = row; if (row > maxY) maxY = row;
      }
    }
    // A margin of sea all round, so the realm is an island rather than a
    // shape jammed against the edge of its frame.
    const margin = 6;
    coast = {
      minX: (minX - margin) * CELL, minY: (minY - margin) * CELL,
      maxX: (maxX + margin) * CELL, maxY: (maxY + margin) * CELL
    };
    coast.width = coast.maxX - coast.minX;
    coast.height = coast.maxY - coast.minY;
  }

  /*
   * Regions are the connected stretches of one kind of ground.
   *
   * A flood fill over the grid, keeping anything big enough to be worth
   * clicking. Small islands of a class inside another — a few cells of scrub
   * in the plains — are left as scenery: they are drawn, but they are not
   * something the player is meant to aim at.
   */
  function findRegions() {
    const seen = new Uint8Array(cols * rows);
    const found = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const letter = at(col, row);
        if (seen[row * cols + col] || WATER.has(letter) || letter === '^') continue;
        const cells = [];
        const queue = [[col, row]];
        seen[row * cols + col] = 1;
        let minX = col, maxX = col, minY = row, maxY = row;
        while (queue.length) {
          const [x, y] = queue.pop();
          cells.push(x, y);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            if (seen[ny * cols + nx] || at(nx, ny) !== letter) continue;
            seen[ny * cols + nx] = 1;
            queue.push([nx, ny]);
          }
        }
        if (cells.length / 2 < 30) continue;
        found.push({
          letter, cells,
          size: cells.length / 2,
          box: { minX, maxX, minY, maxY },
          cx: (minX + maxX + 1) / 2 * CELL,
          cy: (minY + maxY + 1) / 2 * CELL
        });
      }
    }

    // North to south decides which biome a class stands for where it covers
    // more than one — the realm runs from shore at the rim to highland in.
    const byClass = new Map();
    for (const region of found) {
      if (!byClass.has(region.letter)) byClass.set(region.letter, []);
      byClass.get(region.letter).push(region);
    }
    for (const [letter, list] of byClass) {
      const names = REGIONS[letter] || [];
      list.sort((a, b) => a.cy - b.cy);
      list.forEach((region, index) => {
        region.zoneId = names.length ? names[Math.min(index, names.length - 1)] : null;
        const zone = region.zoneId && zoneOf(region.zoneId);
        region.name = zone ? zone.name : (GROUND[letter] || [, , letter])[2];
      });
    }
    regions = found.sort((a, b) => b.size - a.size);

    /*
     * One label per biome, on its largest stretch. A class can break into a
     * dozen pieces — the plains are threaded with forest — and labelling
     * every piece wrote "Haunted Hallows" across the map six times.
     */
    const labelled = new Set();
    for (const region of regions) {
      region.labelled = Boolean(region.zoneId) && !labelled.has(region.zoneId);
      if (region.labelled) labelled.add(region.zoneId);
    }
  }

  /* ---------------------------------------------------------------- *
   * Painting the map, once                                            *
   * ---------------------------------------------------------------- */
  // A cheap deterministic hash, so the same cell takes the same shade every
  // time the map is drawn and the ground does not shimmer when you pan.
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };

  function paintTerrain() {
    terrain = document.createElement('canvas');
    terrain.width = cols * CELL;
    terrain.height = rows * CELL;
    const paint = terrain.getContext('2d');

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const letter = at(col, row);
        const ground = GROUND[letter];
        if (!ground) continue;
        paint.fillStyle = hash(col, row) > 0.5 ? ground[0] : ground[1];
        paint.fillRect(col * CELL, row * CELL, CELL, CELL);
      }
    }

    /*
     * The shore. Every land cell with sea against it takes a darker edge, so
     * the coastline reads as a coastline rather than as the place the colour
     * happens to stop.
     */
    paint.fillStyle = 'rgba(12, 20, 34, .45)';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (WATER.has(at(col, row))) continue;
        if (WATER.has(at(col - 1, row)) || WATER.has(at(col + 1, row))
          || WATER.has(at(col, row - 1)) || WATER.has(at(col, row + 1))) {
          paint.fillRect(col * CELL, row * CELL, CELL, CELL);
        }
      }
    }

    /*
     * The mountains the player cannot walk into. Each cell whose northern
     * neighbour is open ground gets a lit face and a shadow under it, which
     * is enough relief at this scale to read as a range rather than as grey
     * paint — and the grey is exactly where the game says you cannot go.
     */
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (at(col, row) !== '^') continue;
        if (at(col, row - 1) !== '^') {
          paint.fillStyle = 'rgba(226, 238, 247, .22)';
          paint.fillRect(col * CELL, row * CELL, CELL, Math.max(1, CELL / 2));
        }
        if (at(col, row + 1) !== '^') {
          paint.fillStyle = 'rgba(6, 10, 18, .5)';
          paint.fillRect(col * CELL, row * CELL + CELL / 2, CELL, Math.max(1, CELL / 2));
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * The view                                                          *
   * ---------------------------------------------------------------- */
  const box = () => canvas.getBoundingClientRect();
  function baseScale() {
    const size = box();
    return Math.min(size.width / coast.width, size.height / coast.height);
  }
  function screenPoint(x, y) {
    const size = box(); const scale = baseScale() * view.z;
    return { x: (x - view.x) * scale + size.width / 2, y: (y - view.y) * scale + size.height / 2 };
  }
  function worldPoint(x, y) {
    const size = box(); const scale = baseScale() * view.z;
    return { x: (x - size.width / 2) / scale + view.x, y: (y - size.height / 2) / scale + view.y };
  }

  function drawSea(time) {
    const size = box();
    const deep = ctx.createLinearGradient(0, 0, 0, size.height);
    deep.addColorStop(0, '#12233f');
    deep.addColorStop(1, '#0d1a30');
    ctx.fillStyle = deep;
    ctx.fillRect(0, 0, size.width, size.height);

    // Long swells, slow enough to read as water rather than as a pattern.
    ctx.lineWidth = 1;
    for (let row = -30; row < size.height + 40; row += 22) {
      ctx.strokeStyle = `rgba(126, 196, 240, ${0.05 + 0.05 * Math.sin(row / 90)})`;
      ctx.beginPath();
      for (let x = -30; x <= size.width + 30; x += 14) {
        const y = row + Math.sin((x + time * 0.03 + row * 1.7) / 46) * 3.2
          + Math.sin((x - time * 0.017 + row) / 21) * 1.4;
        x <= -30 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawTerrain() {
    const scale = baseScale() * view.z;
    const origin = screenPoint(0, 0);
    ctx.imageSmoothingEnabled = scale < 1.4;
    ctx.drawImage(terrain, origin.x, origin.y, terrain.width * scale, terrain.height * scale);
  }

  /*
   * The creatures that live here, wandering.
   *
   * Drawn from the client's own roster for the region: three of them per
   * region, moving on their own slow loops. They are markers rather than
   * portraits at this size — the sprites come out when a region is opened.
   */
  function drawCreatures(time) {
    const scale = baseScale() * view.z;
    if (scale < 0.55) return;
    for (const region of regions) {
      const zone = region.zoneId && zoneOf(region.zoneId);
      if (!zone || !zone.monsters || !zone.monsters.length) continue;
      const many = Math.min(3, zone.monsters.length, Math.max(1, Math.round(region.size / 260)));
      for (let index = 0; index < many; index++) {
        const seed = region.cells[(index * 37) % (region.cells.length / 2) * 2];
        const phase = index * 2.4 + seed * 0.07;
        const wander = 5 + index * 3;
        const cell = ((index * 53) % (region.cells.length / 2)) * 2;
        const x = region.cells[cell] * CELL + Math.sin(time / 1900 + phase) * wander;
        const y = region.cells[cell + 1] * CELL + Math.cos(time / 2300 + phase) * wander;
        const spot = screenPoint(x, y);
        const size = Math.max(1.5, 2.4 * scale);
        ctx.fillStyle = index === 0 ? 'rgba(248, 231, 189, .9)' : 'rgba(18, 16, 24, .8)';
        ctx.fillRect(spot.x - size, spot.y - size, size * 2, size * 2);
      }
    }
  }

  function drawBeacons(time) {
    const scale = baseScale() * view.z;
    for (const region of regions) {
      // One beacon per biome, on the same stretch that carries its name: a
      // guardian is a thing in the realm, not one per patch of ground.
      if (!region.labelled) continue;
      const zone = zoneOf(region.zoneId);
      if (!zone) continue;
      const guardian = beaconOf(zone.name);
      if (!guardian) continue;
      const spot = screenPoint(region.cx, region.cy);
      const pulse = 1 + Math.sin(time / 420 + region.cx) * 0.16;
      const radius = 7 * Math.max(0.6, Math.min(1.6, scale));
      ctx.save();
      ctx.translate(spot.x, spot.y);
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = '#7fe9ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, radius * 1.9 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#7fe9ff';
      ctx.beginPath();
      ctx.moveTo(0, -radius); ctx.lineTo(radius * 0.86, radius * 0.6); ctx.lineTo(-radius * 0.86, radius * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawLabels() {
    const scale = baseScale() * view.z;
    ctx.textAlign = 'center';
    for (const region of regions) {
      if (!region.labelled) continue;
      if (region.size < (scale > 1.4 ? 40 : 90)) continue;
      const spot = screenPoint(region.cx, region.cy);
      const size = Math.round(Math.max(9, Math.min(15, 11 * scale)));
      ctx.font = `${size}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(6, 10, 18, .75)';
      ctx.strokeText(region.name, spot.x, spot.y);
      ctx.fillStyle = selected && selected.region === region ? '#ffeaa7' : 'rgba(243, 238, 224, .88)';
      ctx.fillText(region.name, spot.x, spot.y);
    }
  }

  function drawSelection() {
    if (!selected || !selected.region) return;
    const scale = baseScale() * view.z;
    const region = selected.region;
    ctx.fillStyle = 'rgba(255, 226, 138, .18)';
    for (let i = 0; i < region.cells.length; i += 2) {
      const spot = screenPoint(region.cells[i] * CELL, region.cells[i + 1] * CELL);
      ctx.fillRect(spot.x, spot.y, CELL * scale + 1, CELL * scale + 1);
    }
  }

  function render(time) {
    if (!active) return;
    const delta = Math.min(1, (time - lastTime) / 80 || 1);
    lastTime = time;
    for (const key of ['x', 'y', 'z']) view[key] += (view[`t${key}`] - view[key]) * Math.min(0.24, delta * 0.18);

    drawSea(time);
    drawTerrain();
    drawSelection();
    drawCreatures(time);
    drawBeacons(time);
    drawLabels();
    frame = requestAnimationFrame(render);
  }

  /* ---------------------------------------------------------------- *
   * What you are looking at                                           *
   * ---------------------------------------------------------------- */
  function monsterArt(monster) {
    const bundled = typeof BUNDLE !== 'undefined' && BUNDLE ? BUNDLE : null;
    if (monster.catalogArt) {
      if (bundled && bundled.realmCatalogSprites && bundled.realmCatalogSprites[monster.catalogArt]) {
        return { url: bundled.realmCatalogSprites[monster.catalogArt], animated: false };
      }
      return { url: `assets/realm-catalog/${encodeURIComponent(monster.catalogArt)}`, animated: false };
    }
    if (monster.animation) {
      if (bundled && bundled.realmMonsterAnimations && bundled.realmMonsterAnimations[monster.id]) {
        return { url: bundled.realmMonsterAnimations[monster.id], animated: true };
      }
      return { url: `assets/realm-monster-animations/${encodeURIComponent(monster.animation)}`, animated: true };
    }
    if (!monster.art) return null;
    if (bundled && bundled.realmMonsterSprites) return { url: bundled.realmMonsterSprites[monster.id] || '', animated: false };
    return { url: `assets/realm-monsters/${encodeURIComponent(monster.art)}`, animated: false };
  }

  function monsterRow(monster) {
    const stats = [
      monster.hp && `${num(monster.hp)} HP`,
      monster.defense && `${num(monster.defense)} DEF`,
      monster.exp && `${num(monster.exp)} XP`
    ].filter(Boolean).join(' · ');
    const art = monsterArt(monster);
    return `<li class="realm-monster">${art && art.url
      ? `<img class="realm-monster-art${art.animated ? ' is-animated' : ''}" src="${art.url}" alt=""
          loading="lazy" decoding="async" onerror="this.remove()">` : ''
      }<span><b>${html(monster.name)}</b>${stats ? `<small>${stats}</small>` : ''}</span></li>`;
  }

  function renderDetails() {
    if (!selected) {
      details.innerHTML = '<div class="realm-kicker">Realm atlas</div>'
        + '<h2>Pick a region</h2>'
        + '<p>The New Realm is the same map every time, so this is its shape: the sea, '
        + 'the mountains you cannot walk into, and the ground between them. Click a region '
        + 'to see what lives there.</p>'
        + '<p class="source-note">The shape is traced from a map of the realm with the fog of war '
        + 'lifted. Every creature, stat and beacon below it is read from the installed game client.</p>';
      return;
    }
    const region = selected.region;
    const zone = region.zoneId && zoneOf(region.zoneId);
    const ground = (GROUND[region.letter] || [, , region.letter])[2];
    if (!zone) {
      details.innerHTML = `<div class="realm-kicker">Terrain</div><h2>${html(ground)}</h2>`
        + '<p>Ground the atlas can draw but has not matched to one of the client\'s biomes.</p>';
      return;
    }
    const guardian = beaconOf(zone.name);
    const monsters = (zone.monsters || []).slice().sort((a, b) => (b.hp || 0) - (a.hp || 0));
    details.innerHTML = `
      <div class="realm-kicker">${html(zone.difficulty || 'Realm biome')}${
        zone.kind === 'encounter' ? ' · encounter' : zone.kind === 'seasonal' ? ' · seasonal' : ''}</div>
      <h2>${html(zone.name)}</h2>
      <p>${html(ground.charAt(0).toUpperCase() + ground.slice(1))}, about ${
        num(Math.round(region.size))} cells of the realm.</p>
      ${zone.encounterChance ? `<p class="realm-chance">${
        Math.round(zone.encounterChance * 100)}% encounter chance · score ${num(zone.encounterScore)}</p>` : ''}
      ${guardian ? `<div class="realm-stat"><b>${num(guardian.hp)}</b><span>beacon guardian HP</span></div>` : ''}
      <h3>What lives here <span>${monsters.length}</span></h3>
      <ul class="realm-monsters">${monsters.map(monsterRow).join('')
        || '<li><small>The client lists no native creature for this biome.</small></li>'}</ul>
      <p class="source-note">Creatures and stats are read from the installed client. Which stretch of
      ground carries which biome is the atlas's own reading of the map.</p>`;
  }

  /* ---------------------------------------------------------------- *
   * Pointing at it                                                    *
   * ---------------------------------------------------------------- */
  function regionAt(world) {
    const col = Math.floor(world.x / CELL), row = Math.floor(world.y / CELL);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    for (const region of regions) {
      if (col < region.box.minX || col > region.box.maxX
        || row < region.box.minY || row > region.box.maxY) continue;
      for (let i = 0; i < region.cells.length; i += 2) {
        if (region.cells[i] === col && region.cells[i + 1] === row) return region;
      }
    }
    return null;
  }

  function focus(region) {
    selected = { region };
    const width = (region.box.maxX - region.box.minX + 1) * CELL;
    const height = (region.box.maxY - region.box.minY + 1) * CELL;
    const size = box();
    const fit = Math.min(size.width / (width * 1.7), size.height / (height * 1.7)) / baseScale();
    view.tx = region.cx;
    view.ty = region.cy;
    view.tz = Math.max(1, Math.min(4.5, fit));
    renderDetails();
  }

  function onPointerDown(event) {
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, vx: view.tx, vy: view.ty, moved: false };
  }
  function onPointerMove(event) {
    const size = box();
    pointer = { x: event.clientX - size.left, y: event.clientY - size.top };
    if (!drag) return;
    const scale = baseScale() * view.z;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.moved = drag.moved || Math.hypot(dx, dy) > 5;
    view.tx = drag.vx - dx / scale;
    view.ty = drag.vy - dy / scale;
  }
  function onPointerUp(event) {
    if (!drag || drag.moved) { drag = null; return; }
    const size = box();
    const spot = worldPoint(event.clientX - size.left, event.clientY - size.top);
    drag = null;
    const region = regionAt(spot);
    if (region) focus(region);
  }
  function onWheel(event) {
    event.preventDefault();
    const spot = worldPoint(event.offsetX, event.offsetY);
    const next = Math.max(0.8, Math.min(6, view.tz * (event.deltaY > 0 ? 0.86 : 1.16)));
    const ratio = next / view.tz;
    view.tx = spot.x - (spot.x - view.tx) / ratio;
    view.ty = spot.y - (spot.y - view.ty) / ratio;
    view.tz = next;
  }
  function resize() {
    const size = box();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function home() {
    selected = null;
    view.tx = coast.minX + coast.width / 2;
    view.ty = coast.minY + coast.height / 2;
    view.tz = 1;
    renderDetails();
  }

  function start(text) {
    parse(text);
    findCoast();
    findRegions();
    paintTerrain();
    view.x = view.tx = coast.minX + coast.width / 2;
    view.y = view.ty = coast.minY + coast.height / 2;
    renderDetails();
    // The page may already be on screen: the map is fetched, and whoever
    // opened the atlas is looking at an empty canvas until this arrives.
    if (active && !frame) { lastTime = 0; frame = requestAnimationFrame(render); }
  }

  function init() {
    canvas = document.getElementById('realmCanvas');
    details = document.getElementById('realmDetails');
    reset = document.getElementById('realmReset');
    if (!canvas || !details || typeof RealmData === 'undefined') return;
    ctx = canvas.getContext('2d');
    resize();
    new ResizeObserver(resize).observe(canvas);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => { pointer = { x: -1e4, y: -1e4 }; });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    if (reset) reset.addEventListener('click', home);

    const bundled = typeof BUNDLE !== 'undefined' && BUNDLE && BUNDLE.sources && BUNDLE.sources.realmTerrain;
    if (bundled) { start(bundled); return; }
    fetch('../data/Realm/realm-terrain.txt')
      .then(response => response.text())
      .then(start)
      .catch(() => {
        details.innerHTML = '<p class="note warn">Could not read the traced realm map.</p>';
      });
  }

  function setVisible(value) {
    active = value;
    if (active && grid && !frame) { lastTime = 0; frame = requestAnimationFrame(render); }
    if (!active && frame) { cancelAnimationFrame(frame); frame = 0; }
  }

  return { init, setVisible };
})();

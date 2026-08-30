/*
 * The Realm Atlas.
 *
 * The New Realm is the same map every time, so it can be drawn. Three sources
 * meet here and it is worth keeping them apart:
 *
 *   the shape      data/Realm/realm-terrain.txt, traced from an annotated
 *                  picture of the realm — which ground is where, and where
 *                  the roads and the island's edge are.
 *   the beacons    data/Realm/realm-beacons.txt, the marker squares off the
 *                  same picture. Thirty-nine of them, all identical.
 *   everything     the installed game client, by way of generate-realm.js:
 *                  which creatures live in a biome, their health, what a
 *                  beacon guardian is worth.
 *
 * Which colour is which biome is a fourth thing, and the weakest: it is a
 * player's reading, kept in realm-biomes.txt and carried through the traced
 * legend. The atlas says so wherever it shows one.
 */
var RealmMap = (function () {
  'use strict';

  // World units per traced cell.
  const CELL = 4;

  /*
   * How much you see, and when.
   *
   * Zoomed out the realm is its biomes and nothing else; there is no reading
   * a road at that size, only clutter. The roads come in as you close on it,
   * then the beacons, then the creatures. Each threshold is the scale at
   * which the thing it governs is big enough to be worth drawing.
   */
  const SHOW_ROADS = 0.9;
  // Beacons are one of the reasons to open the atlas at all, so they are on
  // from the first look rather than being something you have to find.
  const SHOW_BEACONS = 0.35;
  // The ground stops being a colour and becomes pixels.
  const SHOW_GRAIN = 2.2;
  const SHOW_SCENERY = 3.4;

  /*
   * What is moving about down there, and how close you have to be to see it.
   *
   * The realm reads from the top down: the set-piece encounters are the
   * things you can pick out from altitude — a Cube God is visible from
   * anywhere — then Oryx's own agents, and only when you are properly down
   * among it do the ordinary monsters of a biome appear. The client sorts
   * them into exactly these three, so the ladder is its own, not invented.
   */
  /*
   * "screen" is how big a creature is drawn on the glass, not on the map. A
   * portrait that scaled with the terrain was a speck from any height worth
   * looking at the realm from — so instead it holds its size as you pull
   * back, which is to say it grows against the ground it stands on, and
   * settles into scale as you come down to it.
   */
  const TIERS = [
    { key: 'encounters', from: 0.5, screen: 34, cap: 3 },
    { key: 'heroes', from: 1.7, screen: 26, cap: 3 },
    { key: 'regular', from: 3.4, screen: 19, cap: 6 }
  ];

  const html = value => String(value || '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const num = value => Number(value || 0).toLocaleString('en-US');

  let canvas, ctx, details, reset;
  let grid = null, cols = 0, rows = 0;
  let legend = new Map();                          // letter -> { hex, biome }
  let beacons = [];
  let terrain = null, roads = null;                // painted once, then blitted
  let regions = [];
  let coast = { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  let active = false, frame = 0, selected = null, lastTime = 0;
  let view = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 };
  let drag = null;

  const SEA = '~';
  const OFF = '.';
  const ROAD = '=';
  const isWater = letter => letter === SEA || letter === OFF;

  /*
   * The client's own record for a biome, matched on the name the map was read
   * as. The generated zone ids do not always agree with their names, so the
   * name is what is matched — it is what the atlas shows either way.
   */
  function zoneFor(biome) {
    if (!biome || typeof RealmData === 'undefined') return null;
    const zones = RealmData.zones || [];
    const plain = text => String(text).toLowerCase().replace(/[^a-z]/g, '');
    const wanted = plain(biome);
    return zones.find(zone => plain(zone.name) === wanted)
      || zones.find(zone => plain(zone.id) === wanted)
      || zones.find(zone => plain(zone.name).includes(wanted) || wanted.includes(plain(zone.name)))
      || null;
  }
  const beaconFor = name => (typeof RealmData === 'undefined' ? null
    : (RealmData.beacons || []).find(entry => entry.name === name)) || null;

  /* ---------------------------------------------------------------- *
   * Reading what was traced                                           *
   * ---------------------------------------------------------------- */
  function parse(text) {
    const lines = [];
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      if (!raw || raw.startsWith('##')) continue;
      if (raw.startsWith('legend|')) {
        const [, letter, hex, biome] = raw.split('|');
        legend.set(letter, { hex, biome: biome || '' });
        continue;
      }
      lines.push(raw);
    }
    grid = lines;
    rows = lines.length;
    cols = lines.reduce((widest, line) => Math.max(widest, line.length), 0);
  }

  function parseBeacons(text) {
    beacons = [];
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('##')) continue;
      const [col, row] = line.split('|').map(Number);
      if (Number.isFinite(col) && Number.isFinite(row)) {
        beacons.push({ x: (col + 0.5) * CELL, y: (row + 0.5) * CELL, col, row });
      }
    }
  }

  const at = (col, row) => (row < 0 || row >= rows || col < 0 || col >= cols)
    ? OFF : (grid[row][col] || OFF);

  function findCoast() {
    let minX = cols, minY = rows, maxX = 0, maxY = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (isWater(at(col, row))) continue;
        if (col < minX) minX = col; if (col > maxX) maxX = col;
        if (row < minY) minY = row; if (row > maxY) maxY = row;
      }
    }
    const margin = 5;
    coast = {
      minX: (minX - margin) * CELL, minY: (minY - margin) * CELL,
      maxX: (maxX + margin) * CELL, maxY: (maxY + margin) * CELL
    };
    coast.width = coast.maxX - coast.minX;
    coast.height = coast.maxY - coast.minY;
  }

  function cellIn(region, col, row) {
    for (let i = 0; i < region.cells.length; i += 2) {
      if (region.cells[i] === col && region.cells[i + 1] === row) return true;
    }
    return false;
  }

  /*
   * Regions are the connected stretches of one biome — not of one colour.
   *
   * The map paints a biome in two or three tones, and Abandoned City in four:
   * the green ring at its heart is a different colour from the ground around
   * it but it is the same place, and clicking the ring should not open
   * something else. So the flood spreads across any neighbour that reads as
   * the same biome, and only ground with no name yet is kept apart by its own
   * colour, since that is all there is to tell one patch from another.
   *
   * Roads and sea are not regions; a stretch too small to aim at is scenery —
   * drawn, but not something the player is meant to click.
   */
  const keyOf = letter => {
    const entry = legend.get(letter);
    return entry && entry.biome ? 'biome:' + entry.biome : 'ground:' + letter;
  };

  function findRegions() {
    const seen = new Uint8Array(cols * rows);
    const found = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const letter = at(col, row);
        if (seen[row * cols + col] || isWater(letter) || letter === ROAD) continue;
        const key = keyOf(letter);
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
            const next = at(nx, ny);
            if (seen[ny * cols + nx] || isWater(next) || next === ROAD) continue;
            if (keyOf(next) !== key) continue;
            seen[ny * cols + nx] = 1;
            queue.push([nx, ny]);
          }
        }
        if (cells.length / 2 < 24) continue;
        const entry = legend.get(letter) || { hex: '#555555', biome: '' };
        found.push({
          letter, cells, size: cells.length / 2,
          hex: entry.hex,
          biome: entry.biome,
          zone: zoneFor(entry.biome),
          box: { minX, maxX, minY, maxY },
          cx: (minX + maxX + 1) / 2 * CELL,
          cy: (minY + maxY + 1) / 2 * CELL
        });
      }
    }
    regions = found.sort((a, b) => b.size - a.size);
    for (const region of regions) populate(region);

    // A beacon belongs to whatever it stands on, so opening one opens the
    // biome it guards.
    for (const beacon of beacons) {
      beacon.region = regions.find(region =>
        beacon.col >= region.box.minX && beacon.col <= region.box.maxX
        && beacon.row >= region.box.minY && beacon.row <= region.box.maxY
        && cellIn(region, beacon.col, beacon.row)) || null;
    }
  }

  /* ---------------------------------------------------------------- *
   * Painting the map, once                                            *
   * ---------------------------------------------------------------- */
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  // A colour and the same colour a shade deeper, so a wide flat biome has
  // grain in it rather than reading as one poured shape.
  function shade(hex, amount) {
    const n = parseInt(String(hex).slice(1), 16);
    const to = v => Math.max(0, Math.min(255, Math.round(v * amount)));
    return 'rgb(' + to((n >> 16) & 255) + ',' + to((n >> 8) & 255) + ',' + to(n & 255) + ')';
  }

  function paintTerrain() {
    terrain = document.createElement('canvas');
    terrain.width = cols * CELL;
    terrain.height = rows * CELL;
    const paint = terrain.getContext('2d');

    const tone = new Map();
    for (const [letter, entry] of legend) {
      if (!/^#[0-9a-f]{6}$/i.test(entry.hex || '')) continue;
      tone.set(letter, [shade(entry.hex, 1.07), shade(entry.hex, 0.89)]);
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const letter = at(col, row);
        if (isWater(letter) || letter === ROAD) continue;
        const pair = tone.get(letter);
        if (!pair) continue;
        paint.fillStyle = hash(col, row) > 0.5 ? pair[0] : pair[1];
        paint.fillRect(col * CELL, row * CELL, CELL, CELL);
      }
    }

    // The shore, so the coastline reads as a coastline rather than as the
    // place the colour happens to stop.
    paint.fillStyle = 'rgba(10, 18, 30, .42)';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (isWater(at(col, row))) continue;
        if (isWater(at(col - 1, row)) || isWater(at(col + 1, row))
          || isWater(at(col, row - 1)) || isWater(at(col, row + 1))) {
          paint.fillRect(col * CELL, row * CELL, CELL, CELL);
        }
      }
    }
  }

  // Roads on their own layer, so they can be faded in as you close on the map
  // without repainting the ground under them.
  function paintRoads() {
    roads = document.createElement('canvas');
    roads.width = cols * CELL;
    roads.height = rows * CELL;
    const paint = roads.getContext('2d');
    paint.fillStyle = '#cdb994';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (at(col, row) !== ROAD) continue;
        paint.fillRect(col * CELL, row * CELL, CELL, CELL);
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
  const zoom = () => baseScale() * view.z;
  function screenPoint(x, y) {
    const size = box(); const scale = zoom();
    return { x: (x - view.x) * scale + size.width / 2, y: (y - view.y) * scale + size.height / 2 };
  }
  function worldPoint(x, y) {
    const size = box(); const scale = zoom();
    return { x: (x - size.width / 2) / scale + view.x, y: (y - size.height / 2) / scale + view.y };
  }

  function drawSea(time) {
    const size = box();
    const deep = ctx.createLinearGradient(0, 0, 0, size.height);
    deep.addColorStop(0, '#0f2036');
    deep.addColorStop(1, '#0a1728');
    ctx.fillStyle = deep;
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.lineWidth = 1;
    for (let row = -30; row < size.height + 40; row += 22) {
      ctx.strokeStyle = 'rgba(122, 190, 236, ' + (0.045 + 0.045 * Math.sin(row / 90)) + ')';
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
    const scale = zoom();
    const origin = screenPoint(0, 0);
    ctx.imageSmoothingEnabled = scale < 1.2;
    ctx.drawImage(terrain, origin.x, origin.y, terrain.width * scale, terrain.height * scale);
    if (scale >= SHOW_ROADS) {
      // Faded in over the first part of the step, so they arrive rather than
      // appear.
      ctx.globalAlpha = Math.min(1, (scale - SHOW_ROADS) / 0.5) * 0.85;
      ctx.drawImage(roads, origin.x, origin.y, roads.width * scale, roads.height * scale);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------------------- *
   * The ground, close up                                              *
   * ---------------------------------------------------------------- *
   * Far out a biome is a colour. Close in it should be a surface, and the
   * surface should be made of pixels, because everything else here is. Both
   * the grain and the scenery are placed on a hash of the cell they sit in,
   * so they hold still while you pan — the one thing that would give away
   * that they are drawn rather than there.
   */
  /*
   * Where a tile comes from, and how it is chosen.
   *
   * web/assets/realm-tiles holds two strips per biome, cut from the client's
   * own sheets by tools/build-realm-tiles.js: the ground it is floored with,
   * ordered dark to light, and the things the client names as standing on it
   * — a saguaro in the desert, a purple tree in the undead forest, skulls in
   * Risen Hell. Where the client names none, none are drawn: a biome is
   * better bare than wearing another's scenery.
   */
  const tiles = { index: null, ground: new Map(), props: new Map() };
  function loadTiles() {
    const bundled = typeof BUNDLE !== 'undefined' && BUNDLE && BUNDLE.realmTiles;
    const picture = file => {
      const image = new Image();
      image.decoding = 'async';
      image.src = bundled && bundled.art && bundled.art[file]
        ? bundled.art[file] : 'assets/realm-tiles/' + file;
      return image;
    };
    const ready = index => {
      tiles.index = index;
      for (const [biome, entry] of Object.entries(index)) {
        if (entry.ground) {
          tiles.ground.set(biome, { image: picture(entry.ground.file), tile: entry.ground.tile, count: entry.ground.count });
        }
        if (entry.props) {
          tiles.props.set(biome, { image: picture(entry.props.file), tile: entry.props.tile, count: entry.props.count });
        }
      }
    };
    if (bundled && bundled.index) { ready(bundled.index); return; }
    fetch('assets/realm-tiles/index.json')
      .then(response => response.json()).then(ready).catch(() => { tiles.index = {}; });
  }

  /*
   * Which tile, and why not at random.
   *
   * Picking one per cell out of a hash gives every cell an unrelated
   * neighbour, and a field of that reads as static — which is exactly what it
   * is. Real ground comes in patches: a stretch of grass, a worn place, the
   * dirt where the two meet. So the choice comes off a smooth field instead —
   * value noise, two octaves, one broad and one to break up its edges — and
   * because the strip is ordered dark to light, a slow rise in the field is a
   * slow change from worn to fresh rather than a jump between unrelated
   * tiles.
   */
  function smooth(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const ease = t => t * t * (3 - 2 * t);
    const u = ease(fx), v = ease(fy);
    const a = hash(x0, y0), b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  const field = (col, row) =>
    smooth(col / 9, row / 9) * 0.68 + smooth(col / 2.7, row / 2.7) * 0.32;

  function drawGround(scale) {
    if (scale < SHOW_GRAIN) return;
    const size = box();
    const unit = CELL * scale;
    const topLeft = worldPoint(0, 0);
    const bottomRight = worldPoint(size.width, size.height);
    const from = { col: Math.max(0, Math.floor(topLeft.x / CELL)), row: Math.max(0, Math.floor(topLeft.y / CELL)) };
    const to = {
      col: Math.min(cols - 1, Math.ceil(bottomRight.x / CELL)),
      row: Math.min(rows - 1, Math.ceil(bottomRight.y / CELL))
    };
    // A hard ceiling on the work: past this many cells the view is so wide
    // that the grain would not be visible anyway.
    if ((to.col - from.col) * (to.row - from.row) > 26000) return;

    const grain = Math.min(1, (scale - SHOW_GRAIN) / 1.2);
    const scenic = Math.min(1, (scale - SHOW_SCENERY) / 1.6);
    for (let row = from.row; row <= to.row; row++) {
      for (let col = from.col; col <= to.col; col++) {
        const letter = at(col, row);
        if (isWater(letter) || letter === ROAD) continue;
        const entry = legend.get(letter);
        if (!entry || !/^#[0-9a-f]{6}$/i.test(entry.hex || '')) continue;
        const spot = screenPoint(col * CELL, row * CELL);
        const n = hash(col, row);

        const ground = entry.biome && tiles.ground.get(entry.biome);
        if (ground && ground.image.complete && ground.image.naturalWidth) {
          const slot = Math.min(ground.count - 1, Math.floor(field(col, row) * ground.count));
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(ground.image, slot * ground.tile, 0, ground.tile, ground.tile,
            spot.x, spot.y, unit + 1, unit + 1);

          // And what stands on it, on about one cell in eleven — sparse
          // enough that a forest reads as trees rather than as a hedge.
          const standing = scenic > 0 && tiles.props.get(entry.biome);
          if (standing && n > 0.91 && standing.image.complete && standing.image.naturalWidth) {
            const which = Math.floor(hash(row * 3 + 1, col * 7 + 5) * standing.count) % standing.count;
            ctx.globalAlpha = scenic;
            ctx.drawImage(standing.image, which * standing.tile, 0, standing.tile, standing.tile,
              spot.x - unit * 0.25, spot.y - unit * 0.5, unit * 1.5, unit * 1.5);
            ctx.globalAlpha = 1;
          }
          continue;
        }

        // Grain: two or three darker pixels inside the cell, in one of four
        // arrangements. Enough to break the flat, not enough to read as
        // noise.
        ctx.globalAlpha = grain * 0.5;
        ctx.fillStyle = palette(entry.hex).deep;
        const step = unit / 4;
        const which = Math.floor(n * 4);
        for (let i = 0; i < 3; i++) {
          const dx = ((which + i * 2) % 4) * step;
          const dy = ((which * 3 + i) % 4) * step;
          ctx.fillRect(spot.x + dx, spot.y + dy, step, step);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * What lives there, moving about                                    *
   * ---------------------------------------------------------------- */
  const artwork = new Map();                       // url -> Image, or null
  function picture(monster) {
    const art = monsterArt(monster);
    if (!art || !art.url) return null;
    if (!artwork.has(art.url)) {
      const image = new Image();
      image.decoding = 'async';
      image.onerror = () => artwork.set(art.url, null);
      image.src = art.url;
      artwork.set(art.url, image);
    }
    const image = artwork.get(art.url);
    return image && image.complete && image.naturalWidth ? image : null;
  }

  /*
   * Give every creature a home and a wander.
   *
   * A home cell picked off the region's own cells, so nothing stands in the
   * sea, and a slow loop around it with a period of its own — creatures that
   * share a phase move like a formation, which is not what a realm looks
   * like.
   */
  function populate(region) {
    region.life = [];
    const zone = region.zone;
    if (!zone) return;
    const groups = zone.wikiGroups || {};
    const count = region.cells.length / 2;
    for (const tier of TIERS) {
      const list = (groups[tier.key] || []).slice(0, tier.cap);
      list.forEach((monster, index) => {
        const pick = Math.floor(hash(index + 7, region.cells[0] + tier.key.length) * count);
        const cell = Math.max(0, Math.min(count - 1, pick)) * 2;
        region.life.push({
          monster, tier,
          x: (region.cells[cell] + 0.5) * CELL,
          y: (region.cells[cell + 1] + 0.5) * CELL,
          drift: 6 + index * 4,
          period: 5200 + index * 900 + tier.key.length * 300,
          phase: index * 1.7 + tier.key.length
        });
      });
    }
  }

  function drawLife(time, scale) {
    for (const region of regions) {
      if (!region.life || !region.life.length) continue;
      for (const being of region.life) {
        if (scale < being.tier.from) continue;
        const fade = Math.min(1, (scale - being.tier.from) / 0.6);
        const x = being.x + Math.sin(time / being.period + being.phase) * being.drift;
        const y = being.y + Math.cos(time / (being.period * 1.28) + being.phase) * being.drift * 0.7;
        const spot = screenPoint(x, y);
        // Held on the glass, easing towards the map's own scale only once
        // you are close enough for that to still be legible.
        const drawn = being.tier.screen * Math.max(0.85, Math.min(1.5, 1.5 - scale * 0.08));
        const image = picture(being.monster);
        ctx.globalAlpha = fade;
        if (image) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(image, spot.x - drawn / 2, spot.y - drawn / 2, drawn, drawn);
        } else {
          // Until its portrait loads, a creature is a mark rather than
          // nothing: the realm should not look empty while it fetches.
          ctx.fillStyle = 'rgba(244, 228, 186, .85)';
          ctx.fillRect(spot.x - drawn / 6, spot.y - drawn / 6, drawn / 3, drawn / 3);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawBeacons(time) {
    const scale = zoom();
    if (scale < SHOW_BEACONS) return;
    const fade = Math.min(1, (scale - SHOW_BEACONS) / 0.4);
    const radius = 7 * Math.max(1, Math.min(2.2, scale));
    for (const beacon of beacons) {
      const spot = screenPoint(beacon.x, beacon.y);
      const pulse = 1 + Math.sin(time / 430 + beacon.x) * 0.16;
      const lit = selected && selected.beacon === beacon;
      ctx.save();
      ctx.translate(spot.x, spot.y);
      ctx.globalAlpha = fade * 0.32;
      ctx.strokeStyle = '#8ff0ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, radius * 1.9 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius * 0.86, radius * 0.62);
      ctx.lineTo(-radius * 0.86, radius * 0.62);
      ctx.closePath();
      // Outlined, because a beacon sits on ground of every colour there is
      // and a plain cyan triangle disappears against half of them.
      ctx.fillStyle = lit ? '#fff0b8' : '#8ff0ff';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(6, 12, 20, .85)';
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawSelection() {
    if (!selected || !selected.region) return;
    const scale = zoom();
    const region = selected.region;
    ctx.fillStyle = 'rgba(255, 228, 150, .2)';
    for (let i = 0; i < region.cells.length; i += 2) {
      const spot = screenPoint(region.cells[i] * CELL, region.cells[i + 1] * CELL);
      ctx.fillRect(spot.x, spot.y, CELL * scale + 1, CELL * scale + 1);
    }
  }

  function render(time) {
    if (!active) return;
    const delta = Math.min(1, (time - lastTime) / 80 || 1);
    lastTime = time;
    for (const key of ['x', 'y', 'z']) view[key] += (view['t' + key] - view[key]) * Math.min(0.24, delta * 0.18);
    const scale = zoom();
    drawSea(time);
    drawTerrain();
    drawGround(scale);
    drawSelection();
    drawLife(time, scale);
    drawBeacons(time);
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
      return { url: 'assets/realm-catalog/' + encodeURIComponent(monster.catalogArt), animated: false };
    }
    if (monster.animation) {
      if (bundled && bundled.realmMonsterAnimations && bundled.realmMonsterAnimations[monster.id]) {
        return { url: bundled.realmMonsterAnimations[monster.id], animated: true };
      }
      return { url: 'assets/realm-monster-animations/' + encodeURIComponent(monster.animation), animated: true };
    }
    if (!monster.art) return null;
    if (bundled && bundled.realmMonsterSprites) return { url: bundled.realmMonsterSprites[monster.id] || '', animated: false };
    return { url: 'assets/realm-monsters/' + encodeURIComponent(monster.art), animated: false };
  }

  function monsterRow(monster) {
    const stats = [
      monster.hp && num(monster.hp) + ' HP',
      monster.defense && num(monster.defense) + ' DEF',
      monster.exp && num(monster.exp) + ' XP'
    ].filter(Boolean).join(' · ');
    const art = monsterArt(monster);
    return '<li class="realm-monster">' + (art && art.url
      ? '<img class="realm-monster-art' + (art.animated ? ' is-animated' : '') + '" src="' + art.url
        + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '')
      + '<span><b>' + html(monster.name) + '</b>' + (stats ? '<small>' + stats + '</small>' : '')
      + '</span></li>';
  }

  function renderDetails() {
    if (!selected) {
      details.innerHTML = '<div class="realm-kicker">Realm atlas</div>'
        + '<h2>Pick a region</h2>'
        + '<p>The New Realm is the same map every time, so this is its shape — and the '
        + beacons.length + ' beacons on it, where the map says they are. Close on it and the roads '
        + 'come in, then the beacons, then what lives there.</p>'
        + '<p class="source-note">The shape and the beacons are traced from an annotated map of '
        + 'the realm. Every creature, stat and guardian below them is read from the installed '
        + 'game client.</p>';
      return;
    }
    const region = selected.region;
    if (!region) return;
    if (!region.biome) {
      details.innerHTML = '<div class="realm-kicker">Unnamed ground</div>'
        + '<h2>' + html(region.hex) + '</h2>'
        + '<p>A stretch of the realm whose biome has not been named yet, so the atlas will not '
        + 'guess at one. It is drawn, and it is waiting.</p>'
        + '<p class="source-note">Names live in data/Realm/realm-biomes.txt.</p>';
      return;
    }
    const zone = region.zone;
    const guardian = beaconFor(region.biome) || (zone && beaconFor(zone.name));
    const here = beacons.filter(beacon => beacon.region === region).length;
    const monsters = zone && zone.monsters
      ? zone.monsters.slice().sort((a, b) => (b.hp || 0) - (a.hp || 0)) : [];
    details.innerHTML = '<div class="realm-kicker">'
      + html(zone ? (zone.difficulty || 'Realm biome') : 'Realm biome')
      + (zone && zone.kind === 'encounter' ? ' · encounter'
        : zone && zone.kind === 'seasonal' ? ' · seasonal' : '')
      + '</div><h2>' + html(region.biome) + '</h2>'
      + '<p>About ' + num(Math.round(region.size)) + ' cells of the realm'
      + (here ? ', with ' + here + ' beacon' + (here === 1 ? '' : 's') + ' on it' : '') + '.</p>'
      + (zone && zone.encounterChance
        ? '<p class="realm-chance">' + Math.round(zone.encounterChance * 100)
          + '% encounter chance · score ' + num(zone.encounterScore) + '</p>' : '')
      + (guardian ? '<div class="realm-stat"><b>' + num(guardian.hp)
        + '</b><span>beacon guardian HP</span></div>' : '')
      + '<h3>What lives here <span>' + monsters.length + '</span></h3>'
      + '<ul class="realm-monsters">' + (monsters.map(monsterRow).join('')
        || '<li><small>The client has no creature list under this name.</small></li>') + '</ul>'
      + '<p class="source-note">Creatures and stats are read from the installed client. Which '
      + 'stretch of ground carries which biome was named by hand, from the map.</p>';
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
      if (cellIn(region, col, row)) return region;
    }
    return null;
  }

  function focus(region, beacon) {
    selected = { region: region, beacon: beacon || null };
    const width = (region.box.maxX - region.box.minX + 1) * CELL;
    const height = (region.box.maxY - region.box.minY + 1) * CELL;
    const size = box();
    const fit = Math.min(size.width / (width * 1.6), size.height / (height * 1.6)) / baseScale();
    view.tx = beacon ? beacon.x : region.cx;
    view.ty = beacon ? beacon.y : region.cy;
    view.tz = Math.max(1.4, Math.min(8, fit));
    renderDetails();
  }

  function onPointerDown(event) {
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, vx: view.tx, vy: view.ty, moved: false };
  }
  function onPointerMove(event) {
    if (!drag) return;
    const scale = zoom();
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
    // A beacon is a smaller target than the ground under it, so it is tried
    // first, within a reach that grows as the map shrinks.
    let nearest = null, best = 9 / zoom();
    for (const beacon of beacons) {
      const distance = Math.hypot(beacon.x - spot.x, beacon.y - spot.y);
      if (distance < best) { best = distance; nearest = beacon; }
    }
    if (nearest && nearest.region) { focus(nearest.region, nearest); return; }
    const region = regionAt(spot);
    if (region) focus(region);
  }
  function onWheel(event) {
    event.preventDefault();
    const spot = worldPoint(event.offsetX, event.offsetY);
    // Far more room to close in than before: the realm is a great deal bigger
    // than it looks from above.
    const next = Math.max(0.8, Math.min(14, view.tz * (event.deltaY > 0 ? 0.85 : 1.18)));
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

  function start(terrainText, beaconText) {
    parse(terrainText);
    parseBeacons(beaconText || '');
    findCoast();
    findRegions();
    paintTerrain();
    paintRoads();
    loadTiles();
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
    if (!canvas || !details) return;
    ctx = canvas.getContext('2d');
    resize();
    new ResizeObserver(resize).observe(canvas);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    if (reset) reset.addEventListener('click', home);

    const bundled = typeof BUNDLE !== 'undefined' && BUNDLE && BUNDLE.sources;
    if (bundled && bundled.realmTerrain) {
      start(bundled.realmTerrain, bundled.realmBeacons);
      return;
    }
    Promise.all([
      fetch('../data/Realm/realm-terrain.txt').then(response => response.text()),
      fetch('../data/Realm/realm-beacons.txt').then(response => response.text()).catch(() => '')
    ]).then(function (texts) { start(texts[0], texts[1]); })
      .catch(function () {
        details.innerHTML = '<p class="note warn">Could not read the traced realm map.</p>';
      });
  }

  function setVisible(value) {
    active = value;
    if (active && grid && !frame) { lastTime = 0; frame = requestAnimationFrame(render); }
    if (!active && frame) { cancelAnimationFrame(frame); frame = 0; }
  }

  return { init: init, setVisible: setVisible };
})();

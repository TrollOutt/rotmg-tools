/* Interactive, deliberately topological map of the New Realm. */
var RealmMap = (function () {
  'use strict';

  const WORLD = { width: 1100, height: 1040 };
  const land = { points: [[96,322],[179,205],[343,145],[565,154],[765,193],[960,318],[992,520],[942,720],[796,892],[552,972],[328,923],[154,777],[87,573]] };
  const mountains = { color: '#3d4751', points: [[180,235],[268,132],[350,175],[425,108],[515,168],[606,104],[686,174],[782,135],[870,245],[830,335],[698,313],[604,279],[510,304],[392,274],[290,319]] };
  const zones = [
    { id: 'shore-plains', color: '#8fa363', points: [[105,390],[184,279],[274,284],[260,392],[183,474],[110,498]] },
    { id: 'shore-sand', color: '#c9b16c', points: [[853,295],[944,358],[978,510],[908,501],[856,410]] },
    { id: 'low-forest', color: '#78a13a', points: [[172,398],[285,314],[417,348],[450,468],[356,566],[196,529]] },
    { id: 'low-plains', color: '#789657', points: [[430,332],[588,298],[680,362],[652,504],[510,533],[449,467]] },
    { id: 'low-desert', color: '#c4a05b', points: [[678,349],[822,303],[920,408],[865,543],[708,506],[650,493]] },
    { id: 'mid-forest', color: '#406b4a', points: [[164,559],[329,556],[440,633],[390,738],[210,727],[128,647]] },
    { id: 'mid-plains', color: '#66714d', points: [[396,543],[559,531],[669,609],[637,734],[469,752],[388,665]] },
    { id: 'mid-desert', color: '#9d7043', points: [[670,537],[856,551],[932,645],[830,744],[658,738]] },
    { id: 'high-forest', color: '#1f5636', points: [[220,750],[405,753],[455,876],[367,941],[208,876],[156,794]] },
    { id: 'high-plains', color: '#392755', points: [[450,758],[654,744],[730,860],[630,950],[455,909]] },
    { id: 'high-desert', color: '#cdb68b', points: [[728,752],[884,730],[958,808],[876,909],[739,908],[678,851]] },
    { id: 'runic-tundra', color: '#bfdded', points: [[292,246],[410,205],[544,223],[601,286],[490,329],[365,314]] },
    { id: 'abandoned-city', color: '#76614c', points: [[651,234],[784,246],[849,313],[808,374],[680,358],[617,300]] },
    { id: 'coral-reefs', color: '#48bcb4', points: [[128,387],[181,336],[227,377],[207,459],[147,470]] },
    { id: 'shipwreck-cove', color: '#355c76', points: [[112,548],[176,519],[222,567],[196,631],[133,637]] },
    { id: 'haunted-hallows', color: '#755074', points: [[181,663],[263,623],[334,666],[311,734],[226,750],[161,714]] },
    { id: 'sprite-forest', color: '#ab70aa', points: [[288,444],[359,402],[417,444],[390,510],[320,529],[268,491]] },
    { id: 'dead-church', color: '#62515f', points: [[414,623],[490,591],[548,632],[526,696],[451,711],[405,669]] },
    { id: 'risen-hell', color: '#8c4840', points: [[694,649],[782,605],[850,649],[821,714],[733,721],[680,689]] },
    { id: 'deep-sea-abyss', color: '#2b6ba0', points: [[783,437],[857,420],[910,477],[875,537],[797,521],[752,480]] },
    { id: 'carboniferous', color: '#b77845', points: [[801,709],[879,696],[925,754],[887,811],[811,801],[773,754]] },
    { id: 'sanguine-forest', color: '#8d3f4b', points: [[288,770],[373,745],[431,802],[404,866],[325,870],[269,823]] },
    { id: 'floral-escape', color: '#d8759c', points: [[717,786],[786,756],[853,806],[820,866],[747,875],[697,833]] },
    { id: 'eternal-frost', color: '#a9d0de', points: [[244,300],[299,274],[329,313],[303,349],[252,345]] },
    { id: 'spring-of-meaning', color: '#e5a9bd', points: [[568,813],[627,795],[661,839],[633,887],[580,875],[551,844]] }
  ];
  const beacons = [
    { name: 'Forest', x: 265, y: 444, color: '#88d163' }, { name: 'Plains', x: 572, y: 430, color: '#c7df67' },
    { name: 'Desert', x: 806, y: 423, color: '#ffbd4a' }, { name: 'Undead Forest', x: 268, y: 668, color: '#a875a5' },
    { name: 'Sanguine Forest', x: 346, y: 790, color: '#e94b5f' }, { name: 'Runic Tundra', x: 542, y: 245, color: '#bfeeff' },
    { name: 'Deep Sea Abyss', x: 750, y: 619, color: '#48a6ed' }, { name: 'Carboniferous', x: 826, y: 677, color: '#d69245' },
    { name: 'Floral Escape', x: 871, y: 780, color: '#ff9ace' }
  ];

  const atlasZone = id => (RealmData.zones || []).find(entry => entry.id === id) || { id, monsters: [], elites: [], phaseCreatures: [], encounterScore: 0, encounterChance: 0 };
  const beacon = name => (RealmData.beacons || []).find(entry => entry.name === name);
  const monsterArt = monster => {
    if (monster.catalogArt) {
      if (typeof BUNDLE !== 'undefined' && BUNDLE && BUNDLE.realmCatalogSprites && BUNDLE.realmCatalogSprites[monster.catalogArt]) {
        return { url: BUNDLE.realmCatalogSprites[monster.catalogArt], animated: false };
      }
      return { url: `assets/realm-catalog/${encodeURIComponent(monster.catalogArt)}`, animated: false };
    }
    if (monster.animation) {
      if (typeof BUNDLE !== 'undefined' && BUNDLE && BUNDLE.realmMonsterAnimations && BUNDLE.realmMonsterAnimations[monster.id]) {
        return { url: BUNDLE.realmMonsterAnimations[monster.id], animated: true };
      }
      return { url: `assets/realm-monster-animations/${encodeURIComponent(monster.animation)}`, animated: true };
    }
    if (!monster.art) return null;
    if (typeof BUNDLE !== 'undefined' && BUNDLE && BUNDLE.realmMonsterSprites) return { url: BUNDLE.realmMonsterSprites[monster.id] || '', animated: false };
    return { url: `assets/realm-monsters/${encodeURIComponent(monster.art)}`, animated: false };
  };
  const html = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const num = value => Number(value || 0).toLocaleString('en-US');
  let canvas, ctx, details, reset, active = false, frame = 0, selected = null;
  let view = { x: 550, y: 535, z: 0.86, tx: 550, ty: 535, tz: 0.86 };
  let drag = null, pointer = { x: -1000, y: -1000 }, lastTime = 0;

  function bounds() { return canvas.getBoundingClientRect(); }
  function baseScale() { const box = bounds(); return Math.min(box.width / WORLD.width, box.height / WORLD.height); }
  function point(x, y) {
    const box = bounds(); const scale = baseScale() * view.z;
    return { x: (x - view.x) * scale + box.width / 2, y: (y - view.y) * scale + box.height / 2 };
  }
  function world(x, y) {
    const box = bounds(); const scale = baseScale() * view.z;
    return { x: (x - box.width / 2) / scale + view.x, y: (y - box.height / 2) / scale + view.y };
  }
  function polygon(points, fill, stroke, width) {
    const first = point(...points[0]); ctx.beginPath(); ctx.moveTo(first.x, first.y);
    for (const item of points.slice(1)) { const at = point(...item); ctx.lineTo(at.x, at.y); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1; ctx.stroke(); }
  }
  function inPolygon(target, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > target.y) !== (yj > target.y) && target.x < (xj - xi) * (target.y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function drawWaves(time) {
    const box = bounds(); ctx.fillStyle = '#111f38'; ctx.fillRect(0, 0, box.width, box.height);
    ctx.strokeStyle = 'rgba(112, 193, 232, .17)'; ctx.lineWidth = 1;
    for (let row = -20; row < box.height + 30; row += 26) {
      ctx.beginPath();
      for (let x = -20; x < box.width + 40; x += 18) {
        const y = row + Math.sin((x + time * .032 + row * .7) / 34) * 2.1;
        x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  function drawMountains() {
    polygon(mountains.points, mountains.color, 'rgba(219,231,236,.18)', 1);
    const points = mountains.points;
    for (let index = 1; index < points.length - 1; index += 2) {
      const [x, y] = points[index]; const at = point(x, y);
      const scale = baseScale() * view.z;
      ctx.fillStyle = 'rgba(211, 225, 232, .16)'; ctx.beginPath();
      ctx.moveTo(at.x, at.y - 24 * scale); ctx.lineTo(at.x - 19 * scale, at.y + 13 * scale); ctx.lineTo(at.x + 18 * scale, at.y + 13 * scale); ctx.closePath(); ctx.fill();
    }
  }
  function drawCreatures(time) {
    if (view.z < 1.15) return;
    for (const zone of zones) {
      const data = atlasZone(zone.id); if (!data.monsters.length) continue;
      const [anchorX, anchorY] = zone.points[Math.floor(zone.points.length / 2)];
      for (let index = 0; index < Math.min(5, data.monsters.length); index++) {
        const phase = index * 17 + zone.id.length * 13;
        const x = anchorX + Math.sin(time / 850 + phase) * (28 + index * 8);
        const y = anchorY + Math.cos(time / 930 + phase) * (16 + index * 7);
        const at = point(x, y); const size = Math.max(2, 3.5 * baseScale() * view.z);
        ctx.fillStyle = index === 0 ? '#f8e7bd' : 'rgba(20, 18, 28, .88)';
        ctx.fillRect(Math.round(at.x - size), Math.round(at.y - size), Math.ceil(size * 2), Math.ceil(size * 2));
      }
    }
  }
  function drawMarker(marker, kind, time) {
    const at = point(marker.x, marker.y); const scale = baseScale() * view.z;
    const selectedMarker = selected && selected.kind === kind && selected.name === marker.name;
    const hover = Math.hypot(pointer.x - at.x, pointer.y - at.y) < 13 * scale;
    const radius = (selectedMarker ? 11 : hover ? 9 : 7) * scale;
    ctx.save(); ctx.translate(at.x, at.y);
    if (kind === 'beacon') {
      const pulse = 1 + Math.sin(time / 350 + marker.x) * .15;
      ctx.strokeStyle = marker.color; ctx.globalAlpha = .28; ctx.lineWidth = 2 * scale; ctx.beginPath(); ctx.arc(0, 0, radius * 1.8 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = marker.color; ctx.beginPath(); ctx.moveTo(0, -radius * 1.5); ctx.lineTo(radius, radius); ctx.lineTo(0, radius * .5); ctx.lineTo(-radius, radius); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = marker.color; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#14121e'; ctx.beginPath(); ctx.arc(0, 0, radius * .42, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function drawLabel(zone) {
    if (view.z > 1.75 && (!selected || zone.id !== selected.id)) return;
    const data = atlasZone(zone.id);
    const center = zone.points.reduce((sum, item) => [sum[0] + item[0] / zone.points.length, sum[1] + item[1] / zone.points.length], [0, 0]);
    const at = point(...center); const scale = Math.max(.7, Math.min(1.1, baseScale() * view.z * 1.25));
    ctx.font = `${Math.round(12 * scale)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(245, 239, 219, .82)';
    ctx.fillText(data.name || zone.id, at.x, at.y);
  }
  function render(time) {
    if (!active) return;
    const delta = Math.min(1, (time - lastTime) / 80 || 1); lastTime = time;
    for (const key of ['x', 'y', 'z']) view[key] += (view[`t${key}`] - view[key]) * Math.min(.22, delta * .18);
    drawWaves(time);
    polygon(land.points, '#536747', 'rgba(223,236,225,.28)', 2);
    for (const zone of zones) {
      const isSelected = selected && selected.kind === 'zone' && selected.id === zone.id;
      polygon(zone.points, zone.color, isSelected ? '#fff2c6' : 'rgba(8, 13, 20, .4)', isSelected ? 2 : 1);
    }
    drawMountains(); drawCreatures(time);
    for (const zone of zones) drawLabel(zone);
    for (const item of beacons) drawMarker(item, 'beacon', time);
    frame = requestAnimationFrame(render);
  }
  function focus(item) {
    selected = item; const anchor = item.x ? item : (() => {
      const zone = item; return zone.points.reduce((sum, point) => ({ x: sum.x + point[0] / zone.points.length, y: sum.y + point[1] / zone.points.length }), { x: 0, y: 0 });
    })();
    view.tx = anchor.x; view.ty = anchor.y; view.tz = 1.75;
    renderDetails();
  }
  function monsterRow(monster) {
    const stats = [monster.hp && `${num(monster.hp)} HP`, monster.defense && `${num(monster.defense)} DEF`, monster.exp && `${num(monster.exp)} XP`].filter(Boolean).join(' · ');
    const effects = monster.effects && monster.effects.length ? `<small class="realm-threat">Applies: ${html(monster.effects.join(', '))}</small>` : '';
    const reference = monster.reference;
    const referenceFacts = reference && reference.detail ? [
      reference.detail.drops && reference.detail.drops.length > 0 && `${reference.detail.drops.length} recorded drops`,
      reference.detail.reproduction && reference.detail.reproduction.length > 0 && `spawns ${reference.detail.reproduction.length} creature${reference.detail.reproduction.length === 1 ? '' : 's'}`
    ].filter(Boolean).join(' · ') : '';
    const source = referenceFacts ? `<small class="realm-wiki">${html(referenceFacts)}</small>` : '';
    const art = monsterArt(monster);
    return `<li class="realm-monster">${art && art.url ? `<img class="realm-monster-art${art.animated ? ' is-animated' : ''}" src="${art.url}" alt="" loading="lazy" decoding="async" title="${art.animated ? 'Animated client sprite' : 'Monster sprite'}" onerror="this.remove()">` : ''}<span><b>${html(monster.name)}</b>${stats || monster.spawn ? `<small>${stats || 'Client stat block unavailable'}${monster.spawn ? ` · ${Math.round(monster.spawn * 100)}% spawn weight` : ''}</small>` : ''}${source}${effects}</span></li>`;
  }
  function renderDetails() {
    if (!selected) {
      details.innerHTML = '<div class="realm-kicker">Realm data atlas</div><h2>Explore a region</h2><p>Select a biome, beacon guardian or special encounter to inspect the linked client data. The Nexus is intentionally outside this realm map.</p><p class="source-note">The visual topology is illustrative; terrain, creatures, encounter values and beacon data are generated from the installed game client.</p>';
      return;
    }
    if (selected.kind === 'beacon') {
      const boss = beacon(selected.name);
      details.innerHTML = `<div class="realm-kicker">Beacon guardian</div><h2>${html(selected.name)}</h2><p>One of the realm's capturable beacon families. The atlas shows a representative position: its actual placement changes with the generated realm.</p><div class="realm-stat"><b>${boss && boss.hp ? num(boss.hp) : '—'}</b><span>guardian HP</span></div><p class="source-note">Name and guardian health are read from the installed client.</p>`;
      return;
    }
    const data = atlasZone(selected.id);
    const isEncounter = data.kind === 'encounter';
    const title = data.name || selected.name;
    const chance = data.encounterChance ? `${Math.round(data.encounterChance * 100)}% encounter chance · score ${num(data.encounterScore)}` : '';
    const threats = [...new Set(data.monsters.flatMap(monster => monster.effects || []))];
    const intro = isEncounter ? 'A dedicated encounter biome. Its terrain roster and encounter values come directly from the client.'
      : `${data.difficulty || 'Realm biome'}. This region is a topological placement; its roster comes from the client terrain definition.`;
    const leaders = data.elites || [];
    const groupTitle = { regular: 'Regular enemies', heroes: 'Heroes of Oryx', encounters: 'Encounters', beaconGuardians: 'Beacon guardian' };
    const categorized = Object.entries(data.wikiGroups || {}).filter(([, entries]) => entries.length);
    const categorySections = categorized.map(([key, entries]) => `<h3>${groupTitle[key] || key} <span>${entries.length}</span></h3><ul class="realm-monsters">${entries.map(monsterRow).join('')}</ul>`).join('');
    const leaderSection = leaders.length ? `<h3>Zone leaders <span>${leaders.length}</span></h3><ul class="realm-monsters">${leaders.slice(0, 4).map(monsterRow).join('')}</ul>` : '';
    const sourceNote = data.reference ? `<p class="source-note">${html(data.reference.rank)} classification, enemy roles and imported drops are stored locally. Client data remains the source for client stats and sprites.</p>` : '';
    const clientRoster = !categorySections ? `<h3>Native creatures <span>${data.monsters.length}</span></h3><ul class="realm-monsters">${data.monsters.slice(0, 8).map(monsterRow).join('') || '<li><small>No native creature was found in the current client data.</small></li>'}</ul>` : '';
    details.innerHTML = `<div class="realm-kicker">${html(data.reference ? `${data.reference.rank} biome` : isEncounter ? `${data.difficulty} encounter biome` : data.difficulty || 'Realm biome')}</div><h2>${html(title)}</h2><p>${html(intro)}</p>${chance ? `<p class="realm-chance">${html(chance)}</p>` : ''}${threats.length ? `<p class="realm-threats">Known status effects: ${html(threats.join(', '))}</p>` : ''}${categorySections || leaderSection}${clientRoster}${sourceNote}<p class="source-note">${data.phaseCreatures.length ? `${data.phaseCreatures.length} zero-probability phase/summoned candidate${data.phaseCreatures.length > 1 ? 's are' : ' is'} retained separately in client data. ` : ''}${data.spawners.length ? `${data.spawners.length} terrain-linked event/spawn nodes are retained for the next iteration. ` : ''}</p>`;
  }
  function nearestMarker(at) {
    for (const item of beacons.map(entry => ({ ...entry, kind: 'beacon' }))) {
      if (Math.hypot(item.x - at.x, item.y - at.y) < 20 / (baseScale() * view.z)) return item;
    }
    return null;
  }
  function onPointerDown(event) { canvas.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY, vx: view.tx, vy: view.ty, moved: false }; }
  function onPointerMove(event) {
    const box = bounds(); pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (!drag) return; const scale = baseScale() * view.z; const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.moved = drag.moved || Math.hypot(dx, dy) > 5; view.tx = drag.vx - dx / scale; view.ty = drag.vy - dy / scale;
  }
  function onPointerUp(event) {
    if (!drag || drag.moved) { drag = null; return; }
    const at = world(event.clientX - bounds().left, event.clientY - bounds().top); drag = null;
    const marker = nearestMarker(at); if (marker) { focus(marker); return; }
    const zone = zones.slice().reverse().find(entry => inPolygon(at, entry.points)); if (zone) focus({ ...zone, kind: 'zone' });
  }
  function onWheel(event) {
    event.preventDefault(); const at = world(event.offsetX, event.offsetY); const next = Math.max(.7, Math.min(3.2, view.tz * (event.deltaY > 0 ? .88 : 1.14)));
    const ratio = next / view.tz; view.tx = at.x - (at.x - view.tx) / ratio; view.ty = at.y - (at.y - view.ty) / ratio; view.tz = next;
  }
  function resize() { const box = bounds(); const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function init() {
    canvas = document.getElementById('realmCanvas'); details = document.getElementById('realmDetails'); reset = document.getElementById('realmReset'); if (!canvas || !details || !window.RealmData) return;
    ctx = canvas.getContext('2d'); resize(); new ResizeObserver(resize).observe(canvas);
    canvas.addEventListener('pointerdown', onPointerDown); canvas.addEventListener('pointermove', onPointerMove); canvas.addEventListener('pointerup', onPointerUp); canvas.addEventListener('pointerleave', () => { pointer = { x: -1000, y: -1000 }; }); canvas.addEventListener('wheel', onWheel, { passive: false });
    reset.addEventListener('click', () => { selected = null; view.tx = 550; view.ty = 535; view.tz = .86; renderDetails(); }); renderDetails();
  }
  function setVisible(value) { active = value; if (active && !frame) { lastTime = 0; frame = requestAnimationFrame(render); } if (!active && frame) { cancelAnimationFrame(frame); frame = 0; } }
  return { init, setVisible };
})();

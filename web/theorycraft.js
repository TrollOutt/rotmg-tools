/*
 * Theory crafting: what a character would actually be, and what it would do.
 *
 * The whole page is arithmetic on numbers the game chose. A class states its
 * eight statistics - the value it starts on, the value it may never pass, and
 * what one level is worth of each - so a level twenty is not a guess. Every
 * weapon, ability, armour and ring states what it gives you for being worn
 * and the projectile it throws. Every one of the thousand enchantments states
 * its effect as a mutator rather than as prose. All of that is read out of the
 * index by tools/build-theorycraft.js and used here untouched.
 *
 * Four things are NOT in the client, and they are the four formulas that turn
 * a statistic into a rate. They are the ones the game's own players worked out
 * long ago and agree on, and they are written out at the top where they can be
 * argued with rather than buried:
 *
 *     shots a second   1.5 + 6.5 x DEX/75, times the weapon's own rate
 *     tiles a second   4 + 5.6 x SPD/75
 *     life a second    2 + 0.2407 x VIT out of combat, half of it in combat
 *     magic a second   0.5 + 0.12 x WIS out of combat, 0.5 + 0.06 x WIS in combat
 *
 * Life and magic follow Vital Combat (Exalt 1.1): once a hit above the combat
 * trigger lands, what VIT and WIS bring is at half effectiveness until a few
 * seconds pass without one (7 - 0.04 x VIT, never under 1). The figures are
 * RealmEye's, checked against its worked examples - 153 VIT is 19.41 HP/s and
 * 135 WIS is 8.6 MP/s in combat - and a fight is in combat, so the fight uses
 * those. The enchantments that add regeneration say "doubled while out of
 * combat": their figure is the combat one.
 *
 * And the damage formula, which is the one thing everything here turns on:
 * a shot rolls between its low and high, is raised by the attacker's attack,
 * and is then reduced by the target's armour - but armour may never take more
 * than most of it, so a well armoured thing is hard to kill and not immune.
 *
 *     dealt = roll x (0.5 + ATT/50)
 *     landed = max(dealt x 0.15, dealt - DEF)     unless the shot pierces
 *
 * Exaltations are the game's own rule: five of each statistic, one point each.
 */
var TheoryCraft = (function () {
  'use strict';

  const { SHOTS_AT, landed, reaches, fanHits } = TheoryEngine;

  function weaponRate(item, stats, def, scale, extra, fx, gap) {
    return TheoryEngine.weaponRate(item, stats, def, scale, extra, fx, gap,
      !!(gearOf(item && item.name) || {}).curves);
  }
  // The game lets an ability go off once a second at the most.
  const CAST_LEAST = 1;
  const PACE_AT = spd => 4 + 5.6 * (spd / 75);
  // Out of combat. In combat the statistic's part is halved: the whole of it for life, the part WIS adds for magic.
  const HEAL_CALM = vit => 2 + 0.2407 * vit;
  const MANA_CALM = wis => 0.5 + 0.12 * wis;
  const HEAL_AT = vit => HEAL_CALM(vit) / 2;
  const MANA_AT = wis => 0.5 + 0.06 * wis;
  // The Healing status, when the reader says a party member keeps it up.
  const HEALING_A_SECOND = 20;
  // How long a character stays in combat after the last hit above the trigger, before VIT shortens it.
  const COMBAT_SECONDS = 7, COMBAT_PER_VIT = 0.04, COMBAT_LEAST = 1;

  const STATS = [
    ['hp', 'Life', 'HP'], ['mp', 'Magic', 'MP'], ['att', 'Attack', 'ATT'],
    ['def', 'Defence', 'DEF'], ['spd', 'Speed', 'SPD'], ['dex', 'Dexterity', 'DEX'],
    ['vit', 'Vitality', 'VIT'], ['wis', 'Wisdom', 'WIS']
  ];
  const OF_STAT = {};
  for (const [key, , tag] of STATS) OF_STAT[tag] = key;
  // Sets say MAXHP and MAXMP where an item says HP and MP.
  OF_STAT.MAXHP = 'hp'; OF_STAT.MAXMP = 'mp';
  const HANDS = [['weapon', 'Weapon'], ['ability', 'Ability'],
    ['armor', 'Armour'], ['ring', 'Ring']];
  const statistics = TheoryEngine.createStatistics({ stats: STATS, hands: HANDS, ofStat: OF_STAT });
/*
 * Exaltations. Five of each statistic, and what one is worth depends on the
 * statistic: life and magic go up five at a time, so a fully exalted
 * character carries twenty-five more of each, while the other six go up one
 * at a time for five. Treating all eight alike gave a character twenty
 * points of life it never had.
 *
 * This is the game's own rule and not the client's - the installed files
 * confirm who may exalt and say nothing about what it is worth - so it is
 * written here in the open rather than buried in a table.
 */
const EXALT_EACH = 5;
const EXALT_STEP = { hp: 5, mp: 5 };
const exaltOf = key => EXALT_EACH * (EXALT_STEP[key] || 1);

  let data = null;
  let build = null;
  let tabs = [];
  let onTab = 0;
  let picking = null;                  // which slot a picker is open for
  const PROFILE_STORE = 'rotmg-build-progression-v1';
  let access = null, profile = null, profileDraft = null, profileSaved = true;
  let itemSearchAliases = new Map();

  /*
   * The Index owns item identity. TheoryCraft displays the canonical name,
   * but somebody debugging a new client build may still type the raw client
   * id or alias they saw in the update data.
   */
  function indexItemAliases(index) {
    const out = new Map();
    for (const record of (index && index.records) || []) {
      if (record.kind !== 'item' || !record.name) continue;
      const names = [...new Set([record.alias, record.clientId]
        .filter(name => name && name !== record.name))];
      if (names.length) {
        out.set(record.name, [...new Set([
          ...(out.get(record.name) || []),
          ...names
        ])]);
      }
    }
    return out;
  }

  async function loadAccess() {
    async function read(key, paths, asText = false) {
      const shared = window.ROTMG_SHARED_DATA
        || (window.ROTMG_SHARED_DATA = {});

      if (key === 'indexText' && !asText && shared.index) {
        return shared.index;
      }

      const sources = (window.ROTMG_BUNDLE || {}).sources || {};
      if (sources[key]) {
        const value = asText ? sources[key] : JSON.parse(sources[key]);
        if (key === 'indexText' && !asText) shared.index = value;
        return value;
      }

      for (const path of paths) {
        try {
          const response = await fetch(path);
          if (response.ok) {
            const value = asText
              ? await response.text()
              : await response.json();
            if (key === 'indexText' && !asText) shared.index = value;
            return value;
          }
        } catch (_) { /* Try the local checkout path next. */ }
      }

      throw new Error('Progression data unavailable');
    }
    try {
      const [index, wiki, realm, ratings, community] = await Promise.all([
        read('indexText', ['assets/index/index.json', '../data/Index/index.json']),
        read('wikiText', ['assets/index/wiki.json', '../data/Index/wiki.json']),
        read('realmLootText', ['assets/theory/progression.json', 'realmeye-data.json']),
        read('dungeonText', ['../data/Fame/dungeon-pages.txt'], true),
        // The places the Index adds from the community, so a seasonal biome
        // is a picture and a way into the Index here too. Optional.
        read('realmeyeEnrichmentText', ['assets/index/realmeye-enrichment.json',
          '../data/Index/realmeye-enrichment.json']).catch(() => null)
      ]);
      itemSearchAliases = indexItemAliases(index);
      limitedNames = limitedFrom(community);
      access = BuildProgression.catalogue(index, wiki, data.items, realm, ratings, community);
    } catch (_) {
      itemSearchAliases = new Map();
      access = null;
    }
  }

  const accessible = name => BuildProgression.allows(access, profile, name);
  /*
   * Where an item falls, as the places themselves: each portal or biome as
   * the picture the game gives it, and each one a way to the Index page
   * about it. Personalized, the places you have chosen; best possible,
   * everywhere it falls. A few, then how many more.
   */
  const LOOT_SHOWN = 5;
  function lootRow(name) {
    if (!access || !name) return '';
    const sources = access.sources.get(name);
    if (!sources || !sources.size) {
      return access.starter.has(name) ? '<span class="tc-loot-note">Basic starter gear</span>' : '';
    }
    const personal = profile && profile.mode === 'personal';
    const selectedIds = personal ? new Set(BuildProgression.selectedZoneIds(access, profile)) : null;
    const zones = access.zones.filter(zone => sources.has(zone.id) && (!selectedIds || selectedIds.has(zone.id)));
    if (!zones.length) {
      return personal ? '<span class="tc-loot-note">Outside your selected loot sources</span>' : '';
    }
    const shown = zones.slice(0, LOOT_SHOWN);
    const more = zones.length - shown.length;
    const all = zones.map(zone => zone.name).join(' · ');
    return '<span class="tc-loot" title="Loot: ' + esc(all) + '"><i>Loot</i>'
      + shown.map(zone => {
        // A place with no picture of its own is said by name instead.
        const art = zonePicture(zone, 20) || indexIcon(zone.art, 20, '');
        const kind = art ? 'tc-loot-place' : 'tc-loot-place is-named';
        const inner = art || esc(zone.name);
        return zone.index
          ? '<button type="button" class="' + kind + '" data-index-open="' + esc(zone.index) + '"'
            + ' title="' + esc(zone.name) + ' - open it in the Index">' + inner + '</button>'
          : '<span class="' + kind + '" title="' + esc(zone.name) + '">' + inner + '</span>';
      }).join('')
      + (more > 0 ? '<span class="tc-loot-more">+' + more + '</span>' : '')
      + '</span>';
  }
  function prepareAccessible(state) {
    const out = JSON.parse(JSON.stringify(state));
    if (profile && profile.mode === 'personal') {
      for (const [hand] of HANDS) {
        if (out.locked[hand] || accessible(out.gear[hand].name)) continue;
        if (out.searchOwned && out.owned && out.owned[out.gear[hand].name]) continue;
        const first = itemsFor(hand, out.klass, out)[0];
        // Kept enchantments stay; the search finds them an item that fits.
        const had = out.gear[hand].ench || [];
        out.gear[hand] = { name: first ? first.name : null, slots: 4,
          ench: [0, 1, 2, 3].map(at => (out.locked[hand + ':' + at] && had[at]) || null) };
      }
    }
    return out;
  }

  function editProfile() {
    profileDraft = profile ? JSON.parse(JSON.stringify(profile))
      : { version: 3, mode: 'personal', selection: 'difficulty', difficulty: 1,
        zones: BuildProgression.forDifficulty(access, 1), biomeRanks: ['Rookie'], excluded: [] };
    drawWelcome();
    drawProgress();
    el('tcWelcomeTitle').focus();
  }

  const difficultyIcon = '<svg class="tc-difficulty-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 1h8v1h2v2h1v7h-3v4h-2v-3H9v3H7v-3H6v3H4v-4H1V4h1V2h2z"/><path fill="var(--panel)" d="M3 5h3v3H3zm7 0h3v3h-3zM7 9h2v2H7z"/></svg>';

  function selectedDungeons(draft) {
    const selected = new Set(draft.zones);
    return access ? access.zones.filter(z => z.kind === 'dungeon' && selected.has(z.id))
      .sort((a, b) => (a.difficulty || 99) - (b.difficulty || 99) || a.name.localeCompare(b.name)) : [];
  }

  /*
   * A portal is not a still picture.
   *
   * The client says how each one turns over - an <Animation> on the object
   * with a <Frame time="..."> for every picture in turn - and the index cuts
   * those frames onto its sheet as one strip. Thirty-seven of the dungeons
   * this dialog offers have one.
   *
   * The times are not even: the Snake Pit rests for a second and a fifth and
   * then flickers six times in under two, so a strip played at a constant
   * rate is not the portal. One clock walks the strips on screen and puts
   * each on the frame its own times have reached.
   */
  function indexFilm(zone, side, extra) {
    const sheet = data.iconSheet;
    if (!zone || !zone.film || !zone.filmFor || !sheet) return indexIcon(zone && zone.art, side, extra);
    const [x, y, w, h, count] = zone.film;
    const zoom = side / Math.max(w, h);
    return '<span class="sheet-art is-film' + (extra ? ' ' + extra : '') + '"'
      + ' data-film="' + [x, y, w, count, zoom].join(',') + '"'
      + ' data-film-at="' + zone.filmFor.join(',') + '"'
      + ' style="width:' + (w * zoom) + 'px;height:' + (h * zoom) + 'px'
      + ';background-size:' + (sheet.wide * zoom) + 'px ' + (sheet.tall * zoom) + 'px'
      + ';background-position:' + (-x * zoom) + 'px ' + (-y * zoom) + 'px'
      + '"></span>';
  }

  /*
   * Nothing moves when the machine the reader is on asks for less motion.
   */
  function motionWanted() {
    try {
      if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (error) { /* an old browser answers by not answering */ }
    return true;
  }

  const theoryOpen = () => document.body.dataset.page === 'theory';

  const films = [];
  let filmClock = 0;
  const FILM_FRAME_MIN_MS =
    1000 / 72;

  let filmDrawnAt =
    -1e9;

  function playFilms(now) {
    filmClock = 0;

    if (
      now - filmDrawnAt
      < FILM_FRAME_MIN_MS
    ) {
      if (
        films.length
        && motionWanted()
        && theoryOpen()
      ) {
        filmClock =
          requestAnimationFrame(
            playFilms
          );
      }

      return;
    }

    filmDrawnAt =
      now;

    let anyLeft = false;
    for (const film of films) {
      if (!film.node.isConnected) continue;
      anyLeft = true;
      const at = now % film.whole;
      let frame = 0;
      while (frame < film.ends.length - 1 && at >= film.ends[frame]) frame++;
      if (film.lastFrame !== frame) {
        film.lastFrame = frame;
        film.node.style.backgroundPositionX =
          (-(film.x + frame * film.w) * film.zoom) + 'px';
      }
    }
    if (anyLeft && motionWanted() && theoryOpen()) filmClock = requestAnimationFrame(playFilms);
  }
  function startFilms(within) {
    films.length = 0;
    for (const node of (within || document).querySelectorAll('.is-film[data-film]')) {
      const [x, y, w, count, zoom] = node.dataset.film.split(',').map(Number);
      const times = (node.dataset.filmAt || '').split(',').map(Number).filter(one => one > 0);
      if (!(count > 1) || times.length !== count) continue;
      let whole = 0;
      const ends = times.map(one => (whole += one));
      films.push({
        node,
        x,
        w,
        zoom,
        ends,
        whole,
        lastFrame: -1
      });
    }
    if (filmClock) cancelAnimationFrame(filmClock);
    filmClock = 0;
    if (films.length && motionWanted() && theoryOpen()) filmClock = requestAnimationFrame(playFilms);
  }

  function dungeonCards(dungeons) {
    return dungeons.map(z => '<button type="button" class="tc-dungeon-card" data-remove-zone="' + esc(z.id)
      + '" data-zone-name="' + esc(z.name.toLowerCase()) + '" aria-label="Remove ' + esc(z.name) + ' from selected dungeons">'
      + '<span class="tc-dungeon-remove" aria-hidden="true">×</span><span class="tc-dungeon-art">'
      + indexFilm(z, 48, '') + '</span><span class="tc-dungeon-name">' + esc(z.name)
      + '</span><span class="tc-zone-rating">' + (z.difficulty ? difficultyIcon + ' ' + z.difficulty : 'Unrated') + '</span></button>').join('');
  }

  /*
   * A zone's picture, whichever kind it has.
   *
   * Most biomes carry a rectangle cut from the index's sheet. Two of them -
   * the Ancient City and the Deep Sea Abyss - carry a file instead, imported
   * from RealmEye because the Atlas has no sprite for them, and this asked
   * only for the rectangle. So the Adept rank, whose example is the Ancient
   * City, was the one button in the dialog with an empty square on it.
   */
  function zonePicture(zone, side) {
    if (!zone) return '';
    if (zone.art) return indexIcon(zone.art, side, '');
    if (zone.icon) {
      const kept = window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.cardImages;
      const icon = window.RealmCardExtras ? window.RealmCardExtras.asset(zone.icon)
        : (kept && kept[zone.icon]) || zone.icon;
      return '<img class="tc-zone-file" width="' + side + '" height="' + side
        + '" src="' + esc(icon) + '" alt="">';
    }
    return '';
  }

  const BIOME_RANKS = [
    ['Rookie', 'Beach'], ['Adept', 'Ancient City'], ['Veteran', 'Deep Sea Abyss']
  ];
  function biomeRankCards(draft) {
    const selected = new Set(draft.biomeRanks || ['Rookie']);
    return BIOME_RANKS.map(([rank, example]) => {
      const zone = access && access.zones.find(one => one.kind === 'biome' && one.name === example);
      const active = selected.has(rank);
      return '<button type="button" class="tc-biome-rank" data-biome-rank="' + rank
        + '" aria-pressed="' + active + '">'
        + '<span class="tc-biome-art">' + zonePicture(zone, 44) + '</span>'
        + '<span><strong>' + rank + '</strong><small>' + (active ? (rank === 'Rookie' ? 'Included by default' : 'Included') : 'Click to include')
        + '</small></span></button>';
    }).join('');
  }

  function filterDungeonCards(query) {
    const list = el('tcZones-dungeon');
    const empty = el('tcZoneEmpty-dungeon');
    if (!list || !empty) return;
    const rows = [...list.querySelectorAll('[data-zone-name]')];
    for (const row of rows) row.hidden = !row.dataset.zoneName.includes(query);
    empty.hidden = rows.some(row => !row.hidden);
  }

  function drawDungeonCards() {
    const list = el('tcZones-dungeon');
    if (!list) return;
    const dungeons = selectedDungeons(profileDraft);
    const selected = new Set(dungeons.map(zone => zone.id));
    const cards = new Map([...list.children].map(node => [node.dataset.removeZone, node]));
    let changed = false;
    for (const [id, node] of cards) {
      if (!selected.has(id)) { node.remove(); changed = true; }
    }
    // Card content depends only on the zone, not the selected difficulty.
    // Keep unchanged portals (and their animation nodes) in the document.
    let next = list.firstElementChild;
    for (const zone of dungeons) {
      let node = cards.get(zone.id);
      if (!node) {
        list.insertAdjacentHTML('beforeend', dungeonCards([zone]));
        node = list.lastElementChild;
        changed = true;
      }
      if (node !== next) { list.insertBefore(node, next); changed = true; }
      next = node.nextElementSibling;
    }
    if (changed) {
      filterDungeonCards((el('tcZoneSearch').value || '').trim().toLowerCase());
      startFilms(list);
    }
  }

  function drawWelcome() {
    const draft = profileDraft;
    if (!draft) return;
    const dungeons = selectedDungeons(draft);
    el('tcWelcome').innerHTML = '<div class="tc-welcome-intro"><h2 id="tcWelcomeTitle" tabindex="-1">What’s the highest dungeon difficulty you’ve completed?</h2></div>'
      + '<section class="tc-biome-picker" aria-label="Realm zones"><div class="tc-biome-ranks">'
      + biomeRankCards(draft) + '</div></section>'
      + '<div class="tc-slider-block"><div class="tc-slider-value">' + difficultyIcon + '<output id="tcDifficultyValue" for="tcDifficultySlider">'
        + (draft.difficulty || 1) + '</output><span>/ 10</span></div>'
      + '<div class="tc-slider-range"><input id="tcDifficultySlider" class="tc-difficulty-slider" type="range" min="1" max="10" step="0.5" value="'
        + (draft.difficulty || 1) + '" aria-label="Highest dungeon difficulty"'
      + (!access ? ' disabled' : '') + ' style="--difficulty-progress:' + (((draft.difficulty || 1) - 1) / 9 * 100) + '%">'
      + '<div class="tc-difficulty-ticks" aria-hidden="true">'
        + Array.from({ length: 10 }, (_, i) => '<span style="left:' + (i / 9 * 100) + '%">' + (i + 1) + '</span>').join('') + '</div></div>' + '</div>'
      + (!access ? '<p class="tc-access-note">Dungeon data could not be loaded.</p><button type="button" class="tc-undo" id="tcRetryAccess">Retry loading sources</button>' : '')
      + '<section id="tcZoneEditor" aria-labelledby="tcSelectedDungeons"><div class="tc-zone-heading"><div><h3 id="tcSelectedDungeons">Selected Dungeons</h3>'
      + '<span id="tcZoneCount-dungeon"></span></div><div class="tc-zone-toolbar"><input id="tcZoneSearch" type="search" aria-label="Find a selected dungeon" placeholder="Search selected dungeons…" autocomplete="off">'
      + '<button type="button" class="tc-undo" id="tcRestoreDungeons">Restore level selection</button></div></div>'
      + '<div class="tc-zone-list" id="tcZones-dungeon">'
      + dungeonCards(dungeons)
      + '</div><p class="tc-zone-empty" id="tcZoneEmpty-dungeon"' + (dungeons.length ? ' hidden' : '')
      + '>No selected dungeons match this search.</p></section>'
      + '<div class="tc-welcome-footer"><span id="tcProfilePreview"></span><div>'
      + (profile ? '<button type="button" id="tcProfileCancel" class="tc-undo">Cancel</button>' : '')
      + '<button type="button" id="tcProfileSave" class="tc-run">' + (profile ? 'Save progression' : 'Start crafting') + '</button></div></div>';
    updateProfilePreview();
    startFilms(el('tcWelcome'));
  }

  function updateProfilePreview() {
    const draft = profileDraft;
    const validDifficulty = Number.isFinite(draft.difficulty) && draft.difficulty >= 1
      && draft.difficulty <= 10 && Number.isInteger(draft.difficulty * 2);
    const valid = !!access && draft.zones.length > 0
      && (draft.selection === 'manual' || validDifficulty);
    el('tcProfileSave').disabled = !valid;
    el('tcProfilePreview').textContent = valid
      ? draft.zones.length + (draft.zones.length === 1 ? ' dungeon included' : ' dungeons included')
      : draft.selection === 'manual' ? 'Choose at least one dungeon.' : 'Keep at least one dungeon to continue.';
    const countNode = el('tcZoneCount-dungeon');
    countNode.textContent = draft.zones.length + (draft.zones.length === 1 ? ' dungeon selected' : ' dungeons selected');
    const restore = el('tcRestoreDungeons');
    if (restore) restore.disabled = !draft.excluded || !draft.excluded.length;
  }
  function drawProgress() {
    const editing = !!profileDraft || !profile;
    el('tcWelcome').hidden = !editing;
    if (editing && !el('tcWelcome').open) el('tcWelcome').showModal();
    if (!editing && el('tcWelcome').open) el('tcWelcome').close();
    el('tcProgress').hidden = editing;
    if (editing) el('tcProgressNote').hidden = true;
    el('tcBody').hidden = editing;
    el('tcTabs').hidden = editing;
    el('tcRun').disabled = editing || (profile.mode === 'personal' && !access);
    if (editing) return;
    const personal = profile.mode === 'personal';
    const allowed = data.items.filter(item => accessible(item.name)).length;
    /*
     * Three controls in the page's own header: which of the two pools the
     * search draws from, and the way back into the questions that decide the
     * personal one. What the pool currently holds is read on hover, since it
     * is the answer to a question nobody asks twice. Only a note that asks
     * for something to be done gets a line of its own, under the header.
     */
    const summary = (personal ? (profile.selection === 'difficulty' ? 'Difficulty ≤ ' + profile.difficulty + '/10 · ' : 'Manual selection · ')
      + profile.zones.length + ' dungeons · ' + (profile.biomeRanks || ['Rookie']).join(' + ') + ' zones · '
      : 'All sources · ') + RealmI18n.number(allowed) + ' choices across all classes';
    const meaning = personal
      ? 'Only equipment linked to your places and starter gear. Unconfirmed sources are excluded.'
      : 'Full equipment catalogue. Your selected places are saved for personalized mode.';
    // Edit progression stands on Personalized's side, the mode it sets up.
    el('tcProgress').innerHTML = '<button type="button" class="tc-edit-progress" id="tcEditProfile"'
      + (personal ? ' title="' + esc(summary) + '"'
        : ' disabled title="Best possible uses the whole catalogue; your progression only shapes Personalized"')
      + '><span aria-hidden="true">✎</span> Edit progression</button>'
      + '<span class="tc-access-mode" role="group" aria-label="Calculation mode"'
      + ' title="' + esc(summary + '\n' + meaning) + '">'
      + '<button type="button" data-access-mode="personal" aria-pressed="' + personal + '">Personalized</button>'
      + '<button type="button" data-access-mode="best" aria-pressed="' + !personal + '">Best possible</button></span>';
    const notes = [
      !access && personal ? 'Loot sources are unavailable. Edit progression to retry.' : '',
      !profileSaved ? 'Browser storage is unavailable. This profile lasts for this visit only.' : ''
    ].filter(Boolean);
    el('tcProgressNote').innerHTML = notes.map(note => '<span>' + note + '</span>').join('');
    el('tcProgressNote').hidden = !notes.length;
  }

  function saveProfile(value) {
    profile = value;
    profileSaved = true;
    try { localStorage.setItem(PROFILE_STORE, JSON.stringify(profile)); }
    catch (_) { profileSaved = false; }
    before = null;
    el('tcSaid').textContent = '';
    beatenSearch.invalidate();
  }

  function wireProgress() {
    el('tcWelcome').addEventListener('cancel', event => {
      event.preventDefault();
      if (profile) { profileDraft = null; drawProgress(); el('tcEditProfile').focus(); }
    });
    el('tcWelcome').addEventListener('close', () => {
      // Native dialogs may still close on Escape in some embedded browsers.
      // First-time setup remains required; editing an existing profile may close.
      if (!profile && profileDraft && !el('tcWelcome').open) el('tcWelcome').showModal();
    });
    el('tcWelcome').addEventListener('click', async event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.biomeRank) {
        const rank = target.dataset.biomeRank;
        const selected = new Set(profileDraft.biomeRanks || ['Rookie']);
        if (selected.has(rank)) selected.delete(rank); else selected.add(rank);
        profileDraft.biomeRanks = BIOME_RANKS.map(([name]) => name)
          .filter(name => selected.has(name));
        profileDraft.mode = 'personal';
        target.setAttribute('aria-pressed', String(profileDraft.biomeRanks.includes(rank)));
        target.querySelector('small').textContent = profileDraft.biomeRanks.includes(rank) ? 'Included' : 'Click to include';
        updateProfilePreview();
      } else if (target.dataset.removeZone) {
        const id = target.dataset.removeZone;
        profileDraft.mode = 'personal';
        if (profileDraft.selection === 'difficulty') {
          profileDraft.excluded = [...new Set([...(profileDraft.excluded || []), id])];
        }
        profileDraft.zones = profileDraft.zones.filter(zone => zone !== id);
        const cards = [...el('tcZones-dungeon').querySelectorAll('[data-remove-zone]')];
        const next = cards[cards.indexOf(target) + 1] || cards[cards.indexOf(target) - 1];
        target.remove();
        updateProfilePreview();
        if (!profileDraft.zones.length) el('tcZoneEmpty-dungeon').hidden = false;
        if (next) next.focus(); else el('tcRestoreDungeons').focus();
      } else if (target.id === 'tcRestoreDungeons') {
        profileDraft.selection = 'difficulty';
        profileDraft.excluded = [];
        profileDraft.zones = BuildProgression.forDifficulty(access, profileDraft.difficulty);
        drawWelcome(); el('tcRestoreDungeons').focus();
      } else if (target.id === 'tcProfileSave') {
        const valid = BuildProgression.normalize(profileDraft, access);
        if (!valid || (valid.mode === 'personal' && !access)) return;
        saveProfile(valid); profileDraft = null; paint(); el('tcEditProfile').focus();
      } else if (target.id === 'tcProfileCancel') {
        profileDraft = null; drawProgress(); el('tcEditProfile').focus();
      } else if (target.id === 'tcRetryAccess') {
        target.disabled = true; target.textContent = 'Loading…';
        await loadAccess();
        if (profileDraft.selection === 'difficulty') {
          profileDraft.excluded = [];
          profileDraft.zones = BuildProgression.forDifficulty(access, profileDraft.difficulty);
        }
        drawWelcome();
      }
    });
    el('tcWelcome').addEventListener('input', event => {
      if (event.target.id === 'tcDifficultySlider') {
        profileDraft.difficulty = Number(event.target.value);
        profileDraft.selection = 'difficulty';
        profileDraft.mode = 'personal';
        profileDraft.excluded = [];
        profileDraft.zones = BuildProgression.forDifficulty(access, profileDraft.difficulty);
        event.target.style.setProperty('--difficulty-progress', ((profileDraft.difficulty - 1) / 9 * 100) + '%');
        el('tcDifficultyValue').value = String(profileDraft.difficulty);
        drawDungeonCards();
        updateProfilePreview();
        return;
      }
      if (event.target.id !== 'tcZoneSearch') return;
      filterDungeonCards(event.target.value.trim().toLowerCase());
    });
    el('tcProgress').addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.id === 'tcEditProfile') { editProfile(); return; }
      const mode = target.dataset.accessMode;
      if (!mode || profile.mode === mode) return;
      if (mode === 'personal' && (!profile.zones.length || !access)) {
        editProfile(); profileDraft.mode = 'personal'; drawWelcome(); el('tcWelcomeTitle').focus(); return;
      }
      saveProfile({ ...profile, mode }); paint();
      el('tcProgress').querySelector('[data-access-mode="' + mode + '"]').focus();
    });
  }

  /* ---------------- the numbers ---------------- */

  /*
   * A character's statistics: where the class starts, plus what the levels
   * add, held under the class's own ceiling - then everything worn, then the
   * exaltations. Gear and exalts go on top of the ceiling, which is how the
   * game does it: the cap is on what levelling and potions can reach.
   */
  /*
   * Which sets are being worn, and what each is paying.
   *
   * The client gives a set its pieces and a bonus at two of them, three and
   * four, and the thresholds stack the way the game stacks them: wearing all
   * four pays the two-piece bonus as well. It is worked out from the whole
   * outfit rather than from any one piece, which is exactly why it is the one
   * thing a search that changes one item at a time can never find.
   */
  const setCalculations = TheoryEngine.createSets({ hands: HANDS, ofStat: OF_STAT }, () => data.sets);

  function setsOn(state) {
    return setCalculations.setsOn(state.gear);
  }

  function statsOf(state) {
    // An unknown class must not initialise the set indexes.
    if (!data.byClass[state.klass]) return null;
    return statistics.statsOf(state, data, setsOn(state));
  }

  /*
   * What the worn enchantments multiply.
   *
   * Some of them do not add a statistic at all: they scale the weapon. Two
   * per cent of damage, five per cent off the rate of fire, a longer-lived
   * shot. They compound, the way the game compounds them, and they are as
   * much a part of what a build does as an attack bonus is.
   */
  function scaleOf(state) {
    return statistics.scaleOf(state, data.byEnch);
  }

  /* ---------------- status effects ---------------- */
  /*
   * What a status does to the arithmetic, read from the catalogue
   * (data/Items/status-effects.txt through tools/build-status-effects.js)
   * rather than written here: Damaging multiplies the shot before armour,
   * Armor Broken takes the target's positive defence away, Exposed then
   * takes twenty more and may go below nought - so even a shot that ignores
   * armour does twenty more - and Curse multiplies what lands, after armour.
   * Berserk speeds the weapon up; Bleeding takes life a second outside all of
   * that.
   *
   * Each effect is on for a share of the fight, its uptime: a weapon that
   * inflicts it on every hit keeps it up whenever it fires faster than it
   * wears off; an ability keeps it up for its duration out of every cast; a
   * party member's is up all the time, when the reader says there is one. The
   * damage of a shot is the exact expectation over which of them are on.
   */
  let statusInfo = null;
  const DPS_EFFECTS = ['Damaging', 'Berserk', 'Armor Broken', 'Exposed', 'Curse', 'Bleeding'];
  async function loadStatusInfo() {
    const bundle = window.ROTMG_BUNDLE;
    let raw = bundle && bundle.sources && bundle.sources.statusText;
    if (!raw) raw = await fetch('assets/index/status-effects.json').then(r => (r.ok ? r.text() : '')).catch(() => '');
    if (!raw) return null;
    try {
      const said = JSON.parse(raw);
      const byName = new Map();
      const immune = new Map();
      for (const e of said.effects || []) {
        byName.set(e.name, e);
        for (const id of e.immune || []) {
          const name = id.replace(/^enemy:/, '');
          (immune.get(name) || immune.set(name, new Set()).get(name)).add(e.name);
        }
      }
      return { byName, immune, sheet: said.sheet };
    } catch (err) { return null; }
  }
  // A number off the catalogue: Curse's "taken x1.25" is { what: 'taken', op: 'x', value: 1.25 }.
  function modelOf(name, what) {
    const e = statusInfo && statusInfo.byName.get(name);
    return e && (e.model || []).find(m => m.what === what);
  }
  /*
   * How long a status lasts for this build. Several grow with a stat: the
   * tiered orbs' Curse lasts a second more for every twenty WIS over fifty
   * (wisPerDuration), traps and auras add a fraction of a second a point of
   * their scaling stat over a floor (statModDuration and its kin).
   */
  function durationOf(c, stats) {
    let d = Number(c.duration || 0);
    const stat = key => stats[String(key || '').toLowerCase()] || 0;
    if (Number(c.wisPerDuration) > 0) d += Math.max(0, stat('WIS') - Number(c.wisMin || 50)) / Number(c.wisPerDuration);
    const per = Number(c.statModDuration || c.statModCondDuration || c.statModTrapCondDuration || 0);
    if (per && c.scalingStat) d += Math.max(0, stat(c.scalingStat) - Number(c.statModScalingMin || 0)) * per;
    return d;
  }
  function bleedOf(c) {
    const said = Number(c.bleedDamage || c.amount);
    if (said > 0) return said;
    const m = modelOf('Bleeding', 'bleed');
    return m ? m.value : 20;
  }
  /*
   * The effects on a build's side of a fight: which are up, how much of the
   * time, and why. `stats` are the build's own, for how fast its weapon fires
   * and how fast its magic comes back.
   */
  function effectsFor(state, stats, mana, cost) {
    if (!statusInfo || !state || !stats) return null;
    const up = {}, from = {};
    const boss = data.byBoss[state.boss];
    const immune = (boss && statusInfo.immune.get(boss.name)) || new Set();
    const take = (name, share, why) => {
      if (!DPS_EFFECTS.includes(name) || !(share > 0)) return;
      const p = Math.min(1, share);
      if ((up[name] || 0) >= p) return;
      up[name] = p; from[name] = why;
    };
    let bleed = 0;
    const weapon = data.byItem[(state.gear.weapon || {}).name];
    const ability = data.byItem[(state.gear.ability || {}).name];
    const fires = weapon ? SHOTS_AT(stats.dex) * (weapon.rate === undefined ? 1 : weapon.rate) : 0;
    for (const c of (weapon && weapon.conditions) || []) {
      if (c.target !== 'enemy' || c.on !== 'hit') continue;
      const share = durationOf(c, stats) * fires;
      if (c.effect === 'Bleeding') bleed = Math.max(bleed, bleedOf(c) * Math.min(1, share));
      else take(c.effect, share, 'weapon');
    }
    if (ability && ability.mp) {
      const every = Math.max(ability.mp * (cost || 1) / (mana || MANA_AT(stats.wis)), ability.cool || 0, CAST_LEAST);
      for (const c of ability.conditions || []) {
        if (c.target === 'player') continue;
        // On you and the party, only what casting it gives - not what a hit on you sets off.
        if ((c.target === 'self' || c.target === 'allies') && c.trigger && c.trigger !== 'Activate') continue;
        const chance = c.proc && Number(c.proc) < 1 ? Number(c.proc) : 1;
        const share = durationOf(c, stats) / every * chance;
        if (c.effect === 'Bleeding') { if (c.target === 'enemy') bleed += bleedOf(c) * Math.min(1, share); }
        else take(c.effect, share, 'ability');
      }
    }
    // Worn gear that gives you Damaging or Berserk when you shoot or cast: on for its duration each time it goes off.
    const wornNames = new Set(HANDS.map(([hand]) => (state.gear[hand] || {}).name).filter(Boolean));
    const everyCast = ability && ability.mp ? Math.max(ability.mp * (cost || 1) / (mana || MANA_AT(stats.wis)), ability.cool || 0, CAST_LEAST) : 0;
    for (const [hand] of HANDS) {
      for (const g of (gearOf((state.gear[hand] || {}).name) || {}).statuses || []) {
        const rate = g.on === 'shoot' ? fires : everyCast ? 1 / everyCast : 0;
        const goes = g.proc > 0 && rate > 0 ? 1 / (g.cooldown + 1 / (g.proc * rate)) : 0;
        take(g.effect, Math.min(1, goes * g.duration) * procOn(g, wornNames, up), 'gear');
      }
    }
    for (const [name, on] of Object.entries(state.assume || {})) if (on) take(name, 1, 'party');
    for (const name of immune) { delete up[name]; if (DPS_EFFECTS.includes(name)) from[name] = 'immune'; }
    if (immune.has('Bleeding')) bleed = 0;
    return { up, from, bleed, immune };
  }
  /*
   * The damage of one shot with the effects that are up, as an expectation
   * over the sixteen ways the four of them can be on or off.
   */
  function shotWith(effects) {
    const p = effects.up;
    const dmg = modelOf('Damaging', 'damage'), cu = modelOf('Curse', 'taken'), ex = modelOf('Exposed', 'def');
    const four = [p['Damaging'] || 0, p['Armor Broken'] || 0, p['Exposed'] || 0, p['Curse'] || 0];
    if (!four.some(Boolean)) return null;
    return (roll, att, def, pierce) => {
      let sum = 0;
      for (let mask = 0; mask < 16; mask++) {
        let w = 1;
        for (let i = 0; i < 4; i++) w *= mask & (1 << i) ? four[i] : 1 - four[i];
        if (!w) continue;
        const dealt = roll * (0.5 + att / 50) * (mask & 1 && dmg ? dmg.value : 1);
        let d = pierce ? 0 : def;
        if (mask & 2) d = Math.min(d, 0);
        if (mask & 4 && ex && ex.op === '+') d += ex.value;
        sum += w * Math.max(dealt * 0.15, dealt - d) * (mask & 8 && cu ? cu.value : 1);
      }
      return sum;
    };
  }
  // What the effects do to a weapon: its shots, and how fast it fires.
  function fxOf(effects) {
    if (!effects) return null;
    const ber = modelOf('Berserk', 'rate');
    return { onShot: shotWith(effects), haste: 1 + (effects.up['Berserk'] || 0) * ((ber ? ber.value : 1) - 1) };
  }

  /*
   * What a weapon does a second.
   *
   * The average roll, raised by attack, reduced by the target's armour, times
   * how many go at once, times how often they go. Armour bites each shot on
   * its own, which is why many small shots suffer more from it than one big
   * one - and is most of what theory crafting is about.
   */
  /*
   * What the enchantments have done to the shot.
   *
   * Twenty-six of them carry a sub-attack - a projectile of their own that
   * either joins what the weapon throws or replaces it. Buzzing Bullets adds
   * a burst of bees to every shot, Venom Coating swaps the shot out. They are
   * the reason anybody puts an awakened enchantment on a weapon, so they are
   * read from the same place everything else is: the object the client points
   * at, with its own damage, its own count and its own burst.
   */
  function subOf(state) {
    return statistics.subOf(state, data.byEnch);
  }

  /*
   * Where the fighter stands.
   *
   * Distance is measured from the target's middle, in half-tile steps from zero to ten.
   * Old builds used melee, mid and long, at 0, 4.5 and 7.5 respectively.
   * A shot lands if it flies far enough to reach the target's edge, which is its
   * size away from its middle (tools/build-gear-effects.js reads the size off the client); one that falls short
   * does nothing. What the shot does on the way is not part of the figure.
   */
  const OLD_DISTANCES = { melee: 0, mid: 4.5, long: 7.5 };
  function normaliseDistance(value) {
    if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(OLD_DISTANCES, value)) return OLD_DISTANCES[value];
    if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) value = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.round(Math.max(0, Math.min(10, value)) * 2) / 2;
  }
  const distanceOf = state => normaliseDistance(state.range);
  const distanceText = distance => RealmI18n.t(distance === 1 ? 'theory.distance.tile' : 'theory.distance.tiles',
    { distance: RealmI18n.number(distance, { maximumFractionDigits: 1 }) });

  function distanceControl() {
    return '<div class="tc-goal-row"><label for="tcDistance">Range</label>'
      + '<div class="tc-distance"><output id="tcDistanceValue" for="tcDistance" aria-live="off">' + esc(distanceText(0)) + '</output>'
      + '<input id="tcDistance" type="range" min="0" max="10" step="0.5" value="0"'
      + ' aria-valuenow="0" aria-valuetext="' + esc(distanceText(0)) + '">'
      + '<div class="tc-distance-labels" aria-hidden="true">' + [0, 5, 10].map(distance =>
        '<span>' + esc(RealmI18n.number(distance)) + '</span>').join('')
      + '</div></div></div>';
  }

  function syncDistance() {
    const distance = distanceOf(build), slider = el('tcDistance');
    slider.value = String(distance);
    slider.setAttribute('aria-valuenow', String(distance));
    slider.setAttribute('aria-valuetext', distanceText(distance));
    slider.style.setProperty('--distance-progress', (distance * 10) + '%');
    el('tcDistanceValue').textContent = distanceText(distance);
  }

  // A native range emits input while dragging. Repeated events inside the same
  // discrete stop must not save, repaint the duel or recompute the build.
  function wireDistance(container, changed) {
    container.addEventListener('input', event => {
      if (event.target.id !== 'tcDistance') return;
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      const distance = normaliseDistance(value);
      if (distance === distanceOf(build)) return;
      build.range = distance;
      changed();
    });
  }
  // Where the fighter stands against the target: how far off its middle, how big it is, and how far a shot must fly to touch its edge.
  function standOf(state) {
    const d = distanceOf(state);
    const boss = data.byBoss[state.boss];
    const size = (boss && gearInfo && gearInfo.targets && gearInfo.targets[boss.name]);
    const radius = Math.max(0.3, size === undefined ? 0.5 : size);
    return { d, radius, gap: Math.max(0, d - radius) };
  }
  /*
   * What an ability does that is not a bolt: a chain of lightning, a trap and its sticky bomb, a grenade of poison,
   * a nova of damage (tools/build-gear-effects.js reads each off the client; RealmEye words them the same way).
   * Worked out against one target, every part once: the first one a chain strikes, the bomb a trap puts on one
   * enemy, a nova's explosions each. Poison and the shockblast ignore defense, as the client says they do.
   */
  const COUNTED = new Set(['lightning', 'shockblast', 'trap', 'bomb', 'impact', 'poison', 'nova', 'blast', 'hex']);
  function abilityHits(item, stats, def, fx, stacks, gap) {
    const one = gearOf(item && item.name), parts = (one && one.ability) || [];
    const list = [];
    let total = 0;
    for (const part of parts) {
      if (!COUNTED.has(part.kind) || part.meter) continue;       // summons and meters are the server's to pace
      // A nova or a blast goes off around the caster: a target farther off than its radius is not touched.
      if ((part.kind === 'nova' || part.kind === 'blast') && !reaches(part.radius, gap)) continue;
      const over = part.per ? Math.max(0, (stats[OF_STAT[part.by]] || 0) - part.from) : 0;
      // A Hex blast is its base and a little for each Hex the shots have piled on the enemy by then (at most a hundred).
      const heaped = part.kind === 'hex' ? Math.min(100, stacks || 0) : 0;
      const piled = heaped * ((part.stack || 0) + (part.stackPer || 0) * over);
      const roll = ((part.low + part.high) / 2 + over * (part.per || 0) + piled) * (1 + heaped * (part.share || 0));
      const dealt = landed(roll, 25, Math.max(0, def - (part.ignores || 0)), part.pierce, fx) * (part.count || 1);
      list.push({ kind: part.kind, each: dealt / (part.count || 1), count: part.count || 1, dealt });
      total += dealt;
    }
    // And the bolts it releases when it goes off, which are its own (Wandering Souls Spell throws six): same arithmetic as its first.
    for (const proc of (one && one.procs) || []) {
      if (proc.on !== 'ability' || proc.kind !== 'bullets' || !reaches(proc.reach, gap)) continue;
      const over = proc.per ? Math.max(0, (stats[OF_STAT[proc.by]] || 0) - proc.from) * proc.per : 0;
      const dealt = landed((proc.low + proc.high) / 2 + over, 25, def, proc.pierce, fx) * proc.shots * (proc.proc || 1);
      list.push({ kind: 'bolts', each: dealt / proc.shots, count: proc.shots, dealt });
      total += dealt;
    }
    return { total, list };
  }
  /*
   * And an ability, which is bounded by magic rather than by dexterity: you
   * may use it as often as the magic comes back, and no oftener.
   */
  /*
   * An ability, which fires nothing like a weapon.
   *
   * It does not declare NumProjectiles; it declares an Activate, and that is
   * where the count lives - a Fire Spray throws sixteen bolts and a Cobra
   * Serpentis Scroll eight. Reading only NumProjectiles counted one, which
   * understated every nova on this page by a factor of its own fan.
   *
   * The same line says how wisdom improves it: above a stated floor, each
   * point adds a fraction of a shot and a fraction of the damage. Both
   * fractions are the client's, and a Cobra Scroll at seventy-one wisdom is
   * eighty damage a bolt better for it.
   *
   * And how often is not a choice: it is what the magic pays for, at the rate
   * wisdom brings the magic back.
   */
  function abilityRate(item, stats, def, fx, mana, cost, struck, gap) {
    // `struck`: shots of the weapon that land in a second; Hex piles up one for each between two casts.
    const mpOf = it => (it && (it.mp || ((gearOf(it.name) || {}).thrown || {}).end)) || 0;
    const wait = mpOf(item) ? Math.max(mpOf(item) * (cost || 1) / (mana || MANA_AT(stats.wis)), item.cool || 0, CAST_LEAST) : 0;
    const hits = abilityHits(item, stats, def, fx, (struck || 0) * wait, gap);
    const bolts = item && item.shots && item.shots.length;
    if (!item || !mpOf(item) || (!bolts && !hits.total)) {
      return { each: 0, every: 0, dps: 0 };
    }
    const shot = bolts ? item.shots[0] : { low: 0, high: 0 };
    const cast = item.cast || {};
    // Over the floor of the stat it grows with: wisdom unless the client names another.
    const over = cast.from === undefined ? 0 : Math.max(0, stats[OF_STAT[cast.stat] || 'wis'] - cast.from);
    const roll = (shot.low + (shot.high === undefined ? shot.low : shot.high)) / 2
      + over * (cast.dmg || 0);
    // "Attack does not affect ability damage" (RealmEye, Character Stats): the attacker's attack multiplies a
    // weapon's shot and nothing else, so an ability's bolt is raised by what its own line says (the stat it
    // scales with, above) and by nothing more. Attack 25 is the multiplier of one.
    const each = bolts && reaches(shot.reach, gap) ? landed(roll, 25, def, shot.pierce, fx) : 0;
    const thrown = Math.max(1, Math.round((cast.shots || item.many || 1) + over * (cast.more || 0)));
    // Of the bolts it throws, the ones that touch the target (a round spray, as the fight draws it, from eight up).
    const many = (gearOf(item.name) || {}).curves ? thrown : fanHits(thrown, item.fan, thrown >= 8, gap);
    /*
     * How often it can really be used, which is two limits and not one.
     *
     * This was the mana alone: how long until you can afford to cast it
     * again. That is a true limit and it is not the only one - the game also
     * makes you wait out the item's own cooldown, and where that is the
     * longer of the two it is the one you feel. Eighty-two items say they
     * have one. An ability that is cheap and slow was counted as firing as
     * fast as the mana came back, which overstated it and everything worked
     * out from it.
     *
     * Whichever wait is longer is the wait. Items whose cooldown the client
     * has not been read for have none here, and those fall back to the mana
     * rule by themselves.
     */
    const afford = mpOf(item) * (cost || 1) / (mana || MANA_AT(stats.wis));
    const every = Math.max(afford, item.cool || 0, CAST_LEAST);
    return { each, many, every, hits, dps: (each * many + hits.total) / every, reach: shot.reach,
      held: item.cool && item.cool > afford ? 'cooldown' : 'mana' };
  }

  /*
   * With one hand or with both.
   *
   * A wizard's staff and his spell are two different weapons and a build can
   * be judged on either - the spell is what kills a boss and the staff is
   * what clears a room - so the bench lets you take one away. Everything on
   * the page reads the same choice: the figures, the curve and the fight all
   * count the same hands, or they would be three answers to three questions
   * nobody asked.
   */
  /*
   * What gear does that is neither a shot nor a statistic
   * (tools/build-gear-effects.js, read off the client).
   *
   * A few pieces cost you while you fight: Valor takes ten attack, Warmonger
   * five dexterity, Dusky Catalyst ten wisdom, once a hit above the combat
   * trigger has landed. A fight is in combat, so the figures of a fight are
   * worked out with them; the page's statistics, which are the character's,
   * are not.
   */
  let gearInfo = null;
  async function loadGearInfo() {
    const bundle = window.ROTMG_BUNDLE;
    let raw = bundle && bundle.sources && bundle.sources.gearText;
    if (!raw) raw = await fetch('assets/index/gear-effects.json').then(r => (r.ok ? r.text() : '')).catch(() => '');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw), info = new Map(Object.entries(parsed.items || {}));
      info.enchants = parsed.enchants || {};
      info.targets = parsed.targets || {};
      return info;
    } catch (err) { return null; }
  }
  const gearOf = name => (gearInfo && name && gearInfo.get(name)) || null;
  const wornEffects = state => HANDS.map(([hand]) => gearOf((state.gear[hand] || {}).name)).filter(Boolean);
  function fightOf(state, stats) {
    const penalty = {};
    for (const one of wornEffects(state)) {
      for (const tag of Object.keys(one.combat || {})) {
        const key = OF_STAT[tag];
        if (key) penalty[key] = (penalty[key] || 0) + one.combat[tag];
      }
    }
    if (!Object.keys(penalty).length) return { ...stats, penalty };
    const now = { ...stats.now };
    for (const key of Object.keys(penalty)) now[key] = Math.max(0, now[key] + penalty[key]);
    return { ...stats, now, penalty };
  }
  // What a worn item does to the magic an ability costs: 0.9 is a tenth off, and they multiply.
  const costOf = state => HANDS.reduce((all, [hand]) => {
    const worn = state.gear[hand] || {};
    let now = all * ((gearOf(worn.name) || {}).cost || 1);
    // And the enchantments that take a share off what an ability costs.
    for (const id of worn.ench || []) now *= (id && gearInfo && gearInfo.enchants && gearInfo.enchants[id] && gearInfo.enchants[id].mp) || 1;
    return now;
  }, 1);
  /*
   * Damage a gear's effects add, a second, as the range the client lets us say.
   *
   * Each states how often it goes off - a chance, and a cooldown that starts
   * when it does - so it goes off once every cooldown plus the wait for the
   * chance to come up. A grenade of poison deals its total over its duration
   * and ignores armour. A burst of bolts is the bolts' damage, raised by the
   * stat it scales with; whether the attacker's attack multiplies it is the
   * server's business and not the client's, so the low end leaves it out and
   * the high end counts it. These are kept apart from the damage a second of
   * the weapon, which is exact, and are not part of what the build is judged on.
   */
  /*
   * How much of the time what a proc needs is there (0 to 1): the other items it must be worn with, the statuses
   * you must have - a fight is always in combat, the rest are what the build and the party keep up - and nothing
   * for a meter or life left, which only the fight knows. A proc that needs a status the build never makes does not count.
   */
  // The statuses the model keeps up on the player; the others it tracks are on the enemy.
  const SELF_BUFFS = ['Damaging', 'Berserk'];
  function procOn(proc, wornNames, up) {
    const needs = proc.needs;
    if (!needs) return 1;
    if (needs.other) return 0;
    if ((needs.wear || []).some(name => !wornNames.has(name))) return 0;
    if (needs.wearAny && !needs.wearAny.some(name => wornNames.has(name))) return 0;
    if ((needs.notWear || []).some(name => wornNames.has(name))) return 0;
    let share = 1;
    for (const status of needs.status || []) if (status !== 'In Combat') share *= SELF_BUFFS.includes(status) ? Math.min(1, (up && up[status]) || 0) : 0;
    return share;
  }
  function specialsOf(state, stats, def, shots, up, casts, gap) {
    const list = [];
    let low = 0, high = 0;
    const by = {};
    const att = stats.att || 0;
    const wornNames = new Set(HANDS.map(([hand]) => (state.gear[hand] || {}).name).filter(Boolean));
    for (const [hand] of HANDS) {
      const name = (state.gear[hand] || {}).name, one = gearOf(name);
      for (const proc of (one && one.procs) || []) {
        // The ability's own bolts, which the ability figure already counts, are not extras.
        if (hand === 'ability' && proc.on === 'ability') continue;
        if (proc.kind === 'bullets' && !reaches(proc.reach, gap)) continue;
        const share = procOn(proc, wornNames, up);
        if (!(share > 0)) continue;
        const rate = proc.on === 'ability' ? casts : shots;
        const wait = proc.proc > 0 && rate > 0 ? 1 / (proc.proc * rate) : Infinity;
        const goes = 1 / (proc.cooldown + wait);
        let each = [0, 0];
        if (proc.kind === 'poison') each = [proc.total, proc.total];
        else {
          const over = proc.per ? Math.max(0, (stats[OF_STAT[proc.by]] || 0) - proc.from) * proc.per : 0;
          const roll = (proc.low + proc.high) / 2 + over;
          each = [landed(roll, 25, def, proc.pierce) * proc.shots, landed(roll, att, def, proc.pierce) * proc.shots];
        }
        if (!(goes > 0) || !isFinite(goes)) continue;
        low += share * goes * each[0]; high += share * goes * each[1];
        const mine = by[hand] || (by[hand] = { low: 0, high: 0 });
        mine.low += share * goes * each[0]; mine.high += share * goes * each[1];
        list.push({ hand, name, shots: proc.shots, reach: proc.reach, art: proc.art, kind: proc.kind, on: proc.on, goes: share * goes, low: share * goes * each[0], high: share * goes * each[1] });
      }
    }
    return { low, high, list, by };
  }

  /*
   * What gear hands out when you shoot or cast: magic or life back (a few points each time it goes off) and
   * statistics raised for a few seconds. Each states a chance and a cooldown, so it goes off once per cooldown plus
   * the wait for the chance to come up, counted over the shots a second or the casts a second. A raised statistic is
   * worked out as its average over time (what it adds times how much of the time it is on), which is what a long
   * fight sees; the burst a moment after a shot is not what a sustained figure is about.
   */
  function temperOf(state, shots, casts, up) {
    const wornNames = new Set(HANDS.map(([hand]) => (state.gear[hand] || {}).name).filter(Boolean));
    const boost = {}, gain = { hp: 0, mp: 0 }, list = [];
    const goesOf = proc => {
      const rate = proc.on === 'shoot' ? shots : proc.on === 'ability' || proc.on === 'use' ? casts : 0;
      const wait = proc.proc > 0 && rate > 0 ? 1 / (proc.proc * rate) : Infinity;
      return 1 / (proc.cooldown + wait);
    };
    for (const [hand] of HANDS) {
      const name = (state.gear[hand] || {}).name, one = gearOf(name);
      if (!one) continue;
      for (const g of one.gains || []) {
        const share = procOn(g, wornNames, up), goes = goesOf(g);
        if (!(share > 0) || !isFinite(goes)) continue;
        gain[g.give] += share * goes * g.amount;
        list.push({ name, give: g.give, goes: share * goes, a_second: share * goes * g.amount });
      }
      for (const b of one.boosts || []) {
        const key = OF_STAT[b.stat], share = procOn(b, wornNames, up), goes = goesOf(b);
        if (!key || !(share > 0) || !isFinite(goes)) continue;
        const on = Math.min(1, goes * (b.duration || 0)) * share;
        boost[key] = (boost[key] || 0) + b.amount * on;
        list.push({ name, stat: b.stat, on, adds: b.amount * on });
      }
    }
    return { boost, gain, list };
  }

  /*
   * Life and magic a second, in combat and out of it.
   *
   * What VIT and WIS bring is the statistic's own (see the formulas at the top).
   * The enchantments that add regeneration are flat - 4 life a second - or a
   * share of the maximum - 0.5% of your life a second - and say "doubled while
   * out of combat", so what the client states is the combat figure and the calm
   * one is twice it. Both kinds are read from the maximum the build really has,
   * enchantments and gear included, and the Healing status adds twenty a second
   * to life in either state when the reader assumes it.
   */
  function regenOf(stats, assume, fought, gain) {
    const now = stats.now, got = (stats.from && stats.from.regen) || {};
    // In combat the character wears its combat penalties (a wisdom ring that costs wisdom in combat).
    const hot = (fought || stats).now;
    const bonus = {
      hp: (got.flatHP || 0) + (got.partHP || 0) * now.hp,
      mp: (got.flatMP || 0) + (got.partMP || 0) * now.mp
    };
    const healing = assume && assume.Healing ? HEALING_A_SECOND : 0;
    const hp = { combat: HEAL_AT(hot.vit) + bonus.hp + healing + ((gain && gain.hp) || 0), calm: HEAL_CALM(now.vit) + 2 * bonus.hp + healing };
    const mp = { combat: MANA_AT(hot.wis) + bonus.mp + ((gain && gain.mp) || 0), calm: MANA_CALM(now.wis) + 2 * bonus.mp };
    // Seconds without a hit above the trigger before the character is out of combat again.
    const inCombat = Math.max(COMBAT_LEAST, COMBAT_SECONDS - COMBAT_PER_VIT * now.vit);
    return { hp, mp, bonus, healing, inCombat };
  }

  const numberCalculations = TheoryEngine.createNumbers({
    getData: () => data,
    statsOf, scaleOf, subOf, weaponRate, abilityRate, effectsFor, fxOf,
    fightOf, costOf, regenOf, wornEffects, temperOf, standOf, specialsOf
  });

  function numbersFor(state, def) {
    return numberCalculations.numbersFor(state, def);
  }

  /* ---------------- the state of a build ---------------- */

  /*
   * What a class walks out of the nexus in.
   *
   * The plainest thing that fits each of its four slots: the tier nought
   * weapon, ability and armour, and the tier nought ring - which the client
   * does not hand out at all, so the ring used to start empty and the page
   * opened with a hole in it. Starting from the bottom is also the only
   * honest place for the search to start from, since anything it finds is
   * then something it found rather than something it was given.
   */
  let plainest = null;
  function bottomOf(slot) {
    if (!plainest) {
      plainest = new Map();
      for (const one of data.items) {
        if (one.tier === undefined) continue;      // untiered: never a default
        const had = plainest.get(one.slot);
        if (!had || one.tier < had.tier) plainest.set(one.slot, one);
      }
    }
    const got = plainest.get(slot);
    return got ? got.name : null;
  }

  function fresh(klass) {
    const kind = data.byClass[klass] || data.classes[0];
    const gear = {};
    HANDS.forEach(([hand], i) => {
      const name = bottomOf((kind.slots || [])[i]) || kind.kit[i];
      gear[hand] = {
        name: (name && data.byItem[name]) ? name : null,
        slots: 4, ench: [null, null, null, null]
      };
    });
    const exalts = {};
    for (const [key] of STATS) exalts[key] = exaltOf(key);
    return {
      name: kind.name + ' build',
      klass: kind.name,
      // Always twenty. Nobody theory crafts a level nine.
      level: 20,
      maxed: true,
      exalt: true,
      exalts,
      gear,
      // More than one thing can be asked for at once, and how hard each is
      // pulled is the reader's to set.
      goals: ['dps'],
      share: {},
      pinned: {},
      // Everything the game has, to the top of it.
      scope: 'all',
      using: 'both',
      // Aimed at whatever is being fought, not at a bare target: a build is
      // read against the thing it is meant to kill.
      against: null,
      // Status effects a party member keeps up, by name, when the reader says so.
      assume: {},
      /*
       * Something worth timing. The list is sorted by hit points and the top
       * of it is a training dummy with ten million of them, which tells you
       * nothing; the first thing the game actually calls a god does.
       */
      /*
       * Something worth timing, and worth looking at. The list is sorted by
       * hit points and the top of it is a training dummy with ten million of
       * them, which tells you nothing; the first god the catalogue has a
       * portrait of both dies in a sensible time and shows its face.
       */
      boss: (data.bosses.find(one => one.pic && one.god && one.hp < 200000)
        || data.bosses.find(one => one.pic)
        || data.bosses[data.bosses.length - 1] || {}).name || null,
      locked: {}
    };
  }

  /* ---------------- which enchantments may go where ---------------- */

  const labelsOf = one => new Set(String(one || '').split(',').map(s => s.trim())
    .filter(Boolean));

  /*
   * Which enchantments may go on a thing, decided by the calculator that was
   * already written to decide it.
   *
   * This page had its own reading of the rules and it was a worse one. The
   * enchant calculator has carried the real ones for months: which pool an
   * item's kind draws from, that an awakened enchantment only goes on the one
   * item it belongs to, that a second enchantment sharing a label with one
   * already on the item cannot be rolled beside it - the whole reason you
   * cannot stack four attack bonuses. Its eligiblePool answers exactly that
   * question, so it is asked rather than second-guessed.
   */
  let rules = null;
  const OF_HAND = { weapon: 'WEAPON', ability: 'ABILITY', armor: 'ARMOR', ring: 'RING' };

  function rulesFor() {
    if (rules !== null) return rules;
    rules = false;
    try {
      const bundle = window.ROTMG_BUNDLE;
      if (typeof EnchantEngine === 'undefined' || !bundle || !bundle.sources) return rules;
      rules = EnchantEngine.buildDataset(bundle.sources);
      if (typeof EnchantItems !== 'undefined' && bundle.sources.clientItemText) {
        EnchantItems.loadClient(bundle.sources.clientItemText);
      }
    } catch (e) { rules = false; }
    return rules;
  }

  async function loadRules() {
    if (rulesFor()) return rules;

    try {
      if (typeof EnchantEngine === 'undefined') return false;

      const read = async path => {
        const response = await fetch(encodeURI(path));
        if (!response.ok) throw new Error(path + ' HTTP ' + response.status);
        return response.text();
      };

      const [
        clientModText,
        clientItemText,
        clientArtifactText,
        awakenText
      ] = await Promise.all([
        read('../data/Enchantment documents/client-enchantments.txt'),
        read('../data/Items/client-items.txt'),
        read('../data/Artifacts/client-artifacts.txt'),
        read('../data/Awakened Items/awakenedItems.txt')
      ]);

      const sources = {
        clientModText,
        clientItemText,
        clientArtifactText,
        awakenText
      };

      rules = EnchantEngine.buildDataset(sources);

      if (typeof EnchantItems !== 'undefined') {
        EnchantItems.loadClient(clientItemText);
      }

      return rules;
    } catch (error) {
      console.error('TheoryCraft rules load failed:', error);
      rules = false;
      return false;
    }
  }

  /*
   * The client's own record for a name the calculator uses.
   *
   * They do not spell them the same way. The calculator knows "Attack
   * -Defense Tradeoff", which is the thing you ask for; the client files four
   * of them, "Attack -Defense Tradeoff I" through "IV", which are what it
   * rolls. Matching on the exact string found nothing for most of the list,
   * so the numeral is dropped from both ends and the strongest of the four is
   * the one shown - which is the one anybody planning a build means.
   */
  const NUMERAL = /\s+(?:[IVX]+|\d+)$/;
  const plainly = name => String(name).replace(NUMERAL, '').trim().toLowerCase();

  /*
   * One slot, as the enchant calculator is handed it: the item, and the
   * enchantments on that item alone, in the calculator's own spelling.
   * Nothing when the slot is empty. What the calculator does not know is
   * dropped rather than guessed - an enchantment it cannot name is one it
   * cannot price.
   */
  function handoverFor(hand) {
    const worn = build && build.gear && build.gear[hand];
    if (!worn || !worn.name) return null;
    const held = rulesFor();
    const wanted = [];
    for (const id of worn.ench || []) {
      const one = id && data.byEnch[id];
      if (!one) continue;
      // The calculator knows them by its own spelling; this is the same
      // translation the search uses when it reads what is already on an item.
      const bare = plainly(one.name);
      let name = null;
      for (const key of [one.name, one.name.replace(NUMERAL, '').trim()]) {
        if (held && held.byName && held.byName.get(key)) { name = key; break; }
      }
      if (!name && held) {
        for (const [other] of held.byName) {
          if (plainly(other) === bare) { name = other; break; }
        }
      }
      /* Without the rules, or with no match, the client's name goes as it is: the calculator recognises it. */
      wanted.push(name || one.name);
    }
    return { item: worn.name, slots: wanted };
  }
  /* The whole build, slot by slot in the order the page shows them. */
  function buildHandover() {
    return HANDS.map(([hand]) => handoverFor(hand)).filter(Boolean);
  }

  /*
   * Boundary aliases between raw client names carried by TheoryCraft and
   * the canonical names exposed by the shared EnchantEngine.
   *
   * Do not put these corrections into plainly(): plainly() is also used for
   * identity/parity checks where preserving the source spelling matters.
   */
  const ENCHANT_NAME_ALIASES = new Map([
    ['mana -attacktradeoff', 'mana -attack tradeoff'],
    ['pirates expertise', "pirate's expertise"],
    ['vampric lifeforce', 'vampiric lifeforce']
  ]);

  const enchantKey = name => {
    const bare = plainly(name);
    return ENCHANT_NAME_ALIASES.get(bare) || bare;
  };
  /*
   * How much of an enchantment there is, for choosing between four of the
   * same thing. The client rolls Flat Life Regeneration I through IV under
   * one name to a player, and the strongest is the one anybody planning a
   * build means - so what it heals and what it keeps off you count towards
   * that as much as a statistic does, which they did not, which is why the
   * page kept offering the weakest of every family that raises nothing.
   */
  const worth = one => {
    if (!one) return 0;
    let n = Object.values(one.worn || {}).reduce((sum, v) => sum + Math.abs(v), 0);
    const heal = one.heal;
    if (heal) {
      n += (heal.flatHP || 0) + (heal.partHP || 0) * 400
        + ((heal.flatMP || 0) + (heal.partMP || 0) * 200) * 0.25
        + (heal.soak ? (1 - heal.soak) * 200 : 0);
    }
    if (one.mul) {
      n += Object.values(one.mul).reduce((sum, v) => sum + Math.abs(v - 1) * 100, 0);
    }
    // A share of a bonus is worth what the bonus is; sixteen per cent of a
    // good one beats four flat points, and this only has to rank them.
    for (const part of one.rel || []) n += Math.abs(part.pct) / 2;
    for (const part of one.sub || []) n += (part.shots[0].high || 0) / 4;
    return n;
  };

  const { charmNamed, locksOn, rollableEnchantsFor, enchantsFor, enchantFitsItem } =
    TheoryEngine.createEnchants({
      getData: () => data, plainly, enchantKey, worth, numeral: NUMERAL,
      getEngine: () => EnchantEngine, rulesFor, ofHand: OF_HAND
    });

  const itemSearch = TheoryEngine.createItemSearch({
    getData: () => data, hands: HANDS, accessible
  });

  function compatibleItemsFor(hand, klass, state = build) {
    return itemSearch.compatibleItemsFor(hand, klass, state);
  }

  function itemsFor(hand, klass, state = build) {
    return itemSearch.itemsFor(hand, klass, state);
  }

  /* ---------------- what the search need not try ---------------- *
   *
   * The search spends its time where the choices are, and the choices are not
   * where they look. Counted on one class: five hundred and forty-two pieces
   * of gear to try against a thousand and sixteen enchantments, which comes
   * out at eight per cent of the work on what you wear and ninety-two on what
   * is rolled onto it.
   *
   * Both lists carry things that cannot win. An enchantment or an item that
   * is worse than another one on every count the page measures, and better on
   * none, will never be chosen however the shares are set - so trying it is
   * work with a known answer.
   *
   * The care is all in "on every count". Two traps, both found by measuring
   * rather than by thinking about it:
   *
   * The tiers of a thing are not a ladder. Attack -Defense Tradeoff IV gives
   * more attack than II and loses more defence for it, which makes it a
   * different bargain and not a better one - of eight hundred and twelve
   * tiered enchantments, four hundred and forty-one are genuinely beaten by
   * their own top tier and a hundred and sixty-eight are trades that have to
   * stay. The same is true of gear: the T2 Spiral Shuriken hits harder than
   * the T10, and the T5 Ice Star carries nine vitality the T10 has not.
   *
   * And anything whose worth is not in its own numbers is left alone
   * entirely. A weak piece can be the second half of a set, a share of
   * another statistic, or an effect the page does not model, and none of
   * those show up in a comparison of what it wears.
   */
  const beatenSearch = TheoryEngine.createBeaten(() => data);
  const beatenOnes = beatenSearch.beatenOnes;

  /*
   * The same two lists, for the search only.
   *
   * The reader's own picker goes on offering everything: a thing that cannot
   * win a search is still a thing somebody may want to put on and look at,
   * and hiding it would be answering a question nobody asked.
   */
  /*
   * Which broad gear families the optimiser may consider.
   *
   * Missing flags mean true so old saved builds and old shared links keep
   * exactly the catalogue they had before these controls existed.
   *
   * A set piece belongs to the Sets switch even when it has no tier. That
   * keeps Sets and Untiered independent: turning UTs off does not silently
   * turn set pieces off as well.
   *
   * Limited cuts across both. The client does not say which gear was sold or
   * given for a while and then withdrawn; RealmEye does, writing its tier as
   * "UT (Limited)", "ST (Limited)" or "AT (Limited)". Its pages are already
   * read for the progression, and the names are taken from there.
   */
  let limitedNames = new Set();
  function limitedFrom(community) {
    const records = community && community.records;
    const list = Array.isArray(records) ? records : Object.values(records || {});
    const out = new Set();
    for (const one of list) {
      const tier = one && one.facts && one.facts.tier;
      if (typeof tier === 'string' && /\(Limited\)/.test(tier) && /^item:/.test(one.id || '')) {
        out.add(one.id.slice(5));
      }
    }
    return out;
  }
  /*
   * Only the items I have.
   *
   * A reader comparing what is in their vault marks those items with the
   * star in the picker and turns on "Only my items": in every slot where
   * they marked something, the search chooses among those and nothing
   * else, whatever their tier, set or progression. A slot where nothing is
   * marked stays open to the usual pool.
   */
  function ownsIn(state, hand) {
    for (const name of Object.keys(state.owned || {})) {
      const item = data.byItem[name];
      if (item && item.hand === hand) return true;
    }
    return false;
  }
  function searchAllowsItem(one, state) {
    if (!one) return false;

    if (state && state.searchOwned && ownsIn(state, one.hand)) return !!state.owned[one.name];

    if (state && state.searchLimited === false && limitedNames.has(one.name)) return false;

    if (one.set) {
      return !state || state.searchSets !== false;
    }

    if (one.tier === undefined) {
      return !state || state.searchUntiered !== false;
    }

    return true;
  }

  const searchItems = (hand, klass, state, goal) =>
    itemsFor(hand, klass, state).filter(one =>
      searchAllowsItem(one, state)
      // A stronger item outside this profile must never prune an accessible one.
      && ((profile && profile.mode === 'personal')
        // Nor may one the reader does not own prune one they do.
        || (state && state.searchOwned)
        // Raw-stat dominance cannot compare combat penalties. Retain the full
        // eligible shelf for regeneration, including combined objectives.
        || (goal && goal.id.split('+').some(id => id.startsWith('regen:')))
        || !beatenOnes().gear.has(one.name)));

  /*
   * A candidate being excluded also means an unlocked copy already worn
   * cannot survive merely because the search started from the current build.
   * Padlocked gear is deliberately left alone: "keep this" outranks a search
   * catalogue preference.
   */
  function prepareSearchable(state) {
    const out = prepareAccessible(state);

    for (const [hand] of HANDS) {
      const worn = out.gear[hand];

      if (!worn || !worn.name || out.locked[hand]) {
        continue;
      }

      const item = data.byItem[worn.name];

      if (!item || searchAllowsItem(item, out)) {
        continue;
      }

      const first =
        searchItems(hand, out.klass, out)[0];

      out.gear[hand] = {
        name: first ? first.name : null,
        slots: worn.slots === undefined
          ? 4
          : worn.slots,
        ench: Array.isArray(worn.ench)
          ? worn.ench.slice()
          : [null, null, null, null]
      };
    }

    return out;
  }

  const searchEnchants = (name, already, at) =>
    enchantsFor(name, already, at).filter(one => !beatenOnes().ench.has(one.id));

  /* ---------------- the optimiser ---------------- */

  /*
   * What "better" means, chosen by the reader.
   *
   * Everything here is a single number to push upwards, so a build can be
   * compared with another build without anybody having to weigh two things
   * against each other. Time to kill is inverted, because less of it is
   * better and the search only knows how to climb.
   */
/*
 * A colour for each of the eight, the game's own.
 *
 * Life is red and magic is blue everywhere in that game; attack is the warm
 * one, defence the steel one, and so on down. Carrying the same eight through
 * the bars, the figures and the buttons means the page never has to write
 * "this button raises your attack" - the button is attack-coloured and sits
 * under a heading that says STATS.
 */
/*
 * The eight colours, taken off the game's own banners.
 *
 * Every exaltation banner in the game is the colour of the statistic it is
 * for, and that is the code every player already reads: life is the cyan one,
 * mana the gold one, attack the magenta one, and so on. These are the
 * brightest colour in each banner's sprite, sampled out of the client rather
 * than chosen here - so a row on this page is the colour a player expects
 * before reading the word beside it.
 */
const TINT = {
  hp: '#58cfda', mp: '#f4d24c', att: '#ca46dd', def: '#8b9cb3',
  spd: '#58da6e', dex: '#ff5f2a', vit: '#dd0c32', wis: '#4b9be7'
};

  // What the reader may count as damage: the weapon's shots, the ability, or every piece worn.
  const DAMAGES = [['weapon', 'Weapon'], ['ability', 'Ability'], ['all', 'All together']];
  const DAMAGE_SAYS = { weapon: 'damage', ability: 'ability damage', all: 'all damage' };
  const GOALS = [
    { group: 'Others', id: 'dps', say: 'Damage a second', tint: '#e08a3c',
      of: n => n.chosen },
    { group: 'Others', id: 'kill', say: 'Kill it fast', tint: '#f0c274', of: (n, s) => {
      const boss = data.byBoss[s.boss];
      if (!boss) return 0;
      if (!(n.chosen > 0)) return -Infinity;
      return -boss.hp / n.chosen;
    } },
    ...STATS.map(([key, say]) => ({ group: 'Stats', id: 'stat:' + key, say,
      tint: TINT[key], of: n => n.stats.now[key] })),
    ...['hp', 'mp'].map(key => ({ group: 'Stats', id: 'regen:' + key,
      say: key.toUpperCase() + ' Regeneration (' + key.toUpperCase() + '/s)',
      tint: TINT[key === 'hp' ? 'vit' : 'wis'],
      // Reuse the established passive formula and combat penalties. The fight's
      // aggregate regen also contains triggered recovery and temporary boosts;
      // neither those nor an assumed party Healing status is passive regen.
      of: (n, s) => regenOf(n.stats, {}, fightOf(s, n.stats))[key].combat }))
  ];

  const REGEN_SAYS = 'Passive regeneration in combat, including gear and enchantments. Excludes Healing, triggered recovery, abilities, consumables and pets.';
  const scoreOf = TheoryEngine.createScore({
    getData: () => data,
    numbersFor: numberCalculations.numbersFor
  });

  /*
   * How hard each thing asked for is being pulled.
   *
   * Asking for damage and survival at once is not one question, it is a
   * bargain, and where the bargain lands is the reader's to say: seventy
   * damage to thirty survival is a different build from thirty to seventy,
   * and both are reasonable. The numbers are kept raw and read as shares of
   * their own total, so moving one moves what the others are worth without
   * anybody having to make them add up.
   */
  // Goal selection is resolved after both factories have been constructed.
  const { shareOf, sharesOf } = TheoryEngine.createShares({
    goalsOf: state => goalsOf(state)
  });

  const { goalsOf, bestAlone, aimOf } = TheoryEngine.createGoals({
    getGoals: () => GOALS,
    getBanned: () => build && build.banned,
    optimise, scoreOf, sharesOf
  });

  /*
   * A hundred per cent, split up - never a hundred per cent each.
   *
   * There is only one build to be had, so the shares are one thing divided
   * rather than several dials set on their own: pushing damage up has to push
   * everything else down, and the row has to keep saying a hundred whatever
   * is moved. Everything asked for keeps at least one per cent, so a goal
   * that is on is never silently switched off.
   */
  function heldShare(state, id) {
    return !!(state.pinned && state.pinned[id]);
  }

  function levelShares(state) {
    const list = goalsOf(state).map(one => one.id);
    const was = state.share || {};
    /*
     * A share that is being held stays where it was put; the rest of the
     * hundred is shared out evenly between the others. Somebody who has said
     * "seventy per cent damage" has said it, and adding a third thing to ask
     * for should not quietly take it back.
     */
    const held = list.filter(id => heldShare(state, id));
    const free = list.filter(id => !heldShare(state, id));
    let fixed = 0;
    const share = {};
    for (const id of held) {
      share[id] = Math.max(1, Math.min(100 - free.length, Number(was[id]) || 1));
      fixed += share[id];
    }
    if (!free.length) { state.share = share; return; }
    const room = Math.max(free.length, 100 - fixed);
    const each = Math.floor(room / free.length);
    free.forEach((id, i) => {
      share[id] = each + (i < room - each * free.length ? 1 : 0);
    });
    state.share = share;
  }

  function moveShare(state, id, to) {
    const list = goalsOf(state).map(one => one.id);
    const was = state.share || {};
    /*
     * Only what is not being held moves.
     *
     * Setting one share and then setting a second used to undo the first,
     * since the hundred was taken back off everything equally - which made
     * three of them impossible to aim. A padlock on a share takes it out of
     * the arithmetic: the rest of the hundred is what the others divide.
     */
    const others = list.filter(x => x !== id);
    const held = others.filter(x => heldShare(state, x));
    const free = others.filter(x => !heldShare(state, x));
    const share = {};
    let fixed = 0;
    for (const x of held) {
      share[x] = Math.max(1, Number(was[x]) || 1);
      fixed += share[x];
    }
    const most = 100 - fixed - free.length;
    if (most < 1) {                      // everything else is pinned solid
      share[id] = Math.max(1, 100 - fixed);
      state.share = share;
      return;
    }
    const want = Math.max(1, Math.min(most, Math.round(to)));
    share[id] = want;
    if (!free.length) { state.share = share; return; }
    // What is left goes to the others in the proportion they already stood in.
    const stood = {};
    let sum = 0;
    for (const x of free) { stood[x] = Math.max(1, Number(was[x]) || 1); sum += stood[x]; }
    const room = 100 - fixed - want;
    let given = 0;
    free.forEach((x, i) => {
      const part = i === free.length - 1
        ? room - given
        : Math.max(1, Math.min(room - given - (free.length - 1 - i),
          Math.round(room * stood[x] / sum)));
      share[x] = part;
      given += part;
    });
    state.share = share;
  }

  /*
   * Coordinate ascent: try everything for one slot, keep the best, move to
   * the next, and go round again until a whole pass changes nothing.
   *
   * It is not a proof. There are seven hundred weapons, eight hundred
   * abilities and a thousand enchantments, and the honest number of
   * combinations has thirty digits in it - nobody is searching that. What
   * this finds is a build that cannot be improved by changing any one thing
   * at a time, which is what a person does by hand and is usually the answer.
   * The page says so rather than claiming a best.
   */
  // Result preparation and ranking have no page state; these readers stay live.
  const GATHER_KEEP = 16;
  const resultCalculations = TheoryEngine.createResults({
    getData: () => data, getProfile: () => profile, hands: HANDS, bottomOf,
    enchantFitsItem, optimiseSteps: (...args) => optimiseSteps(...args), scoreOf, sayGoal,
    alternativesTry: 6, alternativesKeep: 4
  });
  const { bareOf, gearSignature, byScoreThenSignature, alternativesOfSteps,
    describeAlternative, rememberAlternatives } = resultCalculations;

  const { optimiseSteps } = TheoryEngine.createOptimiser({
    getProfile: () => profile, getAccess: () => access, getData: () => data,
    hands: HANDS, gatherKeep: GATHER_KEEP, byScoreThenSignature, gearSignature,
    prepareSearchable, searchItems, searchEnchants, enchantFitsItem, worth, scoreOf
  });

  /*
   * The answer and the next best builds behind it.
   *
   * Every gear set the searches remembered, other than the winner's, best
   * first; the first ALTERNATIVES_TRY of them are worn as they are and given
   * their own enchantments by the same search, told to change nothing but
   * the enchantments and to aim at the same thing. Whatever padlocks were on
   * the enchantments stay on; what the padlocks on the items were is put
   * back afterwards. Then the lot is ranked by the one score, so the first
   * entry is always the best build found - which is the winner unless one
   * of the others, enchanted in its own right, came out ahead of it.
   */

  /*
   * Drive the exact synchronous optimiser to completion.
   *
   * This preserves the historical public/internal contract used by tests and
   * non-UI callers. The generator's pause points cost no scheduling here.
   */
  function runOptimiserSteps(steps) {
    let step =
      steps.next();

    while (!step.done) {
      step =
        steps.next();
    }

    return step.value;
  }

  /*
   * Browser driver.
   *
   * A candidate score remains indivisible, but after roughly 12 ms of
   * accumulated search work the browser gets a timer turn for input, paint
   * and animation before the exact same generator continues.
   */
  async function runOptimiserStepsAsync(steps) {
    let sliceStarted =
      performance.now();

    let step =
      steps.next();

    while (!step.done) {
      if (
        performance.now()
        - sliceStarted
        >= 12
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              0
            )
        );

        sliceStarted =
          performance.now();
      }

      step =
        steps.next();
    }

    return step.value;
  }

  /*
   * Regeneration is not one statistic but several multiplied together.
   *
   * What VIT or WIS gives is only part of it: the percentage enchantments give
   * a share of the maximum, and the maximum itself is built by items that
   * turn magic into life (a share of MAXMP as MAXHP) and by enchantments that
   * add to either. The best regeneration is therefore a whole combination -
   * a life build wearing the percentage enchantments - and the search, which
   * changes one thing at a time from empty slots, stops at the VIT gear long
   * before it: every single step towards the combination costs regeneration
   * on its own. Asking for 99% life and 1% regeneration found more
   * regeneration than asking for regeneration alone.
   *
   * So a goal that reads the maximum is also searched from the best build for
   * that maximum, refined for the goal itself with that build's enchantments
   * kept as the starting point, and the better of the answers stands.
   */
  const SEEDS_FOR = { 'regen:hp': ['stat:hp'], 'regen:mp': ['stat:mp'] };
  function seedsFor(goal) {
    const ids = new Set();
    for (const part of String((goal && goal.id) || '').split('+')) {
      for (const id of SEEDS_FOR[part] || []) ids.add(id);
    }
    return [...ids].map(id => GOALS.find(one => one.id === id)).filter(Boolean);
  }
  function* searchSteps(state, goal, report, gather) {
    let best = yield* optimiseSteps(state, goal, report, gather);
    let looked = best.looked;
    for (const seed of seedsFor(goal)) {
      const start = yield* optimiseSteps(state, seed, null, null);
      /*
       * Then the enchantments, on the seed's own items. Left free to change
       * the items too, the first thing the search does is trade the seed's
       * gear for VIT gear, which pays at once, before the percentage
       * enchantments that make the seed's maximum worth having are on - and
       * it is back where the plain search ended. Once they are on, the items
       * are free again: from there a swap is judged with them worn.
       */
      const held = JSON.parse(JSON.stringify(start.state));
      held.locked = Object.assign({}, held.locked);
      for (const [hand] of HANDS) held.locked[hand] = true;
      const dressed = yield* optimiseSteps(held, goal, null, gather, { keepEnchants: true });
      // The answer keeps the reader's own padlocks, not the ones put on here.
      dressed.state.locked = Object.assign({}, start.state.locked);
      const refined = yield* optimiseSteps(dressed.state, goal, null, gather, { keepEnchants: true });
      looked += start.looked + dressed.looked + refined.looked;
      const better = refined.score >= dressed.score ? refined : dressed;
      if (better.score > best.score + 1e-9) best = better;
    }
    return Object.assign({}, best, { looked });
  }

  function optimise(state, goal, report, gather) {
    return runOptimiserSteps(
      searchSteps(
        state,
        goal,
        report,
        gather
      )
    );
  }

  function optimiseAsync(state, goal, report, gather) {
    return runOptimiserStepsAsync(
      searchSteps(
        state,
        goal,
        report,
        gather
      )
    );
  }

  function alternativesOf(best, gather, goal) {
    return runOptimiserSteps(
      alternativesOfSteps(
        best,
        gather,
        goal
      )
    );
  }

  function alternativesOfAsync(best, gather, goal) {
    return runOptimiserStepsAsync(
      alternativesOfSteps(
        best,
        gather,
        goal
      )
    );
  }

  /* ---------------- the page ---------------- */

  const el = id => document.getElementById(id);
  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /*
   * A piece of the one sheet, as a plain element. The sheet is a single
   * picture and every icon on the page is a window onto it, so an
   * enchantment's own picture costs nothing extra to show - and it is the
   * only way anybody tells a thousand enchantments apart at a glance.
   */
  /*
   * A window onto the one sheet.
   *
   * The address of that sheet is written into the page once, as a custom
   * property, and every icon says var(--tc-sheet). Spelling it out per icon
   * put the whole picture - a quarter of a megabyte of base64, in the offline
   * copy - into the markup a thousand times over, which is why opening the
   * enchantment list took a second and a half.
   *
   * The box is the frame's own shape rather than a square. A tall creature in
   * a square window showed the width of its height, which is the frame beside
   * it: that is why several of them appeared to be standing next to a copy of
   * themselves.
   */
  /*
   * What a piece actually draws, and how that fits a room.
   *
   * A target's rectangle carries the reach of its swing as well as the thing
   * swinging, so fitting the rectangle to a room drew a small creature in the
   * corner of a large empty box. The generator measures the pixels once and
   * writes the window beside the rectangle (see tools/theory-sprites.js), and
   * everything drawn - the picker's picture and the one on the bench - fits
   * that window instead. One window for the whole run, so a target keeps its
   * size and its footing as it animates; the frames themselves still step by
   * the full declared width.
   *
   * A piece with no measured window keeps the rectangle it always had, which
   * is every charm, every item and every class.
   */
  function targetBounds(piece, frames) {
    if (!piece) return null;

    /*
     * Size the creature from the animation actually being displayed, not from
     * attack/effect frames that may extend far outside its body.
     */
    if (piece.visibleFrames && frames && frames.length) {
      let out = null;
      for (const frame of frames) {
        const seen = piece.visibleFrames[frame];
        if (!seen || seen.w <= 0 || seen.h <= 0) continue;
        if (!out) {
          out = { x: seen.x, y: seen.y, w: seen.w, h: seen.h };
          continue;
        }
        const right = Math.max(out.x + out.w, seen.x + seen.w);
        const bottom = Math.max(out.y + out.h, seen.y + seen.h);
        out.x = Math.min(out.x, seen.x);
        out.y = Math.min(out.y, seen.y);
        out.w = right - out.x;
        out.h = bottom - out.y;
      }
      if (out) return out;
    }

    const seen = piece.visible;
    if (seen && seen.w > 0 && seen.h > 0) {
      return { x: seen.x, y: seen.y, w: seen.w, h: seen.h };
    }
    return { x: 0, y: 0, w: piece.w, h: piece.h };
  }

  function targetFit(piece, room, frames) {
    const bounds = targetBounds(piece, frames);
    if (!bounds) return null;
    const longest = Math.max(1, Math.max(bounds.w, bounds.h));
    const scale = room / longest;
    return { bounds, scale, width: bounds.w * scale, height: bounds.h * scale };
  }

  // A target, a boss, is someone: it wears the one outline every page lays on a character (web/outline.js).
  const inkOf = scale => window.RealmOutline ? 'filter:' + window.RealmOutline.filter(scale) + ';' : '';

  function sheetIcon(key, side, extra) {
    const piece = data.sheet && data.sheet.pics[key];
    if (!piece) return '';
    const fit = targetFit(piece, side);
    const zoom = fit.scale;
    return '<span class="tc-charm' + (extra ? ' ' + extra : '') + '"'
      + ' style="width:' + fit.width + 'px;height:' + fit.height + 'px'
      + ';background-size:' + (data.sheet.wide * zoom) + 'px '
      + (data.sheet.tall * zoom) + 'px'
      + ';background-position:' + (-(piece.x + fit.bounds.x) * zoom) + 'px '
      + (-(piece.y + fit.bounds.y) * zoom) + 'px'
      + '"></span>';
  }

  /*
   * A target in the picker, fitted the same way as the moving target in the
   * fight, but deliberately kept on its first frame.
   *
   * The picker can contain hundreds of creatures. Advancing all of those DOM
   * sprites on one 280 ms interval made the whole page hitch at exactly that
   * cadence. The fight still animates the selected creature through
   * targetFrame(); the catalogue itself stays static so browsing is smooth.
   */
  /*
   * The target picker and the fight use the same animation run.
   *
   * Prefer the creature's walk when the client supplies one. A target with
   * no pose registry but several frames uses all of them. Otherwise it keeps
   * its idle frame.
   */
  const targetFrameRuns =
    new WeakMap();

  function targetFrames(piece) {
    if (!piece) return [0];

    const cached =
      targetFrameRuns.get(piece);

    if (cached) {
      return cached;
    }

    const all = [];

    for (
      let at = 0;
      at < (piece.frames || 1);
      at++
    ) {
      all.push(at);
    }

    const poses =
      piece.poses || {};

    const walk =
      poses['0/1']
      || poses['3/1'];

    let run;

    if (
      walk
      && walk.length > 1
    ) {
      run = walk;
    } else if (
      !piece.poses
      && all.length > 1
    ) {
      run = all;
    } else {
      run = [
        (
          poses['0/0']
          || poses['3/0']
          || [0]
        )[0]
      ];
    }

    targetFrameRuns.set(
      piece,
      run
    );

    return run;
  }

  function targetFrame(piece, clock) {
    const run = targetFrames(piece);
    return run[Math.floor(clock / 0.28) % run.length] ?? 0;
  }

  function targetIcon(key, side) {
    const piece = data.sheet && data.sheet.pics[key];
    if (!piece) return '';
    const run = targetFrames(piece);
    const fit = targetFit(piece, side, run);
    const zoom = fit.scale;
    const at = frame => (-(piece.x + frame * piece.w + fit.bounds.x) * zoom) + 'px '
      + (-(piece.y + fit.bounds.y) * zoom) + 'px';
    return '<span class="tc-charm"'
      + ' style="' + inkOf(zoom) + 'width:' + fit.width + 'px;height:' + fit.height + 'px'
      + ';background-size:' + (data.sheet.wide * zoom) + 'px '
      + (data.sheet.tall * zoom) + 'px'
      + ';background-position:' + at(run[0]) + '"></span>';
  }
  /*
   * The same window, onto the other sheet.
   *
   * Two sheets, because they hold two different things. The theory sheet holds
   * what moves - a bolt in flight, a target in its three poses - and the index
   * sheet holds every object in the game standing still. An item's picture is
   * the index's, and it comes down as a rectangle on the projection, so this
   * page and the calculator draw the same item from the same pixels.
   */
  function indexIcon(rect, side, extra) {
    const sheet = data.iconSheet;
    if (!rect || !sheet) return '';
    const [x, y, w, h] = rect;
    const zoom = side / Math.max(w, h);
    return '<span class="sheet-art' + (extra ? ' ' + extra : '') + '"'
      + ' style="width:' + (w * zoom) + 'px;height:' + (h * zoom) + 'px'
      + ';background-size:' + (sheet.wide * zoom) + 'px ' + (sheet.tall * zoom) + 'px'
      + ';background-position:' + (-x * zoom) + 'px ' + (-y * zoom) + 'px'
      + '"></span>';
  }

  /*
   * What the game would call this thing, so the cell can be framed the way
   * the game frames it. Untiered gear - the drops people actually want - is
   * marked UT in the client's own labels, and the tiered stuff bands the way
   * its dust does: the low ones plain, the middle ones better, the top two
   * the ones worth a white bag.
   */
  function gradeOf(name) {
    const item = data.byItem[name];
    if (!item) return '';
    const labels = (item.labels || '').split(',');
    if (labels.includes('UT')) return 'is-ut';
    if (item.tier === undefined) return '';
    if (item.tier >= 13) return 'is-top';
    if (item.tier >= 10) return 'is-high';
    if (item.tier >= 6) return 'is-mid';
    return 'is-low';
  }

  /*
   * An item's picture, from wherever there is one.
   *
   * The site's own folder of item art comes from the wiki and is always a
   * patch behind the game, so anything the last update added is not in it.
   * Those are cut straight out of the client onto the same sheet the bolts
   * and the targets live on, and the cell reads from there instead.
   */
  function itemIcon(name) {
    const grade = gradeOf(name);
    const item = data.byItem[name];
    const cut = item && item.icon && indexIcon(item.icon, 34, '');
    return '<span class="tc-icon-big ' + grade + '">' + (cut || '') + '</span>';
  }

  /*
   * What a share of the bonus actually comes to.
   *
   * "+12% of bonus MAXMP" is a rule, not an answer: what it gives depends on
   * everything else worn, which is the whole reason to put one on - it grows
   * with the rest of the build. Read on its own it tells you nothing you can
   * weigh against a flat "+65 MAXMP" sitting in the slot beside it.
   *
   * So the rule is followed by what it is worth on the build in front of you,
   * taken from the same bonus the statistics themselves were taken from. Null
   * when there is nothing to read it against, and then only the rule is said.
   */
  function relWorth(part, bonus) {
    const key = OF_STAT[part.stat], of = OF_STAT[part.of];
    if (!key || !of || !bonus) return null;
    const much = (bonus[of] || 0) * part.pct / 100;
    return Math.round(much * 10) / 10;
  }
  /*
   * The number first, and the rule after it.
   *
   * A chip has about twenty characters before it is cut short with an
   * ellipsis, and "+12% of bonus MAXMP = +37 MAXMP" is longer than that - so
   * the answer was the half that got cut, which is the half worth having. Led
   * with, it reads like the flat enchantment in the slot beside it and can be
   * weighed against it at a glance; the rule that produced it follows, and
   * the whole sentence is on the chip's tooltip either way.
   */
  // Every statistic named in a line wears its own colour, as it does in the stat bar.
  const tintStats = said => said.replace(/\b(MAXHP|MAXMP|HP|MP|ATT|DEF|SPD|DEX|VIT|WIS)\b/g,
    (tag, key) => '<b style="color:' + TINT[OF_STAT[key]] + '">' + tag + '</b>');
  const saysRel = (part, bonus) => {
    const much = relWorth(part, bonus);
    const rule = plus(part.pct) + '% of bonus ' + part.of;
    if (much === null) {
      return rule + (part.of === part.stat ? '' : ' as ' + part.stat);
    }
    return plus(much) + ' ' + part.stat + ' (' + rule + ')';
  };

  /*
   * The padlock.
   *
   * It was a padlock once and became the word "keep", because the padlock of
   * the day was a grey glyph from a font that nobody could see - and a
   * control nobody can see is the same as not having one. The word was
   * readable, and it cost a great deal of room: five of them on every item,
   * four items on the page at once, on a column that has to share the screen
   * with the fight.
   *
   * So it is a padlock again, and the thing that went wrong last time is what
   * this is drawn to avoid. It is drawn rather than borrowed, in the button's
   * own colour, so it lights exactly the way the word did - dim at rest,
   * bright under the cursor, dark on the accent when it is holding. And the
   * shackle is open when the thing is free and shut when it is kept, so the
   * state is said by the shape and does not rest on the colour at all.
   */
  const LOCK = held => '<svg viewBox="0 0 12 12" width="12" height="12"'
    + ' aria-hidden="true" focusable="false">'
    + '<path d="M4.4 5.6V3.9a1.6 1.6 0 0 1 3.2 0'
    + (held ? 'v1.7' : '') + '" fill="none" stroke="currentColor"'
    + ' stroke-width="1.25" stroke-linecap="round"/>'
    + '<rect x="2.6" y="5.4" width="6.8" height="5.2" rx="1.1" fill="currentColor"/>'
    + '</svg>';
  const lockSays = held => (held ? 'Kept - click to let it change' : 'Keep this one');

  function drawSlots() {
    /* The build as it stands, once, so every share on the page is measured
       against the same bonus rather than four slightly different ones. */
    const kit = statsOf(build);
    const bonus = kit && kit.from && kit.from.bonus;
    const box = el('tcGear');
    if (!box) return;
    box.innerHTML = HANDS.map(([hand, say]) => {
      const worn = build.gear[hand];
      const item = data.byItem[worn.name];
      const locked = !!build.locked[hand];

      /*
       * What it is, as the badges the rest of the site uses - the tier, or
       * the fact that it has none, and what it does that is worth a word.
       * The numbers that follow are what it does.
       */
      const marks = [];
      if (item) {
        const labels = (item.labels || '').split(',');
        if (labels.includes('UT')) marks.push(['ut', 'Untiered']);
        else if (item.tier !== undefined) marks.push(['tier', 'Tier ' + item.tier]);
        if (item.set) marks.push(['set', 'Set']);
        const first = item.shots && item.shots[0];
        if (first && first.pierce) marks.push(['pierce', 'Pierces']);
        if (item.mp) marks.push(['mp', item.mp + ' MP']);
      }

      /* What the thing is, in the fewest words that still say it. */
      const bits = [];
      let grows = '';
      if (item) {
        const gun = item.shots && item.shots[0];
        if (gun) {
          bits.push(gun.low + (gun.high !== gun.low ? '–' + gun.high : '') + ' dmg');
          if (gun.reach) bits.push(gun.reach + ' tiles');
          if (gun.pierce) bits.push('pierces');
        }
        /*
         * How many it fires: a cycle as the cycle (the Phantom Sickle's
         * 1 / 3 / 5), several Subattacks as what they fire together (the
         * Shortbow's three arrows), and otherwise the weapon's own count.
         */
        const channels = (item.shots || []).filter(one => one.subattack);
        const volley = (channels.find(one => one.volley) || {}).volley;
        const together = channels.reduce((sum, one) => sum + (one.many || 1), 0);
        if (volley) bits.push(volley.map(n => n || 'pause').join(' / ') + ' shots in turn');
        else if (together > 1) bits.push(together + ' shots');
        else if (item.many > 1) bits.push(item.many + ' shots');
        if (item.rate !== undefined && item.rate !== 1) {
          bits.push(Math.round(item.rate * 100) + '% rate');
        }
        if (item.worn) {
          for (const tag of Object.keys(item.worn)) {
            bits.push(plus(item.worn[tag]) + ' ' + tag);
          }
        }
        // A statistic given as a share of another one, said as the game says
        // it: half your life off, all of your mana on as life.
        for (const part of item.share || []) {
          bits.push(plus(part.pct) + '% of ' + part.of
            + (part.of === part.stat ? '' : ' as ' + part.stat));
        }
        for (const part of item.rel || []) bits.push(saysRel(part, bonus));
        /*
         * What a stat over a floor adds to each use, and what it adds with
         * this build's own stats - the reason one more point of it can be
         * worth more on this item than on any other.
         */
        const cast = item.cast;
        if (cast && cast.from !== undefined && (cast.dmg || cast.more >= 0.001)) {
          const tag = cast.stat === 'MAXHP' ? 'HP' : cast.stat === 'MAXMP' ? 'MP' : cast.stat || 'WIS';
          const over = kit ? Math.max(0, kit.now[OF_STAT[tag]] - cast.from) : 0;
          const gain = [cast.dmg ? plus(cast.dmg) + ' dmg' : '', cast.more >= 0.001 ? plus(cast.more) + ' shots' : '']
            .filter(Boolean).join(', ');
          const now = [cast.dmg && over ? plus(over * cast.dmg) + ' dmg' : '', cast.more >= 0.001 && over ? plus(over * cast.more) + ' shots' : '']
            .filter(Boolean).join(', ');
          grows = gain + ' per ' + tag + ' over ' + cast.from + (kit ? ' · ' + (now || 'nothing') + ' with this build' : '');
        }
        if (item.sb) bits.push('soulbound');
      }

      /* And its enchantments, as chips rather than as a faint list. */
      const chips = [];
      for (let at = 0; at < worn.slots; at++) {
        const id = worn.ench[at];
        const one = id && data.byEnch[id];
        const held = !!build.locked[hand + ':' + at];
        /*
         * Said once, however many parts there are. An enchantment that adds
         * six volleys was reading "adds 50-70 adds 50-70 adds 50-70..." right
         * out of its own chip and off the side of the card, taking the
         * padlock and the way to remove it with it.
         */
        const swaps = one && one.sub ? (() => {
          const set = one.sub.filter(part => part.how === 'set');
          const add = one.sub.filter(part => part.how === 'add');
          const words = [];
          if (set.length) {
            const it = set[set.length - 1];
            words.push('shoots ' + it.shots[0].low + '-' + it.shots[0].high);
          }
          if (add.length) {
            const most = add.reduce((a, b) =>
              (b.shots[0].high || 0) > (a.shots[0].high || 0) ? b : a);
            words.push('adds ' + (add.length > 1 ? add.length + ' x ' : '')
              + most.shots[0].low + '-' + most.shots[0].high);
          }
          return words.join(', ');
        })() : '';
        const shares = one && one.rel
          ? one.rel.map(part => saysRel(part, bonus)).join(' ')
          : '';
        const heals = one && one.heal ? [
          one.heal.flatHP ? '+' + one.heal.flatHP + ' HP/s' : '',
          one.heal.partHP ? '+' + round(one.heal.partHP * 100) + '% HP/s' : '',
          one.heal.flatMP ? '+' + one.heal.flatMP + ' MP/s' : '',
          one.heal.partMP ? '+' + round(one.heal.partMP * 100) + '% MP/s' : '',
          one.heal.soak ? '-' + round((1 - one.heal.soak) * 100) + '% damage taken' : ''
        ].filter(Boolean).join(' ') : '';
        const said = tintStats(one && one.worn
          ? '<u>' + Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' ') + '</u>'
          : swaps ? '<u>' + esc(swaps) + '</u>'
          : shares ? '<u>' + esc(shares) + '</u>'
          : heals ? '<u>' + esc(heals) + '</u>'
          : (one && gearInfo && gearInfo.enchants && gearInfo.enchants[one.id]) ? '<u>' + round((1 - gearInfo.enchants[one.id].mp) * 100) + '% less magic an ability costs</u>'
          : (one && one.alters ? '<u class="tc-uncounted">changes the shot</u>' : ''));
        // The whole sentence, for the one that has been cut short on the card.
        const whole = one && (swaps || shares || heals
          || (one.worn && Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' ')));
        // A plain roll never gives it: say which engraving it takes.
        const book = one && rulesFor();
        const via = book ? EnchantEngine.engravingsFor(book, { name: one.name })[0] : '';
        chips.push('<span class="tc-ench' + (held ? ' is-held' : '')
          + (one ? '' : ' is-empty') + (via ? ' has-via' : '') + '"'
          + (whole ? ' title="' + esc(one.name + ' — ' + whole) + '"' : '') + '>'
          + (one ? sheetIcon(one.pic, 18) : '')
          // Its whole name on hover: a gear column is narrow enough to cut it.
          + '<button type="button" class="tc-ench-pick" data-ench="' + hand + ':' + at + '"'
          + (one ? ' title="' + esc(one.name) + '"' : '') + '>'
          + (one ? esc(one.name) : '<em>empty</em>') + '</button>'
          + said
          + (via ? '<i class="tc-via" title="Only through the ' + esc(via) + '">engraving</i>' : '')
          + '<button type="button" class="tc-hold tc-lock" data-hold="'
          + hand + ':' + at + '" aria-pressed="' + (held ? 'true' : 'false')
          + '" title="' + lockSays(held) + ' while the calculator works"'
          + ' aria-label="' + lockSays(held) + '">' + LOCK(held) + '</button>'
          + (one ? '<button type="button" class="tc-drop" data-drop="' + hand + ':' + at
            + '" title="take this enchantment off">×</button>' : '')
          + '</span>');
      }
      /*
       * How many slots the item has, shown the way the game shows it: four
       * gems, as many lit as the copy has slots, in the colour of the rarity
       * that gives that many - green, blue, purple, gold. A number in a box
       * said nothing about what it counted. Pressing a gem sets that many;
       * pressing the last lit one again takes it away, down to none.
       */
      const rarity = '<span class="tc-slots-pick" role="group" aria-label="Enchantment slots"'
        + ' data-lit="' + worn.slots + '" title="' + worn.slots + ' enchantment slot'
        + (worn.slots === 1 ? '' : 's') + '">'
        + [1, 2, 3, 4].map(n => '<button type="button" class="tc-gem' + (n <= worn.slots ? ' is-lit' : '') + '"'
          + ' data-slots-set="' + hand + ':' + n + '" aria-pressed="' + (n <= worn.slots) + '"'
          + ' aria-label="' + n + ' slot' + (n === 1 ? '' : 's') + '"></button>').join('')
        + '</span>';

      return '<div class="tc-slot' + (locked ? ' is-held' : '') + '">'
        + '<div class="tc-slot-head">'
        + '<button type="button" class="tc-item-pick" data-item="' + hand + '">'
        + itemIcon(worn.name)
        + '<span class="tc-item-said">'
        + '<span class="tc-item-where">' + say
        + (marks.length ? '<span class="chips">' + marks.map(([kind, said]) =>
          '<i class="chip is-' + kind + '">' + esc(said) + '</i>').join('') + '</span>' : '')
        + '</span>'
        + '<span class="tc-item-name">' + (worn.name ? esc(worn.name) : 'nothing') + '</span>'
        + '</span></button>'
        + (worn.name ? '<button type="button" class="tc-take" data-take="' + hand
          + '" title="Take this item and what is on it to the enchant calculator">'
          + 'enchant</button>' : '')
        + (worn.name ? '<button type="button" class="tc-index-open" data-index-open="item:' + esc(worn.name) + '"'
          + ' title="Open ' + esc(worn.name) + ' in the Index" aria-label="Open ' + esc(worn.name) + ' in the Index">Index</button>' : '')
        + (worn.name ? '<button type="button" class="tc-ban tc-slot-ban" data-ban-held="' + hand
          + '" title="Blacklist this item - the search will not offer it"'
          + ' aria-label="Blacklist ' + esc(worn.name) + '">⊘</button>' : '')
        + '<button type="button" class="tc-hold tc-lock" data-hold="' + hand
        + '" aria-pressed="' + (locked ? 'true' : 'false')
        + '" title="' + lockSays(locked) + ' while the calculator works"'
        + ' aria-label="' + lockSays(locked) + '">' + LOCK(locked) + '</button>'
        + rarity
        /*
         * What the item does goes under the row rather than in it.
         *
         * It used to sit inside the button that changes the item, which put
         * it in a column ending where the two buttons begin - so it was cut
         * off mid-sentence while the width beneath those buttons sat empty.
         * On its own line it has the whole card and says all of it.
         */
        + (bits.length ? '<span class="tc-bits" title="' + esc(bits.join(' · ')) + '">' + tintStats(esc(bits.join(' · '))) + '</span>' : '')
        // On a line of its own, so it is never the part an ellipsis takes.
        + (grows ? '<span class="tc-bits tc-grows" title="' + esc(grows) + '">' + tintStats(esc(grows)) + '</span>' : '')
        + lootRow(worn.name)
        + '</div>'
        + '<div class="tc-ench-strip">' + chips.join('') + '</div>'
        + '</div>';
    }).join('');
  }

  function drawStats() {
    const box = el('tcStats');
    if (!box) return;
    const got = statsOf(build);
    box.innerHTML = STATS.map(([key, say]) => {
      const now = got.now[key];
      const top = got.top[key] || now || 1;
      /*
       * Two lengths, not one: what the class itself reaches, and what the
       * gear has put on top of it. A single bar answers "is this maxed",
       * which the reader already knows; the question a build asks is which
       * statistics the gear is actually lifting and which it is leaving
       * alone, and that is the difference between the two lengths.
       */
      const base = got.base[key] + (got.from.exalt[key] || 0);
      const given = now - base;
      const most = Math.max(now, top);
      const wasPart = Math.max(0, Math.min(1, base / most));
      const gotPart = Math.max(0, Math.min(1, given / most));
      const over = now > top;
      return '<div class="tc-stat is-' + key + (over ? ' is-over' : '')
        + (given > 0.05 ? ' is-lifted' : given < -0.05 ? ' is-cut' : '')
        + '" style="--tint:' + TINT[key] + '">'
        + '<i>' + say + '</i>'
        + '<span class="tc-bar">'
        + '<span class="tc-bar-was" style="width:' + (wasPart * 100).toFixed(1) + '%"></span>'
        + '<span class="tc-bar-got" style="width:' + (Math.abs(gotPart) * 100).toFixed(1) + '%"></span>'
        + '</span>'
        + '<b>' + round(now) + '<u>/' + top + '</u>'
        + (Math.abs(given) > 0.05
          ? '<em>' + (given > 0 ? '+' : '') + round(given) + '</em>' : '')
        + '</b>'
        + '</div>';
    }).join('') + setsSaid();
  }

  /*
   * And what a set is paying, when one is on.
   *
   * It is the only bonus on the page that comes from the outfit rather than
   * from a piece of it, so there is nowhere else it could be shown: a player
   * looking at two pieces of the Legion Elite Set has no way of telling from
   * the two lines above them that a hundred and twenty life of the total came
   * from wearing them together.
   */
  function setsSaid() {
    const on = setsOn(build);
    if (!on.length) return '';
    return on.map(kit => '<div class="tc-setline"><b>' + esc(kit.name) + '</b>'
      + '<i>' + kit.many + ' pieces</i>'
      + '<span>' + Object.keys(kit.gives)
        .map(key => '<u style="color:' + TINT[key] + '">' + plus(kit.gives[key])
          + ' ' + key.toUpperCase() + '</u>').join('')
      + '</span></div>').join('');
  }

  const plus = n => (n > 0 ? '+' : '') + (Math.round(n * 10) / 10);
  /*
   * A short line, not a paragraph. The ones that raise a statistic say so in
   * three words; the ones that hang an effect off a hit carry a sentence of
   * conditions in the client, and a column of those unread is worse than a
   * column of half-sentences.
   */
  const shortly = words => {
    const one = String(words || '').split('\n')[0].trim();
    return one.length > 44 ? one.slice(0, 43) + '…' : one;
  };
  const round = n => Math.round(n * 10) / 10;
  const commas = n => RealmI18n.number(Math.round(n));

  /*
   * What the search is being asked for, and what it is starting from.
   *
   * Pressing a button that rearranges your whole build is easier to do when
   * you can see the number it is aiming at and what that number is now - and
   * when you can put the build back afterwards, which is what turns this from
   * a gamble into a thing worth trying.
   */
  /*
   * The bargain, as a row of sliders - and only when there is a bargain to
   * strike. One thing asked for has nothing to trade against.
   */
  // How much of a share's track is filled, for the track drawn in its colour.
  const mixFill = (value, most) => (most > 1 ? Math.round((value - 1) / (most - 1) * 1000) / 10 : 100);
  function drawMix() {
    const box = el('tcMix');
    if (!box) return;
    const parts = sharesOf(build);
    box.hidden = parts.length < 2;
    if (box.hidden) { box.innerHTML = ''; return; }
    box.innerHTML = parts.map(one =>
      '<span class="tc-mix-one' + (heldShare(build, one.goal.id) ? ' is-held' : '')
      + '" style="--tint:' + one.goal.tint + '">'
      + '<i>' + esc(one.goal.say) + '</i>'
      + '<input type="range" min="1" max="' + (100 - parts.length + 1)
      + '" value="' + Math.round(one.part * 100)
      + '" data-mix="' + esc(one.goal.id) + '" aria-label="' + esc(one.goal.say) + '"'
      + ' style="--mix-fill:' + mixFill(Math.round(one.part * 100), 100 - parts.length + 1) + '%">'
      + '<b>' + Math.round(one.part * 100) + '%</b>'
      + '<button type="button" class="tc-hold" data-pin="' + esc(one.goal.id)
      + '" title="hold this share while the others move">'
      + (heldShare(build, one.goal.id) ? 'held' : 'hold') + '</button>'
      + '</span>').join('');
  }

  /*
   * The same numbers, written into the row that is already there. Used while
   * a slider is being dragged, when replacing the row would end the drag.
   */
  function tuneMix(dragged) {
    const box = el('tcMix');
    if (!box) return;
    for (const one of sharesOf(build)) {
      const bar = box.querySelector('[data-mix="' + one.goal.id + '"]');
      if (!bar) continue;
      const pct = Math.round(one.part * 100);
      if (bar !== dragged) bar.value = String(pct);
      bar.style.setProperty('--mix-fill', mixFill(Number(bar.value), Number(bar.max)) + '%');
      const said = bar.parentElement && bar.parentElement.querySelector('b');
      if (said) said.textContent = pct + '%';
    }
  }

  function drawSearch() {
    const said = el('tcNow');
    if (said) {
      said.innerHTML = goalsOf(build).map(one => {
        const now = scoreOf(build, one);
        return Number.isFinite(now)
          ? '<span class="figure"><b style="color:' + esc(one.tint) + '">'
            + esc(sayGoal(one, now)) + '</b><small>'
            + esc(one.say.toLowerCase()) + ' now</small></span>'
          : '';
      }).join('');
    }
    const aside = el('tcAside');
    if (aside) {
      const names = Object.keys(build.banned || {});
      aside.hidden = !names.length;
      aside.innerHTML = names.length
        ? '<i>Set aside</i>' + names.map(name => {
          // Its picture beside its name: a list of names alone was hard to
          // scan, and the sprite is how the thing is known in the game.
          const item = data.byItem[name];
          const art = item && item.icon && indexIcon(item.icon, 24, '');
          return '<button type="button" class="tc-aside-one" data-unban="' + esc(name)
            + '" title="Put it back in the running">'
            + (art ? '<span class="tc-aside-art">' + art + '</span>' : '')
            + '<span class="tc-aside-name">' + esc(name) + '</span>'
            + '<span class="tc-aside-x" aria-hidden="true">×</span></button>';
        }).join('')
        : '';
    }
    const mineBox = el('tcOwned');
    if (mineBox) {
      const names = Object.keys(build.owned || {});
      mineBox.hidden = !names.length;
      mineBox.innerHTML = names.length
        ? '<i>My items</i>'
          + '<button type="button" class="tc-search-filter tc-owned-only' + (build.searchOwned ? ' is-on' : '')
          + '" data-owned-only aria-pressed="' + !!build.searchOwned + '"'
          + ' title="Search only among the items marked ★ in each slot where you marked some">Only my items</button>'
          + names.map(name => {
            const item = data.byItem[name];
            const art = item && item.icon && indexIcon(item.icon, 24, '');
            return '<button type="button" class="tc-aside-one" data-unown="' + esc(name)
              + '" title="Unmark it">'
              + (art ? '<span class="tc-aside-art">' + art + '</span>' : '')
              + '<span class="tc-aside-name">' + esc(name) + '</span>'
              + '<span class="tc-aside-x" aria-hidden="true">×</span></button>';
          }).join('')
        : '';
    }
    const kept = el('tcKept');
    if (kept) {
      const many = Object.values(build.locked).filter(Boolean).length;
      kept.textContent = many
        ? many + (many === 1 ? ' thing kept' : ' things kept')
        : '';
    }
    const undo = el('tcUndo');
    if (undo) undo.hidden = !before;
  }

  /* A score in the words of the thing it measures. */
  function sayGoal(goal, value) {
    if (!Number.isFinite(value)) return '\u2014';
    if (goal.id === 'kill') return round(-value) + 's';
    if (goal.id && goal.id.indexOf('regen:') === 0) return RealmI18n.number(value, { maximumFractionDigits: 2 }) + ' ' + goal.id.slice(6).toUpperCase() + '/s';
    if (goal.id && goal.id.indexOf('stat:') === 0) return round(value);
    return commas(value);
  }

  let before = null;

  /*
   * What the bench is not showing you.
   *
   * A hundred and sixteen weapons and abilities throw something that does not
   * travel in a straight line - it weaves, or speeds up, or comes back - and
   * the client states the parameters of that without stating the algorithm.
   * The bench draws a straight line, which is honest arithmetic for the
   * damage and a lie about the flight, so it says which.
   */
  /*
   * The status effects in the figures above: which are up and why, and a
   * switch for each one a party member could keep up instead. An effect the
   * target is immune to says so; one the build already keeps up all the time
   * has nothing to switch.
   */
  const FX_SAY = { weapon: 'your weapon', ability: 'your ability', party: 'assumed from the party', immune: 'the target is immune' };
  function statusIconTc(name, side) {
    const e = statusInfo && statusInfo.byName.get(name);
    if (!e || !e.icon) return '';
    const [x, y, w, h] = e.icon, z = side / Math.max(w, h, 8);
    const url = (window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.statusSheet) || 'assets/index/status-icons.png';
    return '<i class="tc-fx-icon" style="width:' + w * z + 'px;height:' + h * z + 'px;background-image:url(' + url
      + ');background-size:' + statusInfo.sheet.wide * z + 'px ' + statusInfo.sheet.tall * z + 'px;background-position:'
      + (-x * z) + 'px ' + (-y * z) + 'px"></i>';
  }
  function drawEffects(numbers) {
    const box = el('tcStatus');
    if (!box) return;
    if (!statusInfo || !numbers) { box.innerHTML = ''; return; }
    const effects = numbers.effects || { up: {}, from: {}, bleed: 0, immune: new Set() };
    const assume = build.assume || {};
    const rows = DPS_EFFECTS.map(name => {
      const e = statusInfo.byName.get(name);
      if (!e) return '';
      const p = name === 'Bleeding' ? (effects.bleed > 0 ? 1 : 0) : (effects.up[name] || 0);
      if (name === 'Bleeding' && !p) return '';              // nothing inflicts it: nothing to say
      const why = effects.from[name];
      const immune = effects.immune && effects.immune.has(name);
      const own = why === 'weapon' || why === 'ability' || why === 'gear';
      const state = immune ? FX_SAY.immune
        : name === 'Bleeding' ? commas(effects.bleed) + ' a second'
        : p ? (FX_SAY[why] || why) + (p < 1 ? ' · ' + Math.round(p * 100) + '% of the time' : '')
        : 'not up - click to assume the party keeps it up';
      // The chip is the switch for what a party could bring, unless your own gear keeps it up all the time.
      const can = name !== 'Bleeding' && !immune && !(own && p >= 1);
      const body = statusIconTc(name, 16) + '<b>' + esc(name) + '</b>' + (p > 0 && p < 1 ? '<small>' + Math.round(p * 100) + '%</small>' : '');
      const tag = 'class="tc-fx' + (p ? ' is-up' : '') + (immune ? ' is-immune' : '') + ' is-' + e.tone + '" title="' + esc(state) + '"';
      return can ? '<button type="button" ' + tag + ' data-assume="' + esc(name) + '" aria-pressed="' + (assume[name] ? 'true' : 'false') + '">' + body + '</button>'
        : '<span ' + tag + '>' + body + '</span>';
    }).join('');
    box.innerHTML = '<div class="tc-fx-row">' + rows + '</div>';
  }

  let moreOpen = false;
  function drawNumbers() {
    const box = el('tcNumbers');
    if (!box) return;
    const stats = statsOf(build).now;
    const at = build.against;
    const numbers = numbersFor(build, at);
    const boss = data.byBoss[build.boss];
    const againstBoss = boss ? numbersFor(build, boss.def) : null;
    const kill = boss && againstBoss && againstBoss.chosen
      ? boss.hp / againstBoss.chosen : null;
    /*
     * Four numbers. Everything else this page can work out is on the curve
     * beneath it or in the fight above it, and a wall of figures is what
     * the page looked like before somebody said so.
     */
    /*
     * The middle two describe whichever hand is doing the work. They were the
     * weapon's, always, so turning the weapon off left two noughts sitting
     * there claiming the ability fires nothing - when what it does is throw
     * one big shot every few seconds, which is the interesting half of the
     * comparison.
     */
    const spellOnly = build.using === 'spell';
    const hand = spellOnly ? numbers.spell : numbers.gun;
    const often = spellOnly
      ? (hand.every ? round(1 / hand.every) : 0)
      : round(hand.rate);
    // A nought that comes from standing too far away says so, rather than reading as a broken figure.
    const tooFar = !(numbers.chosen > 0) && distanceOf(build) > 0
      ? ' · nothing reaches at ' + esc(distanceText(distanceOf(build))) : '';
    const rows = [
      [(DAMAGE_SAYS[build.damage] || DAMAGE_SAYS.weapon) + ' a second' + tooFar, commas(numbers.chosen), true],
      [spellOnly ? 'casts a second' : 'shots a second', often],
      [spellOnly ? 'each cast' : 'each shot', commas(hand.each)
        + (hand.many > 1 ? ' x ' + hand.many : '')]
    ];
    /*
     * And where it fires in runs, what the run is - since the shots a second
     * above is the rate inside the run, and on its own it reads as a weapon
     * that never stops.
     */
    if (!spellOnly && hand.burst) {
      rows.push(['in bursts of', hand.burst.shots
        + ', then ' + round(hand.burst.wait) + 's']);
    }
    if (kill !== null) {
      rows.push([esc(boss.name) + ' dies in', round(kill) + 's', true]);
    }
    // What the build gets back, in combat and out of it (Vital Combat halves what VIT and WIS bring).
    if (numbers.regen) {
      const back = numbers.regen;
      rows.push([tintStats('HP a second, in combat'), round(back.hp.combat), 'main']);
      rows.push([tintStats('MP a second, in combat'), round(back.mp.combat), 'main']);
      rows.push([tintStats('HP / MP a second, out of combat'), round(back.hp.calm) + ' / ' + round(back.mp.calm)]);
    }
    // What the worn gear costs in combat, and what its effects add that the weapon's own shots do not.
    const penalties = Object.entries((numbers.fought && numbers.fought.penalty) || {});
    if (penalties.length) {
      rows.push(['gear costs you in combat', tintStats(penalties.map(([key, v]) => STATS.find(s => s[0] === key)[2] + ' ' + v).join(', '))]);
    }
    // What gear gives back or raises while you fight: counted in the figures above, said here so they can be traced.
    const temper = numbers.temper;
    if (temper && temper.list.length) {
      const gives = [temper.gain.mp > 0 ? round(temper.gain.mp) + ' magic' : '', temper.gain.hp > 0 ? round(temper.gain.hp) + ' life' : ''].filter(Boolean);
      if (gives.length) rows.push(['gear gives back a second, in combat', gives.join(', ')]);
      const raised = Object.entries(temper.boost).filter(([, v]) => Math.abs(v) >= 0.05).map(([key, v]) => STATS.find(x => x[0] === key)[2] + ' ' + (v > 0 ? '+' : '') + round(v));
      if (raised.length) rows.push(['gear raises on average, in combat', tintStats(raised.join(', '))]);
    }
    // Where the damage comes from, piece by piece, and all of it together. A range where a figure rests on a rule only the
    // game server knows (whether attack raises a bolt an item throws); the weapon's own shots alone are the figure above.
    if (numbers.parts) {
      const P = numbers.parts;
      const say = x => (round(x.low) === round(x.high) ? commas(round(x.low)) : commas(round(x.low)) + '–' + commas(round(x.high)));
      rows.push(['weapon a second, with what its shots set off', say(P.weapon)]);
      if (P.ability.high > 0) rows.push(['ability a second, as often as the magic allows', say(P.ability)]);
      if (P.armor.high > 0) rows.push(['armour a second', say(P.armor)]);
      if (P.ring.high > 0) rows.push(['ring a second', say(P.ring)]);
      if (P.ability.high > 0 || P.armor.high > 0 || P.ring.high > 0 || P.weapon.high > numbers.total + 1e-9) rows.push(['all together, a second', say(P.all)]);
    }
    /*
     * The same row of figures the enchanter uses for its answer: the number
     * large and set in tabular figures, the words for it small and grey
     * underneath. Four tiles in boxes was this page inventing a treatment the
     * site already had.
     */
    // The essentials first - the damage, how long the target lasts, what you get back - and the rest one click away.
    const tile = ([say, was, loud]) => '<span class="figure' + (loud === true ? ' is-loud' : '') + '"><b>' + was
      + '</b><small>' + say + '</small></span>';
    const main = rows.filter(row => row[2]), more = rows.filter(row => !row[2]);
    box.innerHTML = main.map(tile).join('')
      + (more.length ? '<details class="tc-more"' + (moreOpen ? ' open' : '') + '><summary>All the figures</summary><div class="tc-facts">'
        + more.map(tile).join('') + '</div></details>' : '');
    if (!box.dataset.moreWired) {
      box.dataset.moreWired = '1';
      box.addEventListener('toggle', event => { if (event.target.classList && event.target.classList.contains('tc-more')) moreOpen = event.target.open; }, true);
    }
    drawEffects(numbers);
  }

  /*
   * Damage a second against every armour a thing might have.
   *
   * This is the picture worth having, because armour does not scale a build
   * down evenly: it takes a flat bite out of every shot, so a weapon that
   * throws many small ones falls off a cliff and one that throws a single
   * heavy one barely notices. Two builds level on a bare target can be
   * ten to one on an armoured one, and no single number shows that.
   */
  function drawGraph() {
    const canvas = el('tcGraph');
    if (!canvas) return;
    const wide = canvas.clientWidth || 520;
    const tall = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(wide * dpr);
    canvas.height = Math.round(tall * dpr);
    const pen = canvas.getContext('2d');
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, wide, tall);

    const MOST = 100;
    const lines = [
      { say: 'weapon', tint: '#e0a13a', of: n => n.gun.dps },
      { say: 'ability', tint: '#6f9fd8', of: n => n.spell.dps },
      { say: 'all together', tint: '#8fd08a', of: n => n.parts.all.low }
    ];
    const points = [];
    let ceiling = 1;
    for (let def = 0; def <= MOST; def++) {
      const n = numbersFor(build, def);
      points.push(n);
      ceiling = Math.max(ceiling, n.total, n.parts.all.low, n.spell.dps);
    }
    const pad = { l: 52, r: 10, t: 12, b: 26 };
    const x = def => pad.l + (def / MOST) * (wide - pad.l - pad.r);
    const y = v => tall - pad.b - (v / ceiling) * (tall - pad.t - pad.b);

    pen.strokeStyle = 'rgba(255,255,255,.09)';
    pen.fillStyle = 'rgba(255,255,255,.45)';
    pen.font = '11px ui-monospace, monospace';
    pen.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = ceiling * i / 4;
      pen.beginPath();
      pen.moveTo(pad.l, y(v));
      pen.lineTo(wide - pad.r, y(v));
      pen.stroke();
      pen.fillText(commas(v), 4, y(v) + 4);
    }
    for (let def = 0; def <= MOST; def += 20) {
      pen.fillText(String(def), x(def) - 6, tall - 8);
    }
    pen.fillStyle = 'rgba(255,255,255,.35)';
    pen.fillText('enemy armour', wide - pad.r - 82, tall - 8);

    for (const line of lines) {
      pen.strokeStyle = line.tint;
      pen.lineWidth = 2;
      pen.beginPath();
      points.forEach((n, def) => {
        const at = y(line.of(n));
        if (def === 0) pen.moveTo(x(def), at); else pen.lineTo(x(def), at);
      });
      pen.stroke();
    }

    // Where the target being aimed at sits on it.
    const boss = data.byBoss[build.boss];
    for (const mark of [{ at: build.against, say: 'chosen', tint: 'rgba(255,255,255,.5)' },
      boss ? { at: Math.min(MOST, boss.def), say: boss.name, tint: 'rgba(224,161,58,.55)' } : null]) {
      if (!mark) continue;
      pen.strokeStyle = mark.tint;
      pen.lineWidth = 1;
      pen.setLineDash([3, 3]);
      pen.beginPath();
      pen.moveTo(x(mark.at), pad.t);
      pen.lineTo(x(mark.at), tall - pad.b);
      pen.stroke();
      pen.setLineDash([]);
    }

    const key = el('tcKey');
    if (key) {
      key.innerHTML = lines.map(line => '<span><i style="background:' + line.tint
        + '"></i>' + line.say + '</span>').join('');
    }
  }

  /* ---------------- the duel ---------------- */
  /*
   * The build, hitting the thing you chose to hit.
   *
   * Every number on this page is a rate, and a rate is a hard thing to feel.
   * Six hundred a second and thirty-four thousand a second are both just
   * words until you watch the same boss take four hundred seconds and then
   * five. So the frame plays it out: the class stands on the left in the
   * animation the client gives it, throws the shots its weapon actually
   * throws at the rate its dexterity actually gives it, and the target's life
   * comes down by what each one lands for.
   *
   * It is the same arithmetic as the panel beside it, not a second opinion.
   * The damage a shot lands, the number of shots and how often they go are
   * all read from the same functions, so the clock in the corner and the
   * "dies in" line agree by construction rather than by luck.
   */
  // How each part of an ability is drawn when it has no bolt: a chain of lightning, a lobbed grenade or trap, a ring.
  const FX_OF = { lightning: 'zap', shockblast: 'boom', trap: 'lob', bomb: 'boom', impact: 'lob', poison: 'cloud', nova: 'ring', blast: 'boom', hex: 'boom' };
  const FX_COLOUR = { poison: '#5fd36a', impact: '#5fd36a', nova: '#ffd84a', blast: '#d04a4a', hex: '#a35fd0' };
  const duel = {
    on: true, at: 0, dealt: 0, shots: [], cool: 0, spell: 0, swing: 0, left: 0,
    hp: 0, full: 0, over: 0, last: 0, art: new Map(), bits: [], fx: [],
    mp: 0, mpFull: 0
  };

  /*
   * One sheet holds every target and every bolt, cut out of the client by
   * tools/theory-sprites.js: four hundred things worth hitting with the whole
   * run of poses the game keeps for them, and the nine hundred projectiles
   * the weapons actually throw. One picture, one index of rectangles.
   */
  /*
   * The sprite coordinates and the PNG are one generated artifact. When a
   * rebuild repacks the sheet, an old browser-cached PNG with new coordinates
   * draws unrelated sprites. Give every generated catalogue its own sheet URL.
   * The standalone bundle already embeds the exact PNG and needs no suffix.
   */
  function theorySheetUrl() {
    const bundle = window.ROTMG_BUNDLE;
    if (bundle && bundle.theorySheet) return bundle.theorySheet;
    const mark = data && (data.built || (data.from && data.from.build));
    return 'assets/theory/sheet.png'
      + (mark ? '?v=' + encodeURIComponent(mark) : '');
  }

  /*
   * Inherited CSS variables containing the embedded PNGs make Chrome's style
   * recalculation expensive when the search toggles inert or replaces results.
   * Keep the same bytes behind short URLs. These two sheets live as long as
   * this document; the browser releases their object URLs with the document.
   * Canvas loading and ordinary versioned HTTP sheet URLs stay unchanged.
   */
  const sheetStyleUrls = new Map();
  function sheetStyleUrl(source) {
    if (!source.startsWith('data:image/png;base64,')) return source;
    if (sheetStyleUrls.has(source)) return sheetStyleUrls.get(source);
    try {
      const binary = atob(source.slice('data:image/png;base64,'.length));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      sheetStyleUrls.set(source, url);
      return url;
    } catch (_) {
      // Preserve embedded images if object URLs are unavailable.
      return source;
    }
  }

  function theSheet() {
    let img = duel.art.get('sheet');
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = theorySheetUrl();
      duel.art.set('sheet', img);
    }
    return img;
  }

  const pieceOf = key => (key && data.sheet && data.sheet.pics[key]) || null;

  /*
   * A full set wears its own look, as it does on the set's Index card: the
   * skin the card extras give the set, side-on, standing and swinging, off
   * the skins sheet. Read once, the first time a fight is drawn; until then,
   * and for any build that is not one whole set, the class stands there.
   */
  let setLooks = null;
  const setFrames = new Map();
  function setLookOf(state) {
    if (setLooks === null) {
      setLooks = false;
      const read = window.RealmCardExtras && window.RealmCardExtras.read;
      if (read) {
        Promise.all([read('assets/index/projectiles.json'), read('assets/skins/generated/looks.json')])
          .then(([shots, looks]) => {
            const parsed = JSON.parse(looks);
            const img = new Image();
            img.decoding = 'async';
            img.src = window.RealmCardExtras.asset('assets/skins/textures/looks.png'
              + (parsed.built ? '?v=' + encodeURIComponent(parsed.built) : ''));
            setLooks = { sets: JSON.parse(shots).sets || {}, skins: parsed.skins || {}, img };
          })
          .catch(() => {});
      }
    }
    if (!setLooks || !state || !state.gear) return null;
    const names = HANDS.map(([hand]) => state.gear[hand] && state.gear[hand].name);
    const kit = (data.sets || []).find(set => names.every(name => name && set.pieces.includes(name)));
    const extra = kit && setLooks.sets['set:' + kit.name];
    const skin = extra && extra.skin && setLooks.skins[extra.skin];
    if (!skin) return null;
    if (!setFrames.has(kit.name)) {
      const idle = [], swing = [];
      for (const f of skin.frames) {
        if (f[2] !== 0) continue;
        const frame = { x: f[3], y: f[4], w: f[5], h: f[6] };
        if (f[1] === 0) idle.push(frame);
        else if (f[1] === 2) swing.push(frame);
      }
      setFrames.set(kit.name, { idle, swing, size: extra.skinSize || 100 });
    }
    const look = setFrames.get(kit.name);
    return look.idle.length ? Object.assign({ img: setLooks.img }, look) : null;
  }

  /*
   * Which frame of a thing to show. The registry files them by facing and
   * action - nought standing, one walking, two swinging - and which of them
   * plays when is web/sprite-animation.js's to say, as it is on the map and
   * on the Index cards. None of it is animation I wrote.
   */
  function frameOf(piece, doing, clock) {
    if (!piece) return 0;
    const poses = piece.poses;
    if (!poses) return piece.frames > 1 ? Math.floor(clock * 4) % piece.frames : 0;
    return SpriteAnimation.loopFrame(SpriteAnimation.framesOf(poses, 0, doing), clock, doing);
  }

  /*
   * The frame of a swing at a given moment of it, 0 at the shot and 1 when it
   * is over: the first frame as the shot leaves, the last as it ends.
   */
  function swingFrame(piece, progress) {
    if (!piece || !piece.poses) return 0;
    return SpriteAnimation.attackFrame(SpriteAnimation.framesOf(piece.poses, 0, 2), progress);
  }

  /*
   * One frame of a piece, stood on the floor at x.
   *
   * `tall` is the height it is drawn at - unless `fit` is set, when it is the
   * room the longest side of what the piece actually draws may fill. Targets
   * are drawn that way: their rectangle includes the swing, so filling the
   * rectangle leaves a small creature in a large empty box. The frame still
   * steps by the rectangle's own width, because that is how the frames are
   * packed.
   */
  function drawPiece(pen, piece, frame, x, y, tall, fit, inked = true) {
    const img = theSheet();
    if (!piece || !img.complete || !img.naturalWidth) return false;
    if (fit) {
      const box = targetFit(piece, tall, Array.isArray(fit) ? fit : null);
      inkedDraw(pen, img, piece.x + frame * piece.w + box.bounds.x, piece.y + box.bounds.y,
        box.bounds.w, box.bounds.h, x, y - box.height, box.width, box.height, inked);
      return true;
    }
    const wide = tall * (piece.w / piece.h);
    inkedDraw(pen, img, piece.x + frame * piece.w, piece.y, piece.w, piece.h,
      x, y - tall, wide, tall, inked);
    return true;
  }
  // Everyone and everything that flies wears the one outline every page lays on a character (web/outline.js).
  function inkedDraw(pen, img, sx, sy, sw, sh, dx, dy, dw, dh, inked) {
    if (inked && window.RealmOutline) window.RealmOutline.draw(pen, img, sx, sy, sw, sh, dx, dy, dw, dh);
    else pen.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function resetDuel() {
    const boss = data.byBoss[build.boss];
    duel.at = 0; duel.dealt = 0; duel.shots.length = 0; duel.fx.length = 0;
    duel.cool = 0; duel.spell = 0; duel.swing = 0; duel.swingFor = 0; duel.over = 0; duel.left = 0;
    duel.full = boss ? boss.hp : 0;
    duel.hp = duel.full;
    duel.bits.length = 0;
    // You walk in with a full pool, which is why the opening is faster than
    // the rest: the first few casts are paid for out of savings.
    const stats = statsOf(build);
    duel.mpFull = stats ? stats.now.mp : 0;
    duel.mp = duel.mpFull;
  }

  /* One frame of it, at whatever rate the browser is painting. */
  function stepDuel(delta) {
    const boss = data.byBoss[build.boss];
    if (!boss) return;
    // The fight is worked out with the same figures the page shows: its own and what the worn gear adds.
    const nums = numbersFor(build, boss.def);
    if (!nums) return;
    const mana = nums.regen.mp.combat;
    const weapon = data.byItem[(build.gear.weapon || {}).name];
    const ability = data.byItem[(build.gear.ability || {}).name];
    const effects = nums.effects, gun = nums.gun, spell = nums.spell;

    stepBits(delta);
    if (duel.hp <= 0) return;                 // it is over; nothing else moves
    duel.at += delta;

    /*
     * Kill time is DPS time, not projectile travel time. The shots below are
     * the visualisation of the weapon; their range and speed must not make a
     * target live longer simply because its sprite is drawn farther away.
     */
    // The damage the reader chose to count (weapon, ability or all pieces, at the low end of what is estimated).
    const dps = Math.max(0, nums.chosen);
    if (dps > 0) {
      const before = duel.hp;
      const hurt = dps * delta;

      if (hurt >= before) {
        const until = before / dps;
        duel.dealt += before;
        duel.hp = 0;
        duel.over = duel.at - delta + until;
        blowUp();
        return;
      }

      duel.hp = before - hurt;
      duel.dealt += hurt;
    }

    if (duel.swing > 0) duel.swing -= delta;

    if (gun.rate > 0) {
      duel.cool -= delta;
      if (duel.cool <= 0) {
        /*
         * In runs, where the weapon fires in runs. The shots inside one come
         * at the ordinary rate; the pause comes after the last of them.
         */
        if (gun.burst) {
          duel.left = duel.left > 0 ? duel.left - 1 : gun.burst.shots - 1;
          duel.cool += duel.left > 0 ? 1 / gun.rate : gun.burst.wait;
        } else {
          duel.cool += 1 / gun.rate;
        }
        // Held for the whole gap to the next shot, as the client holds it.
        SpriteAnimation.startAttack(duel, 0, 1 / gun.rate);
        loose(weapon, gun, true);
      }
    }
    /*
     * The ability goes as often as the magic allows (its own figure: whichever of the magic or its cooldown is slower),
     * and the bolts the worn pieces throw when you shoot come as often as the figures count them. Both are drawn;
     * the damage they do is already in the figure the target loses life by.
     */
    duel.mp = Math.min(duel.mpFull, duel.mp + mana * delta);
    if (spell.dps > 0 && spell.every > 0 && ability) {
      duel.spell -= delta;
      if (duel.spell <= 0) {
        duel.spell += spell.every;
        if (ability.shots && ability.shots.length) loose(ability, spell, false);
        // What it does that is not a bolt - a chain of lightning, a grenade, a nova - drawn as the client colours it.
        for (const part of ((gearOf(ability.name) || {}).ability || [])) {
          const how = FX_OF[part.kind];
          if (how && !part.meter) duel.fx.push({ how, color: part.color || FX_COLOUR[part.kind] || '#cfd8ff', age: 0, lasts: how === 'lob' ? 0.9 : 0.5, seed: Math.random() });
        }
      }
    }
    for (let i = duel.fx.length - 1; i >= 0; i--) { duel.fx[i].age += delta; if (duel.fx[i].age >= duel.fx[i].lasts) duel.fx.splice(i, 1); }
    for (const one of nums.special.list) {
      if (one.kind !== 'bullets' || !(Math.random() < one.goes * delta)) continue;
      loose({ pic: one.art }, { many: one.shots || 1, reach: one.reach || 6, fast: 12, each: 0 }, true);
    }

    /*
     * Each shot ages at its own rate.
     *
     * The bench used to move every shot across in a fifth of a second, which
     * made a Short Sword and a Sprite Wand look identical and threw away two
     * numbers the client states outright. A shot's flight takes its range
     * divided by its speed - a Short Sword's three and a half tiles at
     * fourteen a second is a quarter of a second, an Energy Staff's eight and
     * a half at eighteen is nearly half of one - and it lands when it arrives.
     * The damage is counted at the impact, not at the shot, so the total on
     * the frame follows what has actually hit.
     */
    for (let i = duel.shots.length - 1; i >= 0; i--) {
      const one = duel.shots[i];
      one.age += delta;
      if (one.age < one.lasts) continue;
      duel.shots.splice(i, 1);
    }
    /*
     * And once it is down it stays down. The time it took is the answer to
     * the question the frame was asked, and a frame that clears itself two
     * seconds later is one that hides its own answer; the fight starts again
     * when somebody asks it to.
     */
  }

  /*
   * Letting a volley go.
   *
   * Everything a shot needs is settled here and carried with it: the picture
   * it is drawn from, how long it is in the air, the angle it left at. Read
   * back off the current gear while drawing, a shot already in flight would
   * change its face the moment you swapped weapons mid-fight.
   *
   * The angles are the item's own. A weapon states an arc gap in degrees
   * between the shots of a volley; an ability that throws eight or more is a
   * nova and divides the circle. Parallel lanes were a stand-in for both and
   * looked like neither.
   */
  function loose(item, rate, mine) {
    const stand = standOf(build);
    const shot = (item && item.shots && item.shots[0]) || {};
    const bolt = pieceOf(item && item.pic);
    const channels = item && item.shots ? item.shots.filter(one => one.subattack) : [];
    // Each shot that leaves: the way it points, how far it flies and how fast. A weapon built of channels (a flail's
    // anvil and its chain) throws one of each, all along the same line; the rest throw their count fanned or round.
    const out = [];
    if (channels.length) {
      for (const one of channels) {
        for (let n = 0; n < (one.many || 1); n++) out.push({ angle: 0, reach: one.reach || 6, fast: one.fast || 8, amp: one.amp, freq: one.freq });
      }
    } else {
      const many = Math.max(1, rate.many || 1);
      const reach = rate.reach || shot.reach || 6;
      const fast = rate.fast || shot.fast || 8;
      const round = many >= 8 && !mine;
      const fan = (item && item.fan !== undefined ? item.fan : 12) * Math.PI / 180;
      for (let n = 0; n < many; n++) {
        out.push({
          angle: round ? (n / many) * Math.PI * 2 : (many === 1 ? 0 : (n - (many - 1) / 2) * fan),
          reach, fast, amp: shot.amp, freq: shot.freq, phase: (n % 2) ? Math.PI : 0
        });
      }
    }
    for (const one of out) {
      /*
       * Does it touch the target? Its line passes the target's middle at distance times tan(angle); if that is within
       * the target's radius, and it flies far enough, it lands and is gone there. Otherwise it goes on past.
       */
      const turned = Math.abs(((one.angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      // On the target every shot lands, and one that turns as it flies comes round to it: both are drawn straight at it.
      const curves = Boolean(item && (gearOf(item.name) || {}).curves);
      const lands = reaches(one.reach, stand)
        && (!(stand.d > 0) || curves || (turned < Math.PI / 2 && stand.d * Math.tan(turned) <= stand.radius));
      if (lands && (!(stand.d > 0) || curves)) { one.angle = 0; one.reach = Math.max(one.reach, stand.gap); }
      const aimed = lands && (!(stand.d > 0) || curves) ? 0 : turned;
      const travel = lands ? Math.min(one.reach, Math.max(0.6, stand.gap / Math.max(0.2, Math.cos(aimed)))) : one.reach;
      // A shot that lands on a target it stands next to would be gone in a few frames; it is slowed to be seen arriving.
      const lasts = Math.max(lands ? 0.14 : 0.05, travel / one.fast);
      duel.shots.push({
        age: 0,
        lasts,
        angle: one.angle,
        hit: lands,
        fast: lands ? travel / lasts : one.fast,
        hurt: rate.each,
        mine, bolt,
        spin: bolt && bolt.spin ? bolt.spin : 0,
        tilt: bolt && bolt.tilt ? bolt.tilt : 0,
        // How it weaves, if it does: the client gives an amplitude in tiles and a frequency.
        amp: one.amp || 0,
        freq: one.freq || 0,
        phase: one.phase || 0,
        reach: one.reach
      });
    }
  }

  /*
   * What an ability does that has no bolt to draw, in the colour the client gives it: lightning is a jagged line to the target,
   * a grenade or a trap is lobbed and leaves a cloud, a nova or a blast is a ring that opens. Only for the eye; the damage is
   * already in the figure the target loses life by.
   */
  function drawAbilityFx(pen, from, to, y, side) {
    for (const one of duel.fx) {
      const t = Math.min(1, one.age / one.lasts);
      pen.save();
      pen.strokeStyle = one.color; pen.fillStyle = one.color; pen.lineWidth = 2;
      pen.globalAlpha = 1 - t * 0.85;
      if (one.how === 'zap') {
        pen.beginPath(); pen.moveTo(from, y);
        const steps = 9;
        for (let i = 1; i <= steps; i++) {
          const jag = (Math.sin(one.seed * 40 + i * 7.3) * 0.5 + Math.sin(i * 12.9 + one.seed * 90) * 0.5) * side * 0.18;
          pen.lineTo(from + (to - from) * i / steps, y + (i === steps ? 0 : jag));
        }
        pen.stroke();
      } else if (one.how === 'lob' || one.how === 'cloud') {
        const flight = one.how === 'lob' ? 0.35 : 0.3;
        if (t < flight) {
          const u = t / flight, x = from + (to - from) * u;
          pen.beginPath(); pen.arc(x, y - Math.sin(u * Math.PI) * side * 0.5, 4, 0, Math.PI * 2); pen.fill();
        } else {
          const u = (t - flight) / (1 - flight);
          pen.globalAlpha = 0.45 * (1 - u);
          pen.beginPath(); pen.arc(to, y, side * (0.25 + 0.35 * u), 0, Math.PI * 2); pen.fill();
        }
      } else if (one.how === 'boom') {
        pen.beginPath(); pen.arc(to, y, side * (0.15 + 0.7 * t), 0, Math.PI * 2); pen.stroke();
      } else {
        pen.beginPath(); pen.arc(from, y, side * (0.2 + 1.1 * t), 0, Math.PI * 2); pen.stroke();
      }
      pen.restore();
      pen.beginPath();                    // the shapes above must not stay in the path the bars are filled from
    }
  }

  /*
   * It comes apart when it dies. Watching a life bar reach nought is a fact;
   * watching the thing burst is the same fact and reads as a kill, which is
   * the whole reason this frame is here rather than another row of figures.
   */
  function blowUp() {
    duel.bits.length = 0;
    for (let i = 0; i < 34; i++) {
      const angle = Math.random() * Math.PI * 2;
      const fast = 30 + Math.random() * 130;
      duel.bits.push({
        x: 0, y: 0, vx: Math.cos(angle) * fast, vy: Math.sin(angle) * fast - 40,
        left: 0.5 + Math.random() * 0.5, full: 1
      });
    }
  }

  function stepBits(delta) {
    for (let i = duel.bits.length - 1; i >= 0; i--) {
      const one = duel.bits[i];
      one.x += one.vx * delta;
      one.y += one.vy * delta;
      one.vy += 260 * delta;
      one.left -= delta;
      if (one.left <= 0) duel.bits.splice(i, 1);
    }
  }

  /*
   * PERF:
   * drawDuel runs on every animation frame. Canvas CSS geometry changes only
   * when layout changes, so ResizeObserver owns that measurement instead of
   * clientWidth/clientHeight forcing the question every frame.
   */
  let duelMeasureCanvas = null;
  let duelMeasureObserver = null;
  let duelMeasure = null;

  /*
   * The ground the two of them stand on: a band of floor under their feet, tiled
   * as the game's own ground is, with the line where it starts and a few stones.
   * Drawn once for a size and kept; the frame blits it.
   */
  const duelGround = { key: '', canvas: null };
  function groundOf(wide, tall, dpr, k, floor) {
    const key = [wide, tall, dpr, k, floor].join('|');
    if (duelGround.key === key && duelGround.canvas) return duelGround.canvas;
    const c = duelGround.canvas || (duelGround.canvas = document.createElement('canvas'));
    c.width = Math.round(wide * dpr); c.height = Math.round(tall * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, wide, tall);
    g.imageSmoothingEnabled = false;
    const tile = 30 * k, y0 = Math.round(floor);
    const shade = g.createLinearGradient(0, y0, 0, tall);
    shade.addColorStop(0, 'rgba(98, 82, 60, .34)');
    shade.addColorStop(1, 'rgba(34, 28, 22, .5)');
    g.fillStyle = shade;
    g.fillRect(0, y0, wide, tall - y0);
    // The tiles, in the two shades the client's ground alternates between.
    g.fillStyle = 'rgba(255, 255, 255, .035)';
    for (let row = 0; y0 + row * tile < tall; row++) {
      for (let col = -1; col * tile < wide; col++) {
        if ((row + col) % 2) g.fillRect(col * tile + (row % 2 ? tile / 2 : 0), y0 + row * tile, tile, tile);
      }
    }
    g.fillStyle = 'rgba(255, 255, 255, .16)';
    g.fillRect(0, y0, wide, Math.max(1, Math.round(k)));
    // A few stones, always in the same places.
    let seed = 2463534242;
    const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < Math.round(wide / (46 * k)); i++) {
      const x = Math.round(next() * wide), y = y0 + Math.round((0.15 + next() * 0.8) * (tall - y0)), size = Math.max(2, Math.round((2 + next() * 3) * k));
      g.fillStyle = 'rgba(190, 170, 140, .22)';
      g.fillRect(x, y, size * 1.5, size);
      g.fillStyle = 'rgba(0, 0, 0, .3)';
      g.fillRect(x, y + size, size * 1.5, Math.max(1, Math.round(k * 0.7)));
    }
    duelGround.key = key;
    return c;
  }

  // A filled bar with round ends. The bars used to call round(), which is the
  // number rounder, so they drew nothing at all.
  function pill(pen, x, y, w, h, r) {
    pen.beginPath();
    if (pen.roundRect) pen.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    else pen.rect(x, y, w, h);
    pen.fill();
  }

  function drawDuel() {
    const canvas = el('tcDuel');
    if (!canvas) return;
    if (
      canvas !== duelMeasureCanvas
    ) {
      if (duelMeasureObserver) {
        duelMeasureObserver.disconnect();
      }

      duelMeasureCanvas =
        canvas;

      duelMeasure = {
        wide:
          canvas.clientWidth
          || 320,
        tall:
          canvas.clientHeight
          || 150
      };

      duelMeasureObserver = null;

      if (
        typeof ResizeObserver === 'function'
      ) {
        duelMeasureObserver =
          new ResizeObserver(
            entries => {
              const entry =
                entries[0];

              if (!entry) return;

              const rect =
                entry.contentRect;

              if (rect.width > 0) {
                duelMeasure.wide =
                  Math.max(
                    1,
                    Math.round(rect.width)
                  );
              }

              if (rect.height > 0) {
                duelMeasure.tall =
                  Math.max(
                    1,
                    Math.round(rect.height)
                  );
              }
            }
          );

        duelMeasureObserver.observe(
          canvas
        );
      }
    }

    /*
     * Old browsers keep the previous behaviour. Modern browsers read the
     * cached ResizeObserver geometry.
     */
    const wide =
      duelMeasureObserver
        ? duelMeasure.wide
        : canvas.clientWidth || 320;

    const tall =
      duelMeasureObserver
        ? duelMeasure.tall
        : canvas.clientHeight || 150;
    const dpr = window.devicePixelRatio || 1;
    // Its box can grow taller without growing wider, so both are checked.
    if (canvas.width !== Math.round(wide * dpr) || canvas.height !== Math.round(tall * dpr)) {
      canvas.width = Math.round(wide * dpr);
      canvas.height = Math.round(tall * dpr);
    }
    const pen = canvas.getContext('2d');
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, wide, tall);
    pen.imageSmoothingEnabled = false;

    const kind = data.byClass[build.klass];
    const boss = data.byBoss[build.boss];
    /*
     * How large the bench is drawn: the frame it is given, not a fixed size.
     * Every length below was written for a frame about 170 tall and 480 wide;
     * a bigger frame draws the same bench larger - the fighters, the floor,
     * a tile, the writing - rather than the same small figures in more dark.
     * Only the drawing changes: the fight itself runs on seconds and tiles.
     */
    const k = Math.max(1, Math.min(2.4, tall / 170, wide / 480));
    /*
     * The two figures may grow with the frame's height even where its width
     * keeps the tiles small: a half-page card is tall and narrow, and drew
     * two small figures at the bottom of a frame of dark.
     */
    const kFig = Math.max(k, Math.min(2.4, tall / 200, wide / 330));
    // The writing grows more gently than the figures: it is read, not seen.
    const say = Math.min(kFig, 1.6);
    // The target's life, over its head: a line of figures and a bar.
    const barH = Math.round(5 * say), hud = Math.round(11 * say + 5 * say + barH + 7 * say);
    const groundLeast = 30 * k;

    const PX_TILE = 30 * k;
    const piece = pieceOf(boss && boss.pic);
    const room = Math.max(24, Math.min(88 * kFig, tall * 0.6, tall - groundLeast - hud - 10 * say));
    // The room goes to what the target draws, not to the rectangle that
    // carries its swing - see targetFit. A piece with no measured window
    // measures as its rectangle, which is what it always was.
    const targetRun = piece ? targetFrames(piece) : null;
    const fit = piece ? targetFit(piece, room, targetRun) : null;
    const big = fit ? fit.height : room;
    const across = fit ? fit.width : room;
    /*
     * The floor where the scene - the target, its life over its head - sits
     * in the middle of the frame, with as much ground under it as dark above,
     * and never less ground than a strip.
     */
    const floor = Math.round(Math.min(tall - groundLeast, Math.max(big + hud + 6 * say, (tall + big + hud) / 2)));
    pen.drawImage(groundOf(wide, tall, dpr, k, floor), 0, 0, wide, tall);
    const me = pieceOf((kind && kind.pic) || '');
    const side = Math.min(52 * kFig, tall * 0.4);
    const mine = me ? side * (me.w / Math.max(1, me.h)) : side * 0.6;
    /*
     * Where they stand is the chosen numeric distance from the target's middle, from zero to ten tiles.
     * A tile is thirty pixels unless the frame is too
     * narrow for that, and every length below - shots, reach - is drawn at the same scale, so what passes a target and
     * what reaches it can be seen.
     */
    const stand = standOf(build);
    const dist = Math.max(stand.d, stand.radius);
    const tilePx = Math.max(8, Math.min(PX_TILE, (wide - mine - across * 0.5 - 44) / Math.max(dist, 1)));
    const bossX = wide - across - 14 * k;
    const left = Math.max(6, bossX + across / 2 - dist * tilePx - mine * 0.9);

    /* The one on the left, in whichever pose it is in - in its set's look if it wears a whole one. */
    const look = setLookOf(build);
    if (look && look.img.complete && look.img.naturalWidth) {
      const swinging = duel.swing > 0 && duel.swingFor > 0 && look.swing.length;
      const f = swinging
        ? SpriteAnimation.attackFrame(look.swing, 1 - duel.swing / duel.swingFor)
        : SpriteAnimation.loopFrame(look.idle, duel.at, 0);
      const z = side / 8 * look.size / 100;
      if (f) inkedDraw(pen, look.img, f.x, f.y, f.w, f.h, left, floor - f.h * z, f.w * z, f.h * z, true);
    } else if (me) {
      drawPiece(pen, me, duel.swing > 0 && duel.swingFor > 0
        ? swingFrame(me, 1 - duel.swing / duel.swingFor) : frameOf(me, 0, duel.at),
        left, floor, side);
    } else {
      pen.fillStyle = '#6f8fbf';
      pen.fillRect(left, floor - side, side * 0.6, side);
    }

    /* And the thing being hit, on the right, in its own animation. */
    /*
     * Every target the same size, whatever the client says it is.
     *
     * On the map a declared size matters: a spider says fifty and is half its
     * picture, a god says a hundred and fifty, and the difference is the
     * point. Here it is only noise - this frame is a test bench, and a bench
     * that draws one dummy at twice another makes two builds look different
     * when only the dummy changed. So the longest side of whatever is being
     * hit is always the same number of pixels, and the thing's own
     * proportions are kept inside that: a wide creature stays wide without
     * ending up bigger than a tall one.
     */
    /*
     * It stands still and stays still.
     *
     * Two things were making it jump. Switching to its attack pose whenever a
     * shot landed swapped in a different drawing, often a different size, for
     * a frame at a time - and a random shake on top of that moved it again
     * every time the screen was painted. A thing being shot at should flinch,
     * not teleport, so it keeps its own idle animation throughout and the hit
     * shows as a flash instead.
     */
    const struck = duel.hp > 0 && duel.shots.some(s => s.hit && s.age > s.lasts * 0.86);
    pen.globalAlpha = duel.hp > 0 ? 1 : 0.22;
    const drew = drawPiece(pen, piece, targetFrame(piece, duel.at), bossX, floor, room, targetRun);
    if (drew && struck) {
      pen.globalAlpha = 0.35;
      pen.fillStyle = '#fff';
      pen.globalCompositeOperation = 'lighter';
      drawPiece(pen, piece, targetFrame(piece, duel.at), bossX, floor, room, targetRun);
      pen.globalCompositeOperation = 'source-over';
    }
    if (!drew) {
      pen.fillStyle = duel.hp > 0 ? '#8a5a5a' : 'rgba(138,90,90,.25)';
      pen.fillRect(bossX, floor - big, across, big);
    }
    pen.globalAlpha = 1;

    /*
     * And what is in the air between them.
     *
     * Everything a shot needs was settled when it was let go and travels with
     * it - its picture, how long it is in the air, the angle it left at - so
     * a shot already in flight keeps its face when the gear underneath it
     * changes.
     *
     * Each is turned once, as a whole bitmap: to the direction it is
     * travelling, plus the eighth-turns of angle correction the client puts
     * on that projectile, plus whatever it has spun in its own lifetime if it
     * is a spinner. Turning the bitmap rather than drawing a line beside it
     * means the black outline the art already carries turns with the colour.
     */
    const from = left + mine * 0.9, to = bossX + across / 2;
    drawAbilityFx(pen, from, to, floor - side * 0.55, side);
    for (const one of duel.shots) {
      // How far it has flown, at the scale of the floor.
      const along = one.age * one.fast * tilePx;
      /*
       * Across its own line, if it weaves. The offset is perpendicular to the
       * direction of travel, in tiles converted to the width of the bench, so
       * a half-tile amplitude looks like half a tile of the range it covers.
       */
      const sway = one.amp
        ? one.amp * tilePx * Math.sin(2 * Math.PI * one.freq * one.age + one.phase)
        : 0;
      const x = from + Math.cos(one.angle) * along - Math.sin(one.angle) * sway;
      const y = floor - side * 0.55 + Math.sin(one.angle) * along
        + Math.cos(one.angle) * sway;
      const bolt = one.bolt;
      if (bolt) {
        /*
         * As big as the client says, at the scale of this floor.
         *
         * The bolt used to be given a height of sixteen pixels and a width
         * from its proportions, which is fine for a round missile and absurd
         * for a blade: the dagger's projectile is eight pixels by one, so
         * sixteen tall made it a hundred and twenty-eight long - a grey bar
         * across the whole bench. A texture is eight pixels to the tile, and
         * a tile here is thirty, so the drawing is simply that, scaled by the
         * size the client gives the projectile.
         */
        const per = (PX_TILE / 8) * Math.min(2, Math.max(0.5, bolt.size / 100));
        const high = Math.max(2, bolt.h * per);
        const wide = high * (bolt.w / bolt.h);
        const frame = bolt.frames > 1
          ? Math.floor(one.age * 14) % bolt.frames : 0;
        const facing = one.angle + one.tilt * Math.PI / 4
          + (one.spin ? (one.age * 1000) / one.spin : 0);
        pen.save();
        pen.translate(x, y);
        pen.rotate(facing);
        const drew = drawPiece(pen, bolt, frame, -wide / 2, high / 2, high, false);
        pen.restore();
        if (drew) continue;
      }
      pen.strokeStyle = one.mine ? 'rgba(255,238,190,.95)' : 'rgba(140,190,240,.95)';
      pen.lineWidth = 2;
      pen.beginPath();
      pen.moveTo(x - Math.cos(one.angle) * 9, y - Math.sin(one.angle) * 9);
      pen.lineTo(x, y);
      pen.stroke();
    }

    /*
     * The thing's life, over its head, the way the game draws it: a bar the
     * width of the target, and what it has left written above the bar. It was
     * a bar across the whole floor with its figures under the target's feet,
     * where they ran into the picture.
     */
    const part = duel.full ? Math.max(0, duel.hp / duel.full) : 0;
    const middle = bossX + across / 2;
    const barW = Math.min(wide * 0.5, Math.max(across * 1.05, 96 * say));
    const barX = Math.max(8, Math.min(wide - 8 - barW, middle - barW / 2));
    const barY = floor - big - 7 * say - barH;
    pen.fillStyle = 'rgba(0,0,0,.45)';
    pill(pen, barX - 1, barY - 1, barW + 2, barH + 2, (barH + 2) / 2);
    pen.fillStyle = 'rgba(255,255,255,.1)';
    pill(pen, barX, barY, barW, barH, barH / 2);
    if (part > 0) {
      pen.fillStyle = part > 0.35 ? '#8fd08a' : '#d4685f';
      pill(pen, barX, barY, Math.max(barH, barW * part), barH, barH / 2);
    }

    /* And the magic left, which is what paces the ability - over the
       character's head, since it is the character's. */
    if (duel.mpFull && build.using !== 'gun') {
      const full = Math.max(0, Math.min(1, duel.mp / duel.mpFull));
      const mpW = Math.max(24 * say, side * 0.8), mpH = Math.max(3, Math.round(3 * say));
      const mpX = Math.max(4, left + side / 2 - mpW / 2), mpY = floor - side - 6 * say - mpH;
      pen.fillStyle = 'rgba(255,255,255,.1)';
      pill(pen, mpX, mpY, mpW, mpH, mpH / 2);
      pen.fillStyle = '#5b8cd9';
      pill(pen, mpX, mpY, Math.max(0, mpW * full), mpH, mpH / 2);
    }

    /* Whatever is left of it, on its way outward. */
    if (duel.bits.length) {
      for (const one of duel.bits) {
        pen.globalAlpha = Math.max(0, one.left / one.full);
        pen.fillStyle = one.left > 0.6 ? '#fff2cf' : '#e0a13a';
        pen.fillRect(middle + one.x * k, floor - big / 2 + one.y * k, 3 * k, 3 * k);
      }
      pen.globalAlpha = 1;
    }

    /*
     * Whose number is whose. The life left was drawn at the left edge, under
     * the character, where it read as something about the character - it is
     * the target's, so it is written under the target, and the clock and the
     * running total sit on the other side where the fight is being counted
     * rather than suffered.
     */
    const small = Math.round(11 * say) + 'px ui-monospace, monospace';
    const edge = 12 * say;
    pen.font = small;
    pen.textAlign = 'right';
    const lifeSaid = commas(duel.hp) + ' / ' + commas(duel.full);
    const textY = barY - 5 * say;
    pen.fillStyle = 'rgba(255,255,255,.82)';
    pen.fillText(lifeSaid, barX + barW, textY);
    /*
     * And what it is wearing, beside what it has left. Every number under
     * this frame is read against that armour - it is subtracted from each
     * shot before anything else happens - so a frame that shows the life and
     * hides the armour shows half of what decides the fight.
     */
    if (boss) {
      pen.fillStyle = 'rgba(255,255,255,.5)';
      pen.fillText(boss.def + ' armour · ', barX + barW - pen.measureText(lifeSaid).width, textY);
    }
    /* The clock and the running total, in the corner, away from both. */
    pen.textAlign = 'left';
    pen.fillStyle = 'rgba(255,255,255,.62)';
    pen.fillText(round(duel.at) + 's · ' + commas(duel.dealt) + ' dealt', edge, edge + 9 * say);

    /* And how long it took, said once and said large. */
    if (duel.hp <= 0) {
      const loud = '600 ' + Math.round(20 * say) + 'px ui-monospace, monospace';
      const head = 'dead in ' + round(duel.over) + 's', foot = commas(duel.dealt) + ' damage';
      const deadY = floor - big * 0.55;
      // On a plate of its own, since it is written over the scene.
      pen.font = loud;
      const plateW = pen.measureText(head).width + 28 * say;
      pen.fillStyle = 'rgba(8,8,14,.78)';
      pill(pen, wide / 2 - plateW / 2, deadY - 22 * say, plateW, 44 * say, 8 * say);
      pen.textAlign = 'center';
      pen.fillStyle = '#f0c274';
      pen.fillText(head, wide / 2, deadY);
      pen.font = small;
      pen.fillStyle = 'rgba(255,255,255,.6)';
      pen.fillText(foot, wide / 2, deadY + 15 * say);
      pen.textAlign = 'left';
    }
  }

  let painting = false;
  function keepPainting() {
    if (painting || !theoryOpen()) return;
    painting = true;

    let was =
      performance.now();

    let duelDrawnAt =
      -1e9;

    const DUEL_FRAME_MIN_MS =
      1000 / 72;

    const tick = now => {
      if (!theoryOpen()) {
        painting = false;
        return;
      }

      if (
        now - duelDrawnAt
        < DUEL_FRAME_MIN_MS
      ) {
        requestAnimationFrame(
          tick
        );

        return;
      }

      duelDrawnAt =
        now;

      const delta =
        Math.min(
          0.05,
          (now - was) / 1000
        );

      was =
        now;

      if (
        duel.on
        && data
        && build
      ) {
        stepDuel(delta);
        drawDuel();
      }

      requestAnimationFrame(
        tick
      );
    };

    requestAnimationFrame(
      tick
    );
  }

  /* ---------------- pickers ---------------- */

  function openItems(hand) {
    picking = { kind: 'item', hand };
    const list = compatibleItemsFor(hand, build.klass);
    show('Choose a ' + hand, list.map(one => {
      const gun = one.shots && one.shots[0];
      const bits = [];
      if (one.tier !== undefined) bits.push('T' + one.tier);
      if (gun) bits.push(gun.low + '–' + gun.high);
      if (one.many > 1) bits.push('×' + one.many);
      if (one.mp) bits.push(one.mp + ' MP');
      if (one.worn) {
        for (const t of Object.keys(one.worn)) bits.push(plus(one.worn[t]) + ' ' + t);
      }
      for (const part of one.share || []) {
        bits.push(plus(part.pct) + '% of ' + part.of
          + (part.of === part.stat ? '' : ' as ' + part.stat));
      }
      const aliases = itemSearchAliases.get(one.name) || [];
      const outside = !!(profile && profile.mode === 'personal'
        && !accessible(one.name));
      return {
        id: one.name,
        name: one.name,
        says: bits.join(' · '),
        search: [one.name, ...aliases, bits.join(' ')].join(' '),
        note: outside ? 'outside progression' : '',
        art: true,
        ban: true,
        own: true
      };
    }), 'nothing');
  }

  function openEnchants(hand, at) {
    picking = { kind: 'ench', hand, at };
    const worn = build.gear[hand];
    if (!worn.name) return;

    /*
     * The calculator's own dialogue, where it exists. It already shows an
     * enchantment the way this project shows one - the icon, the sentence,
     * the labels it gives and the labels it refuses, its weight - and two
     * dialogues for the same job would have drifted apart inside a month.
     */
    const held = rulesFor();
    if (held && typeof window.openEnchantPicker === 'function') {
      const item = data.byItem[worn.name];
      const locks = locksOn(held, worn.ench, at);
      const pool = EnchantEngine.obtainablePool(held, {
        item: worn.name,
        type: OF_HAND[item.hand] || 'WEAPON',
        slots: worn.slots,
        locks,
        subtypes: EnchantEngine.subtypesForItem(held, worn.name)
      });
      const opened = window.openEnchantPicker({
        title: 'Slot ' + (at + 1) + ' · ' + worn.name,
        sub: pool.length + ' available'
          + (locks.length ? ' · ' + locks.length + ' removed by the other slots' : ''),
        candidates: pool,
        onPick: name => {
          const mine = charmNamed(name);
          build.gear[hand].ench[at] = mine ? mine.id : null;
          picking = null;
          keep();
          paint();
        }
      });
      if (opened) return;
    }

    /*
     * One line per thing, not one per record. The client keeps a separate
     * enchantment for each item an effect can land on, so a picker built
     * straight off the list showed "Adonis' Shot, +3 ATT" a dozen times in a
     * row. Anything that reads the same and does the same is the same as far
     * as a person choosing one is concerned.
     */
    const seen = new Set();
    const list = enchantsFor(worn.name, worn.ench, at).filter(one => {
      const same = one.name + '|' + JSON.stringify(one.worn || 0) + '|' + (one.alters || '');
      if (seen.has(same)) return false;
      seen.add(same);
      return true;
    });
    show('Enchantment for ' + esc(worn.name), list.map(one => ({
      id: one.id,
      pic: one.pic,
      name: one.name,
      says: one.worn
        ? Object.keys(one.worn).map(t => plus(one.worn[t]) + ' ' + t).join(' · ')
        : shortly(one.says),
      note: (() => {
        const via = held && EnchantEngine.engravingsFor(held, one)[0];
        return via ? 'only through the ' + via : undefined;
      })(),
      counted: !!one.worn
    })), 'empty slot');
  }

  function show(title, rows, clearSay) {
    const box = el('tcPicker');
    el('tcPickerTitle').textContent = title;
    el('tcSearch').value = '';
    box.dataset.rows = JSON.stringify(rows);
    paintPicker(rows, clearSay);
    el('tcPickerWrap').hidden = false;
    el('tcSearch').focus();
  }

  function paintPicker(rows, clearSay) {
    const box = el('tcPicker');
    const out = ['<button type="button" class="tc-row" data-choose="">'
      + '<span class="tc-icon-big"></span><b>' + esc(clearSay || 'nothing')
      + '</b></button>'];
    /*
     * A first handful, not the lot. A thousand rows is a second of work
     * before anything appears, and nobody reads past the first screen anyway
     * - the search box is how you get to the rest.
     */
    for (const one of rows.slice(0, 120)) {
      const mine = !!(one.own && build.owned && build.owned[one.id]);
      out.push((one.ban
        ? '<span class="tc-row-pair"><button type="button" class="tc-ban" data-ban="'
          + esc(one.id) + '" title="Set this aside - the search will not offer it">'
          + '⊘</button>'
          + (one.own
            ? '<button type="button" class="tc-own" data-own="' + esc(one.id) + '" aria-pressed="' + mine
              + '" title="' + (mine ? 'One of my items - click to unmark it' : 'I have this - compare it with my other items') + '">'
              + (mine ? '★' : '☆') + '</button>'
            : '')
        : '')
        + '<button type="button" class="tc-row" data-choose="' + esc(one.id) + '">'
        + (one.art ? itemIcon(one.id)
          : (one.pic ? sheetIcon(one.pic, 26, 'tc-charm-row') : '<span class="tc-icon-big"></span>'))
        + '<b>' + esc(one.name) + '</b>'
        + '<u>' + esc(one.says || '') + '</u>'
        + (one.note ? '<em class="tc-uncounted">' + esc(one.note) + '</em>' : '')
        + (one.counted === false ? '<em class="tc-uncounted">not counted</em>' : '')
        + '</button>' + (one.ban ? '</span>' : ''));
    }
    if (rows.length > 120) {
      out.push('<p class="tc-more">' + (rows.length - 120)
        + ' more — type to narrow it down</p>');
    }
    box.innerHTML = out.join('');
  }

  function shutPicker() { el('tcPickerWrap').hidden = true; picking = null; }

  function chose(id) {
    if (!picking) return;
    if (picking.kind === 'item') {
      const worn = build.gear[picking.hand];
      worn.name = id || null;
      // What no longer fits comes off, rather than being counted anyway.
      worn.ench = worn.ench.map((was, i) =>
        (was && id && enchantsFor(id, worn.ench, i).some(e => e.id === was)) ? was : null);
    } else {
      build.gear[picking.hand].ench[picking.at] = id || null;
    }
    shutPicker();
    keep();
    paint();
  }

  /* ---------------- a build, carried between the tools ---------------- */
  /*
   * A build is a thing you want to show somebody, or take to the other tool,
   * and neither is possible while it lives only in this browser's storage. So
   * it goes in the address: the four items, what is on them, the class, what
   * is being fought, and nothing else - no damage figure, no cost, nothing
   * calculated. Whoever opens the link works it out again from the same
   * declarations, which is the only way two tools can agree.
   *
   * Plain JSON in base64url. Not a secret, not signed, and never executed:
   * every name in it is looked up in the catalogue and dropped if it is not
   * there, so a link from a different build of the site degrades to whatever
   * it can still resolve rather than to an error.
   */
  const SHARE_V = 1;

  function packBuild(state) {
    const gear = HANDS.map(([hand]) => {
      const worn = state.gear[hand] || {};
      if (!worn.name) return null;
      return [worn.name, (worn.ench || []).map(id => {
        const one = id && data.byEnch[id];
        return one ? one.name : null;
      })];
    });
    const say = {
      v: SHARE_V, k: state.klass, g: gear, t: state.boss,
      r: distanceOf(state),
      m: state.maxed ? 1 : 0, e: state.exalt ? 1 : 0
    };
    const raw = JSON.stringify(say);
    // Base64url: an address can carry it, and nothing in it needs escaping.
    return btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unpackBuild(token) {
    let said = null;
    try {
      const raw = decodeURIComponent(escape(atob(
        String(token).replace(/-/g, '+').replace(/_/g, '/'))));
      said = JSON.parse(raw);
    } catch (e) { return null; }
    if (!said || said.v !== SHARE_V || !data.byClass[said.k]) return null;
    const start = fresh(said.k);
    start.range = normaliseDistance(said.r);
    start.maxed = said.m !== 0;
    start.exalt = said.e !== 0;
    if (data.byBoss[said.t]) start.boss = said.t;
    HANDS.forEach(([hand], i) => {
      const one = (said.g || [])[i];
      if (!one || !data.byItem[one[0]]) return;
      start.gear[hand] = {
        name: one[0],
        slots: 4,
        ench: [0, 1, 2, 3].map(at => {
          const name = (one[1] || [])[at];
          const found = name && data.enchants.find(e => e.name === name);
          return found ? found.id : null;
        })
      };
    });
    start.name = data.byClass[said.k].name + ' build';
    return start;
  }

  /* Whatever build the address is carrying, if it is carrying one. */
  function buildFromAddress() {
    const at = String(location.hash || '').indexOf('build=');
    if (at < 0) return null;
    const token = String(location.hash).slice(at + 6).split('&')[0];
    return token ? unpackBuild(token) : null;
  }

  /* ---------------- tabs, kept the way the enchanter keeps them ---------------- */

  const STORE = 'rotmg.theorycraft.v1';

  function keep() {
    build.range = distanceOf(build);
    tabs[onTab] = build;
    try {
      localStorage.setItem(STORE, JSON.stringify({ tabs, onTab }));
    } catch (e) { /* a private window, or storage turned off */ }
  }

  function recall() {
    try {
      const was = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (was && Array.isArray(was.tabs) && was.tabs.length) {
        tabs = was.tabs.map(one => ({ ...one, range: distanceOf(one) }));
        onTab = Math.min(was.onTab || 0, tabs.length - 1);
        return true;
      }
    } catch (e) { /* nothing remembered */ }
    return false;
  }

  function drawTabs() {
    const box = el('tcTabs');
    if (!box) return;
    box.innerHTML = tabs.map((one, i) =>
      '<button type="button" role="tab" class="tab' + (i === onTab ? ' is-active' : '')
      + '" data-tab="' + i + '">' + esc(one.name)
      + (tabs.length > 1 ? '<u data-shut="' + i + '">×</u>' : '')
      + '</button>').join('')
      + '<button type="button" class="tab tab-new" data-tab="new" title="Start from a blank build">+ New</button>'
      + '<button type="button" class="tab tab-new" data-tab="copy" title="Copy the build on screen into a new tab">⧉ Duplicate</button>';
  }

  /* ---------------- putting it on the screen ---------------- */

  /*
   * A class frame may be wider than its body.  The static portrait is a
   * square window at that frame's leading edge, not a centred crop: the
   * sheet's frame stride still includes the whole source-frame width.
   */
  function facePortrait(kind, sheet) {
    const piece = kind && sheet && sheet.pics[kind.pic];
    if (!piece) return null;
    const stand = (piece.poses
      && (piece.poses['3/0'] || piece.poses['0/0']) || [0])[0];
    return {
      x: piece.x + stand * piece.w,
      y: piece.y,
      bodyW: Math.min(piece.w, piece.h),
      h: piece.h,
      zoom: 42 / piece.h,
      pad: 0
    };
  }

  function faceStyle(portrait, sheet) {
    if (!portrait || !sheet) return null;
    const { x, y, bodyW, h, zoom, pad } = portrait;
    return {
      width: (bodyW * zoom) + 'px',
      height: (h * zoom) + 'px',
      backgroundSize: (sheet.wide * zoom) + 'px ' + (sheet.tall * zoom) + 'px',
      backgroundPosition: (-(x + pad) * zoom) + 'px ' + (-y * zoom) + 'px'
    };
  }

  function paint() {
    const kind = el('tcClass');
    if (kind && kind.value !== build.klass) kind.value = build.klass;
    build.level = 20;
    /*
     * The class, as itself. A name in a dropdown is a word; the sprite the
     * game draws is how anybody knows a Huntress from a Trickster, and it is
     * already cut and sitting in the atlas.
     */
    {
      const kind = data.byClass[build.klass];
      const face = el('tcFace');
      /*
       * One frame of the class, standing.
       *
       * It used to be read out of the realm atlas - a folder built for the
       * map - which put it on a different picture from everything else on
       * this page and left the offline copy, which cannot carry a folder,
       * with no figure at all. It is on the one sheet now, cut to the shape
       * of the drawing rather than to the shape of the rectangle around it.
       */
      const portrait = facePortrait(kind, data.sheet);
      const style = faceStyle(portrait, data.sheet);
      if (style) {
        Object.assign(face.style, style);
        // The class is someone: it wears the one outline every page lays on a character (web/outline.js).
        if (window.RealmOutline) face.style.filter = window.RealmOutline.filter(portrait.zoom);
        face.hidden = false;
      } else { face.hidden = true; }
    }
    for (const node of el('tcBody').querySelectorAll('[data-set]')) {
      const which = node.dataset.set;
      node.classList.toggle('is-on', !!build[which]);
    }
    for (const node of el('tcBody').querySelectorAll('[data-scope]')) {
      node.classList.toggle('is-on', node.dataset.scope === (build.scope || 'all'));
    }

    for (const node of el('tcBody').querySelectorAll('[data-search-gear]')) {
      const on = build[node.dataset.searchGear] !== false;
      node.classList.toggle('is-on', on);
      node.setAttribute('aria-pressed', String(on));
    }

    const asked = goalsOf(build).map(one => one.id);
    for (const node of el('tcGoals').querySelectorAll('[data-goal]')) {
      node.classList.toggle('is-on', asked.includes(node.dataset.goal));
    }
    syncDistance();
    for (const node of el('tcGoals').querySelectorAll('[data-damage]')) {
      node.classList.toggle('is-on', node.dataset.damage === (build.damage || 'weapon'));
    }
    // Read against whatever is being fought, since there is no dial any more.
    const aimedAt = data.byBoss[build.boss];
    build.against = aimedAt ? aimedAt.def : 0;
    for (const node of el('tcBosses').querySelectorAll('[data-boss]')) {
      node.classList.toggle('is-on', node.dataset.boss === build.boss);
    }
    // A folded group still says it holds the one being fought.
    for (const group of el('tcBosses').querySelectorAll('.tc-target-group')) {
      group.classList.toggle('has-on', Boolean(group.querySelector('.tc-boss.is-on')));
    }
    el('tcName').value = build.name;
    drawTabs();
    drawMix();
    drawSearch();
    drawSlots();
    drawStats();
    drawNumbers();
    drawProgress();
    drawTakeAll();
    drawAlternatives();
    resetDuel();
    drawDuel();
  }

  /*
   * The targets, as large as the room they are given.
   *
   * The target column is as tall as the gear, the fight and the search beside
   * it, and no taller: its height is the layout's, not its own. So the grid is
   * fitted into that box rather than the box to the grid - the largest cell,
   * between TARGET_LEAST and TARGET_MOST, at which every target is on screen
   * at once, and the least of them with the grid scrolling when even that
   * cannot show them all. Asked again only when the box itself changes size:
   * a window resized, or the column beside it grown by an enchantment.
   */
  const TARGET_LEAST = 16, TARGET_MOST = 72;
  /* The groups, easiest first, and which of them this browser has folded. */
  const TARGET_GROUPS = [['hero', 'Heroes of Oryx'], ['encounter', 'Encounters'], ['boss', 'Dungeon bosses']];
  const TARGET_SHUT_STORE = 'rotmg-theory-target-groups-shut';
  function shutTargetGroups() {
    try { return new Set(JSON.parse(localStorage.getItem(TARGET_SHUT_STORE) || '[]')); }
    catch (_) { return new Set(); }
  }
  function keepShutTargetGroups() {
    const shut = [...el('tcBosses').querySelectorAll('.tc-target-group:not([open])')].map(one => one.dataset.role);
    try { localStorage.setItem(TARGET_SHUT_STORE, JSON.stringify(shut)); } catch (_) { /* private mode */ }
  }
  function fitTargets() {
    const box = el('tcBosses');
    if (!box) return;
    /*
     * Fitted across the open groups together: every open group starts a row
     * of its own, and the room each heading takes comes off the height first.
     * A folded group is its heading alone.
     */
    const open = [...box.querySelectorAll('.tc-target-group[open]')];
    const counts = open.map(group => group.querySelectorAll('.tc-boss').length).filter(Boolean);
    const count = counts.reduce((sum, n) => sum + n, 0);
    // Everything a group takes that is not its grid - its heading, its
    // margins, the whole of it when folded - measured rather than assumed.
    const groups = [...box.querySelectorAll('.tc-target-group')];
    const heads = groups.reduce((sum, group) => {
      const grid = group.open && group.querySelector('.tc-target-grid');
      return sum + group.getBoundingClientRect().height - (grid ? grid.getBoundingClientRect().height : 0);
    }, 0);
    const between = Math.max(0, groups.length - 1) * parseFloat(getComputedStyle(box).rowGap || 0);
    const wide = box.clientWidth, tall = box.clientHeight - heads - between;
    if (!count || !wide || tall <= 0) return;
    const rowsFor = cols => counts.reduce((sum, n) => sum + Math.ceil(n / cols), 0);
    const gapFor = cell => Math.round(Math.max(3, Math.min(8, cell * 0.1)));
    let pick = null;
    for (let cols = 1; cols <= count; cols++) {
      const gap = gapFor(wide / cols);
      const cell = (wide - (cols - 1) * gap) / cols;
      if (cell > TARGET_MOST) continue;
      if (cell < TARGET_LEAST) break;
      const rows = rowsFor(cols);
      pick = { cols, gap, cell };
      // A couple of pixels in hand: the browser rounds every row, and a grid
      // that fits by a fraction of a pixel on paper shows a scrollbar.
      if (rows * cell + (rows - counts.length) * gap <= tall - 2) break;
    }
    if (!pick) {
      const gap = gapFor(TARGET_LEAST);
      const cols = Math.max(1, Math.floor((wide + gap) / (TARGET_LEAST + gap)));
      pick = { cols, gap, cell: (wide - (cols - 1) * gap) / cols };
    }
    /* Whatever height a fitted grid leaves over is shared out between its
       rows rather than left in a band at the bottom - up to a point, past
       which it would read as a grid pulled apart. */
    const rows = rowsFor(pick.cols);
    const spare = tall - (rows * pick.cell + (rows - counts.length) * pick.gap);
    const inner = rows - counts.length;         // the gaps between rows inside groups
    const rowGap = spare > 2 && inner > 0
      ? Math.floor(Math.min(pick.gap + (spare - 2) / inner, pick.gap + pick.cell * 0.35) * 10) / 10 : pick.gap;
    // Scrolling is the last resort, for a box too small for even the least.
    box.classList.toggle('is-overfull', rows * pick.cell + inner * pick.gap > tall);
    box.style.setProperty('--tc-target-cols', String(pick.cols));
    box.style.setProperty('--tc-target-gap', pick.gap + 'px');
    box.style.setProperty('--tc-target-row-gap', rowGap.toFixed(1) + 'px');
    // The sprites were cut for a 34px picture; the cell carries its own
    // scale, a little under that in the smallest cells and up to double.
    box.style.setProperty('--tc-target-k',
      Math.max(0.6, Math.min(2, pick.cell * 0.82 / 34)).toFixed(3));
  }
  let targetWatch = null;
  function watchTargetFit() {
    fitTargets();
    if (targetWatch || typeof ResizeObserver === 'undefined') return;
    targetWatch = new ResizeObserver(() => fitTargets());
    targetWatch.observe(el('tcBosses'));
  }

  /*
   * The other builds the last search found, as four pictures under the gear.
   *
   * They belong to one moment: the build, the goal, the filters, the
   * progression and the target the search was asked about. Change any of
   * those, or change one of the four items by hand, and they are no longer
   * alternatives to anything on the page - so they are not shown until the
   * search is asked again. With nothing to offer there is nothing drawn.
   */
  let alternatives = null;
  function alternativesLive() {
    return resultCalculations.alternativesLive(alternatives, build);
  }
  /*
   * All of them on the one line, so they can be compared at a glance: the
   * best found first, then the alternatives in order, each its four items as
   * one button that wears it. The one being worn is marked rather than hidden,
   * so the row does not reshuffle under the pointer.
   */
  function drawAlternatives() {
    const box = el('tcAlts');
    if (!box) return;
    if (!alternativesLive()) { box.hidden = true; box.innerHTML = ''; return; }
    const { list, at } = alternatives;
    const lead = list[0];
    const goals = goalsOf(build);
    box.hidden = false;
    // How many share the line, so the stylesheet can size their pictures to fit it.
    box.style.setProperty('--alts', list.length);
    box.innerHTML = '<span class="tc-alts-label" title="Whole builds the last search found, ranked by the same goal">Alt</span>'
      + list.map((one, i) => {
        const { said, behind, where, names } = describeAlternative(build, one, lead, i, goals);
        // Several goals at once are compared in points of the room each has, not per cent.
        const unit = goals.length > 1 ? ' pts' : '%';
        const gap = (behind > 0 ? '+' : '') + behind + unit;
        const tag = (i === 0 ? 'Best found' : 'Alt ' + i)
          + (i && behind ? ' <u>' + gap + '</u>' : '');
        return '<button type="button" class="tc-alts-pick' + (i === at ? ' is-on' : '') + '"'
          + ' data-alt-apply="' + i + '" aria-pressed="' + (i === at) + '"'
          + ' title="' + esc(where + ' · ' + said + (i ? ' · ' + gap + (goals.length > 1
            ? ' against the best found, in points of the way from the starting build to each goal\'s best'
            : ' against the best found') : '')
            + '\n' + names + (i === at ? '\nworn now' : '\nclick to wear it')) + '">'
          + '<span class="tc-alts-tag">' + tag + '</span><span class="tc-alts-cells">'
          + HANDS.map(([hand]) => {
            const item = data.byItem[one.gear[hand].name];
            const cut = item && item.icon && indexIcon(item.icon, 28, '');
            return '<span class="tc-alts-cell ' + gradeOf(one.gear[hand].name) + '">' + (cut || '') + '</span>';
          }).join('')
          + '</span></button>';
      }).join('');
  }
  /* Wearing one: its four items and its own enchantments, and nothing else of
     the build changes - the class, the goal, the padlocks and the target stay. */
  function wearAlternative(index) {
    if (!alternativesLive() || !alternatives.list[index]) return;
    alternatives.at = index;
    build.gear = JSON.parse(JSON.stringify(alternatives.list[index].gear));
    tabs[onTab] = build;
    keep(); paint();
  }


  /*
   * What the whole-build button can actually send, said before it is pressed.
   * The calculator is the one that knows what the game lets be enchanted -
   * starter gear, for one, cannot be - so it is asked, and the button says
   * how many of the build it will open, or stands idle and says why.
   */
  function sendable() {
    const handed = buildHandover();
    const can = typeof window.enchantCan === 'function' ? window.enchantCan : null;
    // null is the calculator still reading its data: not a no.
    const refused = said => can && can(said.item) === false;
    return { handed, ok: handed.filter(said => !refused(said)),
      no: handed.filter(refused).map(said => said.item) };
  }
  function drawTakeAll() {
    const button = el('tcTakeAll');
    if (!button) return;
    const { handed, ok, no } = sendable();
    button.disabled = !ok.length;
    button.textContent = !ok.length || ok.length === handed.length
      ? 'send build to enchant'
      : 'send ' + ok.length + ' of ' + handed.length + ' to enchant';
    button.title = !handed.length ? 'Nothing is equipped yet.'
      : no.length ? 'The game does not let ' + no.join(', ') + ' be enchanted.'
        + (ok.length ? ' The other ' + ok.length + ' each open in a new Enchant Calculator tab.' : '')
      : 'Open every item of this build, with its enchantments, in its own new Enchant Calculator tab';
    // And said beside it, not only on hover: a button that is idle for a
    // reason nobody can see reads as a button that is broken.
    const note = el('tcTakeNote');
    if (note) {
      note.textContent = !no.length ? ''
        : (no.length === handed.length ? 'none of these can be enchanted in the game'
          : no.join(', ') + ' cannot be enchanted in the game');
    }
  }

  function fillPickers() {
    el('tcClass').innerHTML = data.classes.map(one =>
      '<option value="' + esc(one.name) + '">' + esc(one.name) + '</option>').join('');
    /*
     * You pick a thing to hit by looking at it. Everything here is either an
     * encounter or the boss at the end of a dungeon - the client marks both
     * as a quest - which leaves a list short enough to show as pictures, and
     * a picture is how anybody actually knows which one is the Shatters.
     */
    /*
     * In three groups, the three things there are to fight: the realm's
     * Heroes of Oryx, its encounters, and the bosses at the end of dungeons -
     * each folding away on its own, and each from the easiest to the hardest,
     * which is life first and armour after. The groups themselves stand in
     * the same order. Each creature is its own picture, moving as it moves.
     */
    const targets = data.bosses.filter(one => one.pic);
    const shut = shutTargetGroups();
    el('tcBosses').innerHTML = TARGET_GROUPS.map(([role, say]) => {
      const list = targets.filter(one => (one.role || 'boss') === role)
        .sort((a, b) => a.hp - b.hp || a.def - b.def || a.name.localeCompare(b.name));
      if (!list.length) return '';
      return '<details class="tc-target-group" data-role="' + role + '"' + (shut.has(role) ? '' : ' open') + '>'
        + '<summary><span>' + esc(say) + '</span><i>' + list.length + '</i></summary>'
        + '<div class="tc-target-grid">' + list.map(one =>
          '<button type="button" class="tc-boss" data-boss="' + esc(one.name) + '"'
          + ' title="' + esc(one.name) + ' — ' + commas(one.hp) + ' life, '
          + one.def + ' armour">' + targetIcon(one.pic, 34) + '</button>').join('')
        + '</div></details>';
    }).join('');
    watchTargetFit();
    const groups = [...new Set(GOALS.map(one => one.group))];
    el('tcGoals').innerHTML = groups.map(name =>
      '<div class="tc-goal-row"><i>' + esc(name) + '</i>'
      + '<span>' + GOALS.filter(one => one.group === name).map(one =>
        '<button type="button" class="tc-goal" data-goal="' + one.id + '"'
        + (one.id.startsWith('regen:') ? ' title="' + esc(REGEN_SAYS) + '"' : '')
        + (one.tint ? ' style="--tint:' + one.tint + '"' : '') + '>'
        + '<i class="tc-dot"></i>' + esc(one.say) + '</button>').join('')
      // What the regeneration goals count, under the row that holds them and
      // in its column, rather than loose between two rows.
      + (GOALS.some(one => one.group === name && one.id.startsWith('regen:'))
        ? '<small class="tc-objective-note">' + esc(REGEN_SAYS) + '</small>' : '')
      + '</span></div>').join('')
      + distanceControl()
      + '<div class="tc-goal-row"><i>Damage counts</i><span>' + DAMAGES.map(([id, say]) =>
        '<button type="button" class="tc-goal" data-damage="' + id + '"><i class="tc-dot"></i>' + esc(say) + '</button>').join('') + '</span></div>';
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    el('tcClass').addEventListener('change', event => {
      const was = build.name === (build.klass + ' build');
      build.klass = event.target.value;
      const start = fresh(build.klass);
      build.gear = start.gear;
      if (was) build.name = start.name;
      keep(); paint();
    });

    el('tcBody').addEventListener('click', event => {
      const flip = event.target.closest('[data-set]');
      if (!flip) return;
      build[flip.dataset.set] = !build[flip.dataset.set];
      keep(); paint();
    });
    el('tcBody').addEventListener('click', event => {
      const scope = event.target.closest('[data-scope]');
      if (!scope) return;
      build.scope = scope.dataset.scope;
      keep(); paint();
    });

    el('tcBody').addEventListener('click', event => {
      const filter = event.target.closest('[data-search-gear]');
      if (!filter) return;
      const key = filter.dataset.searchGear;
      /*
       * True is the default, represented by no property at all. Besides
       * keeping saved builds compact, this makes builds saved before this
       * feature naturally behave as though both chips were lit.
       */
      if (build[key] === false) delete build[key];
      else build[key] = false;
      keep();
      paint();
    });
    /*
     * The other tool, with this item in it.
     *
     * Somebody who has just been told to put four enchantments on a weapon
     * wants to know what that costs before they believe it, and that answer
     * is one page away - so the item and everything on it go there rather
     * than being typed in again.
     */
    el('tcBody').addEventListener('click', async event => {
      const take = event.target.closest('[data-take]');
      if (!take) return;
      /* The calculator's names come from the rules, which the served site loads on demand. */
      await loadRules();
      const said = handoverFor(take.dataset.take);
      if (!said || typeof window.enchantThis !== 'function') return;
      window.enchantThis(said);
    });
    /*
     * And the whole of it at once: each of the four, with only its own
     * enchantments, as a tab of its own. Each hand-over is built by the same
     * function the single button uses, so the two cannot drift apart.
     */
    el('tcBody').addEventListener('click', event => {
      const wear = event.target.closest('[data-alt-apply]');
      if (wear) { wearAlternative(Number(wear.dataset.altApply)); return; }
      // An item or a place, opened in the Index through its own checked route.
      const open = event.target.closest('[data-index-open]');
      if (open && typeof window.openIndexRecord === 'function') window.openIndexRecord(open.dataset.indexOpen);
    });
    el('tcBody').addEventListener('click', async event => {
      if (!event.target.closest('#tcTakeAll')) return;
      if (typeof window.enchantBuild !== 'function') return;
      await loadRules();
      const said = buildHandover();
      const answer = said.length ? window.enchantBuild(said, { label: build.name }) : null;
      // Only said here when nothing went: otherwise the calculator is now on
      // the screen, and it says what it could not take itself.
      if (!answer || !answer.opened.length) {
        el('tcSaid').textContent = 'nothing in this build can be enchanted in the game';
      }
    });

    el('tcBody').addEventListener('click', event => {
      if (event.target.closest('[data-owned-only]')) {
        if (build.searchOwned) delete build.searchOwned;
        else build.searchOwned = true;
        keep(); paint();
        return;
      }
      const gone = event.target.closest('[data-unown]');
      if (!gone) return;
      delete (build.owned || {})[gone.dataset.unown];
      if (build.owned && !Object.keys(build.owned).length) { delete build.owned; delete build.searchOwned; }
      keep(); paint();
    });

    el('tcBody').addEventListener('click', event => {
      const back = event.target.closest('[data-unban]');
      if (!back) return;
      delete (build.banned || {})[back.dataset.unban];
      keep(); paint();
    });

    wireDistance(el('tcGoals'), () => { keep(); paint(); });
    el('tcGoals').addEventListener('click', event => {
      const damage = event.target.closest('[data-damage]');
      if (damage) { build.damage = damage.dataset.damage; keep(); paint(); return; }
      const pick = event.target.closest('[data-goal]');
      if (!pick) return;
      /*
       * They add up rather than replacing one another. Nobody builds for one
       * number: it is damage without dying, or a fast kill that still leaves
       * you standing, and the search can be told both. The last one cannot be
       * turned off, because a search with nothing to aim at has nothing to do.
       */
      const want = goalsOf(build).map(one => one.id);
      const at = want.indexOf(pick.dataset.goal);
      if (at < 0) want.push(pick.dataset.goal);
      else if (want.length > 1) want.splice(at, 1);
      build.goals = want;
      delete build.goal;
      /*
       * The split is re-struck whenever the list of things asked for changes:
       * the hundred per cent is shared out evenly again, because a share left
       * over from a goal that is no longer on the list means nothing.
       */
      levelShares(build);
      keep(); paint();
    });


    el('tcMix').addEventListener('click', event => {
      const pin = event.target.closest('[data-pin]');
      if (!pin) return;
      build.pinned = build.pinned || {};
      if (build.pinned[pin.dataset.pin]) delete build.pinned[pin.dataset.pin];
      else build.pinned[pin.dataset.pin] = true;
      keep(); drawMix();
    });

    el('tcMix').addEventListener('input', event => {
      const bar = event.target.closest('[data-mix]');
      if (!bar) return;
      moveShare(build, bar.dataset.mix, Number(bar.value));
      keep();
      /*
       * The others move; the one under the mouse is left alone.
       *
       * Redrawing the whole row on every input replaced the very slider being
       * dragged, so the browser lost the pointer the moment it moved one per
       * cent and the drag had to be started again for every step.
       */
      tuneMix(bar);
    });

    /* A group folded or opened: remembered, and the rest refitted to the room. */
    el('tcBosses').addEventListener('toggle', event => {
      if (!event.target.matches || !event.target.matches('.tc-target-group')) return;
      keepShutTargetGroups();
      fitTargets();
    }, true);
    el('tcBosses').addEventListener('click', event => {
      const pick = event.target.closest('[data-boss]');
      if (!pick) return;
      build.boss = pick.dataset.boss;
      // The aim follows the target, unless it has been moved by hand since.
      const boss = data.byBoss[build.boss];
      if (boss) build.against = Math.min(100, boss.def);
      keep(); paint();
    });
    el('tcPause').addEventListener('click', () => {
      duel.on = !duel.on;
      el('tcPause').textContent = duel.on ? 'pause' : 'play';
    });
    el('tcAgain').addEventListener('click', resetDuel);
    /* The party's status effects: a switch each, kept with the build. */
    el('tcStatus')?.addEventListener('click', event => {
      const sw = event.target.closest('[data-assume]');
      if (!sw) return;
      const name = sw.dataset.assume;
      build.assume = { ...(build.assume || {}), [name]: !(build.assume && build.assume[name]) };
      if (!build.assume[name]) delete build.assume[name];
      keep(); paint();
    });
    const link = el('tcShare');
    if (link) {
      link.addEventListener('click', () => {
        const token = share();
        if (!token) return;
        const at = location.href.split('#')[0] + '#theory?build=' + token;
        const said = word => { link.textContent = word;
          setTimeout(() => { link.textContent = 'copy a link'; }, 2200); };
        /*
         * Written into the address whether or not the clipboard co-operates,
         * so the link is always there to be copied by hand.
         */
        location.hash = 'theory?build=' + token;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(at).then(() => said('copied'), () => said('in the address bar'));
        } else said('in the address bar');
      });
    }

    el('tcName').addEventListener('input', event => {
      build.name = event.target.value; keep(); drawTabs();
    });

    el('tcGear').addEventListener('click', event => {
      const ban = event.target.closest('[data-ban-held]');
      if (ban) {
        const hand = ban.dataset.banHeld;
        const worn = build.gear[hand];

        if (!worn || !worn.name) return;

        build.banned = build.banned || {};
        build.banned[worn.name] = true;

        /*
         * The blacklisted item cannot remain equipped: otherwise the current
         * build would still use something that its own search is forbidden
         * to offer.
         */
        worn.name = null;
        worn.ench = (worn.ench || []).map(() => null);

        /*
         * A removed item cannot remain locked, nor can enchantment locks from
         * that old item prevent the optimiser from filling the empty slot.
         */
        build.locked = build.locked || {};
        delete build.locked[hand];

        for (const key of Object.keys(build.locked)) {
          if (key.indexOf(hand + ':') === 0) {
            delete build.locked[key];
          }
        }

        keep();
        paint();

        /*
         * Blacklisting something from the equipped card means "give me the
         * next best answer without this item". Reuse the exact same search
         * path as the Search button so goals, scope, progression, locks and
         * every other blacklist keep their normal meaning.
         */
        const run = el('tcRun');
        if (run && !run.disabled) run.click();

        return;
      }

      const item = event.target.closest('[data-item]');
      if (item) { openItems(item.dataset.item); return; }
      const ench = event.target.closest('[data-ench]');
      if (ench) {
        const [hand, at] = ench.dataset.ench.split(':');
        openEnchants(hand, Number(at));
        return;
      }
      const drop = event.target.closest('[data-drop]');
      if (drop) {
        const [hand, at] = drop.dataset.drop.split(':');
        build.gear[hand].ench[Number(at)] = null;
        delete build.locked[drop.dataset.drop];
        keep(); paint();
        return;
      }
      const hold = event.target.closest('[data-hold]');
      if (hold) {
        const which = hold.dataset.hold;
        const on = !build.locked[which];
        build.locked[which] = on;
        /*
         * Each padlock holds only what it is on. A kept enchantment leaves
         * the item free: the search swaps it only for items that can carry
         * the enchantment, so an exclusive one keeps its item by itself.
         */
        keep(); drawSlots();
      }
    });
    el('tcGear').addEventListener('click', event => {
      const gem = event.target.closest('[data-slots-set]');
      if (!gem) return;
      const [hand, count] = gem.dataset.slotsSet.split(':');
      const worn = build.gear[hand];
      const n = Number(count) || 0;
      worn.slots = worn.slots === n ? n - 1 : n;
      keep(); paint();
    });

    el('tcPicker').addEventListener('click', event => {
      const own = event.target.closest('[data-own]');
      if (own) {
        event.stopPropagation();
        const name = own.dataset.own;
        build.owned = build.owned || {};
        if (build.owned[name]) delete build.owned[name];
        else build.owned[name] = true;
        if (!Object.keys(build.owned).length) delete build.owned;
        keep();
        const mine = !!(build.owned && build.owned[name]);
        own.setAttribute('aria-pressed', String(mine));
        own.textContent = mine ? '★' : '☆';
        own.title = mine ? 'One of my items - click to unmark it' : 'I have this - compare it with my other items';
        drawSearch();
        return;
      }
      const ban = event.target.closest('[data-ban]');
      if (ban) {
        event.stopPropagation();
        build.banned = build.banned || {};
        build.banned[ban.dataset.ban] = true;
        keep();
        // The row goes with it: the list is what you can still choose from.
        const gone = ban.closest('.tc-row-pair');
        if (gone) gone.remove();
        drawSearch();
        return;
      }
      const row = event.target.closest('[data-choose]');
      if (row) chose(row.dataset.choose);
    });
    el('tcSearch').addEventListener('input', event => {
      const rows = JSON.parse(el('tcPicker').dataset.rows || '[]');
      const want = RealmI18n.canonicalSearch(event.target.value);
      paintPicker(want
        ? rows.filter(one => RealmI18n.canonicalSearch(
          one.search || (one.name + ' ' + (one.says || ''))
        ).includes(want))
        : rows);
    });
    el('tcPickerShut').addEventListener('click', shutPicker);
    el('tcPickerWrap').addEventListener('click', event => {
      if (event.target === el('tcPickerWrap')) shutPicker();
    });

    el('tcTabs').addEventListener('click', event => {
      const shut = event.target.closest('[data-shut]');
      if (shut) {
        const i = Number(shut.dataset.shut);
        tabs.splice(i, 1);
        if (!tabs.length) tabs = [fresh(data.classes[0].name)];
        onTab = Math.min(onTab, tabs.length - 1);
        build = tabs[onTab];
        keep(); paint();
        return;
      }
      const tab = event.target.closest('[data-tab]');
      if (!tab) return;
      if (tab.dataset.tab === 'new') {
        tabs.push(fresh(build.klass));
        onTab = tabs.length - 1;
        before = null;
      } else if (tab.dataset.tab === 'copy') {
        const twin = JSON.parse(JSON.stringify(build));
        twin.name = build.name + ' copy';
        tabs.splice(onTab + 1, 0, twin);
        onTab += 1;
        before = null;
      } else {
        onTab = Number(tab.dataset.tab);
      }
      build = tabs[onTab];
      keep(); paint();
    });

    el('tcUndo').addEventListener('click', () => {
      if (!before) return;
      tabs[onTab] = build = before;
      before = null;
      keep(); paint();
      el('tcSaid').textContent = 'put back the way it was';
    });

    el('tcRun').addEventListener('click', () => {
      if (!profile || profileDraft || (profile.mode === 'personal' && !access)) { editProfile(); return; }
      const wanted = goalsOf(build);
      const said = el('tcSaid');
      before = JSON.parse(JSON.stringify(build));
      el('tcRun').disabled = true;
      said.textContent = 'trying things...';
      // Off the paint, so the button has time to say it is working.
      setTimeout(async () => {
        const busy =
          el('tcBody');

        if (busy) {
          busy.inert = true;
        }

        try {
        /*
         * Two searches, and the better of them. One from the plainest gear
         * there is, which is the same starting point every time and so gives
         * the same answer every time; one from what is on the page, which can
         * only help. Both are scored on the same scale - read off the plain
         * build, not off whatever the last search left behind - so pressing
         * the button twice cannot wander.
         */
        const plain = prepareAccessible(bareOf(build));
        const aim = aimOf(plain, wanted);
        const was = wanted.map(one => scoreOf(build, one));
        /* Both searches note the gear sets they score in one table, and the
           best of the others are then enchanted and ranked behind the answer. */
        const gather = new Map();
        const fromPlain = await optimiseAsync(plain, aim, null, gather);
        const fromHere = await optimiseAsync(build, aim, null, gather);
        const got = fromPlain.score >= fromHere.score ? fromPlain : fromHere;
        const ranked = await alternativesOfAsync(got, gather, aim);
        got.looked = fromPlain.looked + fromHere.looked + ranked.looked;
        const name = build.name;
        for (const one of ranked.list) one.state.name = name;
        tabs[onTab] = build = ranked.list[0].state;
        alternatives = rememberAlternatives(ranked, build, aim);
        keep(); paint();
        /*
         * Where each thing asked for started and where it got to. Measured as
         * how far it moved rather than as a ratio: killing a boss scores as
         * negative seconds, so a ratio flipped its sign and reported going
         * from two thousand seconds to eleven as ninety-nine per cent worse.
         *
         * Every goal is reported, including the ones that went down. Asking
         * for damage and survival at once means trading one against the
         * other, and a report that showed only the winner would hide the
         * price.
         */
        said.innerHTML = wanted.map((one, i) => {
          const { now, moved } = resultCalculations.goalChange(build, one, was[i]);
          // A goal the search left where it was says so once.
          const same = sayGoal(one, was[i]) === sayGoal(one, now);
          return '<span class="figure' + (same ? ' is-same' : '') + '"><b style="color:' + esc(one.tint) + '">'
            + esc(sayGoal(one, now))
            + '</b><small>' + esc(one.say.toLowerCase())
            + (same ? ' · unchanged' : moved ? ' · ' + (moved > 0 ? '+' : '') + moved + '%' : '')
            + '</small></span>';
        }).join('')
          + '<span class="figure"><b>' + RealmI18n.number(got.looked)
          + '</b><small>builds tried</small></span>';
        } finally {
          if (busy) {
            busy.inert = false;
          }

          el('tcRun').disabled =
            false;
        }
      }, 20);
    });


  }

  /* ---------------- opening ---------------- */

  /*
   * Two flags, and the same reason as the index has two. `started` is set
   * after the data is read so a failed load can be asked for again - but that
   * is after an `await`, and a flag set after an await guards nothing during
   * it. The router calls this twice on every arrival, because opening a page
   * from a card sets `location.hash` and then routes, and setting the hash
   * fires `hashchange`, which routes again. Both calls went past the guard and
   * wired every listener twice. `starting` covers the window `started` cannot.
   */
  let started = false;
  let startPromise = null;
  /*
   * And the page's own markup, kept before anything is written over it.
   *
   * Saying "the data is not here yet" replaces the whole of the body - which
   * is also every element the working page is built out of. Say it once and
   * the pickers, the lists and the boxes this fills in are gone; a later
   * attempt that succeeds then goes looking for them and throws on the first
   * one, leaving the page stuck on a message about a file that is present.
   *
   * A load can fail for a moment and be worth trying again - a server that
   * blinked, a connection that dropped - so the message has to be undoable.
   * The markup is put back before anything is filled in.
   */
  let shell = null;
  async function runStart() {
    const bundled = window.ROTMG_BUNDLE && window.ROTMG_BUNDLE.sources
      && window.ROTMG_BUNDLE.sources.theoryText;
    let raw = bundled;
    if (!raw) {
      for (const url of ['assets/theory/theorycraft.json', '../data/TheoryCraft/theorycraft.json']) {
        raw = await fetch(url).then(r => r.ok ? r.text() : '').catch(() => '');
        if (raw) break;
      }
    }
    if (!raw) {
      el('tcWelcome').hidden = true;
      el('tcBody').hidden = false;
      const box = el('tcBody');
      if (box) {
        if (shell === null) shell = box.innerHTML;
        box.innerHTML = '<p class="tc-missing">The build data is not here yet. '
          + 'Run <code>node tools/build-theorycraft.js</code>.</p>';
      }
      return false;
    }
    data = JSON.parse(raw);
    data.byClass = {}; data.byItem = {}; data.byEnch = {}; data.byBoss = {};
    for (const one of data.classes) data.byClass[one.name] = one;
    for (const one of data.items) data.byItem[one.name] = one;
    for (const one of data.enchants) data.byEnch[one.id] = one;
    for (const one of data.bosses) data.byBoss[one.name] = one;
    statusInfo = await loadStatusInfo();
    gearInfo = await loadGearInfo();
    await loadAccess();
    try { profile = BuildProgression.normalize(JSON.parse(localStorage.getItem(PROFILE_STORE)), access); }
    catch (_) { profile = null; }
    if (!(await loadRules())) {
      el('tcWelcome').hidden = true;
      el('tcBody').hidden = false;
      const box = el('tcBody');
      if (box) box.textContent = 'The enchanting data could not be loaded. Reload this page before planning a build.';
      return false;
    }
    started = true;
    {
      const box = el('tcBody');
      if (shell !== null && box) { box.innerHTML = shell; shell = null; }
    }

    // The sheet's address, once, for every icon on the page to point at.
    {
      const bundle = window.ROTMG_BUNDLE;
      el('tcBody').style.setProperty('--tc-sheet', 'url('
        + sheetStyleUrl(theorySheetUrl()) + ')');
      const wrap = el('tcPickerWrap');
      if (wrap) wrap.style.setProperty('--tc-sheet', el('tcBody').style.getPropertyValue('--tc-sheet'));
      /*
       * And the index's sheet, which the item pictures come from. The
       * calculator writes the same address onto the document when it loads;
       * this repeats it so the bench draws its items whether or not the other
       * page ever opened.
       */
      document.documentElement.style.setProperty('--sheet', 'url('
        + sheetStyleUrl((bundle && bundle.indexSheet) || 'assets/index/sheet.png') + ')');
    }
    fillPickers();
    if (!recall()) tabs = [fresh('Wizard')];
    build = tabs[onTab] || (tabs[0] = fresh('Wizard'));
    // A build kept from an older visit may name a class or item since renamed.
    if (!data.byClass[build.klass]) build = tabs[onTab] = fresh(data.classes[0].name);
    /*
     * A build kept from before knows the old exaltation numbers, which were
     * wrong for life and magic. They are not a choice anybody made, so they
     * are simply brought up to date rather than left to puzzle over.
     */
    for (const one of tabs) {
      one.level = 20;
      one.exalts = one.exalts || {};
      for (const [key] of STATS) one.exalts[key] = exaltOf(key);
    }
    wire();
    wireProgress();
    /*
     * And a build carried in by the address wins over what was left here
     * last time - somebody following a link came to see that build, not the
     * one they were working on. It arrives as a new tab so it cannot take
     * anybody's work away from them.
     */
    const shared = buildFromAddress();
    if (shared) {
      tabs.push(shared);
      onTab = tabs.length - 1;
      build = shared;
      keep();
    }
    paint();
    if (!profile) editProfile();
    keepPainting();
    return true;
  }

  function resumeMotion() {
    if (!theoryOpen()) return;
    if (!filmClock && films.length && motionWanted()) {
      filmClock = requestAnimationFrame(playFilms);
    }
    keepPainting();
  }

  function start() {
    if (started) {
      resumeMotion();
      return Promise.resolve(true);
    }
    if (startPromise) return startPromise;

    startPromise = runStart()
      .finally(() => {
        if (!started) startPromise = null;
      });

    return startPromise;
  }

  /*
   * The other tools ask for this by name: a build handed over as a token they
   * can put in an address, and one taken back the same way.
   */
  function share() { return data && build ? packBuild(build) : ''; }
  function open(token) {
    if (!data) return false;
    const got = unpackBuild(token);
    if (!got) return false;
    tabs.push(got);
    onTab = tabs.length - 1;
    build = got;
    keep(); paint();
    return true;
  }

  /*
   * Something handed over from the index.
   *
   * An item goes into the slot the client gives it, a class becomes the
   * class, an enemy becomes the thing being fought - and each of those is
   * checked against this page's own catalogue rather than trusted, since the
   * index holds things this page deliberately does not offer.
   */
  function put(said) {
    if (!data || !build || !said) return false;
    let moved = false;
    if (said.klass && data.byClass[said.klass] && said.klass !== build.klass) {
      const start = fresh(said.klass);
      start.name = start.klass + ' build';
      tabs.push(start);
      onTab = tabs.length - 1;
      build = start;
      moved = true;
    }
    if (said.item && data.byItem[said.item]) {
      const item = data.byItem[said.item];
      const hand = item.hand;
      if (hand && build.gear[hand]) {
        build.gear[hand] = { name: item.name, slots: 4, ench: [null, null, null, null] };
        moved = true;
      }
    }
    if (said.target && data.byBoss[said.target]) { build.boss = said.target; moved = true; }
    if (moved) { keep(); paint(); }
    return moved;
  }

  return { start, share, open, put };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TheoryCraft;

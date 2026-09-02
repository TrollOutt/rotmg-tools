# Realm Atlas — where the work got to

Written to be picked up on another machine. Everything below is about
`web/assets/atlas/` and the tools that build it; the enchantment calculator
itself was not touched.

---

## Read this first

**Pin the git identity before your first commit in a fresh clone.**

```bash
node tools/set-identity.js "TrollOutt" "129011076+TrollOutt@users.noreply.github.com"
```

The guard that enforces this is a `pre-commit` hook in `.git/hooks/`, and
`.git/hooks/` is never cloned. So on a new clone there is no hook and no
repo-local identity, and git will quietly record whatever the machine's global
`user.name` and `user.email` are — permanently, in a public history. This
repository is published under a pseudonym on purpose. Nothing that identifies
the author belongs in a commit message, a comment, or a file.

Pushing needs credentials for that account too. If the machine's stored GitHub
token belongs to a different account, scope this repository to its own login
rather than replacing the global one:

```bash
git config --local credential.useHttpPath true
```

Commit messages here are a short imperative title and then prose paragraphs.
No trailers of any kind.

---

## How the atlas is put together

Worth understanding before changing anything, because two of these caught me
out and cost a round of rework each.

**Five zoom levels, and only the nearest is live.** `z0/` is the ground and
nothing else — 128 tiles per chunk, 8 pixels per tile, 1024×1024 per picture.
`z1/` … `z4/` are **composites with the scenery already painted into the
ground**, at 4, 2, 1 and 0.5 pixels per tile. The page draws scenery from
`things.bin` only at level 0; further out it is looking at a picture.

*Consequence:* pruning `things.bin` removes something at the nearest zoom and
nowhere else. Zoom out one step and it is back. `tools/rebuild-levels.js`
exists for exactly this.

The recipe for the far levels was established by measurement, not assumption:
over a whole level-1 chunk, every pixel no thing's footprint could reach
matches a 2×2 average of level 0 exactly (771,531 of them, 12 disagreeing),
while inside the footprints only two in five match. So each level is the one
below it halved, with the things drawn on top.

**`atlas.json` is inlined into the page.** `web/assets/atlas/index.html`
carries a copy of it on one line, as `const A = {...};`, so the atlas can be
opened on its own with nothing to fetch. Every tool that writes `atlas.json`
must replace that line too — they all do, with the regex
`/^const A = (\{.*\});$/m`. If you edit `atlas.json` by hand, the page will
not see it.

**`docs/` is the published site**, built by `npm run build`. It holds a copy
of `web/assets/atlas/` and nothing else from `web/assets/` — everything else
the interface shows is inlined into `docs/index.html`. So anything the atlas
page needs at runtime has to live under `web/assets/atlas/`, which is why the
boss pictures were copied into `boss/` rather than referenced across
directories.

**`things.bin`** is a flat run of `(pic, x*8, y*8)` uint16 triples;
`things.json`'s `chunks` table says where each chunk's run starts and how long
it is. `things.json` has no names for anything, only rectangles into
`things.png` — identifying a sprite means looking at it.

**`mask.png`** is one pixel per tile: red is the biome, green is flags (bit 0
road, bit 1 impassable), blue is the zone id.

---

## The generator, and the order things run in

The atlas is not committed art — it is built, on the machine that has the game
client, by a generator that is deliberately not in this repository. Written
down here because the order matters and nothing else records it:

    node tools/realm-render.js --copy       the ground, the water, the standing layer
    node tools/realm-atlas-build.js         the pyramid, the zones, the page
    node tools/merge-realm-roles.js         the ranks and the cast

`--atlas=DIR` sends the last one at a copy; `--publish` on the second writes
into `web/assets/atlas` instead of `local/atlas`. `prune-map.js` is no longer
part of this: what does not belong on the map is turned away while it is being
built, from `data/Realm/off-the-map.txt`, so it never comes back when more of
the realm is walked. `refine-outline.js` still runs once, after.

**The page is generated.** `web/assets/atlas/index.html` is built from
`tools/atlas-viewer.html`, which is not in the repository either. Working on
the built file directly means the next build throws the work away — that
happened once, and cost six hundred lines of globe and zoom work that had to
be lifted back into the template by hand. Change the template.

---

## What is not available here

Two data sources the repository is designed around were out of reach, which
shaped what could and could not be done.

**`client-data/` is absent** (gitignored; rebuilt from an installed game
client). Without it there is no regenerating the realm data from source, and
the atlas generator itself is not in the repository at all — only the tools
listed below, which work on the committed assets.

*On the machine with the client both of these are available,* and the two
things they blocked have since been done: the encounters and heroes were cut
out of the client (see `tools/boss-sprites.js`), and the merged Dead Church
was split along its wildlife.

**`realmeye.com` is unreachable from the machine this was done on** —
connection reset on every path, any user agent, in Node and in a browser
alike, while other hosts answer normally. So `tools/fetch-realmeye-realm.js`
cannot be run here. `web/realmeye-data.json` therefore still has `detail` for
only 2 of its 284 creatures.

*If you are on a network that can reach it,* this is the single highest-value
thing to do:

```bash
cp web/realmeye-data.json /tmp/realmeye-backup.json   # it overwrites in place
node tools/fetch-realmeye-realm.js --details --assets
```

That fills in `hp`, `defense`, `exp`, `realmScore`, **`drops`** and
**`reproduction`** (which is what spawns what) for every creature — the data
behind four of the outstanding requests. Back the file up first: the tool
rebuilds it from scratch and a failed run leaves you with an empty one. Verify
it did something before committing: `0 local creature records` in the output
means the page structure has changed and the parser needs repair, not that you
are done.

---

## Tools written for this work

All are `node tools/<name>.js`, all explain themselves in a header comment,
all are safe to re-run.

| tool | what it does |
| --- | --- |
| `refine-outline.js` | Thins and blackens the dark line round every sprite. Holds the art at 2 sheet pixels to the art pixel and lays a 1-pixel flat-black outline, so the line is half a pixel of art instead of one. **Runs once** — a black line cannot be told from black art afterwards, so to change the factor `git checkout -- web/assets/atlas` first. |
| `prune-map.js` | Takes loot, attacks and orbiting projectiles off the map. Holds explicit lists of `things.png` picture ids and creature names with what each was recognised as, rewrites `things.bin` and its chunk table, drops the listings from `atlas.json`, and deletes creature sprites nothing points at. Idempotent. |
| `merge-realm-roles.js` | Attaches each zone's rank, encounters and Heroes of Oryx from `realmeye-data.json`, gives beacons their guardian, copies the pictures into `boss/`, and marks creatures already on the map with the part they play instead of duplicating them. Holds the biome→zone name join explicitly. |
| `rebuild-levels.js` | Rebuilds `z1`–`z4` from `z0` plus the current `things.bin`. **Run this after any change to `things.bin`** or the far zooms will disagree with the near one. `--only=1:2_5` and `--to=DIR` build one chunk elsewhere, which is how the recipe was checked against the published pictures before overwriting them. Takes a few minutes; `--max-old-space-size=6144`. |

`tools/build-standalone.js` was also fixed: `carryAcross` copied into `docs/`
but never removed, so every sprite ever generated and later dropped was still
being published — 35 of them, from several generations back. It prunes now.

---

## What was done, in order

1. **The outline round every sprite** is thinner and flat black instead of a
   translucent tint of its neighbour. It was baked into the art, not drawn, and
   already one pixel wide — so the art is held at twice the grain and the line
   is one pixel there. 915,072 art pixels came through the magnifier unaltered.
2. **`docs/` was a generation behind** — no `things.png`, no water — so the
   published atlas had no scenery and no moving sea at all. Fixed by running
   the build, which had not been run since that layer was made.
3. **Clicking a zone or a beacon no longer moves the view.** It used to fly the
   camera and pick a zoom.
4. **Nothing walks on a beacon plate.** The plate's size and offset were read
   off the ground rather than guessed: it is identical at every beacon and the
   biome around it is not, so counting how many of the 42 show the same tile at
   each offset draws it exactly — 19 tiles square, centred a tile east and four
   south of the position recorded for the beacon. The `REACH = 10` in
   `build-realm-tiles.js` is the window that was *searched*, not the plate.
5. **Drawing the scenery asks what is visible before sorting it.** It used to
   collect every thing in every chunk the screen touched, sort all of them,
   place and measure each, and only then discard 19 in 20. A third off the
   frame's largest cost, same picture.
6. **Loot, attacks and orbiting projectiles are off the map** — 3,443
   placements and 33 creature listings. None of it was guessable from the
   files; it was found by grouping the sheet by silhouette (one shape in four
   colours is a set of loot bags) and reading the creature list for the words
   the client uses for its own effects. Spawners were kept and marked instead.
7. **Zoom levels of importance.** Encounters appear at 0.35 pixels to the tile,
   Heroes of Oryx at 0.9, wildlife at 3, scenery at its own level (5.66). The
   encounters and heroes are not in the walked capture at all, so they come
   from the imported data with pictures from `boss/`, placed from a seed of
   their zone so they do not move between visits.
8. **The far zooms were rebuilt** so the pruning reaches them.
9. **The realm is on a world.** See below.
10. **The level the wheel is heading for is fetched while it is still moving.**

---

## The globe

`PLANET = 1250` tiles of radius. The flat chart is read as latitude and
longitude and projected the way a globe seen from far off projects. Curvature
disappears close in without being switched off: the world in screen pixels is
its radius times the zoom, so a window-sized patch of it is flat to well under
a pixel. Round-tripping a tile through `place()` and back through
`fromScreen()` is exact to zero tiles from zoom 0.25 to 20.

Things to know if you touch it:

- **Latitude is separable, longitude is not.** A band of rows shares one
  latitude, but within a band the chart is stretched by the *sine* of
  longitude, so it must be taken in pieces. The number of pieces comes from a
  half-pixel tolerance (`SPHERE_TRUE`) via `d = sqrt(4*tol/r)`. Do not replace
  that with a fixed count: too few and the ground sits several pixels from
  where the creatures standing on it are drawn.
- **The disc is kept between frames** (`globeKept`), keyed on the rounded view,
  the window, the highlight and a **count of chunk pictures that have
  finished loading**. That last part matters: the first frame of a fresh page
  is drawn before any ground has arrived, and keeping it gives a planet of
  unbroken ocean that never corrects itself.
- **The globe has its own canvas with alpha.** `flatMap` (used by the leaning
  camera) is `{ alpha: false }`, so `clearRect` on it paints solid black —
  which then covered the ocean. The globe uses `globeMap`/`globeCtx`.
- `OCEAN` is the sea's colour counted off the coarsest ground picture, where
  it is the commonest colour there is. If the ground art changes, recount it or
  a rectangle will appear round the coast.

Not done: rotating the world, or moving over it by turning it rather than
panning.

---

## Measuring things in a browser — read this before trusting a number

Four of these cost me a wrong conclusion that I had to retract.

1. **`canvas.clientWidth` can be 0** while the page still renders — a hidden or
   background pane reports nothing to script. `size()` then returns a
   degenerate box and every measurement taken through it is meaningless. I
   twice read a "result" that was really an empty viewport, once claiming a 30×
   speed-up that was actually 31%. **Check the canvas size first, every time.**
2. **Never force `canvas.width` for a measurement** and then screenshot. The
   render loop resets it from `clientWidth` and the two disagree; what you
   capture is a partly drawn frame with black where nothing reached. I reported
   that black as a map defect. It was my instrumentation.
3. **The console buffer is not cleared between navigations.** An error with the
   same line and the same value after you have edited the file is almost
   certainly the old one. Open a fresh tab to be sure.
4. **Cache-bust the URL** after editing, or you will test the previous file.

For the fastest honest read on rendering cost, time the draw functions
synchronously against a box you set yourself, rather than counting frames:
`requestAnimationFrame` is throttled when the pane is not displayed.

---

## What was done next, with the client to hand

1. **The planet stopped costing what it was worth.** Measured on a 1388-wide
   canvas it took 42ms a frame at zoom 1 and 25ms at 0.4, rebuilt from cold
   every frame the view moved — about fourteen thousand small `drawImage`
   calls. Three changes: the sphere is skipped entirely once a screenful of it
   is flat to under half a pixel (`roundWorld`), which is every close zoom;
   the disc is built at one pixel to the pixel rather than the screen's grain
   while nothing stands on the ground; and the tolerance and band depth are
   loosened over the same range, because the tight ones are only there so that
   creatures land on their own ground. 42ms became 1.9, 25 became 2.3, and the
   close zooms became free.
2. **The realm stays in front of you.** The middle of the view is held inside
   the realm with as much slack as there is realm left once the window has had
   its share — so the slack falls to nothing as you pull back and zooming out
   always ends looking at the island, never at empty ocean.
3. **Turning turns the world.** It used to route to the flat camera, so the
   map slid about under a planet that stayed still. The chart is spun before
   it is bent onto the ball now, which is the order the things standing on it
   already went through. **a** and **e** turn it, as in the game; they are a
   published feature, not part of the bench.
4. **What does not belong on the map is turned away as it is built,** from
   `data/Realm/off-the-map.txt` — by the class the client files a thing under
   rather than by a picture id, so it survives regeneration. That is what the
   list of `things.png` ids in `prune-map.js` could not do. 5,219 placements
   went: 2,270 other players, 272 of their pets, 382 pet effects, 2,267 loot
   bags. Add a line to the file when more turns up.
5. **The Dead Church was cut in two along its wildlife.** Both halves are laid
   with the same grass, so no reading of the floor could ever separate them —
   but their creatures are not mixed: 1,586 that name HigherPlains stand about
   a point in the south-west and 703 that name DeadChurch about a point two
   hundred tiles north-east. `cleaveByLife` in the atlas build cuts a patch
   where the two voices are equal. It is deliberately shy — two terrains each
   holding a quarter of the vote, sixty voices, their middles a fifth of the
   diagonal apart — and on this map it fired exactly once.
6. **The three across the top are Floral Escape**, and the rest of the Dead
   Church is the High Plains. Written in `data/Realm/zone-names.txt`. Both
   biomes now have a zone for `merge-realm-roles.js` to attach to, which took
   it from 34 zones with a cast to 38 of 40.
7. **Fifty-six encounters and heroes had no picture anywhere.** They are all in
   the client; the difficulty was only that it does not call them what the wiki
   does. `tools/boss-sprites.js` matches a name three ways — the id, the
   DisplayId, and a single containing name — prints every match with the client
   id it came from, and writes into `web/assets/realm-monsters` where the
   roles tool already looks. 48 found, and 103 pictures now travel with the
   atlas. The nine still missing are seasonal event bosses not in this build:
   Hat God, Ice Cube God, Jolly Sphinx, Snow Shrine, Wrapped Dragon,
   Chocolatier God, Hopping Goliath, Porcelain Egg, Spring Cabbage.
8. **The side panel** shows the zone's rank, its encounters and Heroes of Oryx
   with their pictures, what was met there, its beacons and their guardians,
   and what the floor is made of. Wider, and with the contrast it lacked.

Two matches in step 7 are worth an eye: *Rock Dragon* came from
`LOD Rock Dragon Head` and reads as an orb rather than a dragon, and
*Flying Behemoth* is smaller than the name suggests. Both are the client's own
naming; neither has been checked against the wiki.

---

## Still to do

Roughly in the order it was asked for.

- **The side panel.** Small, cramped, low contrast. Should show the zone's
  monsters by role (encounters, Heroes of Oryx, regular — the roles are in the
  data now), its rank, its ground, its beacon and that beacon's guardian.
- **Clicking a monster** for a summary of what it drops, with animated sprites
  for the items and dungeons where they exist. Needs the RealmEye `detail`
  fetch above.
- **Spawners.** Already marked `spawner: true` in `atlas.json`; nothing shows
  them yet. What spawns what needs `reproduction` from the same fetch.
- **More monsters.** 193 creatures have art in `web/assets/realm-monsters/` and
  are not on the map; 54 of those have an animated `.webp` as well. The
  RealmEye `regular` lists match those keys.
- **Two biomes still have no zone**, and both are seasonal: `eternal-frost` and
  `spring-of-meaning` are not in this realm at all. The other two are done —
  the High Plains were cut out of the Dead Church along its wildlife, and the
  Floral Escape is the three patches across the top.
- **The biome-to-zone join is worth re-reading.** Two of its lines were arrived
  at when the zone names were poor, and look wrong now that they are not:
  `low-plains` points at "Mid Plains" and `mid-plains` at "Mid Desert". They
  were left alone rather than re-guessed, because a wrong attach puts the wrong
  monsters on a place.
- **The pet-egg bag is answered.** Bags are turned away by the class the client
  files them under rather than by their picture, so a colour nobody has seen
  yet goes with the rest. `Treasure Chest` and `Realm Fishing Rod Dropper` are
  kept by name, because they are furniture.

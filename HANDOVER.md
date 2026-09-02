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

## What is not available here

Two data sources the repository is designed around were out of reach, which
shaped what could and could not be done.

**`client-data/` is absent** (gitignored; rebuilt from an installed game
client). Without it there is no regenerating the realm data from source, and
the atlas generator itself is not in the repository at all — only the tools
listed below, which work on the committed assets.

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
- **Three zones are missing.** The imported data has 24 biomes; 20 have a zone
  here. `high-plains` and `floral-escape` have none at all, although the
  capture is full of Floral Escape creatures and a Floral Escape beacon
  guardian — their ground was absorbed into whatever the segmentation decided
  was next door. Zone 5 "Dead Church" is 68% *Dead Church Grass Light* and 23%
  *Dead Church Grass Dark*, which is very likely Dead Church and the Withered
  Plains merged. Splitting them properly wants the per-tile ground types from
  `client-data/capture/realm-map.json`, which is not here; the fallback is
  classifying the rendered `z0` pixels by colour, which is a heuristic and
  should be shown as a before-and-after rather than pushed quietly. Floral
  Escape is the three biomes across the top of the map.
- **A bag with a pet egg** is still on the map somewhere; the loot-bag
  silhouette family only turned up four colours and the brown one may or may
  not be it.

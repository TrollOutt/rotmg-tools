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

    node tools/realm-render.js --copy       the ground, the water, the standing layer
    node tools/realm-atlas-build.js         the pyramid, the zones, the page
    node tools/merge-realm-roles.js         the ranks and the cast
    node tools/refine-outline.js            the black line round everything, once
    node tools/build-sky.js                 the weather sheet, from the drawn clouds
    npm run build                           web/ copied into docs/

`--atlas=DIR` sends the third at a copy; `--publish` on the second writes into
`web/assets/atlas` instead of `local/atlas`. `prune-map.js` is no longer part
of this: what does not belong on the map is turned away while it is being
built, from `data/Realm/off-the-map.txt`, so it never comes back when more of
the realm is walked.

**Changing only the page needs none of the above.** `--page-only` reads the
`atlas.json` already sitting in the output directory and writes a fresh page
beside it, through the same code a full build ends with:

    node tools/realm-atlas-build.js --page-only --publish

That is the whole loop for template work on a machine with no client, and it
is exact rather than approximate — run against an unchanged template it
reproduces the committed `index.html` byte for byte, which is worth checking
first if you ever doubt the two are in step.

Two of those four are in the repository and one is not, and the difference is
worth being exact about.

**The page is generated.** `web/assets/atlas/index.html` is built from
`tools/atlas-viewer.html`, **which is now in the repository**. Working on the
built file directly means the next build throws the work away — that happened
once, and cost six hundred lines of globe and zoom work that had to be lifted
back into the template by hand. Change the template. `realm-atlas-build.js` is
here too, so a change to the template can be checked against the thing that
inlines it.

### Why realm-render.js is not here

It works from a local `client-data/` that is not published, so a clone cannot
run it whatever else it has. Publishing the file would put a build step in the
repository that nobody outside can execute, which is worse than an absence that
is written down.

What follows from that, for anyone working without it:

- The chunk pyramid, `things.*`, `water.*`, `sky.*`, `oryx.png` and `mask.png`
  cannot be regenerated on a machine that has neither the client nor the
  recordings. They must be taken from the repository as they stand.
- A template change *can* still be checked, because `realm-atlas-build.js` is
  here: point it at an existing `local/realm-copy` if you have one. Without
  one, the honest check is to read the inlining in `realm-atlas-build.js` and
  to have the change built on the machine that can build it.

### What the build writes, and what is source

Everything under `web/assets/atlas/` is written by the chain above. None of it
is edited by hand, and an edit to any of it is lost on the next build:

    index.html          from tools/atlas-viewer.html, with atlas.json inlined
    atlas.json          zones, biomes, beacons, the cast, the focus box
    z0/ z1/ z2/ z3/ z4/ 389 ground chunks, five scales
    things.png/.json    the standing layer's sheet and its table
    things.bin          (pic, x*8, y*8) triples, three uint16 each
    mask.png            R biome, G flags, B zone
    roads.png           water.png water.json water-art.png
    sky.png sky.json    the weather, and Oryx's rectangles within it
                        (the clouds also by tools/build-sky.js — see below)
    oryx.png            his head and his two hands
    life/               316 creature portraits
    boss/               103 encounter portraits

`docs/assets/atlas/` is a copy of all of it, made by `npm run build`. Never
edit either.

The sources that are in the repository, and are edited by hand:

    tools/atlas-viewer.html       the page
    tools/realm-atlas-build.js    the pyramid, the zones, the inlining
    tools/merge-realm-roles.js    tools/refine-outline.js
    data/Realm/off-the-map.txt    what is not the realm
    data/Realm/zone-names.txt     what the places are called
    data/Realm/oryx-head.png      data/Realm/oryx-hands.png
    data/Realm/clouds/            the sky, if anyone draws it

### The sky

`sky.png` and `sky.json` hold the rectangle of every cloud on the sheet and
Oryx's three rectangles beside them. Oryx's point into `oryx.png`, not into
the cloud sheet, so the two halves of that file are independent.

The clouds are drawings now and they live in the repository:

    data/Realm/clouds/NN-name.png   one cloud per file

Taken in the order the names sort — hence the numbers, because the page picks
a cloud for each of its banks by index and a bank that changes shape between
builds is a bank that visibly jumps. Each file is honoured for the alpha it
already carries, trimmed to what is actually drawn, and eased down by
averaging whole blocks. There are twenty of them, cut out at 1254 square,
coming to a 904 by 294 sheet.

**Two things write those files, and that is deliberate.** `buildSky()` in
`realm-render.js` does it as part of a full build, and `tools/build-sky.js`
does the clouds alone. The second exists because the first reads the
recordings and is only on the machine that has them, while the clouds are
drawings that have nothing to do with either — so without it there was no way
to put a new sky in front of anyone from anywhere else. It reads the same
folder under the same rule and leaves the Oryx rectangles exactly as it found
them, so the two agree; if you change how a cloud is cut, change it in both.

The one number they can silently disagree about is how wide a cloud may be:
`CLOUD_MOST` in `realm-render.js`, `WIDEST` in `build-sky.js`. They were 110
and 128, which meant a full build and a clouds-only build produced different
sheets and the sky jumped between them. Both are 128. Move one, move the other.

### One byte a tile, and four things that do not work

`water.png` is a lookup rather than a picture: one number per tile saying which
of the eleven drifts it has. It was written as four channels with three of them
copying the first, and it is the largest single thing the page fetches before
it can draw anything. It is written by `writeGreyPng` now — 981 KB down to 714,
pixel for pixel the same. The page needed no change, because a grey PNG drawn
onto a canvas comes back out of `getImageData` with red, green and blue all set
to the value, which is what the reader was taking anyway.

Four other savings were measured and rejected, so that nobody spends an
afternoon rediscovering them:

- **Dropping alpha from the ground chunks saves nothing.** Deflate already
  compresses a plane of constant 255 down to almost no bytes at all.
- **Deflate level 9 on the chunks saves 4%**, for a build several times slower.
- **A 256-colour palette saves 49% and is lossy.** The chunks carry between six
  hundred and four thousand colours each; quantising bands the ground visibly.
- **Per-scanline PNG filtering, the textbook trick, makes `water.png` bigger** —
  836 KB against 714. It is long runs of one value, which is exactly what
  deflate is best at and exactly what a difference filter destroys. Every
  uniform filter was tried as well; none beat none.

What is actually expensive is the history. `.git` is around 700 MB, because a
PNG that changes at all is stored whole and there are 391 of them in two copies.
The builds are deterministic, so a rebuild that changes nothing costs nothing —
but every real growth of the map pays for the whole pyramid again.

## What is not available here

Two data sources the repository is designed around were out of reach, which
shaped what could and could not be done.

**`client-data/` is absent** (gitignored; rebuilt from an installed game
client). Without it there is no regenerating the realm data from source. The
page and the atlas builder are in the repository now; the renderer that reads
the recordings is not, for the reason set out above.

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

## The camera, and what is standing behind the world

The camera used to be fenced inside the charted ground. It is not any more:
the world rolls freely, at any distance and at any turn. What keeps you from
losing it is `keepInSight`, which measures how much of the realm is actually
on the glass and, if that falls to a fifth or less for three quarters of a
second with nothing held down, walks the view all the way back to the distance
and the place the map opens at.

That measure is the part worth knowing about. Reckoned flat it is useless -
pulled back, the window is thousands of tiles across and always contains a
realm one thousand tiles wide, however far the camera has been walked from it.
What really happens on a ball is that the realm rolls round the side. So
`realmInView` sprinkles the realm with a grid of points, puts every one of
them through the same `place()` the ground is drawn with, and adds up those
that land on the screen, each weighed by its own `k` so ground crushed into
the limb counts for the little of it you can see. Then it does the whole thing
again from directly over the realm, and returns the ratio. The second count is
what stops the rule from firing when you are simply standing close: nose
against a field, you see one field's worth of realm and there is no more to be
had, so both counts are small and the ratio is one.

The one limit still kept is `floorZoom`, and it is now `FURTHEST = 0.22`
rather than 0.3, which leaves room above the world for Oryx.

He is built, not borrowed - `buildOryx()` in the render tool. The client has
him at sixteen pixels square holding a sword, which at the width of a planet
is a smear, so the head and the hands are sculpted instead: strokes stamped
into a field that keeps how deep below the surface each pixel lies and how
thick the stroke was there, a height from those two, a normal from the slope
of the height, and one lamp. Pressing the height to about a third of its true
value is what keeps a face from being a heap of shiny balloons. He is the only
thing on the map that is not the game's own art, and `ORYX_FROM` is written in
floors rather than in zooms so that he is never showing at the distance the
map opens at, whatever the window is shaped like.

## The weather, the camera and the site — third session

Ten things were asked for on the atlas and four on the site around it. Two of
the ten had already been done from the other machine (the line round the
chart, and everything that had overgrown the map), which is worth checking
before starting: measure first, and the list may be shorter than it looks.

### The weather is in front of the camera now, not on the map

It used to be laid out in tiles and put through the same projection as the
ground — defensible, and wrong to look at: drag the realm and the sky came
with it, as though the whole sky were painted on the glass of the map rather
than hanging in front of it. A bank has a place on a disc of sky instead, and
the realm slides about underneath it.

The sky is the smaller of the world and the window, and the handover between
the two is invisible because they are the same size at the moment it happens:
the disc reaches `SKY_SPAN` of the screen diagonal just as the weather starts
to lift. Below that the sky is the disc and is clipped to it, since there is
black space round a small planet and no weather belongs in it; above it the
ground fills the window and a bank shoved out of frame should leave by the
edge of the glass.

Coming down through it is the whole of the effect, and two curves make it
read. The shoving is the *square* of the approach, because the approach is
measured by ratio and a straight reading has the sky parting within a notch
or two of the wheel — squared, the first half barely moves them and the
second half throws them past the edges. And the fading is deliberately out of
step with the shoving: a bank holds nearly full weight for the first half and
gives it up over the second, because a cloud that thins at the rate it
travels reads as weather evaporating in place rather than being pushed aside.

Forty-four banks, dealt the twenty drawings round and then shuffled rather
than rolling one each — rolled, some shapes came up six times and two never
came up at all, and a fixed seed means never is for ever. Seventy-eight banks
of the drawn clouds came to twice the area of the planet and left the realm as
glimpses between them; the arithmetic ones they replaced were faint enough
that seventy-eight read as haze.

### Oryx is re-lit in the page, not in the picture

The sheet arrives lit for space — dimmed and tinted by how far each part of
him lies from the world below and the lamps in his helm. Right idea, wrong
amount, in both directions. The world is blue, so a gauntlet holding it came
back the colour of cold steel: nearly half the pixels of a hand were bluer
than red and the claw rims peaked at 179,227,253, which is chrome, not
armour. And the head, lit from the front by its own fire, ended as a bright
crimson silhouette cut cleanly out of the night.

So `oryxPaint()` re-lights the sheet once, on first use, into a canvas of its
own. The hands are pulled towards the darkest of their own three channels —
not towards their red, since half of these pixels are warmer than they are
cold and pulling those towards red would brighten them — and then dimmed
hardest where they were brightest. Measured: peak 178,227,253 to 87,95,95,
and pixels bluer than red from 47% to 10%. The head keeps its fire and loses
its outline, by a two-pass distance transform from the silhouette: within
`HEAD_DEEP` pixels of the edge it goes down towards nothing, and anything
much redder than it is anything else is spared, so the seams and the eyes are
untouched. Measured: the five-pixel rim from 45.3 to 28.3, the core from 41.0
to 37.8.

It is done in the page rather than in the picture because the picture is
baked on the machine with the client, and the amount of it is a thing to be
looked at and changed. `HAND_CAST`, `HAND_LIGHT`, `HAND_SHEEN`, `HEAD_RIM`
and `HEAD_DEEP` are the five numbers.

### Coming home is a walk, not a step

Asking every frame whether the pin is over water, and drifting only while the
answer is yes, ended the walk the moment the answer changed — and the first
thing the pin meets coming in from open sea is the coast. So the view came
back as far as the edge of the map and stopped, with the realm hanging off one
side of the window: rescued from looking at nothing and left looking at a
corner. The question is asked once now, to start the walk, and the walk
finishes what it began; a hand on the map or a turn of the wheel ends it, and
it re-arms by itself. Measured from three starting points: it lands within
four to ten tiles of the middle of the focus box.

### The wheel over nothing at all

Past the limb of the world there is no tile under the pointer and the
projection says so by answering with `NaN` — which went straight into the
middle of the view, and a view with no number for a middle draws no ground,
no things and no weather. Standing right back, the whole outer half of the
window is off the world and Oryx's hands are out there in it, so a roll of the
wheel anywhere over a hand blacked the map out until the page was reloaded.
With nothing under the pointer there is nothing to hold in place, so the zoom
now simply happens about the middle of the view.

### What the map cost, and what it costs now

Three things, and the first two are worth more than they sound.

**A band of the world is as deep as the curve allows.** It used to be three
pixels everywhere, and three pixels is the right answer in exactly one place:
the far view, where the disc is small and the ground near the limb turns away
almost vertically. Come in to five tiles a pixel and the world is twelve
thousand pixels across, the window covers a thirtieth of a radian of it, and
the curve across that is measured in thousandths of a pixel — and it was
being taken in three-pixel slices, three hundred and sixty of them, thirteen
pieces each. The depth is chosen from the error now, the way the width beside
it already was, and two bounds pull it in: the bend down the band, and the
squeeze from drawing a whole band at one `cos(lat)`. **The second is the one a
naive version gets wrong** — leave it out and the far view, where it is the
binding one, gets forty-pixel bands and eleven pixels of error.

**`FLAT_ENOUGH` went from half a pixel to a pixel and a half.** At a half the
world stayed round until about nine tiles to the pixel, which is past where
the closest level of ground comes in — and that level's water drifts, so the
disc could not be kept between frames. A pixel and a half puts the changeover
just below it. The round silhouette is never what is given up: at the
changeover the world is `reach^1.5 / sqrt(6 * FLAT_ENOUGH)` pixels across,
which exceeds `reach` for any window bigger than a few dozen pixels, so the
limb is always far outside the frame when it happens. The water is also given
a fixed moment while the world is round, so the disc can be kept at the
closest level too — that is for large windows, where the world stays worth
bending well past the point the closest level arrives.

**The scenery is capped by how thickly it lies.** The standing layer is one
`drawImage` per piece and a piece costs about five microseconds however small
it is — the mean piece where scenery arrives covers seventy pixels, so nothing
is being filled; it is the call. Measured at 1920 by 1080 the moment the
closest level comes in: 32,836 things scanned, 7,059 in frame, 5,335 drawn,
27.3 ms of blits against 2.5 for the scan and 0.4 for the sort. Ninety per
cent of the frame is blits and there is no arithmetic to take out of it, so
the only move is to draw fewer. Every chunk is allowed the same pieces per
tile and a chunk over its share keeps a fixed fraction, so a crowded wood
thins and open ground is untouched. Because the allowance rises as the square
of the zoom and a chunk's thickness is constant, the fraction only grows as
you come down: a piece being drawn stays drawn, the rest arrive as you get
closer, and panning changes nothing. Which pieces are kept is a hash of where
they sit in the file. Anything taller than `THING_BIG` is kept regardless —
what is thinned is the clutter, and where this bites four fifths of the layer
is one ten-pixel tuft.

Whole frames, mean over twelve, panning, on this machine:

| zoom | 1280x720 before | after | 1920x1080 before | after |
| --- | --- | --- | --- | --- |
| 1 | 2.3 | 0.7 | 4.2 | 0.9 |
| 3 | 7.2 | 1.2 | 12.3 | 1.5 |
| 5 | 5.5 | 0.6 | 10.9 | 1.0 |
| 5.7 | 19.0 | 9.8 | 35.7 | 12.3 |
| 8 | 3.2 | 5.8 | 16.5 | 13.0 |
| 20 | 3.5 | 1.2 | 2.8 | 2.5 |

The band from one to five is ten times cheaper; the closest level is about
twice. What is left at 5.7 to 8 is the blits, and `THING_MANY` is the one
number that trades detail for frames there.

### The site around it

- **One switch for everything that moves.** It used to sit in the Enchant
  Calculator's masthead, in twelve-point grey, saying "Realm" — so on four of
  the five pages there was no way to stop the movement at all. It is fixed in
  the top right of every page now, says which way it is set, and reaches the
  atlas: the frame is sent `{rotmg: "animate", on}` and freezes the clock its
  moving things read, while still drawing, so dragging and zooming carry on
  working. Turning it back on picks the clock up where it left off rather
  than jumping forward and flinging every cloud across the sky. Fixed means
  out of the flow, so every masthead was given room on the right — without it
  the switch sat on top of "Reset everything" and made it unclickable.
- **One base of item artwork.** There were two sets and neither knew about
  the other: `assets/items` holds sixteen hundred still icons and is what the
  calculator reads, `assets/whats-new` holds the hundred-odd pieces cut from
  the newest client — every item the last update added — and was read only by
  the What's New page. So an update's own items were the only ones in the
  picker with no picture. `foldNewsSprites()` joins them, and is the only
  place that happens: nothing is copied and nothing is moved, the curated icon
  wins where there is one, and stills only, since a multi-frame clip is one
  strip in one file and an `<img>` pointed at a strip shows the whole run. The
  next update needs no work. The three Venerable rings have art in neither set
  and keep their slot glyph.
- **The data line carries two dates.** The update the items and notes cover,
  and the client the enchanting odds were read from. Both, because they are
  not interchangeable and showing only the newer would claim the odds are as
  fresh as the news. The build id, which means nothing to anybody, moved to
  the tooltip. The update date is read out of the What's New index during the
  sprite load, so the line costs no fetch of its own.
- **A banner was cut in half.** `nchant Calculator ----- -->` was showing as
  text at the top of every page: the Realm Atlas page had been inserted above
  What's New and taken the banner belonging to it, and the opener of the next
  one had gone with the edit. All three are back.

### Two smaller things found on the way

- **The bench cut assumed bare newlines.** `realm-atlas-build.js` strips the
  bench out of any published copy with three patterns spelled `\n`, and the
  template is checked out with carriage returns — so all three missed, the
  guard behind them fired, and publishing stopped dead on a fresh clone. They
  are `\r?\n` now. This would have bitten the next publish from anywhere.
- **The frame clock cannot run backwards.** `delta` had no lower bound, and
  everything downstream multiplies by it, so a clock that went backwards drove
  the easing, the walk home and the creatures backwards with it.

### What came back from showing it — and the sea, finally

Everything above was looked at and sent back with notes. The notes were
right in every case, and two of them found things no amount of reading the
code would have.

**A cloud does not wander the sky on its own.** Given a drift each they
spread evenly across the glass within a minute or two, and what was left
looked less like weather than like a screensaver. So the banks belong to
fronts: nine systems, one drift each, and every bank keeps its place in its
group for good, so they arrive together, cross together and leave together.
What stops a group looking welded is a slow sway of its own per bank - not a
drift of its own, which is the obvious thing to reach for and pulls the
group apart over a few crossings.

The wrap goes with it. Banks used to thin away and return one at a time over
the last of their own run, which is fine when each drifts alone and no use at
all for a group - a front fading through its own tail tears in half in plain
sight. The run is three and a half skies wide now, so a front is well clear
of the window before it wraps, and nothing fades at the edges at all.

**Drift is in sky radii a second, and that is the only reading that works.**
The sky is the planet at one end of the range and the window at the other, so
anything in pixels is four times too fast at one end or invisible at the
other. A front crosses the whole sky in a minute or two at any zoom.

**The weather is finished before you are reading a zone.** `CLOUD_GONE` has
come down twice for the same reason - seven left cloud at three tiles to the
pixel, three and a half still left it over a zone gone into on purpose. It is
1.9, and the map is read from about 1.5 upwards. That still leaves a dozen
turns of the wheel between thickest and none: the range looks short written
as two numbers only because every turn multiplies.

**They swell as they part.** A bank is drawn at a share of the sky and the
sky stops growing once it is the window rather than the planet - so above
about two thirds of a tile to the pixel the clouds held one size in pixels
however far you came in, which reads as flying towards a painted backdrop.
Between growing and being shoved outwards they are out of frame well before
the last of their weight goes, which is what makes it the camera pushing them
aside rather than the weather thinning out. Thirty-three pixels at the far
view to nearly seven hundred coming down through them.

**Each cloud is kept at four sizes.** Drawn at thirty pixels off art that is
a hundred and twenty-eight wide, the browser throws away three pixels in four
in one step - and one step of bilinear samples rather than averages, so half
the drawing becomes a fine crawling sparkle exactly where the clouds are
smallest and there are most of them. Halved twice with the good filter at
load, and drawing takes the smallest copy still larger than what it wants.
Standing back now gives a simpler cloud rather than a noisier one. Cutting
them out separately also settles the single pixel between neighbours on the
sheet, which at a quarter of its size starts bleeding into its neighbour.

**Coming home waits three seconds.** Starting the walk the instant the pin
crossed into open water was worse than the bug it fixed: pushing out over the
sea to look at the coast from outside is a thing you do on purpose, and the
camera hauling itself back mid-gesture reads as the map fighting you. It waits
for three seconds of stillness, and stillness means the view has stopped - no
hand, no wheel just turned, and the easing settled to under half a pixel on
the glass. Measured: it starts at 2.92 s left alone, and 3 s after any nudge.

**The animation switch does not reach the atlas.** It did for a while, and it
worked, and it is not what the switch is for: the atlas is a map you are
looking at rather than decoration behind something you are reading, and its
weather is part of the map. Both halves of that wiring are gone rather than
just the sending, since the other half was then dead code.

**And the atlas has no heading.** A title and a sentence of mouse
instructions sat across the top of it, over the sky. The map says both
itself. All that is left is the way back.

#### The line round the chart, for the third and last time

This has now been diagnosed wrongly twice, by two different sessions, and it
is worth writing down why - the same trap is waiting in anything that draws a
boundary between the chart and the paint.

The complaint is a hard vertical line in open sea with mottled water on one
side and flat water on the other. **It is not the colour.** The chart and the
paint have been the same blue for a while; measured across the recorded sea,
mean 62.5/103.3/178.4 against 62/102/178 painted. What gives it away is the
*grain*: recorded water is a different shade in every tile and flat paint is
the same shade everywhere, and the eye finds that border instantly without
being able to name a colour difference.

The first answer was to rub the last fifty tiles of the chart away into the
paint, at `B.minX` and its three companions. That was aimed at the wrong
place, and finding out where the right place is took a scan of the picture
rather than a reading of the code:

- `B` is the recorded bounds, and the floor is drawn by whole chunks of a
  hundred and twenty-eight tiles. `B.minX` is 245 and the chunk boundary is
  128, so the pyramid carries ground a hundred and seventeen tiles west of
  the bounds - seventy-six north, seventy-seven south, and none east, where
  `maxX` happens to land on a boundary. At one tile to the pixel the gradient
  was a hundred and seventeen pixels inside the picture and the real edge was
  as bare as it started.
- Aligning it to the chunk grid did not fix it either. Scanned a column at a
  time, the ground on that row begins at tile 162 - neither the bounds nor a
  chunk boundary. The chart ends where the *recording* ended, which is a
  ragged line inside the rectangle, and no arithmetic in the page can
  predict it. Any gradient laid down by guesswork leaves the real edge bare
  somewhere along its length.

So the paint is given the grain instead, and then it does not matter where the
border falls. A small tile of noise at the measured wander - about one part in
a channel of red and two in green and blue - laid down once per disc and
scaled so its cells are game tiles at whatever zoom is current. Measured
after: the grain across the whole width is 3.1 to 3.7 at one tile to the
pixel, against 2.4 to 4.2 for the chart beside it, with no step anywhere.
Before, it went from 0.00 to 2.75 between two adjacent columns.

**If you touch this again: measure the grain, not the colour.** Mean absolute
difference between a pixel and its neighbour two along, over a tall thin
column, is the whole diagnostic - and it must be a *difference*, not a
standard deviation, or the limb shading reads as texture and you will chase
it for an hour. The rubbing at the edge is still there and still does no
harm, but it is no longer what is holding the join together.

### Two traps in the atlas worth not falling into twice

**A window that grows pins the zoom to the floor.** `keepInSight` clamps the
zoom up to `floorZoom(box)`, and `floorZoom` rises with the window - so a view
that was fine under the old floor is under the new one, and the clamp lands it
exactly *on* the floor. That is the one distance the map is not meant to sit
at, because the floor is where Oryx lives. Embedded in a panel that opens out
to four times its size it happened every time, and it looked like the easter
egg being broken rather than like a resize bug. A box that has changed shape
and left the zoom below its floor now gets a fresh fit rather than a clamp: it
is the window that invalidated the view, not the reader.

**Do not give an embedded atlas a deadline; give it a number of frames.**
Telling it to re-fit "for six hundred milliseconds" while a host panel opens
out does not work, and it looks like it does. The half second the panel takes
is also the half second the atlas spends fetching and decoding ground for a
box that just quadrupled, so the window can pass with no frame drawn inside it
at all. A count comes off one frame at a time and cannot be skipped however
busy the browser is. The message is `{ rotmg: "settle", frames: N }`; it also
shuts the zone panel, since the frame it was sized for is about to change.

## Still to do

Roughly in the order it was asked for.

- **Meteors that pass close, drawn as a white bag.** Asked for and not done:
  some of the shooting stars behind the planet should come near the camera,
  and those ones should be a white loot bag rather than a streak of light. The
  work left is finding the sprite. It is **not** in the tree any more: bags
  are turned away by `class Container` in `off-the-map.txt`, so the pruned
  `things.png` no longer carries them. It is in history, in the sheet at
  `7d917a2:web/assets/atlas/things.png` (2048 pictures, against 2029 now),
  with its table beside it at `7d917a2:web/assets/atlas/things.json`.
  Searching that sheet for small pale sprites turns up twelve candidates and
  **picture 1238 is the pet egg, not a bag** - white, black-outlined, 14x18 on
  the sheet, which is 7x9 of art at `ss` 2. The bag is somewhere else in those
  2048; a contact sheet of every picture under 24 pixels is the way to find
  it, since the table holds no names. Once found: cut it out to
  `data/Realm/white-bag.png` and have `tools/build-sky.js` pack it into
  `sky.png` with its own rectangle in `sky.json` - that file is already
  fetched by the page and already written by a tool in the repository, which
  no other atlas asset is.

- **The client has not been read since 23 August.** The data line says so
  honestly and now shows the update it covers beside it, but the enchanting
  odds themselves are still that reading. `npm run scrape` and
  `node tools/read-client.js --snapshot` want an installed client, so this
  can only be done from the machine that has one; the What's New index
  already knows about a newer one, which is where the second date comes from.

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

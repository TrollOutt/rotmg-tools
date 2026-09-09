# The Index — where the work got to

Written to be picked up on another machine. Everything below is about the
Index module: `tools/build-index.js`, `tools/index-sprites.js`,
`web/index-page.js` and what they write into `data/Index/` and
`web/assets/index/`. The other four tools were not changed by it.

---

## Read this first

The identity and commit-style rules in [`HANDOVER.md`](HANDOVER.md) apply here
too, and they matter more than anything in this file. Pin the git identity
before the first commit in a fresh clone — the hook that enforces it lives in
`.git/hooks/` and is never cloned.

### A fresh clone is enough to work

Nothing has to be fetched, installed or copied. `git clone`, and:

```bash
npm test          # 196 checks, and the odds against the client's own numbers
npm run build     # the whole site -> docs/
npm run dev       # serve it at http://localhost:5173
```

Both were run from a clean clone of `main` to make sure. There are no
dependencies to install: `package.json` declares none and the two scripts that
need a server reach for `npx serve` when they are called.

**Everything the index shows is committed** — `data/Index/index.json`, its
`wiki.json`, the sprite sheet under `web/assets/index/`, and the built site in
`docs/`. So the page runs, and can be changed and rebuilt, on a machine that
has never seen the game.

### The two things that are not in the repository, and why

| | |
|---|---|
| `client-data/` | The installed game's XML and textures. DECA's, large, and reproduced in seconds from any install. Gitignored. |
| the wiki snapshot | Somebody else's scrape of RealmEye. Not ours to publish. Named by an environment variable, never by a path in here. |

Neither is needed to build or to change the site. They are needed only to
**re-read the sources** — that is, to pick up a new game patch or a newer wiki.
Both tools that want them say so plainly and exit rather than failing, so
running the whole chain on a machine without them is harmless:

```bash
node tools/extract-client.js        # needs the game installed
node tools/build-index.js           # records and links   -> data/Index/
node tools/index-sprites.js         # pictures            -> web/assets/index/
REALM_INDEX_BUNDLE=<path> node tools/index-wiki.js   # community links
node tools/index-art.js             # the card's book     -> Page Art/Index.png
npm run build                       # the site            -> docs/
```

The first three must run in that order. The sprite tool reads
`data/Index/index.json`, writes the rectangles back into it and copies the
result to `web/assets/index/`; running only the first leaves the served copy
without art. The wiki step is optional — see [Community links](#community-links).

`tools/index-art.js` is the odd one out: it needs neither the client nor the
snapshot, only `data/GUI Files/Page Art/Index-sheet.png`, which is committed.
It finds the twenty frames on that contact sheet, lines them up by the foot of
the book rather than by their bounding boxes — the glow grows and shrinks, so
boxes would make the book jump — and writes one strip the card walks along.

**A rebuild changes only the date it stamps.** The build reads every text file
with its line endings settled, so a clone that checks out CRLF produces the
same page as one that checks out LF; the only line that differs from one
machine to the next is the `built` date. Commit that or discard it as you like.

---

## What the index is for

The other four tools each read the client for themselves and each decide what
to keep. So when an item is missing from the bench, or an enchantment from the
calculator, there was nowhere to look up whether the thing exists at all. The
index is that place: **everything the client declares in the families the site
deals in, whether or not any tool shows it**, with, for each one, where it came
from and why a tool might be hiding it.

It records declarations. It does not compute damage, cost or odds, and it does
not decide what a tool should show — the tools keep their own rules, and the
index says what those rules hid.

Current reading, from a client of 2026-09-08:

| kind | count | kind | count |
|---|---:|---|---:|
| enemy | 5,167 | pool | 55 |
| item | 4,396 | place | 19 |
| enchant | 1,016 | class | 19 |
| portal | 220 | set | 125 |
| | | **total** | **11,017** |

6,021 links across seven kinds, 138 source documents.

**A portal is a dungeon**, and the index keeps all 220 of them with their own
art, because the community's drop lists are made of dungeon names and a card
that could not draw one was the poorer for it.

**A place is a biome, once.** The atlas keeps five separate patches of Low
Forest because they are in five places on the map; the index adds them up, so
19 places rather than 37 chips reading the same word.

**The same object declared twice is one record.** Four hundred definitions
appear in two documents at once — `Objects.002` and `Objects.113` both hold the
Frozen Chest, same type, same life, same art. A type is the client's own number
for a thing, so the same number under the same family is the same thing however
many files repeat it; the second sighting adds its document to `also` and stops
there. That is what took the creatures from 5,577 to 5,167.

---

## The shape of a record

`data/Index/index.json` is one object:

```
{ built, files: [...names], kinds: {kind: count}, links: n,
  sheet: {wide, tall}, records: [...] }
```

and a record looks like this:

```json
{ "id": "item:Doom Bow", "kind": "item", "name": "Doom Bow",
  "from": [12, "0xc02"],
  "slot": 3, "hand": "weapon", "rate": 0.33, "shots": 1,
  "fires": [{ "low": 500, "high": 600, "reach": 7, "through": true }],
  "worn": { "MAXHP": 80 },
  "does": [["Alien Catalyst", "Gain strength based on..."]],
  "bench": 1, "ench": 1,
  "labels": ["EQUIPMENT", "WEAPON", "BOW", "UT"],
  "about": "No mortal can fire this dreaded bow...",
  "pic": "wiki",
  "art": [248, 512, 8, 8],
  "out": [["rolls from", "pool:Default Enchantment Pool"]],
  "in":  [["same name as", "item:Doom Bow#Doom Bow Shiny"],
          ["same name as", "item:Doom Bow#Retro Doom Bow"]] }
```

**`id` is `kind:name`**, where the name is what the game shows. The client's own
id is kept beside it as `alias`, because that is what the art and the XML are
filed under and half the joins need it. Neither is unique across the client, so
the pair is what makes a record findable.

**`from` is `[file number, type]`.** The number indexes `files`, the list at the
top. 138 documents against 11,000 records: spelling the file name out on every
one of them costs half a megabyte to say the same forty things over and over.

**`out` and `in` are the same 6,021 links seen from both ends**, each a
`[how, id]` pair. There are seven kinds of link:

| how | n | between |
|---|---:|---|
| `same name as` | 2,208 | records the client filed under one display name |
| `rolls from` | 2,071 | item → enchantment pool |
| `made of` | 1,112 | set → its pieces |
| `wakes` | 144 | item → the awakened enchantment it unlocks |
| `was seen in` | 122 | creature → biome |
| `favoured by` | 58 | enchantment → a pool that names it by hand |
| `starts with` | 57 | class → its tier-nought kit |

**`was seen in`, not "lives in".** The list comes from walking the realm and
writing down what was standing there. The realm was walked during an alien
invasion, so thirteen of its creatures had been recorded in every biome the
walk crossed; anything carrying an `_INVASION_` label is kept out of the biomes
and says `came` instead.

**`wakes` is read rather than re-derived.** The client holds no list of which
item unlocks which awakened enchantment — an awakened enchantment names the
slot it goes on and a label only its own gear carries — and
`tools/generate-items.js` already works it out for the calculator. The index
reads its answer out of `data/Items/client-items.txt`, which is the only way
the two can stay in step.

**Enchantment → pool is a count, not a list.** A pool names no enchantment; it
says "everything labelled ROLLABLE" and then changes the odds. So an
enchantment carries `pools`, how many can give it, and only the fifty-eight a
pool names by hand are edges. Listing the rest was forty-eight thousand edges
saying the same dull thing, and it doubled the file.

Class↔item is *not* a link. It is worked out in the page from `slot` against
the class's `slots`, because storing it would be 4,396 × 19 edges to say
something two numbers already say.

`data/Index/search.json` is the same thing flattened to what a search box
needs: `[id, shown name, kind, alias, hidden?]` per record, 906 KB against 3.9
MB, so the list can be up before the full file lands.

### Doors that are not locked

`bench`, `ench` and `fight` say whether the other tools will really take the
thing, and they are the only reason a door is drawn on the card. They are read
at build time from those tools' own catalogues — `data/TheoryCraft/theorycraft.json`
for the bench and its 119 targets, `data/Items/client-items.txt` for the 1,757
items an installed client will enchant — so the index cannot claim a door the
other page will not open. It used to: *Price its enchantments* on a Trick Mace
landed the calculator on "not in the item list", because the client does not
let that item be enchanted at all.

Only the first record under a name gets them. Where the client declares three
things called Doom Bow, the other tools know one of them, by that name, and
cannot be told which — so the shiny and the retro send nobody anywhere.

**Gear offers no bench door**, whether or not the bench knows it. The bench
dresses a class; a piece of gear on its own has no class to be dressed on, and
handing a Summoner ability to whichever build happened to be open put it on a
Rogue. Come at the bench from the class.

`fires` and `worn` are what the thing actually does — damage, range, whether
the shot pierces or goes through, and what wearing it is worth. They are read
with the same expressions `tools/build-theorycraft.js` uses, deliberately, so
the card and the bench cannot drift apart: damage from the projectile, range
from its speed times its lifetime, and the stats from `ActivateOnEquip`.

---

## Two things that cost a round of rework each

**Attributes come in whatever order the client wrote them.** Most objects open
with `type` then `id`; a sixth of the file does not, and a pattern that insists
on the order walks past 5,827 definitions — including, when this bit the
theory-crafting build, the Ring of Cubed Wisdom. Both index tools match
`<Object\b([^>]*)>` and pull the attributes out of the captured blob.

**The same is true of `<Texture>`.** It may carry `xOffset`/`yOffset`, and a
pattern that insists on a bare tag misses 841 items — every potion, every
tier-nought weapon, most of `Objects.134.xml`. That one shipped once; the
regexes in `tools/index-sprites.js` now allow `(?:\s[^>]*)?` on the opening tag.
If a whole family of things suddenly has no picture, this is the first thing to
check.

---

## Names claimed twice

The client really does declare several things under one display name — a piece
of armour handed out by four dungeons, an enchantment written twice, and three
separate objects called "Doom Bow" (`0xc02` plain, `0xffea` shiny, `0xcfc1`
retro). An index that keeps one of them is an index that cannot answer *which
of these is the one I am holding*.

So a repeated name becomes a second record whose id takes the client's own id
after a `#`, tied back to the first with `same name as`. 2,602 records are
twins.

A second pass then gives them a **shown** name, in `said`: whatever the working
id adds that the display name does not, in brackets. `Doom Bow` /
`Doom Bow (Shiny)` / `Doom Bow (Retro)`, and 2,848 records told apart this way.
`name` stays the game's name; `said` is what the page prints. Anything reading
these records should print `said || name`.

---

## Why a tool hides something

`hidden` is a list of reasons, and the card prints them. 658 records carry one:

| reason | n |
|---|---:|
| shiny | 328 |
| an effect, not a thing worn | 133 |
| not rollable by enchanting | 115 |
| the machinery behind a proc | 97 |
| a test item | 35 |
| retired — weight nought, never rolled again | 24 |
| admin only | 12 |
| a slot no class uses | 7 |
| a swatch for drawing a rarity frame | 4 |
| not available to players | 1 |

This is the answer to "why is this not in the bench", and it is the reason the
index holds things no tool will ever show.

**"A slot no class uses" used to be 1,983 of these, and it was wrong about
nearly all of them.** Two thousand keys, tokens and potions are consumables:
that reason is true of the slot and false of the object, and it put a Health
Potion behind the same warning as a test item. They carry `use: 1` and are
their own family in the list — **Consumables, 1,976** — leaving seven things
that are genuinely neither worn nor drunk.

`dev: 1` is a third state, neither hidden nor offered: the 55 enchantment pools
and the teleporters inside a dungeon. Real things worth being able to look up,
kept out of a browse nobody asked for.

---

## The pictures

**The client's own art is the only art that settles an argument.** The wiki is
a patch behind, a name can belong to three things, and two of those three are
told apart by nothing except how they look.

`tools/index-sprites.js` reads `client-data/spritesheet.bin` — FlatBuffers,
slot 0 the still atlases, slot 1 the animated ones — resolves each record's
declared `<File>`/`<Index>` to a rectangle on one of the three texture pages
(`groundTiles`, `characters`, `mapObjects`; the page is field 7 on the sprite,
mapped `1/2/4`), and cuts it out. Animated things give up one standing frame,
preferring `doing` 0 and `facing` 3 — standing, facing the reader.

Identical rectangles are cut once and shared. They are packed into rows of a
fixed height, tallest first: `web/assets/index/sheet.png`, 1024×808, 604 KB.
Each record keeps its own rectangle in `art: [x, y, w, h]`, and the sheet's
size lands in `sheet`.

The page draws it as a background-position window (`.ix-art` / `.ix-cell`, with
the sheet's URL in the `--ix-sheet` custom property), so an eight-pixel sprite
scales up with no smoothing and there is one request for the lot rather than
eleven thousand.

**A set has no picture of its own, so it wears one.** Most of them turn the
wearer into a skin, and that skin is an object the client draws — the build
puts its client id in `drawnAs` and the cutter uses it. Watch the tag: seven of
them hand the skin out with `ActivateOnEquipCustom` rather than
`ActivateOnEquipAll`, and looking only for the latter left the Paths and the
Venerable three with an empty frame. The eighteen with no skin at all — the big
multi-class stat sets — borrow their first piece, and `pic: "piece"` makes the
card say so rather than pass a piece off as the set. **125 of 125 have a face.**

**82 records have no picture**, and 74 of them are things the client never
draws: 55 pools and 19 places are ideas rather than objects. The rest are 7
creatures and 1 item whose declared texture does not resolve.

---

## Ways in

The search box only helps a reader who already knows the name. The rail down
the left of the page is for the other one: `buildFacets()` in
`web/index-page.js` builds one set of record ids per chip, once, and `narrow()`
turns the chips that are down into one set per group. Within a group the
choices add up; between groups they narrow. Archer and Wizard means either;
Archer and Weapon means both.

The groups: **Favourites** (the reader's own, first), **Class** (the slot a
class declares against the slot an item declares — the same comparison the card
makes), **Gears** (the four slots), **Tier**, **Marks**, **Season**, **Biome**,
and **Dungeon**, which is the community's word rather than the client's and
says so. **Kind of gear** — the twenty-nine names the client's own tiered gear
agrees on, bow, quiver, leather — is built the same way but flagged `inSub`, so
it is drawn in the middle column once the reader has said they are looking at
gear.

### How the page moves

Worth reading before changing any of it, because each rule exists to answer a
complaint:

- **Nothing chosen, one panel, the width of the window.** The middle column
  appears when a category is chosen or a name typed, the card when there is a
  record to put in it. Three grid tracks exist at all times and every width is
  a length, because a grid only animates between column lists of the same
  shape — a panel that is not wanted is a track of nothing that closes.
- **The groups open as far as the window allows.** `fitGroups()` measures after
  drawing and shuts them from the bottom until the rail fits, never all of them.
- **`refine()` recounts every chip against the other groups** — its own group
  left out, so choosing one option never rules out its neighbours — and a chip
  with nothing behind it goes away.
- **The first choice is the anchor.** `asked[0]`. It alone puts its
  alternatives away, it is framed and banded with what it does, and taking it
  off clears everything under it, including the open card.
- **A sub category goes with its category.** Dropping a slot drops the kinds of
  gear under it, and any sub-category choice left with nothing behind it lets
  go on its own.
- **Anything chosen stays visible where it was chosen**, whatever its count has
  fallen to, or the only way to undo it is the row at the top.
- **A colour per group**, carried by the heading, the chip, the count and the
  chip once it has moved up to the row of choices.
- **Sizes are a share of the window.** `--ix-fs` on `#pageIndex` is what every
  piece of type is a proportion of, and `zoomed()` in the page scales the
  sprites to match. Two numbers to change if it is ever too small.

**Favourites live in `localStorage`** under `rotmg-tools/index-favourites`. One
reader's shortlist, nobody else's business, and no account to make.

**There is no Year, because neither source has one.** The client names a year
on about sixty things (`MOTMG_2024`, `ORYXMAS2023`) and on nothing else, and
the wiki's release-history pages link to other release pages rather than to
items. A year axis would have been three chips over eleven thousand records, so
the seasons carry what year information exists and no hollow axis sits beside
them.

## How the page gets it

`web/index-page.js` exports `{ start, show }` and looks for the data in this
order:

1. `bundle.sources.indexText` — present only in the downloadable copy;
2. `assets/index/index.json` — the served copy, fetched on first open;
3. `../data/Index/index.json` — the fallback when running from `web/`.

That split is deliberate, and `tools/build-standalone.js` enforces it: four
megabytes of index would be four megabytes every visitor pays for a page most
never open. So the **served** page fetches it, and only the **downloadable**
single file carries it inside, alongside the sheet as a base64 data URI
(`indexSheet`). The build prints `index NNNN KB beside the page, fetched only
when that page is opened` when it has done this correctly. `carryAcross` copies
`web/assets/index/` into `docs/assets/index/`.

The card's three doors — bench, enchant calculator, atlas — go through
`window.benchWith`, `window.enchantThis` and the atlas route in `web/app.js`.
That is the "carry a build from one tool to another" part, and it is the reason
the index is a hub and not a list.

---

<a id="community-links"></a>

## Community links

**Who drops what is not in the client.** Loot is decided on the server, and no
file in the installed game says which boss gives which bow. It is the one
question the index could not answer from its own sources — so it answers it
from the community wiki instead, and says on the card that it has.

`tools/index-wiki.js` reads a local snapshot of that wiki and writes
`data/Index/wiki.json`. That file is committed, so **the page works on a machine
that has never seen the snapshot**; without the snapshot the tool prints a line
and leaves the existing join alone.

```bash
REALM_INDEX_BUNDLE=<path to the snapshot> node tools/index-wiki.js
```

It also looks in `local/realm-linked-index/bundle` and `local/wiki-bundle`. The
snapshot itself is large, is not ours to publish, and is in this repository
under no path at all.

**The join is exact, and that is the whole trick.** The snapshot files a client
object under `Objects.NNN.xml|<type in decimal>|<its id>`, which is precisely
the three things a record already carries in `from` and `alias`. So there is no
name matching and nothing to arbitrate: of the 7,441 keys it knows, 5,992 are
records this index holds, and not one of them is ambiguous on our side. The
rest are portals and controllers the index does not keep.

What comes out:

| | |
|---|---:|
| records with a page | 6,055 |
| sets pointed at a family page instead | 8 |
| wiki pages referenced | 4,974 |
| drop links kept | 12,954 |
| summoning links kept | 1,586 |

The file is 603 KB and sits beside the index under the same bargain: the served
page fetches it when somebody opens the Index, and only the downloadable copy
carries it inside, as `wikiText`.

Its shape: `pages` is `[slug, title]` and an address is `at` + slug; `ids` is
the record ids it references; `page` maps a record to its page; `drop` and
`spawn` are pairs of **page** numbers.

**Page to page, not record to record.** One page answers to three client
definitions wherever a name is claimed three times, and fanning the same drop
list across all three writes it nine times and implies the wiki said something
separate about each. It said it once, about the page; the card finds it through
the page.

**None of the wiki's own writing is published** — no prose, no tables, no
images. A link is the honest way to send a reader to somebody else's work, and
every record that has a page carries one.

### Two things that were tried and thrown away

**Its collections are not categories.** The snapshot turns every section of
every page into a "collection", so membership means *linked from a section of
that page*, not *is one of these*. It put the Doom Bow under Shiny Items, under
Loot Containers and under Blueprints, and its Shiny Items list held 1,469
things where the client labels 322. A browse rail built on that is a rail of
plausible lies. Removed — the client's own labels do the same job truthfully.

**A drop link does not carry its own direction.** The snapshot marks a link as
a drop when it sits under a heading like "Drops" — but a monster page's Drops
section names its loot while an item page's names the monsters, the same mark
pointing opposite ways. Reading them all one way produced *"Septavius the Ghost
God, dropped by Pet Skins"*. The pair settles it now (`shapeOf` and `READS` in
the tool): a creature or a place on one side and a thing on the other is a
drop, and any other shape is left out. That set 11,281 links aside, and a
missing arrow is better than a wrong one.

Summoning could not be settled that way at all: the wiki writes both "Spawns:"
and "Spawns from:" under one "Reproduction" heading, and the link keeps the
heading, not the line. So the card shows a single row — *spawns, or is spawned
by* — which is exactly what is known.

### A note on provenance

Nothing is written down here that the client or the wiki does not itself say,
and the two kinds of claim are kept apart everywhere — on the card the
community block has its own frame, its own colour, and a line naming whose word
it is.

---

## Still open

- **Places and pools have no art.** A place could show its ground tile, which
  the atlas already cuts; a pool is an idea and probably never will.
- **7 creatures declare a texture that does not resolve.** Worth finding out
  whether the atlas is missing it or the index is wrong about it.
- **The bench has no tier-nought bow.** 28 tier-nought items and nothing in
  slot 3, though the client declares the Shortbow and hands it to every Archer
  ever made. Found by the index, which is what the index is for; the fix
  belongs in `tools/build-theorycraft.js`.
- **Class↔item is computed in the page.** If a second consumer ever needs it,
  it should move into the build rather than be written twice.
- **The card's link list is flat.** Two thousand `same name as` edges make some
  cards long; grouping by `how` with a count would read better.
- **Nothing verifies the index against the tools.** A check that every item the
  bench shows has a record, and that every record the bench hides carries a
  `hidden` reason, would catch a drifted filter the moment it drifts.
- **Six thousand wiki links are set aside as unreadable**, most of them item to
  item inside a Drops section, and four thousand more could point either way.
  The page *text* does distinguish "Drops" from "Drops of Interest" and
  "Spawns" from "Spawns from"; a reader of the text rather than of the link
  graph could recover a good part of them.
- **Twelve sets have no page anywhere on the wiki** — the three Agents of Oryx,
  Legion Elite, the three MotMG 2021, Chronicle of Decades and the four Paths.
  Their pieces describe the set inline instead of linking to one.
- **The wiki join is only as fresh as its snapshot.** `wiki.json` carries the
  date it was built, but nothing on the page compares that date with the
  client's, and a reader would want to know when the two disagree.

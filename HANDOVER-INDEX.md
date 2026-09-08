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

**The index needs an installed client.** Both tools read `client-data/`, which
is gitignored on purpose: it is DECA's, it is large, and it is reproduced from
any installed client in seconds. Without it, nothing here can be rebuilt — but
the built output *is* committed, so the page works on a machine that has no
client at all.

```bash
node tools/extract-client.js        # fills client-data/ from the installed game
node tools/build-index.js           # records and links   -> data/Index/
node tools/index-sprites.js         # pictures            -> web/assets/index/
npm run build                       # the site            -> docs/
```

The two index tools must run in that order and both must run: the sprite tool
reads `data/Index/index.json`, writes the rectangles back into it, and copies
the result to `web/assets/index/`. Running only the first leaves the served
copy without art.

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
| enemy | 5,577 | pool | 55 |
| item | 4,396 | place | 37 |
| enchant | 1,016 | class | 19 |
| set | 125 | **total** | **11,225** |

6,368 links, 138 source documents, 2,615 records carrying a reason a tool hides
them.

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

**`out` and `in` are the same 6,368 links seen from both ends**, each a
`[how, id]` pair. There are five kinds of link:

| how | n | between |
|---|---:|---|
| `same name as` | 2,602 | records the client filed under one display name |
| `rolls from` | 2,071 | item → enchantment pool |
| `made of` | 1,212 | set → its pieces |
| `lives in` | 419 | creature → place |
| `starts with` | 57 | class → its tier-nought kit |

Class↔item is *not* a link. It is worked out in the page from `slot` against
the class's `slots`, because storing it would be 4,396 × 19 edges to say
something two numbers already say.

`data/Index/search.json` is the same thing flattened to what a search box
needs: `[id, shown name, kind, alias, hidden?]` per record, 906 KB against 3.9
MB, so the list can be up before the full file lands.

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

`hidden` is a comma-joined string of reasons, and the card prints them. The
whole tally:

| reason | n |
|---|---:|
| a slot no class uses | 1,983 |
| shiny | 328 |
| an effect | 133 |
| not a thing worn | 133 |
| not rollable by enchanting | 115 |
| the machinery behind a proc | 97 |
| a test item | 30 |
| retired — weight nought | 24 |
| never rolled again | 24 |
| admin only | 12 |
| not available to players | 1 |

This is the answer to "why is this not in the bench", and it is the reason the
index holds things no tool will ever show.

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

Identical rectangles are cut once and shared, which is why 11,015 records come
out of 5,863 cuts. Those are packed into rows of a fixed height, tallest first:
`web/assets/index/sheet.png`, 1024×776, 575 KB. Each record keeps its own
rectangle in `art: [x, y, w, h]`, and the sheet's size lands in `sheet`.

The page draws it as a background-position window (`.ix-art` / `.ix-cell`, with
the sheet's URL in the `--ix-sheet` custom property), so an eight-pixel sprite
scales up with no smoothing and there is one request for the lot rather than
eleven thousand.

**210 records still have no picture**, and almost all of them are things the
client never draws: 125 sets, 55 pools and 37 places are ideas rather than
objects. Beyond those, 7 creatures and 1 item declare a texture that does not
resolve. Sets could reasonably borrow the art of their first piece; nothing
does that yet.

---

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

## What is deliberately absent

**Drop tables — who drops what — are not in here.** The client does not declare
them in any form these tools read; that side lives on the server. Everything in
the index is a declaration the client actually makes, and a guessed drop table
would be the one thing in it that is not.

A third-party analysis of the same client data exists on the machine this was
written on, outside the repository, and is not published: it is somebody else's
work and it is not the client. It was read while building this, and nothing was
taken from it that the client does not also say. If a future join needs
wiki-derived rosters, treat that as a new source with its own provenance rather
than folding it into `from`.

---

## Still open

- **Sets, pools and places have no art.** A set could show its first piece; a
  place could show its ground tile, which the atlas already cuts.
- **7 creatures declare a texture that does not resolve.** Worth finding out
  whether the atlas is missing it or the index is wrong about it.
- **Class↔item is computed in the page.** If a second consumer ever needs it,
  it should move into the build rather than be written twice.
- **The card's link list is flat.** Two thousand `same name as` edges make some
  cards long; grouping by `how` with a count would read better.
- **Nothing verifies the index against the tools.** A check that every item the
  bench shows has a record, and that every record the bench hides carries a
  `hidden` reason, would catch a drifted filter the moment it drifts.

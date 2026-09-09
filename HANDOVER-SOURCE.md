# One source: implementation and verification

The index is the **build-time** source, as confirmed for this change. The
calculator, Fame Sweep and Theory Crafting keep their compact runtime formats.
`build-index.js` reads each XML document once and supplies the text to extraction
helpers. The helpers contain the former generators' parsing and selection code.
`read-client.js` remains an independent comparison against the installed client.

## Running it

```sh
npm run scrape          # extract client, build index, project catalogues, refresh comparison snapshot
npm run project-data    # all five projections; requires only the committed index
npm test
npm run build           # published files, plus standalone structure/syntax checks
```

When refreshing client artwork too, after extracting the textures:

```sh
node tools/build-index.js --sprites
npm run project-data
npm test
npm run build
```

The two sprite modules now decorate in-memory records supplied by the index
builder. They write their PNG sheets; they cannot delete catalogue members or
overwrite Theory Crafting independently. A build without `--sprites` retains
existing rectangles for matching record ids. No picture means a fallback icon,
not a missing item. No installed client is needed to project data or build the site.

The index holds `records`, ordered record-id lists in `views.theory`, and the
four text tools' structured `catalogues`. The latter preserve their existing
folding, spelling and ordering rules. `index-model.js` translates the distinct
runtime schemas: index `fires` becomes theory `shots`, index `activate` becomes
theory `does`, and the index's label arrays become theory label strings.
Build-only item ids and `cut` flags stay out of the runtime projection.

## Provenance

Generated JSON carries `built`, `from`, `tool`; generated text carries the same
object on a `## provenance:` line. `built` is generation time. Client `from`
contains the Unity build GUID and the source asset's date, not a guessed patch
release date. Extraction records that source in its local `provenance.json`.
Projections preserve the index's generation time and source, with their own tool name.

The nine current client outputs, including the snapshot and latest change-log
entry, are checked for the same source. The checker also scans generated JSON
and text under `data/` so a newly stamped client catalogue is included.
Historical change-log entries retain their historical dates.

Community and map files are separate sources. Their known producer is recorded;
unrecoverable legacy snapshot/generation metadata explicitly says unknown. It
would be false to label RealmEye or a traced map as today's installed client.
Future wiki and map generation writes source metadata automatically. Handwritten
inputs and raster source artwork are not relabelled as generated client catalogues.

## Measurements and stage gates

The checkout differed from the pasted plan: the starting index held **4,396
items and 1,016 enchantments**, and the shipped bench held 1,813 items. Its
`bench` flags were read back from that shipped bench, a circular dependency now
removed. The current installed build is `15a3ce058fe946c792c23558bdb10e2c`, with
source asset date 2026-09-09.

1. All original generators were rebuilt against that client. The original 196
   tests passed, with zero differences across 16,650 artifact/enchantment and
   10,550 tiered pairs. A deliberate alternate source stamp followed by a Fame
   rebuild made `npm test` fail, naming both files, dates and build ids. The
   original files were restored. Permanent tests cover mismatched and absent stamps.
2. The mechanical extractor was moved before changing the theory reader. All
   3,134 records (19 classes, 1,863 items, 1,016 enchants, 117 sets, 119 bosses)
   matched the same-client baseline. Every field of all five arrays was also
   compared directly before artwork decoration: no differences. The existing
   cooldown extractor was moved unchanged. Observed condition shapes are retained
   as hit effects or activation effects, with duration and supplied attributes;
   their gameplay value is still the separate status-effects source.
3. Theory Crafting was changed to a projection. The original tests passed again.
   The browser picker visibly lists the Venerable rings of the Nile, Pyramid and
   Sphinx; a regression test checks every class's ring picker.
4. Items, enchantments, artifacts and Fame were migrated **one at a time**.
   Each text output was byte-identical to its same-client baseline except for
   provenance, and each step passed the full original suite. A fresh temporary
   directory containing only the index and projection tools now reproduces all
   five shipped outputs exactly. `check-index.js` compares every projected field,
   membership and artwork against the index.
5. The rule corpus was recorded and reproduced before changing any rule.
   It covers 19 classes, 1,125 distinct items, all ten goals, 497 stat/combat/set
   cases, 209 searches, enchanting probability/cost/tier functions, and dungeon
   availability. The eight synthetic tradeoff families bring the exercised
   enchanting dataset to 333 entries. Removing the secondary eligibility path
   reproduces the corpus exactly. Single-consumer combat/search rules stay put.

The literal broad `grep ... tools/*.js` proposed in the plan is not an accurate
catalogue check in this repository: it also finds the client extractor itself,
capture/diff utilities and independent atlas/realm builders. Those unrelated
pipelines were not migrated. Among the seven listed catalogue/comparison tools,
only `build-index.js` and `read-client.js` still access the client. The executable
projection test is stronger than that text search: all five run with no client
directory present. The sprite modules also receive all source data from the index.

## Every difference from the previously shipped data

- The four text catalogue bodies are unchanged, including their order and
  filtering. Only provenance was added. Snapshot facts are unchanged; the build
  GUID and latest checked date now identify the installed client actually read.
- The index gains one new declaration, **2-Bit Skin Collection Chest**, and its
  requested mechanics, condition records, membership lists and catalogue views.
  There are 4,397 item records, 1,863 modelled on the bench and 2,534 excluded.
  Excluded items keep the original filtering; `hidden` or `benchWhy` states why.
  Consumables remain visible in their own index category.
- Classes, enchantments, sets, bosses and the Theory Crafting sprite sheet are
  unchanged. No existing item was removed or had an existing mechanical value
  changed. **106 existing items gain `cool`**, from the cooldown extractor that
  was already in the former generator but had not reached the shipped file.
  One of the 50 restored items also declares a cooldown, making 107 in total.
- **50 items are restored.** These are not all newer items. The old sprite step
  removed `cut && !art` items after the main generator ran. This is the second
  cause of the missing rings, beyond stale generation, and explains the exact
  1,863 → 1,813 difference. The complete list is below.
- Root provenance and the index schema additions are deliberate. Art fields are
  now projected from the index, and the sheets themselves are unchanged.

Restored items: Hallucination Prism (SB); Scorching Blast Spell (SB); Sigil of
the Fox (SB); Silver Lute (SB); Specialist Mace (SB); Tome of Rejuvenation (SB);
Adept Mace (SB); Battle Lute (SB); Destruction Sphere Spell (SB); Prism of
Figments (SB); Sigil of the Wolf (SB); Tome of Renewing (SB); Magic Nova Spell
(SB); Monarch Mace (SB); Prism of Phantoms (SB); Regal Lute (SB); Sigil of the
Boar (SB); Tome of Divine Favor (SB); Elemental Detonation Spell (SB); Prism
of Apparitions (SB); Sigil of the Horse (SB); Skyward Lute (SB); Sovereign Mace
(SB); Tome of Holy Guidance (SB); Mantlecrusher Trap; Nether Lute; Prism of
Mindscapes; Sacrilege Skull; Spell of Galactic Creation; Tome of Sacred Thought;
Trick Lute; Big Berdtha; Fossilized Skull; Mace of the Woods; Scary Stories;
X-Marks-the-Spot Spell; Ring of Superior Health (SB); Ring of Paramount Health
(SB); Ring of Exalted Health (SB); Chef's Hat; His Majesty's Eminence; Legacy
Forgotten Ring; Legacy Ring of Pure Wishes; Legacy Spectral Ring of Horrors;
Venerable Ring of the Nile; Venerable Ring of the Pyramid; Venerable Ring of the
Sphinx; Shortbow; Legacy Etherite Dagger; Ravenous Wand.

## Artwork, after the fact

The data was one source before the pictures were. The calculator and Theory
Crafting both drew items from `web/assets/items`, a folder of wiki renders that
nothing else on the site read, and the bench fell back to a second sheet of its
own for what the folder lacked. So the fifty restored items came back to the
bench without artwork following them, and the three Venerable rings showed a
picture on the index and an empty square on the other two pages.

`tools/generate-item-art.js` is the sixth projection: name to rectangle on the
index's sheet, `data/Index/item-art.json`, 153 KB. The bench carries the same
rectangle as `icon`, projected through `index-model.js`. The folder, its
downloader and its manifest are deleted, and with them the index's own
dependency on them - `pic` no longer says "drawn by the community" about a
picture that was always the client's, and `theory-sprites.js` no longer cuts a
second copy of an item onto the theory sheet, which is now only what moves.

Two items the client lets you enchant carry no `Labels` block, so the index had
no record of them and no picture: the Paper Machete and an Agents of Oryx
shard. Membership now reads `EnchantmentSlots` as well as the label, which is
what closed the last two gaps. `check-index.js` fails if a bench item or an
enchantable item arrives without a picture; both are at 100%.

Served page: 4.02 MB to 2.52 MB. Download: 13.8 MB to 12.3 MB.

## The inventory, widened

The item loop asked for the `EQUIPMENT` label, so eight thousand eight hundred
`<Item />` declarations never became records: marks, artifacts, keys, set
shards, dyes, pet skins. It now takes anything the client puts in a bag and
reads a family off the client - the `Activate` verb first, the labels second -
so the index holds the inventory and not only the wardrobe. 19,302 records.

The calculators did not move. Their membership comes from their own catalogues
through `offered`, not from what the index happens to hold, which is why all
196 checks, the 3,134-record comparison and the rule corpus reproduce exactly
across a change that grew the index by 70%.

`index-wiki.js` was re-run against the September snapshot and the widened
index: 6,620 records have a page against 6,055, the three records that had a
page but no link are linked, and the join records the snapshot hash and the
client build it was made against instead of "unrecorded legacy". That build is
now compared against the catalogues' in `provenance.check()`, so a join left
behind by a game update fails the suite rather than quietly thinning the page.

`tools/png.js` holds the PNG reader and writer that `index-sprites.js` kept to
itself, because the realm atlas needed to cut an item out of the index sheet
too and a second copy of a decoder is how two tools start disagreeing about a
pixel. `merge-realm-roles.js` cuts from that sheet now instead of reading the
deleted wiki folder.

## Runtime verification and remaining source decisions

The served page previously embedded Theory Crafting too. To keep calculator
startup below its baseline, the same theory JSON now loads when Theory Crafting
opens. Index and wiki also stay deferred. The served HTML is about **3.96 MB**,
against **5.26 MB** before this change. Its calculator and theory pages were
opened successfully in a browser, with no console errors.

The downloadable `docs/Realm-Tools.html` retains the embedded theory, index,
wiki and sheets. The build verifies those payloads against the data files and
compiles every embedded script. The browser's security policy blocks `file://`
navigation here, so a direct disk-opening check could not be performed.

The wiki snapshot is absent. Running `index-wiki.js` correctly preserves the
existing join; the proposed drop/spawn regeneration remains unverified. Neither
ICECAVE nor NEST was guessed, and no new community source was added.

The corpus is `tests/rules-corpus.json`; ordinary tests never rewrite it.
`node tests/rules-corpus.js --record` is only for a reviewed source/rule change.
No git commit or publication was made as part of this work.

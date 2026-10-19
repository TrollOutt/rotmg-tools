# Training Ground — provenance

The supplied web port is based on [Mxple's TPGsim](https://github.com/Mxple/TPGsim).
Upstream tree inspected: `1990c10012be02694ca945d5f86f1baee97fc566` (2026-10-19).
No licence file was found in that tree and the upstream README gives no reuse licence.

## What is reused

- `engine.js`: the archive's `webgame.js`, wrapped as a pure factory with strict
  JSDoc types. Mechanics and 60 Hz simulation are retained. English messages
  replace French messages; no damage, collision or enemy rules were redesigned.
- `ui.html`, `ui.css`, `ui_*.js`: the archive's wizard, equipment controls, pause,
  results, best-run path and animated backdrop, adapted to English and the host.
- `renderer.js`, `loop.js`: rendering and loop code from the supplied template's
  renderer, with the UI assembly split into source files. No generated standalone
  HTML or assembled `web.tpl.html` is a build input. Python is not required.
- `room.json`, `assets/sprites.json`, all twelve PNGs and two WOFF2 fonts:
  copied from the user archive. The archive itself remains untouched.

## Derivation and accuracy

The archive calls the game logic “recoded”. Targeted inspection of upstream
`objects/o_patience/{Create_0,Step_0}.gml`, `o_shade/Step_0.gml`,
`o_spike/Collision_o_player.gml`, `o_arrow/Collision_o_player.gml` and
`o_tendril/Alarm_0.gml` confirms a close translation of algorithms, constants,
ordering and even the unusual additive blue-spike damage formula. This is a
derived JavaScript port supplied in the user archive.

The archive attributes only tendril arrow figures to the client. Shade ring
damage and the 600-frame cycle come from TPGsim / RealmEye and are approximate.
Collision masks, random salvo colour and GameMaker iteration semantics are port
approximations, documented in the supplied REPORT.md. Passing comparison tests
against this port does not establish fidelity to the live game.

The historical engine and its sixteen golden scenarios remain unchanged,
including the archived special-gear scenario. Its hardcoded items are retained
only for that historical comparison; the browser no longer offers them.

## Index connection (Training Ground 2)

`tools/training-catalog.js` projects `data/Index/index.json` at site build time.
Only classes, compatible self-Invulnerable equipment and exclusion explanations
reach `training/catalog.js`. Names, client aliases/types, source XML filenames,
slots, durations, cooldowns and activation attributes retain Index provenance.
`build-training.js` cuts a small icon sheet from `web/assets/index/sheet.png`.
No full Index or client extraction is loaded by Training Ground or its home link.

`index-combat.js` wraps the supplied engine without replacing its simulation.
The three Matrix armour types (and their Neo variants) and Amulet of Restoration
use the user's explicitly approved historical convention: apply the hit first,
then test the surviving player's HP against the strict threshold. The Index does
not establish the live game's threshold ordering. Minimum damage and cooldown
come from its activation attributes. This is playable training, not verified
live-client proc fidelity. Dazed has no consequence without shooting; the amulet's
On Shoot effects never fire because this survival fixture has no player shooting.
Royal Guard's Cuirass needs shooting and In Combat and is excluded, not guessed.
Conqueror's Crown is hidden as unavailable to players; shiny twins are folded.

Seal of Blasphemous Prayer is a Paladin ability: Space, 120 MP, 2.2 seconds
Invulnerable, 5 seconds cooldown (all from the Index). MP starts at the class's
Index cap; regeneration is deliberately not modelled because its formula is not
in these declarations. Since Training Ground 4, only invulnerability is modelled:
Healing, Damaging, Dazed, Armored and every secondary item effect are excluded.
The Index status catalogue establishes that Invulnerable does not block
Bleeding/status damage; that existing engine behaviour is preserved.
HP/DEF/SPD are editable equipped totals: selecting gear does not add worn stats
again. An explicit button applies the Index's class caps rather than silently
overwriting user totals on a class change.

## Temporary max-HP consumables (Training Ground 3)

The official client build is `f1f479830bae49808b3d9927e8ad8fa1`, the same GUID
as the committed October 14 Index. XML was re-extracted on October 19 with
`tools/extract-client.js`. The launcher's asset modification date is October 19;
it is not a different build or a claim of a new patch. A complete isolated
rebuild compared all existing Index facts and both sprite sheets: unchanged.
Only `statBoosts` and dedicated `statBoostSource` provenance were added by
`tools/build-index.js --enrich-stat-boosts --sprites`. The original catalogue
date remains October 14; the enrichment records its actual October 19 source
date and XML SHA-256 hashes. No October 6 client cache or archive consumable
values are used.

`tools/item-stat-boosts.js` preserves every StatBoostSelf / StatBoostAura,
its trigger, raw attributes and the presence of other activation verbs.
The Training projection accepts only one unconditional, fixed, positive MAXHP
StatBoostSelf on Activate, in the `statConsumables` channel, with an exact
60 Hz duration, no additional activations/statuses and no hidden/unreleased flag.
Names, types, icons and values are projected from the Index, never an item list.

The accepted declarations are in `Objects.135.xml` (SHA-256
`f212c7bbbf4ec9435705c8005d967a94147989f874cdec8c5433604395f093e2`):

| Client declaration | MAXHP amount | Duration (seconds) |
| --- | ---: | ---: |
| Tincture of Life (`0xb0d`) | 100 | 30 |
| Minor Teal Nildrop (`0xb569`) | 66 | 300 |
| Mistletoe (`0x2047`) | 150 | 900 |

These are fixed MAXHP amounts, not current-HP healing or VIT. A single selected
dose is applied at construction; current HP is unchanged. Duration runs in
combat ticks only (not countdown or pause). Expiry restores the original maximum
and caps current HP. Restart constructs a fresh dose from the saved selection;
there is no mid-run consumable API. The existing adapter's lifecycle is reused.

Effusion of Life, Teal Nildrop, Blood Nildrop, Teal Treat and Royal Jelly declare
auras; the XML does not explicitly establish caster inclusion, so they are
excluded rather than treating the party target as proof. Blood Nildrop also
declares VIT; Royal Jelly adds Healing. Bahama Sunrise / Blue Paradise add
Drunk and other stats, and Cerveza has multiple stats and a different channel:
their complete effects are not modelled. Food / Tofu declarations retain their
existing Index hidden reasons. Pure healing, permanent potions and non-MAXHP
boosts are excluded. The catalogue carries each exclusion reason.

Local acceptance tests reread the real XML and compare all 324 extracted item
declarations against the generated Index. CI uses the committed projection and
clearly synthetic parser counterexamples, with full real-item duration tests.

## Prepared invulnerability swaps (Training Ground 4)

Character requires an explicit valid Index class (19 choices), with no fallback.
A valid saved class is retained. Equipment offers only compatible client Ability,
Armor and Ring slots, with one optional swap per slot; empty slots are hidden.
No currently worn equipment, equip-time rule, item stat adjustment or in-combat
equipment transition is simulated. Preparing a swap never activates protection.
The frozen engine's archive equipment code remains only for its sixteen historical
comparison scenarios; the live adapter disables those transition/proc entry points.

The existing eight Index items retain their invulnerability declarations:

| Item | Trigger | Invulnerable | Cooldown |
| --- | --- | ---: | ---: |
| Seal of Blasphemous Prayer | Paladin ability, Space, 120 MP | 2.2 s | 5 s |
| Fitted / Magic / Heavy Protective Matrix, each with its Neo variant | Surviving hit of at least 2 damage, HP strictly below 50% after damage | 1.4 s | 180 s |
| Amulet of Restoration | Surviving hit of at least 2 damage, HP strictly below 20% after damage | 2 s | 1800 s |

The six matrices use their corresponding client Armor slot. The amulet fits all
classes. The seal fits Paladin only. Its MP reserve is the Index cap (300), with
no regeneration: two activations at most per attempt. No Healing is required to
model its independently declared self-Invulnerable activation, so Healing is
explicitly omitted. This is a deliberate simplification from TG2/TG3, not a claim
that the live item has lost that effect.

Ability input is evaluated before the combat tick. A protected attack is blocked
and cannot trigger hit effects. An unprotected surviving hit evaluates Armor then
Ring from the same post-damage HP, even if Armor just started protection. Each item
has its own cooldown. Overlap uses the latest expiry, never summed durations;
this deterministic convention is not proof of live-client concurrent proc order.
Thresholds use the temporary max HP while a consumable is active. Countdown and
pause consume no duration/cooldown; restarts rebuild all state from saved choices.

Settings v3 reads v2/v1 without changing their storage keys. Canonical compatible
choices become prepared swaps; invalid class/slot/item choices are ignored with
a visible notice. Numeric totals and the selected TG3 consumable are retained.
Records still use the v2 namespace, with `index-v3-swaps-postHit`, class, canonical
Ability/Armor/Ring swaps, consumable, seed, build and existing scenario parameters.
The rules discriminator separates TG4 results because Healing has been removed.
The previous v1 and TG2/TG3 v2 keys remain unchanged and readable in Legacy records;
no old record is overwritten or destructively migrated.

## Artwork

The supplier attributes sprites to DECA / Realm of the Mad God. This includes
shade, tendril, arrows, spikes, player strips, fog and composed floor; no extraction
manifest establishes which bytes were taken directly from a client versus
TPGsim. A targeted decoded-RGBA comparison found identical upstream TPGsim pixels
for all four single-frame arrows/spikes, fog, shade frame 1 and tendril frame 2.
Thus these are copied/repacked artwork, not newly drawn substitutes. The Index
already names the five special items, but their 8×8 catalogue artwork is not
this simulator's animated character/room fixture; no second catalogue is added.

## Fonts

Unmodified supplied Inter and Press Start 2P WOFF2 files are distributed with
their complete copyright notices and SIL Open Font License 1.1 texts:

- [Inter-OFL.txt](fonts/Inter-OFL.txt), retrieved from
  https://github.com/rsms/inter/blob/master/LICENSE.txt
- [PressStart2P-OFL.txt](fonts/PressStart2P-OFL.txt), retrieved from
  https://github.com/google/fonts/blob/main/ofl/pressstart2p/OFL.txt

The archive did not include those licence texts. No RIN picture or ChronoType
font is carried.

## Level and menu layout

The archive's menu let the player set a "Level". It is not an in-game character
setting in this simulator: the engine uses it only to pace the tendril arrow
salvos (the interval between salvos is `31 - 3 x level` ticks plus a random
spread, and a salvo holds up to `10 + level` arrows). The setting was removed
from the menu as too subjective. The engine keeps the archive's default of 5,
and saved settings are forced to it, so every scenario, fixture and best-run key
keeps its previous meaning. Older saves that stored another level are read with
that field ignored; their records stay under their existing keys.

The five settings steps are laid out to fit the window without a scrollbar of
their own (two-column cards, one-line stat rows, text that collapses on short
windows). On phones the key map and the long explanations are dropped because the
game itself needs a keyboard. These are interface changes only: no rule, damage,
collision or timing value is touched.

## Build

`npm run build` includes `docs/training/` and its entry below the home planet.
The engine is loaded only when the training page opens. The single-file download
retains its self-contained format and does not load the separate HTTP page.
No backend or network service is used by the game. Publication is a separate
operation requiring the user's explicit authorization.

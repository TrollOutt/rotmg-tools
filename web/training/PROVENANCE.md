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
in these declarations. Healing uses `data/Items/status-effects.txt` (20 HP/s),
its Index duration/scaling and the class WIS cap. The aura includes its caster;
ghost allies and offensive Damaging have no simulated effect. The status catalogue
also establishes that Invulnerable does not block Bleeding/status damage.
HP/DEF/SPD are editable equipped totals: selecting gear does not add worn stats
again. An explicit button applies the Index's class caps rather than silently
overwriting user totals on a class change.

The current Index has only StatBoostSelf/StatBoostAura verbs for consumables:
it does not preserve their stat, amount or duration. Thus **no consumable is
selectable**, including Blood Nildrop, Tincture of Life and Effusion of Life.
Neither a description nor the archive's guessed +150 HP is a substitute. The
one-dose, pre-combat, timed-max-HP lifecycle is implemented and tested with
explicitly synthetic fixtures, but no real item's missing values are invented.
Enabling real consumables requires a source-level Index extraction of those
attributes and a reviewed targeted projection, not an independent item list.

Settings v2 reads compatible v1 values without overwriting the old save. Records
v2 include class, canonical gear, consumable, seed selection and scenario settings.
The v1 key function and stored values remain readable, including in the legacy
records panel. No destructive migration is performed.

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

## Build

`npm run build` includes `docs/training/` and its entry below the home planet.
The engine is loaded only when the training page opens. The single-file download
retains its self-contained format and does not load the separate HTTP page.
No backend or network service is used by the game. Publication is a separate
operation requiring the user's explicit authorization.

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

This is a closed historical training fixture, not a new Index catalogue. Special
item stats remain the archive's configurable approximations. They do not feed
Theory Crafting or the Enchant Calculator. A future client-driven update should
project canonical records and artwork from the Index per HANDOVER-SOURCE.md.

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

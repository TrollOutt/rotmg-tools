# ROTMG Tools

Browser tools for exploring Realm of the Mad God data, planning builds and estimating enchantment costs. An unofficial community project.

**[Open ROTMG Tools](https://trolloutt.github.io/rotmg-tools/)** - no installation required.

## Features

- **Index** - search items, creatures, classes, dungeons, sets and enchantments; browse families and filters, detailed records, acquisition sources and Forge information.
- **Enchant Calculator** - choose equipment and enchantments, compare artifacts and estimate reroll probabilities, expected rerolls and dust costs. Filters and saved setup tabs stay in your browser.
- **Theory Crafting** - compare equipment, enchantments, abilities and damage at different distances; optimize builds and visualize them in **The Fight**. Personalized searches use your dungeon progression and confirmed acquisition sources; best-possible searches are also available. Progression is saved in your browser, and owned items can be locked in place.
- **Fame Sweep** - track completed dungeons, collection bonuses and remaining rewards.
- **Skin Viewer** - browse skins, preview animations, combine clothing and accessory dyes, and save favorites.
- **Realm Atlas** - explore an interactive map with biome, beacon and creature information linked to the Index.
- **What's New** - browse client additions and changes, update summaries and history, with linked Index records.

## Run locally

Use **Node.js 20 with npm** to match CI. The project has no declared Node engine requirement or `.nvmrc`; dependencies are pinned by `package-lock.json`. Building the site from committed data does not require an installed game client or a fresh scrape.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm test` runs the calculation, data consistency and application checks. Both tests and build check translations and compile the locale catalogues; build also validates the standalone output.

Serve the generated `docs/` directory over HTTP. For example, if Python 3 is installed:

```sh
python -m http.server 8000 --directory docs
```

Open <http://localhost:8000/>. This is an illustrative static server, not an additional project dependency.

The build also produces the legacy single-file download `docs/Realm-Tools.html`; use the HTTP site for normal local development.

## Project layout

- `web/` - application UI, data readers and calculation modules, including `engine.js` and `theory-engine.js`.
- `data/` - source datasets, snapshots and update information used by the tools.
- `tools/` - data generation, consistency checks, translation compilation and site build scripts.
- `tests/` - automated calculation, data and application validations.
- `docs/` - generated site output, ignored by Git and published by GitHub Pages. Edit sources rather than this directory.

## Architecture

The architecture is progressively modular: calculation and data modules separate reusable logic from page controllers, but the controllers remain large and still own much of the state and rendering.

- **Data and resources** - `data/` holds game-client datasets and separate community information from RealmEye. `web/assets/` contains images, sprite sheets and Atlas tiles.
- **Domain and data modules** - `web/engine.js` handles enchantment calculations; `web/theory-engine.js` computes build statistics, damage and optimization; `web/progression.js` resolves loot access. `web/app-data.js` resolves calculator selections. Index search and filtering live in `web/index-search.js` and `web/index-filter.js`; `web/fiches-data.js` prepares supplementary record-card data. `web/skin-viewer-data.js` and `web/skin-viewer-animation.js` handle skin catalogues and playback decisions; `web/atlas-data.js` and `web/atlas-geometry.js` provide panel lookups and camera projections.
- **Page controllers** - `web/app.js` manages calculator state and site navigation; `web/theorycraft.js` and `web/index-page.js` coordinate their pages. They handle events, DOM updates and rendering. `web/skins/app.js` coordinates the Skin Viewer's Canvas 2D layers and WebGL renderer (`web/skins/renderer.js`); `tools/atlas-viewer.html` manages Atlas interaction and Canvas 2D rendering.
- **Build and deployment** - `tools/build-standalone.js` assembles the sources and resources into the generated site described above. GitHub Pages publishes that output through the workflow.
- **Validation** - TypeScript checks JavaScript with strict JSDoc contracts for the modules explicitly included in `tsconfig.json`, not the entire application. Test harnesses compare module behavior with reference corpora, including Atlas geometry and skin animation playback. CI runs type checking, then tests, before site generation; generated-output checks in `tests/standalone.test.js` run after generation, at the end of `npm run build`.

## Data and reliability

Game-client declarations supply equipment, enchantments, statistics and artwork. The Index is the build-time source for downstream catalogues. RealmEye supplies separate community information, including acquisition relations; the Atlas also uses traced map data and player-interpreted biome information. Thanks to RealmEye and the community for documenting information the client does not provide.

Automated checks cover calculation rules, catalogue provenance, cross-tool consistency and application behavior. They help catch regressions; they do not guarantee that every game mechanic is reproduced.

Theory Crafting is a model: results depend on the selected target, distance and assumed party effects. Some effects that alter shots are not modeled by the optimizer. Its search improves one choice at a time rather than exhaustively checking every combination, so it does not prove a globally optimal build.

## Contributing and publishing

Install dependencies and run `npm run typecheck`, `npm test` and `npm run build` before submitting changes. Keep generated data consistent with its source and include relevant validation for calculation or data changes.

The [Deploy to GitHub Pages workflow](.github/workflows/pages.yml) builds and deploys the site on every push to `main`, after type checking, tests and build validation. It publishes `docs/`; generated site files do not need to be committed.

## Credits and license

Based on [rotmg-enchant-calculator](https://github.com/brendanbrubacher/rotmg-enchant-calculator) by [brendanbrubacher](https://github.com/brendanbrubacher) - thanks for the original program and its enchantment data.

Coded with OpenAI Codex and Anthropic Claude.

[GPL-3.0](LICENSE), modified 2026. Unaffiliated fan tool; Realm of the Mad God belongs to its owners.

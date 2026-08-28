# RotMG Enchant Calculator — standalone build

`RotMG-Enchant-Calculator.html` is the whole application in one file.

## Using it

Download the file and open it. That is the entire procedure — double-click it,
or drag it into a browser window. Nothing to install, no server, no internet
connection needed after the download.

It works from a USB stick, from a Downloads folder, from anywhere.

## What is inside

Everything, inlined:

- the original enchantment, artifact and awakened-item data files,
- all 159 sprites, as `data:` URIs,
- the calculation engine, the interface and the stylesheet.

The page makes **zero network requests** once it is open. Nothing is uploaded,
nothing is tracked. Your item setup is remembered in that browser's local
storage so it is still there next time; "Reset everything" clears it.

Because storage is per-browser, opening the file in Chrome and in Firefox gives
you two independent saved setups. Same for a private window, which forgets
everything on close.

## Making a desktop shortcut (Windows)

From the repository root:

```
npm run build
npm run shortcut
```

That puts a shortcut on the Desktop which opens the page in an app window — no
address bar, no tabs — using Chrome or Edge if either is installed, and the
default browser otherwise.

## Rebuilding it

From the repository root, with Node installed:

```
npm run release
```

That runs the engine test suite and then regenerates this file. The build fails
rather than shipping a page with a missing sprite.

## Sharing it

**Best option — put it online.** The repository publishes itself to GitHub Pages
on every push, so you only have to hand out a link. See `HOSTING.md` at the root
for the setup, which is one checkbox plus a push.

Otherwise the file is self-contained, so any of these work too:

- attach it to a GitHub **Release** — people get a versioned download link;
- send the file itself over chat, mail or a USB stick.

One caveat if you link to it on GitHub: the normal `github.com/.../blob/...`
page shows the source code, not the application. Use the Pages address, the
raw/download link, or a Release asset.

## Licence

The original Qt calculator is
[brendanbrubacher/rotmg-enchant-calculator](https://github.com/brendanbrubacher/rotmg-enchant-calculator),
under GPL-3.0. This web version is a modified derivative and is GPL-3.0 as well.
The attribution in the page footer is part of that; please leave it in place.

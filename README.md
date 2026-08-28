# RotMG Enchant Calculator

**→ [trolloutt.github.io](https://trolloutt.github.io/)** — open it in your browser, nothing to install.

Tell it which item you hold and what you want on it; it tells you the odds per
reroll, how many rerolls to expect, how much dust that costs, and in which order
to lock things.

---

## Credit where it is due

**This is not my program. It is a web port of someone else's work.**

The original is
**[rotmg-enchant-calculator](https://github.com/brendanbrubacher/rotmg-enchant-calculator)
by [brendanbrubacher](https://github.com/brendanbrubacher)** — a desktop
application written in C++23 and Qt Widgets. They did the part that actually
required knowing something: working out how enchanting behaves, and assembling
the enchantment tables, the weights, the labels and the incompatibility rules
that every number here is computed from. That data is theirs, copied across
essentially unchanged, and their full source is in this repository under
[`Qt Source Files (not zipped)/`](Qt%20Source%20Files%20\(not%20zipped\)/).

So: thank you. Without that project there is nothing to port, and I would not
have known where to begin.

What I did on top of it is narrower — put it in a browser, rebuild the
probability computation so it is exact rather than sampled, add an item
catalogue, and make it something you can open from a link.

I am not a developer. The code here was written largely with AI assistance:
partly with **OpenAI's Codex (ChatGPT)** and partly with **Anthropic's Claude**.
Worth knowing if you are about to read it or rely on it.

---

## What it does

- **Exact odds, not estimates.** Every configuration is solved exactly, including
  four-slot items. The eligible pool is re-culled between rolls by the labels
  already sitting on the item, and the tree is collapsed over classes of
  interchangeable candidates so the exact answer stays cheap to compute.
- **The item is the only thing you type.** Its slot, its dust colour and its
  special base are looked up from a catalogue of 1,638 items. Rarity stays a
  question, because rarity is rolled when the item drops and the item's name
  cannot tell you.
- **Honest about locking.** Locking shrinks the pool but doubles every reroll and
  spends a slot. The planner searches the lock decisions as a policy and will
  tell you *not* to lock when locking loses.
- **Shows its working.** An audit panel prints the pool size, the total weight,
  the per-roll probability and the assumptions behind them, so you can check the
  numbers instead of trusting them.

One deliberate divergence from the original model, flagged in that audit panel
rather than hidden: incompatibility is applied directionally — a candidate is
dropped when the labels already on the item appear in *its* incompatibility list
— where the original treats the relation as mutual.

## Offline copy

[`dist/RotMG-Enchant-Calculator.html`](dist/RotMG-Enchant-Calculator.html) is one
self-contained file: every sprite and every table is embedded in it. Download it,
double-click it, and it works with no network at all. Your setups are saved in
your own browser and are never sent anywhere.

`npm run shortcut` puts a desktop shortcut to that file on Windows.

## Building it yourself

```
npm test        # 115 checks on the probability engine and the catalogue
npm run build
```

`npm run build` inlines everything into `dist/` and `docs/`, and refuses to write
if any sprite the interface can request is missing. GitHub Actions runs both on
every push and publishes `docs/`.

`tools/fetch-items.js` and `tools/fetch-item-sprites.js` regenerate the catalogue
from the wiki. You do not need them to build: their output is committed, so a
build needs no network access.

## Layout

| Path | What it is |
| --- | --- |
| `Qt Source Files (not zipped)/` | **brendanbrubacher's original program.** The source of the data. |
| `web/engine.js` | The probability and dust model. No DOM, testable on its own. |
| `web/items.js` | Item lookup: slot, dust and tier bands. |
| `web/app.js` | The interface. |
| `web/item-catalog.json` | 1,638 items, with sprites in `web/assets/items/`. |
| `tools/item-dust.txt` | Per-item dust colour, read from each item's own page. |
| `tests/engine.test.js` | The check suite. |

## Licence

[GPL-3.0](LICENSE), as the original is. Modified 2026.

Realm of the Mad God is a trademark of its owners; this is an unaffiliated fan
tool.

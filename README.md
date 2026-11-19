# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/vinnvv/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/vinnvv/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar of the strongest pre-token protocols, ranked by implied launch value. Built for the make.fun bounty **token-radar-01** ("Build the best token launch radar", $1,325, deadline 2026-12-14 17:00 WIB).

## Run it

```sh
# Node 22+
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
node validate.mjs out <path to the kit>
```

---

Entered on [make.fun](https://make.fun/?ref=9j79nw8m&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards

## What it is

- **198 ranked rows** — all 40 watchlist protocols, plus 158 early
  pre-token protocols below the $50M TVL floor. 24 live-token protocols
  are set aside on their own tab with their real market caps.
- **Model "radar-2"** — implied value is TVL × a category multiple
  calibrated from the snapshot's own live-token protocols (median
  market-cap/TVL per category, winsorised, shrunk toward the global
  median, clamped 0.08×–0.45×; categories with fewer than three live
  protocols take the global multiple), × a growth multiplier (7-day
  change, weight 0.8, clamped −60%..+120%), × a maturity multiplier
  (age, 0.65–1.00 over 3 years), × a chain multiplier (+2% per extra
  chain, up to 5). No protocol name is special-cased.
- **Dashboard** — static site (`dashboard/`) with a top-5
  spotlight, search, category and chain filters, sortable board table,
  a pre-token / live-token switch, a per-protocol detail view with the
  model's own breakdown, and a concrete farm plan per protocol
  (capital, cost, time). The page recomputes each row from the snapshot
  figures and checks it against `board.json`.
- **Farm plans** — six steps per protocol, derived from its category,
  chains, TVL and age: the action, the capital ($50–$250), the gas,
  the hold (30–60 days) and a weekly cadence.

## Files

| File | What it is |
| --- | --- |
| `main.ts` | Entrypoint: reads `/input/snapshot.json`, writes `/output` |
| `lib/model.ts` | The radar-2 model, the board, the farm plans |
| `dashboard/` | The static dashboard (index.html, app.css, app.js) |
| `vendor/makefun-board.ts` | Vendored board/dossier writer from the bounty kit |
| `screenshots/` | Board, detail and filtered views (1440×900) |
| `validate.mjs` | Local replica of the kit's seven gate checks |

The run is deterministic: two runs with the same snapshot write
identical bytes.

## Screenshots

The dashboard was rendered end to end in headless Chromium
(Playwright) at 1440×900: board view, a protocol detail view
(Steakhouse Financial, rank 1) and a category-filtered view (Lending).

## Licence

MIT.

# DAYSHIFT

**Not a monthly budget.** One daily SafeSpend number for workers who earn by the shift.

Cursor Hackathon demo — Alberta daily / gig / hourly workers, reverse-engineered from the provided cashflow datasets.

> Daily earners don’t fail at budgeting categories — they fail at timing. DAYSHIFT turns shift history, bills, and advances into one daily SafeSpend number, warns of rent gaps early, and prices bad liquidity in shifts — not shame charts.

DAYSHIFT is for workers who earn by the day or shift — movers, gig drivers, servers, labourers — who need to know what they can spend today without missing rent or bills.

It’s not for people with a steady paycheck and a monthly budget. It’s for messy, uneven income where the real problem is timing: pay dribbles in, rent hits on the 1st, and expensive wage advances fill the gap.

So it’s for: day-to-day survival decisions (“Can I buy groceries?” / “Am I short for rent?”), not for tracking latte categories.





## Live idea

Open `index.html` via **GitHub Pages** (or any static host). No build step. No npm install.

```text
DAYSHIFT/
├── index.html
├── css/main.css          # custom design system (no Tailwind)
├── js/
│   ├── app.js            # cockpit wiring
│   ├── engine.js         # SafeSpend · RentGap · Buffer · Peers · 6-pass pipeline
│   ├── viz3d.js          # Three.js hero orb + ledger cashflow field
│   └── charts.js         # canvas rings, gauges, timelines
├── data/bundle.json      # 220 workers + 10 spotlight full ledgers
└── README.md
```

## What it does (beyond money in / money out)

1. **SafeSpend** — Balance − reserved bills − volatility buffer − outstanding advances + pending pay lag → today’s spendable CAD  
2. **Rent Gap Radar** — Projects shift income against fixed obligations; shift-count to close the gap  
3. **Buffer Days OS** — Runway simulator (extra shifts / skip advance / cut discretionary)  
4. **Shift ROI** — Net minus same-day burn (transit, food, childcare)  
5. **Skip the Fee** — Advance cost in minutes of an average shift  
6. **Peer Ground Truth** — Compare buffer/fees to same occupation × rent burden × pay type  
7. **6-pass pipeline** — Forward-feeding analysis + Web Speech briefing  
8. **3D** — WebGL SafeSpend orb (hero) + cashflow bar field (ledger)

## Demo path (90 seconds)

See **[DEMO.md](DEMO.md)** for the full judge script.

1. Land on hero → WebGL orb + SafeSpend chip (default **Apr 27** crisis week)  
2. **Tour W-0001** / **Auto demo** → cockpit shows **$0 / RED · PROTECT** (true balance ~$787 vs rent $2,056 in 4 days)  
3. **Can I buy this?** → green / yellow / red verdict  
4. **Rent Gap** → shortfall + shift target before housing hits  
5. **Run pipeline** → forward-feeding passes → **Speak briefing**  
6. Switch to ★ **W-0002** or **W-0156** for green / amber contrast  

Keys: `1`–`7` sections · `T` tour · `B` buy · `P` pipeline

Spotlight workers (★ in picker) have full earnings / transactions / advances:  
`W-0001, W-0002, W-0009, W-0015, W-0019, W-0031, W-0086, W-0126, W-0156, W-0210`

## Local preview

**Double-click `index.html` or open it in Safari/Chrome** — no server required. Data loads from `data/bundle.js` (classic script, works on `file://`).

For WebGL hero + 3D ledger, use any static host (GitHub Pages or `python3 -m http.server 8765`).

```bash
cd /path/to/Hackathon
python3 -m http.server 8765
# open http://localhost:8765
```

Regenerate data after CSV changes:

```bash
python3 scripts/build_bundle.py   # writes data/bundle.json + data/bundle.js
```

## GitHub Pages

Enable Pages from the repo root (or `/docs`). Add `.nojekyll` (included).  
Three.js loads from jsDelivr via import maps — needs network on first load.

## Data

`data/bundle.json` is generated from the hackathon CSVs (`workers`, `daily_earnings`, `transactions`, `recurring_obligations`, `earned_wage_advances`, `weekly_cashflow_summary`). Regenerate:

```bash
python3 scripts/build_bundle.py
```

## Stack

- Vanilla HTML / CSS / ES modules  
- [Three.js r170](https://threejs.org/) (CDN, lazy — 2D works offline)  
- Canvas 2D charts (HiDPI-safe)  
- Web Speech API for spoken verdicts  

No React. No Tailwind. No bundler. Built for cheap phones between shifts.

## Engine notes (judge-facing)

- **Pure-function core** — every export in `js/engine.js` is total over `(detail, card, asOf)` with no cached state, so the five-date simulator re-derives all panels correctly.
- **SafeSpend** — balance − weighted unpaid obligations − volatility buffer − outstanding advances (as-of filtered) + pending pay (skips deposits already landed).
- **Skip the fee** — advance fees priced in *minutes of an average shift* using real `hours`, plus simple APR when `repaid_at` exists.
- **6-pass pipeline** — accumulator threads forecast → schedule → SafeSpend → Rent Gap → peers → spoken briefing.
- **Boot resilience** — classic-script 8s watchdog, 3-URL bundle fetch, lazy `import("./viz3d.js")` after first paint.

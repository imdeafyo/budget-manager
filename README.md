# Budget Manager

Personal budgeting and financial-planning app for a dual-income household —
**dual-earner tax calculations**, **annual bonus support**, **transactions with
import & auto-categorization**, **milestones**, **charts**, and
**FIRE-aware compound-growth forecasting** (per-account, pool-aware, with loans
and ending obligations).

## What It Does

* Calculates net income for two earners (federal + state taxes, 401(k),
  pre/post-tax deductions), with annual bonuses taxed at marginal rates
* Tracks recurring expenses and savings with category tagging; weekly pay
  (52/yr), budgeted on 48 paychecks
* Imports transactions from CSV, auto-categorizes via a rule engine, detects
  duplicates and transfers, and compares actual spending against budget
* Saves user-curated **milestones** for historical comparison, plus automatic
  server-side backup history
* Charts for income, savings, spending history, and budget allocation
* Compound-growth forecasting: a **Simple** whole-portfolio view and an
  **Advanced** per-account, IRS-pool-aware view, both with a tax-aware FIRE
  target; plus a **Loans** amortization tracker

## Themes

Three built-in themes, toggled in the header:

* Light — clean white/warm background
* Dark — dark mode
* WAF (Wife Approval Factor) — sage green and muted stone tones, designed to
  look good on a shared screen

## Architecture

Frontend (React + Vite) -> Express API -> PostgreSQL. Deployed on K8s (CNPG,
Traefik, Flux GitOps). A standalone single-file `budget-manager-generic.html`
mirrors the app using localStorage instead of the API.

**The source is the source of truth for how anything works.** The map below
says only *where* each feature lives so you know which file to open — it does
not describe behavior, because a prose description of behavior drifts from the
code. When the two disagree, the code is right; fix the map.

### Where things live

Frontend, under `src/frontend/`:

| Feature / concern | Primary file(s) |
| --- | --- |
| App shell, tab + subtab routing, ErrorBoundary | `App.jsx` |
| All app state, calculations, persistence, hash routing | `hooks/useAppState.jsx` |
| Shared UI components (Card, NI, PI, Row, ExpRowInner, SavRowInner...) | `components/ui.jsx` |
| CSV import wizard (mapping, profile detection, preview) | `components/ImportModal.jsx` |
| Federal + state tax DB, forecast account pools | `data/taxDB.js` |
| Pure calc (tax, match, forecast, milestone recalc, per-account growth) | `utils/calc.js` |
| Itemized vs. standard deduction (SALT cap, phase-out, medical floor) | `utils/deductions.js` |
| Tax-aware FIRE target math | `utils/fireTarget.js` |
| IRS indexing of brackets / standard deduction for projection years | `utils/taxIndexing.js` |
| Actual-vs-budget aggregation & period conversion | `utils/budgetCompare.js` |
| Forecast actuals (windowed savings-rate / contribution math) | `utils/forecastActuals.js` |
| Loan amortization tracker | `utils/loans.js` |
| Sub-loan group aggregation | `utils/subLoans.js` |
| Ending obligations (freed-cash-flow + loan-mode amortization) | `utils/endingItems.js` |
| One-time forecast events (dated lump sums) | `utils/oneTimeEvents.js` |
| Auto-categorization rule engine | `utils/rules.js` |
| Transfer detection | `utils/transfers.js` |
| Transaction splits | `utils/splits.js` |
| Refund netting | `utils/refunds.js` |
| Outlier detection (MAD) | `utils/outliers.js` |
| Import-time dup hashing / cross-account fuzzy scan | `utils/duplicateScan.js`, `utils/importPipeline.js` |
| CSV parse / build (RFC 4180) | `utils/csv.js` |
| Backup-history client helpers | `utils/history.js` |
| Client diagnostic ring buffer | `utils/log.js` |
| Fetch wrapper (X-Request-Id correlation) | `utils/apiFetch.js` |
| Storage wrapper w/ in-memory fallback (file:// SecurityError) | `utils/safeStorage.js` |
| Tax Rates tab (`#taxes`) | `tabs/TaxRatesTab.jsx` |
| Income tab (`#settings`) | `tabs/IncomeTab.jsx` |
| Budget tab + BudgetToolbar / Save Milestone (`#budget`) | `tabs/BudgetTab.jsx` |
| Milestones list / detail | `tabs/MilestonesSubtab.jsx`, `tabs/MilestoneViewTab.jsx` |
| Transactions tab (`#transactions`) | `tabs/TransactionsTab.jsx` |
| Trends charts | `tabs/ChartsTab.jsx` |
| Simple forecast | `tabs/ForecastTab.jsx` |
| Advanced per-account forecast | `tabs/AdvancedForecastTab.jsx` |
| Loans subtab | `tabs/LoansTab.jsx` |
| Categories tab (`#cats`) | `tabs/CategoriesTab.jsx` |
| Settings tab (`#prefs`) | `tabs/SettingsTab.jsx` |

Server, under `src/`:

| Concern | File |
| --- | --- |
| Express app, Postgres pool, all `/api/*` endpoints | `server.js` |
| Pino logger + slow-query pool wrapper | `lib/logger.js` |
| X-Request-Id middleware + per-request child logger | `lib/requestId.js` |
| HTTP access-log middleware | `lib/httpLog.js` |

Tests are colocated `*.test.js` beside each util (Vitest) plus
`src/lib/*.test.js` (node:test). The roadmap and backlog live in `TODO.md`.

## Generic HTML Version

A standalone single-file HTML version (`budget-manager-generic.html`) uses
localStorage instead of the API. Built automatically:

```bash
node scripts/build-generic.mjs
```

The CI workflow `build-generic.yaml` auto-commits it on push to main.

## Testing

Vitest suite (800+ tests) covers tax brackets across 31 years and all 50
states, milestone recalculation, period-conversion round-trips, forecast math
(simple + per-account + pool limits + underwater handling), loan amortization,
ending obligations, CSV round-trips, duplicate/transfer/refund/outlier logic,
and the generic-persistence round-trip. Server-side `node:test` covers the
pool wrapper and a boot smoke test.

```bash
cd src/frontend
npm test -- --run     # single run
npm run test:watch    # watch mode
npm run coverage      # coverage report
```

```bash
node --test src/lib/*.test.js   # server-side, from repo root
```

CI runs both on every push and PR via `.github/workflows/test.yaml`.

## Deploy

1. Create CNPG database named `budget_manager` (tables auto-create)
2. Update `helm/helmrelease.yaml` with the GHCR user + CNPG connection string
3. Push to GitHub — Actions builds the image -> Flux deploys
4. Copy the image digest from the Actions summary and pin it in the Helm chart

## Local Dev

```bash
cd src/frontend && npm install
DATABASE_URL=postgresql://user:pass@localhost:5432/budget npm start   # from repo root
```

## Stack

React + Vite + Recharts | Node.js + Express | PostgreSQL (CNPG) | Vitest |
Helm / Flux / Traefik | GitHub Actions (build, test, generic HTML)

See `DATABASE.md` for schema and persistence details.

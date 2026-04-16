# Budget Manager

Personal budgeting app with **dual-income tax calculations**, **annual bonus support**, **snapshots**, **charts**, and **compound growth forecasting**.

## What It Does

* Calculates net income for two earners (federal + state taxes, 401(k), pre/post-tax deductions)
* Supports annual bonuses taxed at marginal rates
* Tracks recurring expenses and savings with category tagging
* Saves financial snapshots for historical comparison
* Displays charts for income, savings, spending history, and budget allocation
* Projects compound growth of savings with nominal vs real (inflation-adjusted) values
* "Time to X months of expenses" calculator

## Themes

Three built-in themes, toggled in the header:

* ☀️ **Light** — clean white/warm background
* 🌙 **Dark** — dark mode
* 🌸 **WAF** (Wife Approval Factor) — sage green and muted stone tones, designed to look good on a shared screen

## Architecture

```
src/frontend/
  App.jsx              — thin shell (~100 lines), tab routing + layout
  hooks/useAppState.jsx — all app state, calculations, persistence (466 lines)
  components/ui.jsx    — shared UI components (Card, NI, Row, etc.)
  data/taxDB.js        — 31 years of federal brackets (1996–2026) + all 50 states + DC
  utils/calc.js        — pure calculation functions (tax, match, forecast, recalcSnapPure)
  tabs/
    TaxRatesTab.jsx    — federal/state tax configuration
    IncomeTab.jsx      — salaries, 401(k), deductions, bonus %
    BudgetTab.jsx      — expense/savings line items with period columns
    ChartsTab.jsx      — trend lines, pie charts, snapshot history
    ForecastTab.jsx    — compound growth projections + time-to-goal
    CategoriesTab.jsx  — expense/savings category management
    SnapshotViewTab.jsx — snapshot detail view with inline editing
```

Frontend (React) → Express API → PostgreSQL. Deployed on K8s (CNPG, Traefik, Flux GitOps).

## Generic HTML Version

A standalone single-file HTML version (`budget-manager-generic.html`) uses localStorage instead of the API. Built automatically:

```bash
node scripts/build-generic.mjs
```

The CI workflow `build-generic.yaml` auto-commits it on push to main.

## Testing

48 tests covering tax brackets, state tax calculations, snapshot recalculation (including the pre-tax deduction regression), period conversion round-trips, and forecast math.

```bash
cd src/frontend
npm test          # single run
npm run test:watch  # watch mode
```

CI runs tests on every push and PR via `.github/workflows/test.yaml`.

## Deploy

1. Create CNPG database named `budget_manager` (tables auto-create)
2. Update `helm/helmrelease.yaml` with:
   * GitHub container registry user
   * CNPG connection string
3. Push to GitHub
4. GitHub Actions builds image → Flux deploys
5. Copy image digest from Actions summary and pin in Helm chart

## Update the App

Edit files under `src/frontend/`, then:

```bash
git add .
git commit -m "description"
git push
```

CI will run tests, build the Docker image, and regenerate the generic HTML automatically.

## Local Dev

```bash
cd src/frontend && npm install   # frontend deps
npm start                         # from repo root (needs DATABASE_URL)
```

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/budget npm start
```

## Stack

* React + Vite + Recharts
* Node.js + Express
* PostgreSQL (CNPG)
* Vitest
* Helm / Flux / Traefik
* GitHub Actions (build, test, generic HTML)

See DATABASE.md for schema and persistence details.

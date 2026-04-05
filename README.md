# Budget Manager

Personal budgeting app with **dual-income tax calculations**, **annual bonus support**, **snapshots**, and **charts**.

## What It Does

* Calculates net income for two earners
* Supports annual bonuses
* Tracks recurring expenses
* Saves financial snapshots for comparison
* Displays charts for income, savings, and spending

## How It Works

Frontend (React) sends budget data → Node API → PostgreSQL stores data → charts render calculated totals.

## Deploy

1. Create CNPG database named `budget_manager` (tables auto-create)
2. Update `helm/helmrelease.yaml` with:

   * GitHub container registry user
   * CNPG connection string
3. Push to GitHub
4. GitHub Actions builds image → Flux deploys
5. Copy image digest from Actions summary and pin in Helm chart

## Update the App

Replace:

```
src/frontend/App.jsx
```

Then push:

```
git add .
git commit -m "update"
git push
```

Grab new image digest from Actions and update Helm.

## Local Dev

Install deps:

```
npm install
```

Run:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/budget npm start
```

## Stack

* React
* Node.js
* PostgreSQL
* Helm / Flux
* GitHub Actions

See DATABASE.md for schema and persistence details

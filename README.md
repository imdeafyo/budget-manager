# Budget Manager

Personal budget app with dual-income tax calculations, EAIP, snapshots, charts.

## Deploy

1. Create CNPG database `budget_manager` (tables auto-create on startup)
2. Update `helm/helmrelease.yaml` with your GitHub user and CNPG connection
3. Push to GitHub → Actions builds image → Flux deploys

## Update the app

1. Replace `src/frontend/App.jsx` with new version from Claude
2. `git add . && git commit -m "update" && git push`
3. Image rebuilds, Flux reconciles

## Local dev

```bash
npm install
cd src/frontend && npm install && cd ../..
DATABASE_URL=postgresql://user:pass@localhost:5432/budget npm start
```

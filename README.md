# Budget Manager

Personal budget app with dual-income tax calculations, annual bonus support, snapshots, and charts.

## Deploy

1. Create CNPG database `budget_manager` (tables auto-create on startup)
2. Update `helm/helmrelease.yaml` with your GitHub user and CNPG connection
3. Push to GitHub → Actions builds image → Flux deploys
4. After build, check the Actions run summary for the digest to pin in your helm chart

## Update the app

1. Replace `src/frontend/App.jsx` with new version from Claude
2. `git add . && git commit -m "update" && git push`
3. Image rebuilds — grab new digest from Actions summary, update helm chart

## Local dev

```bash
npm install
cd src/frontend && npm install && cd ../..
DATABASE_URL=postgresql://user:pass@localhost:5432/budget npm start
```

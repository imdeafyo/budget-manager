# Database

The app uses PostgreSQL (CNPG) and automatically creates tables on startup.

## Connection

Set the connection string:

```
DATABASE_URL=postgresql://user:pass@host:5432/budget_manager
```

## Tables

### incomes

Stores both earners' income data.

* id
* primary_income
* secondary_income
* bonus
* tax_rate_primary
* tax_rate_secondary
* created_at

### expenses

Recurring monthly expenses.

* id
* name
* amount
* created_at

### snapshots

Saved financial states for comparison.

* id
* total_income
* total_expenses
* net
* created_at

### settings

App-level configuration.

* id
* savings_goal
* notes

## Behavior

* Tables auto-create on startup
* No migrations required
* Snapshots are immutable
* Calculations happen in API layer

## Reset Database

Drop tables manually if needed:

```
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

They will be recreated on next start.


# Backlog

Genuine maybe-someday items. Things that surfaced mid-session but didn't
belong in the session they appeared in. Roadmap-level deferrals live in the
project instructions; this file is for smaller specific items.

## Advanced Forecast — Ending Obligations

### Phase X-B — Starting obligations + pool-cap + extra payments

Followup to Phase X-A. The data model and math layer already scaffold
`effect: "starts"`; this phase wires it into the UI.

Scope:

- **Starting obligations UI** — flip the `effect: "starts"` flag (data
  model + math already support it). UI lets you add an obligation that
  begins at a future date, diverting cash from the destination account
  from that point on. Useful for "what if we take on a mortgage in 3
  years" scenarios.
- **Pool-overflow surfacing** — currently, freed cash directed at a
  capped destination account (e.g. routing a paid-off loan into a 401k)
  bypasses the IRS pool cap silently. Surface this in the UI: warn at
  edit time, flag in the chart legend, and add a `poolOverflow` array
  to the forecast result so callers can render the warning.
- **Extra-payment scenarios for loan-mode items**:
  - Biweekly payment toggle (effectively 13 monthly payments per year)
  - Optional monthly extra-principal field
  - Both reduce the computed `endsOn`; recompute on input change in UI
  - Tests for amortization with each

### Phase X-C — Loan-mode polish

- **Variable-rate loans** — out of scope for X-A. ARM-style step-ups or
  user-edited rate changes over time.
- **Interest-only or balloon payments** — separate amortization shape.
- **Per-event chart annotations** — small marker on the AdvancedForecast
  timeline at each ending event. Data model already supports
  enumerating events (resolveEndingEvents output); just needs chart
  layer work.
- **Bonus-payment-to-principal scenarios** — one-time lump sums applied
  to principal, which would shift the computed endsOn earlier.

## Server / Infrastructure

### PVC for log persistence (Phase 6.5b-B, deferred)

Mount `/var/lib/budget-manager/` (FHS standard), `DATA_DIR` env var
defaults there in prod / `./data` in dev. Pino file transport into
`${DATA_DIR}/logs/` with daily rotation, 30-day retention. Subdirs
reserved: `logs/`, `uploads/`, `exports/`, `ml/`, `users/`. Start size
5Gi. Manifest YAML is on Corey. Not urgent — `kubectl logs` is enough
for the use case right now.

### `DATABASE_URL` vs `PG*` env vars

Currently `server.js` reads `DATABASE_URL` but the K8s manifests pass
`PGHOST/PGUSER/etc.` Works via pg's env-var fallback, but it's a
foot-gun. Pick one. Document it. Don't let the code support both with
foot-guns in the seams.

### Server-side blocking on state-shape anomalies

Currently logging-only via the tripwire on PUT `/api/state`. Revisit
after a few weeks of seeing what shapes actually arrive in practice.

### Schema-bootstrap slow-query noise

The cold-boot `CREATE TABLE IF NOT EXISTS …` block legitimately crosses
500ms on a fresh pod, firing the slow-query warn log. Decide between
bumping the global threshold or exempting the bootstrap query
specifically. Needs ~week of log data to triage.

## Phase 15 follow-ups (Tax-aware FIRE target)

### Phase 16 — Time-varying retirement spending (go-go / slow-go / no-go)

The current FIRE math uses a single annual spending number for the
entire retirement. Real retirement spending is lumpy: travel-heavy
early years (50-65), settled middle (65-80), healthcare-heavy late
(80+). Replace the single-spending input with three age-banded
inputs and compute a present-value-against-SWR target instead of a
flat multiplier. Math is meaningfully more complex (variable cash
flow stream); UI is its own design problem. Park until 8A/9B/14 ship
and the simple single-spending override has been used in anger for a
few months.

### Healthcare cushion as a structured input

Currently the pre-Medicare healthcare gap is handled by a tooltip
nudge ("bake it into your spending override"). If users keep getting
this wrong in real planning sessions, add a separate "Healthcare gap"
input on the FIRE card: `$X/yr × (yearsUntilMedicare)` added as a
lump-sum bump to the target. Don't build speculatively — wait for the
need to be obvious.

### Withdrawal-order modeling

Currently we use pro-rata across account types (50% Traditional + 25%
Roth → 50% of withdrawals taxed as ordinary income, 25% tax-free).
Real retirees often optimize: taxable first (let tax-deferred keep
growing), Roth conversion ladders, RMD-driven sequencing. Adding this
would let users model strategies but the UI complexity is high and the
benefit is marginal for planning-time decisions. Don't build unless
multiple users ask for it.

### State-LTCG nuance

We currently assume all states tax LTCG as ordinary income
(conservative — overstates target for residents of no-income-tax
states like FL/TX/NV/WA/etc.). If Corey or a future user moves to one
of those states, add a per-state override for LTCG treatment. Tiny
backlog item, only worth doing if it actually bites.

### Different states per partner

`taxConfig.stateAbbr` defaults to `tax.p1State.abbr` and falls back to
`tax.p2State.abbr`. Most dual-income households file MFJ from one
state, so this is fine. If a user ever has partners residing in
different states (rare), the FIRE estimate will slightly understate
state tax for the higher-rate partner's residence. Surface a warning
if `p1State.abbr !== p2State.abbr`, or model both states.

# Roadmap

A board, not a phase plan. Work here is organized by **state**, not by a
sequence number — most of it isn't sequential, it's "whatever's annoying in
real use this week." The question this file answers is *what's next*.

How to read it:

- **Now** — the next session or two. Short by design.
- **Next** — wanted, started by nobody, no blocker. Unordered. Pick by need.
- **Blocked** — genuinely needs something first. The blocker is named.
- **Someday** — parked. Real but not now. Deep detail lives in `BACKLOG.md`.
- **Shipped** — done log, newest first, with commit hash.

An item is a title + one line of motivation + one line of scope. If it needs
sub-steps, they go in a short checklist *inside* the item — not a new phase.
Dependencies are a plain `Blocked on:` line, not an implied ordering.

Maintenance: when something ships, move it to **Shipped** with its hash **in
the same commit as the work**. Same discipline as `BACKLOG.md`. This file is
in the repo specifically so it can be updated on push instead of by hand.

---

## Now

### Line-chart date-input blur bug
Motivation: clicking a chart point to set a date range, then editing the date
input to fine-tune it, clears the selection on blur.
Scope: the outside-click / blur handler treats the date input as "outside" and
resets state — scope the handler so the date input doesn't count as outside.
Ships with a regression test pinning the behavior.

---

## Next

### Starting obligations UI (was Phase X-B)
Motivation: model "what if we take on a mortgage in 3 years" — the data model
and math already scaffold `effect: "starts"`, only the UI is missing.
Scope: UI to add a future-dated obligation that diverts cash from the
destination account from that point on. Detail in `BACKLOG.md`.

### Pool-overflow surfacing (was Phase X-B)
Motivation: freed cash routed at a capped account (paid-off loan → 401k)
silently bypasses the IRS pool cap.
Scope: warn at edit time, flag in the chart legend, add a `poolOverflow` array
to the forecast result so callers can render it.

### Extra-payment scenarios for loan-mode items (was Phase X-B)
Motivation: common "what if I pay biweekly / add $X/mo to principal" question.
Scope: biweekly toggle (13 monthly equivalents/yr) + optional monthly extra
field; both reduce computed `endsOn`; recompute on input; amortization tests.

### Loan ↔ Ending Obligation sync (was Phase 14c)
Motivation: a mortgage gets entered twice — once in Loans (decorative
amortization), once in an Ending Obligation (drives the forecast) — and
refinances force editing both. Real friction, screenshot review 2026-05-26.
Scope: per-row link picker + direction toggle on each Loan; sync
principal↔balance and rate; subtle sync indicator; backfill-detect banner.
Full design (Option A) in `BACKLOG.md`. Probably 1–2 sessions.

### Account balance as-of + roll-forward
Motivation: Bulk as-of only touches Ending Obligations / sub-loans because
only they carry `balanceAsOf`. Accounts don't — so "my 401k was $312k as of
2026-02" can't roll forward; you update it mentally.
Scope: give forecast accounts a `balanceAsOf`, unify with the bulk as-of
control. Detail in `BACKLOG.md`.

---

## Blocked

### Mobile / tablet responsiveness triage
Motivation: app is used on computer, tablet, and phone; tablet is the awkward
middle case. Reference-on-mobile with occasional edits.
Scope: screenshot broken/ugly spots, then prioritize. A triage session, not a
build session.
**Blocked on:** the app open on real devices. Can't be done in the abstract.

### Generic auto-update check
Motivation: people download generic and want the latest without the manual
import dance.
Scope: version check is easy (`GET /releases/latest`); the hard part is data
surviving an HTML file swap, especially on `file://` origins.
**Blocked on:** a design decision about the data-persistence path across file
swaps. Likely needs an export/import-after-update fallback.

### Server-side blocking on state-shape anomalies
Motivation: the `PUT /api/state` tripwire is logging-only today.
Scope: decide whether to block on anomalous shapes.
**Blocked on:** a few weeks of seeing what shapes actually arrive.

### Schema-bootstrap slow-query noise
Motivation: cold-boot `CREATE TABLE IF NOT EXISTS` legitimately crosses 500ms
on a fresh pod and logs as a slow query.
Scope: bump the global threshold vs exempt the bootstrap query.
**Blocked on:** ~a week of log data to tell which fix is right.

---

## Someday

Parked but real. Detail for most of these lives in `BACKLOG.md`.

- **Loan-mode polish (was Phase X-C):** variable-rate / ARM step-ups,
  interest-only or balloon shapes, per-event chart annotations,
  bonus-lump-to-principal.
- **Graduated-repayment loans:** payments that step up over time.
- **Time-varying retirement spending (go-go / slow-go / no-go):** age-banded
  spend multipliers feeding the FIRE target.
- **Healthcare cushion as a structured FIRE input;** withdrawal-order
  modeling; state-LTCG nuance; different states per partner.
- **Stable IDs for budget line items** (exp/sav rows) — groundwork that
  several future features lean on.
- **In-app bug feedback** — capture a screenshot + diagnostics ring buffer.
- **`DATABASE_URL` vs `PG*` env vars:** pick one, document it, kill the
  foot-gun in the seams.
- **PVC for log persistence (was Phase 6.5b-B):** mount `DATA_DIR`, Pino file
  transport with rotation/retention. `kubectl logs` is enough for now.
- **Per-account `borrowRate` override:** turn underwater-flat into
  accrues-at-rate. Probably unnecessary now that Loans exist.
- **TypeScript / JSDoc migration:** value unsettled — bugs so far have been
  logic, not type. Revisit if type-mismatch bugs recur.

Genuinely rejected unless pain reappears: auto-milestones (pollutes the
curated list; backup history covers the smooth-chart case), keyboard shortcuts
(not reached for in this app), tax-withholding comparison (once-a-year),
print/PDF view (screenshots win), cloud backup for generic (no demand,
high-risk encryption layer).

---

## Shipped

Newest first.

- **Generic build: marker-based injection** — stable `@generic:*` JSX-comment
  markers replace fragile string-literal anchors; `patchStrict` asserts on
  miss. `78df06c`, `a89935c`
- **Sub-loan obligations: don't silently drop on amortization error** —
  surface the failure instead of dropping the obligation. `415999e`
- **Lump-sum payoff on sub-loan obligations** — multiple lump events can link
  one obligation; partial payoff no longer collapses FIRE target as a full
  payoff; month-index convention fixed. `4a7bec2`, `19d3aed`, `a16469b`,
  `df1e412`
- **HSA overhaul — strictly per-person** — per-person contribution limits
  (`hsa::p1`/`hsa::p2`), per-account `hsaCoverage`, split-share % UI,
  first-class per-person Income field, killed the auto-fill double-count.
  `a97b3b1`, `a5e2577`, `67fc3d8`, `7924bca`, `12d4797`
- **One-time event amount colored by sign** + color override fix. `0d6841c`,
  `dcf377c`
- **Debt Remaining from loan obligations + lump-sum paydowns** — includes
  sub-loan obligations; paydown-aware payoff date in the obligation row and
  FIRE target. `105dd4f`, `27f2a2b`, `3536a21`
- **Forecast one-time payoff events linked to ending obligations** —
  deterministic payoff-link toggle, responsive events layout, TDZ-crash fix
  (hoist `oneTimeEvents` above the loan-recompute effect), events-fire-a-
  year-late fix. `ca7eea4`, `d94b559`, `7fb4839`, `0aa2ae6`
- **Loans moved to its own Charts subtab** — `LoansTab.jsx`, `loans` subtab.
  `a30659d`
- **Loans rewrite (new shape)** — dropped source/target/overflow account
  coupling; loans are a pure amortization tracker (`extraMonthlyPrincipal`,
  `amortizationSchedule`, `resolveLoans`, `aggregateDebt`, `payoffMonthIndex`);
  removed the dead `appliedLoans` prop from the forecast math.
- **Milestone Compare subtab** — `budget/compare`, A/B dropdowns with
  "Current", per-line + summary deltas, show-unchanged toggle. `a8b5ed0`
- **Tax-aware FIRE target** — target derives from the live account mix at
  horizon (ordinary / LTCG / tax-free), configurable SWR, annual-withdrawal
  display; steps down as ending obligations end; falls back to 25× when off.
  `a61fc13`, `2ef856a`, `c2e9d85`
- **Multi-item ending obligations** — one obligation links multiple budget
  items; one-ending-per-item invariant; loan-mode uses summed monthly across
  linked items for `endsOn`. `6c1225e`
- **Bulk As-of toggle on Ending Obligations** + as-of master moved to the top
  scenario toolbar. `e1ec2b5`, `93e9842`, `fc2018c`
- **Mobile fixes** — horizontal overflow on Advanced, clipped one-time-event
  labels on the forecast chart. `56c23e9`, `faaf4bd`

Older history (transactions foundation, intelligence, diagnostics, server-side
logging, forecast actuals, per-account forecast, perf passes, duplicate scan,
Settings restructure) predates this file — see git history and the prior
project-instructions Done list.

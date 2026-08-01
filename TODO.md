# TODO

One file. Everything's here.

Grouped by **area** of the app, not by phase number or by when it was thought
of. Within each area, ready work sits at the top and parked ideas sink to the
bottom. Each item is a title, one line of why, and — if it has a real design —
that design sits right underneath it. No second file to chase.

Every item carries a status tag so you can tell at a glance whether you can
pick it up:

- **`ready`** — no blocker, grab it whenever.
- **`blocked: <reason>`** — genuinely needs something first; the reason is named.
- **`parked`** — real, but not now. No promises.

When something ships, move it to **Done** at the bottom with its commit hash,
**in the same commit as the work**. That discipline is the only thing that
keeps this file honest — the last setup drifted because it lapsed.

---

## Forecast & Loans

### Starting obligations UI — `ready`
Model "what if we take on a mortgage in 3 years." The data model and math
already scaffold `effect: "starts"`; only the UI is missing.

- UI to add a future-dated obligation that diverts cash from the destination
  account from that point on.
- The `effect: "starts"` flag already exists in the data model + math layer —
  this is a UI wiring job.

### Pool-overflow surfacing — `ready`
Freed cash routed at a capped account (paid-off loan → 401k) silently bypasses
the IRS pool cap.

- Warn at edit time.
- Flag in the chart legend.
- Add a `poolOverflow` array to the forecast result so callers can render the
  warning.

### Extra-payment scenarios for loan-mode items — `ready`
The common "what if I pay biweekly / add $X/mo to principal" question.

- Biweekly payment toggle (effectively 13 monthly payments per year).
- Optional monthly extra-principal field.
- Both reduce the computed `endsOn`; recompute on input change.
- Amortization tests for each.

### Account balance as-of + roll-forward — `ready`
The bulk as-of control only touches Ending Obligations / sub-loans, because
only they carry `balanceAsOf`. Accounts don't — so "my 401k was $312k as of
2026-02" can't roll forward; you update it mentally. This makes the as-of model
inconsistent across the page and the bulk button silently skips accounts.

Why it's not a one-line button: `rollForwardBalance` in `endingItems.js` is
built for *debt* — it accrues interest and **subtracts** a payment, walking a
balance down. An investment account is the sign-flipped mirror: accrue return
and **add** contributions, walking up. Can't reuse as-is.

Scope:

- Add `balanceAsOf` to the account shape (`defaultForecastAccounts` in
  taxDB.js + loader migration: missing `balanceAsOf` defaults to base
  year-month, same one-time-backfill shim pattern as milestones).
- New roll-forward helper (sibling to `rollForwardBalance`) for the growth
  case: `startBalance` accrues `annualReturn` monthly and adds contributions
  over the gap from `balanceAsOf` to base.
  - **Open design question — how do contributions interact with the gap?**
    (a) ignore contributions during the gap, roll by return only (simplest,
    slight undercount); (b) accrue the projected monthly contribution over the
    gap too (more accurate, but the contribution figure is itself derived from
    budget/actuals and may not have been valid during the gap). **Lean (a)** —
    the gap is usually 1–3 months, the error is small, and it avoids the "was
    this contribution rate even true back then" rabbit hole. Decide before
    building.
- Per-account as-of input in the accounts table (mirrors the existing sub-loan
  as-of input UI).
- Extend `applyBulkAsOf` to also stamp every account's `balanceAsOf`; update
  the bulk button's tooltip to say it covers accounts. Stale-months hint on
  accounts like loans have.
- Tests: roll-forward math (return-only, and with contributions if chosen),
  no-op when as-of ≥ base, loader backfill idempotency, bulk-apply hits
  accounts.

Probably 1 session. Decide the contribution question first.

### Loan ↔ Ending Obligation sync — `parked`
A mortgage gets entered twice — once in Loans (decorative amortization), once
in an Ending Obligation (drives the forecast) — and refinances force editing
both. Real friction, surfaced in screenshot review 2026-05-26 (mortgage
entered twice, 6.3 vs 6.5).

Design (preferred — Option A):

- **Per-row link picker on each Loan.** Dropdown of all loan-mode Ending
  Obligations: `— Unlinked —` | `Mortgage P&I + Extra (combined)` | … Default
  `Unlinked` so existing rows aren't auto-linked.
- **Direction toggle** next to the picker: `→` (Loan writes to EO, most
  common), `←` (EO writes to Loan), `⇄` (bidirectional, last-write-wins).
- **Fields that sync:** Principal ↔ EO balance, Rate % ↔ EO rate. Maybe
  Origination ↔ EO start date. **Extra/mo does NOT sync** — keep it as a
  scratch-pad field. Add a separate "Apply extra to budget" one-shot button
  that adds the extra to the linked budget item.
- **EO label rendering:** when the EO links multiple budget items, show the
  combined name so it's clear one Loan row syncs to two budget lines.
- **Subtle sync indicator** when linked: "↻ syncing to Mortgage P&I" under the
  row.
- **Backfill prompt:** on tab load, if a Loan + EO look related (balance ±10%,
  rate ±0.5%), one-time banner offering to link them.

Out of scope for the first cut: auto-creating an EO from a Loan or vice versa;
splitting one Loan across multiple EOs.

Not urgent — real friction appears over months, not weeks. Probably 1–2
sessions.

### Origination-date start toggle (Ending Obligations) — `parked`
A loan-mode Ending Obligation infers the loan start from the obligation's start
date (effectively "today"). For a loan amortizing for years, the user has to do
mental math to get today's balance.

Add a toggle: **"Start date"** vs **"Origination date."** When Origination, the
user enters original principal + original date; the math walks the amortization
forward to today and uses *that* remaining balance. Matches how the loan math
handles mid-schedule loans via `remainingAtBase`.

Small — mostly UI + a tiny math hop. 1 session.

### Time-varying FIRE target (expense step-down as obligations/loans end) — `ready`
The FIRE target's expense basis is a single static number — it never steps down
when a budgeted obligation ends, so the model assumes you carry your mortgage
payment forever, overstating the required nest egg for anyone with a payoff
date inside their horizon.

(Was gated on Loans shipping. Loans has shipped — gate lifted.)

The inputs already exist and don't talk to FIRE yet:

- `utils/endingItems.js` already computes *when* a budgeted expense stops
  freeing cash flow, including loan-mode obligations deriving `endsOn` via
  amortization.
- The shipped Loans module produces a payoff date + amortization curve per
  loan — a cleaner source for the same signal.

Scope:

- Build a time-series expense profile: start from current annual expenses,
  subtract each obligation's annualized payment from its end month onward
  (Ending Obligations first; fold in Loans payoff dates).
- Make the FIRE target a *curve*, not a scalar: at each year,
  target = expenses-at-that-year, grossed up via the existing tax-aware
  `fireTarget.js` mix logic.
- Redefine "crossover" as the projected balance line meeting the *stepped*
  target line. FI year = first year balance ≥ target-at-that-year.
- UI: render the target as a stepped line (flat-horizontal today). Annotation
  at each step ("Mortgage P&I paid off — target drops $Xk").
- Escape hatch: keep the "Use classic rule" / flat-target toggle.

Composes with time-varying retirement spending below (that's spending changing
*within* retirement; this is spending changing *on the way to* FI). Probably 2
sessions.

### Time-varying retirement spending (go-go / slow-go / no-go) — `parked`
The FIRE math uses one annual spending number for all of retirement. Real
spending is lumpy: travel-heavy early (50–65), settled middle (65–80),
healthcare-heavy late (80+). Replace the single input with three age-banded
inputs and compute a present-value-against-SWR target instead of a flat
multiplier. Math is meaningfully more complex (variable cash-flow stream); UI
is its own design problem. Park until the simple single-spending override has
been used in anger for a few months.

### Loan-mode polish — `parked`
- Variable-rate / ARM-style step-ups or user-edited rate changes over time.
- Interest-only or balloon payments (separate amortization shape).
- Per-event chart annotations — small marker on the timeline at each ending
  event; `resolveEndingEvents` output already enumerates them.
- Bonus-payment-to-principal one-time lumps that shift `endsOn` earlier.

### Graduated repayment loans — `parked`
The Loans rewrite assumes standard fixed-payment amortization. Federal student
loans with graduated repayment step up every 2 years. Two ways to model:

- **Schedule import** — user pastes the lender's published schedule; amortize
  off it directly. Most accurate; generalizes to income-driven repayment too.
- **Parameterized graduation** — a toggle with `startingPayment`,
  `stepEveryNYears`, `stepMultiplier`. Less accurate, more convenient.

Schedule-import is probably right. Park until a real graduated loan needs
modeling.

### Healthcare cushion as a structured FIRE input — `parked`
The pre-Medicare healthcare gap is handled today by a tooltip nudge ("bake it
into your spending override"). If users keep getting this wrong, add a separate
"Healthcare gap" input: `$X/yr × yearsUntilMedicare` added as a lump-sum bump
to the target. Don't build speculatively.

### Withdrawal-order modeling — `parked`
Currently pro-rata across account types. Real retirees optimize: taxable first,
Roth conversion ladders, RMD-driven sequencing. High UI complexity, marginal
planning-time benefit. Don't build unless multiple users ask.

### Itemized deductions — retirement drawdown (`fireTarget.js`) — `parked`

Commit 3 of 3. Blocked on commit 2 landing first (shared helpers).

Harder than commit 2 because of a circularity: the SALT phase-out depends on
MAGI, MAGI is what `grossUpForTaxes` is solving for, and the deduction feeds
back into the tax that determines it. Adding a MAGI-dependent deduction
inside that fixed-point iteration may affect convergence — the existing
6-iteration default was tuned without it. Verify convergence explicitly
rather than assuming.

Also decide whether itemized deductions offset ordinary income only. Current
structure applies the standard deduction to ordinary income and taxes LTCG
at a flat rate separately; matching that is probably right but it's a
modeling decision, not a mechanical substitution.

Lower value than commit 2: in retirement there's typically no mortgage and
much lower SALT, so the standard deduction usually wins anyway.

### State-LTCG nuance — `parked`
We assume all states tax LTCG as ordinary income (conservative — overstates
target for no-income-tax states). Add a per-state override if Corey or a future
user moves to FL/TX/NV/WA/etc. Tiny; only worth it if it bites.

### Different states per partner — `parked`
`taxConfig.stateAbbr` defaults to `p1State.abbr`, falls back to `p2State.abbr`.
Fine for MFJ from one state. If partners ever reside in different states, the
estimate slightly understates state tax for the higher-rate partner. Warn if
`p1State.abbr !== p2State.abbr`, or model both.

### Per-account `borrowRate` override — `parked`
Turn the underwater-flat-balance behavior into "negative balance accrues at
this account's borrowRate." Probably unnecessary now that Loans exist.

---

## Transactions & Import

### Fragmented contributions: import root cause — `ready` (high value)
Discovered while investigating a 362-group duplicate scan. Ground-truthed
against real brokerage statements: the scan's matches on contribution accounts
(401k, HSA, Roth) are NOT duplicates — they're a single real contribution the
import fragmented into multiple identical rows, or split into parts that SUM to
the true amount. The app rows reconstruct the real entries; nothing is
over-counted.

Facts established:

- These rows are identical on every field the scan compares (date, amount,
  description, account) but represent DIFFERENT real dollars. No threshold
  tuning separates them — the disambiguating data (transaction-type code, share
  qty, leg identity) was dropped at import time.
- NOT a transfer artifact: scan ran same-account-only; transfers span two
  accounts.
- BUT genuine duplicates also exist layered on top on some dates. A date can
  have both legit fragments AND real dupes.
- Decision taken: default to treating contribution-account matches as
  legitimate (keep), because wrongly excluding a fragment deletes real
  retirement money and understates FIRE — asymmetric risk vs. a slightly
  over-counted spending row.

The real fix is upstream in the import pipeline, not the dup scan:

1. Figure out WHICH source export produces the fragmented rows and what field
   distinguishes the legs — open the raw CSV from a known batch, compare the
   columns the importer drops. Likely a transaction-type / activity column the
   mapping wizard isn't capturing.
2. Once the field is known, either: preserve it as a custom field on import so
   legs stay distinct (and the scan stops matching them); or collapse the
   fragments at import into one row per real contribution (riskier — changes
   historical numbers; needs a back-compat shim).
3. The scan modal's contribution-account ⚠ warning (already shipped) is the
   stopgap until then.

### Account aliasing (merge two account names into one) — `parked`
Surfaced while making the dup scan account-aware. The dup scan now treats
accounts as distinct by default — that solved the dedup false-positive. The
deeper case it does NOT solve: when two account *names* are really the same
real-world account (authorized-user card imported under its own name, a bank
renaming an export). Every account-scoped feature then sees them as two —
account filter, budget-vs-actual rollups, transfer detection
(`requireDifferentAccounts` can misfire), same-account dup scan misses the
re-import.

Proposed shape (true aliasing, app-wide — distinct from the dup-scan toggle):

1. New `st.accountAliases`: list of groups, each
   `{ id, canonical, members: [...] }`. Canonical is display/storage name;
   members fold in.
2. Pure helper `utils/accountAliases.js` — `resolveAccount(name, aliasMap)`
   returns canonical (or input unchanged). Companion test. Memoize the
   member→canonical map at call sites.
3. Apply `resolveAccount` at **read time** in account-scoped consumers (filter
   dropdown, budgetCompare grouping, transfer `requireDifferentAccounts`,
   dup-scan `normalizeAccount`) rather than rewriting stored rows — reversible,
   no destructive migration. Read-time vs. one-time rewrite is the decision to
   revisit; lean read-time.
4. Settings UI: new card under "Imports & matching" — list groups, pick a
   canonical from existing names, add/remove members. Guard against an account
   being a member of two groups (one-canonical invariant, same shape as the
   Ending-Obligation one-ref-per-item check).
5. Generic build: pure state + read-time resolve, works there with no server
   changes.

Open questions:

- Does `resolveAccount` run before or after rules? Rules can match on account;
  if aliasing runs first, a rule written against the member name stops
  matching. Probably resolve *after* rule matching, or document that rules
  target the canonical name.
- Milestone restore: aliases live in `st`, so restoring an old milestone could
  bring back a stale alias map. Likely let the live alias map win; confirm.

Parked, not rejected. Only worth it if the separate-names problem bites in
day-to-day filtering / rollups.

### JSON import (round-trip the JSON export) — `parked`
The Transactions tab exports JSON (full objects incl. import_batch_id,
custom_fields, splits) but there's no matching import — the export feeds
analysis tooling only. A JSON import would let it round-trip (transaction-level
backup/restore, move data between deploy/generic). Lower priority; the
whole-state JSON export/import on Charts already covers full backups. Only worth
it if transaction-level round-trip becomes a real need.

---

## Core architecture

### Stable IDs for budget line items (exp / sav rows) — `ready`
`exp[]` and `sav[]` are positional arrays. The only "id" is `idx`, derived from
array position at render time. Any index-based reference to a row breaks as soon
as a row above it is deleted or reordered:

- **Ending Obligations** carry `linkedItemRefs` referencing budget items —
  deleting an item above silently re-points the link at the wrong row.
- **Milestone Compare** had to fall back to matching by
  `(section, normalized-name)` — renames look like add+remove.
- **Splits / rules / transaction categories** would have the same problem if
  they ever referenced items by position (none do yet — landmine).

The fix is straightforward but invasive:

1. On item creation (add UI, bulk add, CSV import, migrations, hydration),
   assign a short `id` (e.g. `"e_" + crypto.randomUUID().slice(0, 8)`).
   Persist it.
2. Loader migration: items loaded without `id` get one at hydration, persisted
   next save. Same shim pattern as the milestones rename.
3. Consumers using `idx` for layout / React keys keep doing so; consumers that
   *reference* a specific item across edits switch to `id`.
4. `linkedItemRefs` in Ending Obligations use `id`; backfill existing refs by
   name match on load.
5. `milestoneCompare` prefers `id` match over name match.
6. `recalcMilestonePure` writes ids into `fullState.exp/sav` so saved
   milestones carry the same ids.

Tests: assignment idempotency, loader backfill, ref-stability across
delete-above for both EO links and Compare.

Probably 2 sessions: assignment + loader + migrations + tests, then consumer
cutover + Compare match-by-id + EO ref migration. Should land before Milestone
Compare gets used much in anger — its name-matching is the most visible symptom.

### TypeScript / JSDoc migration — `parked`
Value unsettled — bugs so far have been logic, not type (state-wipe, TDZ,
pool-wrapper undefined, underwater-compound). Lighter alternative: JSDoc
annotations for editor benefits without full migration. Revisit if type-mismatch
bugs recur.

---

## Server & Infrastructure

### `DATABASE_URL` vs `PG*` env vars — `ready`
`server.js` reads `DATABASE_URL` but the K8s manifests pass `PGHOST/PGUSER/etc.`
Works via pg's env-var fallback, but it's a foot-gun. Pick one. Document it.

### Server-side blocking on state-shape anomalies — `blocked: needs a few weeks of real shapes`
The `PUT /api/state` tripwire is logging-only today. Decide whether to block on
anomalous shapes once there's data on what actually arrives in practice.

### Schema-bootstrap slow-query noise — `blocked: needs ~a week of log data`
Cold-boot `CREATE TABLE IF NOT EXISTS` legitimately crosses 500ms on a fresh
pod and logs as a slow query. Bump the global threshold vs. exempt the bootstrap
query — needs log data to tell which fix is right.

### PVC for log persistence — `parked`
Mount `/var/lib/budget-manager/` (FHS standard), `DATA_DIR` env var defaults
there in prod / `./data` in dev. Pino file transport into `${DATA_DIR}/logs/`
with daily rotation, 30-day retention. Subdirs reserved: `logs/`, `uploads/`,
`exports/`, `ml/`, `users/`. Start 5Gi. Manifest YAML is on Corey. Not urgent —
`kubectl logs` is enough for now.

---

## Mobile & UX

### Mobile / tablet responsiveness triage — `blocked: needs the app open on real devices`
App is used on computer, tablet, and phone; tablet is the awkward middle case.
Reference-on-mobile with occasional edits. Screenshot broken/ugly spots, then
prioritize. A triage session, not a build session — can't be done in the
abstract.

### In-app bug feedback — `parked`
Capture a bug thought without leaving the app. Sole dev + user, so reporter ==
fixer — value is low; it's really a fast scratchpad for "fix this later."

Lightest version if ever built:

- Small textarea (modal or footer) that POSTs to a new `/api/feedback` table
  (timestamp, text, current hash/route), read back from Settings → System.
- Generic build has no server: degrade to appending into a `st.feedback` array
  shown in the same panel, or skip the widget there.

A note-to-self already covers the need. Revisit only if bug thoughts get lost.

---

## Done

Newest first, with commit hashes.

- **Savings target boxes (Budget → Live)** — two tweakable, hideable boxes:
  an emergency reserve (monthly expenses × months, 3/6/9/12 quick-picks +
  custom) and a house fund (home value × maintenance %, 1/1.5/2/3% quick-picks).
  Monthly expenses default to all necessity items, calendar-monthly (× 52/12,
  not the 48-paycheck cadence — a reserve is calendar-real); the user can
  toggle individual items in/out (stored as an exclusion set of stable item
  keys) or override the monthly figure. New `utils/savingsTargets.js` (pure,
  27 tests) + `components/SavingsTargets.jsx`; state persisted per-device via
  `budget-savings-targets`. Combined target shown at the bottom.

  Post-ship fix — every checkbox/field in the panel was frozen (writes silently
  threw): the parent passes the setter as `setSavingsTargets`, but the component
  destructured `setTargets`, so the setter was `undefined`. Component now accepts
  `setSavingsTargets` (with `setTargets` as an alias) and routes all writes
  through it. Item rows also key via `itemKey()` (stable `id` or `n:`-name
  fallback) because `DEF_EXP` defaults carry no id, and the toggle runs inside a
  functional updater. Commit: _pending_.

- **Itemized deductions — working-years tax** (commit 2 of 3) — `calc.js` /
  `useAppState.jsx` applied the standard deduction unconditionally, so a
  household that itemizes had its federal tax overstated and its take-home
  understated every paycheck. New `utils/deductions.js` resolves standard vs.
  itemized with a three-way mode (auto / force standard / force itemized).
  SALT is capped on the statutory OBBBA schedule ($40,400 for 2026, +1%/yr
  through 2029, snapback to $10,000 in 2030) with the 30%-of-MAGI-over-
  threshold phase-out and its hard $10,000 floor; the schedule is statutory,
  NOT inflation-indexed, so it deliberately does not ride the IRS indexing
  knob from commit 1. Mortgage interest sits outside the SALT cap. Medical
  applies the 7.5% AGI floor. New Deductions card on Tax Rates shows both
  sides and which one won, plus a warning when SALT is being clipped.
  Defaults (`deductionMode: "auto"`, all components 0) reproduce prior
  behavior exactly for existing saved states. Also fixed: the single-filer
  branch of the federal calc hardcoded `tax.stdSingle`, which would have
  ignored itemizing for single filers. 32 new tests. Commit: `PENDING`

- **Projected standard deduction for unpublished years** — `projectStdDed` in
  `utils/taxIndexing.js` compounds the latest known standard deduction forward
  when a selected year has no published value. Precedence is explicit and
  enforced inside the helper rather than trusted to call sites: a real value
  (built-in `TAX_DB` or user-imported via `customTaxDB`) ALWAYS wins and is
  never overridden by a projection; only a missing/zero value triggers one.
  Projected years are flagged (`tax.stdProjected`) and marked "estimated" on
  the Tax Rates tab; `addTaxYear` clears the flag since imported data is real.
  Uses a fixed 2.5% rather than reading `forecast.limitGrowthPct`, because
  `forecast` is declared below `loadTaxYear` in the hook and closing over it
  would be a TDZ hazard. 8 new tests. Commit: `PENDING`

- **IRS indexing of tax brackets + standard deduction** (commit 1 of 3 in the
  deduction series) — the FIRE tax estimate held a single `TAX_DB` row flat
  across all projection years while spending inflated, producing artificial
  bracket creep that overstated future tax and inflated the FIRE target. New
  `utils/taxIndexing.js` compounds federal brackets and the standard
  deduction forward, mirroring the existing `limitFor` helper in `calc.js`.
  Extended the existing projection-wide `limitGrowthPct` field rather than
  adding a second knob (relabeled "IRS limit growth" → "IRS indexing");
  federal indexing uses chained CPI vs CPI-U for contribution limits, but
  that gap is a rounding error over a 30-year horizon and no comparable tool
  separates them. Brackets are indexed by boundary, not by tuple, so
  `calcFed`'s contiguity assumption holds by construction. State brackets and
  the SS wage cap deliberately not indexed (different measures). Indexes to
  `horizon`, matching `fireAccountMix` — indexing to the FIRE year would be
  circular. `fireBaseTargetForYear` indexes per projection year (year 5 gets
  5 years of bracket growth, not 30); indexing every year at the horizon
  shifted the whole target curve by a constant factor, which made the
  years-to-FIRE crossover insensitive to indexing entirely. Per-year results
  are cached by integer year since the gross-up runs per chart point per
  render. Measured impact is modest — ~3.4% off the target at a 30-year
  horizon, because LTCG and tax-free income aren't touched by ordinary
  brackets and the SWR divisor compresses the rest. Zero rate reproduces
  prior behavior exactly, pinned by test. 23 new tests. Commit: `PENDING`

- **Generic auto-update check** — SHA as the trigger (every push notifies),
  `git describe` tag as the display label; one-tap "download update with your
  data." Resolved the data-survives-file-swap blocker via `safeStorage.js`
  (in-memory fallback for Chromium `file://` opaque-origin storage denial) +
  `forBuild` cache stamping (localStorage is per-origin, not per-file) + a
  double-wrap load fix; round-trip tests in `genericPersistence.test.js`.
  Also: unsaved-changes dirty dot + configurable stale-save nudge.
  `7eb56b9`, `74af9fa`, `2e1f12d`, `6094dd0`, `697bd3b`, `2096489`, `a2c0683`
- **Persistent 'not a duplicate' dismissal for dup scan** — `_dup_dismissed`
  flag (mirrors `_transfer_dismissed`); dismissed groups skip future scans, stay
  fully counted; Settings un-dismiss escape hatch. `02de346`
- **Dup scan: duplicate React key fix + always-visible filtered count** —
  group key now includes earliest member's tx id, fixing reconciliation
  failures where filtered lists showed the wrong count. `63f69c5`, `e1b58d6`
- **Line-chart date-input blur bug** — editing the date input after clicking a
  chart point no longer clears the selection; the outside-click handler no
  longer treats the date input as "outside." `5747a91`
- **Generic build: marker-based injection** — stable `@generic:*` JSX-comment
  markers replace fragile string-literal anchors; `patchStrict` asserts on miss.
  `78df06c`, `a89935c`
- **Sub-loan obligations: don't silently drop on amortization error** — surface
  the failure instead of dropping the obligation. `415999e`
- **Lump-sum payoff on sub-loan obligations** — multiple lump events can link
  one obligation; partial payoff no longer collapses the FIRE target as a full
  payoff; month-index convention fixed. `4a7bec2`, `19d3aed`, `a16469b`,
  `df1e412`
- **HSA overhaul — strictly per-person** — per-person contribution limits
  (`hsa::p1`/`hsa::p2`), per-account `hsaCoverage`, split-share % UI, first-class
  per-person Income field, killed the auto-fill double-count. `a97b3b1`,
  `a5e2577`, `67fc3d8`, `7924bca`, `12d4797`
- **One-time event amount colored by sign** + WebKit color override fix.
  `0d6841c`, `dcf377c`
- **Debt Remaining from loan obligations + lump-sum paydowns** — includes
  sub-loan obligations; paydown-aware payoff date in the obligation row and FIRE
  target. `105dd4f`, `27f2a2b`, `3536a21`
- **Forecast one-time payoff events linked to ending obligations** —
  deterministic payoff-link toggle, responsive events layout, TDZ-crash fix
  (hoist `oneTimeEvents` above the loan-recompute effect), events-fire-a-year-
  late fix. `ca7eea4`, `d94b559`, `7fb4839`, `0aa2ae6`
- **Loans moved to its own Charts subtab** — `LoansTab.jsx`, `loans` subtab.
  `a30659d`
- **Loans rewrite (new shape)** — dropped source/target/overflow account
  coupling; loans are a pure amortization tracker (`extraMonthlyPrincipal`,
  `amortizationSchedule`, `resolveLoans`, `aggregateDebt`, `payoffMonthIndex`);
  removed the dead `appliedLoans` prop from the forecast math.
- **Milestone Compare subtab** — `budget/compare`, A/B dropdowns with "Current",
  per-line + summary deltas, show-unchanged toggle. `a8b5ed0`
- **Tax-aware FIRE target** — target derives from the live account mix at horizon
  (ordinary / LTCG / tax-free), configurable SWR, annual-withdrawal display;
  steps down as ending obligations end; falls back to 25× when off. `a61fc13`,
  `2ef856a`, `c2e9d85`
- **Multi-item ending obligations** — one obligation links multiple budget
  items; one-ending-per-item invariant; loan-mode uses summed monthly across
  linked items for `endsOn`. `6c1225e`
- **Bulk As-of toggle on Ending Obligations** + as-of master moved to the top
  scenario toolbar. `e1ec2b5`, `93e9842`, `fc2018c`
- **Mobile fixes** — horizontal overflow on Advanced, clipped one-time-event
  labels on the forecast chart. `56c23e9`, `faaf4bd`

Older history (transactions foundation, intelligence, diagnostics, server-side
logging, forecast actuals, per-account forecast, perf passes, duplicate scan,
Settings restructure) predates this file — see git history.

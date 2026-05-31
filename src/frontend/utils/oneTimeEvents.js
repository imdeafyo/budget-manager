/* One-time Events — Advanced Forecast.
   ---------------------------------------------------------------
   Models discrete dated cash events that hit a single account
   balance at a specific month: car purchase out of cash,
   inheritance into taxable, rollover into 401(k), etc.

   Distinct from Ending Obligations (utils/endingItems.js), which
   model RECURRING redirects of freed budget cash flow starting at
   a date. One-time Events are LUMP SUMS at a date.

   Math layer (forecastGrowthAccounts in calc.js) consumes a
   resolved list of { accountId, monthIndex, amount } via the
   `appliedOneTimeEvents` opt. `amount` is signed: negative drains
   the account, positive adds. No pool-cap logic — events are
   explicit assertions (rollovers, planned purchases, windfalls)
   and bypass IRS contribution limits intentionally.

   Sign convention: positive = inflow, negative = outflow.
   ---------------------------------------------------------------

   Shape (persisted):

     {
       id: "ote_<random>",
       date: "YYYY-MM-DD",        // user-entered absolute date
       amount: number,             // signed; negative = outflow
       accountId: "<account id>",  // destination/source account
       label: string,              // user-facing description
       linkedEndingId?: string,    // optional: early-payoff link to an
                                   //   ending obligation. When set, this
                                   //   event's date overrides that
                                   //   obligation's end date (the freed
                                   //   monthly payment starts the month
                                   //   after this event). The OVERRIDE is
                                   //   applied by applyPayoffLinks in
                                   //   endingItems.js BEFORE resolution;
                                   //   this resolver ignores the field —
                                   //   the event still just drains
                                   //   `amount` from `accountId` on `date`.
     }

   Resolved (passed to forecast math):

     { accountId, monthIndex, amount }

   `monthIndex` is the 1-indexed absolute month offset from baseYear
   (e.g. an event in January of baseYear+1 = monthIndex 13, an event
   in baseYear itself = monthIndex 0 and is skipped because the
   projection's year 0 is the starting balance snapshot, not a
   simulated month).

   Events outside the horizon are dropped (returned in
   `outOfHorizon` for UI surfacing). Events with missing or invalid
   account references are returned in `orphans`. */

const NEW_ID_PREFIX = "ote_";

/* Generate a new event id. Random-suffixed so two events added in
   the same tick don't collide. Mirrors newEndingItemId. */
export function newOneTimeEventId() {
  return NEW_ID_PREFIX + Math.random().toString(36).slice(2, 10);
}

/* Parse "YYYY-MM-DD" to { year, month, day } with month 1-indexed.
   Returns null on invalid input. Tolerant of "YYYY-MM" (treats day
   as 1) since some date inputs return that on certain browsers. */
export function parseEventDate(dateStr) {
  if (typeof dateStr !== "string") return null;
  const m = dateStr.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] ? Number(m[3]) : 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

/* Compute the absolute simulated month index for a calendar date.

   This MUST match the convention the forecast loop uses in
   forecastGrowthAccounts (calc.js):

       absMonth = (y - 1) * 12 + m + 1   // y = loop year, m = 0..11
       calendarYear = baseYear + y

   So loop year 0 is the ENTIRE base calendar year (the starting-
   balance snapshot — no month simulation), and simulated month 1 is
   *January of baseYear + 1*. An event in calendar (Y, M) therefore
   maps to:

       absMonth = (Y - baseYear - 1) * 12 + M

   Anything in baseYear itself (or earlier) maps to <= 0 and the
   resolver routes it to `inPast` (the year-0 snapshot already
   reflects "today", so a base-year event has effectively already
   happened relative to the projection start).

   `baseMonth` is accepted for signature compatibility but does NOT
   shift the year boundary: the loop simulates full Jan–Dec calendar
   years from baseYear+1, with no sub-year alignment to the current
   month. (The previous implementation measured months from baseYear
   instead of baseYear+1, which fired every event a full year late —
   a $500k payoff dated 2035-02 landed in 2036.)

   Examples (baseYear=2026):
     2026-01-XX → monthIndex -11  (base year → drop / inPast)
     2026-06-XX → monthIndex  -6  (base year → drop / inPast)
     2027-01-XX → monthIndex   1  (first simulated month)
     2027-12-XX → monthIndex  12  (end of simulated year 1)
     2035-02-XX → monthIndex  98  (fires in calendar 2035, year 9)
     2028-06-XX → monthIndex  18

   Returns null if the date string is unparseable. */
export function eventMonthIndex(dateStr, baseYear, baseMonth = 1) {
  const parsed = parseEventDate(dateStr);
  if (!parsed) return null;
  // Year boundary is baseYear+1 (loop year 1). baseMonth intentionally
  // does not enter the year offset — see the doc comment above.
  return (parsed.year - baseYear - 1) * 12 + parsed.month;
}

/* Resolve a raw event list against accounts + horizon. Returns:

     {
       events:       [{ accountId, monthIndex, amount, id, label, date }],
       orphans:      [{ id, label, date, amount, reason }],
       outOfHorizon: [{ id, label, date, amount, monthIndex }],
       inPast:       [{ id, label, date, amount, monthIndex }],
     }

   `events` is what the math layer should consume — only well-formed,
   in-horizon, in-future entries. The others are surfaced for UI
   warnings but not applied to the projection.

   `accounts` is the array of forecast accounts (only their ids are
   used). `baseYearMonth` is { year, month } — defaults to current
   calendar year+month if omitted. `horizonMonths` is total months
   simulated (years × 12).

   We DON'T sort here — the math layer already groups by accountId
   and walks events in monthIndex order via its own cursor. Sorting
   is the math layer's responsibility (forecastGrowthAccounts does
   it for endingEvents the same way). */
export function resolveOneTimeEvents(rawEvents, accounts, baseYearMonth, horizonMonths) {
  const out = { events: [], orphans: [], outOfHorizon: [], inPast: [] };
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) return out;
  const baseYear = baseYearMonth?.year ?? new Date().getFullYear();
  const baseMonth = baseYearMonth?.month ?? (new Date().getMonth() + 1);
  const validIds = new Set((accounts || []).map(a => a.id));
  const horizon = Math.max(0, Number(horizonMonths) || 0);

  for (const ev of rawEvents) {
    if (!ev || typeof ev !== "object") continue;
    const id = ev.id;
    const label = ev.label || "";
    const date = ev.date || "";
    const amount = Number(ev.amount) || 0;
    const accountId = ev.accountId;

    // No account reference, or refs an account that no longer exists
    if (!accountId || !validIds.has(accountId)) {
      out.orphans.push({ id, label, date, amount, reason: !accountId ? "no-account" : "account-missing" });
      continue;
    }

    const monthIndex = eventMonthIndex(date, baseYear, baseMonth);
    if (monthIndex === null) {
      // Unparseable date — treat as orphan with a different reason
      out.orphans.push({ id, label, date, amount, reason: "bad-date" });
      continue;
    }
    if (monthIndex <= 0) {
      out.inPast.push({ id, label, date, amount, monthIndex });
      continue;
    }
    if (monthIndex > horizon) {
      out.outOfHorizon.push({ id, label, date, amount, monthIndex });
      continue;
    }
    out.events.push({ accountId, monthIndex, amount, id, label, date });
  }
  return out;
}

/* Convert a monthIndex to a fractional forecast year for chart x-axis
   positioning. monthIndex 12 = end of year 1, so fractionalYear = 1.
   monthIndex 6 = mid-year 1, fractionalYear = 0.5.
   The forecast's chart x-axis is the integer `year` field (0…horizon),
   so a ReferenceLine at fractionalYear renders between year-boundary
   data points — Recharts handles this fine for category-axis charts
   in numeric mode. We expose it as a util so the chart code doesn't
   recompute monthIndex/12. */
export function monthIndexToFractionalYear(monthIndex) {
  const m = Number(monthIndex);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return m / 12;
}

/* Snap a monthIndex to the integer forecast year in which it fires.
   The chart's XAxis uses `year` (integer 0..horizon) as a CATEGORY axis,
   and Recharts v3 ReferenceLine x values on category axes only render
   reliably when they match an existing category. Fractional x values
   silently drop or pin to the wrong tick — that was the "doesn't always
   show on graph" bug.

   monthIndex 1..12  → year 1 (fires during year 1)
   monthIndex 13..24 → year 2
   monthIndex 0 or invalid → 0 (the starting-balance year)

   Less sub-year precision than monthIndexToFractionalYear, but the
   marker actually renders. */
export function monthIndexToChartYear(monthIndex) {
  const m = Number(monthIndex);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.ceil(m / 12);
}

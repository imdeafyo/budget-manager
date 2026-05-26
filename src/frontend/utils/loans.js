/* Loans — Advanced Forecast Phase 14.
   ---------------------------------------------------------------
   First-class debt modeling on the per-account forecast. Each loan
   debits a sourceAccount monthly by its amortized payment until
   payoff. Optionally credits a targetAccount with the principal at
   origination (e.g. HELOC funding a renovation account, mortgage
   funding a separate "home equity" placeholder, auto loan funding
   the car-as-asset).

   Distinct from utils/endingItems.js — that module models the
   FREEING of budgeted cash flow when a recurring expense stops.
   Loans here are an alternative paradigm: they represent the
   borrowing-and-repayment side of the same coin. A user who wants
   to model a real mortgage in detail uses a Loan (this module);
   a user who just wants "the day this expense disappears, divert
   the cash to investments" uses an EndingItem.

   Math layer (forecastGrowthAccounts in calc.js) consumes a
   resolved loan list via the `appliedLoans` opt. Each resolved
   loan carries enough to drive the monthly loop without touching
   the underlying account math:

     {
       id, label,
       sourceAccountId,            // debited each month
       targetAccountId?,           // credited at origination only
       overflowAccountId?,         // where the FREED monthly cash goes
                                   // after payoff (default: source account
                                   // — money simply stays in source).
                                   // Distinct from "principal credited at
                                   // origination" — overflow is the
                                   // post-payoff redirect.
       originationMonthIndex,      // 1-indexed absolute month from baseYear
       payoffMonthIndex,           // last payment month (inclusive)
       monthlyPaymentAmount,       // standard amortization $ per month
       principal,                  // original loan amount (for target credit)
     }

   Sign convention follows the rest of the forecast math:
     - Payment debits source: amount is subtracted from balance.
     - Principal credits target: amount is added to balance at origination.

   Loans NEVER subject to pool caps — they're debt servicing, not
   contributions. A loan that pays into a 401(k)-typed targetAccount
   would be a strange model anyway (and the UI should warn). The math
   layer applies the principal credit unconditionally.

   ---------------------------------------------------------------

   Shape (persisted):

     {
       id: "loan_<random>",
       label: string,
       principal: number,          // original loan amount (positive)
       originationDate: "YYYY-MM", // when borrowing begins
       interestRate: number,        // annual % (e.g. 6.5 for 6.5%)
       termMonths: integer,         // amortization term
       sourceAccountId: string,     // account debited monthly
       targetAccountId?: string,    // optional — credited at origination
       overflowAccountId?: string,  // optional — receives freed cash on payoff
     }

   The amortized monthly payment is DERIVED, not stored. It's
   computed from principal/rate/term using the standard formula
   (or straight-line for 0% rate loans). Storing it would create
   a stale-value risk if the user edits the underlying inputs.
*/

const NEW_ID_PREFIX = "loan_";
const MAX_LOAN_MONTHS = 50 * 12; // 50 years — beyond, treat as non-amortizing

/* Generate a new loan id. Random-suffixed so two added in the same
   tick don't collide. */
export function newLoanId() {
  return NEW_ID_PREFIX + Math.random().toString(36).slice(2, 10);
}

/* Standard fixed-rate amortized monthly payment.
   ---------------------------------------------------------------
   Formula: M = P · r / (1 - (1 + r)^-n)
   where P = principal, r = monthly rate, n = term in months.

   Zero-interest shortcut: M = P / n (straight-line paydown).

   Returns:
     { ok: true, payment: number }       — well-formed
     { ok: false, reason: "..." }        — invalid input

   Reasons (stable strings — UI may render messaging from them):
     "zero-principal"       principal <= 0
     "zero-term"            termMonths <= 0
     "negative-rate"        annualRatePct < 0
     "horizon-exceeded"     termMonths > MAX_LOAN_MONTHS

   Notes:
     - Annual rate is in PERCENT (so 6.5 means 6.5%, not 0.065).
     - Result is NOT rounded — caller is responsible for any
       presentation rounding. The forecast math uses the raw value
       so the total principal paid over the term sums to the exact
       original principal (modulo float epsilon). */
export function monthlyPayment(principal, annualRatePct, termMonths) {
  const P = Number(principal);
  const n = Number(termMonths);
  const rPct = Number(annualRatePct);

  if (!isFinite(P) || P <= 0) return { ok: false, reason: "zero-principal" };
  if (!isFinite(n) || n <= 0) return { ok: false, reason: "zero-term" };
  if (!isFinite(rPct) || rPct < 0) return { ok: false, reason: "negative-rate" };
  if (n > MAX_LOAN_MONTHS) return { ok: false, reason: "horizon-exceeded" };

  const nWhole = Math.ceil(n);

  // Zero-interest shortcut.
  if (rPct === 0) {
    return { ok: true, payment: P / nWhole };
  }

  const r = (rPct / 100) / 12; // monthly rate as decimal
  const payment = P * r / (1 - Math.pow(1 + r, -nWhole));
  if (!isFinite(payment) || payment <= 0) {
    return { ok: false, reason: "compute-failed" };
  }
  return { ok: true, payment };
}

/* Full amortization schedule — month-by-month breakdown.
   ---------------------------------------------------------------
   Returns array of { monthIndex, payment, principal, interest,
                      remainingBalance } for each month from 1 to
   termMonths (inclusive). monthIndex is RELATIVE to the loan's
   origination, NOT the forecast's baseYear — caller adds the
   origination offset to align with the forecast timeline.

   The final month's payment is reduced to exactly the remaining
   balance (avoiding float drift that leaves a fractional cent
   outstanding). This is the standard "shortened-last-payment"
   convention and keeps sum(principal portions) === original P.

   Returns [] on invalid input — checks `monthlyPayment` ok flag. */
export function amortizationSchedule(loan) {
  const P = Number(loan?.principal);
  const rPct = Number(loan?.interestRate);
  const n = Number(loan?.termMonths);
  const mp = monthlyPayment(P, rPct, n);
  if (!mp.ok) return [];

  const nWhole = Math.ceil(n);
  const r = rPct > 0 ? (rPct / 100) / 12 : 0;
  const payment = mp.payment;
  const schedule = [];
  let balance = P;

  for (let m = 1; m <= nWhole; m++) {
    const interestPortion = balance * r;
    let principalPortion = payment - interestPortion;
    let actualPayment = payment;

    // Last-payment adjustment: if the planned principal portion would
    // overshoot the remaining balance (always happens by a fractional
    // cent on the final month, sometimes by more if float drift
    // accumulates), cap it at the remaining balance.
    if (principalPortion > balance) {
      principalPortion = balance;
      actualPayment = interestPortion + principalPortion;
    }

    balance -= principalPortion;
    // Clamp tiny negative residuals from float arithmetic.
    if (balance < 0 && balance > -1e-6) balance = 0;

    schedule.push({
      monthIndex: m,
      payment: actualPayment,
      principal: principalPortion,
      interest: interestPortion,
      remainingBalance: balance,
    });

    if (balance <= 0) break;
  }
  return schedule;
}

/* Parse "YYYY-MM" or "YYYY-MM-DD" to { year, month }. Mirrors
   oneTimeEvents.parseEventDate but only needs year+month for loans
   (origination is month-precision). */
export function parseLoanDate(dateStr) {
  if (typeof dateStr !== "string") return null;
  const m = dateStr.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/* Compute the absolute monthIndex (1-indexed) for a date string
   given a base year+month, matching the convention used elsewhere
   in the forecast math.

   monthIndex 0 = baseYear+baseMonth (year-0 row, starting snapshot)
   monthIndex 1 = first simulated month
   monthIndex 12 = end of year 1
   etc.

   A loan originating in baseYear+baseMonth itself = monthIndex 0
   and should be treated as "already in progress" — for v1 we drop
   these into `inPast` rather than try to model mid-payment loans.
   That's a real follow-up but adds complexity (which payment number
   are we at? what's the remaining balance?) that the simple "start
   from origination" model doesn't carry. */
export function loanMonthIndex(dateStr, baseYear, baseMonth = 1) {
  const parsed = parseLoanDate(dateStr);
  if (!parsed) return null;
  const yearsForward = parsed.year - baseYear;
  const monthsForward = yearsForward * 12 + (parsed.month - baseMonth);
  return monthsForward;
}

/* Resolve a raw loan list against accounts + horizon. Returns:

     {
       loans: [<resolved-loan>],
       orphans: [{ id, label, reason }],
       outOfHorizon: [{ id, label, originationMonthIndex }],
       inPast: [{ id, label, originationMonthIndex }],
     }

   `loans` is what the math layer consumes — only well-formed,
   in-horizon, in-future entries. Each resolved loan carries:

     {
       id, label, principal,
       sourceAccountId, targetAccountId, overflowAccountId,
       originationMonthIndex,   // 1-indexed; 0 = year-0 (dropped)
       monthlyPaymentAmount,    // derived from amortization
       termMonths,              // honored as-given
       payoffMonthIndex,        // = originationMonthIndex + termMonths - 1
                                //   (the month the final payment lands)
     }

   `payoffMonthIndex` may exceed `horizonMonths` — that's fine. A
   loan that doesn't pay off within the projection horizon still
   gets every month of debits inside the horizon applied; the
   math layer doesn't try to "finish" the loan, it just stops at
   the horizon. The unpaid remainder is implicit in the source
   account's ending balance.

   `outOfHorizon` here means the ORIGINATION is past the horizon
   — the loan never starts within the projection, so it's
   effectively inert. We surface it for UI clarity rather than
   silently dropping.

   Orphans cover all "loan exists but can't be applied" cases:
     - no sourceAccountId, or sourceAccountId points to a missing
       account
     - targetAccountId / overflowAccountId points to a missing
       account (we don't drop the loan for this — we null out the
       bad reference and proceed, but record it for UI surfacing)
     - originationDate is unparseable
     - amortization math fails (zero principal, zero term, etc.)

   For partial-reference orphaning (target or overflow missing but
   source ok), we DO include the loan in `loans` with the bad
   reference nulled out, AND push an entry into `orphans` so the
   UI can warn. This mirrors how the rest of the forecast handles
   "fix what we can, warn about what we can't." */
export function resolveLoans(rawLoans, accounts, baseYearMonth, horizonMonths) {
  const out = { loans: [], orphans: [], outOfHorizon: [], inPast: [] };
  if (!Array.isArray(rawLoans) || rawLoans.length === 0) return out;
  const baseYear = baseYearMonth?.year ?? new Date().getFullYear();
  const baseMonth = baseYearMonth?.month ?? (new Date().getMonth() + 1);
  const validIds = new Set((accounts || []).map(a => a.id));
  const horizon = Math.max(0, Number(horizonMonths) || 0);

  for (const ln of rawLoans) {
    if (!ln || typeof ln !== "object") continue;
    const id = ln.id;
    const label = ln.label || "";
    const principal = Number(ln.principal) || 0;
    const sourceAccountId = ln.sourceAccountId;

    // Source account is mandatory.
    if (!sourceAccountId || !validIds.has(sourceAccountId)) {
      out.orphans.push({
        id, label,
        reason: !sourceAccountId ? "no-source-account" : "source-account-missing",
      });
      continue;
    }

    // Origination date must parse.
    const originationMonthIndex = loanMonthIndex(ln.originationDate, baseYear, baseMonth);
    if (originationMonthIndex === null) {
      out.orphans.push({ id, label, reason: "bad-origination-date" });
      continue;
    }

    // Amortization must be valid.
    const mp = monthlyPayment(principal, ln.interestRate, ln.termMonths);
    if (!mp.ok) {
      out.orphans.push({ id, label, reason: `amort-${mp.reason}` });
      continue;
    }

    // In-past / out-of-horizon checks operate on the origination month.
    if (originationMonthIndex <= 0) {
      out.inPast.push({ id, label, originationMonthIndex });
      continue;
    }
    if (originationMonthIndex > horizon) {
      out.outOfHorizon.push({ id, label, originationMonthIndex });
      continue;
    }

    // Partial-ref handling: target/overflow can be null'd out without
    // dropping the loan.
    let targetAccountId = ln.targetAccountId || null;
    if (targetAccountId && !validIds.has(targetAccountId)) {
      out.orphans.push({ id, label, reason: "target-account-missing" });
      targetAccountId = null;
    }
    let overflowAccountId = ln.overflowAccountId || null;
    if (overflowAccountId && !validIds.has(overflowAccountId)) {
      out.orphans.push({ id, label, reason: "overflow-account-missing" });
      overflowAccountId = null;
    }

    const termMonths = Math.ceil(Number(ln.termMonths));
    const payoffMonthIndex = originationMonthIndex + termMonths - 1;

    out.loans.push({
      id,
      label,
      principal,
      sourceAccountId,
      targetAccountId,
      overflowAccountId,
      originationMonthIndex,
      monthlyPaymentAmount: mp.payment,
      termMonths,
      payoffMonthIndex,
    });
  }
  return out;
}

/* Helper: group resolved loans into per-month debit/credit events
   so the inner monthly loop in forecastGrowthAccounts can walk a
   single cursor per loan without re-checking origination/payoff
   bounds every month.

   Returns:
     {
       debitsByAccount: { [acctId]: [{ monthIndex, amount, loanId, isFinalPayment }] },
       creditsByAccount: { [acctId]: [{ monthIndex, amount, loanId, kind }] },
                          // kind = "origination" | "overflow"
     }

   Debits are the monthly payment events (always against
   sourceAccountId). The final payment is flagged so the math
   layer can apply the shortened-last-payment adjustment and
   trigger the overflow event in the SAME month.

   Credits cover two distinct cases:
     - origination: principal lands in targetAccountId in the
       loan's origination month (single event per loan, only
       emitted if targetAccountId is set)
     - overflow: the freed payment in the months AFTER payoff
       (recurring, only emitted if overflowAccountId is set AND
       distinct from sourceAccountId — otherwise the money just
       "stays" in source by virtue of not being debited).
       Emitted as a SINGLE event at payoffMonthIndex+1 with a
       running-flag so the math layer can keep adding it every
       month for the rest of the projection. This matches the
       endingEvents pattern (a one-time delta-flip that the math
       layer accumulates).

   Note: arrays are NOT sorted here — math layer sorts per-account
   per-direction as needed (matches the eventsForAcct pattern). */
export function loanEvents(resolvedLoans, horizonMonths) {
  const debitsByAccount = {};
  const creditsByAccount = {};
  const horizon = Math.max(0, Number(horizonMonths) || 0);

  for (const ln of resolvedLoans || []) {
    if (!ln) continue;
    const { id, monthlyPaymentAmount: pay, originationMonthIndex: origin, payoffMonthIndex: payoff } = ln;
    if (!isFinite(pay) || pay <= 0) continue;

    // 1. Origination credit to target (if set).
    if (ln.targetAccountId && origin >= 1 && origin <= horizon) {
      if (!creditsByAccount[ln.targetAccountId]) creditsByAccount[ln.targetAccountId] = [];
      creditsByAccount[ln.targetAccountId].push({
        monthIndex: origin,
        amount: ln.principal,
        loanId: id,
        kind: "origination",
      });
    }

    // 2. Monthly debits from source for each month in [origin, payoff].
    const lastDebitMonth = Math.min(payoff, horizon);
    if (origin <= horizon && lastDebitMonth >= origin) {
      if (!debitsByAccount[ln.sourceAccountId]) debitsByAccount[ln.sourceAccountId] = [];
      // Pre-resolved amortization schedule, in case caller wants
      // exact per-month principal/interest splits. Final payment in
      // the schedule gets isFinalPayment=true.
      const sched = amortizationSchedule({
        principal: ln.principal,
        interestRate: undefined, // signaled via monthlyPaymentAmount; we rebuild rate below
        termMonths: ln.termMonths,
      });
      // Rebuild via the loan's actual derived payment — we don't have
      // the rate here, but the math layer doesn't need per-month
      // interest/principal split for balance evolution. The simple
      // per-month constant payment with a shortened final payment is
      // enough.
      for (let m = origin; m <= lastDebitMonth; m++) {
        const isFinal = m === payoff;
        debitsByAccount[ln.sourceAccountId].push({
          monthIndex: m,
          amount: pay,
          loanId: id,
          isFinalPayment: isFinal,
        });
      }
    }

    // 3. Overflow credit AFTER payoff (only if overflow account is
    //    set AND distinct from source — otherwise money just stays
    //    in source by not being debited, no event needed).
    if (
      ln.overflowAccountId &&
      ln.overflowAccountId !== ln.sourceAccountId &&
      payoff < horizon
    ) {
      // Emit a SINGLE delta-flip at payoff+1; math layer accumulates.
      // amount = full monthly payment now redirected.
      if (!creditsByAccount[ln.overflowAccountId]) creditsByAccount[ln.overflowAccountId] = [];
      creditsByAccount[ln.overflowAccountId].push({
        monthIndex: payoff + 1,
        amount: pay,
        loanId: id,
        kind: "overflow",
      });
    }
  }
  return { debitsByAccount, creditsByAccount };
}

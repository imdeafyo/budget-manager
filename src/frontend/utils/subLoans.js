/* subLoans.js — graduated, multi-rate sub-loan amortization.
   ===================================================================
   A single loan-mode Ending Obligation may hold several sub-loans that
   share one servicer and therefore ONE repayment-schedule calendar, but
   each sub-loan has its own balance and interest rate, so each amortizes
   on its own timeline.

   Real-world model (federal student loans / Great Lakes / MOHELA):
     - Required payment is split across sub-loans (the user enters each
       sub-loan's share per schedule segment).
     - Graduated repayment steps the payment up on shared dates. Within a
       segment the payment is constant; at each step boundary it changes.
     - Extra principal is DIRECTED by the user to a specific sub-loan
       (servicer default is highest-rate-first, but we never guess — the
       user names the target). Extra is applied to principal after the
       segment's required payment.
     - When a sub-loan pays off, its freed payment is NOT auto-reallocated
       (the servicer won't do it for you). We surface an indicator instead.

   This module is closed-form-free on purpose: a changing payment stream
   has no clean n = -ln(...)/ln(...) solution, so we simulate month by
   month. The standard (non-graduated) case falls out as a one-segment
   schedule, so there is a single code path.

   Conventions (match endingItems.js):
     - Rates are in PERCENT (3.8 means 3.8%, not 0.038).
     - "YYYY-MM" strings for dates; addMonths/yearMonthToIndex live in
       endingItems.js and are imported here to avoid divergence.
     - Monthly rate = (ratePct / 100) / 12. Interest accrues on the
       balance at the START of the month, before the payment is applied.

   Data shapes
   -----------
   Graduation (obligation-level):
     { enabled: boolean,
       steps: ["YYYY-MM", ...] }   // ascending step-boundary dates;
                                   //   segment i runs [steps[i-1], steps[i])

   SubLoan:
     { id, label,
       balance: number,            // current principal
       annualRate: number,         // percent
       payments: number[],         // required payment per segment;
                                   //   length should be steps.length + 1.
                                   //   Shorter arrays reuse the last value;
                                   //   a single value = flat (standard) loan.
       extraMonthly: number }      // directed extra principal, default 0
*/

import { addMonths } from "./endingItems.js";

export const MAX_SUBLOAN_MONTHS = 50 * 12; // hard simulation ceiling
const EPS = 0.005; // half a cent — below this a balance is "paid off"

/* Resolve which schedule segment a given month index falls into.
   Segment boundaries are the step dates expressed as month offsets from
   `baseYearMonth`. Month indices strictly before the first step are
   segment 0; at/after step[k] but before step[k+1] are segment k+1.

   `stepOffsets` must be an ascending array of integer month offsets.
   Returns the segment index (0-based). */
export function segmentForMonth(monthIndex, stepOffsets) {
  if (!Array.isArray(stepOffsets) || stepOffsets.length === 0) return 0;
  let seg = 0;
  for (let k = 0; k < stepOffsets.length; k++) {
    if (monthIndex >= stepOffsets[k]) seg = k + 1;
    else break;
  }
  return seg;
}

/* Pick the required payment for a segment, reusing the last entry when
   the payments array is shorter than the segment index (so a flat loan
   with payments:[X] returns X for every segment). */
export function paymentForSegment(payments, segIndex) {
  if (!Array.isArray(payments) || payments.length === 0) return 0;
  const idx = Math.min(segIndex, payments.length - 1);
  const v = Number(payments[idx]);
  return isFinite(v) && v > 0 ? v : 0;
}

/* Normalize a graduation.steps array (date strings) into ascending,
   de-duplicated month offsets relative to baseYearMonth. Drops malformed
   or non-positive offsets (a step at or before month 0 is meaningless —
   it just means segment 0 never applies, which we treat as "start in the
   later segment" by keeping offset 0). */
export function stepDatesToOffsets(steps, baseYearMonth) {
  if (!Array.isArray(steps)) return [];
  const out = [];
  for (const s of steps) {
    // months from base to this step
    const [y, m] = String(s).split("-").map(Number);
    const [by, bm] = String(baseYearMonth).split("-").map(Number);
    if (![y, m, by, bm].every(isFinite)) continue;
    const off = (y - by) * 12 + (m - bm);
    if (off > 0) out.push(off);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/* Simulate one sub-loan month by month.
   ---------------------------------------------------------------
   Args:
     subLoan      — { balance, annualRate, payments, extraMonthly }
     stepOffsets  — ascending month-offset boundaries (from base)
     opts.maxMonths (default MAX_SUBLOAN_MONTHS)

   Returns:
     { ok: true,
       months,                  // whole months to reach zero balance
       schedule: [ { monthIndex, payment, interest, principal,
                     extra, remaining } ... ],
       totalInterest,
       paidOffOffset }          // == months (month index AFTER last payment)

     { ok: false, reason }
       "zero-balance"           balance <= 0 (nothing to amortize)
       "no-payment"             every segment payment is 0
       "negative-amortization"  payment never covers interest in the
                                segment the loan is stuck in
       "horizon-exceeded"       still owing after maxMonths

   Note: a sub-loan can be neg-am in an EARLY low segment but amortize
   once a later (graduated) step raises the payment. We only declare
   negative-amortization if we hit the final segment and STILL can't cover
   interest — before then, a balance that grows is allowed (it's what
   graduated plans actually do early on).

   Optional roll-forward (opts.balanceAsOf + opts.baseYearMonth):
     When provided and asOf predates base, the stated balance is rolled
     forward to base by applying interest + segment-0 payment + extra
     month-by-month. This keeps the projection honest when the user typed
     a balance N months ago and hasn't updated it. The simulation then
     amortizes from the rolled balance starting at month index 0 (which
     IS base — the roll-forward consumed the lag). If the loan paid off
     during the roll, returns { ok: false, reason: "paid-off-pre-base" }.
     The result includes rolledFrom = { startBalance, monthsRolled } when
     a roll happened (monthsRolled > 0), null otherwise. */
export function simulateSubLoan(subLoan, stepOffsets, opts = {}) {
  const maxMonths = opts.maxMonths ?? MAX_SUBLOAN_MONTHS;
  let bal = Number(subLoan.balance);
  const startBalance = bal;
  const rPct = Number(subLoan.annualRate);
  const payments = subLoan.payments;
  const extra = Math.max(0, Number(subLoan.extraMonthly) || 0);

  if (!isFinite(bal) || bal <= 0) return { ok: false, reason: "zero-balance" };
  if (!isFinite(rPct) || rPct < 0) return { ok: false, reason: "negative-rate" };

  const r = (rPct / 100) / 12;
  const lastSeg = Array.isArray(stepOffsets) ? stepOffsets.length : 0;
  const schedule = [];
  let totalInterest = 0;
  let rolledFrom = null;

  // Quick check: is there any positive payment anywhere?
  const anyPayment =
    (Array.isArray(payments) ? payments : []).some((p) => Number(p) > 0) ||
    extra > 0;
  if (!anyPayment) return { ok: false, reason: "no-payment" };

  /* Roll-forward the stated balance from `balanceAsOf` to `baseYearMonth`.
     Uses segment-0 payment (the segment that was active before base) plus
     directed extra. We don't fail on neg-am during the roll — the user's
     actual lender accepted the payments and the balance is what it is. */
  if (opts.balanceAsOf && opts.baseYearMonth) {
    const lag = (() => {
      const [yA, mA] = String(opts.balanceAsOf).split("-").map(Number);
      const [yB, mB] = String(opts.baseYearMonth).split("-").map(Number);
      if (![yA, mA, yB, mB].every((n) => isFinite(n))) return 0;
      return (yB - yA) * 12 + (mB - mA);
    })();
    if (lag > 0) {
      const seg0Pay = paymentForSegment(payments, 0) + extra;
      let rollMonths = 0;
      for (let i = 0; i < lag; i++) {
        const interest = bal * r;
        const next = bal + interest - seg0Pay;
        rollMonths++;
        if (next <= 0) {
          bal = 0;
          break;
        }
        bal = next;
      }
      if (bal <= 0) {
        return { ok: false, reason: "paid-off-pre-base", rolledFrom: { startBalance, monthsRolled: rollMonths } };
      }
      rolledFrom = { startBalance, monthsRolled: rollMonths };
    }
  }


  for (let i = 0; i < maxMonths; i++) {
    const seg = segmentForMonth(i, stepOffsets);
    const reqPay = paymentForSegment(payments, seg);
    const interest = bal * r;
    totalInterest += interest;

    // Available toward principal this month from required + directed extra.
    const grossPay = reqPay + extra;
    let principal = grossPay - interest;

    if (principal <= 0) {
      // Payment doesn't cover interest this month -> balance grows.
      // Only a HARD failure if we're in the final segment (no future
      // step will ever raise the payment). Otherwise allow it.
      if (seg >= lastSeg) {
        return { ok: false, reason: "negative-amortization" };
      }
      bal = bal + (interest - grossPay);
      schedule.push({
        monthIndex: i,
        payment: grossPay,
        interest,
        principal: -(interest - grossPay), // negative principal (growing)
        extra,
        remaining: bal,
      });
      continue;
    }

    // Final payment may overshoot; clamp.
    if (principal >= bal) {
      principal = bal;
      bal = 0;
      schedule.push({
        monthIndex: i,
        payment: interest + principal,
        interest,
        principal,
        extra: Math.min(extra, Math.max(0, principal - (reqPay - interest))),
        remaining: 0,
      });
      return {
        ok: true,
        months: i + 1,
        paidOffOffset: i + 1,
        schedule,
        totalInterest,
        rolledFrom,
      };
    }

    bal -= principal;
    schedule.push({
      monthIndex: i,
      payment: grossPay,
      interest,
      principal,
      extra,
      remaining: bal,
    });
    if (bal <= EPS) {
      bal = 0;
      return {
        ok: true,
        months: i + 1,
        paidOffOffset: i + 1,
        schedule,
        totalInterest,
        rolledFrom,
      };
    }
  }

  return { ok: false, reason: "horizon-exceeded" };
}

/* Resolve a full sub-loan group (one loan-mode obligation with N
   sub-loans sharing a graduation calendar).
   ---------------------------------------------------------------
   Args:
     subLoans        — SubLoan[]
     graduation      — { enabled, steps } | null/undefined (flat)
     baseYearMonth   — projection start "YYYY-MM"
     opts.maxMonths

   Returns:
     { results: [ { id, label, ok, months?, endsOn?, totalInterest?,
                    schedule?, reason?, freedPayment? } ... ],
       groupEndsOn,            // latest payoff "YYYY-MM" across sub-loans
       groupMonths,            // max months (the obligation "ends" when
                               //   the LAST sub-loan is gone)
       freedEvents,            // [{ id, label, atMonth, atYearMonth,
                               //    freedPayment }] sorted by atMonth —
                               //   payoff indicators for the UI
       anyError }              // true if any sub-loan failed to amortize

   `freedPayment` is the required payment that sub-loan was carrying in
   the segment it paid off in, PLUS its directed extra — i.e. the cash
   that is now unallocated. We do NOT reassign it; freedEvents drives the
   "bump another payment or redirect" indicator. */
export function resolveSubLoanGroup(subLoans, graduation, baseYearMonth, opts = {}) {
  const list = Array.isArray(subLoans) ? subLoans : [];
  const stepOffsets =
    graduation && graduation.enabled
      ? stepDatesToOffsets(graduation.steps, baseYearMonth)
      : [];

  const results = [];
  const freedEvents = [];
  let groupMonths = 0;
  let anyError = false;

  for (const sl of list) {
    /* Each sub-loan can carry its own `balanceAsOf`. We pass it via opts
       along with baseYearMonth so simulateSubLoan can roll the stated
       balance forward to today before amortizing. */
    const simOpts = {
      ...opts,
      baseYearMonth,
      balanceAsOf: sl.balanceAsOf,
    };
    const sim = simulateSubLoan(sl, stepOffsets, simOpts);
    if (!sim.ok) {
      anyError = true;
      results.push({
        id: sl.id,
        label: sl.label,
        ok: false,
        reason: sim.reason,
        rolledFrom: sim.rolledFrom || null,
      });
      continue;
    }
    const endsOn = addMonths(baseYearMonth, sim.months);
    // Freed payment = the required share in the payoff segment + extra.
    const payoffSeg = segmentForMonth(sim.months - 1, stepOffsets);
    const freedPayment =
      paymentForSegment(sl.payments, payoffSeg) +
      Math.max(0, Number(sl.extraMonthly) || 0);

    results.push({
      id: sl.id,
      label: sl.label,
      ok: true,
      months: sim.months,
      endsOn,
      totalInterest: sim.totalInterest,
      schedule: sim.schedule,
      freedPayment,
      rolledFrom: sim.rolledFrom || null,
    });
    freedEvents.push({
      id: sl.id,
      label: sl.label,
      atMonth: sim.months,
      atYearMonth: endsOn,
      freedPayment,
    });
    if (sim.months > groupMonths) groupMonths = sim.months;
  }

  freedEvents.sort((a, b) => a.atMonth - b.atMonth);
  const groupEndsOn = groupMonths > 0 ? addMonths(baseYearMonth, groupMonths) : null;

  return { results, groupEndsOn, groupMonths, freedEvents, anyError };
}

/* Aggregate combined remaining balance across all sub-loans at the end of
   each month, for charting a debt-paydown curve.
   Returns { perMonth: [{ monthIndex, total, byLoan: {id: bal} }],
             months, payoffMonth } over the longest-living sub-loan. A
   sub-loan that has paid off contributes 0 from its payoff month onward.

   opts.lumpSums — [{ monthIndex, amount }] one-time paydowns (amount > 0)
   against the COMBINED principal, e.g. a mortgage-payoff one-time event
   linked to this obligation. Each lump retires that many dollars of the
   combined balance from its month onward; the curve drops by the lump and
   stays lower for the rest of the projection (a "shorten"-style paydown on
   the combined balance — the realistic outcome of a lump payoff).

   Why apply on the combined curve rather than re-amortizing a tranche:
   the lump is entered as a single dollar figure with no chosen target
   sub-loan, so the honest, conservative model is "it retires that much
   combined principal." This makes the Debt Remaining curve and the graph
   reflect the payment instead of silently ignoring it. Per-tranche
   targeting (which loan the lump hits, and the resulting interest savings
   on that specific rate) is a follow-up; what matters here is that the
   debt no longer pretends the lump never happened.

   The lump is applied to the combined `total`. byLoan balances are left as
   their natural per-loan amortization (we don't attribute the lump to a
   specific sub-loan), so for a lump-paid obligation `total` is the source
   of truth and the sum of byLoan may exceed it — callers charting the
   combined curve should read `total`. payoffMonth is the first month the
   lump-adjusted combined balance reaches zero (null if it never does
   within the horizon). */
export function aggregateSubLoanBalances(resolved, opts = {}) {
  const ok = resolved.results.filter((r) => r.ok && Array.isArray(r.schedule));
  const months = resolved.groupMonths || 0;

  // Cumulative lump paid down by month index (each lump applies from its
  // month onward). Negative/zero amounts ignored; out-of-range clamped in.
  const lumps = Array.isArray(opts.lumpSums) ? opts.lumpSums : [];
  const cumLumpAt = (m) => {
    let s = 0;
    for (const ls of lumps) {
      if (!ls) continue;
      const amt = Number(ls.amount) || 0;
      const mi = Math.max(0, Number(ls.monthIndex) || 0);
      if (amt > 0 && mi <= m) s += amt;
    }
    return s;
  };

  const perMonth = [];
  let payoffMonth = null;
  for (let i = 0; i < months; i++) {
    const byLoan = {};
    let naturalTotal = 0;
    for (const r of ok) {
      // remaining after month i; if i beyond this loan's schedule, 0.
      const row = r.schedule[i];
      const remaining = row ? Math.max(0, row.remaining) : 0;
      byLoan[r.id] = remaining;
      naturalTotal += remaining;
    }
    const total = Math.max(0, naturalTotal - cumLumpAt(i));
    if (total <= 0 && payoffMonth === null) payoffMonth = i;
    perMonth.push({ monthIndex: i, total, byLoan });
  }
  return { perMonth, months, payoffMonth };
}

/* Combined required monthly payment across sub-loans for a given month
   index (sum of each sub-loan's segment payment + extra, dropping loans
   already paid off). Useful for showing "current month total" and for the
   freed-payment math. */
export function combinedPaymentAtMonth(subLoans, graduation, baseYearMonth, monthIndex, resolved) {
  const stepOffsets =
    graduation && graduation.enabled
      ? stepDatesToOffsets(graduation.steps, baseYearMonth)
      : [];
  const list = Array.isArray(subLoans) ? subLoans : [];
  let total = 0;
  for (const sl of list) {
    // skip if paid off by this month
    if (resolved) {
      const res = resolved.results.find((r) => r.id === sl.id);
      if (res && res.ok && monthIndex >= res.months) continue;
    }
    const seg = segmentForMonth(monthIndex, stepOffsets);
    total += paymentForSegment(sl.payments, seg) + Math.max(0, Number(sl.extraMonthly) || 0);
  }
  return total;
}

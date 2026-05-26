/* Loans — Advanced Forecast Phase 14b.
   ---------------------------------------------------------------
   Pure amortization tracking for the per-account forecast tab.
   Surfaces remaining balance, payoff date, total remaining interest,
   and per-loan amortization curves over the forecast horizon.

   This module is intentionally DECOUPLED from forecast account
   balances. The monthly payment for a debt is assumed to live in
   the user's budget (and is therefore already reducing the savings
   rate that funds Advanced contributions). Having the loan module
   ALSO debit some "source account" would double-count the payment.
   This is the rewrite of the parked Phase 14 design — see the
   project instructions "Phase 14 partial (parked)" entry for the
   full history of why source/target/overflow account coupling was
   removed.

   Use cases this module supports:
     - Mortgage / auto / student-loan balance over horizon
     - Payoff date given current rate + term + optional extra principal
     - Total interest remaining from base date onward
     - Per-loan + total aggregate debt curve for the chart

   Use cases this module deliberately does NOT support:
     - Modeling the underlying asset purchased with the loan (e.g.
       crediting a "home equity" account at origination). That's a
       one-time event (utils/oneTimeEvents.js) if it's needed.
     - Tracking the monthly payment as account cash flow. That's
       the budget's job; this module never touches account balances.

   ---------------------------------------------------------------
   Shape (persisted):

     {
       id: "loan_<random>",
       label: string,
       principal: number,             // original loan amount (positive)
       originationDate: "YYYY-MM-DD", // or "YYYY-MM"; when borrowing began
       interestRate: number,           // annual % (e.g. 6.5 for 6.5%)
       termMonths: integer,            // total amortization term
       extraMonthlyPrincipal: number,  // optional; default 0
     }

   Resolved shape (returned by resolveLoans, consumed by aggregateDebt):

     {
       id, label,
       principal,                  // original loan amount
       interestRate,               // annual %
       termMonths,                 // original term
       extraMonthlyPrincipal,      // extra each month
       originationDate,
       startMonthIndex,            // absolute monthIndex of FIRST scheduled
                                   //   payment from baseYear+baseMonth; can be
                                   //   negative for pre-base loans.
       elapsedAtBase,              // payments already made before baseYearMonth
                                   //   (0 for future-origination loans)
       remainingAtBase,            // principal balance at baseYearMonth
                                   //   (= original principal for future loans)
       basePayment,                // standard amortized monthly payment
                                   //   (excludes extraMonthlyPrincipal)
     }
*/

const NEW_ID_PREFIX = "loan_";
const MAX_LOAN_MONTHS = 50 * 12; // 50 years — beyond, treat as non-amortizing

/* Generate a new loan id. Random-suffixed so two added in the same
   tick don't collide. Mirrors newOneTimeEventId. */
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
     "compute-failed"       numerical fallback

   Notes:
     - Annual rate is in PERCENT (so 6.5 means 6.5%, not 0.065).
     - This is the BASE amortized payment — does not include
       extraMonthlyPrincipal. The schedule walker adds the extra
       on top of the principal portion each month.
     - Result is NOT rounded — caller is responsible for any
       presentation rounding. */
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
   Walks the loan from origination forward, factoring in any
   extraMonthlyPrincipal. Stops when balance hits 0 (which may be
   well before termMonths if extraMonthlyPrincipal > 0).

   Returns: Array<{
     monthIndex,            // 1-indexed relative to loan origination
     payment,               // basePayment + extraMonthlyPrincipal portion paid
                            //   (excluding interest; this is what hits the budget
                            //   in cash terms)
     principal,             // principal portion this month
     interest,              // interest portion this month
     remainingBalance,      // balance AFTER this payment
     cumulativeInterest,    // running sum of interest paid
   }>

   monthIndex is RELATIVE to the loan's own origination, not the
   forecast timeline. resolveLoans converts to absolute monthIndex
   via originationMonthIndex + scheduleIdx - 1.

   The final month's principal portion is capped at the remaining
   balance (standard "shortened-last-payment" convention), so
   sum(principal) === original principal modulo float epsilon.

   Returns [] on invalid input (e.g. zero principal). Negative
   extraMonthlyPrincipal is coerced to 0 — we don't model
   payment skipping. */
export function amortizationSchedule(loan) {
  const P = Number(loan?.principal);
  const rPct = Number(loan?.interestRate);
  const n = Number(loan?.termMonths);
  let extra = Number(loan?.extraMonthlyPrincipal);
  if (!isFinite(extra) || extra < 0) extra = 0;

  const mp = monthlyPayment(P, rPct, n);
  if (!mp.ok) return [];

  const nWhole = Math.ceil(n);
  const r = rPct > 0 ? (rPct / 100) / 12 : 0;
  const basePayment = mp.payment;
  const schedule = [];
  let balance = P;
  let cumulativeInterest = 0;

  // Safety cap: with extra principal, payoff happens before nWhole;
  // without it, payoff is exactly nWhole. We bound the loop at
  // MAX_LOAN_MONTHS so a pathological input can't run away.
  const maxIter = Math.min(MAX_LOAN_MONTHS, nWhole);

  for (let m = 1; m <= maxIter; m++) {
    const interestPortion = balance * r;
    // Standard principal portion from amortized payment.
    let principalPortion = basePayment - interestPortion;
    // Add extra principal on top.
    let extraThisMonth = extra;
    let actualPayment = basePayment + extraThisMonth;

    // Cap principal+extra at remaining balance to prevent overshoot.
    // This handles both the standard last-month shortened payment
    // AND the extra-principal case (payoff lands mid-term).
    const totalPrincipalThisMonth = principalPortion + extraThisMonth;
    if (totalPrincipalThisMonth >= balance) {
      // Final month — pay off exactly.
      const cap = balance;
      // Distribute cap into base principal vs extra, prioritizing base.
      if (principalPortion >= cap) {
        principalPortion = cap;
        extraThisMonth = 0;
      } else {
        extraThisMonth = cap - principalPortion;
      }
      actualPayment = interestPortion + cap;
    }

    cumulativeInterest += interestPortion;
    const principalThisMonth = principalPortion + extraThisMonth;
    balance -= principalThisMonth;

    // Clamp tiny negative residuals from float arithmetic.
    if (balance < 0 && balance > -1e-6) balance = 0;

    schedule.push({
      monthIndex: m,
      payment: actualPayment,
      principal: principalThisMonth,
      interest: interestPortion,
      remainingBalance: balance,
      cumulativeInterest,
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

/* Compute the signed monthIndex offset of a date from baseYear+baseMonth.

   monthIndex 0  = the baseYear+baseMonth itself (starting snapshot)
   monthIndex 1  = first simulated month (one month after base)
   monthIndex 12 = end of year 1
   monthIndex -1 = one month BEFORE base (loan originated in the past)

   Loans differ from one-time events: a loan originating in the past
   is NOT necessarily in-past as a financial event — it's just been
   paying down already. resolveLoans walks the schedule to compute
   the remaining balance at base. Only loans that have fully paid
   off before base land in inPast.

   Returns null if the date string is unparseable. */
export function loanMonthIndex(dateStr, baseYear, baseMonth = 1) {
  const parsed = parseLoanDate(dateStr);
  if (!parsed) return null;
  const yearsForward = parsed.year - baseYear;
  const monthsForward = yearsForward * 12 + (parsed.month - baseMonth);
  return monthsForward;
}

/* Resolve a raw loan list against the forecast horizon.

   NO ACCOUNTS PARAM — loans do not couple to forecast accounts
   in this design. They are pure amortization records.

   Returns:
     {
       loans: [<resolved-loan>],
       orphans: [{ id, label, reason }],
       outOfHorizon: [{ id, label, originationMonthIndex }],
       inPast: [{ id, label, originationMonthIndex, paidOffMonthsBeforeBase }],
     }

   `loans` is what aggregateDebt / chart code consume — only
   well-formed, in-horizon, currently-active entries. A loan that
   originated in the past but still has remaining balance at base
   shows up here with elapsedAtBase populated.

   Orphan reasons (stable strings):
     - "bad-principal" : principal not a positive finite number
     - "bad-rate"      : rate not a non-negative finite number
     - "bad-term"      : termMonths not a positive integer
     - "bad-date"      : originationDate unparseable or missing

   Notes:
     - originationMonthIndex > horizonMonths → outOfHorizon
       (the loan never starts within the projection)
     - paid-off-before-base → inPast (loan is finished)
     - originating in baseYear+baseMonth itself is treated as
       starting at startMonthIndex=0; elapsedAtBase=0; first
       payment lands in month 1 of the projection (the next month).
       Same convention used elsewhere. */
export function resolveLoans(rawLoans, baseYearMonth, horizonMonths) {
  const out = { loans: [], orphans: [], outOfHorizon: [], inPast: [] };
  if (!Array.isArray(rawLoans) || rawLoans.length === 0) return out;
  const baseYear = baseYearMonth?.year ?? new Date().getFullYear();
  const baseMonth = baseYearMonth?.month ?? (new Date().getMonth() + 1);
  const horizon = Math.max(0, Number(horizonMonths) || 0);

  for (const ln of rawLoans) {
    if (!ln || typeof ln !== "object") continue;
    const id = ln.id;
    const label = ln.label || "";

    // Validate principal first.
    const principal = Number(ln.principal);
    if (!isFinite(principal) || principal <= 0) {
      out.orphans.push({ id, label, reason: "bad-principal" });
      continue;
    }

    // Validate term.
    const termMonths = Number(ln.termMonths);
    if (!isFinite(termMonths) || termMonths <= 0 || termMonths > MAX_LOAN_MONTHS) {
      out.orphans.push({ id, label, reason: "bad-term" });
      continue;
    }

    // Validate rate.
    const interestRate = Number(ln.interestRate);
    if (!isFinite(interestRate) || interestRate < 0) {
      out.orphans.push({ id, label, reason: "bad-rate" });
      continue;
    }

    // Origination date must parse.
    const startMonthIndex = loanMonthIndex(ln.originationDate, baseYear, baseMonth);
    if (startMonthIndex === null) {
      out.orphans.push({ id, label, reason: "bad-date" });
      continue;
    }

    // Amortization math must be valid (defensive — should pass given
    // the input checks above, but covers any edge cases monthlyPayment
    // catches that our top-level guards don't).
    const mp = monthlyPayment(principal, interestRate, termMonths);
    if (!mp.ok) {
      out.orphans.push({ id, label, reason: "bad-rate" });
      continue;
    }

    const extra = Math.max(0, Number(ln.extraMonthlyPrincipal) || 0);

    // Out-of-horizon: origination is AFTER the projection ends.
    if (startMonthIndex > horizon) {
      out.outOfHorizon.push({ id, label, originationMonthIndex: startMonthIndex });
      continue;
    }

    // Pre-base loan: walk schedule to baseYearMonth to find
    // elapsedAtBase + remainingAtBase.
    let elapsedAtBase = 0;
    let remainingAtBase = principal;

    if (startMonthIndex < 0) {
      const monthsElapsed = -startMonthIndex;
      // Walk the schedule until either we've consumed `monthsElapsed`
      // months OR the loan has paid off. amortizationSchedule already
      // honors extraMonthlyPrincipal so early payoff is reflected.
      const sched = amortizationSchedule({
        principal, interestRate, termMonths, extraMonthlyPrincipal: extra,
      });
      if (sched.length === 0) {
        // Defensive — math validated above so this shouldn't fire.
        out.orphans.push({ id, label, reason: "bad-rate" });
        continue;
      }

      // If the loan paid off entirely before base, it's inPast.
      if (sched.length <= monthsElapsed) {
        // Find when the last payment landed (relative to base, negative).
        const finalMonth = sched.length; // 1-indexed
        const paidOffAt = startMonthIndex + finalMonth - 1; // signed offset from base
        out.inPast.push({
          id,
          label,
          originationMonthIndex: startMonthIndex,
          paidOffMonthsBeforeBase: -paidOffAt,
        });
        continue;
      }

      elapsedAtBase = monthsElapsed;
      // Balance after the monthsElapsed'th payment is sched[monthsElapsed-1].remainingBalance
      remainingAtBase = sched[monthsElapsed - 1].remainingBalance;
    }

    out.loans.push({
      id,
      label,
      principal,
      interestRate,
      termMonths,
      extraMonthlyPrincipal: extra,
      originationDate: ln.originationDate,
      startMonthIndex,
      elapsedAtBase,
      remainingAtBase,
      basePayment: mp.payment,
    });
  }
  return out;
}

/* Build a per-month aggregate of remaining debt across all resolved loans.

   Returns:
     Array<{
       monthIndex,                // 1..horizonMonths
       totalRemaining,            // sum of all per-loan balances this month
       perLoanRemaining: { [loanId]: balance },  // key absent for paid-off
                                                   //   or not-yet-originated loans
       totalInterestThisMonth,    // sum of interest paid across loans this month
       totalPrincipalThisMonth,   // sum of principal portions
       totalPaymentThisMonth,     // sum of full payments (interest + principal + extra)
     }>

   Conventions:
     - monthIndex is the projection-absolute month (1 = first
       simulated month).
     - For each loan, we use its remaining schedule from baseYearMonth
       onward — pre-base elapsed payments are NOT re-walked.
     - A loan with startMonthIndex > 1 (originating mid-horizon) is
       absent from perLoanRemaining for months 1..startMonthIndex-1
       (key not present, contributes 0 to totals).
     - The MONTH a loan pays off shows the final payment in the
       totals AND a final remainingBalance of 0 in perLoanRemaining,
       then subsequent months DROP that key entirely.
     - If a loan's term extends past horizonMonths, perLoanRemaining
       still contains a positive balance at the final row.

   `resolvedLoans` is the `loans` array from resolveLoans. */
export function aggregateDebt(resolvedLoans, horizonMonths) {
  const horizon = Math.max(0, Number(horizonMonths) || 0);
  const result = [];
  if (horizon === 0) return result;
  if (!Array.isArray(resolvedLoans) || resolvedLoans.length === 0) return result;

  // Pre-compute each loan's REMAINING schedule (post-base) and the
  // absolute monthIndex of each entry.
  // perLoanSchedule[i] = { id, startAbs, entries: [{ absMonth, payment, principal, interest, remainingBalance }] }
  const perLoanSchedule = [];
  for (const ln of resolvedLoans || []) {
    if (!ln) continue;
    const fullSched = amortizationSchedule({
      principal: ln.principal,
      interestRate: ln.interestRate,
      termMonths: ln.termMonths,
      extraMonthlyPrincipal: ln.extraMonthlyPrincipal,
    });
    if (fullSched.length === 0) continue;

    // The portion of the schedule that lands at-or-after base:
    // schedule entries 1..elapsedAtBase are pre-base; the remaining
    // entries start at absMonth = startMonthIndex + elapsedAtBase.
    // For a future loan (startMonthIndex >= 0), elapsedAtBase == 0
    // and absMonth of entry 1 = startMonthIndex + 1 if startMonthIndex >= 0.
    //
    // Convention: startMonthIndex is the offset where the loan BEGINS
    // (first payment month). If startMonthIndex = 0 (loan starts in
    // base month), the first payment is monthIndex 1 in the projection.
    // If startMonthIndex = 5, first payment is projection month 6.
    // If startMonthIndex = -3, first payment was 3 months before base;
    // 3 payments are already done, and the 4th payment (entry index 4
    // 1-indexed) lands at absMonth 1.
    const firstAbsMonth = ln.startMonthIndex + ln.elapsedAtBase + 1;
    // entries to include: those whose absMonth is in [1, horizon]
    const entries = [];
    for (let i = ln.elapsedAtBase; i < fullSched.length; i++) {
      const offsetFromBase = i - ln.elapsedAtBase; // 0, 1, 2, ...
      const absMonth = firstAbsMonth + offsetFromBase;
      if (absMonth < 1) continue; // shouldn't happen given firstAbsMonth >= 1
      if (absMonth > horizon) break;
      entries.push({
        absMonth,
        payment: fullSched[i].payment,
        principal: fullSched[i].principal,
        interest: fullSched[i].interest,
        remainingBalance: fullSched[i].remainingBalance,
      });
    }
    perLoanSchedule.push({ id: ln.id, entries });
  }

  // Build month-by-month aggregate.
  // For perLoanRemaining we need the balance AT the end of each month,
  // for every loan that hasn't yet originated past it AND hasn't yet
  // paid off in an earlier month within the horizon window.
  //
  // Strategy: per loan, walk entries; for each absMonth in [1, horizon],
  // we record the balance. For months between the previous entry and
  // this one (gap, shouldn't happen given dense scheduling), we'd
  // forward-fill — but amortization is monthly contiguous so there are
  // no gaps. For months AFTER the loan's final entry (paid off mid-
  // horizon), the key is absent.

  // Initialize aggregated rows.
  for (let m = 1; m <= horizon; m++) {
    result.push({
      monthIndex: m,
      totalRemaining: 0,
      perLoanRemaining: {},
      totalInterestThisMonth: 0,
      totalPrincipalThisMonth: 0,
      totalPaymentThisMonth: 0,
    });
  }

  for (const { id, entries } of perLoanSchedule) {
    for (const e of entries) {
      const row = result[e.absMonth - 1];
      if (!row) continue;
      row.totalRemaining += e.remainingBalance;
      row.perLoanRemaining[id] = e.remainingBalance;
      row.totalInterestThisMonth += e.interest;
      row.totalPrincipalThisMonth += e.principal;
      row.totalPaymentThisMonth += e.payment;
    }
  }

  return result;
}

/* Sum of all interest that will be paid from baseYearMonth onward,
   summed across all resolved loans.

   Walks each loan's remaining schedule (post-base). Walks past
   horizonMonths into the loan's full remaining term — the goal is to
   answer "how much interest am I committed to over the life of these
   loans" rather than "how much interest within the projection
   window". The latter is available as sum of totalInterestThisMonth
   from aggregateDebt.

   Returns 0 for empty input. */
export function totalRemainingInterest(resolvedLoans /*, horizonMonths */) {
  let total = 0;
  for (const ln of resolvedLoans || []) {
    if (!ln) continue;
    const fullSched = amortizationSchedule({
      principal: ln.principal,
      interestRate: ln.interestRate,
      termMonths: ln.termMonths,
      extraMonthlyPrincipal: ln.extraMonthlyPrincipal,
    });
    if (fullSched.length === 0) continue;
    // Sum interest from elapsedAtBase onward (those are the still-to-come months).
    for (let i = ln.elapsedAtBase; i < fullSched.length; i++) {
      total += fullSched[i].interest;
    }
  }
  return total;
}

/* Find the absolute monthIndex when a specific resolved loan pays off.

   Returns null when the payoff lands beyond horizonMonths (the loan
   doesn't finish within the projection AND no extraMonthlyPrincipal
   accelerates it into range).

   Note: for a loan with extraMonthlyPrincipal > 0, the schedule is
   already shortened by amortizationSchedule, so we just inspect the
   schedule length.

   `resolvedLoan` is a single entry from resolveLoans .loans. */
export function payoffMonthIndex(resolvedLoan, horizonMonths) {
  if (!resolvedLoan) return null;
  const horizon = Math.max(0, Number(horizonMonths) || 0);
  const fullSched = amortizationSchedule({
    principal: resolvedLoan.principal,
    interestRate: resolvedLoan.interestRate,
    termMonths: resolvedLoan.termMonths,
    extraMonthlyPrincipal: resolvedLoan.extraMonthlyPrincipal,
  });
  if (fullSched.length === 0) return null;
  // Absolute monthIndex of the final payment.
  const firstAbsMonth = resolvedLoan.startMonthIndex + resolvedLoan.elapsedAtBase + 1;
  const lastEntryOffset = fullSched.length - 1 - resolvedLoan.elapsedAtBase;
  const finalAbsMonth = firstAbsMonth + lastEntryOffset;
  if (finalAbsMonth > horizon) return null;
  if (finalAbsMonth < 1) return null;
  return finalAbsMonth;
}

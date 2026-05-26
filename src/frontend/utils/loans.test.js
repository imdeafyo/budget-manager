import { describe, it, expect } from "vitest";
import {
  newLoanId,
  monthlyPayment,
  amortizationSchedule,
  parseLoanDate,
  loanMonthIndex,
  resolveLoans,
  aggregateDebt,
  totalRemainingInterest,
  payoffMonthIndex,
} from "./loans.js";

/* Phase 14b rewrite of the loans test suite.

   The previous 51 tests pinned the OLD source/target/overflow design
   and were intentionally replaced. The shape-agnostic amortization
   math from the old suite is preserved here in the
   "monthlyPayment" / "amortizationSchedule" describe blocks.

   Loans in this design are pure amortization records — no account
   coupling. The math layer (forecastGrowthAccounts) does NOT consume
   loans. Tests in this file therefore exercise the math/data
   primitives only.
*/

describe("newLoanId", () => {
  it("returns a string starting with loan_", () => {
    const id = newLoanId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("loan_")).toBe(true);
  });

  it("returns 50 unique ids on consecutive calls", () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(newLoanId());
    expect(ids.size).toBe(50);
  });
});

describe("parseLoanDate", () => {
  it("parses YYYY-MM-DD", () => {
    expect(parseLoanDate("2027-06-15")).toEqual({ year: 2027, month: 6 });
  });

  it("parses YYYY-MM", () => {
    expect(parseLoanDate("2027-06")).toEqual({ year: 2027, month: 6 });
  });

  it("handles single-digit month", () => {
    expect(parseLoanDate("2027-6")).toEqual({ year: 2027, month: 6 });
  });

  it("returns null for empty string", () => {
    expect(parseLoanDate("")).toBe(null);
  });

  it("returns null for non-string inputs", () => {
    expect(parseLoanDate(null)).toBe(null);
    expect(parseLoanDate(undefined)).toBe(null);
    expect(parseLoanDate(20270615)).toBe(null);
  });

  it("returns null for malformed dates", () => {
    expect(parseLoanDate("not-a-date")).toBe(null);
    expect(parseLoanDate("2027/06")).toBe(null);
    expect(parseLoanDate("2027-13")).toBe(null);
    expect(parseLoanDate("2027-00")).toBe(null);
  });
});

describe("loanMonthIndex", () => {
  it("returns 0 for date in baseYear+baseMonth", () => {
    expect(loanMonthIndex("2026-01", 2026, 1)).toBe(0);
  });

  it("returns 1 for one month after base", () => {
    expect(loanMonthIndex("2026-02", 2026, 1)).toBe(1);
  });

  it("returns 12 for one year after base", () => {
    expect(loanMonthIndex("2027-01", 2026, 1)).toBe(12);
  });

  it("returns -24 for two years before base", () => {
    expect(loanMonthIndex("2024-01", 2026, 1)).toBe(-24);
  });

  it("defaults baseMonth to 1 when omitted", () => {
    expect(loanMonthIndex("2027-01", 2026)).toBe(12);
  });

  it("returns null for unparseable date", () => {
    expect(loanMonthIndex("garbage", 2026, 1)).toBe(null);
  });
});

describe("monthlyPayment — standard amortization", () => {
  it("computes a known 30-year mortgage payment to the cent", () => {
    /* $300,000 @ 6% / 360mo → $1,798.65/mo (canonical reference). */
    const r = monthlyPayment(300000, 6, 360);
    expect(r.ok).toBe(true);
    expect(r.payment).toBeCloseTo(1798.65, 2);
  });

  it("computes a $400k @ 6.5% / 360mo mortgage to the cent", () => {
    /* External-calculator reference: $2,528.27. */
    const r = monthlyPayment(400000, 6.5, 360);
    expect(r.ok).toBe(true);
    expect(r.payment).toBeCloseTo(2528.27, 2);
  });

  it("computes a $30k @ 7% / 60mo auto loan", () => {
    /* External-calculator reference: $594.04. */
    const r = monthlyPayment(30000, 7, 60);
    expect(r.ok).toBe(true);
    expect(r.payment).toBeCloseTo(594.04, 2);
  });

  it("uses straight-line paydown for 0% rate", () => {
    const r = monthlyPayment(12000, 0, 12);
    expect(r.ok).toBe(true);
    expect(r.payment).toBe(1000);
  });

  it("rejects zero or negative principal", () => {
    expect(monthlyPayment(0, 6, 360).ok).toBe(false);
    expect(monthlyPayment(0, 6, 360).reason).toBe("zero-principal");
    expect(monthlyPayment(-100, 6, 360).ok).toBe(false);
  });

  it("rejects zero or negative term", () => {
    expect(monthlyPayment(100000, 6, 0).ok).toBe(false);
    expect(monthlyPayment(100000, 6, 0).reason).toBe("zero-term");
    expect(monthlyPayment(100000, 6, -12).ok).toBe(false);
  });

  it("rejects negative interest rate", () => {
    expect(monthlyPayment(100000, -1, 360).ok).toBe(false);
    expect(monthlyPayment(100000, -1, 360).reason).toBe("negative-rate");
  });

  it("rejects horizon-exceeding term (> 50 years)", () => {
    expect(monthlyPayment(100000, 6, 50 * 12 + 1).ok).toBe(false);
    expect(monthlyPayment(100000, 6, 50 * 12 + 1).reason).toBe("horizon-exceeded");
  });

  it("rejects NaN inputs", () => {
    expect(monthlyPayment(NaN, 6, 360).ok).toBe(false);
    expect(monthlyPayment(100000, NaN, 360).ok).toBe(false);
    expect(monthlyPayment(100000, 6, NaN).ok).toBe(false);
  });
});

describe("amortizationSchedule", () => {
  it("returns full schedule for a 30yr mortgage with principal summing to P (within float epsilon)", () => {
    const sched = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360 });
    expect(sched.length).toBe(360);
    const totalPrincipal = sched.reduce((s, e) => s + e.principal, 0);
    expect(totalPrincipal).toBeCloseTo(400000, 2);
    // Final balance should be 0 (or float epsilon).
    expect(sched[359].remainingBalance).toBeCloseTo(0, 2);
  });

  it("returns total interest matching the reference for $400k @ 6.5% / 30yr", () => {
    /* External reference: total interest ~$510,178. We assert within
       $5 to allow for the lender-rounded payment vs raw float
       discrepancy other calculators use. */
    const sched = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360 });
    const totalInterest = sched.reduce((s, e) => s + e.interest, 0);
    expect(totalInterest).toBeGreaterThan(510000);
    expect(totalInterest).toBeLessThan(510500);
  });

  it("zero-rate schedule is straight-line, no interest", () => {
    const sched = amortizationSchedule({ principal: 12000, interestRate: 0, termMonths: 12 });
    expect(sched.length).toBe(12);
    for (const e of sched) {
      expect(e.interest).toBe(0);
      expect(e.principal).toBe(1000);
      expect(e.payment).toBe(1000);
    }
    expect(sched[11].remainingBalance).toBe(0);
  });

  it("zero-rate cumulativeInterest is always 0", () => {
    const sched = amortizationSchedule({ principal: 12000, interestRate: 0, termMonths: 12 });
    for (const e of sched) expect(e.cumulativeInterest).toBe(0);
  });

  it("cumulativeInterest is monotonically non-decreasing and matches running sum", () => {
    const sched = amortizationSchedule({ principal: 300000, interestRate: 6, termMonths: 360 });
    let running = 0;
    for (const e of sched) {
      running += e.interest;
      expect(e.cumulativeInterest).toBeCloseTo(running, 4);
    }
  });

  it("extraMonthlyPrincipal accelerates payoff", () => {
    const noExtra = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360, extraMonthlyPrincipal: 0 });
    const withExtra = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360, extraMonthlyPrincipal: 200 });
    expect(withExtra.length).toBeLessThan(noExtra.length);
  });

  it("extraMonthlyPrincipal reduces total interest paid", () => {
    const interest = (sched) => sched.reduce((s, e) => s + e.interest, 0);
    const noExtra = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360 });
    const withExtra = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360, extraMonthlyPrincipal: 200 });
    expect(interest(withExtra)).toBeLessThan(interest(noExtra));
  });

  it("extraMonthlyPrincipal still settles to balance 0 with no overshoot", () => {
    const sched = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360, extraMonthlyPrincipal: 200 });
    const totalPrincipal = sched.reduce((s, e) => s + e.principal, 0);
    expect(totalPrincipal).toBeCloseTo(400000, 2);
    expect(sched[sched.length - 1].remainingBalance).toBeCloseTo(0, 2);
  });

  it("negative extraMonthlyPrincipal is coerced to 0", () => {
    const sched = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360, extraMonthlyPrincipal: -100 });
    expect(sched.length).toBe(360);
  });

  it("returns [] for invalid loan input", () => {
    expect(amortizationSchedule({ principal: 0, interestRate: 6, termMonths: 360 })).toEqual([]);
    expect(amortizationSchedule({ principal: 100000, interestRate: 6, termMonths: 0 })).toEqual([]);
    expect(amortizationSchedule(null)).toEqual([]);
    expect(amortizationSchedule(undefined)).toEqual([]);
  });

  it("last-payment shortened-payment convention: total principal exactly matches P", () => {
    /* The standard amortization formula gives a payment that, due to
       discrete-month float arithmetic, leaves a fractional cent
       outstanding on the final month if held constant. The
       shortened-final-payment convention caps the final principal
       portion at the remaining balance. */
    const sched = amortizationSchedule({ principal: 250000, interestRate: 5.25, termMonths: 240 });
    const totalPrincipal = sched.reduce((s, e) => s + e.principal, 0);
    expect(Math.abs(totalPrincipal - 250000)).toBeLessThan(1e-6);
  });
});

describe("resolveLoans", () => {
  const base = { year: 2026, month: 1 };
  const horizon = 360; // 30 years

  it("returns empty result for empty input", () => {
    const out = resolveLoans([], base, horizon);
    expect(out.loans).toEqual([]);
    expect(out.orphans).toEqual([]);
    expect(out.outOfHorizon).toEqual([]);
    expect(out.inPast).toEqual([]);
  });

  it("returns empty result for non-array input", () => {
    expect(resolveLoans(null, base, horizon).loans).toEqual([]);
    expect(resolveLoans(undefined, base, horizon).loans).toEqual([]);
  });

  it("resolves a well-formed future-origination loan", () => {
    const ln = {
      id: "l1", label: "mortgage", principal: 400000,
      interestRate: 6.5, termMonths: 360, originationDate: "2026-06",
      extraMonthlyPrincipal: 0,
    };
    const out = resolveLoans([ln], base, horizon);
    expect(out.loans.length).toBe(1);
    const r = out.loans[0];
    expect(r.id).toBe("l1");
    expect(r.startMonthIndex).toBe(5); // 2026-06 minus 2026-01 = 5
    expect(r.elapsedAtBase).toBe(0);
    expect(r.remainingAtBase).toBe(400000);
    expect(r.basePayment).toBeCloseTo(2528.27, 2);
    expect(r.extraMonthlyPrincipal).toBe(0);
  });

  it("resolves a loan originating IN base month (startMonthIndex=0)", () => {
    const ln = {
      id: "l1", label: "x", principal: 100000,
      interestRate: 5, termMonths: 120, originationDate: "2026-01",
    };
    const out = resolveLoans([ln], base, horizon);
    expect(out.loans.length).toBe(1);
    expect(out.loans[0].startMonthIndex).toBe(0);
    expect(out.loans[0].elapsedAtBase).toBe(0);
    expect(out.loans[0].remainingAtBase).toBe(100000);
  });

  it("resolves a pre-base loan and walks schedule to compute remainingAtBase", () => {
    /* Loan originated 24 months before base. Should resume mid-schedule
       with the correct remaining balance. */
    const ln = {
      id: "l1", label: "old mortgage", principal: 400000,
      interestRate: 6.5, termMonths: 360, originationDate: "2024-01",
    };
    const out = resolveLoans([ln], base, horizon);
    expect(out.loans.length).toBe(1);
    const r = out.loans[0];
    expect(r.startMonthIndex).toBe(-24);
    expect(r.elapsedAtBase).toBe(24);
    // Independently compute expected balance at month 24:
    const sched = amortizationSchedule({ principal: 400000, interestRate: 6.5, termMonths: 360 });
    expect(r.remainingAtBase).toBeCloseTo(sched[23].remainingBalance, 4);
  });

  it("classifies a fully-paid-off pre-base loan as inPast", () => {
    /* 12-month term, originated 24 months before base → fully paid at
       month -13 (12 months after origination). */
    const ln = {
      id: "l1", label: "done loan", principal: 12000,
      interestRate: 0, termMonths: 12, originationDate: "2024-01",
    };
    const out = resolveLoans([ln], base, horizon);
    expect(out.loans.length).toBe(0);
    expect(out.inPast.length).toBe(1);
    expect(out.inPast[0].id).toBe("l1");
    expect(out.inPast[0].paidOffMonthsBeforeBase).toBeGreaterThan(0);
  });

  it("classifies origination-after-horizon as outOfHorizon", () => {
    const ln = {
      id: "l1", label: "future", principal: 100000,
      interestRate: 5, termMonths: 120, originationDate: "2099-01",
    };
    const out = resolveLoans([ln], base, horizon);
    expect(out.loans.length).toBe(0);
    expect(out.outOfHorizon.length).toBe(1);
    expect(out.outOfHorizon[0].id).toBe("l1");
  });

  it("classifies invalid principal as orphan (bad-principal)", () => {
    const ln = {
      id: "l1", label: "x", principal: 0,
      interestRate: 5, termMonths: 120, originationDate: "2026-06",
    };
    const out = resolveLoans([ln], base, horizon);
    expect(out.orphans.length).toBe(1);
    expect(out.orphans[0].reason).toBe("bad-principal");
  });

  it("classifies negative principal as orphan (bad-principal)", () => {
    const ln = {
      id: "l1", label: "x", principal: -100,
      interestRate: 5, termMonths: 120, originationDate: "2026-06",
    };
    expect(resolveLoans([ln], base, horizon).orphans[0].reason).toBe("bad-principal");
  });

  it("classifies invalid term as orphan (bad-term)", () => {
    const ln = {
      id: "l1", label: "x", principal: 100000,
      interestRate: 5, termMonths: 0, originationDate: "2026-06",
    };
    expect(resolveLoans([ln], base, horizon).orphans[0].reason).toBe("bad-term");
  });

  it("classifies horizon-exceeding term as orphan (bad-term)", () => {
    const ln = {
      id: "l1", label: "x", principal: 100000,
      interestRate: 5, termMonths: 100 * 12, originationDate: "2026-06",
    };
    expect(resolveLoans([ln], base, horizon).orphans[0].reason).toBe("bad-term");
  });

  it("classifies negative rate as orphan (bad-rate)", () => {
    const ln = {
      id: "l1", label: "x", principal: 100000,
      interestRate: -1, termMonths: 120, originationDate: "2026-06",
    };
    expect(resolveLoans([ln], base, horizon).orphans[0].reason).toBe("bad-rate");
  });

  it("classifies unparseable date as orphan (bad-date)", () => {
    const ln = {
      id: "l1", label: "x", principal: 100000,
      interestRate: 5, termMonths: 120, originationDate: "garbage",
    };
    expect(resolveLoans([ln], base, horizon).orphans[0].reason).toBe("bad-date");
  });

  it("classifies missing date as orphan (bad-date)", () => {
    const ln = {
      id: "l1", label: "x", principal: 100000,
      interestRate: 5, termMonths: 120,
    };
    expect(resolveLoans([ln], base, horizon).orphans[0].reason).toBe("bad-date");
  });

  it("skips null/undefined entries silently", () => {
    const out = resolveLoans([null, undefined, "not an object"], base, horizon);
    expect(out.loans).toEqual([]);
    expect(out.orphans).toEqual([]);
  });

  it("classifies a mixed list correctly", () => {
    const loans = [
      { id: "l1", label: "in-horizon", principal: 100000, interestRate: 5, termMonths: 120, originationDate: "2026-06" },
      { id: "l2", label: "pre-base", principal: 400000, interestRate: 6.5, termMonths: 360, originationDate: "2024-01" },
      { id: "l3", label: "out-of-horizon", principal: 100000, interestRate: 5, termMonths: 120, originationDate: "2099-01" },
      { id: "l4", label: "paid off", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2024-01" },
      { id: "l5", label: "orphan", principal: 0, interestRate: 5, termMonths: 120, originationDate: "2026-06" },
    ];
    const out = resolveLoans(loans, base, horizon);
    expect(out.loans.length).toBe(2);
    expect(out.outOfHorizon.length).toBe(1);
    expect(out.inPast.length).toBe(1);
    expect(out.orphans.length).toBe(1);
  });

  it("does NOT take an accounts param (signature is rawLoans, baseYearMonth, horizonMonths)", () => {
    /* Compatibility tripwire: if someone restores the old 4-arg
       signature, this test should fail. */
    const ln = {
      id: "l1", label: "x", principal: 100000, interestRate: 5,
      termMonths: 120, originationDate: "2026-06",
    };
    const out = resolveLoans([ln], base, horizon);
    expect(out.loans.length).toBe(1);
    expect(out.loans[0]).not.toHaveProperty("sourceAccountId");
    expect(out.loans[0]).not.toHaveProperty("targetAccountId");
    expect(out.loans[0]).not.toHaveProperty("overflowAccountId");
  });
});

describe("aggregateDebt", () => {
  const base = { year: 2026, month: 1 };

  it("returns empty array for empty input", () => {
    expect(aggregateDebt([], 12)).toEqual([]);
  });

  it("returns empty array when horizon is 0", () => {
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2026-01" }],
      base, 12,
    ).loans;
    expect(aggregateDebt(resolved, 0)).toEqual([]);
  });

  it("produces one row per month over horizon", () => {
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2026-01" }],
      base, 36,
    ).loans;
    const agg = aggregateDebt(resolved, 36);
    expect(agg.length).toBe(36);
    for (let i = 0; i < 36; i++) expect(agg[i].monthIndex).toBe(i + 1);
  });

  it("totalRemaining equals per-loan sum each month", () => {
    const loans = [
      { id: "l1", label: "a", principal: 10000, interestRate: 6, termMonths: 24, originationDate: "2026-01" },
      { id: "l2", label: "b", principal: 5000, interestRate: 4, termMonths: 12, originationDate: "2026-01" },
    ];
    const resolved = resolveLoans(loans, base, 36).loans;
    const agg = aggregateDebt(resolved, 36);
    for (const row of agg) {
      const sum = Object.values(row.perLoanRemaining).reduce((s, v) => s + v, 0);
      expect(sum).toBeCloseTo(row.totalRemaining, 6);
    }
  });

  it("paid-off loan: balance is 0 on payoff month, key absent thereafter", () => {
    /* 12-month, 0% loan starts at base. First payment is month 1.
       Twelfth (final) payment lands at absMonth 12. */
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2026-01" }],
      base, 24,
    ).loans;
    const agg = aggregateDebt(resolved, 24);
    // Month 12 = payoff month, balance shown as 0.
    expect(agg[11].perLoanRemaining).toHaveProperty("l1");
    expect(agg[11].perLoanRemaining.l1).toBeCloseTo(0, 6);
    // Months 13..24: key absent.
    for (let m = 13; m <= 24; m++) {
      expect(agg[m - 1].perLoanRemaining).not.toHaveProperty("l1");
      expect(agg[m - 1].totalRemaining).toBe(0);
    }
  });

  it("multi-loan: total stays correct after one loan pays off", () => {
    const loans = [
      // 12-month, 0% (pays off at absMonth 12)
      { id: "short", label: "a", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2026-01" },
      // 24-month, 0% (pays off at absMonth 24)
      { id: "long", label: "b", principal: 24000, interestRate: 0, termMonths: 24, originationDate: "2026-01" },
    ];
    const resolved = resolveLoans(loans, base, 36).loans;
    const agg = aggregateDebt(resolved, 36);
    // Month 6: both active. short remaining ≈ 6000, long remaining ≈ 18000.
    expect(agg[5].totalRemaining).toBeCloseTo(24000, 0);
    // Month 13: short paid off, long still active (11 remaining payments → balance 11000).
    expect(agg[12].perLoanRemaining).not.toHaveProperty("short");
    expect(agg[12].totalRemaining).toBeCloseTo(11000, 0);
    // Month 24: long pays off this month (balance 0).
    expect(agg[23].perLoanRemaining.long).toBeCloseTo(0, 6);
    // Month 25+: both gone, total = 0.
    expect(agg[24].totalRemaining).toBe(0);
    expect(agg[24].perLoanRemaining).toEqual({});
  });

  it("loan originating mid-horizon is absent before origination month", () => {
    /* Loan starts month 6 → first payment lands absMonth 7. */
    const ln = { id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2026-07" };
    const resolved = resolveLoans([ln], base, 24).loans;
    expect(resolved.length).toBe(1);
    expect(resolved[0].startMonthIndex).toBe(6);
    const agg = aggregateDebt(resolved, 24);
    // Months 1..6: key absent.
    for (let m = 1; m <= 6; m++) {
      expect(agg[m - 1].perLoanRemaining).not.toHaveProperty("l1");
    }
    // Month 7: first payment, balance ≈ 11000.
    expect(agg[6].perLoanRemaining).toHaveProperty("l1");
    expect(agg[6].perLoanRemaining.l1).toBeCloseTo(11000, 0);
  });

  it("loan with term past horizon: partial paydown, no crash, nonzero balance at final row", () => {
    /* 30yr mortgage in 10yr horizon → still has substantial balance at month 120. */
    const ln = { id: "l1", label: "x", principal: 400000, interestRate: 6.5, termMonths: 360, originationDate: "2026-01" };
    const resolved = resolveLoans([ln], base, 120).loans;
    const agg = aggregateDebt(resolved, 120);
    expect(agg.length).toBe(120);
    expect(agg[119].perLoanRemaining.l1).toBeGreaterThan(300000);
    expect(agg[119].perLoanRemaining.l1).toBeLessThan(400000);
  });

  it("interest, principal, and payment totals are present each month", () => {
    const ln = { id: "l1", label: "x", principal: 12000, interestRate: 6, termMonths: 12, originationDate: "2026-01" };
    const resolved = resolveLoans([ln], base, 12).loans;
    const agg = aggregateDebt(resolved, 12);
    for (const row of agg) {
      expect(row.totalInterestThisMonth).toBeGreaterThanOrEqual(0);
      expect(row.totalPrincipalThisMonth).toBeGreaterThan(0);
      expect(row.totalPaymentThisMonth).toBeCloseTo(
        row.totalInterestThisMonth + row.totalPrincipalThisMonth,
        4,
      );
    }
  });

  it("pre-base loan picks up at the correct absolute month", () => {
    /* Pre-base loan: originated 6 months before base, 12-month 0% term.
       Already paid 6 months. Should pay months 7..12 of its schedule
       at absMonths 1..6. */
    const ln = { id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2025-07" };
    const resolved = resolveLoans([ln], base, 24).loans;
    expect(resolved[0].startMonthIndex).toBe(-6);
    expect(resolved[0].elapsedAtBase).toBe(6);
    expect(resolved[0].remainingAtBase).toBeCloseTo(6000, 6);
    const agg = aggregateDebt(resolved, 24);
    // absMonth 1: balance after 7th payment = $5000.
    expect(agg[0].perLoanRemaining.l1).toBeCloseTo(5000, 6);
    // absMonth 6: balance after 12th (final) payment = $0.
    expect(agg[5].perLoanRemaining.l1).toBeCloseTo(0, 6);
    // absMonth 7+: key absent.
    expect(agg[6].perLoanRemaining).not.toHaveProperty("l1");
  });
});

describe("totalRemainingInterest", () => {
  const base = { year: 2026, month: 1 };

  it("returns 0 for empty input", () => {
    expect(totalRemainingInterest([], 360)).toBe(0);
    expect(totalRemainingInterest(null, 360)).toBe(0);
  });

  it("returns total interest for a fresh 30yr mortgage", () => {
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 400000, interestRate: 6.5, termMonths: 360, originationDate: "2026-01" }],
      base, 360,
    ).loans;
    const tot = totalRemainingInterest(resolved, 360);
    expect(tot).toBeGreaterThan(510000);
    expect(tot).toBeLessThan(510500);
  });

  it("returns 0 for a 0% loan", () => {
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2026-01" }],
      base, 36,
    ).loans;
    expect(totalRemainingInterest(resolved, 36)).toBe(0);
  });

  it("for a pre-base loan, returns only interest from baseYearMonth onward (not original loan total)", () => {
    /* 30yr mortgage originated 5 years before base. Total lifetime
       interest ≈ $510k; remaining-from-base interest should be
       meaningfully less. */
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 400000, interestRate: 6.5, termMonths: 360, originationDate: "2021-01" }],
      base, 360,
    ).loans;
    const tot = totalRemainingInterest(resolved, 360);
    // We've already paid ~5 years of interest; remaining should be < 480k.
    expect(tot).toBeLessThan(480000);
    expect(tot).toBeGreaterThan(0);
  });

  it("extraMonthlyPrincipal reduces total remaining interest", () => {
    const noExtra = resolveLoans(
      [{ id: "l1", label: "x", principal: 400000, interestRate: 6.5, termMonths: 360, originationDate: "2026-01" }],
      base, 360,
    ).loans;
    const withExtra = resolveLoans(
      [{ id: "l1", label: "x", principal: 400000, interestRate: 6.5, termMonths: 360, originationDate: "2026-01", extraMonthlyPrincipal: 200 }],
      base, 360,
    ).loans;
    expect(totalRemainingInterest(withExtra, 360)).toBeLessThan(totalRemainingInterest(noExtra, 360));
  });

  it("sums across multiple loans", () => {
    const resolved = resolveLoans(
      [
        { id: "a", label: "a", principal: 100000, interestRate: 6, termMonths: 120, originationDate: "2026-01" },
        { id: "b", label: "b", principal: 50000, interestRate: 5, termMonths: 60, originationDate: "2026-01" },
      ],
      base, 120,
    ).loans;
    const each = (id) => totalRemainingInterest(
      resolved.filter((l) => l.id === id),
      120,
    );
    expect(totalRemainingInterest(resolved, 120)).toBeCloseTo(each("a") + each("b"), 4);
  });
});

describe("payoffMonthIndex", () => {
  const base = { year: 2026, month: 1 };

  it("returns the absolute month for a future-origination loan that pays off in horizon", () => {
    /* 12-month, 0% loan starting in base month. First payment month 1,
       final payment month 12. */
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2026-01" }],
      base, 24,
    ).loans;
    expect(payoffMonthIndex(resolved[0], 24)).toBe(12);
  });

  it("returns null when term extends past horizon and no extra principal", () => {
    /* 30yr mortgage in 20yr horizon — payoff is month 360, beyond. */
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 400000, interestRate: 6.5, termMonths: 360, originationDate: "2026-01" }],
      base, 240,
    ).loans;
    expect(payoffMonthIndex(resolved[0], 240)).toBe(null);
  });

  it("returns a valid month when extraMonthlyPrincipal accelerates payoff into horizon", () => {
    /* 30yr mortgage normally pays off at month 360. With heavy extra
       principal, payoff lands inside a tighter horizon. Pick an
       extra amount big enough to be obvious. */
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 100000, interestRate: 6, termMonths: 360, originationDate: "2026-01", extraMonthlyPrincipal: 2000 }],
      base, 120,
    ).loans;
    const payoff = payoffMonthIndex(resolved[0], 120);
    expect(payoff).not.toBe(null);
    expect(payoff).toBeGreaterThan(0);
    expect(payoff).toBeLessThanOrEqual(120);
  });

  it("returns the correct absolute month for a pre-base loan", () => {
    /* Pre-base 12-month 0% loan, originated 6 months ago. Will pay off
       6 months into the projection (absMonth 6). */
    const resolved = resolveLoans(
      [{ id: "l1", label: "x", principal: 12000, interestRate: 0, termMonths: 12, originationDate: "2025-07" }],
      base, 24,
    ).loans;
    expect(payoffMonthIndex(resolved[0], 24)).toBe(6);
  });

  it("returns null for null input", () => {
    expect(payoffMonthIndex(null, 120)).toBe(null);
    expect(payoffMonthIndex(undefined, 120)).toBe(null);
  });
});

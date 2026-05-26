import { describe, it, expect } from "vitest";
import {
  newLoanId,
  monthlyPayment,
  amortizationSchedule,
  parseLoanDate,
  loanMonthIndex,
  resolveLoans,
  loanEvents,
} from "./loans.js";

describe("newLoanId", () => {
  it("returns a string starting with loan_", () => {
    const id = newLoanId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("loan_")).toBe(true);
  });

  it("returns different ids on consecutive calls", () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(newLoanId());
    expect(ids.size).toBe(50);
  });
});

describe("monthlyPayment — standard amortization", () => {
  it("computes a known 30-year mortgage payment", () => {
    // $300,000 @ 6% / 360mo → $1,798.65/mo (canonical reference value)
    const r = monthlyPayment(300000, 6, 360);
    expect(r.ok).toBe(true);
    expect(r.payment).toBeCloseTo(1798.65, 1);
  });

  it("computes a known 15-year mortgage payment", () => {
    // $200,000 @ 5% / 180mo → $1,581.59/mo
    const r = monthlyPayment(200000, 5, 180);
    expect(r.ok).toBe(true);
    expect(r.payment).toBeCloseTo(1581.59, 1);
  });

  it("handles zero-interest loans as straight-line paydown", () => {
    // $12,000 @ 0% / 60mo → $200/mo exactly
    const r = monthlyPayment(12000, 0, 60);
    expect(r.ok).toBe(true);
    expect(r.payment).toBe(200);
  });

  it("computes a typical auto-loan payment", () => {
    // $25,000 @ 4.5% / 60mo → $466.08/mo
    const r = monthlyPayment(25000, 4.5, 60);
    expect(r.ok).toBe(true);
    expect(r.payment).toBeCloseTo(466.08, 1);
  });

  it("rejects zero or negative principal", () => {
    expect(monthlyPayment(0, 5, 60)).toEqual({ ok: false, reason: "zero-principal" });
    expect(monthlyPayment(-1000, 5, 60)).toEqual({ ok: false, reason: "zero-principal" });
  });

  it("rejects zero or negative term", () => {
    expect(monthlyPayment(10000, 5, 0)).toEqual({ ok: false, reason: "zero-term" });
    expect(monthlyPayment(10000, 5, -12)).toEqual({ ok: false, reason: "zero-term" });
  });

  it("rejects negative rate", () => {
    expect(monthlyPayment(10000, -2, 60)).toEqual({ ok: false, reason: "negative-rate" });
  });

  it("rejects term beyond MAX_LOAN_MONTHS (50yr)", () => {
    expect(monthlyPayment(10000, 5, 50 * 12 + 1)).toEqual({ ok: false, reason: "horizon-exceeded" });
  });

  it("returns the same payment for fractional termMonths as the ceil'd value", () => {
    // Term 60.5 should round up to 61 internally
    const a = monthlyPayment(10000, 5, 60.5);
    const b = monthlyPayment(10000, 5, 61);
    expect(a.payment).toBeCloseTo(b.payment, 6);
  });

  it("rejects NaN / non-finite inputs", () => {
    expect(monthlyPayment(NaN, 5, 60).ok).toBe(false);
    expect(monthlyPayment(10000, NaN, 60).ok).toBe(false);
    expect(monthlyPayment(10000, 5, NaN).ok).toBe(false);
    expect(monthlyPayment(10000, Infinity, 60).ok).toBe(false);
  });
});

describe("amortizationSchedule — month-by-month breakdown", () => {
  it("returns an empty array on invalid input", () => {
    expect(amortizationSchedule({ principal: 0, interestRate: 5, termMonths: 60 })).toEqual([]);
    expect(amortizationSchedule({ principal: 10000, interestRate: -1, termMonths: 60 })).toEqual([]);
    expect(amortizationSchedule(null)).toEqual([]);
    expect(amortizationSchedule(undefined)).toEqual([]);
  });

  it("produces termMonths entries for a normal loan", () => {
    const sched = amortizationSchedule({ principal: 10000, interestRate: 5, termMonths: 12 });
    expect(sched.length).toBe(12);
    expect(sched[0].monthIndex).toBe(1);
    expect(sched[11].monthIndex).toBe(12);
  });

  it("sums of principal portions equal original principal (no float drift)", () => {
    const sched = amortizationSchedule({ principal: 350000, interestRate: 6.5, termMonths: 360 });
    const totalPrincipal = sched.reduce((s, x) => s + x.principal, 0);
    expect(totalPrincipal).toBeCloseTo(350000, 2);
  });

  it("final month's remaining balance is exactly zero", () => {
    const sched = amortizationSchedule({ principal: 25000, interestRate: 4.5, termMonths: 60 });
    expect(sched[sched.length - 1].remainingBalance).toBe(0);
  });

  it("interest portion decreases month-over-month (standard amortization)", () => {
    const sched = amortizationSchedule({ principal: 100000, interestRate: 5, termMonths: 60 });
    for (let i = 1; i < sched.length; i++) {
      expect(sched[i].interest).toBeLessThanOrEqual(sched[i - 1].interest + 1e-6);
    }
  });

  it("principal portion increases month-over-month (standard amortization)", () => {
    const sched = amortizationSchedule({ principal: 100000, interestRate: 5, termMonths: 60 });
    for (let i = 1; i < sched.length; i++) {
      expect(sched[i].principal).toBeGreaterThanOrEqual(sched[i - 1].principal - 1e-6);
    }
  });

  it("zero-interest loan: principal portion is constant, interest is always 0", () => {
    const sched = amortizationSchedule({ principal: 12000, interestRate: 0, termMonths: 60 });
    for (const row of sched) {
      expect(row.interest).toBe(0);
      expect(row.principal).toBeCloseTo(200, 6);
    }
    expect(sched[sched.length - 1].remainingBalance).toBe(0);
  });

  it("last payment is shortened to exactly the remaining balance", () => {
    // For a typical mortgage, the planned payment overshoots by a few cents
    // on the final month. The schedule should adjust.
    const sched = amortizationSchedule({ principal: 200000, interestRate: 6.75, termMonths: 360 });
    const last = sched[sched.length - 1];
    // Sanity: balance hits zero
    expect(last.remainingBalance).toBe(0);
    // The last payment should be <= the regular payment by a fraction
    const regularPayment = sched[0].payment;
    expect(last.payment).toBeLessThanOrEqual(regularPayment + 1e-6);
  });
});

describe("parseLoanDate", () => {
  it("parses YYYY-MM", () => {
    expect(parseLoanDate("2027-06")).toEqual({ year: 2027, month: 6 });
  });

  it("parses YYYY-MM-DD by ignoring the day", () => {
    expect(parseLoanDate("2027-06-15")).toEqual({ year: 2027, month: 6 });
  });

  it("handles single-digit month", () => {
    expect(parseLoanDate("2027-6")).toEqual({ year: 2027, month: 6 });
  });

  it("returns null for empty / non-string / malformed", () => {
    expect(parseLoanDate("")).toBe(null);
    expect(parseLoanDate(null)).toBe(null);
    expect(parseLoanDate(undefined)).toBe(null);
    expect(parseLoanDate(202706)).toBe(null);
    expect(parseLoanDate("not-a-date")).toBe(null);
    expect(parseLoanDate("2027/06")).toBe(null);
    expect(parseLoanDate("2027-13")).toBe(null);
    expect(parseLoanDate("2027-00")).toBe(null);
  });
});

describe("loanMonthIndex", () => {
  it("returns 0 for the base year+month", () => {
    expect(loanMonthIndex("2026-01", 2026, 1)).toBe(0);
  });

  it("returns 1 for one month after base", () => {
    expect(loanMonthIndex("2026-02", 2026, 1)).toBe(1);
  });

  it("returns 12 for one year after base", () => {
    expect(loanMonthIndex("2027-01", 2026, 1)).toBe(12);
  });

  it("returns negative for dates before base", () => {
    expect(loanMonthIndex("2025-12", 2026, 1)).toBe(-1);
  });

  it("handles a mid-year base correctly", () => {
    // base = 2026-06, loan = 2027-03 → 9 months forward
    expect(loanMonthIndex("2027-03", 2026, 6)).toBe(9);
  });

  it("defaults baseMonth to 1 when omitted", () => {
    expect(loanMonthIndex("2027-01", 2026)).toBe(12);
  });

  it("returns null on bad date string", () => {
    expect(loanMonthIndex("garbage", 2026, 1)).toBe(null);
  });
});

describe("resolveLoans — orphan / horizon / in-past classification", () => {
  const accounts = [
    { id: "cash", name: "Joint Cash", owner: "joint", type: "cash" },
    { id: "taxable", name: "Joint Taxable", owner: "joint", type: "taxable" },
    { id: "home", name: "Home Asset", owner: "joint", type: "custom" },
  ];
  const baseYM = { year: 2026, month: 1 };

  it("returns an all-empty result for empty input", () => {
    const r = resolveLoans([], accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.orphans).toEqual([]);
    expect(r.outOfHorizon).toEqual([]);
    expect(r.inPast).toEqual([]);
  });

  it("returns an all-empty result for non-array input", () => {
    const r = resolveLoans(null, accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.orphans).toEqual([]);
  });

  it("resolves a well-formed loan with all fields", () => {
    const raw = [{
      id: "L1",
      label: "Mortgage",
      principal: 350000,
      originationDate: "2026-03",
      interestRate: 6.5,
      termMonths: 360,
      sourceAccountId: "cash",
      targetAccountId: "home",
      overflowAccountId: "taxable",
    }];
    const r = resolveLoans(raw, accounts, baseYM, 30 * 12);
    expect(r.loans.length).toBe(1);
    expect(r.loans[0].id).toBe("L1");
    expect(r.loans[0].originationMonthIndex).toBe(2);
    expect(r.loans[0].payoffMonthIndex).toBe(2 + 360 - 1);
    expect(r.loans[0].monthlyPaymentAmount).toBeCloseTo(2212.24, 1);
    expect(r.loans[0].targetAccountId).toBe("home");
    expect(r.loans[0].overflowAccountId).toBe("taxable");
    expect(r.orphans).toEqual([]);
  });

  it("orphans a loan with no source account", () => {
    const raw = [{ id: "L1", label: "x", principal: 1000, originationDate: "2027-01", interestRate: 5, termMonths: 12 }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.orphans[0].reason).toBe("no-source-account");
  });

  it("orphans a loan whose source account no longer exists", () => {
    const raw = [{ id: "L1", label: "x", principal: 1000, originationDate: "2027-01", interestRate: 5, termMonths: 12, sourceAccountId: "ghost" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.orphans[0].reason).toBe("source-account-missing");
  });

  it("orphans on unparseable origination date", () => {
    const raw = [{ id: "L1", label: "x", principal: 1000, originationDate: "garbage", interestRate: 5, termMonths: 12, sourceAccountId: "cash" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.orphans[0].reason).toBe("bad-origination-date");
  });

  it("orphans on bad amortization (zero principal)", () => {
    const raw = [{ id: "L1", label: "x", principal: 0, originationDate: "2027-01", interestRate: 5, termMonths: 12, sourceAccountId: "cash" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.orphans[0].reason).toBe("amort-zero-principal");
  });

  it("places a past-origination loan in inPast", () => {
    const raw = [{ id: "L1", label: "old", principal: 1000, originationDate: "2025-12", interestRate: 5, termMonths: 12, sourceAccountId: "cash" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.inPast.length).toBe(1);
    expect(r.inPast[0].originationMonthIndex).toBe(-1);
  });

  it("places origination=baseMonth in inPast (month-0 is the snapshot)", () => {
    const raw = [{ id: "L1", label: "today", principal: 1000, originationDate: "2026-01", interestRate: 5, termMonths: 12, sourceAccountId: "cash" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans).toEqual([]);
    expect(r.inPast.length).toBe(1);
  });

  it("places a beyond-horizon origination in outOfHorizon", () => {
    const raw = [{ id: "L1", label: "future", principal: 1000, originationDate: "2050-01", interestRate: 5, termMonths: 12, sourceAccountId: "cash" }];
    const r = resolveLoans(raw, accounts, baseYM, 24);
    expect(r.loans).toEqual([]);
    expect(r.outOfHorizon.length).toBe(1);
  });

  it("keeps the loan but nulls out a missing target account, and records orphan", () => {
    const raw = [{ id: "L1", label: "x", principal: 1000, originationDate: "2027-01", interestRate: 5, termMonths: 12, sourceAccountId: "cash", targetAccountId: "ghost" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans.length).toBe(1);
    expect(r.loans[0].targetAccountId).toBe(null);
    expect(r.orphans.some(o => o.reason === "target-account-missing")).toBe(true);
  });

  it("keeps the loan but nulls out a missing overflow account, and records orphan", () => {
    const raw = [{ id: "L1", label: "x", principal: 1000, originationDate: "2027-01", interestRate: 5, termMonths: 12, sourceAccountId: "cash", overflowAccountId: "ghost" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans.length).toBe(1);
    expect(r.loans[0].overflowAccountId).toBe(null);
    expect(r.orphans.some(o => o.reason === "overflow-account-missing")).toBe(true);
  });

  it("loan with no targetAccountId resolves cleanly with targetAccountId=null", () => {
    const raw = [{ id: "L1", label: "x", principal: 1000, originationDate: "2027-01", interestRate: 5, termMonths: 12, sourceAccountId: "cash" }];
    const r = resolveLoans(raw, accounts, baseYM, 360);
    expect(r.loans.length).toBe(1);
    expect(r.loans[0].targetAccountId).toBe(null);
    expect(r.loans[0].overflowAccountId).toBe(null);
    expect(r.orphans).toEqual([]);
  });
});

describe("loanEvents — per-account event grouping", () => {
  const accounts = [
    { id: "cash", name: "Cash", owner: "joint", type: "cash" },
    { id: "taxable", name: "Taxable", owner: "joint", type: "taxable" },
    { id: "home", name: "Home", owner: "joint", type: "custom" },
  ];
  const baseYM = { year: 2026, month: 1 };

  it("emits monthly debits from source for every month in [origin, payoff]", () => {
    const resolved = resolveLoans([{
      id: "L1", label: "auto", principal: 12000, originationDate: "2026-02",
      interestRate: 0, termMonths: 12, sourceAccountId: "cash",
    }], accounts, baseYM, 60).loans;
    const ev = loanEvents(resolved, 60);
    expect(ev.debitsByAccount.cash.length).toBe(12);
    expect(ev.debitsByAccount.cash[0].monthIndex).toBe(1);
    expect(ev.debitsByAccount.cash[11].monthIndex).toBe(12);
    expect(ev.debitsByAccount.cash[11].isFinalPayment).toBe(true);
    // Earlier months are NOT flagged final
    expect(ev.debitsByAccount.cash[10].isFinalPayment).toBe(false);
  });

  it("emits an origination credit to target in the origination month", () => {
    const resolved = resolveLoans([{
      id: "L1", label: "mort", principal: 200000, originationDate: "2026-04",
      interestRate: 5, termMonths: 360, sourceAccountId: "cash", targetAccountId: "home",
    }], accounts, baseYM, 360).loans;
    const ev = loanEvents(resolved, 360);
    expect(ev.creditsByAccount.home.length).toBe(1);
    expect(ev.creditsByAccount.home[0].kind).toBe("origination");
    expect(ev.creditsByAccount.home[0].monthIndex).toBe(3);
    expect(ev.creditsByAccount.home[0].amount).toBe(200000);
  });

  it("emits NO origination credit when targetAccountId is null", () => {
    const resolved = resolveLoans([{
      id: "L1", label: "x", principal: 1000, originationDate: "2027-01",
      interestRate: 0, termMonths: 12, sourceAccountId: "cash",
    }], accounts, baseYM, 360).loans;
    const ev = loanEvents(resolved, 360);
    expect(ev.creditsByAccount).toEqual({});
  });

  it("emits an overflow credit at payoff+1 when overflow account is distinct from source", () => {
    const resolved = resolveLoans([{
      id: "L1", label: "auto", principal: 12000, originationDate: "2026-02",
      interestRate: 0, termMonths: 12, sourceAccountId: "cash", overflowAccountId: "taxable",
    }], accounts, baseYM, 60).loans;
    const ev = loanEvents(resolved, 60);
    expect(ev.creditsByAccount.taxable.length).toBe(1);
    expect(ev.creditsByAccount.taxable[0].kind).toBe("overflow");
    // Origination month=1, term=12, payoff=12, overflow fires at 13
    expect(ev.creditsByAccount.taxable[0].monthIndex).toBe(13);
    expect(ev.creditsByAccount.taxable[0].amount).toBe(1000);
  });

  it("emits NO overflow credit when overflow account equals source (money stays in source)", () => {
    const resolved = resolveLoans([{
      id: "L1", label: "auto", principal: 12000, originationDate: "2026-02",
      interestRate: 0, termMonths: 12, sourceAccountId: "cash", overflowAccountId: "cash",
    }], accounts, baseYM, 60).loans;
    const ev = loanEvents(resolved, 60);
    expect(ev.creditsByAccount).toEqual({});
  });

  it("clamps monthly debits at the horizon when payoff > horizon", () => {
    // 30-year mortgage starting at month 1, horizon only 24 months
    const resolved = resolveLoans([{
      id: "L1", label: "mort", principal: 300000, originationDate: "2026-02",
      interestRate: 6, termMonths: 360, sourceAccountId: "cash",
    }], accounts, baseYM, 24).loans;
    const ev = loanEvents(resolved, 24);
    expect(ev.debitsByAccount.cash.length).toBe(24);
    expect(ev.debitsByAccount.cash[23].monthIndex).toBe(24);
    // No payment is marked final (loan hasn't paid off yet)
    expect(ev.debitsByAccount.cash.every(d => !d.isFinalPayment)).toBe(true);
  });

  it("emits no overflow credit when payoff is at the horizon (no months past payoff)", () => {
    // 12-month loan, origination month=1, payoff=12. Horizon=12 exactly.
    // Overflow would fire at month 13, which is past horizon — drop.
    const resolved = resolveLoans([{
      id: "L1", label: "auto", principal: 12000, originationDate: "2026-02",
      interestRate: 0, termMonths: 12, sourceAccountId: "cash", overflowAccountId: "taxable",
    }], accounts, baseYM, 12).loans;
    const ev = loanEvents(resolved, 12);
    expect(ev.creditsByAccount).toEqual({});
  });
});

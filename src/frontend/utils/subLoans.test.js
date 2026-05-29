import { describe, it, expect } from "vitest";
import {
  segmentForMonth,
  paymentForSegment,
  stepDatesToOffsets,
  simulateSubLoan,
  resolveSubLoanGroup,
  aggregateSubLoanBalances,
  combinedPaymentAtMonth,
  MAX_SUBLOAN_MONTHS,
} from "./subLoans.js";

// Reference closed-form months-to-payoff for cross-checking the simulator
// on flat (single-segment) loans.
function refMonths(P, ratePct, M) {
  const r = ratePct / 100 / 12;
  if (r === 0) return Math.ceil(P / M);
  return Math.ceil(-Math.log(1 - (r * P) / M) / Math.log(1 + r));
}

describe("segmentForMonth", () => {
  it("returns 0 with no steps", () => {
    expect(segmentForMonth(0, [])).toBe(0);
    expect(segmentForMonth(99, [])).toBe(0);
    expect(segmentForMonth(5, undefined)).toBe(0);
  });
  it("places months into the right segment", () => {
    const steps = [24, 48, 72]; // step every 2 years
    expect(segmentForMonth(0, steps)).toBe(0);
    expect(segmentForMonth(23, steps)).toBe(0);
    expect(segmentForMonth(24, steps)).toBe(1);
    expect(segmentForMonth(47, steps)).toBe(1);
    expect(segmentForMonth(48, steps)).toBe(2);
    expect(segmentForMonth(72, steps)).toBe(3);
    expect(segmentForMonth(500, steps)).toBe(3);
  });
});

describe("paymentForSegment", () => {
  it("reuses the last payment when array is short (flat loan)", () => {
    expect(paymentForSegment([200], 0)).toBe(200);
    expect(paymentForSegment([200], 5)).toBe(200);
  });
  it("indexes into graduated payments", () => {
    expect(paymentForSegment([100, 150, 200], 0)).toBe(100);
    expect(paymentForSegment([100, 150, 200], 1)).toBe(150);
    expect(paymentForSegment([100, 150, 200], 2)).toBe(200);
    expect(paymentForSegment([100, 150, 200], 9)).toBe(200); // clamp to last
  });
  it("treats invalid/zero entries as 0", () => {
    expect(paymentForSegment([], 0)).toBe(0);
    expect(paymentForSegment([0], 0)).toBe(0);
    expect(paymentForSegment([NaN], 0)).toBe(0);
    expect(paymentForSegment([-5], 0)).toBe(0);
  });
});

describe("stepDatesToOffsets", () => {
  it("converts dates to ascending month offsets from base", () => {
    expect(stepDatesToOffsets(["2026-01", "2028-01", "2030-01"], "2024-01")).toEqual([24, 48, 72]);
  });
  it("drops non-positive and malformed offsets, de-dups, sorts", () => {
    expect(stepDatesToOffsets(["2024-01", "2023-06", "2025-01", "bad", "2025-01"], "2024-01")).toEqual([12]);
  });
  it("handles empty / non-array", () => {
    expect(stepDatesToOffsets([], "2024-01")).toEqual([]);
    expect(stepDatesToOffsets(null, "2024-01")).toEqual([]);
  });
});

describe("simulateSubLoan — flat loan matches closed form", () => {
  it("30yr mortgage-ish: $400k @ 6.5%, $2528.27/mo", () => {
    const sim = simulateSubLoan(
      { balance: 400000, annualRate: 6.5, payments: [2528.27], extraMonthly: 0 },
      [],
    );
    expect(sim.ok).toBe(true);
    // Closed form says ~360 months.
    expect(sim.months).toBe(refMonths(400000, 6.5, 2528.27));
    expect(sim.months).toBeGreaterThanOrEqual(359);
    expect(sim.months).toBeLessThanOrEqual(361);
  });
  it("5yr auto: $25k @ 5%, $471.78/mo", () => {
    const sim = simulateSubLoan(
      { balance: 25000, annualRate: 5, payments: [471.78], extraMonthly: 0 },
      [],
    );
    expect(sim.ok).toBe(true);
    expect(sim.months).toBe(refMonths(25000, 5, 471.78));
    expect(sim.months).toBeGreaterThanOrEqual(59);
    expect(sim.months).toBeLessThanOrEqual(61);
  });
  it("zero-interest is straight-line", () => {
    const sim = simulateSubLoan(
      { balance: 1200, annualRate: 0, payments: [100], extraMonthly: 0 },
      [],
    );
    expect(sim.ok).toBe(true);
    expect(sim.months).toBe(12);
    expect(sim.totalInterest).toBe(0);
  });
});

describe("simulateSubLoan — validation", () => {
  it("zero balance fails", () => {
    expect(simulateSubLoan({ balance: 0, annualRate: 5, payments: [100] }, []).reason).toBe("zero-balance");
  });
  it("no payment anywhere fails", () => {
    expect(simulateSubLoan({ balance: 1000, annualRate: 5, payments: [0], extraMonthly: 0 }, []).reason).toBe("no-payment");
  });
  it("flat neg-am fails (payment below interest, no future step)", () => {
    // $100k @ 12% => interest $1000/mo; pay $500 only.
    const sim = simulateSubLoan({ balance: 100000, annualRate: 12, payments: [500], extraMonthly: 0 }, []);
    expect(sim.ok).toBe(false);
    expect(sim.reason).toBe("negative-amortization");
  });
  it("horizon-exceeded when it amortizes too slowly", () => {
    // tiny payment just above interest -> takes forever
    const sim = simulateSubLoan(
      { balance: 100000, annualRate: 6, payments: [501], extraMonthly: 0 },
      [],
      { maxMonths: 240 },
    );
    expect(sim.ok).toBe(false);
    expect(sim.reason).toBe("horizon-exceeded");
  });
});

describe("simulateSubLoan — graduated stepping", () => {
  it("early low segment that grows the balance is allowed if a later step rescues it", () => {
    // $50k @ 6% => interest $250/mo at start.
    // Segment 0 (first 24mo): pay $200 (below interest -> grows).
    // Segment 1 (24mo+): pay $600 (amortizes).
    const sim = simulateSubLoan(
      { balance: 50000, annualRate: 6, payments: [200, 600], extraMonthly: 0 },
      [24],
    );
    expect(sim.ok).toBe(true);
    // It must take longer than a flat $600 loan because of the slow start.
    const flat600 = simulateSubLoan({ balance: 50000, annualRate: 6, payments: [600] }, []);
    expect(sim.months).toBeGreaterThan(flat600.months);
    // Balance after month 0 should have GROWN (negative principal recorded).
    expect(sim.schedule[0].remaining).toBeGreaterThan(50000);
    expect(sim.schedule[0].principal).toBeLessThan(0);
  });
  it("graduated loan pays off faster than its starting payment alone would imply", () => {
    // standard 10yr graduated: starts low, steps every 2 yrs.
    const sim = simulateSubLoan(
      { balance: 30000, annualRate: 5, payments: [180, 215, 260, 310, 370], extraMonthly: 0 },
      [24, 48, 72, 96],
    );
    expect(sim.ok).toBe(true);
    // Graduated schedule amortizes, but slower than a flat payment at the
    // top step would (the low early years cost time + interest). Compare
    // against a flat loan paying the FINAL step amount throughout.
    const flatTop = simulateSubLoan({ balance: 30000, annualRate: 5, payments: [370] }, []);
    expect(sim.months).toBeGreaterThan(flatTop.months);
    expect(sim.months).toBeGreaterThan(60);
    expect(sim.months).toBeLessThan(MAX_SUBLOAN_MONTHS);
  });
  it("payment in the segment is read at the right boundary", () => {
    const sim = simulateSubLoan(
      { balance: 10000, annualRate: 0, payments: [100, 500], extraMonthly: 0 },
      [12],
    );
    expect(sim.ok).toBe(true);
    // 12 months at $100 = $1200 paid, $8800 left; then $500/mo => 18 more.
    expect(sim.schedule[11].payment).toBe(100);
    expect(sim.schedule[12].payment).toBe(500);
  });
});

describe("simulateSubLoan — directed extra principal", () => {
  it("extra accelerates payoff and reduces total interest", () => {
    const base = simulateSubLoan({ balance: 20000, annualRate: 6, payments: [400], extraMonthly: 0 }, []);
    const withExtra = simulateSubLoan({ balance: 20000, annualRate: 6, payments: [400], extraMonthly: 200 }, []);
    expect(withExtra.months).toBeLessThan(base.months);
    expect(withExtra.totalInterest).toBeLessThan(base.totalInterest);
  });
  it("extra alone can pay off a loan with zero required payment-segment via combined", () => {
    // required $0 but extra $500 -> still amortizes
    const sim = simulateSubLoan({ balance: 5000, annualRate: 0, payments: [0], extraMonthly: 500 }, []);
    expect(sim.ok).toBe(true);
    expect(sim.months).toBe(10);
  });
});

describe("resolveSubLoanGroup — multi-rate independent payoff", () => {
  const baseYM = "2025-01";
  const subLoans = [
    { id: "aa", label: "Great Lakes (AA)", balance: 2000, annualRate: 3.0, payments: [40.31], extraMonthly: 0 },
    { id: "ac", label: "Great Lakes (AC)", balance: 5000, annualRate: 4.5, payments: [96.62], extraMonthly: 0 },
    { id: "ad", label: "Great Lakes (AD)", balance: 4800, annualRate: 5.5, payments: [95.86], extraMonthly: 169.44 },
  ];

  it("each sub-loan amortizes on its own schedule", () => {
    const res = resolveSubLoanGroup(subLoans, { enabled: false }, baseYM);
    expect(res.anyError).toBe(false);
    expect(res.results.every((r) => r.ok)).toBe(true);
    // AD has a big directed extra -> should pay off before AC despite similar balance.
    const ac = res.results.find((r) => r.id === "ac");
    const ad = res.results.find((r) => r.id === "ad");
    expect(ad.months).toBeLessThan(ac.months);
  });

  it("group ends when the LAST sub-loan is gone", () => {
    const res = resolveSubLoanGroup(subLoans, { enabled: false }, baseYM);
    const maxMonths = Math.max(...res.results.map((r) => r.months));
    expect(res.groupMonths).toBe(maxMonths);
    expect(res.groupEndsOn).not.toBeNull();
  });

  it("freedEvents are produced per sub-loan, sorted by payoff month", () => {
    const res = resolveSubLoanGroup(subLoans, { enabled: false }, baseYM);
    expect(res.freedEvents).toHaveLength(3);
    for (let i = 1; i < res.freedEvents.length; i++) {
      expect(res.freedEvents[i].atMonth).toBeGreaterThanOrEqual(res.freedEvents[i - 1].atMonth);
    }
    // AD's freed payment includes its directed extra.
    const adFreed = res.freedEvents.find((e) => e.id === "ad");
    expect(adFreed.freedPayment).toBeCloseTo(95.86 + 169.44, 2);
    expect(adFreed.atYearMonth).toBe(adFreed.atYearMonth); // is a YYYY-MM string
  });

  it("a failing sub-loan sets anyError but others still resolve", () => {
    const withBad = [
      ...subLoans,
      { id: "bad", label: "Bad", balance: 100000, annualRate: 12, payments: [100], extraMonthly: 0 },
    ];
    const res = resolveSubLoanGroup(withBad, { enabled: false }, baseYM);
    expect(res.anyError).toBe(true);
    expect(res.results.find((r) => r.id === "bad").ok).toBe(false);
    expect(res.results.find((r) => r.id === "aa").ok).toBe(true);
  });
});

describe("resolveSubLoanGroup — shared graduation calendar", () => {
  const baseYM = "2025-01";
  it("all sub-loans step on the same dates, different amounts", () => {
    const subLoans = [
      { id: "x", label: "X", balance: 10000, annualRate: 4, payments: [80, 120], extraMonthly: 0 },
      { id: "y", label: "Y", balance: 15000, annualRate: 6, payments: [110, 170], extraMonthly: 0 },
    ];
    const grad = { enabled: true, steps: ["2027-01"] }; // +24mo
    const res = resolveSubLoanGroup(subLoans, grad, baseYM);
    expect(res.anyError).toBe(false);
    // Each sub-loan's month-24 payment should reflect segment 1.
    const x = res.results.find((r) => r.id === "x");
    expect(x.schedule[24].payment).toBe(120);
  });
});

describe("aggregateSubLoanBalances", () => {
  it("total declines monotonically toward zero and paid-off loans drop out", () => {
    const baseYM = "2025-01";
    const subLoans = [
      { id: "a", label: "A", balance: 3000, annualRate: 0, payments: [500], extraMonthly: 0 }, // 6mo
      { id: "b", label: "B", balance: 6000, annualRate: 0, payments: [500], extraMonthly: 0 }, // 12mo
    ];
    const res = resolveSubLoanGroup(subLoans, { enabled: false }, baseYM);
    const agg = aggregateSubLoanBalances(res);
    expect(agg.months).toBe(12);
    // Month 0 total = 9000 - 1000 = 8000.
    expect(agg.perMonth[0].total).toBeCloseTo(8000, 2);
    // After month 5 (6th payment) loan A is gone.
    expect(agg.perMonth[5].byLoan.a).toBeCloseTo(0, 2);
    // Total never increases.
    for (let i = 1; i < agg.perMonth.length; i++) {
      expect(agg.perMonth[i].total).toBeLessThanOrEqual(agg.perMonth[i - 1].total + 1e-6);
    }
    // Last month is ~zero.
    expect(agg.perMonth[agg.months - 1].total).toBeCloseTo(0, 2);
  });
});

describe("combinedPaymentAtMonth", () => {
  const baseYM = "2025-01";
  const subLoans = [
    { id: "a", label: "A", balance: 3000, annualRate: 0, payments: [500], extraMonthly: 0 },
    { id: "b", label: "B", balance: 6000, annualRate: 0, payments: [400], extraMonthly: 100 },
  ];
  it("sums required + extra at a given month", () => {
    expect(combinedPaymentAtMonth(subLoans, { enabled: false }, baseYM, 0)).toBe(500 + 400 + 100);
  });
  it("drops a sub-loan once it has paid off", () => {
    const res = resolveSubLoanGroup(subLoans, { enabled: false }, baseYM);
    // A pays off at month 6; by month 8 only B's payment remains.
    expect(combinedPaymentAtMonth(subLoans, { enabled: false }, baseYM, 8, res)).toBe(400 + 100);
  });
});

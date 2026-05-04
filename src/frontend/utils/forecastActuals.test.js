import { describe, it, expect } from "vitest";
import { actualAnnualContribution } from "./forecastActuals.js";

/* Helpers */
const tx = (date, amount, category, extra = {}) => ({
  id: extra.id ?? `tx-${date}-${amount}`,
  date,
  amount,
  category,
  ...extra,
});

describe("actualAnnualContribution", () => {
  it("returns null with no transactions", () => {
    expect(actualAnnualContribution({ transactions: [], months: 6, todayIso: "2026-05-01" })).toBeNull();
    expect(actualAnnualContribution({ transactions: null, months: 6, todayIso: "2026-05-01" })).toBeNull();
  });

  it("returns null when window contains no transactions", () => {
    const transactions = [
      tx("2024-01-01", 5000, "Paycheck"),  // way before window
    ];
    const result = actualAnnualContribution({
      transactions, months: 6, todayIso: "2026-05-01",
      cats: ["Food"], savCats: [],
    });
    expect(result).toBeNull();
  });

  it("returns null with non-finite months", () => {
    const transactions = [tx("2026-04-01", 5000, "Paycheck")];
    expect(actualAnnualContribution({ transactions, months: 0, todayIso: "2026-05-01" })).toBeNull();
    expect(actualAnnualContribution({ transactions, months: -3, todayIso: "2026-05-01" })).toBeNull();
    expect(actualAnnualContribution({ transactions, months: NaN, todayIso: "2026-05-01" })).toBeNull();
  });

  it("computes annual contribution as (income - expenses) × (12/months)", () => {
    // 6 months back from 2026-05-01 ≈ 2025-11-01
    // Income: 6× $5,000 paychecks = $30,000
    // Expenses: 6× $2,000 = $12,000
    // Monthly net: ($30,000 - $12,000) / 6 = $3,000
    // Annual: $3,000 × 12 = $36,000
    const transactions = [];
    for (let m = 0; m < 6; m++) {
      const date = `2026-${String(m === 5 ? 4 : m + 5).padStart(2, "0")}-01`;
      // Wait — let me build a cleaner set.
    }
    const txs = [
      tx("2026-04-15", 5000, "Paycheck"),
      tx("2026-03-15", 5000, "Paycheck"),
      tx("2026-02-15", 5000, "Paycheck"),
      tx("2026-01-15", 5000, "Paycheck"),
      tx("2025-12-15", 5000, "Paycheck"),
      tx("2025-11-15", 5000, "Paycheck"),
      tx("2026-04-20", -2000, "Food"),
      tx("2026-03-20", -2000, "Food"),
      tx("2026-02-20", -2000, "Food"),
      tx("2026-01-20", -2000, "Food"),
      tx("2025-12-20", -2000, "Food"),
      tx("2025-11-20", -2000, "Food"),
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 6,
      todayIso: "2026-05-01",
      cats: ["Food"],
      savCats: [],
      transferCats: [],
    });
    expect(result).not.toBeNull();
    expect(result.income).toBe(30000);
    expect(result.expenses).toBe(12000);
    expect(result.monthlyNet).toBe(3000);
    expect(result.annual).toBe(36000);
    expect(result.months).toBe(6);
    expect(result.txCount).toBe(12);
  });

  it("excludes transactions outside the window", () => {
    const txs = [
      // In window (last 3mo before 2026-05-01)
      tx("2026-04-01", 5000, "Paycheck"),
      tx("2026-03-15", 5000, "Paycheck"),
      // Out of window (>3mo back)
      tx("2025-12-01", 99999, "Paycheck"),
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: [],
      savCats: [],
    });
    expect(result.income).toBe(10000);
    expect(result.txCount).toBe(2);
  });

  it("excludes transfer-marked transactions", () => {
    const txs = [
      tx("2026-04-01", 5000, "Paycheck"),
      tx("2026-04-10", 1000, "Savings", { custom_fields: { _is_transfer: true } }),
      tx("2026-04-15", -1000, "Checking", { custom_fields: { _is_transfer: true } }),
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: [],
      savCats: ["Savings"],
      transferCats: [],
    });
    expect(result.income).toBe(5000);
    expect(result.txCount).toBe(1);
  });

  it("excludes transactions in transferCats categories", () => {
    const txs = [
      tx("2026-04-01", 5000, "Paycheck"),
      tx("2026-04-10", 1000, "Internal Transfer"),  // matches transferCats
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: [],
      savCats: [],
      transferCats: ["Internal Transfer"],
    });
    // "Internal Transfer" filtered out as transfer-only category before income calc
    // even though it's a positive amount.
    expect(result.income).toBe(5000);
  });

  it("treats savings deposits as savings (not expenses) — they pass through to net", () => {
    // Income $5,000, savings deposit $1,000 (positive), no other spending.
    // Expected: income=$5,000 (savings deposits don't count as income — they
    // sit in savCats so isIncomeTx skips them), expenses=$0 (savings not in
    // expense set). monthlyNet = $5,000/3 ≈ $1,666.67, annual = $20,000.
    // The user's "real" savings is the $5,000 itself (the $1,000 was
    // already on its way out via savings deposit in the wider transactions).
    // Hmm — this test case is tricky. Let me set it up cleaner:
    const txs = [
      tx("2026-04-01", 5000, "Paycheck"),
      tx("2026-04-15", 1000, "401k Contribution"),
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: [],
      savCats: ["401k Contribution"],
    });
    // Income: paycheck only. 401k deposit is a savings row, not income.
    // Expenses: nothing. Annual = $5,000/3 × 12 = $20,000.
    expect(result.income).toBe(5000);
    expect(result.expenses).toBe(0);
    expect(result.annual).toBeCloseTo(20000, 0);
  });

  it("nets refunds inside expense window", () => {
    const txs = [
      tx("2026-04-01", 5000, "Paycheck"),
      tx("2026-04-05", -200, "Food"),
      tx("2026-04-10", 50, "Food"),  // refund
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: ["Food"],
      savCats: [],
    });
    // Income: $5,000 (refund doesn't count, it's in expense category)
    // Expenses: $200 - $50 = $150 (refund-netted)
    // Monthly net: ($5,000 - $150) / 3 = $1,616.67
    // Annual: × 12 = $19,400
    expect(result.income).toBe(5000);
    expect(result.expenses).toBe(150);
    expect(result.annual).toBeCloseTo(19400, 0);
  });

  it("returns negative annual when expenses > income", () => {
    const txs = [
      tx("2026-04-01", 1000, "Paycheck"),
      tx("2026-04-10", -5000, "Food"),
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: ["Food"],
      savCats: [],
    });
    expect(result.income).toBe(1000);
    expect(result.expenses).toBe(5000);
    expect(result.monthlyNet).toBeCloseTo(-1333.33, 1);
    expect(result.annual).toBeCloseTo(-16000, 0);
  });

  it("handles 12-month window correctly", () => {
    const txs = [];
    // 12 months of $4000 paychecks, $1000 expenses
    for (let i = 0; i < 12; i++) {
      const month = String((i % 12) + 1).padStart(2, "0");
      const year = 2025 + Math.floor((i + 4) / 12);  // straddle year boundary
      // Simpler: use offsets from 2026-05-01
      const d = new Date("2026-05-01T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - (i * 30 + 5));  // ~5, 35, 65... days back
      const dateIso = d.toISOString().slice(0, 10);
      txs.push(tx(dateIso, 4000, "Paycheck", { id: `pay-${i}` }));
      txs.push(tx(dateIso, -1000, "Food", { id: `food-${i}` }));
    }
    const result = actualAnnualContribution({
      transactions: txs,
      months: 12,
      todayIso: "2026-05-01",
      cats: ["Food"],
      savCats: [],
    });
    // Should pick up all 12 months. Approx 30.44 × 12 = 365 days back.
    expect(result.txCount).toBe(24);
    expect(result.income).toBe(48000);
    expect(result.expenses).toBe(12000);
    expect(result.annual).toBeCloseTo(36000, 0);
  });

  it("respects splits when computing income and expenses", () => {
    // Split row: $1000 paycheck, with $200 sliced to "Bonus Income" category
    // and $800 to "Paycheck" — both are income (not in expense/savings sets).
    // Expected: income = $1000 (sum of both slices).
    const txs = [
      {
        id: "split-1",
        date: "2026-04-01",
        amount: 1000,
        category: "Paycheck",
        splits: [
          { category: "Paycheck", amount: 800 },
          { category: "Bonus Income", amount: 200 },
        ],
      },
    ];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: [],
      savCats: [],
    });
    expect(result.income).toBe(1000);
  });

  it("uses today's date as default todayIso", () => {
    // Just verify it doesn't throw and returns a structure.
    const todayIso = new Date().toISOString().slice(0, 10);
    const txs = [tx(todayIso, 5000, "Paycheck")];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      cats: [],
      savCats: [],
    });
    expect(result).not.toBeNull();
    expect(result.income).toBe(5000);
  });

  it("returns the from/to ISO dates used for the window", () => {
    const txs = [tx("2026-04-01", 5000, "Paycheck")];
    const result = actualAnnualContribution({
      transactions: txs,
      months: 3,
      todayIso: "2026-05-01",
      cats: [],
    });
    expect(result.toIso).toBe("2026-05-01");
    // from = 2026-05-01 minus ~91 days ≈ 2026-01-30 / 31
    expect(result.fromIso).toMatch(/^2026-0[12]-\d{2}$/);
  });
});

describe("actualAnnualContribution — mode: 'expenses' (budgeted income − actual expenses)", () => {
  it("annual = budgetedAnnualIncome − annualized actual expenses", () => {
    // 6mo window. Actual expenses: 6× $2,000 = $12,000. Annualized: $24,000.
    // Budgeted income: $90,000. Expected annual: 90,000 − 24,000 = $66,000.
    const transactions = [
      tx("2026-04-01", 5000, "Paycheck"),  // income — ignored in this mode's annual figure
      tx("2026-04-15", -2000, "Food"),
      tx("2026-03-15", -2000, "Food"),
      tx("2026-02-15", -2000, "Food"),
      tx("2026-01-15", -2000, "Food"),
      tx("2025-12-15", -2000, "Food"),
      tx("2025-11-15", -2000, "Food"),
    ];
    const result = actualAnnualContribution({
      transactions, months: 6, todayIso: "2026-05-01",
      cats: ["Food"], savCats: [],
      mode: "expenses", budgetedAnnualIncome: 90000,
    });
    expect(result.mode).toBe("expenses");
    expect(result.budgetedAnnualIncome).toBe(90000);
    expect(result.annual).toBe(66000);
    expect(result.monthlyNet).toBe(5500); // 66000 / 12
    expect(result.expenses).toBe(12000); // raw window total, not annualized
  });

  it("ignores actual income in expenses mode (immune to bonus-paycheck noise)", () => {
    // Same expenses as above ($12k → $24k annualized). Add a one-off $20k
    // bonus paycheck. In "net" mode this would inflate annual contribution
    // by $40k (20k × 12/6). In "expenses" mode it must not.
    const transactions = [
      tx("2026-04-01", 25000, "Bonus"),  // surprise! large one-off income
      tx("2026-04-15", -2000, "Food"),
      tx("2026-03-15", -2000, "Food"),
      tx("2026-02-15", -2000, "Food"),
      tx("2026-01-15", -2000, "Food"),
      tx("2025-12-15", -2000, "Food"),
      tx("2025-11-15", -2000, "Food"),
    ];
    const result = actualAnnualContribution({
      transactions, months: 6, todayIso: "2026-05-01",
      cats: ["Food"], savCats: [],
      mode: "expenses", budgetedAnnualIncome: 90000,
    });
    expect(result.annual).toBe(66000); // identical to prior test — bonus ignored
  });

  it("treats missing budgetedAnnualIncome as 0", () => {
    const transactions = [
      tx("2026-04-15", -2000, "Food"),
      tx("2026-03-15", -2000, "Food"),
      tx("2026-02-15", -2000, "Food"),
    ];
    const result = actualAnnualContribution({
      transactions, months: 3, todayIso: "2026-05-01",
      cats: ["Food"], savCats: [],
      mode: "expenses",
      // budgetedAnnualIncome omitted
    });
    // 3mo expenses: $6,000. Annualized: $24,000. Annual: 0 − 24,000 = -24,000.
    expect(result.annual).toBe(-24000);
    expect(result.budgetedAnnualIncome).toBe(0);
  });

  it("net mode unchanged by adding budgetedAnnualIncome (back-compat)", () => {
    const transactions = [
      tx("2026-04-01", 5000, "Paycheck"),
      tx("2026-04-15", -2000, "Food"),
    ];
    const a = actualAnnualContribution({
      transactions, months: 3, todayIso: "2026-05-01",
      cats: ["Food"], savCats: [],
      // mode defaults to "net"
    });
    const b = actualAnnualContribution({
      transactions, months: 3, todayIso: "2026-05-01",
      cats: ["Food"], savCats: [],
      mode: "net",
      budgetedAnnualIncome: 999999,  // ignored
    });
    expect(a.annual).toBe(b.annual);
    expect(a.mode).toBe("net");       // default
    expect(b.mode).toBe("net");
    expect(b.budgetedAnnualIncome).toBeNull();
  });
});

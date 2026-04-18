import { describe, it, expect } from "vitest";
import {
  isIncomeTx, incomeContribution, monthKey,
  buildMonthlyIncomeSeries, incomeCategories, windowRange,
} from "./income.js";

const TRANSFER_CATS = new Set(["Transfer In", "Transfer Out"]);
const EXP_CATS = new Set(["Dining", "Groceries"]);
const SAV_CATS = new Set(["Emergency Fund", "Roth IRA"]);

let _id = 0;
function tx(partial = {}) {
  _id++;
  return {
    id: partial.id || `t${_id}`,
    date: partial.date || "2025-06-15",
    amount: "amount" in partial ? partial.amount : 100,
    description: partial.description || "row",
    category: partial.category ?? null,
    account: partial.account || "Checking",
    currency: partial.currency || "USD",
    splits: partial.splits,
    custom_fields: partial.custom_fields || {},
  };
}

const opts = { transferCatSet: TRANSFER_CATS, expenseCatSet: EXP_CATS, savingsCatSet: SAV_CATS };

describe("isIncomeTx", () => {
  it("returns false for negative amounts", () => {
    expect(isIncomeTx(tx({ amount: -200, category: "Salary" }), opts)).toBe(false);
  });
  it("returns false for zero amounts", () => {
    expect(isIncomeTx(tx({ amount: 0, category: "Salary" }), opts)).toBe(false);
  });
  it("accepts a positive row with no category (uncategorized income)", () => {
    expect(isIncomeTx(tx({ amount: 500 }), opts)).toBe(true);
  });
  it("accepts a positive row in an income-ish category", () => {
    expect(isIncomeTx(tx({ amount: 500, category: "Dividends" }), opts)).toBe(true);
  });
  it("rejects rows marked as transfers via custom flag", () => {
    expect(isIncomeTx(tx({ amount: 500, custom_fields: { _is_transfer: true } }), opts)).toBe(false);
  });
  it("rejects rows in a transfer category", () => {
    expect(isIncomeTx(tx({ amount: 500, category: "Transfer In" }), opts)).toBe(false);
  });
  it("rejects positive rows in expense categories (those are refunds)", () => {
    expect(isIncomeTx(tx({ amount: 40, category: "Dining" }), opts)).toBe(false);
  });
  it("rejects positive rows in savings categories", () => {
    expect(isIncomeTx(tx({ amount: 200, category: "Roth IRA" }), opts)).toBe(false);
  });
});

describe("isIncomeTx — splits", () => {
  it("treats a split with a non-expense/savings positive slice as income", () => {
    const t = tx({
      amount: -40, // parent is net negative
      splits: [
        { id: "s1", category: "Groceries", amount: -90 },
        { id: "s2", category: "Side Gig",  amount:  50 }, // income slice
      ],
    });
    expect(isIncomeTx(t, opts)).toBe(true);
  });
  it("rejects a split row whose only positive slice is a refund", () => {
    const t = tx({
      amount: -60,
      splits: [
        { id: "s1", category: "Groceries", amount: -100 },
        { id: "s2", category: "Dining",    amount:   40 }, // refund, not income
      ],
    });
    expect(isIncomeTx(t, opts)).toBe(false);
  });
  it("rejects a split row whose only positive slice is a transfer", () => {
    const t = tx({
      amount: 0,
      splits: [
        { id: "s1", category: "Transfer In", amount: 500 },
      ],
    });
    expect(isIncomeTx(t, opts)).toBe(false);
  });
});

describe("incomeContribution", () => {
  it("returns empty for non-income rows", () => {
    expect(incomeContribution(tx({ amount: -100 }), opts).size).toBe(0);
  });
  it("uses the row category as the key", () => {
    const c = incomeContribution(tx({ amount: 500, category: "Dividends" }), opts);
    expect(c.get("Dividends")).toBe(500);
  });
  it("buckets uncategorized income under 'Uncategorized'", () => {
    const c = incomeContribution(tx({ amount: 100, category: null }), opts);
    expect(c.get("Uncategorized")).toBe(100);
  });
  it("aggregates split slices into per-category amounts", () => {
    const t = tx({
      amount: 150,
      splits: [
        { id: "s1", category: "Dividends", amount: 100 },
        { id: "s2", category: "Interest",  amount:  50 },
      ],
    });
    const c = incomeContribution(t, opts);
    expect(c.get("Dividends")).toBe(100);
    expect(c.get("Interest")).toBe(50);
  });
  it("excludes expense/savings/transfer slices from splits", () => {
    const t = tx({
      amount: 20,
      splits: [
        { id: "s1", category: "Dividends", amount: 100 },
        { id: "s2", category: "Dining",    amount:  40 }, // refund — skip
        { id: "s3", category: "Transfer In", amount:-120 }, // negative anyway, skip
      ],
    });
    const c = incomeContribution(t, opts);
    expect(c.get("Dividends")).toBe(100);
    expect(c.has("Dining")).toBe(false);
    expect(c.has("Transfer In")).toBe(false);
  });
});

describe("monthKey", () => {
  it("returns yyyy-mm", () => {
    expect(monthKey("2025-06-15")).toBe("2025-06");
  });
  it("zero-pads single-digit months", () => {
    expect(monthKey("2025-01-05")).toBe("2025-01");
  });
  it("returns null for invalid input", () => {
    expect(monthKey("not a date")).toBeNull();
    expect(monthKey(null)).toBeNull();
    expect(monthKey(undefined)).toBeNull();
    expect(monthKey("")).toBeNull();
  });
});

describe("buildMonthlyIncomeSeries", () => {
  it("returns an empty array for no transactions", () => {
    expect(buildMonthlyIncomeSeries([], opts)).toEqual([]);
  });
  it("aggregates across months, returns a Total per month", () => {
    const rows = [
      tx({ date: "2025-01-10", amount: 500, category: "Dividends" }),
      tx({ date: "2025-01-20", amount: 100, category: "Dividends" }),
      tx({ date: "2025-02-05", amount: 200, category: "Interest" }),
    ];
    const s = buildMonthlyIncomeSeries(rows, opts);
    expect(s).toHaveLength(2);
    expect(s[0].date).toBe("2025-01");
    expect(s[0].Dividends).toBe(600);
    expect(s[0].Interest).toBe(0);
    expect(s[0].Total).toBe(600);
    expect(s[1].Interest).toBe(200);
    expect(s[1].Total).toBe(200);
  });
  it("fills zero rows for months with no income between active months", () => {
    const rows = [
      tx({ date: "2025-01-10", amount: 100, category: "X" }),
      tx({ date: "2025-04-10", amount: 200, category: "X" }),
    ];
    const s = buildMonthlyIncomeSeries(rows, opts);
    expect(s.map(r => r.date)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04"]);
    expect(s[1].Total).toBe(0);
    expect(s[2].Total).toBe(0);
  });
  it("respects dropZeros when asked", () => {
    const rows = [
      tx({ date: "2025-01-10", amount: 100, category: "X" }),
      tx({ date: "2025-04-10", amount: 200, category: "X" }),
    ];
    const s = buildMonthlyIncomeSeries(rows, { ...opts, dropZeros: true });
    expect(s.map(r => r.date)).toEqual(["2025-01", "2025-04"]);
  });
  it("applies from/to date bounds", () => {
    const rows = [
      tx({ date: "2024-12-01", amount: 100, category: "X" }),
      tx({ date: "2025-01-10", amount: 200, category: "X" }),
      tx({ date: "2025-06-10", amount: 300, category: "X" }),
      tx({ date: "2026-01-01", amount: 400, category: "X" }),
    ];
    const s = buildMonthlyIncomeSeries(rows, { ...opts, from: "2025-01-01", to: "2025-12-31" });
    const keys = s.map(r => r.date);
    expect(keys[0]).toBe("2025-01");
    expect(keys[keys.length - 1]).toBe("2025-06");
    expect(s.find(r => r.date === "2025-01").Total).toBe(200);
    expect(s.find(r => r.date === "2024-12")).toBeUndefined();
    expect(s.find(r => r.date === "2026-01")).toBeUndefined();
  });
  it("applies a category filter to limit the keys surfaced", () => {
    const rows = [
      tx({ date: "2025-01-10", amount: 100, category: "Dividends" }),
      tx({ date: "2025-01-11", amount: 200, category: "Interest" }),
    ];
    const s = buildMonthlyIncomeSeries(rows, { ...opts, categoryFilter: new Set(["Dividends"]) });
    expect(s[0].Dividends).toBe(100);
    expect(s[0].Interest).toBeUndefined();
    expect(s[0].Total).toBe(100);
  });
  it("skips transfer and refund rows", () => {
    const rows = [
      tx({ date: "2025-01-10", amount: 500, category: "Transfer In" }),
      tx({ date: "2025-01-15", amount:  40, category: "Dining" }),
      tx({ date: "2025-01-20", amount: 300, category: "Dividends" }),
    ];
    const s = buildMonthlyIncomeSeries(rows, opts);
    expect(s).toHaveLength(1);
    expect(s[0].Total).toBe(300);
  });
});

describe("incomeCategories", () => {
  it("returns sorted unique income categories", () => {
    const rows = [
      tx({ amount: 100, category: "Dividends" }),
      tx({ amount: 200, category: "Interest" }),
      tx({ amount: 300, category: "Dividends" }),
      tx({ amount: -50, category: "Dining" }),
    ];
    expect(incomeCategories(rows, opts)).toEqual(["Dividends", "Interest"]);
  });
  it("includes 'Uncategorized' when there are uncategorized income rows", () => {
    const rows = [
      tx({ amount: 100, category: null }),
      tx({ amount: 200, category: "Interest" }),
    ];
    expect(incomeCategories(rows, opts)).toEqual(["Interest", "Uncategorized"]);
  });
});

describe("windowRange", () => {
  const ref = "2025-06-15";
  it("returns null bounds for 'all'", () => {
    expect(windowRange("all", ref)).toEqual({ from: null, to: null });
    expect(windowRange("", ref)).toEqual({ from: null, to: null });
  });
  it("computes YTD from Jan 1 of the reference year", () => {
    expect(windowRange("ytd", ref)).toEqual({ from: "2025-01-01", to: "2025-06-15" });
  });
  it("shifts 1y back", () => {
    expect(windowRange("1y", ref)).toEqual({ from: "2024-06-15", to: "2025-06-15" });
  });
  it("shifts 5y back", () => {
    expect(windowRange("5y", ref)).toEqual({ from: "2020-06-15", to: "2025-06-15" });
  });
  it("shifts 10y back", () => {
    expect(windowRange("10y", ref)).toEqual({ from: "2015-06-15", to: "2025-06-15" });
  });
});

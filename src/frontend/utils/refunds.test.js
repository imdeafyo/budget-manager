import { describe, it, expect } from "vitest";
import { isRefund, netCategorySpend, refundTotals } from "./refunds.js";

const EXP = new Set(["Dining", "Groceries", "Entertainment"]);
const NOT_EXP = new Set(["Savings", "Transfer In", "Transfer Out"]);

let _id = 0;
function tx(partial = {}) {
  _id++;
  return {
    id: partial.id || `t${_id}`,
    date: partial.date || "2025-01-10",
    amount: "amount" in partial ? partial.amount : -50,
    description: partial.description || "row",
    category: partial.category ?? null,
    account: partial.account || "Checking",
    currency: partial.currency || "USD",
    splits: partial.splits,
    custom_fields: partial.custom_fields || {},
  };
}

describe("isRefund", () => {
  it("returns false without an expenseCategorySet", () => {
    expect(isRefund(tx({ amount: 40, category: "Dining" }))).toBe(false);
  });
  it("returns true for a positive row in an expense category", () => {
    const t = tx({ amount: 40, category: "Dining" });
    expect(isRefund(t, { expenseCategorySet: EXP })).toBe(true);
  });
  it("returns false for a negative row", () => {
    const t = tx({ amount: -40, category: "Dining" });
    expect(isRefund(t, { expenseCategorySet: EXP })).toBe(false);
  });
  it("returns false for a positive row in a non-expense category", () => {
    const t = tx({ amount: 40, category: "Savings" });
    expect(isRefund(t, { expenseCategorySet: EXP })).toBe(false);
  });
  it("returns false for zero-amount rows", () => {
    expect(isRefund(tx({ amount: 0, category: "Dining" }), { expenseCategorySet: EXP })).toBe(false);
  });
  it("returns false for uncategorized rows", () => {
    expect(isRefund(tx({ amount: 40, category: null }), { expenseCategorySet: EXP })).toBe(false);
  });
  it("classifies a split row with a positive expense-category entry as a refund", () => {
    const t = tx({
      amount: -60,
      splits: [
        { id: "s1", category: "Groceries", amount: -100 },
        { id: "s2", category: "Dining",    amount:   40 }, // refund slice
      ],
    });
    expect(isRefund(t, { expenseCategorySet: EXP })).toBe(true);
  });
  it("does NOT classify a fully-negative split row as a refund", () => {
    const t = tx({
      amount: -80,
      splits: [
        { id: "s1", category: "Groceries", amount: -50 },
        { id: "s2", category: "Dining",    amount: -30 },
      ],
    });
    expect(isRefund(t, { expenseCategorySet: EXP })).toBe(false);
  });
});

describe("netCategorySpend — basic arithmetic", () => {
  it("returns empty for no rows", () => {
    expect(netCategorySpend([], { expenseCategorySet: EXP }).size).toBe(0);
  });
  it("sums charges as positive spend dollars", () => {
    const rows = [
      tx({ amount: -80, category: "Groceries" }),
      tx({ amount: -20, category: "Groceries" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.get("Groceries")).toBe(100);
  });
  it("subtracts refunds when netting is on", () => {
    const rows = [
      tx({ amount: -80, category: "Dining" }),
      tx({ amount:  40, category: "Dining" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.get("Dining")).toBe(40);
  });
  it("ignores refunds as income when netting is off (still doesn't count as spend)", () => {
    const rows = [
      tx({ amount: -80, category: "Dining" }),
      tx({ amount:  40, category: "Dining" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP, treatRefundsAsNetting: false });
    expect(m.get("Dining")).toBe(80); // refund skipped, raw spend unchanged
  });
  it("clamps a category with more refund than charge to 0 by default", () => {
    const rows = [
      tx({ amount: -10, category: "Dining" }),
      tx({ amount:  50, category: "Dining" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.get("Dining")).toBe(0);
  });
  it("leaves negative net visible when clamp is disabled", () => {
    const rows = [
      tx({ amount: -10, category: "Dining" }),
      tx({ amount:  50, category: "Dining" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP, clampNegativeToZero: false });
    expect(m.get("Dining")).toBe(-40);
  });
});

describe("netCategorySpend — skips non-expenses", () => {
  it("ignores rows whose category is not in the expense set", () => {
    const rows = [
      tx({ amount: -100, category: "Savings" }),
      tx({ amount:  200, category: "Transfer In" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.size).toBe(0);
  });
  it("excludes rows marked as transfers by default", () => {
    const rows = [
      tx({ amount: -100, category: "Dining", custom_fields: { _is_transfer: true } }),
      tx({ amount:  -50, category: "Dining" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.get("Dining")).toBe(50);
  });
  it("can include transfers when the flag is off", () => {
    const rows = [
      tx({ amount: -100, category: "Dining", custom_fields: { _is_transfer: true } }),
      tx({ amount:  -50, category: "Dining" }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP, excludeTransfers: false });
    expect(m.get("Dining")).toBe(150);
  });
});

describe("netCategorySpend — splits", () => {
  it("allocates split contributions to each category", () => {
    const rows = [
      tx({
        amount: -120,
        splits: [
          { id: "s1", category: "Groceries", amount: -90 },
          { id: "s2", category: "Dining",    amount: -30 },
        ],
      }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.get("Groceries")).toBe(90);
    expect(m.get("Dining")).toBe(30);
  });
  it("nets positive split entries when netting is on", () => {
    const rows = [
      tx({
        amount: -60, // parent shows net; splits are the truth
        splits: [
          { id: "s1", category: "Groceries", amount: -100 },
          { id: "s2", category: "Dining",    amount:   40 },
        ],
      }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.get("Groceries")).toBe(100);
    expect(m.get("Dining")).toBe(-40 > 0 ? -40 : 0); // refund exceeds charge in Dining → clamped to 0
    expect(m.get("Dining")).toBe(0);
  });
  it("skips split entries whose category is not an expense", () => {
    const rows = [
      tx({
        amount: -100,
        splits: [
          { id: "s1", category: "Groceries", amount: -80 },
          { id: "s2", category: "Savings",   amount: -20 }, // pre-spending-to-savings; not an expense line
        ],
      }),
    ];
    const m = netCategorySpend(rows, { expenseCategorySet: EXP });
    expect(m.get("Groceries")).toBe(80);
    expect(m.get("Savings")).toBeUndefined();
  });
});

describe("refundTotals", () => {
  it("returns positive dollars per category", () => {
    const rows = [
      tx({ amount: -100, category: "Dining" }),
      tx({ amount:   40, category: "Dining" }),
      tx({ amount:   15, category: "Groceries" }),
    ];
    const m = refundTotals(rows, { expenseCategorySet: EXP });
    expect(m.get("Dining")).toBe(40);
    expect(m.get("Groceries")).toBe(15);
  });
  it("sums multiple refunds in the same category", () => {
    const rows = [
      tx({ amount: 10, category: "Dining" }),
      tx({ amount: 25, category: "Dining" }),
    ];
    const m = refundTotals(rows, { expenseCategorySet: EXP });
    expect(m.get("Dining")).toBe(35);
  });
  it("skips transfers", () => {
    const rows = [
      tx({ amount: 40, category: "Dining", custom_fields: { _is_transfer: true } }),
      tx({ amount: 10, category: "Dining" }),
    ];
    const m = refundTotals(rows, { expenseCategorySet: EXP });
    expect(m.get("Dining")).toBe(10);
  });
  it("captures refund entries inside a split row", () => {
    const rows = [
      tx({
        amount: -60,
        splits: [
          { id: "s1", category: "Groceries", amount: -100 },
          { id: "s2", category: "Dining",    amount:   40 },
        ],
      }),
    ];
    const m = refundTotals(rows, { expenseCategorySet: EXP });
    expect(m.get("Dining")).toBe(40);
    expect(m.get("Groceries")).toBeUndefined();
  });
});

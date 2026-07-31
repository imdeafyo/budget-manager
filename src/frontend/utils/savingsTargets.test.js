import { describe, it, expect } from "vitest";
import {
  weeklyToMonthly,
  monthlyExpenseForItems,
  emergencyTarget,
  houseFundTarget,
} from "./savingsTargets.js";

describe("weeklyToMonthly", () => {
  it("converts weekly to calendar-monthly (× 52/12)", () => {
    expect(weeklyToMonthly(100)).toBeCloseTo(100 * 52 / 12, 6);
  });
  it("is NOT the 48-paycheck cadence (× 48/12 = ×4)", () => {
    // Guards the calendar-vs-paycheck decision: a reserve is calendar-real.
    expect(weeklyToMonthly(100)).not.toBeCloseTo(400, 2);
  });
  it("returns 0 for non-finite input", () => {
    expect(weeklyToMonthly(NaN)).toBe(0);
    expect(weeklyToMonthly(undefined)).toBe(0);
  });
});

describe("monthlyExpenseForItems", () => {
  const items = [
    { id: "i_a", n: "Rent", wk: 500 },
    { id: "i_b", n: "Groceries", wk: 200 },
    { id: "i_c", n: "Insurance", wk: 100 },
  ];

  it("sums all items when nothing excluded", () => {
    expect(monthlyExpenseForItems(items, [])).toBeCloseTo(800 * 52 / 12, 6);
  });

  it("excludes by stable id", () => {
    // Drop Groceries (i_b): 500 + 100 = 600 wk
    expect(monthlyExpenseForItems(items, ["i_b"])).toBeCloseTo(600 * 52 / 12, 6);
  });

  it("accepts a Set for exclusions", () => {
    expect(monthlyExpenseForItems(items, new Set(["i_a", "i_c"]))).toBeCloseTo(200 * 52 / 12, 6);
  });

  it("exclusion by id survives reorder (id-keyed, not positional)", () => {
    const reordered = [items[2], items[0], items[1]];
    expect(monthlyExpenseForItems(reordered, ["i_b"]))
      .toBeCloseTo(monthlyExpenseForItems(items, ["i_b"]), 6);
  });

  it("returns 0 for empty / non-array input", () => {
    expect(monthlyExpenseForItems([], [])).toBe(0);
    expect(monthlyExpenseForItems(null, [])).toBe(0);
  });

  it("ignores items with non-finite wk", () => {
    const bad = [{ id: "i_x", n: "Bad", wk: NaN }, { id: "i_y", n: "Ok", wk: 120 }];
    expect(monthlyExpenseForItems(bad, [])).toBeCloseTo(120 * 52 / 12, 6);
  });
});

describe("emergencyTarget", () => {
  it("multiplies monthly × months (default 6)", () => {
    expect(emergencyTarget(3000)).toBe(18000);
  });
  it("respects a custom month count (12)", () => {
    expect(emergencyTarget(3000, 12)).toBe(36000);
  });
  it("clamps non-positive / non-finite to 0", () => {
    expect(emergencyTarget(0, 6)).toBe(0);
    expect(emergencyTarget(3000, 0)).toBe(0);
    expect(emergencyTarget(NaN, 6)).toBe(0);
  });
});

describe("houseFundTarget", () => {
  it("defaults to 1.5% of home value", () => {
    expect(houseFundTarget(750000)).toBe(11250);
  });
  it("uses a custom percent", () => {
    expect(houseFundTarget(750000, 3)).toBe(22500);
    expect(houseFundTarget(750000, 1)).toBe(7500);
  });
  it("clamps non-positive / non-finite to 0", () => {
    expect(houseFundTarget(0)).toBe(0);
    expect(houseFundTarget(750000, 0)).toBe(0);
    expect(houseFundTarget(undefined)).toBe(0);
  });
});

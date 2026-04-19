import { describe, it, expect } from "vitest";
import {
  UNCATEGORIZED,
  daysInRange, daysRemaining, daysElapsed,
  itemWeeklyBudget, weeklyToPeriod, budgetByCategory,
  filterByDateRange, actualsByCategory,
  compareBudgetToActual,
} from "./budgetCompare.js";

/* ── Date helpers ─────────────────────────────────────────────────────── */
describe("daysInRange", () => {
  it("counts inclusive days", () => {
    expect(daysInRange("2026-04-01", "2026-04-30")).toBe(30);
    expect(daysInRange("2026-04-01", "2026-04-01")).toBe(1);
  });
  it("handles month boundaries including leap Feb", () => {
    expect(daysInRange("2024-02-01", "2024-02-29")).toBe(29);
    expect(daysInRange("2026-02-01", "2026-02-28")).toBe(28);
  });
  it("returns 0 for inverted ranges", () => {
    expect(daysInRange("2026-04-30", "2026-04-01")).toBe(0);
  });
  it("returns 0 on missing inputs", () => {
    expect(daysInRange("", "2026-04-01")).toBe(0);
    expect(daysInRange("2026-04-01", "")).toBe(0);
    expect(daysInRange("", "")).toBe(0);
  });
  it("YTD on April 18 = 108 days", () => {
    expect(daysInRange("2026-01-01", "2026-04-18")).toBe(108);
  });
});

describe("daysElapsed / daysRemaining", () => {
  it("today inside period: splits correctly", () => {
    expect(daysElapsed("2026-04-01", "2026-04-30", "2026-04-15")).toBe(15);
    expect(daysRemaining("2026-04-01", "2026-04-30", "2026-04-15")).toBe(16); // 15..30 inclusive
  });
  it("today before period: elapsed=0, remaining=total", () => {
    expect(daysElapsed("2026-04-01", "2026-04-30", "2026-03-15")).toBe(0);
    expect(daysRemaining("2026-04-01", "2026-04-30", "2026-03-15")).toBe(30);
  });
  it("today after period: elapsed=total, remaining=0", () => {
    expect(daysElapsed("2026-04-01", "2026-04-30", "2026-05-15")).toBe(30);
    expect(daysRemaining("2026-04-01", "2026-04-30", "2026-05-15")).toBe(0);
  });
  it("today == last day: remaining == 1", () => {
    expect(daysRemaining("2026-04-01", "2026-04-30", "2026-04-30")).toBe(1);
  });
});

/* ── Budget conversion ────────────────────────────────────────────────── */
describe("itemWeeklyBudget", () => {
  it("monthly item → 48-paycheck weekly equivalent", () => {
    // $600/month × 12 / 48 = $150/week
    expect(itemWeeklyBudget({ v: "600", p: "m" })).toBe(150);
  });
  it("yearly item → /48", () => {
    expect(itemWeeklyBudget({ v: "7200", p: "y" })).toBe(150);
  });
  it("weekly item passes through", () => {
    expect(itemWeeklyBudget({ v: "150", p: "w" })).toBe(150);
  });
  it("evaluates formulas", () => {
    expect(itemWeeklyBudget({ v: "100+50", p: "w" })).toBe(150);
  });
  it("handles malformed inputs", () => {
    expect(itemWeeklyBudget(null)).toBe(0);
    expect(itemWeeklyBudget({ v: "", p: "w" })).toBe(0);
  });
});

describe("weeklyToPeriod", () => {
  it("basis 48: $150/wk over ~30.4 days ≈ $600/mo", () => {
    // days=30 → 150 × 30/7 × 48/52 = 150 × 4.286 × 0.923 ≈ 593.4
    const r = weeklyToPeriod(150, 30, 48);
    expect(r).toBeCloseTo(593.41, 1);
  });
  it("basis 52: $150/wk over 30 days ≈ $642.9 (calendar-spread)", () => {
    const r = weeklyToPeriod(150, 30, 52);
    expect(r).toBeCloseTo(642.86, 1);
  });
  it("basis 48 for a 7-day week = the raw weekly number × (48/52)", () => {
    expect(weeklyToPeriod(150, 7, 48)).toBeCloseTo(138.46, 1);
  });
  it("basis 52 for a 7-day week = the raw weekly number", () => {
    expect(weeklyToPeriod(150, 7, 52)).toBeCloseTo(150, 1);
  });
  it("zero / negative days → 0", () => {
    expect(weeklyToPeriod(150, 0, 48)).toBe(0);
    expect(weeklyToPeriod(150, -5, 48)).toBe(0);
  });
  it("NaN weekly → 0", () => {
    expect(weeklyToPeriod(NaN, 30, 48)).toBe(0);
  });
  it("unknown basis defaults to 48", () => {
    expect(weeklyToPeriod(150, 30, 99)).toBe(weeklyToPeriod(150, 30, 48));
  });
});

describe("budgetByCategory", () => {
  const items = [
    { n: "Groceries", c: "Food", v: "600", p: "m" }, // $150/wk
    { n: "Eating Out", c: "Food", v: "200", p: "m" }, // $50/wk
    { n: "Gas",      c: "Auto", v: "100", p: "m" }, // $25/wk
    { n: "",         c: "",     v: "50",  p: "w" }, // no category — ignored
  ];
  it("sums items sharing a category", () => {
    // 30-day period, basis 48: per-wk $200 × 30/7 × 48/52 ≈ 791.21
    const m = budgetByCategory(items, 30, 48);
    expect(m.get("Food")).toBeCloseTo(791.21, 1);
    expect(m.get("Auto")).toBeCloseTo(98.9,  1);
    expect(m.has("")).toBe(false);
  });
  it("returns empty Map on bad input", () => {
    expect(budgetByCategory(null, 30, 48).size).toBe(0);
    expect(budgetByCategory([], 30, 48).size).toBe(0);
  });
});

/* ── Transaction filtering ───────────────────────────────────────────── */
describe("filterByDateRange", () => {
  const txs = [
    { id: "a", date: "2026-03-31", amount: -10, category: "Food" },
    { id: "b", date: "2026-04-01", amount: -20, category: "Food" },
    { id: "c", date: "2026-04-15", amount: -30, category: "Auto" },
    { id: "d", date: "2026-04-30", amount: -40, category: "Food" },
    { id: "e", date: "2026-05-01", amount: -50, category: "Food" },
    { id: "f", date: "",          amount: -5,  category: "Food" },
  ];
  it("inclusive boundaries", () => {
    const r = filterByDateRange(txs, "2026-04-01", "2026-04-30");
    expect(r.map(x => x.id)).toEqual(["b", "c", "d"]);
  });
  it("only from", () => {
    const r = filterByDateRange(txs, "2026-04-15", "");
    // when toIso is "", only rows with a date pass the from filter
    expect(r.map(x => x.id)).toEqual(["c", "d", "e"]);
  });
  it("only to", () => {
    const r = filterByDateRange(txs, "", "2026-04-01");
    expect(r.map(x => x.id)).toEqual(["a", "b"]);
  });
  it("returns shallow copy when no range", () => {
    const r = filterByDateRange(txs, "", "");
    expect(r.length).toBe(txs.length);
    expect(r).not.toBe(txs);
  });
  it("rows without a date are always excluded when any range given", () => {
    const r = filterByDateRange(txs, "2026-04-01", "2026-04-30");
    expect(r.find(x => x.id === "f")).toBeUndefined();
  });
});

/* ── Actuals ──────────────────────────────────────────────────────────── */
describe("actualsByCategory", () => {
  const expSet = new Set(["Food", "Auto"]);
  const savSet = new Set(["Emergency"]);

  it("sums expense spend as positive dollars, refunds net down", () => {
    const txs = [
      { date: "2026-04-01", amount: -100, category: "Food" },
      { date: "2026-04-02", amount: -40,  category: "Food" },
      { date: "2026-04-05", amount:  20,  category: "Food" }, // refund
      { date: "2026-04-10", amount: -50,  category: "Auto" },
    ];
    const r = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet });
    expect(r.expense.get("Food")).toBe(120); // 100 + 40 − 20
    expect(r.expense.get("Auto")).toBe(50);
    expect(r.savings.size).toBe(0);
    expect(r.uncategorized.count).toBe(0);
  });

  it("savings deposits tracked as positive contributions", () => {
    const txs = [
      { date: "2026-04-01", amount:  500, category: "Emergency" },
      { date: "2026-04-15", amount:  250, category: "Emergency" },
    ];
    const r = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet });
    expect(r.savings.get("Emergency")).toBe(750);
  });

  it("savings withdrawals (negative) are ignored, not counted as spend", () => {
    const txs = [
      { date: "2026-04-01", amount:  500, category: "Emergency" },
      { date: "2026-04-15", amount: -100, category: "Emergency" }, // withdrawal
    ];
    const r = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet });
    expect(r.savings.get("Emergency")).toBe(500);
    expect(r.expense.size).toBe(0);
  });

  it("marked transfers are excluded entirely", () => {
    const txs = [
      { date: "2026-04-01", amount: -100, category: "Food" },
      { date: "2026-04-02", amount: -500, category: "Food", custom_fields: { _is_transfer: true } },
    ];
    const r = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet });
    expect(r.expense.get("Food")).toBe(100);
  });

  it("rows with no category land in uncategorized", () => {
    const txs = [
      { date: "2026-04-01", amount: -50, category: "" },
      { date: "2026-04-02", amount: -25 }, // no category field
    ];
    const r = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet });
    expect(r.uncategorized.count).toBe(2);
    expect(r.uncategorized.total).toBe(75);
  });

  it("orphan category (not in exp/sav sets) lands in uncategorized", () => {
    // User deleted the "Gambling" category from the budget but a transaction
    // still has it as its category → surface it so the user notices.
    const txs = [
      { date: "2026-04-01", amount: -40, category: "Gambling" },
    ];
    const r = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet });
    expect(r.uncategorized.count).toBe(1);
    expect(r.uncategorized.total).toBe(40);
  });

  it("split rows contribute per-split across correct buckets", () => {
    const txs = [
      {
        date: "2026-04-01", amount: -100, category: "Food",
        splits: [
          { id: "s1", category: "Food", amount: -70 },
          { id: "s2", category: "Auto", amount: -30 },
        ],
      },
    ];
    const r = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet });
    expect(r.expense.get("Food")).toBe(70);
    expect(r.expense.get("Auto")).toBe(30);
  });

  it("refund-as-netting can be toggled off", () => {
    const txs = [
      { date: "2026-04-01", amount: -100, category: "Food" },
      { date: "2026-04-05", amount:  20,  category: "Food" }, // refund
    ];
    const a = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet, treatRefundsAsNetting: true });
    const b = actualsByCategory(txs, { expenseCategorySet: expSet, savingsCategorySet: savSet, treatRefundsAsNetting: false });
    expect(a.expense.get("Food")).toBe(80);
    expect(b.expense.get("Food")).toBe(100);
  });
});

/* ── compareBudgetToActual — the main aggregator ──────────────────────── */
describe("compareBudgetToActual", () => {
  const baseOpts = () => ({
    cats:    ["Food", "Auto"],
    savCats: ["Emergency"],
    transferCats: ["Transfer"],
    exp: [
      { n: "Groceries",  c: "Food", v: "600", p: "m" }, // $150/wk
      { n: "Gas",        c: "Auto", v: "100", p: "m" }, // $25/wk
    ],
    sav: [
      { n: "Emergency Fund", c: "Emergency", v: "400", p: "m" }, // $100/wk
    ],
    transactions: [
      { id: "t1", date: "2026-04-02", amount: -200, category: "Food" },
      { id: "t2", date: "2026-04-10", amount: -150, category: "Food" },
      { id: "t3", date: "2026-04-15", amount: -75,  category: "Auto" },
      { id: "t4", date: "2026-04-20", amount:  500, category: "Emergency" },
      { id: "t5", date: "2026-04-22", amount:  25,  category: "Food" }, // refund
      { id: "t6", date: "2026-04-25", amount: -300, category: "Transfer" }, // skipped
      { id: "t7", date: "2026-04-28", amount: -12,  category: "" }, // uncategorized
      { id: "t8", date: "2026-05-05", amount: -999, category: "Food" }, // out of range
    ],
    fromIso: "2026-04-01",
    toIso:   "2026-04-30",
    todayIso: "2026-04-15",
    basis: 48,
  });

  it("period summary correct", () => {
    const r = compareBudgetToActual(baseOpts());
    expect(r.period.days).toBe(30);
    expect(r.period.elapsed).toBe(15);
    expect(r.period.remaining).toBe(16);
    expect(r.period.basis).toBe(48);
  });

  it("expense rows: budget, actual, refund, over-flag correct", () => {
    const r = compareBudgetToActual(baseOpts());
    const food = r.expense.rows.find(x => x.category === "Food");
    const auto = r.expense.rows.find(x => x.category === "Auto");
    // Food budget: $150/wk × 30/7 × 48/52 ≈ 593.41
    expect(food.budgeted).toBeCloseTo(593.41, 1);
    expect(food.actual).toBe(325); // 200 + 150 − 25
    expect(food.refunded).toBe(25);
    expect(food.over).toBe(false);
    // Auto budget: $25/wk × 30/7 × 48/52 ≈ 98.9
    expect(auto.budgeted).toBeCloseTo(98.9, 1);
    expect(auto.actual).toBe(75);
    expect(auto.over).toBe(false);
  });

  it("over-budget flag fires when actual > budgeted", () => {
    const opts = baseOpts();
    opts.exp = [{ n: "Groceries", c: "Food", v: "100", p: "m" }]; // tiny
    opts.exp.push({ n: "Gas", c: "Auto", v: "100", p: "m" });
    const r = compareBudgetToActual(opts);
    const food = r.expense.rows.find(x => x.category === "Food");
    expect(food.over).toBe(true);
  });

  it("savings rows track deposits only", () => {
    const r = compareBudgetToActual(baseOpts());
    const em = r.savings.rows.find(x => x.category === "Emergency");
    expect(em.actual).toBe(500);
    expect(em.budgeted).toBeCloseTo(395.6, 1); // 100/wk × 30/7 × 48/52
    expect(em.over).toBe(true); // saved more than planned — flag on, color elsewhere
  });

  it("transfer-category rows excluded from actuals", () => {
    const r = compareBudgetToActual(baseOpts());
    const allCats = r.expense.rows.map(x => x.category).concat(r.savings.rows.map(x => x.category));
    expect(allCats).not.toContain("Transfer");
  });

  it("uncategorized bucket appears when present", () => {
    const r = compareBudgetToActual(baseOpts());
    expect(r.uncategorized).not.toBeNull();
    expect(r.uncategorized.category).toBe(UNCATEGORIZED);
    expect(r.uncategorized.actual).toBe(12);
    expect(r.uncategorized.count).toBe(1);
  });

  it("uncategorized is null when no uncategorized rows", () => {
    const opts = baseOpts();
    opts.transactions = opts.transactions.filter(t => t.category !== "");
    const r = compareBudgetToActual(opts);
    expect(r.uncategorized).toBeNull();
  });

  it("out-of-range transactions excluded", () => {
    const r = compareBudgetToActual(baseOpts());
    const food = r.expense.rows.find(x => x.category === "Food");
    expect(food.actual).toBe(325); // NOT including the $999 May 5 row
  });

  it("projection doubles mid-period spend", () => {
    // Spent $325 food + $75 auto = $400 in 15 of 30 days → project $800.
    // Plus the uncategorized $12. Projection only applies to expense totals.
    const r = compareBudgetToActual(baseOpts());
    expect(r.expense.totalActual).toBe(400);
    expect(r.expense.projected).toBe(800);
  });

  it("projection equals actual when period fully past", () => {
    const opts = baseOpts();
    opts.todayIso = "2026-05-15"; // after period
    const r = compareBudgetToActual(opts);
    expect(r.expense.projected).toBe(r.expense.totalActual);
  });

  it("projection equals actual when period fully future", () => {
    const opts = baseOpts();
    opts.todayIso = "2026-03-01"; // before period
    const r = compareBudgetToActual(opts);
    // elapsed=0 → skip the projection math, projected stays at actual
    expect(r.expense.projected).toBe(r.expense.totalActual);
  });

  it("pctUsed infinite when budget is zero but spend exists", () => {
    const opts = baseOpts();
    opts.exp = []; // no budget at all
    const r = compareBudgetToActual(opts);
    expect(r.expense.pctUsed).toBe(Infinity);
  });

  it("pctUsed is zero when nothing spent and nothing budgeted", () => {
    const opts = baseOpts();
    opts.exp = [];
    opts.transactions = [];
    const r = compareBudgetToActual(opts);
    expect(r.expense.pctUsed).toBe(0);
  });

  it("basis 52 produces larger budget targets", () => {
    const opts48 = baseOpts();
    const opts52 = { ...baseOpts(), basis: 52 };
    const r48 = compareBudgetToActual(opts48);
    const r52 = compareBudgetToActual(opts52);
    expect(r52.expense.totalBudget).toBeGreaterThan(r48.expense.totalBudget);
    // Ratio should be 52/48 ≈ 1.0833
    expect(r52.expense.totalBudget / r48.expense.totalBudget).toBeCloseTo(52/48, 3);
  });

  it("rows sorted by actual spend descending", () => {
    const r = compareBudgetToActual(baseOpts());
    for (let i = 1; i < r.expense.rows.length; i++) {
      expect(r.expense.rows[i - 1].actual).toBeGreaterThanOrEqual(r.expense.rows[i].actual);
    }
  });

  it("empty inputs don't blow up", () => {
    const r = compareBudgetToActual({});
    expect(r.expense.rows).toEqual([]);
    expect(r.savings.rows).toEqual([]);
    expect(r.expense.totalActual).toBe(0);
    expect(r.uncategorized).toBeNull();
  });

  it("category with budget but no spend shows on chart", () => {
    const opts = baseOpts();
    opts.transactions = []; // nothing spent
    const r = compareBudgetToActual(opts);
    const food = r.expense.rows.find(x => x.category === "Food");
    expect(food).toBeDefined();
    expect(food.actual).toBe(0);
    expect(food.budgeted).toBeGreaterThan(0);
  });

  it("category with spend but no budget shows on chart", () => {
    const opts = baseOpts();
    opts.exp = []; // no budgets
    const r = compareBudgetToActual(opts);
    const food = r.expense.rows.find(x => x.category === "Food");
    expect(food).toBeDefined();
    expect(food.actual).toBeGreaterThan(0);
    expect(food.budgeted).toBe(0);
    expect(food.over).toBe(true); // any spend > $0 budget is over
  });

  it("refund-netting off: actual increases, refund totals still surfaced", () => {
    const opts = baseOpts();
    opts.treatRefundsAsNetting = false;
    const r = compareBudgetToActual(opts);
    const food = r.expense.rows.find(x => x.category === "Food");
    expect(food.actual).toBe(350); // 200 + 150, no netting
    // refundTotals still reports the $25 — it's informational only
    expect(food.refunded).toBe(25);
  });

  it("projectedOver flag fires when projection exceeds total budget", () => {
    const r = compareBudgetToActual(baseOpts());
    // Projected $800 vs total budget ≈ 692 (593.41 + 98.9) → over
    expect(r.expense.projectedOver).toBe(true);
  });

  it("incomeCats rows are excluded from spending/savings and don't leak into uncategorized", () => {
    const opts = baseOpts();
    // Baseline snapshot of totals / uncategorized count before income rows exist
    const baseline = compareBudgetToActual(opts);
    const baselineExpTotalActual = baseline.expense.totalActual;

    // Seed paychecks + interest totalling ~$7000 (deposits, positive amounts)
    opts.transactions = [
      ...opts.transactions,
      { id: "i1", date: "2026-04-03", amount: 3000, category: "Paycheck" },
      { id: "i2", date: "2026-04-17", amount: 3000, category: "Paycheck" },
      { id: "i3", date: "2026-04-20", amount:  850, category: "Interest" },
      { id: "i4", date: "2026-04-25", amount:  150, category: "Interest" },
    ];
    opts.incomeCats = ["Paycheck", "Interest"];

    const r = compareBudgetToActual(opts);

    // No expense row for income-only categories
    const expRowNames = r.expense.rows.map(x => x.category);
    expect(expRowNames).not.toContain("Paycheck");
    expect(expRowNames).not.toContain("Interest");

    // Uncategorized should be null, or have count 1 (the pre-existing t7 $12 row only)
    if (r.uncategorized) {
      expect(r.uncategorized.count).toBe(1);
    }

    // Expense totals didn't inflate from the income deposits
    expect(r.expense.totalActual).toBeCloseTo(baselineExpTotalActual, 2);
  });
});

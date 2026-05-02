import { describe, it, expect } from "vitest";
import {
  UNCATEGORIZED,
  daysInRange, daysRemaining, daysElapsed,
  itemWeeklyBudget, weeklyToPeriod, budgetByCategory,
  filterByDateRange, actualsByCategory,
  compareBudgetToActual, monthlyBuckets, pickBudgetForDate,
  reconstructFromItems,
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
    // Baseline milestone of totals / uncategorized count before income rows exist
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

/* ── Monthly buckets for the line chart ─────────────────────────────────── */
describe("monthlyBuckets", () => {
  const baseOpts = () => ({
    cats: ["Food", "Auto"],
    savCats: ["Emergency"],
    transferCats: ["Transfer"],
    incomeCats: ["Paycheck"],
    exp: [
      { n: "Groceries", c: "Food", v: "600", p: "m" }, // $150/wk
      { n: "Gas",       c: "Auto", v: "100", p: "m" }, // $25/wk
    ],
    transactions: [
      // Feb
      { id: "f1", date: "2026-02-05", amount: -200, category: "Food" },
      { id: "f2", date: "2026-02-20", amount:  -50, category: "Auto" },
      // March
      { id: "m1", date: "2026-03-10", amount: -300, category: "Food" },
      { id: "m2", date: "2026-03-15", amount: -800, category: "Paycheck" },  // income → skip
      { id: "m3", date: "2026-03-22", amount: -100, category: "Transfer" },  // transfer → skip
      // April
      { id: "a1", date: "2026-04-02", amount: -150, category: "Food" },
      { id: "a2", date: "2026-04-18", amount:  -75, category: "Auto" },
    ],
    fromIso: "2026-02-01",
    toIso:   "2026-04-30",
    basis: 48,
  });

  it("produces one bucket per month in range, in order", () => {
    const buckets = monthlyBuckets(baseOpts());
    expect(buckets).toHaveLength(3);
    expect(buckets.map(b => b.monthLabel)).toEqual(["Feb 2026", "Mar 2026", "Apr 2026"]);
    expect(buckets[0].monthStart).toBe("2026-02-01");
    expect(buckets[0].monthEnd).toBe("2026-02-28");
    expect(buckets[1].days).toBe(31);
  });

  it("sums actuals across all expense cats when category is null", () => {
    const buckets = monthlyBuckets(baseOpts());
    const feb = buckets[0], mar = buckets[1], apr = buckets[2];
    expect(feb.actual).toBeCloseTo(250, 2); // 200 + 50
    expect(mar.actual).toBeCloseTo(300, 2); // Paycheck + Transfer skipped
    expect(apr.actual).toBeCloseTo(225, 2); // 150 + 75
  });

  it("filters actuals to a single category when category is specified", () => {
    const opts = { ...baseOpts(), category: "Food" };
    const buckets = monthlyBuckets(opts);
    expect(buckets[0].actual).toBeCloseTo(200, 2); // Food only, Auto excluded
    expect(buckets[1].actual).toBeCloseTo(300, 2);
    expect(buckets[2].actual).toBeCloseTo(150, 2);
  });

  it("clips first and last buckets to fromIso / toIso", () => {
    const opts = { ...baseOpts(), fromIso: "2026-02-15", toIso: "2026-04-10" };
    const buckets = monthlyBuckets(opts);
    expect(buckets).toHaveLength(3);
    expect(buckets[0].monthStart).toBe("2026-02-15"); // clipped
    expect(buckets[0].days).toBe(14);                 // 15th through 28th
    expect(buckets[2].monthEnd).toBe("2026-04-10");   // clipped
    expect(buckets[2].days).toBe(10);
  });

  it("budgeted is a flat monthly figure (weekly × 48 / 12), independent of day count", () => {
    const buckets = monthlyBuckets(baseOpts());
    // Budget tab convention: monthly = weekly × 48 / 12. Total weekly = $175.
    const monthly = 175 * 48 / 12; // = 700
    expect(buckets[0].budgeted).toBeCloseTo(monthly, 2); // Feb (28d)
    expect(buckets[1].budgeted).toBeCloseTo(monthly, 2); // Mar (31d)
    expect(buckets[2].budgeted).toBeCloseTo(monthly, 2); // Apr (30d)
    // All three equal despite different day counts.
    expect(buckets[0].budgeted).toEqual(buckets[1].budgeted);
    expect(buckets[1].budgeted).toEqual(buckets[2].budgeted);
  });

  it("single-category budget only uses that category's line items", () => {
    const opts = { ...baseOpts(), category: "Food" };
    const buckets = monthlyBuckets(opts);
    // Food only: $150/wk × 48 / 12 = $600/mo, flat across all buckets
    const expected = 150 * 48 / 12;
    expect(buckets[0].budgeted).toBeCloseTo(expected, 2);
    expect(buckets[1].budgeted).toBeCloseTo(expected, 2);
  });

  it("partial first/last bucket is prorated by days-in-bucket / days-in-full-month", () => {
    // Range: Feb 15 → Apr 10. Feb is 14d of 28 → 50%, Apr is 10d of 30 → 1/3.
    const opts = { ...baseOpts(), fromIso: "2026-02-15", toIso: "2026-04-10" };
    const buckets = monthlyBuckets(opts);
    const fullMonthly = 175 * 48 / 12;
    expect(buckets[0].budgeted).toBeCloseTo(fullMonthly * (14 / 28), 2); // Feb partial
    expect(buckets[1].budgeted).toBeCloseTo(fullMonthly, 2);             // March full
    expect(buckets[2].budgeted).toBeCloseTo(fullMonthly * (10 / 30), 2); // Apr partial
  });

  it("returns empty array when the range is invalid", () => {
    expect(monthlyBuckets({ ...baseOpts(), fromIso: null })).toEqual([]);
    expect(monthlyBuckets({ ...baseOpts(), fromIso: "2026-04-30", toIso: "2026-02-01" })).toEqual([]);
  });

  it("basis is no longer an input that affects monthlyBuckets output", () => {
    // Line-chart view is monthly — basis 48 vs 52 should produce the same
    // numbers since we only emit a flat monthly figure per bucket.
    const b48 = monthlyBuckets({ ...baseOpts(), basis: 48 });
    const b52 = monthlyBuckets({ ...baseOpts(), basis: 52 });
    expect(b52[0].budgeted).toEqual(b48[0].budgeted);
  });

  // Regression: line chart used to fold uncategorized rows into `actual`,
  // which meant unconfirmed transfer pairs (no _is_transfer flag yet) and
  // rows whose category wasn't in cats/savCats/transferCats inflated the
  // spend line. Bar chart's "Spent" stat excludes uncategorized — line chart
  // now matches that behavior, and exposes uncategorized as its own field.
  describe("uncategorized handling matches bar chart", () => {
    const optsWithStrays = () => ({
      transactions: [
        { id: "f1", date: "2026-04-05", amount: -200, category: "Food" },
        // unconfirmed pair — looks like a transfer but isn't flagged or in transferCats
        { id: "p1", date: "2026-04-10", amount: -500, account: "Checking" },
        { id: "p2", date: "2026-04-10", amount:  500, account: "Savings" },
        // category not in cats/savCats/transferCats — user thinks of it as transfer
        { id: "c1", date: "2026-04-12", amount: -600, category: "Credit Card Payment" },
      ],
      exp: [{ n: "Groceries", c: "Food", v: "600", p: "m" }],
      sav: [],
      cats: ["Food"],
      savCats: [],
      transferCats: ["Transfer"],
      incomeCats: [],
      fromIso: "2026-04-01",
      toIso:   "2026-04-30",
      basis: 48,
    });

    it("line chart actual excludes uncategorized (matches bar chart Spent)", () => {
      const opts = optsWithStrays();
      const bar = compareBudgetToActual(opts);
      const buckets = monthlyBuckets(opts);
      expect(bar.expense.totalActual).toBeCloseTo(200, 2);
      expect(buckets).toHaveLength(1);
      expect(buckets[0].actual).toBeCloseTo(200, 2);
    });

    it("uncategorized total is reported on each bucket as its own field", () => {
      const buckets = monthlyBuckets(optsWithStrays());
      // Two stray sources: pair (500 + 500 abs = 1000) + Credit Card Payment (600) = 1600
      expect(buckets[0].uncategorized).toBeCloseTo(1600, 2);
    });

    it("uncategorized is zero when a specific category is picked", () => {
      const buckets = monthlyBuckets({ ...optsWithStrays(), category: "Food" });
      expect(buckets[0].actual).toBeCloseTo(200, 2);
      expect(buckets[0].uncategorized).toBe(0);
    });
  });
});

/* ── Milestone-aware budget selection ────────────────────────────────────── */
describe("pickBudgetForDate", () => {
  const liveExp = [{ n: "Groceries", c: "Food", v: "600", p: "m" }];
  const mA = {
    date: "2024-06-15",
    fullState: { exp: [{ n: "Groceries", c: "Food", v: "400", p: "m" }] },
  };
  const mB = {
    date: "2025-01-01",
    fullState: { exp: [{ n: "Groceries", c: "Food", v: "500", p: "m" }] },
  };
  const itemsOnlyM = { date: "2023-01-01", items: { Groceries: { v: 300, c: "Food" } } };

  it("returns live budget when no milestones supplied", () => {
    expect(pickBudgetForDate(liveExp, [], "2024-07-01")).toBe(liveExp);
    expect(pickBudgetForDate(liveExp, null, "2024-07-01")).toBe(liveExp);
  });

  it("returns live budget when milestones have neither fullState.exp nor items", () => {
    const emptyM = { date: "2023-01-01" };
    expect(pickBudgetForDate(liveExp, [emptyM], "2023-06-01")).toBe(liveExp);
  });

  it("reconstructs a budget from legacy items-only milestones", () => {
    // Legacy items.v is stored as monthly × 12 (i.e. annual-48-paycheck $$)
    // so a 3600 → monthly 300 → weekly ~69 after the live->weekly conversion.
    const r = pickBudgetForDate(liveExp, [itemsOnlyM], "2023-06-01");
    expect(r).not.toBe(liveExp);
    expect(Array.isArray(r)).toBe(true);
    expect(r[0]).toMatchObject({ n: "Groceries", c: "Food", p: "m" });
    // 300 / 12 = 25 → actually wait, item.v was 300 in the fixture, so
    // reconstructed monthly = 300 / 12 = 25. Just assert it's a plausible string.
    expect(r[0].v).toBe("25");
  });

  it("carries forward — latest milestone on or before the date wins", () => {
    const r = pickBudgetForDate(liveExp, [mA, mB], "2024-08-01");
    expect(r).toBe(mA.fullState.exp);
  });

  it("carries forward across a boundary — newer milestone takes over on its date", () => {
    const r = pickBudgetForDate(liveExp, [mA, mB], "2025-01-01");
    expect(r).toBe(mB.fullState.exp);
  });

  it("carries backward — date before earliest uses earliest milestone", () => {
    const r = pickBudgetForDate(liveExp, [mA, mB], "2023-03-01");
    expect(r).toBe(mA.fullState.exp);
  });

  it("mixes fullState and items-only milestones — picks correct one by date", () => {
    // itemsOnlyM date is 2023-01-01, mA is 2024-06-15.
    // For a date between them (2023-06-01), carry-forward selects the
    // items-only milestone (reconstructed), not mA.
    const r = pickBudgetForDate(liveExp, [itemsOnlyM, mA], "2023-06-01");
    expect(r).not.toBe(liveExp);
    expect(r).not.toBe(mA.fullState.exp);
    // And it's the reconstructed shape
    expect(r[0]).toMatchObject({ n: "Groceries", p: "m" });
  });

  it("live overrides milestones for the current month even when a milestone exists", () => {
    // todayIso in April 2026 — any April date should yield live, not the
    // April milestone. This mirrors "what you are actively planning today".
    const mApr = {
      date: "2026-04-06",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "400", p: "m" }] },
    };
    expect(pickBudgetForDate(liveExp, [mApr], "2026-04-01", "2026-04-19")).toBe(liveExp);
    expect(pickBudgetForDate(liveExp, [mApr], "2026-04-30", "2026-04-19")).toBe(liveExp);
  });

  it("live overrides milestones for future months", () => {
    const mApr = {
      date: "2026-04-06",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "400", p: "m" }] },
    };
    expect(pickBudgetForDate(liveExp, [mApr], "2026-05-15", "2026-04-19")).toBe(liveExp);
    expect(pickBudgetForDate(liveExp, [mApr], "2027-01-15", "2026-04-19")).toBe(liveExp);
  });

  it("past months still use their nearest milestone even when live override is active", () => {
    const mApr = {
      date: "2026-04-06",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "400", p: "m" }] },
    };
    // March 2026 → earlier than the April milestone but the only one eligible,
    // so it's carried backward. Must NOT return live.
    const r = pickBudgetForDate(liveExp, [mApr], "2026-03-15", "2026-04-19");
    expect(r).toBe(mApr.fullState.exp);
    expect(r).not.toBe(liveExp);
  });
});

describe("monthlyBuckets with milestones", () => {
  it("uses different budgets for months before vs. after a milestone boundary", () => {
    const liveExp = [{ n: "Groceries", c: "Food", v: "700", p: "m" }]; // $175/wk live
    const mOld = {
      date: "2024-03-01",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "400", p: "m" }] }, // $100/wk
    };
    const buckets = monthlyBuckets({
      transactions: [],
      exp: liveExp,
      cats: ["Food"],
      fromIso: "2024-01-01",
      toIso: "2024-04-30",
      basis: 48,
      milestones: [mOld],
    });
    // Jan + Feb 2024 predate mOld → carry it backward. Mar + Apr 2024 on/
    // after mOld → carry forward. Either way, mOld is the only eligible
    // milestone so every month uses its $100/wk budget = $400/mo monthly.
    const mMonthly = 100 * 48 / 12; // = 400
    const liveMonthly = 175 * 48 / 12; // = 700
    expect(buckets[0].budgeted).toBeCloseTo(mMonthly, 2);
    expect(buckets[0].budgeted).not.toBeCloseTo(liveMonthly, 2);
  });

  it("transitions mid-range: months before milestone use old budget, after use new", () => {
    const liveExp = [{ n: "Groceries", c: "Food", v: "700", p: "m" }]; // live = $175/wk
    const mOld = {
      date: "2024-01-01",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "400", p: "m" }] }, // $100/wk → $400/mo
    };
    const mNew = {
      date: "2024-03-01",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "800", p: "m" }] }, // $200/wk → $800/mo
    };
    const buckets = monthlyBuckets({
      transactions: [],
      exp: liveExp,
      cats: ["Food"],
      fromIso: "2024-01-01",
      toIso: "2024-04-30",
      basis: 48,
      milestones: [mOld, mNew],
    });
    // Jan + Feb use mOld ($400/mo), March + April use mNew ($800/mo).
    // Flat monthly figures — no day-count scaling.
    expect(buckets[0].budgeted).toBeCloseTo(400, 2);  // Jan
    expect(buckets[1].budgeted).toBeCloseTo(400, 2);  // Feb
    expect(buckets[2].budgeted).toBeCloseTo(800, 2);  // Mar
    expect(buckets[3].budgeted).toBeCloseTo(800, 2);  // Apr
  });

  it("live-override: current and future months use live; past months use milestones", () => {
    // Live: Groceries $700/mo ($175/wk). Milestone Apr 2026: $400/mo ($100/wk).
    // todayIso set to April 2026.
    const liveExp = [{ n: "Groceries", c: "Food", v: "700", p: "m" }];
    const mApr = {
      date: "2026-04-06",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "400", p: "m" }] },
    };
    const buckets = monthlyBuckets({
      transactions: [],
      exp: liveExp,
      cats: ["Food"],
      fromIso: "2026-02-01",
      toIso: "2026-06-30",
      milestones: [mApr],
      todayIso: "2026-04-19",
    });
    // Feb, Mar → past → milestone carry-backward → $400/mo
    expect(buckets[0].budgeted).toBeCloseTo(400, 2); // Feb
    expect(buckets[1].budgeted).toBeCloseTo(400, 2); // Mar
    // Apr (current), May, Jun (future) → live → $700/mo
    expect(buckets[2].budgeted).toBeCloseTo(700, 2); // Apr
    expect(buckets[3].budgeted).toBeCloseTo(700, 2); // May
    expect(buckets[4].budgeted).toBeCloseTo(700, 2); // Jun
  });

  it("narrows milestone-resolved budget to `cats` scope (regression)", () => {
    // Bug: when the caller narrows `cats` to, say, ["Housing"], past buckets
    // pull budgets from milestones via pickBudgetForDate. The resolved
    // milestone exp contains every category it ever had — so summing without
    // re-narrowing would return the whole milestone total, not the Housing
    // slice. Fix: the per-bucket sum honors `cats` as a filter.
    const liveExp = [
      { n: "Mortgage", c: "Housing", v: "1000", p: "m" }, // live Housing $1000
    ];
    const mMulti = {
      date: "2024-06-01",
      fullState: {
        exp: [
          { n: "Mortgage", c: "Housing",    v: "800", p: "m" }, // $800 Housing
          { n: "Groceries", c: "Food",      v: "500", p: "m" }, // $500 Food
          { n: "Gas",       c: "Auto",      v: "200", p: "m" }, // $200 Auto
        ],
      },
    };
    const buckets = monthlyBuckets({
      transactions: [],
      exp: liveExp,
      cats: ["Housing"],
      fromIso: "2024-07-01",
      toIso: "2024-08-31",
      milestones: [mMulti],
      todayIso: "2026-04-19", // so both months are "past" and use milestone
    });
    // Each past month should show ONLY Housing from the milestone ($800/mo),
    // not the full milestone total ($1500/mo).
    for (const b of buckets) expect(b.budgeted).toBeCloseTo(800, 2);
  });
});

describe("compareBudgetToActual with milestones", () => {
  it("splits a range spanning a milestone boundary and sums proportionally", () => {
    // Live budget $175/wk (Groceries $600/mo + Gas $100/mo from baseOpts).
    // Milestone on 2026-04-15 with Groceries doubled to $1200/mo, Gas removed.
    // Range: Apr 1 → Apr 30 (30 days).
    //   Era 1: Apr 1–14 (14 days) uses original (live = milestone absent before).
    //          Wait — carry-backward means Apr 1–14 uses the milestone! That's
    //          a deliberate part of the contract: no milestone before means
    //          carry the first one backward.
    //   So actually: Apr 1–14 (14 days) uses the 2026-04-15 milestone carried
    //   backward, and Apr 15–30 (16 days) uses the same milestone. Both eras
    //   use the same budget. Test with a live budget + one milestone starting
    //   mid-range: since the milestone is the only one, it applies throughout.
    const m = {
      date: "2026-04-15",
      fullState: {
        exp: [
          { n: "Groceries",  c: "Food", v: "1200", p: "m" }, // $300/wk (up from $150)
        ],
      },
    };
    const optsNoMs = {
      cats: ["Food", "Auto"],
      savCats: ["Emergency"],
      transferCats: ["Transfer"],
      exp: [
        { n: "Groceries", c: "Food", v: "600", p: "m" }, // $150/wk
        { n: "Gas",       c: "Auto", v: "100", p: "m" }, // $25/wk
      ],
      sav: [{ n: "Emergency Fund", c: "Emergency", v: "400", p: "m" }],
      transactions: [],
      fromIso: "2026-04-01",
      toIso:   "2026-04-30",
      todayIso: "2026-07-01", // push "today" past the range so milestone picking drives the answer
      basis: 48,
    };
    const rLive = compareBudgetToActual(optsNoMs);
    const rMs = compareBudgetToActual({ ...optsNoMs, milestones: [m] });

    // With milestone (carry-backward): entire 30-day period uses $300/wk Food,
    // no Gas. So rMs.expense Food budget ≈ 300 × (30/7) × (48/52), Gas gone.
    const expectedFoodMs = 300 * (30 / 7) * (48 / 52);
    const foodRowMs = rMs.expense.rows.find(r => r.category === "Food");
    expect(foodRowMs?.budgeted).toBeCloseTo(expectedFoodMs, 1);
    // Without milestone, Food budget is the live $150/wk scaled.
    const expectedFoodLive = 150 * (30 / 7) * (48 / 52);
    const foodRowLive = rLive.expense.rows.find(r => r.category === "Food");
    expect(foodRowLive?.budgeted).toBeCloseTo(expectedFoodLive, 1);
    // And the values are genuinely different (not accidentally the same).
    expect(foodRowMs.budgeted).not.toBeCloseTo(foodRowLive.budgeted, 1);
  });

  it("splits properly across an era boundary inside the range", () => {
    // Two milestones: one on fromIso, one mid-range. 30-day range, milestone-B
    // lands on day 16. Era 1 = days 1–15 (15 days) under m A; Era 2 = days
    // 16–30 (15 days) under m B.
    const mA = {
      date: "2026-04-01",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "600", p: "m" }] },   // $150/wk
    };
    const mB = {
      date: "2026-04-16",
      fullState: { exp: [{ n: "Groceries", c: "Food", v: "1200", p: "m" }] },  // $300/wk
    };
    const r = compareBudgetToActual({
      cats: ["Food"],
      savCats: [],
      exp: [{ n: "Groceries", c: "Food", v: "800", p: "m" }], // live (irrelevant — milestones cover the whole range)
      sav: [],
      transactions: [],
      fromIso: "2026-04-01",
      toIso:   "2026-04-30",
      todayIso: "2026-07-01", // push "today" past the range so era-splitting drives the answer
      basis: 48,
      milestones: [mA, mB],
    });
    const expected =
      150 * (15 / 7) * (48 / 52) +  // era A: 15 days at $150/wk
      300 * (15 / 7) * (48 / 52);   // era B: 15 days at $300/wk
    const food = r.expense.rows.find(x => x.category === "Food");
    expect(food?.budgeted).toBeCloseTo(expected, 1);
  });

  it("no milestones → matches pre-milestone behavior exactly", () => {
    const opts = {
      cats: ["Food"],
      savCats: [],
      exp: [{ n: "Groceries", c: "Food", v: "600", p: "m" }],
      sav: [],
      transactions: [],
      fromIso: "2026-04-01",
      toIso:   "2026-04-30",
      todayIso: "2026-04-15",
      basis: 48,
    };
    const r1 = compareBudgetToActual(opts);
    const r2 = compareBudgetToActual({ ...opts, milestones: [] });
    expect(r2.expense.rows[0].budgeted).toBeCloseTo(r1.expense.rows[0].budgeted, 2);
  });
});

/* ── Legacy shape reconstruction ────────────────────────────────────────── */
describe("reconstructFromItems", () => {
  it("returns empty arrays for null/undefined/empty input", () => {
    expect(reconstructFromItems(null)).toEqual({ exp: [], sav: [] });
    expect(reconstructFromItems(undefined)).toEqual({ exp: [], sav: [] });
    expect(reconstructFromItems({})).toEqual({ exp: [], sav: [] });
  });

  it("converts expense items (v / 12 → monthly) with p='m'", () => {
    // v = 3600 annual → 300 monthly
    const { exp } = reconstructFromItems({ Gas: { c: "Auto", t: "N", v: 3600 } });
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ n: "Gas", c: "Auto", t: "N", v: "300", p: "m" });
  });

  it("routes t='S' items to sav, others to exp", () => {
    const { exp, sav } = reconstructFromItems({
      Gas: { c: "Auto", t: "N", v: 3600 },
      Emergency: { c: "Savings", t: "S", v: 6000 },
      Dining: { c: "Food", t: "D", v: 2400 },
    });
    expect(exp.map(x => x.n).sort()).toEqual(["Dining", "Gas"]);
    expect(sav.map(x => x.n)).toEqual(["Emergency"]);
    expect(sav[0]).toMatchObject({ v: "500", p: "m" }); // 6000 / 12
  });

  it("defaults missing category to 'General' and missing type to 'N'", () => {
    const { exp } = reconstructFromItems({ Mystery: { v: 1200 } });
    expect(exp[0]).toMatchObject({ c: "General", t: "N", v: "100" });
  });
});

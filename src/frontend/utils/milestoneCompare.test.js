import { describe, it, expect } from "vitest";
import {
  compareMilestones,
  milestoneAsCompareInput,
  liveAsCompareInput,
  periodValue,
} from "./milestoneCompare.js";

/* Helpers — build minimal compare inputs for the math tests. The test only
   cares about the fields the diff function touches, so we skip the labels
   and dates unless a specific test exercises them. */
const exp = (n, c, t, v, p = "m") => ({ n, c, t, v, p });
const sav = (n, c, v, p = "m") => ({ n, c, v, p });

const input = (overrides = {}) => ({
  label: "X",
  date: "2026-01-01",
  exp: [],
  sav: [],
  income: { cSalary: 0, kSalary: 0, cEaipPct: 0, kEaipPct: 0, p1Name: "P1", p2Name: "P2" },
  aggregates: { netW: 0, expW: 0, savW: 0, remW: 0, savRate: 0 },
  ...overrides,
});

describe("compareMilestones — items diff", () => {
  it("returns empty items when both sides have no line items", () => {
    const r = compareMilestones(input(), input());
    expect(r.items.rows).toEqual([]);
  });

  it("flags an item present on A but missing from B as removed", () => {
    const a = input({ exp: [exp("Groceries", "Food", "N", 600)] });
    const b = input({ exp: [] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0]).toMatchObject({
      name: "Groceries",
      section: "N",
      status: "removed",
      aAnnual: 7200,  // 600/mo × 12 = 7200
      bAnnual: 0,
      delta: -7200,
    });
  });

  it("flags an item present on B but missing from A as added", () => {
    const a = input({ exp: [] });
    const b = input({ exp: [exp("Pet Insurance", "Pets", "D", 50)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0]).toMatchObject({
      name: "Pet Insurance",
      section: "D",
      status: "added",
      aAnnual: 0,
      bAnnual: 600,
      delta: 600,
    });
  });

  it("flags an item with same annual on both sides as unchanged", () => {
    const a = input({ exp: [exp("Rent", "Housing", "N", 2000)] });
    const b = input({ exp: [exp("Rent", "Housing", "N", 2000)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].status).toBe("unchanged");
    expect(r.items.rows[0].delta).toBe(0);
  });

  it("flags an item with different annual as changed", () => {
    const a = input({ exp: [exp("Rent", "Housing", "N", 2000)] });
    const b = input({ exp: [exp("Rent", "Housing", "N", 2300)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows[0]).toMatchObject({ status: "changed", aAnnual: 24000, bAnnual: 27600, delta: 3600 });
  });

  it("matches case-insensitively and trims whitespace", () => {
    const a = input({ exp: [exp("  Groceries  ", "Food", "N", 500)] });
    const b = input({ exp: [exp("groceries", "Food", "N", 600)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].status).toBe("changed");
  });

  it("does NOT match across sections — a moved item shows as remove+add", () => {
    // Groceries was Necessity on A, Discretionary on B. We treat that as
    // a rename: the row in section N is gone, a new row in section D arrived.
    const a = input({ exp: [exp("Groceries", "Food", "N", 600)] });
    const b = input({ exp: [exp("Groceries", "Food", "D", 600)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(2);
    expect(r.items.rows.find(x => x.section === "N").status).toBe("removed");
    expect(r.items.rows.find(x => x.section === "D").status).toBe("added");
  });

  it("does NOT cross-match expense and savings — same name in both is added+removed", () => {
    const a = input({ exp: [exp("Buffer", "Other", "D", 100)] });
    const b = input({ sav: [sav("Buffer", "Other", 100)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(2);
    expect(r.items.rows.find(x => x.section === "D").status).toBe("removed");
    expect(r.items.rows.find(x => x.section === "S").status).toBe("added");
  });

  it("handles duplicate names within the same section by matching in array order", () => {
    // Two "Misc" rows in necessities on both sides. They pair 1↔1, 2↔2.
    const a = input({ exp: [
      exp("Misc", "General", "N", 100),
      exp("Misc", "General", "N", 200),
    ]});
    const b = input({ exp: [
      exp("Misc", "General", "N", 150),
      exp("Misc", "General", "N", 200),
    ]});
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(2);
    // First Misc: 100 → 150 (changed)
    expect(r.items.rows[0]).toMatchObject({ aAnnual: 1200, bAnnual: 1800, status: "changed" });
    // Second Misc: 200 → 200 (unchanged)
    expect(r.items.rows[1]).toMatchObject({ aAnnual: 2400, bAnnual: 2400, status: "unchanged" });
  });

  it("preserves A's section order, with B-only rows appended at the end of each section", () => {
    const a = input({
      exp: [exp("AlphaN", "X", "N", 100), exp("AlphaD", "X", "D", 50)],
    });
    const b = input({
      exp: [
        exp("AlphaN", "X", "N", 100),
        exp("BravoN", "X", "N", 75),      // added
        exp("AlphaD", "X", "D", 50),
        exp("BravoD", "X", "D", 25),      // added
      ],
    });
    const r = compareMilestones(a, b);
    // Order: N (Alpha kept, Bravo added), then D (Alpha kept, Bravo added).
    expect(r.items.rows.map(x => x.name)).toEqual(["AlphaN", "BravoN", "AlphaD", "BravoD"]);
    expect(r.items.rows.find(x => x.name === "BravoN").status).toBe("added");
    expect(r.items.rows.find(x => x.name === "BravoD").status).toBe("added");
  });

  it("handles period conversion correctly (weekly vs monthly vs yearly)", () => {
    // Same annual amount, different declared periods → unchanged.
    const a = input({ exp: [exp("Phone", "Util", "N", 100, "m")] });   // $100/mo × 12 = 1200
    const b = input({ exp: [exp("Phone", "Util", "N", 1200, "y")] });  // $1200/yr     = 1200
    const r = compareMilestones(a, b);
    expect(r.items.rows[0].status).toBe("unchanged");
  });

  it("handles savings items via section S", () => {
    const a = input({ sav: [sav("Emergency", "Emergency", 200)] });
    const b = input({ sav: [sav("Emergency", "Emergency", 300)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0]).toMatchObject({ section: "S", status: "changed", aAnnual: 2400, bAnnual: 3600 });
  });

  it("treats sub-cent differences as unchanged (float tolerance)", () => {
    // 33.333333/mo on both sides should round to 33.33 annual ≈ 399.99 ≈ identical.
    const a = input({ exp: [exp("X", "C", "N", 33.333333)] });
    const b = input({ exp: [exp("X", "C", "N", 33.333334)] });
    const r = compareMilestones(a, b);
    expect(r.items.rows[0].status).toBe("unchanged");
  });
});

describe("compareMilestones — summary", () => {
  it("annualizes weekly aggregates by × 48 and computes deltas", () => {
    const a = input({ aggregates: { netW: 2000, expW: 1500, savW: 300, remW: 200, savRate: 25 } });
    const b = input({ aggregates: { netW: 2100, expW: 1500, savW: 400, remW: 200, savRate: 28.6 } });
    const r = compareMilestones(a, b);
    expect(r.summary.netIncome).toEqual({ a: 96000, b: 100800, delta: 4800 });
    expect(r.summary.totalExpense).toEqual({ a: 72000, b: 72000, delta: 0 });
    expect(r.summary.totalSavings).toEqual({ a: 14400, b: 19200, delta: 4800 });
    expect(r.summary.savRate.delta).toBeCloseTo(3.6, 1);
  });

  it("handles missing aggregates gracefully", () => {
    const r = compareMilestones(input(), input());
    expect(r.summary.netIncome).toEqual({ a: 0, b: 0, delta: 0 });
    expect(r.summary.savRate).toEqual({ a: 0, b: 0, delta: 0 });
  });

  it("handles null inputs without crashing", () => {
    const r = compareMilestones(null, null);
    expect(r.summary.netIncome.delta).toBe(0);
    expect(r.items.rows).toEqual([]);
    expect(r.income).toHaveLength(4);  // always 4 income rows
  });
});

describe("compareMilestones — income", () => {
  it("emits four income rows: two salaries + two bonus %", () => {
    const r = compareMilestones(input(), input());
    expect(r.income).toHaveLength(4);
    expect(r.income[0].kind).toBe("salary");
    expect(r.income[1].kind).toBe("salary");
    expect(r.income[2].kind).toBe("bonus");
    expect(r.income[3].kind).toBe("bonus");
  });

  it("flags salary changes correctly", () => {
    const a = input({ income: { cSalary: 80000, kSalary: 70000, cEaipPct: 0, kEaipPct: 0, p1Name: "Alice", p2Name: "Bob" } });
    const b = input({ income: { cSalary: 90000, kSalary: 70000, cEaipPct: 0, kEaipPct: 0, p1Name: "Alice", p2Name: "Bob" } });
    const r = compareMilestones(a, b);
    expect(r.income[0]).toMatchObject({ name: "Alice salary", aValue: 80000, bValue: 90000, delta: 10000, status: "changed" });
    expect(r.income[1]).toMatchObject({ name: "Bob salary",   aValue: 70000, bValue: 70000, delta: 0,     status: "unchanged" });
  });

  it("flags bonus % changes with isPct=true so the UI can format them correctly", () => {
    const a = input({ income: { cSalary: 0, kSalary: 0, cEaipPct: 10, kEaipPct: 5, p1Name: "P1", p2Name: "P2" } });
    const b = input({ income: { cSalary: 0, kSalary: 0, cEaipPct: 12, kEaipPct: 5, p1Name: "P1", p2Name: "P2" } });
    const r = compareMilestones(a, b);
    const cBonus = r.income.find(x => x.name === "P1 bonus %");
    const kBonus = r.income.find(x => x.name === "P2 bonus %");
    expect(cBonus).toMatchObject({ aValue: 10, bValue: 12, delta: 2, status: "changed", isPct: true });
    expect(kBonus).toMatchObject({ aValue: 5,  bValue: 5,  delta: 0, status: "unchanged", isPct: true });
  });

  it("uses A's name when both sides have one; B's when A is missing", () => {
    const a = input({ income: { cSalary: 0, kSalary: 0, cEaipPct: 0, kEaipPct: 0, p1Name: "Corey", p2Name: "Kelly" } });
    const b = input({ income: { cSalary: 0, kSalary: 0, cEaipPct: 0, kEaipPct: 0, p1Name: "", p2Name: "" } });
    const r = compareMilestones(a, b);
    // A has names — they should win.
    expect(r.income[0].name).toBe("Corey salary");
    expect(r.income[1].name).toBe("Kelly salary");
  });
});

describe("milestoneAsCompareInput", () => {
  const reconstructStub = (items) => {
    // Stub: turns {name: {t, v, c}} into {exp:[], sav:[]} same as the real fn.
    const exp = [], sav = [];
    for (const [name, d] of Object.entries(items || {})) {
      const row = { n: name, c: d.c || "G", t: d.t || "N", v: String(d.v / 12), p: "m" };
      if (d.t === "S") sav.push(row); else exp.push(row);
    }
    return { exp, sav };
  };

  it("returns an empty-shaped input for null milestone", () => {
    const r = milestoneAsCompareInput(null, reconstructStub);
    expect(r.exp).toEqual([]);
    expect(r.sav).toEqual([]);
    expect(r.aggregates.netW).toBe(0);
  });

  it("prefers fullState.exp/sav over legacy items dict", () => {
    const m = {
      label: "test",
      date: "2026-01-01",
      fullState: {
        exp: [{ n: "FromFullState", c: "X", t: "N", v: "100", p: "m" }],
        sav: [],
        cEaip: 5, kEaip: 3,
      },
      items: { "FromItems": { c: "X", t: "N", v: 1200 } },
      cSalary: 80000, kSalary: 70000,
      netW: 2000, expW: 1500, savW: 300, remW: 200, savRate: 25,
      cEaipPct: 10, kEaipPct: 7,
    };
    const r = milestoneAsCompareInput(m, reconstructStub);
    expect(r.exp).toHaveLength(1);
    expect(r.exp[0].n).toBe("FromFullState");
    // cEaipPct on the milestone wins over fullState.cEaip
    expect(r.income.cEaipPct).toBe(10);
    expect(r.income.kEaipPct).toBe(7);
  });

  it("falls back to legacy items dict when fullState.exp/sav missing", () => {
    const m = {
      label: "legacy",
      date: "2020-06-15",
      items: { "OldGroceries": { c: "Food", t: "N", v: 6000 }, "OldSavings": { c: "Emergency", t: "S", v: 2400 } },
      netW: 1500, expW: 1000, savW: 200, remW: 100, savRate: 20,
    };
    const r = milestoneAsCompareInput(m, reconstructStub);
    expect(r.exp.map(x => x.n)).toContain("OldGroceries");
    expect(r.sav.map(x => x.n)).toContain("OldSavings");
  });

  it("derives salaries from cGrossW × 52 when cSalary missing", () => {
    const m = { label: "x", cGrossW: 1500, kGrossW: 1200, netW: 0, expW: 0, savW: 0, remW: 0, savRate: 0 };
    const r = milestoneAsCompareInput(m, reconstructStub);
    expect(r.income.cSalary).toBe(78000);  // 1500 × 52
    expect(r.income.kSalary).toBe(62400);  // 1200 × 52
  });

  it("uses milestone.cEaipPct when present, falls back to fullState.cEaip", () => {
    // Case 1: cEaipPct present on milestone
    const m1 = { cEaipPct: 12, fullState: { cEaip: 99 }, netW: 0, expW: 0, savW: 0, remW: 0, savRate: 0 };
    expect(milestoneAsCompareInput(m1, reconstructStub).income.cEaipPct).toBe(12);
    // Case 2: cEaipPct absent, fullState.cEaip used
    const m2 = { fullState: { cEaip: "7" }, netW: 0, expW: 0, savW: 0, remW: 0, savRate: 0 };
    expect(milestoneAsCompareInput(m2, reconstructStub).income.cEaipPct).toBe(7);
    // Case 3: both absent → 0
    const m3 = { fullState: {}, netW: 0, expW: 0, savW: 0, remW: 0, savRate: 0 };
    expect(milestoneAsCompareInput(m3, reconstructStub).income.cEaipPct).toBe(0);
  });

  it("uses milestone.label as label; date is preserved", () => {
    const m = { label: "Q4 2025", date: "2025-12-31", netW: 0, expW: 0, savW: 0, remW: 0, savRate: 0 };
    const r = milestoneAsCompareInput(m, reconstructStub);
    expect(r.label).toBe("Q4 2025");
    expect(r.date).toBe("2025-12-31");
  });
});

describe("liveAsCompareInput", () => {
  it("packages live state with label='Current'", () => {
    const r = liveAsCompareInput({
      exp: [{ n: "X", c: "Y", t: "N", v: "100", p: "m" }],
      sav: [],
      cSal: 80000, kSal: 70000, cEaip: 10, kEaip: 5,
      p1Name: "Corey", p2Name: "Kelly",
      netW: 2000, tExpW: 1500, tSavW: 300, remW: 200, savRate: 25,
    });
    expect(r.label).toBe("Current");
    expect(r.exp).toHaveLength(1);
    expect(r.income.cSalary).toBe(80000);
    expect(r.income.cEaipPct).toBe(10);
    expect(r.aggregates.netW).toBe(2000);
    expect(r.aggregates.expW).toBe(1500);  // mapped from tExpW
    expect(r.aggregates.savW).toBe(300);   // mapped from tSavW
  });

  it("handles missing inputs gracefully", () => {
    const r = liveAsCompareInput();
    expect(r.exp).toEqual([]);
    expect(r.sav).toEqual([]);
    expect(r.aggregates.netW).toBe(0);
    expect(r.income.p1Name).toBe("Person 1");
  });

  it("uses evalF for bonus % so string inputs work too", () => {
    const r = liveAsCompareInput({ cEaip: "12.5", kEaip: "0" });
    expect(r.income.cEaipPct).toBe(12.5);
    expect(r.income.kEaipPct).toBe(0);
  });
});

describe("periodValue", () => {
  // Item period stored as monthly $100. Weekly equivalent = 100 × 12 / 48 = 25.
  const item = { n: "X", c: "Y", t: "N", v: "100", p: "m" };

  it("returns weekly value for w", () => { expect(periodValue(item, "w")).toBe(25); });
  it("returns monthly value for m (round-trips back to 100)", () => { expect(periodValue(item, "m")).toBe(100); });
  it("returns 48-paycheck annual for y48", () => { expect(periodValue(item, "y48")).toBe(1200); });
  it("returns 52-week calendar annual for y52", () => { expect(periodValue(item, "y52")).toBe(1300); });
  it("returns 0 for null item", () => { expect(periodValue(null, "m")).toBe(0); });
});

describe("compareMilestones — end-to-end shape", () => {
  it("returns the labels from inputs at top level for UI consumption", () => {
    const a = input({ label: "Last Year" });
    const b = input({ label: "Current" });
    const r = compareMilestones(a, b);
    expect(r.aLabel).toBe("Last Year");
    expect(r.bLabel).toBe("Current");
  });

  it("returns full structure including summary, items, income, labels", () => {
    const r = compareMilestones(input(), input());
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("items.rows");
    expect(r).toHaveProperty("income");
    expect(r).toHaveProperty("aLabel");
    expect(r).toHaveProperty("bLabel");
  });
});

describe("compareMilestones — id-first matching (stable IDs)", () => {
  const expWithId = (id, n, c, t, v, p = "m") => ({ id, n, c, t, v, p });
  const savWithId = (id, n, c, v, p = "m") => ({ id, n, c, v, p });

  it("matches items with the same id across renames, showing as 'changed' not add+remove", () => {
    // Same id, different name → would have been add+remove under name matching;
    // now should be a single "changed" row.
    const a = input({ exp: [expWithId("i_groc", "Groceries", "Food", "N", "100", "w")] });
    const b = input({ exp: [expWithId("i_groc", "Groceries+Household", "Food", "N", "100", "w")] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].status).toBe("unchanged"); // value didn't change
    expect(r.items.rows[0].matchedBy).toBe("id");
    expect(r.items.rows[0].name).toBe("Groceries+Household"); // post-rename name shown
  });

  it("rename + value change → 'changed' with id match", () => {
    const a = input({ exp: [expWithId("i_x", "Netflix", "Ent", "D", "15", "m")] });
    const b = input({ exp: [expWithId("i_x", "Streaming", "Ent", "D", "20", "m")] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].status).toBe("changed");
    expect(r.items.rows[0].matchedBy).toBe("id");
    expect(r.items.rows[0].name).toBe("Streaming");
  });

  it("falls back to name matching when only one side has ids", () => {
    // Old milestone (no ids) compared against current (has ids).
    const a = input({ exp: [exp("Netflix", "Ent", "D", "15", "m")] });
    const b = input({ exp: [expWithId("i_x", "Netflix", "Ent", "D", "20", "m")] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].status).toBe("changed");
    expect(r.items.rows[0].matchedBy).toBe("name");
  });

  it("falls back to name matching when both sides lack ids (legacy data)", () => {
    const a = input({ exp: [exp("Netflix", "Ent", "D", "15", "m")] });
    const b = input({ exp: [exp("Netflix", "Ent", "D", "20", "m")] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].status).toBe("changed");
    expect(r.items.rows[0].matchedBy).toBe("name");
  });

  it("id mismatch with same name → still matches by name when no id-pair exists", () => {
    // A has "i_a" + "Netflix"; B has "i_b" + "Netflix". Neither id is on
    // both sides, so pass-1 fails. Pass-2 name match succeeds.
    const a = input({ exp: [expWithId("i_a", "Netflix", "Ent", "D", "15", "m")] });
    const b = input({ exp: [expWithId("i_b", "Netflix", "Ent", "D", "15", "m")] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].matchedBy).toBe("name");
    expect(r.items.rows[0].status).toBe("unchanged");
  });

  it("id-paired item that also has same-name counterpart on the other side: id wins, name-twin is added/removed", () => {
    // A: [Netflix id=a]
    // B: [Netflix id=b, Netflix id=a]
    // Pass 1: A's i_a matches B's i_a (the 2nd row). Pass 2: nothing left
    // unmatched on A side, so B's i_b "Netflix" surfaces as "added".
    const a = input({ exp: [expWithId("i_a", "Netflix", "Ent", "D", "15", "m")] });
    const b = input({ exp: [
      expWithId("i_b", "Netflix", "Ent", "D", "20", "m"),
      expWithId("i_a", "Netflix", "Ent", "D", "15", "m"),
    ] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(2);
    const matched = r.items.rows.find(row => row.matchedBy === "id");
    expect(matched).toBeTruthy();
    expect(matched.status).toBe("unchanged");
    const added = r.items.rows.find(row => row.status === "added");
    expect(added).toBeTruthy();
    expect(added.bItem.id).toBe("i_b");
  });

  it("id matching respects section boundaries: same id in N and D doesn't cross", () => {
    // Pathological but worth pinning: if some bug ever wrote the same id
    // into items of different types, matching shouldn't cross sections.
    const a = input({ exp: [expWithId("i_x", "Groceries", "Food", "N", "100", "w")] });
    const b = input({ exp: [expWithId("i_x", "Dining", "Food", "D", "100", "w")] });
    const r = compareMilestones(a, b);
    // A's N item is "removed" (no id-match in N), B's D item is "added".
    expect(r.items.rows).toHaveLength(2);
    const removed = r.items.rows.find(row => row.status === "removed");
    const added = r.items.rows.find(row => row.status === "added");
    expect(removed).toBeTruthy();
    expect(added).toBeTruthy();
  });

  it("savings items match by id too", () => {
    const a = input({ sav: [savWithId("i_ef", "Emergency Fund", "Sav", "200", "m")] });
    const b = input({ sav: [savWithId("i_ef", "Emergency Reserve", "Sav", "250", "m")] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(1);
    expect(r.items.rows[0].matchedBy).toBe("id");
    expect(r.items.rows[0].section).toBe("S");
    expect(r.items.rows[0].status).toBe("changed");
    expect(r.items.rows[0].name).toBe("Emergency Reserve");
  });

  it("two items with same name but distinct ids → both treated as id-distinct", () => {
    // A has two "Subscription" items with different ids (legitimate dupes).
    // B has them too, paired by id. All four match correctly.
    const a = input({ exp: [
      expWithId("i_1", "Subscription", "Tech", "D", "10", "m"),
      expWithId("i_2", "Subscription", "Tech", "D", "20", "m"),
    ] });
    const b = input({ exp: [
      expWithId("i_2", "Subscription", "Tech", "D", "25", "m"),
      expWithId("i_1", "Subscription", "Tech", "D", "10", "m"),
    ] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(2);
    expect(r.items.rows.every(row => row.matchedBy === "id")).toBe(true);
    // The i_1 pair is unchanged, i_2 went 20→25.
    const m1 = r.items.rows.find(row => row.aItem?.id === "i_1");
    const m2 = r.items.rows.find(row => row.aItem?.id === "i_2");
    expect(m1.status).toBe("unchanged");
    expect(m2.status).toBe("changed");
  });

  it("matchedBy: null on added and removed rows", () => {
    const a = input({ exp: [expWithId("i_only_a", "OnlyA", "X", "N", "10", "m")] });
    const b = input({ exp: [expWithId("i_only_b", "OnlyB", "X", "N", "20", "m")] });
    const r = compareMilestones(a, b);
    expect(r.items.rows).toHaveLength(2);
    expect(r.items.rows.every(row => row.matchedBy === null)).toBe(true);
  });
});

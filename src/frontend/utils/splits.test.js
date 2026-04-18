import { describe, it, expect } from "vitest";
import {
  newSplit, newSplitId, seedSplits,
  hasSplits, sumSplits, splitRemainder,
  validateSplits, autoBalance, scaleSplits,
  effectiveCategories, matchesCategory, categoryContribution,
  sanitizeSplits, roundCents,
} from "./splits.js";

const parentTx = (amount = -200, category = "General") => ({
  id: "p1", amount, category, description: "TARGET", account: "Visa",
});

describe("roundCents", () => {
  it("rounds to two decimal places", () => {
    expect(roundCents(1.234)).toBe(1.23);
    expect(roundCents(1.235)).toBe(1.24);
    expect(roundCents(-1.005)).toBeCloseTo(-1.00, 2); // banker edge — fine either way
  });
});

describe("newSplit defaults", () => {
  it("generates an id and numeric amount", () => {
    const sp = newSplit({ category: "Groceries", amount: 50 });
    expect(sp.id).toBeTruthy();
    expect(sp.category).toBe("Groceries");
    expect(sp.amount).toBe(50);
  });
  it("preserves explicit empty-string amount for editor UX", () => {
    const sp = newSplit({ amount: "" });
    expect(sp.amount).toBe("");
  });
  it("parses string numbers", () => {
    expect(newSplit({ amount: "12.34" }).amount).toBe(12.34);
  });
});

describe("hasSplits", () => {
  it("returns false for no splits / empty array", () => {
    expect(hasSplits({})).toBe(false);
    expect(hasSplits({ splits: [] })).toBe(false);
    expect(hasSplits({ splits: null })).toBe(false);
  });
  it("returns true for a populated splits array", () => {
    expect(hasSplits({ splits: [newSplit({ category: "A", amount: 1 })] })).toBe(true);
  });
});

describe("sumSplits + splitRemainder", () => {
  it("sums across multiple rows, rounded to cents", () => {
    const s = [newSplit({ amount: 10 }), newSplit({ amount: 20.1 }), newSplit({ amount: 0.05 })];
    expect(sumSplits(s)).toBe(30.15);
  });
  it("handles negative parent / splits", () => {
    const s = [newSplit({ amount: -120 }), newSplit({ amount: -80 })];
    expect(sumSplits(s)).toBe(-200);
  });
  it("remainder is parent - sum", () => {
    const s = [newSplit({ amount: 50 }), newSplit({ amount: 30 })];
    expect(splitRemainder(100, s)).toBe(20);
    expect(splitRemainder(80, s)).toBe(0);
  });
  it("empty array sums to zero", () => {
    expect(sumSplits([])).toBe(0);
  });
});

describe("validateSplits", () => {
  it("passes for balanced splits", () => {
    const s = [newSplit({ category: "Groceries", amount: -120 }), newSplit({ category: "Household", amount: -80 })];
    const { valid, errors } = validateSplits(s, -200);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });
  it("fails when empty", () => {
    const { valid, errors } = validateSplits([], -200);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/at least one/i);
  });
  it("fails when sum doesn't match", () => {
    const s = [newSplit({ category: "A", amount: -100 }), newSplit({ category: "B", amount: -50 })];
    const { valid, errors } = validateSplits(s, -200);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/sum/i);
  });
  it("fails on a missing category", () => {
    const s = [newSplit({ category: "", amount: -100 }), newSplit({ category: "B", amount: -100 })];
    const { valid, errors } = validateSplits(s, -200);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/category/i);
  });
  it("fails on a zero-amount split", () => {
    const s = [newSplit({ category: "A", amount: 0 }), newSplit({ category: "B", amount: -200 })];
    const { valid, errors } = validateSplits(s, -200);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/non-zero/i);
  });
  it("fails on mixed signs", () => {
    const s = [newSplit({ category: "A", amount: -300 }), newSplit({ category: "B", amount: 100 })];
    const { valid, errors } = validateSplits(s, -200);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/sign/i);
  });
  it("tolerates sub-cent float drift", () => {
    // 1/3 × 3 floats don't perfectly sum — the tolerance should absorb this
    const parent = 100;
    const third = roundCents(100 / 3);
    const s = [
      newSplit({ category: "A", amount: third }),
      newSplit({ category: "B", amount: third }),
      newSplit({ category: "C", amount: roundCents(parent - third * 2) }),
    ];
    const { valid } = validateSplits(s, parent);
    expect(valid).toBe(true);
  });
});

describe("autoBalance", () => {
  it("sets the last split to make the sum match", () => {
    const s = [
      newSplit({ category: "A", amount: -120 }),
      newSplit({ category: "B", amount: 0 }),
    ];
    const out = autoBalance(s, -200);
    expect(out[1].amount).toBe(-80);
    expect(sumSplits(out)).toBe(-200);
  });
  it("handles a single row — balance = full parent", () => {
    const s = [newSplit({ category: "A", amount: 0 })];
    const out = autoBalance(s, -50);
    expect(out[0].amount).toBe(-50);
  });
  it("no-op on empty array", () => {
    expect(autoBalance([], -200)).toEqual([]);
  });
});

describe("scaleSplits", () => {
  it("scales proportionally to a new parent amount", () => {
    const s = [
      newSplit({ category: "A", amount: -120 }),
      newSplit({ category: "B", amount: -80 }),
    ];
    const out = scaleSplits(s, -200, -100);
    expect(out[0].amount).toBe(-60);
    expect(out[1].amount).toBe(-40);
    expect(sumSplits(out)).toBe(-100);
  });
  it("preserves exact invariant by pushing drift onto largest split", () => {
    // 3-way split of 100 → scaled to 99.99 would drift by 0.005 × 3 per split
    const s = [
      newSplit({ category: "A", amount: 33.33 }),
      newSplit({ category: "B", amount: 33.33 }),
      newSplit({ category: "C", amount: 33.34 }),
    ];
    const out = scaleSplits(s, 100, 99.99);
    expect(sumSplits(out)).toBe(99.99);
  });
  it("distributes evenly when old parent was zero", () => {
    const s = [newSplit({ category: "A", amount: 0 }), newSplit({ category: "B", amount: 0 })];
    const out = scaleSplits(s, 0, 50);
    expect(sumSplits(out)).toBe(50);
    expect(out.length).toBe(2);
  });
  it("preserves categories and notes", () => {
    const s = [newSplit({ category: "A", amount: -100, notes: "hi" })];
    const out = scaleSplits(s, -100, -200);
    expect(out[0].category).toBe("A");
    expect(out[0].notes).toBe("hi");
  });
});

describe("seedSplits", () => {
  it("creates two rows: parent category full amount + empty row", () => {
    const out = seedSplits(parentTx(-200, "General"));
    expect(out.length).toBe(2);
    expect(out[0].category).toBe("General");
    expect(out[0].amount).toBe(-200);
    expect(out[1].category).toBe("");
    expect(out[1].amount).toBe(0);
  });
});

describe("effectiveCategories / matchesCategory", () => {
  it("single category for unsplit rows", () => {
    const tx = parentTx(-100, "Groceries");
    expect([...effectiveCategories(tx)]).toEqual(["Groceries"]);
    expect(matchesCategory(tx, "Groceries")).toBe(true);
    expect(matchesCategory(tx, "Dining")).toBe(false);
  });
  it("collects across splits", () => {
    const tx = {
      ...parentTx(-200, "Target"),
      splits: [
        newSplit({ category: "Groceries", amount: -120 }),
        newSplit({ category: "Household", amount: -80 }),
      ],
    };
    const cats = effectiveCategories(tx);
    expect(cats.has("Groceries")).toBe(true);
    expect(cats.has("Household")).toBe(true);
    expect(cats.has("Target")).toBe(false); // parent category ignored when splits present
    expect(matchesCategory(tx, "Groceries")).toBe(true);
    expect(matchesCategory(tx, "Target")).toBe(false);
  });
  it("empty set for uncategorized unsplit rows", () => {
    expect([...effectiveCategories({ amount: -10 })]).toEqual([]);
    expect(matchesCategory({ amount: -10 }, "X")).toBe(false);
  });
});

describe("categoryContribution", () => {
  it("single-entry map for unsplit rows", () => {
    const tx = parentTx(-100, "Dining");
    const m = categoryContribution(tx);
    expect(m.size).toBe(1);
    expect(m.get("Dining")).toBe(-100);
  });
  it("sums per category across splits", () => {
    const tx = {
      ...parentTx(-200, "Target"),
      splits: [
        newSplit({ category: "Groceries", amount: -80 }),
        newSplit({ category: "Household", amount: -50 }),
        newSplit({ category: "Groceries", amount: -70 }), // same cat twice
      ],
    };
    const m = categoryContribution(tx);
    expect(m.size).toBe(2);
    expect(m.get("Groceries")).toBe(-150);
    expect(m.get("Household")).toBe(-50);
  });
  it("empty for uncategorized unsplit", () => {
    expect(categoryContribution({ amount: -10 }).size).toBe(0);
  });
});

describe("sanitizeSplits", () => {
  it("strips empty-category / zero-amount rows", () => {
    const s = [
      newSplit({ category: "A", amount: -100 }),
      newSplit({ category: "", amount: -50 }),
      newSplit({ category: "B", amount: 0 }),
      newSplit({ category: "C", amount: -100 }),
    ];
    const cleaned = sanitizeSplits(s);
    expect(cleaned.length).toBe(2);
    expect(cleaned.map(x => x.category)).toEqual(["A", "C"]);
  });
  it("returns null if nothing remains", () => {
    expect(sanitizeSplits([])).toBe(null);
    expect(sanitizeSplits([newSplit({ category: "", amount: 0 })])).toBe(null);
  });
  it("trims category strings", () => {
    const cleaned = sanitizeSplits([newSplit({ category: "  Groceries  ", amount: -10 })]);
    expect(cleaned[0].category).toBe("Groceries");
  });
  it("assigns stable ids", () => {
    const cleaned = sanitizeSplits([{ category: "A", amount: -10 }]);
    expect(cleaned[0].id).toBeTruthy();
  });
});

describe("Round-trip — split sum invariant", () => {
  it("holds across seed → balance → scale cycles", () => {
    const tx = parentTx(-200, "General");
    let s = seedSplits(tx);
    // User edits row 1 to have a real category and amount
    s[0] = { ...s[0], category: "Groceries", amount: -120 };
    s[1] = { ...s[1], category: "Household", amount: 0 };
    s = autoBalance(s, -200);
    expect(validateSplits(s, -200).valid).toBe(true);
    // Parent amount changes — scale
    s = scaleSplits(s, -200, -250);
    expect(validateSplits(s, -250).valid).toBe(true);
  });
});

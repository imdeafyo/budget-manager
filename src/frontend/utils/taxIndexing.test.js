import { describe, it, expect } from "vitest";
import { indexFactor, indexBrackets, indexStdDed, indexTaxRow, projectStdDed } from "./taxIndexing.js";
import { calcFed } from "./calc.js";
import { TAX_DB } from "../data/taxDB.js";

/* Shape mirrors TAX_DB: [min, max, rate] tuples, contiguous, open top at
   the 9999999 sentinel. */
const BR = [
  [0, 24800, 0.10],
  [24800, 100800, 0.12],
  [100800, 211400, 0.22],
  [211400, 9999999, 0.24],
];

describe("indexFactor", () => {
  it("is 1 for a zero rate (freeze)", () => {
    expect(indexFactor(0, 30)).toBe(1);
  });
  it("is 1 for the base year and for past years", () => {
    expect(indexFactor(2.5, 0)).toBe(1);
    expect(indexFactor(2.5, -5)).toBe(1);
  });
  it("is 1 for a non-numeric rate rather than NaN", () => {
    expect(indexFactor(undefined, 10)).toBe(1);
    expect(indexFactor("abc", 10)).toBe(1);
  });
  it("compounds", () => {
    expect(indexFactor(2.5, 2)).toBeCloseTo(1.050625, 9);
  });
});

describe("indexBrackets", () => {
  it("returns the same array reference when indexing is a no-op", () => {
    expect(indexBrackets(BR, 0, 30)).toBe(BR);
    expect(indexBrackets(BR, 2.5, 0)).toBe(BR);
  });

  it("does not mutate the input", () => {
    const copy = JSON.parse(JSON.stringify(BR));
    indexBrackets(BR, 2.5, 10);
    expect(BR).toEqual(copy);
  });

  it("keeps rates untouched", () => {
    const out = indexBrackets(BR, 2.5, 10);
    expect(out.map(b => b[2])).toEqual(BR.map(b => b[2]));
  });

  it("keeps the leading boundary at zero", () => {
    expect(indexBrackets(BR, 2.5, 10)[0][0]).toBe(0);
  });

  it("leaves the open-ended top sentinel alone", () => {
    const out = indexBrackets(BR, 2.5, 30);
    expect(out[out.length - 1][1]).toBe(9999999);
  });

  it("preserves contiguity — no gaps or overlaps at any seam", () => {
    for (const yrs of [1, 7, 13, 30]) {
      const out = indexBrackets(BR, 2.7, yrs);
      for (let i = 1; i < out.length; i++) {
        expect(out[i][0]).toBe(out[i - 1][1]);
      }
    }
  });

  it("moves thresholds upward and rounds to the nearest $25", () => {
    const out = indexBrackets(BR, 2.5, 1);
    // 24800 * 1.025 ≈ 25420, snapped to the nearest $25 grid.
    expect(out[0][1]).toBeGreaterThan(24800);
    expect(Math.abs(out[0][1] - 25420)).toBeLessThanOrEqual(25);
    for (const b of out) {
      if (b[1] < 9999999) expect(b[1] % 25).toBe(0);
    }
  });
});

describe("indexStdDed", () => {
  it("is a no-op at a zero rate or zero years", () => {
    expect(indexStdDed(32200, 0, 30)).toBe(32200);
    expect(indexStdDed(32200, 2.5, 0)).toBe(32200);
  });
  it("rounds to the nearest $50", () => {
    const out = indexStdDed(32200, 2.5, 1);
    expect(out % 50).toBe(0);
    expect(out).toBe(33000); // 33005 -> nearest 50
  });
  it("grows monotonically with the horizon", () => {
    const a = indexStdDed(32200, 2.5, 5);
    const b = indexStdDed(32200, 2.5, 10);
    expect(b).toBeGreaterThan(a);
  });
});

describe("indexTaxRow", () => {
  const row = TAX_DB["2026"];

  it("returns the original row object when indexing is a no-op", () => {
    expect(indexTaxRow(row, 0, 30)).toBe(row);
    expect(indexTaxRow(row, 2.5, 0)).toBe(row);
  });

  it("does not mutate TAX_DB", () => {
    const before = JSON.parse(JSON.stringify(row));
    indexTaxRow(row, 2.5, 30);
    expect(TAX_DB["2026"]).toEqual(before);
  });

  it("indexes the standard deduction and federal brackets", () => {
    const out = indexTaxRow(row, 2.5, 10);
    expect(out.stdMFJ).toBeGreaterThan(row.stdMFJ);
    expect(out.fedMFJ[0][1]).toBeGreaterThan(row.fedMFJ[0][1]);
  });

  it("leaves the SS wage cap alone — it indexes to wage growth, not CPI", () => {
    const out = indexTaxRow(row, 2.5, 10);
    expect(out.ssCap).toBe(row.ssCap);
    expect(out.ssRate).toBe(row.ssRate);
    expect(out.medRate).toBe(row.medRate);
  });

  it("survives a row with missing fields", () => {
    const sparse = { stdMFJ: 1000 };
    const out = indexTaxRow(sparse, 2.5, 10);
    expect(out.stdMFJ).toBeGreaterThan(1000);
    expect(out.fedMFJ).toBeUndefined();
  });

  it("handles a null row", () => {
    expect(indexTaxRow(null, 2.5, 10)).toBe(null);
  });
});

describe("bracket creep — the bug this fixes", () => {
  const row = TAX_DB["2026"];
  const YEARS = 30;
  const RATE = 2.5;

  /* Income inflating at the same rate as the tax system should face a
     roughly CONSTANT effective rate. Frozen brackets instead push it into
     higher brackets it would never actually reach. */
  it("keeps the effective rate stable when income and brackets inflate together", () => {
    const income0 = 200000;
    const std0 = row.stdMFJ;
    const rate0 = calcFed(Math.max(0, income0 - std0), row.fedMFJ) / income0;

    const grown = income0 * Math.pow(1 + RATE / 100, YEARS);
    const indexed = indexTaxRow(row, RATE, YEARS);
    const rateIndexed =
      calcFed(Math.max(0, grown - indexed.stdMFJ), indexed.fedMFJ) / grown;

    expect(Math.abs(rateIndexed - rate0)).toBeLessThan(0.002);
  });

  it("frozen brackets overstate tax on the same inflated income", () => {
    const income0 = 200000;
    const grown = income0 * Math.pow(1 + RATE / 100, YEARS);

    const frozenTax = calcFed(Math.max(0, grown - row.stdMFJ), row.fedMFJ);
    const indexed = indexTaxRow(row, RATE, YEARS);
    const indexedTax = calcFed(Math.max(0, grown - indexed.stdMFJ), indexed.fedMFJ);

    expect(frozenTax).toBeGreaterThan(indexedTax);
    // The gap is material, not a rounding artifact.
    expect(frozenTax - indexedTax).toBeGreaterThan(1000);
  });

  it("a zero rate reproduces today's frozen behavior exactly", () => {
    const grown = 200000 * Math.pow(1 + RATE / 100, YEARS);
    const frozen = indexTaxRow(row, 0, YEARS);
    expect(calcFed(Math.max(0, grown - frozen.stdMFJ), frozen.fedMFJ)).toBe(
      calcFed(Math.max(0, grown - row.stdMFJ), row.fedMFJ)
    );
  });
});

describe("projectStdDed — precedence", () => {
  it("uses a real published value and does not project", () => {
    const out = projectStdDed(32200, { year: 2026, baseYear: 2024, baseValue: 29200, pct: 2.5 });
    expect(out.amount).toBe(32200);
    expect(out.projected).toBe(false);
  });

  it("a user-imported value wins over any projection", () => {
    // Deliberately far from what projection would produce.
    const out = projectStdDed(50000, { year: 2030, baseYear: 2026, baseValue: 32200, pct: 2.5 });
    expect(out.amount).toBe(50000);
    expect(out.projected).toBe(false);
  });

  it("projects only when no real value exists", () => {
    const out = projectStdDed(undefined, { year: 2030, baseYear: 2026, baseValue: 32200, pct: 2.5 });
    expect(out.projected).toBe(true);
    expect(out.amount).toBeGreaterThan(32200);
    expect(out.fromYear).toBe(2026);
  });

  it("treats zero and null as missing, not as a real value of zero", () => {
    expect(projectStdDed(0, { year: 2030, baseYear: 2026, baseValue: 32200, pct: 2.5 }).projected).toBe(true);
    expect(projectStdDed(null, { year: 2030, baseYear: 2026, baseValue: 32200, pct: 2.5 }).projected).toBe(true);
  });

  it("does not project backwards", () => {
    const out = projectStdDed(undefined, { year: 2020, baseYear: 2026, baseValue: 32200, pct: 2.5 });
    expect(out.amount).toBe(32200);
    expect(out.projected).toBe(false);
  });

  it("is a no-op at a zero rate even for future years", () => {
    const out = projectStdDed(undefined, { year: 2040, baseYear: 2026, baseValue: 32200, pct: 0 });
    expect(out.amount).toBe(32200);
  });

  it("returns zero rather than NaN with no usable base", () => {
    expect(projectStdDed(undefined, { year: 2030, baseYear: 2026, pct: 2.5 }).amount).toBe(0);
  });

  it("compounds across the gap", () => {
    const near = projectStdDed(undefined, { year: 2028, baseYear: 2026, baseValue: 32200, pct: 2.5 }).amount;
    const far = projectStdDed(undefined, { year: 2036, baseYear: 2026, baseValue: 32200, pct: 2.5 }).amount;
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(32200);
  });
});

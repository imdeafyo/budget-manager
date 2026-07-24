import { describe, it, expect } from "vitest";
import {
  saltCap,
  saltPhaseoutThreshold,
  effectiveSaltCap,
  computeItemized,
  resolveDeduction,
} from "./deductions.js";

describe("saltCap — statutory schedule", () => {
  it("is 40400 for 2026", () => {
    expect(saltCap(2026)).toBe(40400);
  });
  it("steps 1% per year through 2029", () => {
    expect(saltCap(2027)).toBe(Math.round(40400 * 1.01));
    expect(saltCap(2028)).toBe(Math.round(40400 * 1.01 * 1.01));
    expect(saltCap(2029)).toBe(Math.round(40400 * Math.pow(1.01, 3)));
  });
  it("snaps back to 10000 in 2030 and stays there", () => {
    expect(saltCap(2030)).toBe(10000);
    expect(saltCap(2040)).toBe(10000);
  });
  it("2029 -> 2030 is a cliff, not a step", () => {
    expect(saltCap(2029)).toBeGreaterThan(40000);
    expect(saltCap(2030)).toBe(10000);
  });
  it("falls back to the base cap for earlier years and bad input", () => {
    expect(saltCap(2020)).toBe(40400);
    expect(saltCap(undefined)).toBe(40400);
    expect(saltCap("nope")).toBe(40400);
  });
});

describe("saltPhaseoutThreshold", () => {
  it("is 505000 for 2026", () => {
    expect(saltPhaseoutThreshold(2026)).toBe(505000);
  });
  it("steps 1% per year", () => {
    expect(saltPhaseoutThreshold(2027)).toBe(Math.round(505000 * 1.01));
  });
  it("is irrelevant once the cap snaps back", () => {
    expect(saltPhaseoutThreshold(2030)).toBe(Infinity);
  });
});

describe("effectiveSaltCap — MAGI phase-out", () => {
  it("is the full cap below the threshold", () => {
    expect(effectiveSaltCap(2026, 400000)).toBe(40400);
    expect(effectiveSaltCap(2026, 505000)).toBe(40400);
  });
  it("reduces by 30% of MAGI over the threshold", () => {
    // 50k over -> 15k reduction
    expect(effectiveSaltCap(2026, 555000)).toBe(40400 - 15000);
  });
  it("never falls below the 10000 floor", () => {
    expect(effectiveSaltCap(2026, 900000)).toBe(10000);
    expect(effectiveSaltCap(2026, 5000000)).toBe(10000);
  });
  it("is already at the floor after snapback regardless of MAGI", () => {
    expect(effectiveSaltCap(2030, 100000)).toBe(10000);
    expect(effectiveSaltCap(2030, 900000)).toBe(10000);
  });
  it("treats missing MAGI as zero (no phase-out)", () => {
    expect(effectiveSaltCap(2026, undefined)).toBe(40400);
  });
});

describe("computeItemized", () => {
  it("is zero for empty input", () => {
    expect(computeItemized({}, {}).total).toBe(0);
    expect(computeItemized(null, null).total).toBe(0);
  });

  it("caps SALT and reports the disallowed amount", () => {
    const out = computeItemized({ salt: 60000 }, { year: 2026, magi: 200000 });
    expect(out.saltAllowed).toBe(40400);
    expect(out.saltDisallowed).toBe(19600);
    expect(out.total).toBe(40400);
  });

  it("leaves SALT under the cap alone", () => {
    const out = computeItemized({ salt: 12000 }, { year: 2026, magi: 200000 });
    expect(out.saltAllowed).toBe(12000);
    expect(out.saltDisallowed).toBe(0);
  });

  it("does not cap mortgage interest — it sits outside SALT", () => {
    const out = computeItemized(
      { salt: 40400, mortgageInterest: 30000 },
      { year: 2026, magi: 200000 }
    );
    expect(out.total).toBe(70400);
  });

  it("applies the 7.5% AGI floor to medical", () => {
    const out = computeItemized({ medical: 20000 }, { agi: 200000 });
    expect(out.medicalFloor).toBe(15000);
    expect(out.medicalAllowed).toBe(5000);
  });

  it("zeroes medical entirely below the floor", () => {
    const out = computeItemized({ medical: 5000 }, { agi: 200000 });
    expect(out.medicalAllowed).toBe(0);
  });

  it("skips the medical floor when AGI is not supplied", () => {
    const out = computeItemized({ medical: 5000 }, {});
    expect(out.medicalAllowed).toBe(5000);
  });

  it("treats negative entries as zero", () => {
    const out = computeItemized(
      { salt: -100, mortgageInterest: -5, charitable: -1, medical: -1 },
      {}
    );
    expect(out.total).toBe(0);
  });

  it("reflects the 2030 cliff in the total", () => {
    const items = { salt: 40000 };
    const before = computeItemized(items, { year: 2029, magi: 200000 }).total;
    const after = computeItemized(items, { year: 2030, magi: 200000 }).total;
    expect(before).toBe(40000);
    expect(after).toBe(10000);
  });
});

describe("resolveDeduction", () => {
  const STD = 32200;

  it("defaults to standard when nothing is itemized — today's behavior", () => {
    const out = resolveDeduction(STD, {}, {});
    expect(out.amount).toBe(STD);
    expect(out.used).toBe("standard");
  });

  it("auto picks itemized when it wins", () => {
    const out = resolveDeduction(
      STD,
      { salt: 30000, mortgageInterest: 20000 },
      { year: 2026, magi: 200000 }
    );
    expect(out.used).toBe("itemized");
    expect(out.amount).toBe(50000);
  });

  it("auto keeps standard when itemized falls short", () => {
    const out = resolveDeduction(STD, { salt: 12000 }, { year: 2026, magi: 200000 });
    expect(out.used).toBe("standard");
    expect(out.amount).toBe(STD);
  });

  it("auto keeps standard on an exact tie", () => {
    const out = resolveDeduction(STD, { charitable: STD }, {});
    expect(out.used).toBe("standard");
  });

  it("standard mode forces standard even when itemized is larger", () => {
    const out = resolveDeduction(
      STD,
      { salt: 30000, mortgageInterest: 40000 },
      { year: 2026, magi: 200000, mode: "standard" }
    );
    expect(out.used).toBe("standard");
    expect(out.amount).toBe(STD);
    // Still reports what itemized would have been, for the UI.
    expect(out.itemized.total).toBe(70000);
  });

  it("itemized mode forces itemized even when it loses", () => {
    const out = resolveDeduction(STD, { salt: 5000 }, { mode: "itemized" });
    expect(out.used).toBe("itemized");
    expect(out.amount).toBe(5000);
  });

  it("falls back to auto for an unknown mode", () => {
    const out = resolveDeduction(STD, {}, { mode: "banana" });
    expect(out.used).toBe("standard");
  });

  it("handles a missing/invalid standard deduction", () => {
    expect(resolveDeduction(undefined, {}, {}).amount).toBe(0);
    expect(resolveDeduction(-500, {}, {}).amount).toBe(0);
  });

  it("always reports both sides so the UI can show which won", () => {
    const out = resolveDeduction(STD, { salt: 40000 }, { year: 2026, magi: 200000 });
    expect(out.standard).toBe(STD);
    expect(out.itemized.total).toBe(40000);
    expect(out.used).toBe("itemized");
  });
});

describe("mortgage-interest scenario — the motivating case", () => {
  const STD = 32200;
  it("a mortgage can flip a household from standard to itemized", () => {
    const salt = { salt: 15000 };
    const before = resolveDeduction(STD, salt, { year: 2026, magi: 200000 });
    expect(before.used).toBe("standard");

    const after = resolveDeduction(
      STD,
      { ...salt, mortgageInterest: 25000 },
      { year: 2026, magi: 200000 }
    );
    expect(after.used).toBe("itemized");
    expect(after.amount).toBe(40000);
    expect(after.amount).toBeGreaterThan(before.amount);
  });
});

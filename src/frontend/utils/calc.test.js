import { describe, it, expect } from "vitest";
import {
  evalF, resolveFormula, calcMatch, calcFed, getMarg,
  calcStateTax, getStateMarg, toWk, fromWk, recalcMilestonePure,
  forecastGrowth, yearsToTarget
} from "../utils/calc.js";
import { TAX_DB, STATE_BRACKETS } from "../data/taxDB.js";

describe("evalF — formula evaluation", () => {
  it("handles plain numbers", () => {
    expect(evalF(100)).toBe(100);
    expect(evalF("100")).toBe(100);
  });
  it("strips commas and evaluates arithmetic", () => {
    expect(evalF("1,200 + 300")).toBe(1500);
    expect(evalF("100 * 12 / 48")).toBe(25);
  });
  it("returns 0 for empty or invalid input", () => {
    expect(evalF("")).toBe(0);
    expect(evalF("abc")).toBe(0);
  });
});

describe("calcFed — federal bracket tax calculation", () => {
  it("returns 0 for taxable income at or below zero", () => {
    expect(calcFed(0, TAX_DB["2026"].fedMFJ)).toBe(0);
    expect(calcFed(-1000, TAX_DB["2026"].fedMFJ)).toBe(0);
  });
  it("applies 10% bracket correctly on 2026 MFJ", () => {
    // 2026 MFJ: first bracket is [0, 24800, .10]
    expect(calcFed(10000, TAX_DB["2026"].fedMFJ)).toBeCloseTo(1000, 2);
    expect(calcFed(24800, TAX_DB["2026"].fedMFJ)).toBeCloseTo(2480, 2);
  });
  it("crosses into the 12% bracket on 2026 MFJ", () => {
    // 24800 * .10 + (50000 - 24800) * .12 = 2480 + 3024 = 5504
    expect(calcFed(50000, TAX_DB["2026"].fedMFJ)).toBeCloseTo(5504, 2);
  });
  it("handles a 2018 MFJ calculation (post-TCJA brackets)", () => {
    // 2018 MFJ: [0,19050,.10],[19050,77400,.12]
    // 50000: 19050 * .10 + (50000 - 19050) * .12 = 1905 + 3714 = 5619
    expect(calcFed(50000, TAX_DB["2018"].fedMFJ)).toBeCloseTo(5619, 2);
  });
  it("handles a 2000 single calculation (pre-Bush-tax-cut brackets)", () => {
    // 2000 single: first bracket starts at .15 (no 10% bracket before 2002)
    // 20000: 20000 * .15 = 3000
    expect(calcFed(20000, TAX_DB["2000"].fedSingle)).toBeCloseTo(3000, 2);
  });
});

describe("getMarg — marginal rate lookup", () => {
  it("returns the 10% bracket for income in the first band", () => {
    expect(getMarg(5000, TAX_DB["2026"].fedMFJ)).toBe(0.10);
  });
  it("returns the correct bracket at thresholds", () => {
    // 2026 MFJ: [0,24800,.10],[24800,100800,.12]
    expect(getMarg(30000, TAX_DB["2026"].fedMFJ)).toBe(0.12);
    expect(getMarg(150000, TAX_DB["2026"].fedMFJ)).toBe(0.22);
  });
  it("returns top bracket for very high income", () => {
    expect(getMarg(5000000, TAX_DB["2026"].fedMFJ)).toBe(0.37);
  });
});

describe("calcStateTax & getStateMarg", () => {
  it("returns 0 for no-income-tax states", () => {
    expect(calcStateTax(100000, "TX", "single")).toBe(0);
    expect(calcStateTax(100000, "FL", "mfj")).toBe(0);
    expect(getStateMarg(100000, "WA", "single")).toBe(0);
  });
  it("computes Colorado flat tax (4.4%)", () => {
    // CO is flat 4.4% from dollar one
    expect(calcStateTax(100000, "CO", "single")).toBeCloseTo(4400, 0);
  });
  it("uses MFJ brackets when filing is mfj and they exist", () => {
    // NY has different brackets for MFJ vs single
    const single = calcStateTax(80000, "NY", "single");
    const mfj = calcStateTax(80000, "NY", "mfj");
    expect(single).toBeGreaterThan(0);
    expect(mfj).toBeGreaterThan(0);
    // MFJ brackets are wider, so tax should be less or equal for same income
    expect(mfj).toBeLessThanOrEqual(single);
  });
  it("returns 0 for unknown state abbreviation", () => {
    expect(calcStateTax(100000, "ZZ", "single")).toBe(0);
    expect(getStateMarg(100000, "ZZ", "single")).toBe(0);
  });
});

describe("taxDB structural integrity", () => {
  it("has all 31 tax years from 1996 to 2026", () => {
    for (let y = 1996; y <= 2026; y++) {
      expect(TAX_DB[String(y)]).toBeDefined();
      expect(TAX_DB[String(y)].fedSingle.length).toBeGreaterThan(0);
      expect(TAX_DB[String(y)].fedMFJ.length).toBeGreaterThan(0);
      expect(TAX_DB[String(y)].stdSingle).toBeGreaterThan(0);
      expect(TAX_DB[String(y)].stdMFJ).toBeGreaterThan(0);
    }
  });
  it("has every state + DC in STATE_BRACKETS", () => {
    const expected = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
    for (const abbr of expected) {
      expect(STATE_BRACKETS[abbr]).toBeDefined();
    }
  });
});

describe("calcMatch — 401(k) employer tiered match", () => {
  it("computes tiered match correctly for standard two-tier plan", () => {
    // Base 6, tiers: [{upTo:4, rate:1}, {upTo:6, rate:0.5}]
    // Employee contributes 6%: first 4% matched 100% = 4, next 2% matched 50% = 1, total = 5 + base 6 = 11
    const tiers = [{ upTo: 4, rate: 1 }, { upTo: 6, rate: 0.5 }];
    expect(calcMatch(6, tiers, 6)).toBe(11);
  });
  it("caps match at last tier", () => {
    const tiers = [{ upTo: 4, rate: 1 }, { upTo: 6, rate: 0.5 }];
    // Contributing 10% still caps at 6% for match purposes
    expect(calcMatch(10, tiers, 0)).toBe(5); // 4 * 1 + 2 * 0.5
  });
  it("returns base when employee contributes 0%", () => {
    const tiers = [{ upTo: 4, rate: 1 }, { upTo: 6, rate: 0.5 }];
    expect(calcMatch(0, tiers, 3)).toBe(3);
  });
});

describe("toWk / fromWk — period conversion", () => {
  it("converts monthly to weekly (48 paychecks/year)", () => {
    // Monthly * 12 / 48 = Monthly / 4
    expect(toWk(400, "m")).toBeCloseTo(100, 5);
  });
  it("converts yearly to weekly (48 paychecks)", () => {
    expect(toWk(4800, "y")).toBeCloseTo(100, 5);
  });
  it("round-trips monthly values", () => {
    const original = 1234.56;
    const wk = toWk(original, "m");
    expect(fromWk(wk, "m")).toBeCloseTo(original, 5);
  });
  it("round-trips yearly values", () => {
    const original = 50000;
    const wk = toWk(original, "y");
    expect(fromWk(wk, "y")).toBeCloseTo(original, 5);
  });
  it("passes through weekly values", () => {
    expect(toWk(100, "w")).toBe(100);
    expect(fromWk(100, "w")).toBe(100);
  });
});

describe("resolveFormula — formula resolution for blur", () => {
  it("resolves arithmetic to display value", () => {
    expect(resolveFormula("100 + 50")).toBe("150");
    expect(resolveFormula("1,000 * 2")).toBe("2000");
  });
  it("preserves plain strings", () => {
    expect(resolveFormula("100")).toBe("100");
  });
  it("returns 0 for empty", () => {
    expect(resolveFormula("")).toBe("0");
  });
});

/* ══════════════════════════ recalcMilestone regression tests ══════════════════════════
   This is the bug-prone area: a past session discovered recalcMilestone wasn't including
   pre-tax deductions and 401(k) pre-tax contributions in net income, diverging from
   the main C calculation. These tests lock that behavior in. */
describe("recalcMilestonePure — milestone recalculation", () => {
  const ctx = {
    tax: { year: "2026", p1State: { name: "Colorado", abbr: "CO", famli: 0.45 }, p2State: { name: "Colorado", abbr: "CO", famli: 0.45 } },
    allTaxDB: TAX_DB,
    fil: "mfj",
    TAX_DB_FALLBACK: TAX_DB["2026"],
  };

  it("returns zero income for empty milestone", () => {
    const out = recalcMilestonePure({ items: {} }, ctx);
    expect(out.netW).toBe(0);
    expect(out.grossW).toBe(0);
    expect(out.savRate).toBe(0);
  });

  it("computes gross weekly from annual salary", () => {
    const m = { cSalary: 104000, kSalary: 52000, items: {} };
    const out = recalcMilestonePure(m, ctx);
    expect(out.cGrossW).toBeCloseTo(2000, 5); // 104000/52
    expect(out.kGrossW).toBeCloseTo(1000, 5); // 52000/52
    expect(out.grossW).toBeCloseTo(3000, 5);
  });

  it("pre-tax deductions reduce both taxable income AND net pay", () => {
    // Baseline: 100k salary, no deductions
    const baseline = recalcMilestonePure({ cSalary: 100000, kSalary: 0, items: {} }, ctx);
    // Same salary, with $100/wk pre-tax deduction
    const withPreDed = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { preDed: [{ c: "100", k: "0" }] }
    }, ctx);
    // Net should be lower because deduction comes out of pay
    expect(withPreDed.netW).toBeLessThan(baseline.netW);
    // But less lower than $100 — because pre-tax also reduces taxes
    expect(baseline.netW - withPreDed.netW).toBeLessThan(100);
  });

  it("401(k) pre-tax contributions reduce taxable income AND net pay (regression bug)", () => {
    // This is the exact bug the memory notes called out — recalcMilestone was ignoring c4pre
    const noK = recalcMilestonePure({ cSalary: 100000, kSalary: 0, items: {} }, ctx);
    const withK = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { c4pre: "10" } // 10% pre-tax 401k
    }, ctx);
    // Net should be lower by approximately the contribution minus the tax savings
    expect(withK.netW).toBeLessThan(noK.netW);
    // 10% of 100k = 10k/yr = ~192/wk. After tax savings (~22% marg), net drop is ~150/wk.
    const diff = noK.netW - withK.netW;
    expect(diff).toBeGreaterThan(100); // contribution exists
    expect(diff).toBeLessThan(200);    // tax savings lowered the impact
  });

  it("expense items aggregate into weekly expense", () => {
    const m = {
      cSalary: 100000, kSalary: 0,
      items: {
        a: { t: "N", v: 4800 },  // $4800/yr necessary
        b: { t: "D", v: 2400 },  // $2400/yr discretionary
      }
    };
    const out = recalcMilestonePure(m, ctx);
    // Budget normalizes on 48 paychecks: 4800/48=100, 2400/48=50
    expect(out.necW).toBeCloseTo(100, 5);
    expect(out.disW).toBeCloseTo(50, 5);
    expect(out.expW).toBeCloseTo(150, 5);
  });

  it("savings rate uses (savings + remaining) / net income", () => {
    const m = {
      cSalary: 104000, kSalary: 0,
      items: {
        save: { t: "S", v: 4800 }, // 100/wk savings
      }
    };
    const out = recalcMilestonePure(m, ctx);
    expect(out.savW).toBeCloseTo(100, 5);
    // savRate = (savW + max(0, remW)) / netW * 100
    const expected = (out.savW + Math.max(0, out.remW)) / out.netW * 100;
    expect(out.savRate).toBeCloseTo(expected, 5);
  });

  it("selects tax year from milestone date", () => {
    const m2018 = { date: "2018-06-15", cSalary: 100000, kSalary: 0, items: {} };
    const m2026 = { date: "2026-06-15", cSalary: 100000, kSalary: 0, items: {} };
    const out2018 = recalcMilestonePure(m2018, ctx);
    const out2026 = recalcMilestonePure(m2026, ctx);
    // Standard deduction differs between years → net pay should differ
    expect(out2018.netW).not.toBeCloseTo(out2026.netW, 0);
  });

  it("bonus (cEaipPct) produces expected gross and net", () => {
    const m = {
      cSalary: 100000, kSalary: 0, items: {},
      cEaipPct: 10, kEaipPct: 0,
    };
    const out = recalcMilestonePure(m, ctx);
    expect(out.eaipGross).toBeCloseTo(10000, 2); // 10% of 100k
    expect(out.eaipNet).toBeGreaterThan(0);
    expect(out.eaipNet).toBeLessThan(out.eaipGross); // taxed
  });

  it("round-trips: recalcMilestone(recalcMilestone(x)) produces identical aggregates", () => {
    const m = {
      cSalary: 120000, kSalary: 80000,
      items: { a: { t: "N", v: 12000 }, b: { t: "D", v: 4800 }, c: { t: "S", v: 9600 } },
      fullState: { c4pre: "8", k4pre: "6", preDed: [{ c: "50", k: "25" }] },
      cEaipPct: 8, kEaipPct: 5,
    };
    const first = recalcMilestonePure(m, ctx);
    const second = recalcMilestonePure(first, ctx);
    expect(second.netW).toBeCloseTo(first.netW, 5);
    expect(second.grossW).toBeCloseTo(first.grossW, 5);
    expect(second.savRate).toBeCloseTo(first.savRate, 5);
    expect(second.eaipGross).toBeCloseTo(first.eaipGross, 5);
    expect(second.eaipNet).toBeCloseTo(first.eaipNet, 5);
  });

  it("milestone serialization: JSON round-trip preserves all fields", () => {
    const m = {
      date: "2025-03-15", label: "Q1 2025",
      cSalary: 104000, kSalary: 78000,
      items: { exp1: { t: "N", v: 6000, n: "Rent" } },
      fullState: { c4pre: "10", k4pre: "5" },
      cEaipPct: 8, kEaipPct: 5,
    };
    const calculated = recalcMilestonePure(m, ctx);
    const json = JSON.stringify(calculated);
    const restored = JSON.parse(json);
    const recalculated = recalcMilestonePure(restored, ctx);
    expect(recalculated.netW).toBeCloseTo(calculated.netW, 5);
    expect(recalculated.savRate).toBeCloseTo(calculated.savRate, 5);
    expect(recalculated.date).toBe("2025-03-15");
    expect(recalculated.label).toBe("Q1 2025");
  });
});

describe("forecastGrowth — compound growth", () => {
  it("zero contribution and zero return leaves balance flat", () => {
    const out = forecastGrowth(10000, 0, 0, 0, 5);
    expect(out.length).toBe(6); // year 0..5
    expect(out[0].nominal).toBe(10000);
    expect(out[5].nominal).toBeCloseTo(10000, 2);
  });

  it("$0 initial with $12k/yr at 0% return grows linearly", () => {
    const out = forecastGrowth(0, 12000, 0, 0, 3);
    // 12k contributed per year, 0% return: balance = years * 12000
    expect(out[1].nominal).toBeCloseTo(12000, 0);
    expect(out[3].nominal).toBeCloseTo(36000, 0);
  });

  it("compound growth approximates standard FV formula", () => {
    // $10k initial, 7% return, no contributions, 10 years
    // FV = 10000 * (1.07)^10 ≈ 19672
    const out = forecastGrowth(10000, 0, 7, 0, 10);
    expect(out[10].nominal).toBeCloseTo(19672, -2); // within ~$100
  });

  it("real value is lower than nominal under positive inflation", () => {
    const out = forecastGrowth(10000, 6000, 7, 3, 20);
    expect(out[20].real).toBeLessThan(out[20].nominal);
    // After 20yr at 3% inflation, real ≈ nominal / 1.03^20 ≈ nominal / 1.806
    expect(out[20].real).toBeCloseTo(out[20].nominal / Math.pow(1.03, 20), 0);
  });

  it("real equals nominal when inflation is zero", () => {
    const out = forecastGrowth(10000, 6000, 7, 0, 10);
    expect(out[10].real).toBeCloseTo(out[10].nominal, 5);
  });

  it("contributions field tracks cumulative contributed", () => {
    const out = forecastGrowth(5000, 12000, 7, 3, 5);
    // year 0: just initial balance
    expect(out[0].contributions).toBe(5000);
    // year 5: initial + 5 * 12000 = 65000
    expect(out[5].contributions).toBe(65000);
  });

  it("realContributions equals nominal contributions when inflation is 0", () => {
    const out = forecastGrowth(5000, 12000, 7, 0, 5);
    for (const row of out) {
      expect(row.realContributions).toBeCloseTo(row.contributions, 6);
    }
  });

  it("realContributions deflates each year's contribution to today's dollars", () => {
    // 0% return so we can isolate the deflation arithmetic.
    // 4% inflation. Initial 0, $1000/yr.
    const out = forecastGrowth(0, 1000, 0, 4, 3);
    // year 0: nothing contributed → 0
    expect(out[0].realContributions).toBe(0);
    // year 1: 1000 / 1.04 ≈ 961.54
    expect(out[1].realContributions).toBeCloseTo(1000 / 1.04, 4);
    // year 2: above + 1000 / 1.04² ≈ 961.54 + 924.56 ≈ 1886.09
    expect(out[2].realContributions).toBeCloseTo(1000 / 1.04 + 1000 / Math.pow(1.04, 2), 4);
    // year 3: cumulative 3-year deflated sum
    const expected = 1000 / 1.04 + 1000 / Math.pow(1.04, 2) + 1000 / Math.pow(1.04, 3);
    expect(out[3].realContributions).toBeCloseTo(expected, 4);
  });

  it("real return survives the realContributions comparison at 6%/4%", () => {
    // The motivating bug: at 6% return / 4% inflation, real balance was below
    // nominal contributions, falsely implying a loss. Real-vs-real should
    // show modest positive growth (real return ≈ 1.92%).
    const out = forecastGrowth(50000, 30000, 6, 4, 30);
    const last = out[30];
    expect(last.real).toBeGreaterThan(last.realContributions);
    // Sanity: real growth should be positive but modest (not 4×).
    const realGrowth = last.real - last.realContributions;
    expect(realGrowth).toBeGreaterThan(0);
    expect(realGrowth).toBeLessThan(last.realContributions); // less than doubling
  });
});

describe("yearsToTarget — time-to-goal calculator", () => {
  it("returns 0 when balance already exceeds target", () => {
    expect(yearsToTarget(100000, 0, 7, 50000)).toBe(0);
  });
  it("returns null when target is unreachable", () => {
    // 0 return, 0 contribution, target above balance: never reached
    expect(yearsToTarget(10000, 0, 0, 100000)).toBe(null);
  });
  it("computes time to reach target with pure contributions (no growth)", () => {
    // $0 initial, $12k/yr, 0% return, target $60k → ~5 years
    const t = yearsToTarget(0, 12000, 0, 60000);
    expect(t).toBeCloseTo(5, 1);
  });
  it("compounding reduces time to target", () => {
    const noGrowth = yearsToTarget(0, 12000, 0, 100000);
    const withGrowth = yearsToTarget(0, 12000, 7, 100000);
    expect(withGrowth).toBeLessThan(noGrowth);
  });
});

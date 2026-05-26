import { describe, it, expect } from "vitest";
import {
  evalF, resolveFormula, calcMatch, calcFed, getMarg,
  calcStateTax, getStateMarg, toWk, fromWk, recalcMilestonePure,
  forecastGrowth, yearsToTarget,
  forecastGrowthAccounts, yearsToHitPoolLimit,
  cashBudgetContribution, poolHeadroom,
  fmtCompact
} from "../utils/calc.js";
import { TAX_DB, STATE_BRACKETS, getPoolLimit, ACCOUNT_TYPE_TO_POOL, IRA_LIMITS, HSA_LIMITS_SELF, CATCHUP_401K } from "../data/taxDB.js";

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

  it("Traditional IRA reduces taxable income AND net pay (regression — bug where IRA changes did nothing)", () => {
    // The bug: updating cIraTrad on the Income tab did not flow into recalcMilestonePure
    // because the function ignored fs.cIraTrad. Trad IRA should behave parallel to HSA /
    // 401(k) pre-tax: subtract from taxable income AND from net pay.
    const baseline = recalcMilestonePure({ cSalary: 100000, kSalary: 0, items: {} }, ctx);
    const withTrad = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { cIraTrad: "7000" } // $7k/yr Trad IRA contribution
    }, ctx);
    // Net should drop, but less than the full $7000/yr (≈ $134.62/wk) because
    // Trad IRA also reduces taxable income, generating a tax savings.
    expect(withTrad.netW).toBeLessThan(baseline.netW);
    const weeklyContrib = 7000 / 52; // ~134.62
    const diff = baseline.netW - withTrad.netW;
    expect(diff).toBeGreaterThan(weeklyContrib * 0.6); // most of contribution lands
    expect(diff).toBeLessThan(weeklyContrib);          // but tax savings shrink it
  });

  it("Roth IRA reduces net pay but NOT taxable income (post-tax savings)", () => {
    const baseline = recalcMilestonePure({ cSalary: 100000, kSalary: 0, items: {} }, ctx);
    const withRoth = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { cIraRoth: "7000" } // $7k/yr Roth IRA contribution
    }, ctx);
    // Roth IRA: net drops by ~exactly $7000/yr (no tax break, since taxable
    // wasn't reduced). Federal taxes should be unchanged because taxable
    // income is the same.
    expect(withRoth.netW).toBeLessThan(baseline.netW);
    const weeklyContrib = 7000 / 52; // ~134.62
    const diff = baseline.netW - withRoth.netW;
    // Should be very close to the full contribution since Roth doesn't reduce taxes.
    expect(diff).toBeCloseTo(weeklyContrib, 1);
  });

  it("Trad and Roth IRA combined behave additively", () => {
    // Sanity: setting both shouldn't double-count, and total net drop should
    // match the sum of their individual effects within rounding tolerance.
    const baseline = recalcMilestonePure({ cSalary: 100000, kSalary: 0, items: {} }, ctx);
    const both = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { cIraTrad: "7000", cIraRoth: "7000" }
    }, ctx);
    const onlyTrad = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { cIraTrad: "7000" }
    }, ctx);
    const onlyRoth = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { cIraRoth: "7000" }
    }, ctx);
    const combinedDiff = baseline.netW - both.netW;
    const sumOfSingles = (baseline.netW - onlyTrad.netW) + (baseline.netW - onlyRoth.netW);
    expect(combinedDiff).toBeCloseTo(sumOfSingles, 2);
  });

  it("IRA fields default to 0 on legacy milestones (no fullState IRA fields)", () => {
    // Backward-compat: milestones saved before the IRA feature shouldn't crash
    // or behave differently — fs.cIraTrad === undefined should be treated as 0.
    const legacy = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { c4pre: "5" } // realistic legacy fullState without IRA fields
    }, ctx);
    const explicit = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { c4pre: "5", cIraTrad: "0", cIraRoth: "0", kIraTrad: "0", kIraRoth: "0" }
    }, ctx);
    expect(legacy.netW).toBeCloseTo(explicit.netW, 5);
  });

  it("IRA contributions are NOT subject to FICA reduction (parallel to non-payroll reality)", () => {
    // IRAs aren't payroll-deducted, so SS + Medicare apply to full salary
    // regardless of IRA contribution. We can verify by computing the expected
    // FICA on full salary and confirming it doesn't drop when Trad IRA is added.
    const baseline = recalcMilestonePure({ cSalary: 100000, kSalary: 0, items: {} }, ctx);
    const withTrad = recalcMilestonePure({
      cSalary: 100000, kSalary: 0, items: {},
      fullState: { cIraTrad: "7000" }
    }, ctx);
    // Quick check: gross is unchanged
    expect(withTrad.cGrossW).toBeCloseTo(baseline.cGrossW, 5);
    // The tax savings from Trad IRA should be roughly the marginal rate × contribution,
    // not the full FICA + income tax rate. At 100k MFJ + CO, marginal is ~12% fed +
    // ~4.4% state = ~16.4%. So $7000 contribution should save ~$1148/yr in tax,
    // leaving ~$5852/yr (~$112.5/wk) of net reduction. FICA savings would have
    // bumped tax-saved by another ~7.65%, so confirming the saving stays modest
    // proves we're NOT touching FICA.
    const netDrop = baseline.netW - withTrad.netW;
    const weekly = 7000 / 52;
    const taxSavings = weekly - netDrop;
    // Tax savings should be smaller than what we'd see if FICA were also reduced
    // (which would add ~7.65% of $7000 ≈ $535/yr ≈ $10.3/wk extra).
    expect(taxSavings).toBeLessThan(weekly * 0.30); // generous upper bound on marginal
    expect(taxSavings).toBeGreaterThan(weekly * 0.05); // at least some tax break exists
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

  it("savings rate uses (savings + remaining + retirement) / net income — no floor on remaining", () => {
    const m = {
      cSalary: 104000, kSalary: 0,
      items: {
        save: { t: "S", v: 4800 }, // 100/wk savings
      }
    };
    const out = recalcMilestonePure(m, ctx);
    expect(out.savW).toBeCloseTo(100, 5);
    // Post-fix: savRate = (savW + remW + retirementW) / netW * 100
    // With no 401(k) or IRA configured, retirementW is 0, so this collapses to
    // the simpler "all leftover net is savings" form for a single-earner $104k
    // milestone with $100/wk earmarked savings.
    const expected = (out.savW + out.remW + (out.retirementW || 0)) / out.netW * 100;
    expect(out.savRate).toBeCloseTo(expected, 5);
  });

  it("savRate drops (not floors) when expenses exceed net income", () => {
    // Overspending milestone: $50k single-earner, $80k of expenses booked.
    // Pre-fix: savRate floored remW at 0 so the rate was just savW/netW —
    // identical to an on-budget version of the same milestone. That hid the
    // overspend on the displayed history. Post-fix the rate should drop
    // below the savings-only rate because rW is negative and counts against.
    const onBudget = recalcMilestonePure({
      cSalary: 50000, kSalary: 0,
      items: { save: { t: "S", v: 2400 } }, // $50/wk savings
    }, ctx);
    const overspent = recalcMilestonePure({
      cSalary: 50000, kSalary: 0,
      items: {
        save: { t: "S", v: 2400 },
        rent: { t: "N", v: 80000 }, // huge expense, swamps net
      }
    }, ctx);
    expect(overspent.remW).toBeLessThan(0);
    // The overspent milestone's savings rate must be lower than the on-budget
    // one, because the negative remW now drags it down instead of being floored.
    expect(overspent.savRate).toBeLessThan(onBudget.savRate);
  });

  it("savRate includes 401(k) and IRA contributions in numerator", () => {
    // Without retirement: a household saving $5k/yr via budget tab on $100k.
    const noRetire = recalcMilestonePure({
      cSalary: 100000, kSalary: 0,
      items: { save: { t: "S", v: 5000 } },
    }, ctx);
    // Same household, but also putting 10% into 401(k) pre-tax.
    // C.net drops because 10% was diverted, but the savings rate should
    // be HIGHER because that 10% is real savings.
    const withRetire = recalcMilestonePure({
      cSalary: 100000, kSalary: 0,
      items: { save: { t: "S", v: 5000 } },
      fullState: { c4pre: "10", c4ro: "0", k4pre: "0", k4ro: "0" },
    }, ctx);
    expect(withRetire.retirementW).toBeGreaterThan(0);
    // Sanity: ~10% of 100k / 52 wk ≈ $192/wk
    expect(withRetire.retirementW).toBeCloseTo(100000 * 0.10 / 52, 1);
    expect(withRetire.savRate).toBeGreaterThan(noRetire.savRate);
  });

  it("savRate includes Roth IRA (the specific gap user flagged)", () => {
    // The flag was that "Total Savings + Remaining + Bonus" was missing
    // Roth IRA. The milestone-level mirror of that is savRate. This pins
    // the new behavior: adding a $7k/yr Roth IRA should raise savRate.
    const baseline = recalcMilestonePure({
      cSalary: 100000, kSalary: 0,
      items: { save: { t: "S", v: 0 } },
    }, ctx);
    const withRoth = recalcMilestonePure({
      cSalary: 100000, kSalary: 0,
      items: { save: { t: "S", v: 0 } },
      fullState: { cIraRoth: "7000" },
    }, ctx);
    // Roth IRA contribution surfaces in retirementW…
    expect(withRoth.retirementW).toBeCloseTo(7000 / 52, 3);
    // …and lifts the savings rate (it had been invisible pre-fix).
    expect(withRoth.savRate).toBeGreaterThan(baseline.savRate);
  });

  it("savRate counts both Trad and Roth IRA for both partners", () => {
    const baseline = recalcMilestonePure({ cSalary: 100000, kSalary: 80000, items: {} }, ctx);
    const all = recalcMilestonePure({
      cSalary: 100000, kSalary: 80000, items: {},
      fullState: { cIraTrad: "3500", cIraRoth: "3500", kIraTrad: "3500", kIraRoth: "3500" },
    }, ctx);
    // 4 × $3500 / 52 = ~$269/wk
    expect(all.retirementW).toBeCloseTo(14000 / 52, 3);
    expect(all.savRate).toBeGreaterThan(baseline.savRate);
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

  it("contributionGrowthPct defaults to 0 (back-compat with old callers)", () => {
    const a = forecastGrowth(10000, 12000, 7, 3, 10);
    const b = forecastGrowth(10000, 12000, 7, 3, 10, 0);
    expect(a[10].nominal).toBeCloseTo(b[10].nominal, 6);
    expect(a[10].contributions).toBeCloseTo(b[10].contributions, 6);
    expect(a[10].realContributions).toBeCloseTo(b[10].realContributions, 6);
  });

  it("contributionGrowthPct scales each year's contribution by (1+g)^(y-1)", () => {
    // 0% return so totals are pure contributions. 0% inflation so real == nominal.
    // Initial 0, base 1000/yr, 10% growth → year 1: 1000, year 2: 1100, year 3: 1210.
    // Cumulative at year 3: 1000 + 1100 + 1210 = 3310.
    const out = forecastGrowth(0, 1000, 0, 0, 3, 10);
    expect(out[1].contributions).toBeCloseTo(1000, 4);
    expect(out[2].contributions).toBeCloseTo(2100, 4);
    expect(out[3].contributions).toBeCloseTo(3310, 4);
    // Same for realContributions when inflation is 0.
    expect(out[3].realContributions).toBeCloseTo(3310, 4);
  });

  it("contributionGrowth at inflation rate keeps each year's deflated contribution roughly constant", () => {
    // 3% growth + 3% inflation: each year's contribution in today's dollars
    // is roughly constant. realContributions accumulates deflated contributions
    // (year-y contribution deflated by (1+i)^y), so total ≈ years × base.
    // Note: this is NOT the same as `real` ending balance — a 0% return means
    // dormant principal loses value to inflation each year, so `real` runs
    // below `realContributions`. The "flat real contribution" property lives
    // in the realContributions accumulation, not the balance.
    const out = forecastGrowth(0, 10000, 0, 3, 20, 3);
    // 20 years × ~$9,709 per year (in today's $) ≈ $194k
    expect(out[20].realContributions).toBeGreaterThan(190000);
    expect(out[20].realContributions).toBeLessThan(200000);
  });

  it("higher contribution growth yields higher real ending balance", () => {
    const noGrowth = forecastGrowth(50000, 30000, 6, 4, 30, 0);
    const matchInfl = forecastGrowth(50000, 30000, 6, 4, 30, 3);
    const realRaises = forecastGrowth(50000, 30000, 6, 4, 30, 5);
    expect(matchInfl[30].real).toBeGreaterThan(noGrowth[30].real);
    expect(realRaises[30].real).toBeGreaterThan(matchInfl[30].real);
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

/* ── Account-based forecast & pool limit tests ─────────────────────── */

describe("getPoolLimit — pool limit resolution by year/age", () => {
  it("returns 401(k) base limit with no catch-up when age < 50", () => {
    const lim = getPoolLimit("401k_employee", 2026, 35);
    expect(lim).toBe(TAX_DB["2026"].k401Lim);
  });
  it("adds standard catch-up at age 50", () => {
    const lim = getPoolLimit("401k_employee", 2026, 50);
    expect(lim).toBe(TAX_DB["2026"].k401Lim + CATCHUP_401K["2026"].standard);
  });
  it("uses super catch-up at age 60", () => {
    const lim = getPoolLimit("401k_employee", 2026, 60);
    expect(lim).toBe(TAX_DB["2026"].k401Lim + CATCHUP_401K["2026"].super);
  });
  it("uses super catch-up at age 63 (last year of window)", () => {
    const lim = getPoolLimit("401k_employee", 2026, 63);
    expect(lim).toBe(TAX_DB["2026"].k401Lim + CATCHUP_401K["2026"].super);
  });
  it("drops back to standard catch-up at age 64", () => {
    const lim = getPoolLimit("401k_employee", 2026, 64);
    expect(lim).toBe(TAX_DB["2026"].k401Lim + CATCHUP_401K["2026"].standard);
  });
  it("ignores catch-up when age is null", () => {
    const lim = getPoolLimit("401k_employee", 2026, null);
    expect(lim).toBe(TAX_DB["2026"].k401Lim);
  });
  it("returns IRA limit per person + catch-up at 50+", () => {
    expect(getPoolLimit("ira", 2026, 30)).toBe(IRA_LIMITS["2026"].base);
    expect(getPoolLimit("ira", 2026, 50)).toBe(IRA_LIMITS["2026"].base + IRA_LIMITS["2026"].catchup50);
  });
  it("HSA family is the household pool default", () => {
    expect(getPoolLimit("hsa", 2026, 30, "family")).toBe(TAX_DB["2026"].hsaLimit);
  });
  it("HSA self uses self-only limit", () => {
    expect(getPoolLimit("hsa", 2026, 30, "self")).toBe(HSA_LIMITS_SELF["2026"].self);
  });
  it("HSA both-self doubles the self limit", () => {
    expect(getPoolLimit("hsa", 2026, 30, "both-self")).toBe(HSA_LIMITS_SELF["2026"].self * 2);
  });
  it("HSA catch-up applies at age 55+", () => {
    const lim55 = getPoolLimit("hsa", 2026, 55, "family");
    expect(lim55).toBe(TAX_DB["2026"].hsaLimit + HSA_LIMITS_SELF["2026"].catchup55);
  });
  it("returns Infinity for taxable / cash / null pool", () => {
    expect(getPoolLimit(null, 2026, 50)).toBe(Infinity);
    expect(getPoolLimit("nonexistent", 2026, 50)).toBe(Infinity);
  });
  it("future years fall back to most recent known year", () => {
    const futureLimit = getPoolLimit("ira", 2050, 30);
    const knownLimit = getPoolLimit("ira", 2026, 30);
    expect(futureLimit).toBe(knownLimit); // stays at latest known limit
  });
});

describe("ACCOUNT_TYPE_TO_POOL — account type to pool mapping", () => {
  it("maps 401(k) types to 401k_employee", () => {
    expect(ACCOUNT_TYPE_TO_POOL["401k_pretax"]).toBe("401k_employee");
    expect(ACCOUNT_TYPE_TO_POOL["401k_roth"]).toBe("401k_employee");
  });
  it("maps IRA types to ira pool", () => {
    expect(ACCOUNT_TYPE_TO_POOL["ira_traditional"]).toBe("ira");
    expect(ACCOUNT_TYPE_TO_POOL["ira_roth"]).toBe("ira");
  });
  it("hsa maps to hsa pool", () => {
    expect(ACCOUNT_TYPE_TO_POOL["hsa"]).toBe("hsa");
  });
  it("taxable / cash / custom have no pool", () => {
    expect(ACCOUNT_TYPE_TO_POOL["taxable"]).toBeNull();
    expect(ACCOUNT_TYPE_TO_POOL["cash"]).toBeNull();
    expect(ACCOUNT_TYPE_TO_POOL["custom"]).toBeNull();
  });
});

describe("forecastGrowthAccounts — account-based projection", () => {
  const baseOpts = {
    baseYear: 2026,
    inflationPct: 3,
    p1BirthYear: 1985, // 41 in 2026, no catch-up
    p2BirthYear: 1990, // 36 in 2026
    hsaCoverage: "family",
    getPoolLimit,
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
  };

  it("returns empty result for empty accounts list", () => {
    const r = forecastGrowthAccounts([], 10, baseOpts);
    expect(r.years).toEqual([]);
    expect(r.accountSeries).toEqual({});
  });

  it("year-0 row matches starting balances exactly", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 50000, annualReturn: 7, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
      { id: "b", name: "B", owner: "p2", type: "taxable", startBalance: 25000, annualReturn: 7, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 5, baseOpts);
    expect(r.years[0].year).toBe(0);
    expect(r.years[0].totals.nominal).toBe(75000);
    expect(r.years[0].byAccount.a.nominal).toBe(50000);
  });

  it("zero contributions, pure growth — single account compounds correctly", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 10000, annualReturn: 7, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 10, baseOpts);
    // Monthly compounding at 7% annual for 10 years
    const expected = 10000 * Math.pow(Math.pow(1.07, 1/12), 120);
    expect(r.years[10].byAccount.a.nominal).toBeCloseTo(expected, 0);
  });

  it("sum of bucket balances equals total each year (invariant)", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 10000, annualReturn: 5, contribAmount: 1000, annualIncrease: 0, capAtLimit: false },
      { id: "b", name: "B", owner: "p1", type: "401k_pretax", startBalance: 20000, annualReturn: 8, contribAmount: 5000, annualIncrease: 2, capAtLimit: true },
      { id: "c", name: "C", owner: "p2", type: "hsa", startBalance: 5000, annualReturn: 6, contribAmount: 3000, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 10, baseOpts);
    for (const row of r.years) {
      const sum = Object.values(row.byAccount).reduce((s, v) => s + v.nominal, 0);
      expect(row.totals.nominal).toBeCloseTo(sum, 6);
    }
  });

  it("annual increase compounds the contribution year over year", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1000, annualIncrease: 10, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 3, baseOpts);
    // Year 1: 1000, Year 2: 1100, Year 3: 1210; cumulative 3310
    expect(r.years[1].byAccount.a.contribution).toBeCloseTo(1000, 6);
    expect(r.years[2].byAccount.a.contribution).toBeCloseTo(1100, 6);
    expect(r.years[3].byAccount.a.contribution).toBeCloseTo(1210, 6);
    expect(r.accountSeries.a[3].contribCum).toBeCloseTo(3310, 6);
  });

  it("contribCumReal discounts each year's contribution to today's $", () => {
    // 5% inflation, 0% return, $1000/yr flat contribution, 3 years.
    // Nominal cum: 3000. Real cum: 1000/1.05 + 1000/1.05^2 + 1000/1.05^3
    //   = 952.38 + 907.03 + 863.84 = 2723.25
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1000, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 3, { ...baseOpts, inflationPct: 5 });
    expect(r.accountSeries.a[3].contribCum).toBeCloseTo(3000, 6);
    expect(r.accountSeries.a[3].contribCumReal).toBeCloseTo(2723.25, 1);
    expect(r.years[3].byAccount.a.contribCumReal).toBeCloseTo(2723.25, 1);
    // totals.contributionsReal is *per-year* (mirrors totals.contributions),
    // not cumulative. Year 3 sees only that year's real contribution.
    expect(r.years[3].totals.contributionsReal).toBeCloseTo(1000 / Math.pow(1.05, 3), 1);
  });

  it("contribCumReal equals contribCum when inflation is zero", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1000, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 5, { ...baseOpts, inflationPct: 0 });
    expect(r.accountSeries.a[5].contribCumReal).toBeCloseTo(r.accountSeries.a[5].contribCum, 6);
  });

  it("contribCumReal can exceed today's-$ balance on low-return / high-inflation accounts", () => {
    // Pure shape check: a cash account at 0.5% return with 5% inflation
    // produces a today's-$ balance less than today's-$ contributions
    // (real loss). This is the *correct* shape — the old display showed
    // nominal contribCum which was nonsensically large vs real balance.
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 10000, annualReturn: 0.5, contribAmount: 10000, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 30, { ...baseOpts, inflationPct: 5 });
    const last = r.years[30].byAccount.cash;
    // Today's $ contributions are positive and finite
    expect(last.contribCumReal).toBeGreaterThan(0);
    // And in this scenario, real balance is less than real contributions
    // (real return is negative: 0.5% nominal − 5% inflation ≈ −4.5%)
    expect(last.real).toBeLessThan(last.contribCumReal);
    // But still much smaller than the nominal contribCum
    expect(last.contribCumReal).toBeLessThan(last.contribCum);
  });

  it("caps at IRS limit when capAtLimit=true and over the pool", () => {
    // Pre-tax + Roth 401(k) for one person, both with capAtLimit, total way over
    const accounts = [
      { id: "pre", name: "Pre", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 20000, annualIncrease: 0, capAtLimit: true },
      { id: "ro",  name: "Roth", owner: "p1", type: "401k_roth",  startBalance: 0, annualReturn: 0, contribAmount: 20000, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    const total = r.years[1].byAccount.pre.contribution + r.years[1].byAccount.ro.contribution;
    expect(total).toBeCloseTo(TAX_DB["2026"].k401Lim, 6); // capped at 2026 limit
    expect(r.poolWarnings.length).toBeGreaterThan(0);
    expect(r.poolWarnings[0].pool).toBe("401k_employee");
    expect(r.poolWarnings[0].capped).toBeGreaterThan(0);
  });

  it("does not cap when capAtLimit=false even if over the pool limit", () => {
    const accounts = [
      { id: "pre", name: "Pre", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 50000, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    expect(r.years[1].byAccount.pre.contribution).toBeCloseTo(50000, 6);
  });

  it("per-person pools are independent (P1 and P2 each get own 401k limit)", () => {
    const accounts = [
      { id: "p1k", name: "P1 401k", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: TAX_DB["2026"].k401Lim, annualIncrease: 0, capAtLimit: true },
      { id: "p2k", name: "P2 401k", owner: "p2", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: TAX_DB["2026"].k401Lim, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    // Both should be fully honored — neither pool is over individually
    expect(r.years[1].byAccount.p1k.contribution).toBeCloseTo(TAX_DB["2026"].k401Lim, 6);
    expect(r.years[1].byAccount.p2k.contribution).toBeCloseTo(TAX_DB["2026"].k401Lim, 6);
    expect(r.poolWarnings.length).toBe(0);
  });

  it("HSA pool aggregates household accounts under family limit", () => {
    const accounts = [
      { id: "h1", name: "P1 HSA", owner: "p1", type: "hsa", startBalance: 0, annualReturn: 0, contribAmount: 6000, annualIncrease: 0, capAtLimit: true },
      { id: "h2", name: "P2 HSA", owner: "p2", type: "hsa", startBalance: 0, annualReturn: 0, contribAmount: 6000, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    const total = r.years[1].byAccount.h1.contribution + r.years[1].byAccount.h2.contribution;
    expect(total).toBeCloseTo(TAX_DB["2026"].hsaLimit, 6); // family limit, not 12000
  });

  it("custom / taxable accounts have no limit (no warning)", () => {
    const accounts = [
      { id: "tx", name: "Brokerage", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1000000, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    expect(r.years[1].byAccount.tx.contribution).toBeCloseTo(1000000, 6);
    expect(r.poolWarnings.length).toBe(0);
  });

  it("catch-up tier transitions: contribution raised mid-projection at age 50", () => {
    // P1 is 49 in 2026 (born 1977), turns 50 in 2027 → year-1 limit is base, year-2 is base+catchup
    const accounts = [
      { id: "k", name: "401k", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 999999, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 3, { ...baseOpts, p1BirthYear: 1977 });
    // Year 1 (calendarYear 2027, age 50): standard catch-up applies
    expect(r.years[1].byAccount.k.contribution).toBe(getPoolLimit("401k_employee", 2027, 50));
    // Year 2 (2028, age 51): same standard catch-up
    expect(r.years[2].byAccount.k.contribution).toBe(getPoolLimit("401k_employee", 2028, 51));
  });

  it("super catch-up window 60-63 increases limit then drops back at 64", () => {
    // Born 1965: age 61 in 2026 → super, ... age 64 in 2029 → standard
    const accounts = [
      { id: "k", name: "401k", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 999999, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 5, { ...baseOpts, p1BirthYear: 1965 });
    // Year 1 (2027, age 62): super
    expect(r.years[1].byAccount.k.contribution).toBe(getPoolLimit("401k_employee", 2027, 62));
    // Year 3 (2029, age 64): drops to standard — should be lower
    expect(r.years[3].byAccount.k.contribution).toBe(getPoolLimit("401k_employee", 2029, 64));
    expect(r.years[3].byAccount.k.contribution).toBeLessThan(r.years[1].byAccount.k.contribution);
  });

  it("real (inflation-adjusted) values are deflated correctly", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 100000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 10, { ...baseOpts, inflationPct: 3 });
    // 100k flat, deflated by 3% for 10 years
    const expectedReal = 100000 / Math.pow(1.03, 10);
    expect(r.years[10].byAccount.a.real).toBeCloseTo(expectedReal, 0);
  });

  it("mixed capped + uncapped in same pool: uncapped honored, capped scaled", () => {
    // P1 401k pre-tax (capped) + Roth (NOT capped) — uncapped Roth honored,
    // pre-tax scaled to fit remainder
    const limit = TAX_DB["2026"].k401Lim;
    const accounts = [
      { id: "pre", name: "Pre", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 30000, annualIncrease: 0, capAtLimit: true },
      { id: "ro",  name: "Roth", owner: "p1", type: "401k_roth",  startBalance: 0, annualReturn: 0, contribAmount: 10000, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    expect(r.years[1].byAccount.ro.contribution).toBeCloseTo(10000, 6); // honored
    // Pre is scaled so total is at limit. Total = limit ⇒ pre = limit - 10000
    expect(r.years[1].byAccount.pre.contribution).toBeCloseTo(limit - 10000, 6);
  });

  it("fully maxed-out pool: capped accounts get zero when uncapped already exceeds limit", () => {
    const limit = TAX_DB["2026"].k401Lim;
    const accounts = [
      { id: "pre", name: "Pre", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 5000, annualIncrease: 0, capAtLimit: true },
      { id: "ro",  name: "Roth", owner: "p1", type: "401k_roth",  startBalance: 0, annualReturn: 0, contribAmount: limit + 5000, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    expect(r.years[1].byAccount.ro.contribution).toBeCloseTo(limit + 5000, 6); // honored as-is
    expect(r.years[1].byAccount.pre.contribution).toBeCloseTo(0, 6); // no remaining budget
  });
});

describe("yearsToHitPoolLimit — when does ramping contribution hit the cap", () => {
  it("returns 0 if base already at limit", () => {
    expect(yearsToHitPoolLimit(20000, 5, 20000)).toBe(0);
  });
  it("returns null when base is 0", () => {
    expect(yearsToHitPoolLimit(0, 5, 20000)).toBeNull();
  });
  it("returns null when increase is 0 and base below limit", () => {
    expect(yearsToHitPoolLimit(10000, 0, 20000)).toBeNull();
  });
  it("returns null when limit is Infinity (no pool)", () => {
    expect(yearsToHitPoolLimit(10000, 5, Infinity)).toBeNull();
  });
  it("computes the correct year for a ramp", () => {
    // 10000 * 1.10^(y-1) = 20000 → y-1 = log(2)/log(1.10) ≈ 7.27 → year 9
    const y = yearsToHitPoolLimit(10000, 10, 20000);
    expect(y).toBe(9); // first integer year at or above 20000
  });
});

/* ── Round 2 additions ─────────────────────────────────────────────── */

describe("inflationPct contract — passed as percent (3 means 3%)", () => {
  /* Regression for round-2 bug: caller was passing `i * 100` where i was
     already the percent (i.e. 300), making real values vanish to zero.
     With the fix (pass 3 as 3%), real should match nominal/(1.03^years). */
  const baseOpts = {
    baseYear: 2026,
    p1BirthYear: 1985,
    p2BirthYear: 1990,
    hsaCoverage: "family",
    getPoolLimit,
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
  };

  it("3% inflation produces sensible real values, not near-zero", () => {
    const accounts = [
      { id: "a", owner: "p1", type: "taxable", startBalance: 1000000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 30, { ...baseOpts, inflationPct: 3 });
    const real30 = r.years[30].byAccount.a.real;
    // 1M deflated at 3% for 30 years ≈ 411,987
    expect(real30).toBeCloseTo(1000000 / Math.pow(1.03, 30), 0);
    // Sanity check: not astronomically small (would indicate prop bug recurrence)
    expect(real30).toBeGreaterThan(100000);
  });

  it("inflationPct=0 leaves real == nominal", () => {
    const accounts = [
      { id: "a", owner: "p1", type: "taxable", startBalance: 100000, annualReturn: 5, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const r = forecastGrowthAccounts(accounts, 10, { ...baseOpts, inflationPct: 0 });
    expect(r.years[10].byAccount.a.real).toBeCloseTo(r.years[10].byAccount.a.nominal, 6);
  });
});

describe("limitGrowthPct — IRS limit growth assumption", () => {
  const baseOpts = {
    baseYear: 2026,
    inflationPct: 3,
    p1BirthYear: 1985,
    p2BirthYear: 1990,
    hsaCoverage: "family",
    getPoolLimit,
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
  };

  it("limitGrowthPct=0 matches no-growth behavior (limit unchanged in future years)", () => {
    const accounts = [
      { id: "k", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 999999, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 10, { ...baseOpts, limitGrowthPct: 0 });
    // Year 5 limit should equal getPoolLimit(2031), which falls back to 2026's value
    expect(r.years[5].byAccount.k.contribution).toBe(getPoolLimit("401k_employee", 2031, baseOpts.baseYear + 5 - 1985));
  });

  it("limitGrowthPct=2.5 compounds limit forward and produces higher limits in future years", () => {
    const accounts = [
      { id: "k", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 999999, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 24, { ...baseOpts, limitGrowthPct: 2.5 });
    // Year 1 (2027): grown by 1 year of 2.5%
    const y1Expected = Math.round(getPoolLimit("401k_employee", 2027, 42) * 1.025 / 500) * 500;
    expect(r.years[1].byAccount.k.contribution).toBe(y1Expected);
    // Year 24 (2050): grown by 24 years
    const y24Raw = getPoolLimit("401k_employee", 2050, 65); // 65+ no super, standard catchup
    const y24Expected = Math.round(y24Raw * Math.pow(1.025, 24) / 500) * 500;
    expect(r.years[24].byAccount.k.contribution).toBe(y24Expected);
    // Sanity: 2050 limit should be at least double 2026 (24 years × 2.5% ≈ 80% growth)
    expect(r.years[24].byAccount.k.contribution).toBeGreaterThan(getPoolLimit("401k_employee", 2026, 65));
  });

  it("limitGrowthPct does not affect baseYear (year 0)", () => {
    const accounts = [
      { id: "k", owner: "p1", type: "401k_pretax", startBalance: 50000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: true },
    ];
    const r0 = forecastGrowthAccounts(accounts, 1, { ...baseOpts, limitGrowthPct: 0 });
    const r25 = forecastGrowthAccounts(accounts, 1, { ...baseOpts, limitGrowthPct: 25 });
    // Year 0 row is starting balances — identical
    expect(r0.years[0].byAccount.k.nominal).toBe(r25.years[0].byAccount.k.nominal);
  });

  it("growth rounds to nearest $500 (matches IRS rounding convention)", () => {
    const accounts = [
      { id: "k", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 999999, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 5, { ...baseOpts, limitGrowthPct: 2.5 });
    // Every year's limit should be divisible by 500 cleanly
    for (let y = 1; y <= 5; y++) {
      const c = r.years[y].byAccount.k.contribution;
      expect(c % 500).toBe(0);
    }
  });
});

describe("HSA split into cash + invested — share household pool", () => {
  const baseOpts = {
    baseYear: 2026,
    inflationPct: 0,
    p1BirthYear: 1985,
    p2BirthYear: 1990,
    hsaCoverage: "family",
    getPoolLimit,
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
  };

  it("hsa_cash and hsa_invested both map to the hsa pool", () => {
    expect(ACCOUNT_TYPE_TO_POOL.hsa_cash).toBe("hsa");
    expect(ACCOUNT_TYPE_TO_POOL.hsa_invested).toBe("hsa");
  });

  it("cash + invested totals are capped at the family HSA limit", () => {
    const limit = TAX_DB["2026"].hsaLimit;
    const accounts = [
      { id: "hc", owner: "joint", type: "hsa_cash",     startBalance: 0, annualReturn: 0, contribAmount: limit,        annualIncrease: 0, capAtLimit: true },
      { id: "hi", owner: "joint", type: "hsa_invested", startBalance: 0, annualReturn: 0, contribAmount: limit,        annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    const total = r.years[1].byAccount.hc.contribution + r.years[1].byAccount.hi.contribution;
    expect(total).toBeCloseTo(limit, 6); // capped at single household HSA limit, NOT 2×
    // Each gets half
    expect(r.years[1].byAccount.hc.contribution).toBeCloseTo(limit / 2, 6);
    expect(r.years[1].byAccount.hi.contribution).toBeCloseTo(limit / 2, 6);
  });

  it("legacy hsa type still works alongside new hsa_cash/invested in same household pool", () => {
    const limit = TAX_DB["2026"].hsaLimit;
    const accounts = [
      { id: "old", owner: "joint", type: "hsa",          startBalance: 0, annualReturn: 0, contribAmount: limit / 2, annualIncrease: 0, capAtLimit: true },
      { id: "new", owner: "joint", type: "hsa_invested", startBalance: 0, annualReturn: 0, contribAmount: limit / 2, annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    // Together they exactly hit the family limit; no warning
    const total = r.years[1].byAccount.old.contribution + r.years[1].byAccount.new.contribution;
    expect(total).toBeCloseTo(limit, 6);
    expect(r.poolWarnings.length).toBe(0);
  });
});

describe("401k_match account type — uncapped (no IRS deferral cap)", () => {
  const baseOpts = {
    baseYear: 2026,
    inflationPct: 0,
    p1BirthYear: 1985,
    p2BirthYear: 1990,
    hsaCoverage: "family",
    getPoolLimit,
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
  };

  it("401k_match maps to null pool (uncapped)", () => {
    expect(ACCOUNT_TYPE_TO_POOL["401k_match"]).toBeNull();
  });

  it("match contributions do not consume the employee 401(k) pool budget", () => {
    // P1 has full 401(k) pre-tax + a separate match account. Both should be
    // honored — match doesn't share the employee deferral pool.
    const limit = TAX_DB["2026"].k401Lim;
    const accounts = [
      { id: "pre",   owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: limit, annualIncrease: 0, capAtLimit: true },
      { id: "match", owner: "p1", type: "401k_match",  startBalance: 0, annualReturn: 0, contribAmount: 8000,  annualIncrease: 0, capAtLimit: true },
    ];
    const r = forecastGrowthAccounts(accounts, 1, baseOpts);
    expect(r.years[1].byAccount.pre.contribution).toBeCloseTo(limit, 6);
    expect(r.years[1].byAccount.match.contribution).toBeCloseTo(8000, 6); // not affected
    expect(r.poolWarnings.length).toBe(0);
  });
});

describe("fmtCompact — abbreviated currency for axis labels", () => {
  it("formats sub-thousand as integer", () => {
    expect(fmtCompact(0)).toBe("$0");
    expect(fmtCompact(123)).toBe("$123");
    expect(fmtCompact(999)).toBe("$999");
  });
  it("formats thousands with k suffix", () => {
    expect(fmtCompact(1000)).toBe("$1k");
    expect(fmtCompact(1500)).toBe("$2k"); // rounds
    expect(fmtCompact(450000)).toBe("$450k");
    expect(fmtCompact(999000)).toBe("$999k");
  });
  it("formats millions with M suffix", () => {
    expect(fmtCompact(1200000)).toMatch(/^\$1\.2M$/);
    expect(fmtCompact(10800000)).toMatch(/^\$10\.8M$/);
  });
  it("formats billions with B suffix", () => {
    expect(fmtCompact(1500000000)).toMatch(/^\$1\.5B$/);
  });
  it("handles negatives", () => {
    expect(fmtCompact(-450000)).toBe("-$450k");
    expect(fmtCompact(-1200000)).toMatch(/^-\$1\.2M$/);
  });
  it("handles non-finite gracefully", () => {
    expect(fmtCompact(null)).toBe("$0");
    expect(fmtCompact(undefined)).toBe("$0");
  });
});

describe("cashBudgetContribution — Advanced cash-budget source math", () => {
  /* Identity check: at 48 weeks with no bonus, the formula must reduce to
     the prior hard-coded (tSavW + remW) × 48 figure. We verify this via the
     algebraic equivalent: cNet = tExpW + tSavW + remW, so
     cNet × 48 − tExpW × 48 = (tSavW + remW) × 48. */
  it("at 48 weeks with no bonus, equals (cNet − tExpW) × 48", () => {
    const result = cashBudgetContribution({
      cNet: 2000, tExpW: 1200, forecastWeeks: 48, eaipNet: 5000, includeBonus: false,
    });
    expect(result).toBe((2000 - 1200) * 48); // (tSavW + remW) × 48 = 800 × 48 = 38400
  });

  it("at 52 weeks, the 4 extra weeks of income flow to savings", () => {
    const result = cashBudgetContribution({
      cNet: 2000, tExpW: 1200, forecastWeeks: 52, eaipNet: 0, includeBonus: false,
    });
    // 2000 × 52 − 1200 × 48 = 104000 − 57600 = 46400
    expect(result).toBe(46400);
    // Sanity: 52-week figure should be exactly 4 × cNet larger than 48-week
    const at48 = cashBudgetContribution({ cNet: 2000, tExpW: 1200, forecastWeeks: 48 });
    expect(result - at48).toBe(4 * 2000);
  });

  it("expenses do NOT scale with the weeks toggle (always × 48)", () => {
    // If expenses scaled with weeks, the 52-week figure would be cNet*52 - tExpW*52
    // = (cNet - tExpW) × 52. Verify that's NOT what happens.
    const result = cashBudgetContribution({
      cNet: 2000, tExpW: 1200, forecastWeeks: 52, includeBonus: false,
    });
    expect(result).not.toBe((2000 - 1200) * 52);
    // It should be cNet*52 - tExpW*48
    expect(result).toBe(2000 * 52 - 1200 * 48);
  });

  it("includeBonus adds eaipNet to the result", () => {
    const without = cashBudgetContribution({
      cNet: 2000, tExpW: 1200, forecastWeeks: 48, eaipNet: 7500, includeBonus: false,
    });
    const withBonus = cashBudgetContribution({
      cNet: 2000, tExpW: 1200, forecastWeeks: 48, eaipNet: 7500, includeBonus: true,
    });
    expect(withBonus - without).toBe(7500);
  });

  it("eaipNet is ignored when includeBonus is false", () => {
    const a = cashBudgetContribution({
      cNet: 2000, tExpW: 1200, forecastWeeks: 48, eaipNet: 0, includeBonus: false,
    });
    const b = cashBudgetContribution({
      cNet: 2000, tExpW: 1200, forecastWeeks: 48, eaipNet: 99999, includeBonus: false,
    });
    expect(a).toBe(b);
  });

  it("clamps negative results to zero (expenses exceed income)", () => {
    const result = cashBudgetContribution({
      cNet: 500, tExpW: 1200, forecastWeeks: 48, includeBonus: false,
    });
    // 500*48 - 1200*48 = -33600 → clamped to 0
    expect(result).toBe(0);
  });

  it("handles missing/undefined inputs as zeros", () => {
    expect(cashBudgetContribution({})).toBe(0);
    expect(cashBudgetContribution()).toBe(0);
    expect(cashBudgetContribution({ cNet: 1000 })).toBe(1000 * 48); // expenses default to 0
  });

  it("coerces string inputs", () => {
    const result = cashBudgetContribution({
      cNet: "2000", tExpW: "1200", forecastWeeks: "48", eaipNet: "5000", includeBonus: true,
    });
    expect(result).toBe((2000 - 1200) * 48 + 5000);
  });

  it("defaults forecastWeeks to 48 when not provided", () => {
    const a = cashBudgetContribution({ cNet: 2000, tExpW: 1200 });
    const b = cashBudgetContribution({ cNet: 2000, tExpW: 1200, forecastWeeks: 48 });
    expect(a).toBe(b);
  });
});

/* ── Phase X-A: appliedEndingEvents — ending obligations integration ── */

describe("forecastGrowthAccounts — appliedEndingEvents (ending obligations)", () => {
  const baseOpts = {
    baseYear: 2026,
    inflationPct: 0,
    p1BirthYear: 1985,
    p2BirthYear: 1990,
    hsaCoverage: "family",
    getPoolLimit,
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
  };

  it("with no events, behavior is identical to the no-events call", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 10000, annualReturn: 5, contribAmount: 6000, annualIncrease: 0, capAtLimit: false },
    ];
    const withoutEvents = forecastGrowthAccounts(accounts, 10, baseOpts);
    const withEmpty = forecastGrowthAccounts(accounts, 10, { ...baseOpts, appliedEndingEvents: [] });
    expect(withEmpty.years[10].totals.nominal).toBeCloseTo(withoutEvents.years[10].totals.nominal, 6);
    expect(withEmpty.years[10].byAccount.cash.contribution).toBeCloseTo(withoutEvents.years[10].byAccount.cash.contribution, 6);
  });

  it("event in year 1 month 6 boosts year 1 contribution by half a year's worth", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
    ];
    /* $200/mo freed cash starting at absolute month 7 (mid year 1).
       Months 7..12 → 6 months × $200 = $1200 extra.
       Year 1 total contribution should be 1200 (base) + 1200 (events) = 2400. */
    const events = [{ accountId: "cash", monthIndex: 7, monthlyDelta: 200 }];
    const r = forecastGrowthAccounts(accounts, 2, { ...baseOpts, appliedEndingEvents: events });
    expect(r.years[1].byAccount.cash.contribution).toBeCloseTo(2400, 6);
    // Year 2 should have full year of events on top: 1200 + 12*200 = 3600
    expect(r.years[2].byAccount.cash.contribution).toBeCloseTo(3600, 6);
  });

  it("event accumulates with subsequent events on the same account", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    /* Two loans paid off: $100/mo starts at month 13, +$300/mo more starts at month 25.
       Year 1: no events → 0. Year 2: full year at $100 → 1200.
       Year 3: full year at $100 + $300 = $400/mo → 4800. */
    const events = [
      { accountId: "cash", monthIndex: 13, monthlyDelta: 100 },
      { accountId: "cash", monthIndex: 25, monthlyDelta: 300 },
    ];
    const r = forecastGrowthAccounts(accounts, 3, { ...baseOpts, appliedEndingEvents: events });
    expect(r.years[1].byAccount.cash.contribution).toBeCloseTo(0, 6);
    expect(r.years[2].byAccount.cash.contribution).toBeCloseTo(1200, 6);
    expect(r.years[3].byAccount.cash.contribution).toBeCloseTo(4800, 6);
  });

  it("events on one account don't affect a different account", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
      { id: "other", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 600, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "cash", monthIndex: 1, monthlyDelta: 100 }];
    const r = forecastGrowthAccounts(accounts, 2, { ...baseOpts, appliedEndingEvents: events });
    // other should be unaffected
    expect(r.years[1].byAccount.other.contribution).toBeCloseTo(600, 6);
    expect(r.years[2].byAccount.other.contribution).toBeCloseTo(600, 6);
    // cash should have base + 12 months of events each year
    expect(r.years[1].byAccount.cash.contribution).toBeCloseTo(1200 + 1200, 6);
  });

  it("eventDelta in accountSeries reflects only the event-driven portion", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "cash", monthIndex: 13, monthlyDelta: 100 }]; // starts year 2
    const r = forecastGrowthAccounts(accounts, 2, { ...baseOpts, appliedEndingEvents: events });
    expect(r.accountSeries.cash[1].eventDelta).toBeCloseTo(0, 6);
    expect(r.accountSeries.cash[2].eventDelta).toBeCloseTo(1200, 6);
  });

  it("totals reflect event-driven contributions", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "cash", monthIndex: 1, monthlyDelta: 100 }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedEndingEvents: events });
    // Year 1: 1200 base + 1200 events = 2400 total contributions
    expect(r.years[1].totals.contributions).toBeCloseTo(2400, 6);
    // Balance with zero return = contributions = 2400
    expect(r.years[1].totals.nominal).toBeCloseTo(2400, 6);
  });

  it("negative monthlyDelta (starts scaffolding) reduces contribution", () => {
    const accounts = [
      { id: "savings", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
    ];
    // -100/mo starting at month 1, +100/mo kicks back in at month 13 — simulates "starts" effect
    const events = [
      { accountId: "savings", monthIndex: 1, monthlyDelta: -100 },
      { accountId: "savings", monthIndex: 13, monthlyDelta: 100 },
    ];
    const r = forecastGrowthAccounts(accounts, 2, { ...baseOpts, appliedEndingEvents: events });
    // Year 1: 1200 - 1200 = 0
    expect(r.years[1].byAccount.savings.contribution).toBeCloseTo(0, 6);
    // Year 2: 1200 - 1200 + 1200 = 1200 (back to base)
    expect(r.years[2].byAccount.savings.contribution).toBeCloseTo(1200, 6);
  });

  it("events targeting unknown account ids are silently ignored", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "phantom", monthIndex: 1, monthlyDelta: 999 }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedEndingEvents: events });
    expect(r.years[1].byAccount.cash.contribution).toBeCloseTo(1200, 6);
  });

  it("events fire at correct months regardless of input order", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    /* Unsorted events: month 25 listed before month 13. Function must
       internally sort to fire them in the right order. */
    const events = [
      { accountId: "cash", monthIndex: 25, monthlyDelta: 300 },
      { accountId: "cash", monthIndex: 13, monthlyDelta: 100 },
    ];
    const r = forecastGrowthAccounts(accounts, 3, { ...baseOpts, appliedEndingEvents: events });
    expect(r.years[2].byAccount.cash.contribution).toBeCloseTo(1200, 6);
    expect(r.years[3].byAccount.cash.contribution).toBeCloseTo(4800, 6);
  });

  it("event-driven contributions compound: balance reflects mid-year cash flow growth", () => {
    const accounts = [
      { id: "cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 12, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    // $100/mo starting at absolute month 1, 1 year horizon, 12% annual return = 1% monthly
    const events = [{ accountId: "cash", monthIndex: 1, monthlyDelta: 100 }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedEndingEvents: events });
    /* Monthly compounding at exactly 1%/mo of $100/mo for 12 months.
       The forecast uses Math.pow(1+r, 1/12)-1 for monthly rate; with
       r=0.12 that's 0.009489 (less than 0.01). FV of annuity at that
       rate over 12 months: 100 * ((1.009489^12 - 1) / 0.009489)
                          = 100 * ((1.12 - 1) / 0.009489)
                          = 100 * (0.12 / 0.009489)
                          ≈ 1264.62 */
    const balance = r.years[1].byAccount.cash.nominal;
    expect(balance).toBeGreaterThan(1264);
    expect(balance).toBeLessThan(1266);
    // Total contributed = $1200 (12 × $100)
    expect(r.years[1].byAccount.cash.contribution).toBeCloseTo(1200, 6);
    // Balance > contributions because of growth
    expect(balance).toBeGreaterThan(1200);
  });

  it("applies one-time outflow events to the balance in the matching month", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 50000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    // 30k outflow at month 6 of year 1 (e.g. car purchase)
    const events = [{ accountId: "cash", monthIndex: 6, amount: -30000 }];
    const r = forecastGrowthAccounts(accounts, 2, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    // Year 1 end balance should be ~20k (50k - 30k, no growth, no contrib)
    expect(r.years[1].byAccount.cash.nominal).toBeCloseTo(20000, 5);
    // Year 2 end balance unchanged (no further events)
    expect(r.years[2].byAccount.cash.nominal).toBeCloseTo(20000, 5);
    // accountSeries should expose oneTimeAmount for that year
    expect(r.accountSeries.cash[1].oneTimeAmount).toBe(-30000);
    expect(r.accountSeries.cash[2].oneTimeAmount).toBe(0);
  });

  it("applies one-time inflow events", () => {
    const accounts = [
      { id: "tx", name: "Tax", owner: "joint", type: "taxable", startBalance: 10000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "tx", monthIndex: 12, amount: 50000 }]; // inheritance end of year 1
    const r = forecastGrowthAccounts(accounts, 2, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.years[1].byAccount.tx.nominal).toBeCloseTo(60000, 5);
    expect(r.accountSeries.tx[1].oneTimeAmount).toBe(50000);
  });

  it("allows balance to go negative (surfaces infeasible plans)", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 5000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "cash", monthIndex: 6, amount: -30000 }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.years[1].byAccount.cash.nominal).toBeCloseTo(-25000, 5);
  });

  it("does NOT compound the negative portion of a balance at the return rate", () => {
    /* Regression: a -$9M event on a 4%-return account previously
       compounded the negative balance, producing ~-$29M after 30y. The
       correct behavior is that the negative portion stays flat (no
       fake "interest on debt" at the savings rate) — debt servicing
       would need a separate borrow rate, which is Phase 14 territory. */
    const accounts = [
      { id: "tx", name: "Tax", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 4, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "tx", monthIndex: 1, amount: -9000000 }];
    const r = forecastGrowthAccounts(accounts, 30, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    // Without compounding the negative portion, the balance stays at exactly -$9M.
    expect(r.years[30].byAccount.tx.nominal).toBeCloseTo(-9000000, 5);
    // Sanity check: the OLD buggy math would have produced ~-$29.2M.
    expect(r.years[30].byAccount.tx.nominal).toBeGreaterThan(-10000000);
  });

  it("contributions pay down a negative balance dollar-for-dollar (no return on debt)", () => {
    /* When the balance is negative, contributions reduce it but no
       growth accrues to either side. -$100k starting underwater + $20k/yr
       in contributions should be exactly -$80k after year 1, with no
       4% return reducing the paydown speed. */
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 4, contribAmount: 20000, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "cash", monthIndex: 1, amount: -100000 }];
    const r = forecastGrowthAccounts(accounts, 5, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.years[1].byAccount.cash.nominal).toBeCloseTo(-80000, 5);
    expect(r.years[2].byAccount.cash.nominal).toBeCloseTo(-60000, 5);
    expect(r.years[3].byAccount.cash.nominal).toBeCloseTo(-40000, 5);
    expect(r.years[4].byAccount.cash.nominal).toBeCloseTo(-20000, 5);
    expect(r.years[5].byAccount.cash.nominal).toBeCloseTo(0, 5);
  });

  it("resumes positive compounding once a balance climbs back above zero", () => {
    /* The Math.max(bal, 0) gate flips on the moment the balance goes
       positive again — no special-case "remember you were underwater"
       logic required for the math. The `firstNegativeYear` flag in the
       warnings output is what surfaces the history. */
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 4, contribAmount: 20000, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "cash", monthIndex: 1, amount: -100000 }];
    const r = forecastGrowthAccounts(accounts, 7, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    // Year 5 ends at 0 (last paydown year); year 6 is the first year that
    // gets actual growth. $20k contribution + 4% return should produce
    // ~$20,364 (monthly compounding on the rising balance).
    expect(r.years[5].byAccount.cash.nominal).toBeCloseTo(0, 5);
    expect(r.years[6].byAccount.cash.nominal).toBeGreaterThan(20000);
    expect(r.years[6].byAccount.cash.nominal).toBeLessThan(21000);
    // And the warning persists even though the account is no longer underwater
    expect(r.underwaterWarnings.length).toBe(1);
    expect(r.underwaterWarnings[0].endedNegative).toBe(false);
    expect(r.underwaterWarnings[0].firstNegativeYear).toBe(1);
  });

  it("populates underwaterWarnings for each account that went negative", () => {
    const accounts = [
      { id: "a", name: "A", owner: "joint", type: "taxable", startBalance: 50000, annualReturn: 4, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
      { id: "b", name: "B", owner: "joint", type: "taxable", startBalance: 10000, annualReturn: 4, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
      { id: "c", name: "C", owner: "joint", type: "taxable", startBalance: 5000,  annualReturn: 4, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [
      { accountId: "b", monthIndex: 1,  amount: -50000 }, // year 1
      { accountId: "c", monthIndex: 25, amount: -50000 }, // year 3
      // a stays positive throughout
    ];
    const r = forecastGrowthAccounts(accounts, 5, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.underwaterWarnings.length).toBe(2);
    // Sorted by firstNegativeYear ascending
    expect(r.underwaterWarnings[0].accountId).toBe("b");
    expect(r.underwaterWarnings[0].firstNegativeYear).toBe(1);
    expect(r.underwaterWarnings[1].accountId).toBe("c");
    expect(r.underwaterWarnings[1].firstNegativeYear).toBe(3);
    // Account a never went underwater — not in warnings
    expect(r.underwaterWarnings.find(w => w.accountId === "a")).toBeUndefined();
  });

  it("flags per-year underwater state in accountSeries", () => {
    /* `underwater` on each series row reflects that year's ending state.
       This is what the UI uses for per-row highlighting in the
       year-by-year table — distinct from `firstNegativeYear` (which
       sticks once set). */
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 4, contribAmount: 20000, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "cash", monthIndex: 1, amount: -50000 }];
    const r = forecastGrowthAccounts(accounts, 5, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    // Underwater for years 1, 2 (-$30k, -$10k), recovers in year 3 (+$10k)
    expect(r.accountSeries.cash[1].underwater).toBe(true);
    expect(r.accountSeries.cash[2].underwater).toBe(true);
    expect(r.accountSeries.cash[3].underwater).toBe(false);
    expect(r.accountSeries.cash[4].underwater).toBe(false);
  });

  it("does NOT count one-time events as contributions", () => {
    const accounts = [
      { id: "tx", name: "Tax", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [{ accountId: "tx", monthIndex: 6, amount: 50000 }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    // Contribution remains the base $1200 — the $50k event is not a contribution
    expect(r.years[1].byAccount.tx.contribution).toBeCloseTo(1200, 6);
    expect(r.accountSeries.tx[1].contribCum).toBeCloseTo(1200, 6);
    // But the balance does include the $50k
    expect(r.years[1].byAccount.tx.nominal).toBeCloseTo(51200, 5);
  });

  it("bypasses pool caps for one-time events (rollover into 401k)", () => {
    // 401k_pretax with cap-at-limit enabled, plus a $80k one-time rollover event.
    // The event should land regardless of the IRS contribution cap.
    const accounts = [
      { id: "k", name: "K", owner: "p1", type: "401k_pretax", startBalance: 0, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: true },
    ];
    const events = [{ accountId: "k", monthIndex: 6, amount: 80000 }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.years[1].byAccount.k.nominal).toBeCloseTo(80000, 5);
    // And no pool warning should fire for it (events are not contributions)
    expect(r.poolWarnings.length).toBe(0);
  });

  it("handles multiple events in the same month on the same account", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 100000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [
      { accountId: "cash", monthIndex: 6, amount: -30000 },
      { accountId: "cash", monthIndex: 6, amount: -10000 },
      { accountId: "cash", monthIndex: 6, amount: 5000 },
    ];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.years[1].byAccount.cash.nominal).toBeCloseTo(65000, 5);
    expect(r.accountSeries.cash[1].oneTimeAmount).toBeCloseTo(-35000, 5);
  });

  it("handles events spread across multiple years on multiple accounts", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "cash", startBalance: 10000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
      { id: "b", name: "B", owner: "p2", type: "taxable", startBalance: 20000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [
      { accountId: "a", monthIndex: 6, amount: -5000 },   // year 1
      { accountId: "b", monthIndex: 18, amount: -3000 },  // year 2
      { accountId: "a", monthIndex: 25, amount: 1000 },   // year 3
    ];
    const r = forecastGrowthAccounts(accounts, 3, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.years[1].byAccount.a.nominal).toBeCloseTo(5000, 5);
    expect(r.years[1].byAccount.b.nominal).toBeCloseTo(20000, 5);
    expect(r.years[2].byAccount.a.nominal).toBeCloseTo(5000, 5);
    expect(r.years[2].byAccount.b.nominal).toBeCloseTo(17000, 5);
    expect(r.years[3].byAccount.a.nominal).toBeCloseTo(6000, 5);
    expect(r.years[3].byAccount.b.nominal).toBeCloseTo(17000, 5);
  });

  it("ignores one-time events with missing or unknown accountId", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 10000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const events = [
      { accountId: "cash", monthIndex: 6, amount: -1000 },
      { accountId: "ghost", monthIndex: 6, amount: -50000 }, // unknown account — should be ignored
      { monthIndex: 6, amount: -50000 },                       // no accountId — should be ignored
    ];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, inflationPct: 0, appliedOneTimeEvents: events });
    expect(r.years[1].byAccount.cash.nominal).toBeCloseTo(9000, 5);
  });

  it("works alongside ending events without interference", () => {
    const accounts = [
      { id: "tx", name: "Tax", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 1200, annualIncrease: 0, capAtLimit: false },
    ];
    const endingEvents = [{ accountId: "tx", monthIndex: 7, monthlyDelta: 200 }];
    const oneTimeEvents = [{ accountId: "tx", monthIndex: 9, amount: 10000 }];
    const r = forecastGrowthAccounts(accounts, 1, {
      ...baseOpts,
      inflationPct: 0,
      appliedEndingEvents: endingEvents,
      appliedOneTimeEvents: oneTimeEvents,
    });
    // Base $100/mo × 12 = $1200, plus $200/mo for months 7-12 = $1200, total $2400 contrib
    expect(r.years[1].byAccount.tx.contribution).toBeCloseTo(2400, 6);
    // Plus the $10k one-time event
    expect(r.years[1].byAccount.tx.nominal).toBeCloseTo(12400, 5);
    expect(r.accountSeries.tx[1].eventDelta).toBeCloseTo(1200, 6);
    expect(r.accountSeries.tx[1].oneTimeAmount).toBeCloseTo(10000, 5);
  });
});

describe("poolHeadroom — Capped pool warning gate for ending obligations", () => {
  // Real getPoolLimit + ACCOUNT_TYPE_TO_POOL from taxDB; thin opts wrapper.
  const baseOpts = (overrides = {}) => ({
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
    getPoolLimit,
    baseYear: 2026,
    ageOf: () => null,
    hsaCoverage: "family",
    freedAnnual: 0,
    ...overrides,
  });

  it("returns atRisk=false for uncapped pools (taxable)", () => {
    const dest = { id: "tx", owner: "joint", type: "taxable", capAtLimit: false };
    const accounts = [dest];
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: dest,
      accounts,
      effectiveContribFor: () => 50000,
      freedAnnual: 999999,
    });
    expect(r.atRisk).toBe(false);
    expect(r.pool).toBe(null);
  });

  it("returns atRisk=false when destination has capAtLimit disabled (user opted out)", () => {
    const dest = { id: "ira", owner: "p1", type: "ira_roth", capAtLimit: false };
    const accounts = [dest];
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: dest,
      accounts,
      effectiveContribFor: () => 5000,
      freedAnnual: 100000,
    });
    expect(r.atRisk).toBe(false);
  });

  it("Regression: a $5k Roth IRA contribution (no other IRAs) does NOT trigger the warning (the original bug)", () => {
    // The user described this exactly: $5k/yr Roth IRA, no other IRA accounts,
    // ending obligation redirects to it. Previous logic flagged this. Limit
    // for ira pool in 2026 is $7,000 (no catch-up). 5000 << 7000, even with
    // some freed cash, so atRisk should be false unless freed cash actually
    // pushes the pool over.
    const dest = { id: "ira", owner: "p1", type: "ira_roth", capAtLimit: true };
    const accounts = [dest];
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: dest,
      accounts,
      effectiveContribFor: () => 5000,
      freedAnnual: 0,
    });
    expect(r.atRisk).toBe(false);
    expect(r.pool).toBe("ira");
    expect(r.current).toBe(5000);
    expect(r.limit).toBeGreaterThanOrEqual(7000);
  });

  it("flags when freed cash pushes the IRA pool over the limit", () => {
    // $6k base + $3k freed → $9k against ~$7k limit = over.
    const dest = { id: "ira", owner: "p1", type: "ira_roth", capAtLimit: true };
    const accounts = [dest];
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: dest,
      accounts,
      effectiveContribFor: () => 6000,
      freedAnnual: 3000,
    });
    expect(r.atRisk).toBe(true);
    expect(r.pool).toBe("ira");
    expect(r.projected).toBeCloseTo(9000, 6);
  });

  it("sums multiple IRA accounts in the same owner's pool", () => {
    // Trad $4k + Roth $4k = $8k, already over $7k limit even at freedAnnual=0.
    const trad = { id: "trad", owner: "p1", type: "ira_traditional", capAtLimit: true };
    const roth = { id: "roth", owner: "p1", type: "ira_roth", capAtLimit: true };
    const dest = roth;
    const accounts = [trad, roth];
    const contribs = { trad: 4000, roth: 4000 };
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: dest,
      accounts,
      effectiveContribFor: (a) => contribs[a.id] || 0,
      freedAnnual: 0,
    });
    expect(r.atRisk).toBe(true);
    expect(r.current).toBeCloseTo(8000, 6);
  });

  it("does NOT cross-pool: a different person's IRA contribs don't count", () => {
    // p1 has $5k in Roth (under limit). p2 has $7k in Trad (at p2's limit).
    // Destination is p1's Roth. p2's contribs should NOT be summed.
    const p1Roth = { id: "p1r", owner: "p1", type: "ira_roth", capAtLimit: true };
    const p2Trad = { id: "p2t", owner: "p2", type: "ira_traditional", capAtLimit: true };
    const accounts = [p1Roth, p2Trad];
    const contribs = { p1r: 5000, p2t: 7000 };
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: p1Roth,
      accounts,
      effectiveContribFor: (a) => contribs[a.id] || 0,
      freedAnnual: 0,
    });
    expect(r.atRisk).toBe(false);
    expect(r.current).toBe(5000); // only p1's contribs
  });

  it("HSA pool is household-wide regardless of owner", () => {
    // Two HSA accounts with different "owners" (one joint, one p1) should
    // still share the same pool because hsa pool is household-keyed.
    const hsaA = { id: "ha", owner: "joint", type: "hsa_cash", capAtLimit: true };
    const hsaB = { id: "hb", owner: "p1", type: "hsa_invested", capAtLimit: true };
    const accounts = [hsaA, hsaB];
    const contribs = { ha: 5000, hb: 4000 };
    const r = poolHeadroom({
      ...baseOpts({ hsaCoverage: "family" }),
      destAccount: hsaA,
      accounts,
      effectiveContribFor: (a) => contribs[a.id] || 0,
      freedAnnual: 0,
    });
    // Family limit 2026 = $8,300. $5k + $4k = $9k > $8.3k → at risk.
    expect(r.atRisk).toBe(true);
    expect(r.current).toBeCloseTo(9000, 6);
    expect(r.pool).toBe("hsa");
  });

  it("HSA self-only coverage applies a lower limit", () => {
    const hsa = { id: "h", owner: "joint", type: "hsa_cash", capAtLimit: true };
    const accounts = [hsa];
    const r = poolHeadroom({
      ...baseOpts({ hsaCoverage: "self" }),
      destAccount: hsa,
      accounts,
      effectiveContribFor: () => 4500,
      freedAnnual: 0,
    });
    // 2026 HSA self limit = $4,400. $4,500 > $4,400 → at risk.
    expect(r.atRisk).toBe(true);
    expect(r.limit).toBeCloseTo(4400, 0);
  });

  it("returns safe defaults when destAccount is missing", () => {
    const r = poolHeadroom({ ...baseOpts(), destAccount: null, accounts: [], effectiveContribFor: () => 0 });
    expect(r.atRisk).toBe(false);
    expect(r.pool).toBe(null);
  });

  it("returns safe defaults when accountTypeToPool/getPoolLimit are missing", () => {
    const dest = { id: "ira", owner: "p1", type: "ira_roth", capAtLimit: true };
    const r = poolHeadroom({ destAccount: dest, accounts: [dest], effectiveContribFor: () => 5000 });
    expect(r.atRisk).toBe(false);
  });

  it("401(k) employee pool is per-owner", () => {
    const p1Pre = { id: "p1p", owner: "p1", type: "401k_pretax", capAtLimit: true };
    const p2Pre = { id: "p2p", owner: "p2", type: "401k_pretax", capAtLimit: true };
    const accounts = [p1Pre, p2Pre];
    const contribs = { p1p: 24500, p2p: 24500 }; // each at their own ~$24.5k limit
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: p1Pre,
      accounts,
      effectiveContribFor: (a) => contribs[a.id] || 0,
      freedAnnual: 1000,
    });
    // p1's pool sees only p1's contribution + freed cash. $24.5k + $1k = $25.5k > limit.
    expect(r.atRisk).toBe(true);
    expect(r.current).toBe(24500); // NOT 49000
  });

  it("401k_match destination is not pool-capped (employer match has no employee deferral cap)", () => {
    const match = { id: "m", owner: "p1", type: "401k_match", capAtLimit: false };
    const r = poolHeadroom({
      ...baseOpts(),
      destAccount: match,
      accounts: [match],
      effectiveContribFor: () => 10000,
      freedAnnual: 50000,
    });
    expect(r.atRisk).toBe(false);
    expect(r.pool).toBe(null);
  });
});

describe("forecastGrowthAccounts — appliedLoans integration (Phase 14)", () => {
  const baseOpts = {
    baseYear: 2026,
    inflationPct: 0,
    p1BirthYear: 1985,
    p2BirthYear: 1990,
    hsaCoverage: "family",
    getPoolLimit,
    accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
  };

  it("monthly debits reduce the source account balance", () => {
    // $12,000 starting cash, $12,000 zero-interest loan over 12 months
    // starting month 1 → $1000/mo debit. After year 1, cash = 0.
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 12000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "auto", principal: 12000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 12,
      monthlyPaymentAmount: 1000, termMonths: 12,
    }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    expect(r.years[1].byAccount.cash.nominal).toBeCloseTo(0, 2);
    expect(r.accountSeries.cash[1].debtServiceThisYear).toBeCloseTo(12000, 2);
  });

  it("origination credits the target account with principal in the origination month", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 50000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
      { id: "home", name: "Home", owner: "joint", type: "custom", startBalance: 0, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "mort", principal: 200000, sourceAccountId: "cash", targetAccountId: "home",
      originationMonthIndex: 1, payoffMonthIndex: 360,
      monthlyPaymentAmount: 1073.64, termMonths: 360,
    }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    // home account gets $200k at origination, no other activity
    expect(r.accountSeries.home[1].balance).toBeCloseTo(200000, 0);
    expect(r.accountSeries.home[1].loanProceedsThisYear).toBeCloseTo(200000, 0);
    // cash account: 50k start - 12 * 1073.64 ≈ $37,116
    expect(r.accountSeries.cash[1].balance).toBeCloseTo(50000 - 12 * 1073.64, 0);
  });

  it("no targetAccountId → no origination credit anywhere", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 12000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
      { id: "other", name: "Other", owner: "joint", type: "taxable", startBalance: 5000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "auto", principal: 6000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 12,
      monthlyPaymentAmount: 500, termMonths: 12,
    }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    // 'other' account is untouched — no principal credited anywhere
    expect(r.accountSeries.other[1].balance).toBe(5000);
    expect(r.accountSeries.other[1].loanProceedsThisYear).toBe(0);
  });

  it("overflow account receives freed monthly payment after payoff", () => {
    // 12-month $12k zero-interest loan paid from cash, overflow to taxable.
    // After month 12 payoff, taxable gets +$1000/mo for the remaining horizon.
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 50000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
      { id: "tax", name: "Taxable", owner: "joint", type: "taxable", startBalance: 0, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "auto", principal: 12000, sourceAccountId: "cash", overflowAccountId: "tax",
      originationMonthIndex: 1, payoffMonthIndex: 12,
      monthlyPaymentAmount: 1000, termMonths: 12,
    }];
    const r = forecastGrowthAccounts(accounts, 3, { ...baseOpts, appliedLoans: loans });
    // Year 1: payoff happens at month 12. Overflow fires at month 13 onwards
    // — so year 1 has $0 overflow.
    expect(r.accountSeries.tax[1].balance).toBe(0);
    // Year 2: 12 months × $1000 = $12,000
    expect(r.accountSeries.tax[2].balance).toBeCloseTo(12000, 2);
    expect(r.accountSeries.tax[2].loanOverflowThisYear).toBeCloseTo(12000, 2);
    // Year 3: another $12,000 → $24,000
    expect(r.accountSeries.tax[3].balance).toBeCloseTo(24000, 2);
  });

  it("overflow=source has no effect (money stays in source by virtue of no debit)", () => {
    // 12-month $12k loan; after payoff, the cash that was going out simply
    // stays. Compare two scenarios: with overflow=source vs no overflow.
    // They should be balance-equivalent.
    const accountsBase = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 50000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loanNoOverflow = [{
      id: "L1", label: "auto", principal: 12000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 12,
      monthlyPaymentAmount: 1000, termMonths: 12,
    }];
    const loanSelfOverflow = [{
      ...loanNoOverflow[0], overflowAccountId: "cash",
    }];
    const r1 = forecastGrowthAccounts(accountsBase, 3, { ...baseOpts, appliedLoans: loanNoOverflow });
    const r2 = forecastGrowthAccounts(accountsBase, 3, { ...baseOpts, appliedLoans: loanSelfOverflow });
    expect(r1.accountSeries.cash[3].balance).toBeCloseTo(r2.accountSeries.cash[3].balance, 2);
  });

  it("loanSummaries records total interest and total paid for each loan", () => {
    // $100,000 @ 6% / 360mo. Standard known totals:
    //   monthly payment ≈ $599.55
    //   total paid ≈ $215,838 (599.55 × 360)
    //   total interest ≈ $115,838
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 300000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "mortgage", principal: 100000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 360,
      monthlyPaymentAmount: 599.5505251, termMonths: 360,
    }];
    const r = forecastGrowthAccounts(accounts, 30, { ...baseOpts, appliedLoans: loans });
    expect(r.loanSummaries.length).toBe(1);
    expect(r.loanSummaries[0].loanId).toBe("L1");
    expect(r.loanSummaries[0].totalInterest).toBeCloseTo(115838, -1); // ± $10
    expect(r.loanSummaries[0].totalPaid).toBeCloseTo(215838, -1);
    expect(r.loanSummaries[0].finishesWithinHorizon).toBe(true);
  });

  it("loanSummaries flags loans that don't finish within the horizon", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 1000000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    // 30-year loan, 10-year horizon
    const loans = [{
      id: "L1", label: "mortgage", principal: 300000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 360,
      monthlyPaymentAmount: 1798.65, termMonths: 360,
    }];
    const r = forecastGrowthAccounts(accounts, 10, { ...baseOpts, appliedLoans: loans });
    expect(r.loanSummaries[0].finishesWithinHorizon).toBe(false);
  });

  it("empty appliedLoans is a no-op equivalent to omitting the opt", () => {
    const accounts = [
      { id: "a", name: "A", owner: "p1", type: "taxable", startBalance: 10000, annualReturn: 5, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const r1 = forecastGrowthAccounts(accounts, 5, baseOpts);
    const r2 = forecastGrowthAccounts(accounts, 5, { ...baseOpts, appliedLoans: [] });
    expect(r1.accountSeries.a[5].balance).toBeCloseTo(r2.accountSeries.a[5].balance, 6);
    expect(r2.loanSummaries).toEqual([]);
  });

  it("loan that pushes source account underwater triggers underwaterWarnings", () => {
    // $10k cash, $50k loan with $5k/mo payments → bankruptcy in 2 months.
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 10000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "bad", principal: 50000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 12,
      monthlyPaymentAmount: 4500, termMonths: 12,
    }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    expect(r.underwaterWarnings.length).toBe(1);
    expect(r.underwaterWarnings[0].firstNegativeYear).toBe(1);
  });

  it("origination credit precedes the first debit in the same month", () => {
    // The first month sees both the principal credit (if target=source for
    // testing — using source itself as target validates the order: $200k
    // credit, then $1000 debit, ending balance should be +$199k not -$199k).
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 0, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "self-loan", principal: 200000, sourceAccountId: "cash", targetAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 360,
      monthlyPaymentAmount: 1000, termMonths: 360,
    }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    // After year 1: 200k credited - 12k debited = $188k
    expect(r.accountSeries.cash[1].balance).toBeCloseTo(188000, 0);
    // Did NOT go underwater at month 1
    expect(r.underwaterWarnings.length).toBe(0);
  });

  it("two loans on the same source account accumulate debits correctly", () => {
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 100000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [
      { id: "L1", label: "auto", principal: 12000, sourceAccountId: "cash", originationMonthIndex: 1, payoffMonthIndex: 12, monthlyPaymentAmount: 1000, termMonths: 12 },
      { id: "L2", label: "boat", principal: 24000, sourceAccountId: "cash", originationMonthIndex: 1, payoffMonthIndex: 12, monthlyPaymentAmount: 2000, termMonths: 12 },
    ];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    // Total debits: ($1000 + $2000) × 12 = $36,000 → ending balance $64k
    expect(r.accountSeries.cash[1].balance).toBeCloseTo(64000, 2);
    expect(r.accountSeries.cash[1].debtServiceThisYear).toBeCloseTo(36000, 2);
    expect(r.loanSummaries.length).toBe(2);
  });

  it("debits past the horizon are simply not applied (loan continues in reality, projection stops)", () => {
    // 24-month loan, horizon of 1 year → only first 12 debits apply
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 30000, annualReturn: 0, contribAmount: 0, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "auto", principal: 24000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 24,
      monthlyPaymentAmount: 1000, termMonths: 24,
    }];
    const r = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    // Only 12 months of payments applied within horizon = $12k debited
    expect(r.accountSeries.cash[1].balance).toBeCloseTo(18000, 2);
    expect(r.accountSeries.cash[1].debtServiceThisYear).toBeCloseTo(12000, 2);
    expect(r.loanSummaries[0].finishesWithinHorizon).toBe(false);
  });

  it("loan + contribution + growth interact correctly", () => {
    // $10k start, $200/mo contribution, $1000/mo loan debit, 5% return,
    // 1-year projection. Monthly cash flow = +200 - 1000 = -$800.
    // Ending balance should be lower than no-loan version by ~$12k payments + interest forgone.
    const accounts = [
      { id: "cash", name: "Cash", owner: "joint", type: "cash", startBalance: 10000, annualReturn: 5, contribAmount: 2400, annualIncrease: 0, capAtLimit: false },
    ];
    const loans = [{
      id: "L1", label: "auto", principal: 12000, sourceAccountId: "cash",
      originationMonthIndex: 1, payoffMonthIndex: 12,
      monthlyPaymentAmount: 1000, termMonths: 12,
    }];
    const rNoLoan = forecastGrowthAccounts(accounts, 1, baseOpts);
    const rWithLoan = forecastGrowthAccounts(accounts, 1, { ...baseOpts, appliedLoans: loans });
    // With-loan balance should be lower by approximately $12k (minus a bit
    // for interest on the now-smaller balance during the year)
    const delta = rNoLoan.accountSeries.cash[1].balance - rWithLoan.accountSeries.cash[1].balance;
    expect(delta).toBeGreaterThan(11000);
    expect(delta).toBeLessThan(13000);
  });
});

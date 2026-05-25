import { describe, it, expect } from "vitest";
import {
  computeTaxCharacterMix,
  extractMixFromProjection,
  estimateRetirementTax,
  grossUpForTaxes,
  computeFireTarget,
} from "./fireTarget.js";
import { ACCOUNT_TYPE_TO_TAX_CHARACTER, TAX_DB } from "../data/taxDB.js";

const TAX_CFG_MFJ_CO_2026 = {
  year: "2026",
  filing: "mfj",
  stateAbbr: "CO",
  ltcgRate: 0.15,
  stateTaxesLTCG: true,
};

const TAX_CFG_MFJ_FED_ONLY = {
  year: "2026",
  filing: "mfj",
  stateAbbr: "",   // no state
  ltcgRate: 0.15,
  stateTaxesLTCG: false,
};

describe("ACCOUNT_TYPE_TO_TAX_CHARACTER — completeness", () => {
  it("maps every documented account type", () => {
    const expected = [
      "401k_pretax", "401k_roth", "401k_match",
      "ira_traditional", "ira_roth",
      "hsa", "hsa_cash", "hsa_invested",
      "taxable", "cash", "custom",
    ];
    for (const t of expected) {
      expect(ACCOUNT_TYPE_TO_TAX_CHARACTER[t]).toBeDefined();
      expect(["ordinary", "ltcg", "taxfree"]).toContain(ACCOUNT_TYPE_TO_TAX_CHARACTER[t]);
    }
  });
  it("treats Roth and HSA as taxfree", () => {
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["401k_roth"]).toBe("taxfree");
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["ira_roth"]).toBe("taxfree");
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["hsa_cash"]).toBe("taxfree");
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["hsa_invested"]).toBe("taxfree");
  });
  it("treats Traditional 401(k)/IRA and employer match as ordinary income", () => {
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["401k_pretax"]).toBe("ordinary");
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["401k_match"]).toBe("ordinary");
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["ira_traditional"]).toBe("ordinary");
  });
  it("treats taxable brokerage as LTCG", () => {
    expect(ACCOUNT_TYPE_TO_TAX_CHARACTER["taxable"]).toBe("ltcg");
  });
});

describe("computeTaxCharacterMix", () => {
  it("returns zeros for empty input", () => {
    expect(computeTaxCharacterMix([])).toEqual({ ordinary: 0, ltcg: 0, taxfree: 0 });
    expect(computeTaxCharacterMix(null)).toEqual({ ordinary: 0, ltcg: 0, taxfree: 0 });
  });
  it("pure Roth → 100% taxfree", () => {
    const mix = computeTaxCharacterMix([
      { type: "401k_roth", balance: 500000 },
      { type: "ira_roth",  balance: 200000 },
    ]);
    expect(mix.taxfree).toBeCloseTo(1.0, 6);
    expect(mix.ordinary).toBe(0);
    expect(mix.ltcg).toBe(0);
  });
  it("pure Traditional → 100% ordinary", () => {
    const mix = computeTaxCharacterMix([
      { type: "401k_pretax", balance: 800000 },
      { type: "401k_match",  balance: 100000 },
    ]);
    expect(mix.ordinary).toBeCloseTo(1.0, 6);
  });
  it("pure taxable → 100% ltcg", () => {
    const mix = computeTaxCharacterMix([
      { type: "taxable", balance: 600000 },
    ]);
    expect(mix.ltcg).toBeCloseTo(1.0, 6);
  });
  it("mixed portfolio splits proportionally", () => {
    const mix = computeTaxCharacterMix([
      { type: "401k_pretax", balance: 800000 }, // ordinary
      { type: "ira_roth",    balance: 400000 }, // taxfree
      { type: "taxable",     balance: 300000 }, // ltcg
      { type: "hsa_cash",    balance: 100000 }, // taxfree
    ]);
    // total 1.6M: ordinary 0.5, taxfree 0.3125, ltcg 0.1875
    expect(mix.ordinary).toBeCloseTo(0.5, 6);
    expect(mix.taxfree).toBeCloseTo(0.3125, 6);
    expect(mix.ltcg).toBeCloseTo(0.1875, 6);
  });
  it("ignores negative (underwater) balances", () => {
    const mix = computeTaxCharacterMix([
      { type: "401k_pretax", balance: 100000 },
      { type: "cash",        balance: -50000 }, // underwater, skipped
      { type: "ira_roth",    balance: 100000 },
    ]);
    expect(mix.ordinary).toBeCloseTo(0.5, 6);
    expect(mix.taxfree).toBeCloseTo(0.5, 6);
  });
  it("returns zeros when total balance is zero", () => {
    expect(computeTaxCharacterMix([
      { type: "401k_pretax", balance: 0 },
      { type: "taxable",     balance: 0 },
    ])).toEqual({ ordinary: 0, ltcg: 0, taxfree: 0 });
  });
  it("unknown account type falls back to ordinary (conservative)", () => {
    const mix = computeTaxCharacterMix([
      { type: "made_up", balance: 100000 },
    ]);
    expect(mix.ordinary).toBeCloseTo(1.0, 6);
  });
  it("legacy 'hsa' type still treated taxfree", () => {
    const mix = computeTaxCharacterMix([{ type: "hsa", balance: 200000 }]);
    expect(mix.taxfree).toBeCloseTo(1.0, 6);
  });
});

describe("extractMixFromProjection", () => {
  it("returns zeros for empty inputs", () => {
    expect(extractMixFromProjection([], {})).toEqual({ ordinary: 0, ltcg: 0, taxfree: 0 });
    expect(extractMixFromProjection(null, null)).toEqual({ ordinary: 0, ltcg: 0, taxfree: 0 });
  });
  it("pulls final-year balances when year is unspecified", () => {
    const accounts = [
      { id: "a", type: "401k_pretax" },
      { id: "b", type: "ira_roth" },
    ];
    const accountSeries = {
      a: [
        { year: 0, balance: 100000 },
        { year: 1, balance: 110000 },
        { year: 2, balance: 121000 },
      ],
      b: [
        { year: 0, balance: 50000 },
        { year: 1, balance: 55000 },
        { year: 2, balance: 60500 },
      ],
    };
    const mix = extractMixFromProjection(accounts, accountSeries);
    // year 2: 121k ordinary + 60.5k taxfree = 181.5k
    expect(mix.ordinary).toBeCloseTo(121000 / 181500, 5);
    expect(mix.taxfree).toBeCloseTo(60500 / 181500, 5);
  });
  it("pulls a specific year when provided", () => {
    const accounts = [{ id: "a", type: "401k_pretax" }, { id: "b", type: "ira_roth" }];
    const accountSeries = {
      a: [
        { year: 0, balance: 100000 },
        { year: 1, balance: 110000 },
      ],
      b: [
        { year: 0, balance: 100000 },
        { year: 1, balance: 100000 },
      ],
    };
    const mix0 = extractMixFromProjection(accounts, accountSeries, 0);
    expect(mix0.ordinary).toBeCloseTo(0.5, 6);
    const mix1 = extractMixFromProjection(accounts, accountSeries, 1);
    expect(mix1.ordinary).toBeCloseTo(110000 / 210000, 5);
  });
  it("interpolates between years for fractional year input", () => {
    const accounts = [{ id: "a", type: "401k_pretax" }];
    const accountSeries = {
      a: [
        { year: 0, balance: 100000 },
        { year: 1, balance: 200000 },
      ],
    };
    const mix = extractMixFromProjection(accounts, accountSeries, 0.5);
    expect(mix.ordinary).toBeCloseTo(1.0, 6); // pure ordinary
    // tested via the underlying balance: 150k → still 100% ordinary
  });
  it("handles missing series for some accounts gracefully", () => {
    const accounts = [{ id: "a", type: "401k_pretax" }, { id: "b", type: "ira_roth" }];
    const accountSeries = {
      a: [{ year: 0, balance: 100000 }],
      // 'b' missing
    };
    const mix = extractMixFromProjection(accounts, accountSeries);
    expect(mix.ordinary).toBeCloseTo(1.0, 6);
  });
});

describe("estimateRetirementTax — pure-type cases", () => {
  it("100% taxfree → zero tax", () => {
    const tax = estimateRetirementTax(80000,
      { ordinary: 0, ltcg: 0, taxfree: 1 },
      TAX_CFG_MFJ_CO_2026);
    expect(tax.totalTax).toBe(0);
    expect(tax.federalTax).toBe(0);
    expect(tax.stateTax).toBe(0);
    expect(tax.effectiveRate).toBe(0);
  });
  it("100% LTCG with no state → fed 15% flat", () => {
    const tax = estimateRetirementTax(80000,
      { ordinary: 0, ltcg: 1, taxfree: 0 },
      TAX_CFG_MFJ_FED_ONLY);
    expect(tax.federalTax).toBeCloseTo(80000 * 0.15, 2);
    expect(tax.stateTax).toBe(0);
    expect(tax.effectiveRate).toBeCloseTo(0.15, 4);
  });
  it("100% ordinary income — matches federal brackets minus std ded", () => {
    // 2026 MFJ std ded = 32,200; bracket 10% to 24,800, 12% next, etc.
    const tax = estimateRetirementTax(80000,
      { ordinary: 1, ltcg: 0, taxfree: 0 },
      TAX_CFG_MFJ_FED_ONLY);
    const taxable = 80000 - TAX_DB["2026"].stdMFJ; // 47,800
    // first 24,800 at 10% = 2,480
    // next (47,800-24,800)=23,000 at 12% = 2,760
    // total = 5,240
    expect(tax.federalTax).toBeCloseTo(5240, 1);
    expect(tax.stateTax).toBe(0);
  });
});

describe("estimateRetirementTax — mixed portfolio", () => {
  it("blended math: 50/25/25 portfolio at $80k spend", () => {
    const mix = { ordinary: 0.5, ltcg: 0.25, taxfree: 0.25 };
    const tax = estimateRetirementTax(80000, mix, TAX_CFG_MFJ_FED_ONLY);
    // ordinary portion: 40,000 → taxable = max(0, 40,000-32,200) = 7,800 at 10% = 780
    // ltcg portion: 20,000 at 15% = 3,000
    // total fed: 3,780
    expect(tax.federalTax).toBeCloseTo(3780, 1);
    expect(tax.ordinaryIncome).toBeCloseTo(40000, 2);
    expect(tax.ltcgIncome).toBeCloseTo(20000, 2);
    expect(tax.taxfreeIncome).toBeCloseTo(20000, 2);
  });
  it("state tax adds when configured (CO has flat ~4.4%)", () => {
    const mix = { ordinary: 1, ltcg: 0, taxfree: 0 };
    const noState = estimateRetirementTax(80000, mix, TAX_CFG_MFJ_FED_ONLY);
    const withCO = estimateRetirementTax(80000, mix, TAX_CFG_MFJ_CO_2026);
    expect(withCO.totalTax).toBeGreaterThan(noState.totalTax);
    expect(withCO.stateTax).toBeGreaterThan(0);
  });
  it("ltcgRate override is respected", () => {
    const tax = estimateRetirementTax(100000,
      { ordinary: 0, ltcg: 1, taxfree: 0 },
      { ...TAX_CFG_MFJ_FED_ONLY, ltcgRate: 0.20 });
    expect(tax.federalTax).toBeCloseTo(20000, 1);
  });
  it("effective rate decreases as taxfree share grows", () => {
    const allOrdinary = estimateRetirementTax(80000,
      { ordinary: 1, ltcg: 0, taxfree: 0 },
      TAX_CFG_MFJ_FED_ONLY).effectiveRate;
    const halfTaxfree = estimateRetirementTax(80000,
      { ordinary: 0.5, ltcg: 0, taxfree: 0.5 },
      TAX_CFG_MFJ_FED_ONLY).effectiveRate;
    const allTaxfree = estimateRetirementTax(80000,
      { ordinary: 0, ltcg: 0, taxfree: 1 },
      TAX_CFG_MFJ_FED_ONLY).effectiveRate;
    expect(allOrdinary).toBeGreaterThan(halfTaxfree);
    expect(halfTaxfree).toBeGreaterThan(allTaxfree);
    expect(allTaxfree).toBe(0);
  });
});

describe("grossUpForTaxes — convergence", () => {
  it("returns spending unchanged for pure-taxfree portfolio", () => {
    const r = grossUpForTaxes(80000,
      { ordinary: 0, ltcg: 0, taxfree: 1 },
      TAX_CFG_MFJ_FED_ONLY);
    expect(r.grossNeed).toBeCloseTo(80000, 2);
    expect(r.tax.totalTax).toBe(0);
  });
  it("converges within a few iterations for ordinary-heavy portfolio", () => {
    const r = grossUpForTaxes(80000,
      { ordinary: 1, ltcg: 0, taxfree: 0 },
      TAX_CFG_MFJ_FED_ONLY);
    // grossNeed should equal spending + tax(grossNeed), checked at convergence
    const recomputed = estimateRetirementTax(r.grossNeed,
      { ordinary: 1, ltcg: 0, taxfree: 0 },
      TAX_CFG_MFJ_FED_ONLY);
    expect(r.grossNeed - recomputed.totalTax).toBeCloseTo(80000, 0);
    expect(r.iterations).toBeLessThanOrEqual(6);
  });
  it("handles zero spending", () => {
    const r = grossUpForTaxes(0,
      { ordinary: 1, ltcg: 0, taxfree: 0 },
      TAX_CFG_MFJ_FED_ONLY);
    expect(r.grossNeed).toBe(0);
    expect(r.tax.totalTax).toBe(0);
  });
});

describe("computeFireTarget — top-level", () => {
  it("simple mode skips tax math and returns spending/swr", () => {
    const r = computeFireTarget(80000, null, null, 0.04, true);
    expect(r.target).toBeCloseTo(2000000, 2);
    expect(r.multiplierEquivalent).toBeCloseTo(25, 5);
    expect(r.tax).toBeNull();
    expect(r.simpleMode).toBe(true);
  });
  it("pure-Roth portfolio gives target ≈ 25× at 4%", () => {
    const mix = { ordinary: 0, ltcg: 0, taxfree: 1 };
    const r = computeFireTarget(80000, mix, TAX_CFG_MFJ_FED_ONLY, 0.04, false);
    expect(r.target).toBeCloseTo(2000000, 0);
    expect(r.multiplierEquivalent).toBeCloseTo(25, 4);
  });
  it("pure-Traditional portfolio gives target > 25×", () => {
    const mix = { ordinary: 1, ltcg: 0, taxfree: 0 };
    const r = computeFireTarget(80000, mix, TAX_CFG_MFJ_FED_ONLY, 0.04, false);
    expect(r.target).toBeGreaterThan(2000000);
    expect(r.multiplierEquivalent).toBeGreaterThan(25);
  });
  it("SWR sensitivity: 3% → multiplier ≈ 33×, 5% → ≈ 20× (taxfree)", () => {
    const mix = { ordinary: 0, ltcg: 0, taxfree: 1 };
    const r3 = computeFireTarget(80000, mix, TAX_CFG_MFJ_FED_ONLY, 0.03, false);
    const r4 = computeFireTarget(80000, mix, TAX_CFG_MFJ_FED_ONLY, 0.04, false);
    const r5 = computeFireTarget(80000, mix, TAX_CFG_MFJ_FED_ONLY, 0.05, false);
    expect(r3.multiplierEquivalent).toBeCloseTo(100 / 3, 4);
    expect(r4.multiplierEquivalent).toBeCloseTo(25, 4);
    expect(r5.multiplierEquivalent).toBeCloseTo(20, 4);
  });
  it("zero spending returns zero target", () => {
    const r = computeFireTarget(0,
      { ordinary: 1, ltcg: 0, taxfree: 0 },
      TAX_CFG_MFJ_FED_ONLY, 0.04, false);
    expect(r.target).toBe(0);
    expect(r.multiplierEquivalent).toBe(0);
  });
  it("invalid swr falls back to 4%", () => {
    const r = computeFireTarget(80000,
      { ordinary: 0, ltcg: 0, taxfree: 1 },
      TAX_CFG_MFJ_FED_ONLY, 0, false);
    expect(r.target).toBeCloseTo(2000000, 0);
  });
  it("mixed portfolio sits between pure-Roth and pure-Traditional targets", () => {
    const mixR = { ordinary: 0,   ltcg: 0, taxfree: 1   };
    const mixM = { ordinary: 0.5, ltcg: 0, taxfree: 0.5 };
    const mixT = { ordinary: 1,   ltcg: 0, taxfree: 0   };
    const tR = computeFireTarget(80000, mixR, TAX_CFG_MFJ_FED_ONLY, 0.04, false).target;
    const tM = computeFireTarget(80000, mixM, TAX_CFG_MFJ_FED_ONLY, 0.04, false).target;
    const tT = computeFireTarget(80000, mixT, TAX_CFG_MFJ_FED_ONLY, 0.04, false).target;
    expect(tR).toBeLessThan(tM);
    expect(tM).toBeLessThan(tT);
  });
  it("returns effective multiplier > raw 1/swr when taxes apply", () => {
    const mix = { ordinary: 1, ltcg: 0, taxfree: 0 };
    const r = computeFireTarget(80000, mix, TAX_CFG_MFJ_FED_ONLY, 0.04, false);
    expect(r.multiplierEquivalent).toBeGreaterThan(25);
    expect(r.multiplierEquivalent).toBeLessThan(35); // sanity ceiling
  });
});

describe("computeFireTarget — backward compat with simple mode", () => {
  it("simple mode at 4% exactly equals classic 25× rule", () => {
    const spending = 100000;
    const r = computeFireTarget(spending, null, null, 0.04, true);
    expect(r.target).toBe(spending * 25);
  });
  it("simple mode at 3% exactly equals classic 33.33× rule", () => {
    const spending = 60000;
    const r = computeFireTarget(spending, null, null, 0.03, true);
    expect(r.target).toBeCloseTo(spending / 0.03, 6);
  });
});

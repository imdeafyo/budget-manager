/* Phase 15 — Tax-aware FIRE target.

   The classic FIRE rule (25× annual spending) ignores taxes on withdrawals.
   For a portfolio sitting in Traditional 401(k)/IRA, every withdrawn dollar
   incurs ordinary income tax — which means the gross withdrawal needed to
   cover $X of spending is more than $X. For Roth/HSA, the gross equals the
   net. For taxable brokerage, LTCG applies.

   This module computes a BLENDED effective tax rate based on the account
   mix at FI, then grosses up the spending need iteratively (because tax
   depends on gross need which depends on tax), and divides by the safe
   withdrawal rate to get the target.

   We deliberately do NOT model withdrawal ORDER (Roth conversion ladders,
   taxable-first drawdown, etc.) — that's a retirement-execution decision,
   not a planning-time question. The pro-rata blend is the "no optimization"
   baseline; any tax-savvy retiree will do better than this estimate, which
   is the right direction for a conservative target.

   Assumptions documented inline in the UI:
   - Current-year federal + state brackets (no projection of future tax law)
   - Standard deduction applied to ordinary income portion
   - LTCG rate flat 15% federal (configurable), states tax LTCG as ordinary
   - HSA assumed qualified medical (tax-free)
   - SS / Medicare not applied (retirees don't pay payroll on withdrawals) */

import { TAX_DB, ACCOUNT_TYPE_TO_TAX_CHARACTER } from "../data/taxDB.js";
import { calcFed, calcStateTax } from "./calc.js";

const TAX_CHARACTERS = ["ordinary", "ltcg", "taxfree"];

/* Compute the mix of withdrawal tax character from a set of accounts.
   `accounts` is an array of { type, balance } objects (or any object with
   those keys — extra fields ignored). Returns { ordinary, ltcg, taxfree }
   as fractions summing to 1.0 (or all zeros if total balance is 0). */
export function computeTaxCharacterMix(accounts) {
  const mix = { ordinary: 0, ltcg: 0, taxfree: 0 };
  if (!Array.isArray(accounts) || accounts.length === 0) return mix;
  let total = 0;
  const byChar = { ordinary: 0, ltcg: 0, taxfree: 0 };
  for (const a of accounts) {
    const bal = Number(a?.balance) || 0;
    if (bal <= 0) continue; // negative balances (underwater) don't fund withdrawals
    const char = ACCOUNT_TYPE_TO_TAX_CHARACTER[a?.type] || "ordinary";
    byChar[char] = (byChar[char] || 0) + bal;
    total += bal;
  }
  if (total <= 0) return mix;
  return {
    ordinary: byChar.ordinary / total,
    ltcg:     byChar.ltcg     / total,
    taxfree:  byChar.taxfree  / total,
  };
}

/* Extract the projected account mix at a given forecast year from a
   forecastGrowthAccounts result. If `year` is null or undefined, uses the
   final year. Returns the same shape as computeTaxCharacterMix. */
export function extractMixFromProjection(accounts, accountSeries, year) {
  if (!Array.isArray(accounts) || !accountSeries) {
    return { ordinary: 0, ltcg: 0, taxfree: 0 };
  }
  const balsByType = [];
  for (const a of accounts) {
    const series = accountSeries[a.id];
    if (!Array.isArray(series) || series.length === 0) continue;
    let row;
    if (year == null) {
      row = series[series.length - 1];
    } else {
      // Linear interp between bracketing rows for fractional years
      const yLo = Math.floor(year);
      const yHi = Math.ceil(year);
      if (yLo === yHi || yHi >= series.length) {
        row = series[Math.min(yLo, series.length - 1)] || series[series.length - 1];
      } else {
        const lo = series[yLo], hi = series[yHi];
        if (!lo || !hi) {
          row = series[Math.min(yLo, series.length - 1)] || series[series.length - 1];
        } else {
          const frac = year - yLo;
          row = { balance: lo.balance + (hi.balance - lo.balance) * frac };
        }
      }
    }
    balsByType.push({ type: a.type, balance: row?.balance ?? 0 });
  }
  return computeTaxCharacterMix(balsByType);
}

/* Estimate the federal+state tax on a gross retirement withdrawal.
   `grossNeed` = total withdrawn before tax.
   `mix` = { ordinary, ltcg, taxfree } fractions.
   `taxConfig` = {
     year: "2026",           // TAX_DB key for brackets / std deduction
     filing: "mfj" | "single",
     stateAbbr: "CO",
     ltcgRate: 0.15,         // federal LTCG rate
     stateTaxesLTCG: true,   // most states tax LTCG as ordinary income
   }
   Returns { totalTax, federalTax, stateTax, ordinaryIncome, ltcgIncome,
            taxfreeIncome, effectiveRate, ordinaryTaxable }. */
export function estimateRetirementTax(grossNeed, mix, taxConfig) {
  const need = Math.max(0, Number(grossNeed) || 0);
  const m = mix || { ordinary: 0, ltcg: 0, taxfree: 0 };
  const cfg = taxConfig || {};
  const filing = cfg.filing === "single" ? "single" : "mfj";
  const yearKey = String(cfg.year || "2026");
  const ltcgRate = Number(cfg.ltcgRate);
  const stateLTCG = cfg.stateTaxesLTCG !== false; // default true
  const stateAbbr = cfg.stateAbbr || "";

  const ordinaryIncome = need * (Number(m.ordinary) || 0);
  const ltcgIncome     = need * (Number(m.ltcg)     || 0);
  const taxfreeIncome  = need * (Number(m.taxfree)  || 0);

  const taxRow = TAX_DB[yearKey] || TAX_DB["2026"];
  const fedBrackets = filing === "mfj" ? taxRow.fedMFJ : taxRow.fedSingle;
  const stdDed = filing === "mfj" ? taxRow.stdMFJ : taxRow.stdSingle;

  // Federal tax: ordinary at brackets, LTCG at flat rate.
  // Standard deduction applied to ordinary income only (LTCG has its own
  // 0% bracket for low total income but we conservatively apply 15% flat —
  // this is the documented limitation).
  const ordinaryTaxable = Math.max(0, ordinaryIncome - stdDed);
  const fedOrdinary = calcFed(ordinaryTaxable, fedBrackets);
  const fedLTCG = ltcgIncome * (isFinite(ltcgRate) ? ltcgRate : 0.15);
  const federalTax = fedOrdinary + fedLTCG;

  // State tax: ordinary at state brackets (state std ded handled in calcStateTax
  // already where applicable). LTCG conservatively taxed at state ordinary
  // bracket rate if `stateTaxesLTCG` (the default for most states).
  const stOrdinary = calcStateTax(ordinaryIncome, stateAbbr, filing);
  // For LTCG state tax, we approximate as: marginal state rate × ltcgIncome.
  // True calc would re-run brackets including LTCG income, but the simpler
  // approach overstates tax slightly (conservative) which is fine for FIRE.
  const stLTCG = stateLTCG
    ? calcStateTax(ordinaryIncome + ltcgIncome, stateAbbr, filing) - stOrdinary
    : 0;
  const stateTax = stOrdinary + Math.max(0, stLTCG);

  const totalTax = federalTax + stateTax;
  const effectiveRate = need > 0 ? totalTax / need : 0;

  return {
    totalTax,
    federalTax,
    stateTax,
    federalOrdinary: fedOrdinary,
    federalLTCG: fedLTCG,
    stateOrdinary: stOrdinary,
    stateLTCG: stLTCG,
    ordinaryIncome,
    ltcgIncome,
    taxfreeIncome,
    ordinaryTaxable,
    effectiveRate,
  };
}

/* Iteratively gross up `spending` until totalTax converges.
   Each iteration: grossNeed_next = spending + estimateRetirementTax(grossNeed_cur).
   Converges geometrically; 6 iterations is enough for sub-dollar precision
   in realistic ranges. Returns the final tax breakdown plus the converged
   grossNeed. */
export function grossUpForTaxes(spending, mix, taxConfig, maxIter = 6) {
  const s = Math.max(0, Number(spending) || 0);
  if (s === 0) {
    return {
      grossNeed: 0,
      tax: estimateRetirementTax(0, mix, taxConfig),
      iterations: 0,
    };
  }
  let grossNeed = s;
  let tax = estimateRetirementTax(grossNeed, mix, taxConfig);
  let iter = 0;
  for (iter = 1; iter <= maxIter; iter++) {
    const nextGross = s + tax.totalTax;
    if (Math.abs(nextGross - grossNeed) < 0.5) {
      grossNeed = nextGross;
      tax = estimateRetirementTax(grossNeed, mix, taxConfig);
      break;
    }
    grossNeed = nextGross;
    tax = estimateRetirementTax(grossNeed, mix, taxConfig);
  }
  return { grossNeed, tax, iterations: iter };
}

/* Top-level FIRE target calculation.
   Inputs:
     - spending: annual after-tax spending need (today's dollars)
     - mix: tax character mix { ordinary, ltcg, taxfree } from
       computeTaxCharacterMix or extractMixFromProjection
     - taxConfig: see estimateRetirementTax
     - swr: safe withdrawal rate as decimal (0.04 = 4%)
     - useSimpleMultiplier: when true, skips all tax math and returns
       spending / swr as the target (i.e. the classic 25× rule at 4%).
   Returns:
     {
       target,              // dollar amount portfolio must reach
       multiplierEquivalent,// target / spending, for display
       grossNeed,           // spending + tax (gross withdrawal needed)
       spending,            // echoed input
       tax,                 // estimateRetirementTax result, or null in simple mode
       mix,                 // echoed mix
       swr,                 // echoed
       simpleMode,          // true if useSimpleMultiplier
     } */
export function computeFireTarget(spending, mix, taxConfig, swr, useSimpleMultiplier) {
  const s = Math.max(0, Number(spending) || 0);
  const w = Number(swr) > 0 ? Number(swr) : 0.04;
  if (useSimpleMultiplier) {
    const target = s / w;
    return {
      target,
      multiplierEquivalent: s > 0 ? target / s : 0,
      grossNeed: s,
      spending: s,
      tax: null,
      mix,
      swr: w,
      simpleMode: true,
    };
  }
  const { grossNeed, tax } = grossUpForTaxes(s, mix, taxConfig);
  const target = grossNeed / w;
  return {
    target,
    multiplierEquivalent: s > 0 ? target / s : 0,
    grossNeed,
    spending: s,
    tax,
    mix,
    swr: w,
    simpleMode: false,
  };
}

export { TAX_CHARACTERS };

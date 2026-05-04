import { STATE_BRACKETS } from "../data/taxDB.js";

/* ── Formula eval: strips commas, evaluates math, returns number ── */
export function evalF(str) {
  if (typeof str === "number") return str;
  const s = String(str).replace(/,/g, "").trim();
  if (!s) return 0;
  if (/^[\d\s+\-*/().]+$/.test(s)) {
    try { const r = Function('"use strict";return(' + s + ')')(); return typeof r === "number" && isFinite(r) ? r : 0; } catch { return 0; }
  }
  return parseFloat(s) || 0;
}

/* Resolve formula to display value on blur — stores original in 'f' field */
export function resolveFormula(str) {
  if (typeof str === "number") return String(str);
  const s = String(str).replace(/,/g, "").trim();
  if (!s) return "0";
  if (/[+\-*/()]/.test(s) && /^[\d\s+\-*/().]+$/.test(s)) {
    const v = evalF(s);
    return String(Math.round(v * 100) / 100);
  }
  return s;
}

export function calcMatch(empPct, tiers, base) {
  let match = base, remaining = empPct, prev = 0;
  for (const tier of tiers) { const band = tier.upTo - prev; const used = Math.min(Math.max(remaining, 0), band); match += used * tier.rate; remaining -= used; prev = tier.upTo; if (remaining <= 0) break; }
  return match;
}

export function calcFed(ti, br) { let t = 0; for (const [mn, mx, r] of br) { if (ti <= mn) break; t += (Math.min(ti, mx) - mn) * r; } return t; }
export function getMarg(ti, br) { for (let i = br.length - 1; i >= 0; i--) if (ti > br[i][0]) return br[i][2]; return .10; }

export function calcStateTax(taxableIncome, stateAbbr, filing) {
  const st = STATE_BRACKETS[stateAbbr];
  if (!st || !st.single || st.single.length === 0) return 0;
  const br = (filing === "mfj" && st.mfj) || st.single;
  return calcFed(Math.max(0, taxableIncome), br);
}

export function getStateMarg(taxableIncome, stateAbbr, filing) {
  const st = STATE_BRACKETS[stateAbbr];
  if (!st || !st.single || st.single.length === 0) return 0;
  const br = (filing === "mfj" && st.mfj) || st.single;
  return getMarg(Math.max(0, taxableIncome), br);
}

/* ── Period conversion: convert entered value to WEEKLY ── */
export function toWk(val, p) {
  const v = evalF(val);
  if (p === "m") return v * 12 / 48; // monthly to weekly: monthly*12months/48paychecks
  if (p === "y") return v / 48;       // yearly to weekly: yearly/48paychecks
  return v;
}

/* Convert weekly to display period */
export function fromWk(wk, p) {
  if (p === "m") return wk * 48 / 12;
  if (p === "y") return wk * 48;
  return wk;
}

export const fmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
export const fp = n => `${(n * 100).toFixed(2)}%`;
export const p2 = n => `${(+n).toFixed(2)}%`;
export const pctOf = (part, total) => total > 0 ? `${(part / total * 100).toFixed(1)}%` : "0%";

/* ── Pure recalcMilestone: recomputes aggregate fields on a milestone ──
   Mirrors the main C calculation exactly: pre-tax deductions and 401(k) pre-tax
   contributions reduce taxable income AND net pay; post-tax deductions and Roth
   contributions reduce net pay but not taxable income. Bonus is taxed at marginal
   rates (fed, SS if under cap, Medicare, state incremental, payroll).
   Inputs are passed explicitly so this function is pure and testable. */
export function recalcMilestonePure(mObj, ctx) {
  const { tax, allTaxDB, fil, TAX_DB_FALLBACK } = ctx;
  const it = mObj.items || {};
  let nec = 0, dis = 0, sv = 0;
  Object.values(it).forEach(x => { if (x.t === "N") nec += x.v || 0; else if (x.t === "D") dis += x.v || 0; else sv += x.v || 0; });
  const sCS = mObj.cSalary !== undefined ? mObj.cSalary : (mObj.cGrossW || 0) * 52;
  const sKS = mObj.kSalary !== undefined ? mObj.kSalary : (mObj.kGrossW || 0) * 52;
  const sYr = mObj.date ? mObj.date.slice(0, 4) : tax.year;
  const sTD = allTaxDB[sYr] || allTaxDB[tax.year] || TAX_DB_FALLBACK;
  const sF = mObj.fil || fil;
  const sP1 = mObj.p1State || (tax.p1State || {});
  const sP2 = mObj.p2State || (tax.p2State || {});
  const sw1 = sCS / 52, sw2 = sKS / 52;
  const fs = mObj.fullState || {};
  const mPreDed = fs.preDed || [];
  const mPostDed = fs.postDed || [];
  const cPreW = mPreDed.reduce((s, d) => s + evalF(d.c), 0);
  const kPreW = mPreDed.reduce((s, d) => s + evalF(d.k), 0);
  const c4prePct = Math.min(evalF(fs.c4pre || 0) / 100, 1);
  const c4roPct = Math.min(evalF(fs.c4ro || 0) / 100, 1);
  const k4prePct = Math.min(evalF(fs.k4pre || 0) / 100, 1);
  const k4roPct = Math.min(evalF(fs.k4ro || 0) / 100, 1);
  const c4preW = sCS * c4prePct / 52, c4roW = sCS * c4roPct / 52;
  const k4preW = sKS * k4prePct / 52, k4roW = sKS * k4roPct / 52;
  const cTxW = sw1 - cPreW - c4preW, kTxW = sw2 - kPreW - k4preW;
  const sBr = sF === "mfj" ? sTD.fedMFJ : sTD.fedSingle;
  const sSd = sF === "mfj" ? sTD.stdMFJ : sTD.stdSingle;
  const sCTA = (cTxW + kTxW) * 52;
  const sFT = sF === "mfj" ? calcFed(Math.max(0, sCTA - sSd), sBr) : calcFed(Math.max(0, cTxW * 52 - sTD.stdSingle), sTD.fedSingle) + calcFed(Math.max(0, kTxW * 52 - sTD.stdSingle), sTD.fedSingle);
  const sR = sTD.ssRate / 100, mR = sTD.medRate / 100;
  const sT = cTxW + kTxW, sC = sT > 0 ? cTxW / sT : 0.5;
  const f1 = (sFT / 52) * sC, f2 = (sFT / 52) * (1 - sC);
  const ss1 = Math.min(sw1, sTD.ssCap / 52) * sR, ss2 = Math.min(sw2, sTD.ssCap / 52) * sR;
  const mc1 = sw1 * mR, mc2 = sw2 * mR;
  const st1 = calcStateTax(cTxW * 52, sP1.abbr || "", sF) / 52;
  const st2 = calcStateTax(kTxW * 52, sP2.abbr || "", sF) / 52;
  const fl1 = sw1 * (sP1.famli || 0) / 100, fl2 = sw2 * (sP2.famli || 0) / 100;
  const n1 = sw1 - cPreW - c4preW - c4roW - f1 - ss1 - mc1 - st1 - fl1 - mPostDed.reduce((s, d) => s + evalF(d.c), 0);
  const n2 = sw2 - kPreW - k4preW - k4roW - f2 - ss2 - mc2 - st2 - fl2 - mPostDed.reduce((s, d) => s + evalF(d.k), 0);
  const nW = n1 + n2;
  const gW = sw1 + sw2;
  const eW = (nec + dis) / 48;
  const sW = sv / 48;
  const rW = nW - eW - sW;
  const cBonusPct = mObj.cEaipPct !== undefined ? mObj.cEaipPct : (mObj.fullState?.cEaip !== undefined ? evalF(mObj.fullState.cEaip) : 0);
  const kBonusPct = mObj.kEaipPct !== undefined ? mObj.kEaipPct : (mObj.fullState?.kEaip !== undefined ? evalF(mObj.fullState.kEaip) : 0);
  const cBonusGross = sCS * cBonusPct / 100;
  const kBonusGross = sKS * kBonusPct / 100;
  const mr = getMarg(Math.max(0, sCTA - sSd), sBr);
  const cBonusTax = cBonusGross * mr + Math.max(0, Math.min(cBonusGross, Math.max(0, sTD.ssCap - sCS))) * sR + cBonusGross * mR + (cBonusGross > 0 ? calcStateTax(cTxW * 52 + cBonusGross, sP1.abbr || "", sF) - calcStateTax(cTxW * 52, sP1.abbr || "", sF) : 0) + cBonusGross * (sP1.famli || 0) / 100;
  const kBonusTax = kBonusGross * mr + Math.max(0, Math.min(kBonusGross, Math.max(0, sTD.ssCap - sKS))) * sR + kBonusGross * mR + (kBonusGross > 0 ? calcStateTax(kTxW * 52 + kBonusGross, sP2.abbr || "", sF) - calcStateTax(kTxW * 52, sP2.abbr || "", sF) : 0) + kBonusGross * (sP2.famli || 0) / 100;
  const cBonusNet = cBonusGross - cBonusTax;
  const kBonusNet = kBonusGross - kBonusTax;
  const totalSavPlusRem = sW + Math.max(0, rW);
  return {
    ...mObj,
    necW: nec / 48, disW: dis / 48, expW: eW, savW: sW, remW: rW,
    netW: nW, grossW: gW, cNetW: n1, kNetW: n2, cGrossW: sw1, kGrossW: sw2,
    savRate: nW > 0 ? (totalSavPlusRem / nW * 100) : 0,
    savRateGross: gW > 0 ? (totalSavPlusRem / gW * 100) : 0,
    eaipGross: cBonusGross + kBonusGross, eaipNet: cBonusNet + kBonusNet,
    cEaipNet: cBonusNet, kEaipNet: kBonusNet,
    cEaipPct: cBonusPct, kEaipPct: kBonusPct,
  };
}

/* Backward-compat alias. The function was renamed during the snapshot→milestone
   rename. Safe to remove after a release once nothing imports the old name. */
export const recalcSnapPure = recalcMilestonePure;

/* ── Forecast math: compound growth with periodic contributions ──
   Standard future-value formula for a growing annuity (monthly contribution +
   monthly compounding). Returns array of:
     { year, nominal, real, contributions, realContributions }
   for years 0..horizon inclusive.

   Fields:
     nominal             — account-statement balance in year-y dollars
     real                — same balance expressed in today's purchasing power
     contributions       — cumulative nominal contributions (mixed-vintage $)
     realContributions   — cumulative contributions deflated to today's $.
                           Each year's contribution is worth less in today's
                           terms the further out it is, so the running total
                           is depressed relative to the nominal sum.

   Why both contribution columns? `contributions` matches Investment Growth
   (a same-vintage nominal comparison: nominal balance − nominal contribs).
   `realContributions` matches the "is my purchasing power actually growing?"
   comparison: real balance − real contributions. Comparing real balance to
   nominal contributions is apples-to-oranges and used to make modest-return
   scenarios look like losses when they weren't.

   `annualContribution` is total saved per year, `initialBalance` is starting
   principal (treated as already in today's dollars at year 0), `returnPct`
   and `inflationPct` are annual percentages (e.g. 7 for 7%).

   `contributionGrowthPct` (optional, default 0) is the annual nominal growth
   of contributions — modeling raises and salary-tied savings (401k%, HSA,
   bonus%, employer match all scale with salary). Year-y annual contribution
   becomes `annualContribution × (1+g)^y`. To model "real contribution flat"
   set g equal to inflation. To model real career growth, set g above
   inflation. */
export function forecastGrowth(initialBalance, annualContribution, returnPct, inflationPct, horizonYears, contributionGrowthPct = 0) {
  const r = returnPct / 100;
  const i = inflationPct / 100;
  const g = contributionGrowthPct / 100;
  const monthlyR = Math.pow(1 + r, 1 / 12) - 1;
  const out = [];
  let bal = initialBalance;
  let contribTotal = initialBalance;
  let realContribTotal = initialBalance; // year-0 dollars are today's dollars
  out.push({ year: 0, nominal: bal, real: bal, contributions: contribTotal, realContributions: realContribTotal });
  for (let y = 1; y <= horizonYears; y++) {
    // Year-y annual contribution scales by (1+g)^(y-1) so year 1 uses the
    // base amount unchanged. Pick the index convention that makes "no
    // growth" (g=0) a no-op — and that puts the first raise at year 2.
    const yearAnnual = annualContribution * Math.pow(1 + g, y - 1);
    const monthlyC = yearAnnual / 12;
    for (let m = 0; m < 12; m++) {
      bal = bal * (1 + monthlyR) + monthlyC;
    }
    contribTotal += yearAnnual;
    // Deflate this year's contribution to today's purchasing power. We treat
    // the full annual amount as occurring at year-end for symmetry with the
    // way `real` is computed (end-of-year balance ÷ (1+i)^y). Sub-yearly
    // precision doesn't change the comparison meaningfully.
    realContribTotal += yearAnnual / Math.pow(1 + i, y);
    const real = bal / Math.pow(1 + i, y);
    out.push({ year: y, nominal: bal, real, contributions: contribTotal, realContributions: realContribTotal });
  }
  return out;
}

/* ── Time to reach target (in years). Returns null if target unreachable
   with given return and contribution. Uses same monthly-compounding model. */
export function yearsToTarget(initialBalance, annualContribution, returnPct, targetAmount, maxYears = 100) {
  if (initialBalance >= targetAmount) return 0;
  const r = returnPct / 100;
  const monthlyR = Math.pow(1 + r, 1 / 12) - 1;
  const monthlyC = annualContribution / 12;
  let bal = initialBalance;
  for (let m = 1; m <= maxYears * 12; m++) {
    bal = bal * (1 + monthlyR) + monthlyC;
    if (bal >= targetAmount) return m / 12;
  }
  return null;
}

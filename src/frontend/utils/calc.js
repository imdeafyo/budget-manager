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
/* Compact currency for axis labels: $10.8M / $1.2M / $450k / $300.
   Prefers one decimal in the millions/thousands range when it adds info,
   integer otherwise. Negative passthrough. */
export const fmtCompact = n => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`.replace(/\.?0+M$/, "M");
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
};
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

/* ── Account-based forecast (advanced mode) ──
   Projects per-account compound growth with per-pool IRS limit enforcement.

   Each account has its own startBalance, annualReturn, annual contribution,
   and annual contribution increase (compounding). Contributions are checked
   against per-person/per-pool IRS limits each year — when capAtLimit is
   true on an account, that account's contribution is reduced to fit within
   the remaining pool budget.

   Pool grouping rules (see ACCOUNT_TYPE_TO_POOL in taxDB.js):
     - 401k_pretax + 401k_roth share a per-person pool (401k_employee)
     - ira_traditional + ira_roth share a per-person pool (ira)
     - hsa accounts share a household pool
     - taxable / cash / custom: no pool, no limit

   Capping algorithm per pool per year:
     1. Compute each account's desired contribution (base × (1+increase)^(y-1))
     2. Sum desired contributions in the pool
     3. If total ≤ pool limit, no cap needed
     4. Else: sort accounts in pool by desired (descending). For each
        account with capAtLimit=true, reduce proportionally so the pool
        total fits. Accounts with capAtLimit=false are honored as-is and
        the remaining cap budget is distributed across the rest.
        (If non-capped accounts already exceed the limit, capped accounts
        contribute zero — we don't go negative.)

   Pool resolution requires the year (limits change), the owner's age
   (catch-up tiers), and HSA coverage type. Owner ages are derived from
   `tax.p1BirthYear` / `tax.p2BirthYear` + the projection year. Joint-owner
   accounts use the older of the two ages for catch-up purposes (more
   generous; matches how IRS treats household HSAs).

   Inputs:
     accounts          — array of account objects (see defaultForecastAccounts)
     years             — projection horizon (integer)
     opts              — {
       baseYear,           // calendar year of year-0 (e.g. 2026)
       inflationPct,       // annual % for real-dollar conversion
       p1BirthYear,        // for catch-up tier resolution; null = no catch-up
       p2BirthYear,
       hsaCoverage,        // "family" | "self" | "both-self"
       getPoolLimit,       // injected from taxDB to keep calc.js dependency-free
     }

   Returns:
     {
       years: [{ year, calendarYear, byAccount, byPool, totals }],
       accountSeries: { [acctId]: [{ year, balance, real, contribution, contribCum, capped }] },
       poolWarnings: [{ year, pool, owner, requested, limit, capped }],
     }
   `byAccount`, `byPool`, `totals` each contain { nominal, real, contributions }
   (real contributions are deflated to today's dollars). */
export function forecastGrowthAccounts(accounts, years, opts) {
  const {
    baseYear = new Date().getFullYear(),
    inflationPct = 0,
    p1BirthYear = null,
    p2BirthYear = null,
    hsaCoverage = "family",
    getPoolLimit, // function(pool, year, age, hsaCoverage) -> limit
    accountTypeToPool, // map: type -> pool name | null
    /* Annual % growth applied to IRS limits for years strictly after the
       baseYear (today's actual limits are used for the current year). The
       underlying limit tables stop in the most recent known IRS year, and
       fall back to that year's value for future calls. We compound on top
       of that fallback. Round to nearest $500 (IRS rounds $401(k) to $500
       and HSA to $50; rounding all to $500 is a fine projection
       simplification). */
    limitGrowthPct = 0,
  } = opts || {};

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { years: [], accountSeries: {}, poolWarnings: [] };
  }
  if (typeof getPoolLimit !== "function" || !accountTypeToPool) {
    throw new Error("forecastGrowthAccounts requires getPoolLimit and accountTypeToPool in opts");
  }

  const i = inflationPct / 100;
  const lg = (Number(limitGrowthPct) || 0) / 100;
  /* Growth-aware limit lookup. For calendarYear == baseYear we use the
     unmodified table value (real current-year limit). For future years we
     take the table value at the LATEST known year (which is what
     getPoolLimit already falls back to for futures) and compound from
     baseYear forward, then round to nearest $500.
     Rationale: caller's getPoolLimit returns today's limit for futures;
     we then layer growth on top. This is correct as long as the table's
     latest year is roughly today — true by construction (taxDB updates
     yearly). */
  const limitFor = (pool, calendarYear, age) => {
    const raw = getPoolLimit(pool, calendarYear, age, hsaCoverage);
    if (!isFinite(raw)) return raw;
    const yearsForward = calendarYear - baseYear;
    if (lg === 0 || yearsForward <= 0) return raw;
    const grown = raw * Math.pow(1 + lg, yearsForward);
    return Math.round(grown / 500) * 500;
  };
  const ageOf = (owner, calendarYear) => {
    if (owner === "p1" && p1BirthYear) return calendarYear - p1BirthYear;
    if (owner === "p2" && p2BirthYear) return calendarYear - p2BirthYear;
    if (owner === "joint") {
      // For HSA / shared accounts, use the older participant for the most
      // generous catch-up (matches IRS rule: HSA catch-up is per-account-holder).
      if (p1BirthYear && p2BirthYear) return calendarYear - Math.min(p1BirthYear, p2BirthYear);
      if (p1BirthYear) return calendarYear - p1BirthYear;
      if (p2BirthYear) return calendarYear - p2BirthYear;
    }
    return null;
  };

  // Initialize per-account balances and series
  const balances = {};
  const cumContribs = {};
  const accountSeries = {};
  for (const a of accounts) {
    balances[a.id] = Number(a.startBalance) || 0;
    cumContribs[a.id] = 0;
    accountSeries[a.id] = [{ year: 0, balance: balances[a.id], real: balances[a.id], contribution: 0, contribCum: 0, capped: false }];
  }

  const yearRows = [{
    year: 0,
    calendarYear: baseYear,
    byAccount: Object.fromEntries(accounts.map(a => [a.id, { nominal: balances[a.id], real: balances[a.id], contribution: 0, contribCum: 0 }])),
    byPool: {},
    totals: {
      nominal: accounts.reduce((s, a) => s + balances[a.id], 0),
      real: accounts.reduce((s, a) => s + balances[a.id], 0),
      contributions: 0,
    },
  }];
  const poolWarnings = [];

  for (let y = 1; y <= years; y++) {
    const calendarYear = baseYear + y;

    // 1. Compute desired contribution for each account this year.
    const desired = {}; // acctId -> desired contribution
    for (const a of accounts) {
      const base = Number(a.contribAmount) || 0;
      const incr = (Number(a.annualIncrease) || 0) / 100;
      // Year-y increase compounds from year 1 (year 1 uses base unchanged).
      desired[a.id] = base * Math.pow(1 + incr, y - 1);
    }

    // 2. Group by pool key. Pool key = pool + owner (for per-person pools)
    //    or just pool (for household pools like HSA).
    const poolKey = (a) => {
      const pool = accountTypeToPool[a.type];
      if (!pool) return null;
      if (pool === "hsa") return "hsa"; // household
      return `${pool}::${a.owner}`;
    };

    const poolGroups = {}; // poolKey -> { pool, owner, accounts: [] }
    for (const a of accounts) {
      const k = poolKey(a);
      if (!k) continue;
      const pool = accountTypeToPool[a.type];
      if (!poolGroups[k]) poolGroups[k] = { pool, owner: a.owner, accounts: [] };
      poolGroups[k].accounts.push(a);
    }

    // 3. Apply caps per pool.
    const finalContrib = { ...desired };
    for (const [k, group] of Object.entries(poolGroups)) {
      const age = ageOf(group.accounts[0].owner === "joint" ? "joint" : group.owner, calendarYear);
      const limit = limitFor(group.pool, calendarYear, age);
      const total = group.accounts.reduce((s, a) => s + desired[a.id], 0);
      if (!isFinite(limit) || total <= limit) continue;

      // Some accounts in the pool requested more than the limit. Honor
      // un-capped accounts first, then proportionally scale capped ones to
      // fit the remainder.
      const uncapped = group.accounts.filter(a => !a.capAtLimit);
      const capped = group.accounts.filter(a => a.capAtLimit);
      const uncappedTotal = uncapped.reduce((s, a) => s + desired[a.id], 0);
      const remaining = Math.max(0, limit - uncappedTotal);
      const cappedTotal = capped.reduce((s, a) => s + desired[a.id], 0);

      if (cappedTotal > 0) {
        const scale = Math.min(1, remaining / cappedTotal);
        for (const a of capped) {
          finalContrib[a.id] = desired[a.id] * scale;
        }
      }

      poolWarnings.push({
        year: y,
        calendarYear,
        pool: group.pool,
        owner: group.accounts[0].owner === "joint" ? "joint" : group.owner,
        requested: total,
        limit,
        capped: total - group.accounts.reduce((s, a) => s + finalContrib[a.id], 0),
      });
    }

    // 4. Apply growth + contributions per account (monthly compounding).
    const byAccount = {};
    const byPool = {};
    let totalNominal = 0;
    let totalReal = 0;
    let totalContrib = 0;

    for (const a of accounts) {
      const r = (Number(a.annualReturn) || 0) / 100;
      const monthlyR = Math.pow(1 + r, 1 / 12) - 1;
      const yearAnnual = finalContrib[a.id];
      const monthlyC = yearAnnual / 12;
      let bal = balances[a.id];
      for (let m = 0; m < 12; m++) {
        bal = bal * (1 + monthlyR) + monthlyC;
      }
      balances[a.id] = bal;
      cumContribs[a.id] += yearAnnual;
      const real = bal / Math.pow(1 + i, y);
      const wasCapped = (desired[a.id] - finalContrib[a.id]) > 0.01;
      accountSeries[a.id].push({
        year: y,
        balance: bal,
        real,
        contribution: yearAnnual,
        contribCum: cumContribs[a.id],
        capped: wasCapped,
        desiredContribution: desired[a.id],
      });
      byAccount[a.id] = { nominal: bal, real, contribution: yearAnnual, contribCum: cumContribs[a.id] };

      const poolName = accountTypeToPool[a.type] || "taxable";
      if (!byPool[poolName]) byPool[poolName] = { nominal: 0, real: 0, contribution: 0 };
      byPool[poolName].nominal += bal;
      byPool[poolName].real += real;
      byPool[poolName].contribution += yearAnnual;

      totalNominal += bal;
      totalReal += real;
      totalContrib += yearAnnual;
    }

    yearRows.push({
      year: y,
      calendarYear,
      byAccount,
      byPool,
      totals: { nominal: totalNominal, real: totalReal, contributions: totalContrib },
    });
  }

  return { years: yearRows, accountSeries, poolWarnings };
}

/* ── How many years until annual contribution hits the pool limit? ──
   Given a base contribution, an annual % increase, and a pool/age, returns
   the year (integer) in which `base × (1+incr)^(year-1)` first equals or
   exceeds the limit. Returns null if the base is already at/over, or if it
   never reaches within `maxYears` (no growth or growth too slow).

   Used for the "you'll hit the limit in year N" UI hint next to each
   account's contribution input. */
export function yearsToHitPoolLimit(base, annualIncreasePct, limit, maxYears = 100) {
  if (!isFinite(limit)) return null;
  if (base <= 0) return null;
  if (base >= limit) return 0;
  const incr = annualIncreasePct / 100;
  if (incr <= 0) return null; // flat contribution can never reach a higher limit
  for (let y = 1; y <= maxYears; y++) {
    const v = base * Math.pow(1 + incr, y - 1);
    if (v >= limit) return y;
  }
  return null;
}

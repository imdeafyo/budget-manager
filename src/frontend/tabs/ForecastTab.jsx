import { useMemo, useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { Card, NI } from "../components/ui.jsx";
import { forecastGrowth, fmt, fmtCompact, evalF, forecastGrowthAccounts } from "../utils/calc.js";
import { actualAnnualContribution } from "../utils/forecastActuals.js";
import { computeFireTarget, computeTaxCharacterMix, extractMixFromProjection } from "../utils/fireTarget.js";
import { ACCOUNT_TYPE_TO_POOL, getPoolLimit, defaultForecastAccounts } from "../data/taxDB.js";

export default function ForecastTab({ mob, C, tSavW, remW, tExpW, totalSavPlusRemW, includeEaip, transactions = [], cats = [], savCats = [], transferCats = [], incomeCats = [], preDed = [], hsaEmployerMatchAnnual = 0, forecast = {}, setForecast, tax = {}, setTax, p1Name = "Person 1", p2Name = "Person 2", cSal = "0", kSal = "0", c4pre = "0", c4ro = "0", k4pre = "0", k4ro = "0" }) {
  /* Scenario inputs live on st.forecast.* so they sync across devices.
     Display-only prefs (e.g. showChartLegend) stay in localStorage.
     Each scenario field has a derived value + a setter that calls
     setForecast(prev => ({ ...prev, [key]: v })). Variable names mirror
     the old local-state names so the rest of the file is unchanged. */
  const F = forecast || {};
  const setFc = (key, v) => setForecast && setForecast(prev => ({ ...(prev || {}), [key]: v }));

  const returnPct = F.returnPct ?? "7";
  const setReturnPct = (v) => setFc("returnPct", v);
  const inflationPct = F.inflationPct ?? "3";
  const setInflationPct = (v) => setFc("inflationPct", v);
  // Phase 7: nominal income growth rate. Default 3% to match inflation default —
  // at defaults this means real contributions roughly flat (matches old
  // behavior). Setting above inflation models real career growth (raises that
  // beat cost-of-living); setting below models stagnation. Applied to total
  // annual contribution, which approximates well — most savings flows scale
  // with salary (take-home, 401k%, HSA, bonus%, employer match). The flat
  // HSA employer match is technically over-credited but the error is tiny.
  const incomeGrowthPct = F.incomeGrowthPct ?? "3";
  const setIncomeGrowthPct = (v) => setFc("incomeGrowthPct", v);
  const initialBalance = F.initialBalance ?? "0";
  const setInitialBalance = (v) => setFc("initialBalance", v);
  const horizon = F.horizon ?? 30;
  const setHorizon = (v) => setFc("horizon", v);
  const valueMode = F.valueMode ?? "both"; // both | nominal | real
  const setValueMode = (v) => setFc("valueMode", v);
  // Legend visibility on the compound-growth chart. Per-device, persisted.
  // Default ON for first-time discoverability. Stays in localStorage —
  // this is a display preference, not a scenario input.
  const [showChartLegend, setShowChartLegend] = useState(() => { try { return localStorage.getItem("forecast-simple-legend") !== "0"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("forecast-simple-legend", showChartLegend ? "1" : "0"); } catch {} }, [showChartLegend]);
  const targetMonths = F.targetMonths ?? "12";
  const setTargetMonths = (v) => setFc("targetMonths", v);
  // Phase 7: contribution source — "budget" | "actual3" | "actual6" | "actual12"
  const contribSource = F.contribSource ?? "budget";
  const setContribSource = (v) => setFc("contribSource", v);
  // Phase 7: actuals mode — "net" (income − expenses) | "expenses" (budgeted income − expenses)
  // Only meaningful when contribSource !== "budget".
  const actualMode = F.actualMode ?? "net";
  const setActualMode = (v) => setFc("actualMode", v);
  // Phase 7: forecast-local pay cadence — 48 (paycheck) or 52 (calendar). Default 52.
  // Calendar is more honest for compound growth; 48 matches the rest of the app's
  // budget cadence. This is intentionally independent from the rest of the app's
  // visCols 48/52 toggle (which is just a display unit, not a forecast assumption).
  const forecastWeeks = (F.forecastWeeks === 48 || F.forecastWeeks === 52) ? F.forecastWeeks : 52;
  const setForecastWeeks = (v) => setFc("forecastWeeks", v);
  // Phase 7: forecast-local bonus inclusion. Default OFF (conservative). Independent
  // from the global Charts-tab `includeEaip` so changing one doesn't silently move
  // the forecast number.
  const forecastBonus = !!F.forecastBonus;
  const setForecastBonus = (v) => setFc("forecastBonus", v);
  // Phase 7: retirement-contribution toggles. The base `C.net` excludes 401(k)
  // elective contributions (they're stripped pre-net), HSA (also pre-tax/pre-net),
  // and obviously employer match (never touched the paycheck). For a retirement
  // forecast you almost certainly want these IN — but they're per-toggle so the
  // user can model either "all savings" or just "after-tax savings."
  // 401(k) elective + HSA default ON (likely intent for a retirement forecast).
  // Employer match defaults ON only if a match is actually configured.
  const include401k = F.include401k !== false;
  const setInclude401k = (v) => setFc("include401k", v);
  const includeMatch = F.includeMatch !== false;
  const setIncludeMatch = (v) => setFc("includeMatch", v);
  const includeHSA = F.includeHsa !== false;
  const setIncludeHSA = (v) => setFc("includeHsa", v);
  // Phase 7: FIRE — financial independence target as multiple of annual expenses.
  // Standard FIRE = 25× (4% safe withdrawal). 28-33× for early retirement.
  // 20× = aggressive 5% withdrawal, only safe with flexibility.
  const fireEnabled = !!F.fireEnabled;
  const setFireEnabled = (v) => setFc("fireEnabled", v);
  const fireMultiplier = F.fireMultiplier ?? "25";
  const setFireMultiplier = (v) => setFc("fireMultiplier", v);

  /* Phase 15 — Tax-aware FIRE config. Lives under forecast.fireConfig so both
     Simple and Advanced tabs see the same numbers. When `useSimpleMultiplier`
     is true (escape hatch toggle), the math collapses back to the classic
     `multiplier × spending` rule and respects `fireMultiplier` above.
     Otherwise the new pipeline is used:
       - swr drives the divisor (1/swr is the "effective multiplier")
       - retirementSpendingOverride: null → use current budgeted/actual
         expenses; number → use that fixed amount in today's dollars
       - ltcgRate: long-term capital gains rate (default 0.15)
       - account mix: Simple tab approximates from a one-shot projection
         using defaultForecastAccounts seeded with initialBalance; Advanced
         uses live accountSeries at the target year. */
  const fireConfig = (F && typeof F.fireConfig === "object" && F.fireConfig) ? F.fireConfig : {};
  const setFireCfg = (key, v) => setFc("fireConfig", { ...fireConfig, [key]: v });
  const swr = (typeof fireConfig.swr === "number" && fireConfig.swr > 0) ? fireConfig.swr : 0.04;
  const setSwr = (v) => setFireCfg("swr", v);
  const useSimpleMultiplier = !!fireConfig.useSimpleMultiplier;
  const setUseSimpleMultiplier = (v) => setFireCfg("useSimpleMultiplier", v);
  // null = use current spending (default). Number = override.
  const retirementSpendingOverride = (typeof fireConfig.retirementSpendingOverride === "number") ? fireConfig.retirementSpendingOverride : null;
  const setRetirementSpendingOverride = (v) => setFireCfg("retirementSpendingOverride", v);
  const ltcgRate = (typeof fireConfig.ltcgRate === "number" && fireConfig.ltcgRate >= 0) ? fireConfig.ltcgRate : 0.15;
  const setLtcgRate = (v) => setFireCfg("ltcgRate", v);
  // Display: toggle the expanded tax breakdown card section. Per-device.
  const [showFireBreakdown, setShowFireBreakdown] = useState(() => { try { return localStorage.getItem("forecast-simple-fire-breakdown") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("forecast-simple-fire-breakdown", showFireBreakdown ? "1" : "0"); } catch {} }, [showFireBreakdown]);

  const r = evalF(returnPct);
  const i = evalF(inflationPct);
  const g = evalF(incomeGrowthPct);
  const init = evalF(initialBalance);

  /* Weekly HSA contributions: HSA lives inside preDed (pre-tax deductions),
     identified by name match — same convention as BudgetTab. Sum c+k across
     all "hsa"-named rows. The rest of preDed is non-savings (insurance,
     parking, etc.) and stays out of the contribution figure. */
  const hsaWeekly = useMemo(() => {
    if (!Array.isArray(preDed)) return 0;
    return preDed
      .filter(d => d && typeof d.n === "string" && d.n.toLowerCase().includes("hsa"))
      .reduce((s, d) => s + evalF(d.c) + evalF(d.k), 0);
  }, [preDed]);

  /* Retirement-side adders. These represent dollars going to retirement that
     don't flow through `C.net` or appear in the user's checking-account
     transaction log:
       - 401(k) elective (pre-tax + Roth, both persons) — already deducted
         from gross before C.net
       - Employer 401(k) match — never touched the paycheck
       - HSA (employee contributions via preDed + employer annual match)
     We add them as a flat annual figure to whichever base contribution
     number we computed (budget OR actuals). This avoids the semantic
     awkwardness of folding them into "income" — they're not income, they're
     savings flows the user wants the forecast to count. */
  const retirementAnnual = useMemo(() => {
    let weekly = 0;
    let annual = 0;
    if (include401k) weekly += (C.c4w || 0) + (C.k4w || 0);
    if (includeMatch) weekly += (C.cMP || 0) + (C.kMP || 0);
    if (includeHSA) {
      weekly += hsaWeekly;
      annual += Number(hsaEmployerMatchAnnual) || 0;
    }
    return weekly * forecastWeeks + annual;
  }, [include401k, includeMatch, includeHSA, C.c4w, C.k4w, C.cMP, C.kMP, hsaWeekly, hsaEmployerMatchAnnual, forecastWeeks]);

  /* Budget-based annual contribution.
     Income scales with weeks (52 calendar / 48 paycheck cadence). Expenses
     are fixed costs that don't scale with the toggle (per app convention —
     see budget tab's Y48/Y52 logic). Bonus follows this tab's local toggle.
     Retirement adders are tacked on at the end (see retirementAnnual note).
     Algebra: at 48 weeks with all retirement off, this reduces to
     (savings + remaining) × 48 + bonus, matching the prior implementation. */
  const budgetAnnualContribution = useMemo(() => {
    const incomeAnnual = (C.net || 0) * forecastWeeks;
    const expensesAnnual = tExpW * 48;
    const bonus = forecastBonus ? (C.eaipNet || 0) : 0;
    return incomeAnnual - expensesAnnual + bonus + retirementAnnual;
  }, [C.net, C.eaipNet, tExpW, forecastWeeks, forecastBonus, retirementAnnual]);

  /* Budgeted annual NET income — used by the "expenses" actuals mode as a
     stable income baseline so a one-off bonus paycheck in the window doesn't
     inflate the projection. Scales with the local weeks toggle. Bonus
     follows the local forecast bonus toggle. Retirement adders are NOT
     folded in here — they're applied to the final actuals result downstream
     (otherwise we'd double-count or distort the income figure shown in the
     explainer). */
  const budgetedAnnualIncome = useMemo(() => {
    const base = (C.net || 0) * forecastWeeks;
    const bonus = forecastBonus ? (C.eaipNet || 0) : 0;
    return base + bonus;
  }, [C.net, forecastWeeks, forecastBonus, C.eaipNet]);

  /* Actuals-based contribution: derived from transactions over a recent
     window. Returns null if there are no transactions in the window — in
     that case we fall back to the budget figure. */
  const actualsResult = useMemo(() => {
    if (contribSource === "budget") return null;
    const months = contribSource === "actual3" ? 3 : contribSource === "actual12" ? 12 : 6;
    return actualAnnualContribution({
      transactions, months, cats, savCats, transferCats, incomeCats,
      mode: actualMode, budgetedAnnualIncome,
    });
  }, [contribSource, actualMode, transactions, cats, savCats, transferCats, incomeCats, budgetedAnnualIncome]);

  /* Effective contribution used for the projection.
     - If actuals source selected and the window has data → use actuals
       PLUS retirement adders (the actuals computation only sees what's in
       the transaction log, which typically excludes 401(k)/HSA payroll
       deductions and employer match — those flow direct to retirement
       accounts and never appear in checking transactions).
     - Otherwise (budget source, or actuals window empty) → use budget
       (already retirement-aware via budgetAnnualContribution). */
  const annualContribution = useMemo(() => {
    if (contribSource !== "budget" && actualsResult) return actualsResult.annual + retirementAnnual;
    return budgetAnnualContribution;
  }, [contribSource, actualsResult, budgetAnnualContribution, retirementAnnual]);

  const usingActuals = contribSource !== "budget" && !!actualsResult;

  /* Monthly expenses for the "time to X months of expenses" calculator.
     tExpW is weekly expense base, so monthly = tExpW * 48 / 12. */
  const monthlyExpenses = useMemo(() => tExpW * 48 / 12, [tExpW]);
  const targetMonthsNum = Math.max(0, evalF(targetMonths));
  const targetAmount = monthlyExpenses * targetMonthsNum;

  /* Phase 15 — Tax-aware FIRE target.
     Spending source still follows the contribution-source toggle when the
     override is null. The override (retirementSpendingOverride) lets users
     project a different lifestyle in retirement (more travel, paid-off
     mortgage, etc.) without changing the rest of the app.

     For Simple tab, the tax-character mix is derived from the user's
     configured accounts on the Advanced tab (forecast.accounts). Falls back
     to defaultForecastAccounts() so first-time Simple users see realistic
     numbers; we estimate the projected balance at the FI year using the
     same forecastGrowthAccounts the Advanced tab uses.

     Math basis: flat target (today's dollars) compared against the REAL
     balance line (already inflation-adjusted in `forecastGrowth`). This
     means the target doesn't move on the chart; the real balance climbs
     to meet it. Years-to-FI uses real return rate (r − i) for the same
     reason: contributions and growth must keep pace with inflation in
     real terms. */
  const fireAnnualExpenses = useMemo(() => {
    if (contribSource !== "budget" && actualsResult && actualsResult.expenses > 0 && actualsResult.months > 0) {
      return actualsResult.expenses * 12 / actualsResult.months;
    }
    return tExpW * 48;
  }, [contribSource, actualsResult, tExpW]);

  // Spending used for FIRE math: override if set, else current.
  const fireSpending = useMemo(() => {
    return retirementSpendingOverride != null ? retirementSpendingOverride : fireAnnualExpenses;
  }, [retirementSpendingOverride, fireAnnualExpenses]);

  // Build tax config from the user's tax settings. Use MFJ if either bonus
  // applies, otherwise default to MFJ (the app's universe is dual-income
  // households, so MFJ is the right default).
  const taxConfig = useMemo(() => ({
    year: String(tax?.year || "2026"),
    filing: "mfj",
    // Use p1 state by default — both partners typically file from the same
    // state, and a single rate is what we want for the FIRE estimate. If
    // partners are in different states this slightly understates state
    // tax for the lower-rate partner's residence.
    stateAbbr: tax?.p1State?.abbr || tax?.p2State?.abbr || "",
    ltcgRate,
    stateTaxesLTCG: true, // conservative — most states do
  }), [tax, ltcgRate]);

  // Tax character mix derivation: project the user's Advanced accounts
  // forward to estimate balance composition at FI. For first-time users
  // with no accounts configured, seed defaults. We treat initialBalance
  // as an aggregate seed proportional to default account weights.
  const accountsForMixCalc = useMemo(() => {
    const userAccounts = (forecast && Array.isArray(forecast.accounts) && forecast.accounts.length > 0)
      ? forecast.accounts
      : defaultForecastAccounts();
    // If user has accounts but all zero startBalances, seed proportionally
    // from initialBalance so the mix calculation has something to work with.
    const totalStart = userAccounts.reduce((s, a) => s + (Number(a.startBalance) || 0), 0);
    if (totalStart > 0) return userAccounts;
    if (init <= 0) return userAccounts;
    // Distribute initialBalance equally across the default-set 401k_pretax,
    // ira_roth, and taxable buckets if user hasn't filled in balances.
    const equalShare = init / 3;
    return userAccounts.map(a => {
      if (["401k_pretax", "ira_roth", "taxable"].includes(a.type)) {
        return { ...a, startBalance: (Number(a.startBalance) || 0) + equalShare };
      }
      return a;
    });
  }, [forecast, init]);

  // Quick projection just for the mix calc. We don't need full accuracy
  // here — the proportions matter, not the absolute dollars.
  const fireMixYear = useMemo(() => {
    // Use horizon as the year (conservative — assumes user reaches FI at
    // horizon if they haven't sooner). Advanced will be more precise.
    return Math.max(1, Number(horizon) || 30);
  }, [horizon]);

  const fireAccountMix = useMemo(() => {
    if (useSimpleMultiplier) return { ordinary: 0, ltcg: 0, taxfree: 0 };
    try {
      // Lightweight projection — pure compound growth on the user's accounts.
      // No pool capping, no events, no actuals integration. Just enough to
      // see how proportions shift over time as Roth vs Traditional grow.
      const proj = forecastGrowthAccounts(accountsForMixCalc, fireMixYear, {
        baseYear: new Date().getFullYear(),
        inflationPct: 0,
        getPoolLimit: () => Infinity, // skip pool caps for mix calc
        accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
      });
      return extractMixFromProjection(accountsForMixCalc, proj.accountSeries, fireMixYear);
    } catch (e) {
      // If projection fails (defensive — shouldn't happen) fall back to
      // start-of-period mix.
      return computeTaxCharacterMix(accountsForMixCalc.map(a => ({
        type: a.type, balance: Number(a.startBalance) || 0,
      })));
    }
  }, [useSimpleMultiplier, accountsForMixCalc, fireMixYear]);

  // The new FIRE result — drives everything below.
  const fireResult = useMemo(() => {
    return computeFireTarget(fireSpending, fireAccountMix, taxConfig, swr, useSimpleMultiplier);
  }, [fireSpending, fireAccountMix, taxConfig, swr, useSimpleMultiplier]);

  const fireTarget = fireResult.target;
  const fireMultiplierNum = fireResult.multiplierEquivalent || 25;
  const fireWithdrawalRate = swr * 100;

  // Forecast must be computed before years-to-X calcs so they can derive
  // crossover years from the array (which already accounts for income
  // growth via `g`). This is more robust than calling yearsToTarget with
  // a flat contribution — that would ignore the growth toggle.
  const simpleSeriesRaw = useMemo(() => forecastGrowth(init, annualContribution, r, i, horizon, g), [init, annualContribution, r, i, horizon, g]);
  // Augment each row with the FI threshold for that year (in future $) so
  // the chart can plot it as a rising line. Same approach as Advanced — the
  // line value at year y is `fireTarget × (1 + inflation)^y`.
  const simpleSeries = useMemo(() => {
    const inflRate = (Number(inflationPct) || 0) / 100;
    const showFire = fireEnabled && fireTarget > 0;
    return simpleSeriesRaw.map(row => ({
      ...row,
      fireThresh: showFire ? fireTarget * Math.pow(1 + inflRate, row.year) : null,
    }));
  }, [simpleSeriesRaw, inflationPct, fireEnabled, fireTarget]);
  const finalRow = simpleSeries[simpleSeries.length - 1];

  // Helper: walk the forecast and find the year (with fractional precision via
  // linear interpolation between adjacent rows) when `field` first crosses
  // `target`. Returns null if not reached within horizon.
  const crossoverYear = (field, target) => {
    if (init >= target) return 0;
    for (let y = 1; y < simpleSeries.length; y++) {
      if (simpleSeries[y][field] >= target) {
        const prev = simpleSeries[y - 1][field];
        const cur = simpleSeries[y][field];
        const frac = cur > prev ? (target - prev) / (cur - prev) : 0;
        return (y - 1) + Math.max(0, Math.min(1, frac));
      }
    }
    return null;
  };

  // FIRE crossover: when does the future-$ balance reach the inflation-
  // adjusted FIRE target? Mathematically equivalent to "real balance hits
  // flat today's-$ target" but visually consistent with the chart, which
  // shows future-$ balances and a rising target line. Same paradigm as
  // Advanced — both tabs always agree on the question they're answering.
  const yearsToFire = useMemo(() => {
    if (!fireEnabled || fireTarget <= 0) return null;
    const inflRate = (Number(inflationPct) || 0) / 100;
    const targetAt = (y) => fireTarget * Math.pow(1 + inflRate, y);
    if (init >= targetAt(0)) return 0;
    for (let y = 1; y < simpleSeries.length; y++) {
      const tgt = targetAt(y);
      if (simpleSeries[y].nominal >= tgt) {
        const prev = simpleSeries[y - 1].nominal;
        const cur = simpleSeries[y].nominal;
        const frac = cur > prev ? (tgt - prev) / (cur - prev) : 0;
        return (y - 1) + Math.max(0, Math.min(1, frac));
      }
    }
    return null;
  }, [fireEnabled, fireTarget, inflationPct, simpleSeries, init]);

  // Time-to-X-months: target is X × today's monthly expenses (today's $).
  // Compared against NOMINAL balance for back-compat with the existing
  // calculator semantics. (Switching to real here would be more honest, but
  // it's a separate decision from this slice.)
  const yearsToGoal = useMemo(() => targetAmount > 0 ? crossoverYear("nominal", targetAmount) : null, [targetAmount, simpleSeries]);

  const horizonOpts = [1, 5, 10, 20, 30, 40, 50];
  const modeBtn = (mode, val, label) => (
    <button onClick={() => setValueMode(val)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: mode === val ? "#4ECDC4" : "var(--input-bg,#f5f5f5)", color: mode === val ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{label}</button>
  );
  const horizonBtn = (h) => (
    <button key={h} onClick={() => setHorizon(h)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: horizon === h ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: horizon === h ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{h}y</button>
  );
  const sourceBtn = (val, label) => (
    <button key={val} onClick={() => setContribSource(val)} style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: contribSource === val ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: contribSource === val ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{label}</button>
  );

  const cs = { background: "var(--card-bg,#fff)", color: "var(--card-color,#222)", border: "none", borderRadius: 8, fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>




      {/* Inputs card */}
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Assumptions</h3>
        <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Starting Balance</label>
            <NI value={initialBalance} onChange={setInitialBalance} onBlurResolve prefix="$" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Annual Return %</label>
            <NI value={returnPct} onChange={setReturnPct} onBlurResolve />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Inflation %</label>
            <NI value={inflationPct} onChange={setInflationPct} onBlurResolve />
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Income Growth %
              <span title={"Annual nominal growth of contributions \u2014 raises, salary-tied savings (401k%, HSA, bonus%, employer match all scale with salary).\n\n\u2022 Set equal to inflation (default) for flat real contributions\n\u2022 Set above inflation to model real career growth\n\u2022 Set to 0 to model stagnation\n\nApplied to total annual contribution; year-y contribution = base \u00d7 (1+growth)^(y-1)."} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "var(--tx3,#888)", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "help" }}>?</span>
            </label>
            <NI value={incomeGrowthPct} onChange={setIncomeGrowthPct} onBlurResolve />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Horizon</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{horizonOpts.map(horizonBtn)}</div>
          </div>
        </div>
        <div style={{ marginTop: 16, padding: 12, background: "var(--input-bg,#f8f8f8)", borderRadius: 8, fontSize: 12, color: "var(--tx2,#555)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Contribution source:</span>
            {sourceBtn("budget", "Budget")}
            {sourceBtn("actual3", "Actuals (3mo)")}
            {sourceBtn("actual6", "Actuals (6mo)")}
            {sourceBtn("actual12", "Actuals (12mo)")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Basis:</span>
            <button onClick={() => setForecastWeeks(52)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: forecastWeeks === 52 ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: forecastWeeks === 52 ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="52 calendar weeks per year. More honest for compound growth — reflects when paychecks actually arrive.">52 wk</button>
            <button onClick={() => setForecastWeeks(48)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: forecastWeeks === 48 ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: forecastWeeks === 48 ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="48 paychecks per year — matches the rest of the app's budget cadence. The 4 'extra' paychecks are absorbed into the budget cushion.">48 pc</button>
            <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 4px" }} />
            <button onClick={() => setForecastBonus(!forecastBonus)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: forecastBonus ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: forecastBonus ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Include net annual bonus in the projection. Independent from the Trends tab toggle.">Bonus: {forecastBonus ? "ON" : "OFF"}</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Retirement:</span>
            <button onClick={() => setInclude401k(!include401k)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: include401k ? "#2ECC71" : "var(--input-bg,#f5f5f5)", color: include401k ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Include both persons' 401(k) elective contributions (pre-tax + Roth). These are stripped from net pay, so the budget formula won't otherwise capture them.">401(k): {include401k ? "ON" : "OFF"}</button>
            <button onClick={() => setIncludeMatch(!includeMatch)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: includeMatch ? "#2ECC71" : "var(--input-bg,#f5f5f5)", color: includeMatch ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Include employer 401(k) match. Free money that never touches your paycheck.">Match: {includeMatch ? "ON" : "OFF"}</button>
            <button onClick={() => setIncludeHSA(!includeHSA)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: includeHSA ? "#2ECC71" : "var(--input-bg,#f5f5f5)", color: includeHSA ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Include HSA contributions (pre-tax deductions named 'HSA') plus any configured HSA employer match.">HSA: {includeHSA ? "ON" : "OFF"}</button>
          </div>
          {contribSource !== "budget" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Actuals formula:</span>
              <button onClick={() => setActualMode("net")} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: actualMode === "net" ? "#4ECDC4" : "var(--input-bg,#f5f5f5)", color: actualMode === "net" ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Actual income − actual expenses. Pairs realized income with realized spending.">Net (income − expenses)</button>
              <button onClick={() => setActualMode("expenses")} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: actualMode === "expenses" ? "#4ECDC4" : "var(--input-bg,#f5f5f5)", color: actualMode === "expenses" ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Budgeted income − actual expenses. Isolates spending discipline from income volatility (bonus paychecks won't inflate the figure).">vs Budgeted Income</button>
            </div>
          )}
          <div><strong>Annual contribution:</strong> {fmt(annualContribution)}{retirementAnnual > 0 ? ` (includes ${fmt(retirementAnnual)} retirement)` : ""}{forecastBonus && contribSource === "budget" ? " (+ bonus)" : ""}</div>
          {contribSource === "budget" && (
            <div style={{ color: "var(--tx3,#888)", fontSize: 11, marginTop: 4 }}>
              = (net income × {forecastWeeks} wk) − (expenses × 48){forecastBonus ? " + net bonus" : ""}{retirementAnnual > 0 ? ` + retirement ${fmt(retirementAnnual)}` : ""}. Expenses use 48 because budgeted expenses are fixed costs that don't scale with the weeks toggle.
            </div>
          )}
          {contribSource !== "budget" && usingActuals && actualMode === "net" && (
            <div style={{ color: "var(--tx3,#888)", fontSize: 11, marginTop: 4 }}>
              From {actualsResult.txCount} transaction{actualsResult.txCount === 1 ? "" : "s"} in the last {actualsResult.months} months ({actualsResult.fromIso} → {actualsResult.toIso}):
              income {fmt(actualsResult.income)} − expenses {fmt(actualsResult.expenses)} = {fmt(actualsResult.monthlyNet)}/mo × 12 = {fmt(actualsResult.annual)}{retirementAnnual > 0 ? ` + retirement ${fmt(retirementAnnual)}` : ""}. Budget figure for comparison: {fmt(budgetAnnualContribution)}.
            </div>
          )}
          {contribSource !== "budget" && usingActuals && actualMode === "expenses" && (
            <div style={{ color: "var(--tx3,#888)", fontSize: 11, marginTop: 4 }}>
              From {actualsResult.txCount} transaction{actualsResult.txCount === 1 ? "" : "s"} in the last {actualsResult.months} months ({actualsResult.fromIso} → {actualsResult.toIso}):
              budgeted income {fmt(budgetedAnnualIncome)} − annualized actual expenses {fmt(actualsResult.expenses * 12 / actualsResult.months)} = {fmt(actualsResult.annual)}{retirementAnnual > 0 ? ` + retirement ${fmt(retirementAnnual)}` : ""}/yr. Net-formula figure for comparison: {fmt((actualsResult.income - actualsResult.expenses) * 12 / actualsResult.months + retirementAnnual)}.
            </div>
          )}
          {contribSource !== "budget" && !usingActuals && (
            <div style={{ color: "var(--tx3,#888)", fontSize: 11, marginTop: 4 }}>
              No transactions found in the last {contribSource === "actual3" ? 3 : contribSource === "actual12" ? 12 : 6} months — falling back to budget figure.
            </div>
          )}
        </div>
      </Card>

      {/* Summary stats. Red text on nominal/real when below contributions
          (i.e. you're losing money in real terms — investment growth is
          negative). FIRE card appears at the end when enabled. */}
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : (fireEnabled ? "repeat(5, 1fr)" : "1fr 1fr 1fr 1fr"), gap: 12 }}>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>At Year {horizon} (future $)</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: finalRow.nominal < finalRow.contributions ? "#E8573A" : "#4ECDC4", marginTop: 4 }}>{fmt(finalRow.nominal)}</div>
          {finalRow.nominal < finalRow.contributions && <div style={{ fontSize: 10, color: "#E8573A", marginTop: 2 }}>below contributions</div>}
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>At Year {horizon} (today's $)</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: finalRow.real < finalRow.realContributions ? "#E8573A" : "#556FB5", marginTop: 4 }}>{fmt(finalRow.real)}</div>
          <div style={{ fontSize: 10, color: finalRow.real < finalRow.realContributions ? "#E8573A" : "var(--tx3,#888)", marginTop: 2 }}>{finalRow.real < finalRow.realContributions ? `below real contributions (${fmt(finalRow.realContributions)})` : "in today's dollars"}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Total Contributions</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#95A5A6", marginTop: 4 }}>{fmt(finalRow.contributions)}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Investment Growth</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: (finalRow.nominal - finalRow.contributions) < 0 ? "#E8573A" : "#2ECC71", marginTop: 4 }}>{fmt(finalRow.nominal - finalRow.contributions)}</div>
        </Card>
        {fireEnabled && (() => {
          // FI target shown in future $ at the relevant year (matches Advanced
          // tab paradigm). When reachable: target at the FI crossover year
          // (the dollar amount your account literally needs to hit at that
          // year). When unreachable: horizon-end value. Today's-$ shown as
          // secondary cross-reference (changes very slowly — only when
          // expenses or multiplier change).
          const inflRate = (Number(inflationPct) || 0) / 100;
          const refYear = (yearsToFire != null && yearsToFire > 0) ? yearsToFire : horizon;
          const futureTarget = fireTarget * Math.pow(1 + inflRate, refYear);
          const yearLabel = (yearsToFire != null && yearsToFire > 0)
            ? `at FI (yr ${refYear.toFixed(1)})`
            : `at yr ${horizon}`;
          return (
          <Card>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>FI Date</div>
            {yearsToFire === null ? (
              <>
                <div style={{ fontSize: mob ? 18 : 20, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#E8573A", marginTop: 4 }}>Unreachable</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>at current contribution + return</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 4 }}>Target {yearLabel}: <strong style={{ color: "#F39C12" }}>{fmt(futureTarget)}</strong></div>
                <div style={{ fontSize: 10, color: "var(--tx3,#aaa)", marginTop: 1 }}>Today's $: {fmt(fireTarget)}</div>
              </>
            ) : yearsToFire === 0 ? (
              <>
                <div style={{ fontSize: mob ? 18 : 20, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#2ECC71", marginTop: 4 }}>Already FI ✓</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>{fmt(fireTarget)} (today's $) target hit</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#F39C12", marginTop: 4 }}>{yearsToFire.toFixed(1)} yr</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>Target {yearLabel}: <strong style={{ color: "#F39C12" }}>{fmt(futureTarget)}</strong></div>
                <div style={{ fontSize: 10, color: "var(--tx3,#aaa)", marginTop: 1 }}>Today's $: {fmt(fireTarget)}</div>
              </>
            )}
          </Card>
          );
        })()}
      </div>

      {/* Growth chart */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Compound Growth <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({horizon}y)</span></h3>
          {modeBtn(valueMode, "both", "Both")}
          {modeBtn(valueMode, "nominal", "Future $ only")}
          {modeBtn(valueMode, "real", "Today's $ only")}
          <button onClick={() => setShowChartLegend(v => !v)}
            title={showChartLegend ? "Hide the legend below the chart" : "Show the legend below the chart"}
            style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5, background: showChartLegend ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: showChartLegend ? "#fff" : "var(--tx2,#555)", cursor: "pointer", marginLeft: 4 }}>
            Legend
          </button>
        </div>
        <div style={{ width: "100%", minHeight: 320 }}>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={simpleSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#eee)" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `Yr ${v}`} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => fmtCompact(v)} width={70} />
              <Tooltip formatter={v => fmt(v)} contentStyle={cs} />
              {showChartLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {(valueMode === "both" || valueMode === "nominal") && <Line type="monotone" dataKey="nominal" stroke="#4ECDC4" strokeWidth={2.5} dot={false} name="Future $" />}
              {(valueMode === "both" || valueMode === "real") && <Line type="monotone" dataKey="real" stroke="#556FB5" strokeWidth={2.5} dot={false} name={`Today's $ (${i}% infl)`} />}
              <Line type="monotone" dataKey="contributions" stroke="#95A5A6" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Contributions" />
              {fireEnabled && fireTarget > 0 && (
                <Line type="monotone" dataKey="fireThresh" stroke="#F39C12" strokeWidth={2.5} strokeDasharray="6 3" dot={false} name="FI target" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* FIRE — Financial Independence calculator. Phase 15 makes this
          tax-aware: estimates withdrawal tax based on the account-type mix
          at FI, grosses up the spending need, and divides by SWR. Users
          can override projected retirement spending (travel-heavy etc.)
          and choose a withdrawal rate (default 4%). Escape hatch toggle
          restores the classic spending × multiplier math. */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: fireEnabled ? 16 : 0, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>FIRE — Financial Independence</h3>
          <button onClick={() => setFireEnabled(!fireEnabled)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: fireEnabled ? "#F39C12" : "var(--input-bg,#f5f5f5)", color: fireEnabled ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{fireEnabled ? "ON" : "OFF"}</button>
          <span style={{ fontSize: 11, color: "var(--tx3,#888)", flex: 1, minWidth: 200 }} title="When ON, adds a target line to the chart, a stat card with years-to-FI, and expands the math below.">Project when your portfolio can fund your lifestyle indefinitely.</span>
        </div>
        {fireEnabled && (
          <>
            {/* Top row: spending input + SWR picker + result card */}
            <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr 1.2fr", gap: 16, alignItems: "start" }}>
              {/* Spending */}
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Retirement Spending /yr
                  <span title={"Annual after-tax spending you expect in retirement.\n\nDefault: your current expense baseline (from budget or actuals).\n\nOverride this if retirement looks different:\n• travel-heavy early years\n• paid-off mortgage\n• no kids at home\n• PRE-MEDICARE HEALTHCARE — if retiring before 65, ACA marketplace premiums for a couple can be $15-25k/yr until Medicare kicks in. Bake that into your override.\n\nThe tax estimate will gross this up before applying the withdrawal rate."} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "var(--tx3,#888)", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "help" }}>?</span>
                </label>
                <NI
                  value={retirementSpendingOverride != null ? String(retirementSpendingOverride) : String(Math.round(fireAnnualExpenses))}
                  onChange={(v) => {
                    const n = evalF(v);
                    setRetirementSpendingOverride(isFinite(n) && n >= 0 ? n : null);
                  }}
                  onBlurResolve
                />
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 4, fontStyle: "italic" }}>
                  {retirementSpendingOverride != null ? (
                    <button
                      onClick={() => setRetirementSpendingOverride(null)}
                      style={{ background: "none", border: "none", color: "#556FB5", cursor: "pointer", padding: 0, fontSize: 10, fontStyle: "italic", textDecoration: "underline" }}
                      title="Clear override and use current spending"
                    >reset to current ({fmt(fireAnnualExpenses)})</button>
                  ) : (
                    <span>auto: {contribSource === "budget" ? "budget × 48" : `${contribSource === "actual3" ? 3 : contribSource === "actual12" ? 12 : 6}mo actuals`}</span>
                  )}
                </div>
              </div>
              {/* SWR picker */}
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Withdrawal Rate
                  <span title={"Annual % of portfolio you withdraw to live on. Lower = safer (larger nest egg required), higher = aggressive.\n\n• 3% — very conservative, 50+ year retirement\n• 3.5% — conservative, FIRE-typical\n• 4% — Trinity study standard, 30-year horizon\n• 5% — aggressive, requires flexibility in down markets"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "var(--tx3,#888)", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "help" }}>?</span>
                </label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                  {[0.03, 0.035, 0.04, 0.05].map(rate => {
                    const active = Math.abs(swr - rate) < 0.0001;
                    return (
                      <button key={rate}
                        onClick={() => setSwr(rate)}
                        style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 5, background: active ? "#F39C12" : "var(--input-bg,#f5f5f5)", color: active ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>
                        {(rate * 100).toFixed(rate === 0.035 ? 1 : 0)}%
                      </button>
                    );
                  })}
                </div>
                <NI
                  value={(swr * 100).toFixed(2)}
                  onChange={(v) => {
                    const n = evalF(v);
                    if (isFinite(n) && n > 0 && n < 50) setSwr(n / 100);
                  }}
                  onBlurResolve
                />
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 4 }}>
                  ≈ {(100 / (swr * 100)).toFixed(1)}× spending (pre-tax)
                </div>
              </div>
              {/* Result card */}
              <div style={{ padding: 16, background: "var(--input-bg,#f8f8f8)", borderRadius: 8, textAlign: "center" }}>
                {fireTarget <= 0 ? (
                  <div style={{ color: "var(--tx3,#888)", fontSize: 13 }}>Set retirement spending and a withdrawal rate to see your FI date.</div>
                ) : yearsToFire === 0 ? (
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>Already FI ✓</div>
                    <div style={{ fontSize: 12, color: "var(--tx2,#555)", marginTop: 4 }}>Your starting balance covers {fireMultiplierNum.toFixed(1)}× spending.</div>
                  </div>
                ) : yearsToFire === null ? (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#E8573A", fontFamily: "'Fraunces',serif" }}>Unreachable in {horizon} yr</div>
                    <div style={{ fontSize: 12, color: "var(--tx2,#555)", marginTop: 4 }}>Today's $ balance doesn't reach {fmt(fireTarget)} within your horizon. Increase contributions, reduce spending, raise expected return — or extend the horizon.</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: "#F39C12", fontFamily: "'Fraunces',serif" }}>{yearsToFire.toFixed(1)} years</div>
                    <div style={{ fontSize: 13, color: "var(--tx2,#555)", marginTop: 4, fontWeight: 600 }}>≈ {new Date(Date.now() + yearsToFire * 365.25 * 86400000).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</div>
                    <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 6 }}>at {r}% return, {i}% infl, {g}% income growth</div>
                    {yearsToFire > horizon && <div style={{ fontSize: 11, color: "#E8573A", marginTop: 4, fontWeight: 600 }}>⚠️ Beyond your {horizon}yr horizon — extend horizon to see crossover.</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Target summary: the dollar number with tax breakdown */}
            <div style={{ marginTop: 16, padding: 14, background: "var(--input-bg,#f8f8f8)", borderRadius: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "auto 1fr auto", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>FIRE Target</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "var(--tx,#222)", fontFamily: "'Fraunces',serif" }}>{fmt(fireTarget)}</div>
                  <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 2 }}>
                    Effective multiplier: <strong>{fireMultiplierNum.toFixed(1)}×</strong> spending
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--tx2,#555)", lineHeight: 1.7 }}>
                  {useSimpleMultiplier ? (
                    <>
                      <div>Spending: <strong>{fmt(fireSpending)}</strong> /yr (after-tax)</div>
                      <div>Withdrawal rate: <strong>{(swr * 100).toFixed(2)}%</strong></div>
                      <div style={{ color: "var(--tx3,#888)", fontStyle: "italic" }}>Classic rule — tax estimate disabled</div>
                    </>
                  ) : (
                    <>
                      <div>After-tax spending need: <strong>{fmt(fireSpending)}</strong></div>
                      <div>Estimated retirement tax: <strong>{fmt(fireResult.tax?.totalTax || 0)}</strong> ({((fireResult.tax?.effectiveRate || 0) * 100).toFixed(1)}% effective)</div>
                      <div>Gross withdrawal needed: <strong>{fmt(fireResult.grossNeed)}</strong></div>
                    </>
                  )}
                </div>
                <div>
                  {!useSimpleMultiplier && (
                    <button
                      onClick={() => setShowFireBreakdown(v => !v)}
                      style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: showFireBreakdown ? "var(--input-bg,#fff)" : "transparent", color: "var(--tx2,#555)", cursor: "pointer" }}>
                      {showFireBreakdown ? "Hide breakdown ▴" : "Show breakdown ▾"}
                    </button>
                  )}
                </div>
              </div>

              {/* Expandable tax breakdown */}
              {!useSimpleMultiplier && showFireBreakdown && fireResult.tax && (
                <div style={{ marginTop: 14, padding: 12, background: "var(--bg,#fff)", borderRadius: 6, border: "1px solid var(--bdr,#e5e5e5)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx2,#555)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Tax breakdown</div>
                  <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginBottom: 10, lineHeight: 1.6 }}>
                    Based on the projected account mix at year {fireMixYear}. Each dollar withdrawn is taxed according to where it sits in your portfolio (Traditional → ordinary income, Roth/HSA → tax-free, Taxable → long-term capital gains).
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 14, fontSize: 11 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--tx2,#555)", marginBottom: 4 }}>Withdrawal composition</div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span>Ordinary income (Traditional 401k/IRA, match)</span>
                        <span><strong>{(fireAccountMix.ordinary * 100).toFixed(1)}%</strong> · {fmt(fireResult.tax.ordinaryIncome)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span>Long-term capital gains (Taxable)</span>
                        <span><strong>{(fireAccountMix.ltcg * 100).toFixed(1)}%</strong> · {fmt(fireResult.tax.ltcgIncome)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span>Tax-free (Roth, HSA, Cash)</span>
                        <span><strong>{(fireAccountMix.taxfree * 100).toFixed(1)}%</strong> · {fmt(fireResult.tax.taxfreeIncome)}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--tx2,#555)", marginBottom: 4 }}>Tax computed</div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span>Federal (ordinary)</span>
                        <span>{fmt(fireResult.tax.federalOrdinary)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span>Federal LTCG ({(ltcgRate * 100).toFixed(0)}%)</span>
                        <span>{fmt(fireResult.tax.federalLTCG)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span>State ({taxConfig.stateAbbr || "none"})</span>
                        <span>{fmt(fireResult.tax.stateTax)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0 0", borderTop: "1px solid var(--bdr,#e5e5e5)", marginTop: 4, fontWeight: 700, color: "var(--tx,#222)" }}>
                        <span>Total tax</span>
                        <span>{fmt(fireResult.tax.totalTax)}</span>
                      </div>
                    </div>
                  </div>
                  {/* LTCG rate override */}
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--bdr,#e5e5e5)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <label style={{ fontSize: 10, color: "var(--tx3,#888)", fontWeight: 600 }}>LTCG rate</label>
                    <div style={{ width: 80 }}>
                      <NI
                        value={(ltcgRate * 100).toFixed(2)}
                        onChange={(v) => {
                          const n = evalF(v);
                          if (isFinite(n) && n >= 0 && n < 50) setLtcgRate(n / 100);
                        }}
                        onBlurResolve
                      />
                    </div>
                    <span style={{ fontSize: 10, color: "var(--tx3,#888)" }}>%</span>
                    <span style={{ fontSize: 10, color: "var(--tx3,#888)", fontStyle: "italic", marginLeft: "auto" }}>
                      Tax basis: {taxConfig.year} federal {taxConfig.stateAbbr ? `+ ${taxConfig.stateAbbr}` : ""} brackets (MFJ). Future tax law changes are not predicted.
                    </span>
                  </div>
                </div>
              )}

              {/* Simple-mode toggle */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--bdr,#e5e5e5)", display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  id="fire-simple-toggle"
                  checked={useSimpleMultiplier}
                  onChange={(e) => setUseSimpleMultiplier(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <label htmlFor="fire-simple-toggle" style={{ fontSize: 11, color: "var(--tx2,#555)", cursor: "pointer" }}>
                  Use classic rule (skip tax estimate) — target = spending ÷ withdrawal rate
                </label>
              </div>
            </div>

            <div style={{ marginTop: 12, padding: 12, background: "var(--input-bg,#f8f8f8)", borderRadius: 8, fontSize: 11, color: "var(--tx3,#888)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--tx2,#555)" }}>How this works:</strong> Target is in today's dollars (flat line on the chart). Years-to-FI is when the <em>today's $</em> balance line crosses the target — derived from the same projection as the chart, so income growth ({g}%) and all other settings flow through automatically. {!useSimpleMultiplier && <>Tax estimate uses your projected account mix at year {fireMixYear} (configurable on the Advanced tab). </>}When real balance crosses the target, you can sustainably withdraw {fireWithdrawalRate.toFixed(2)}% per year forever — that's "financially independent."
            </div>
          </>
        )}
      </Card>

      {/* Time-to-target calculator */}
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Time to X Months of Expenses</h3>
        <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 2fr", gap: 16, alignItems: "center" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Months of Expenses</label>
            <NI value={targetMonths} onChange={setTargetMonths} onBlurResolve />
            <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 6 }}>Monthly expenses: {fmt(monthlyExpenses)}</div>
            <div style={{ fontSize: 11, color: "var(--tx3,#888)" }}>Target: {fmt(targetAmount)}</div>
          </div>
          <div style={{ padding: 16, background: "var(--input-bg,#f8f8f8)", borderRadius: 8, textAlign: "center" }}>
            {targetAmount <= 0 ? (
              <div style={{ color: "var(--tx3,#888)", fontSize: 13 }}>Add expenses and choose a target to see time-to-goal.</div>
            ) : yearsToGoal === 0 ? (
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>Already there! ✓</div>
                <div style={{ fontSize: 12, color: "var(--tx2,#555)", marginTop: 4 }}>Your starting balance covers {targetMonthsNum} months of expenses.</div>
              </div>
            ) : yearsToGoal === null ? (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#E8573A", fontFamily: "'Fraunces',serif" }}>Unreachable</div>
                <div style={{ fontSize: 12, color: "var(--tx2,#555)", marginTop: 4 }}>Increase contributions or expected return to reach this target.</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, fontWeight: 800, color: "#4ECDC4", fontFamily: "'Fraunces',serif" }}>{yearsToGoal.toFixed(1)} years</div>
                <div style={{ fontSize: 12, color: "var(--tx2,#555)", marginTop: 4 }}>to reach {fmt(targetAmount)} at {r}% return</div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Year-by-year table */}
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Year-by-Year</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--bdr,#e0e0e0)" }}>
                <th style={{ textAlign: "left", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Year</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Future $</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Today's $</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Contributed</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }} title="Cumulative contributions deflated to today's dollars. Compare against the Real column for true purchasing-power growth.">Today's $ Contrib</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Growth</th>
              </tr>
            </thead>
            <tbody>
              {simpleSeries.map(row => {
                const growth = row.nominal - row.contributions;
                const nomBelow = row.nominal < row.contributions;
                const realBelow = row.real < row.realContributions;
                return (
                  <tr key={row.year} style={{ borderBottom: "1px solid var(--bdr,#f0f0f0)" }}>
                    <td style={{ padding: "6px", fontWeight: 600 }}>{row.year}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: nomBelow ? "#E8573A" : "#4ECDC4", fontWeight: 600 }}>{fmt(row.nominal)}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: realBelow ? "#E8573A" : "#556FB5", fontWeight: realBelow ? 600 : 400 }}>{fmt(row.real)}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: "var(--tx3,#888)" }}>{fmt(row.contributions)}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: "var(--tx3,#888)" }}>{fmt(row.realContributions)}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: growth < 0 ? "#E8573A" : "#2ECC71", fontWeight: 600 }}>{fmt(growth)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>


    </div>
  );
}

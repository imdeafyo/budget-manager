import { useMemo, useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { Card, NI } from "../components/ui.jsx";
import { forecastGrowth, fmt, fmtCompact, evalF } from "../utils/calc.js";
import { actualAnnualContribution } from "../utils/forecastActuals.js";

export default function ForecastTab({ mob, C, tSavW, remW, tExpW, totalSavPlusRemW, includeEaip, transactions = [], cats = [], savCats = [], transferCats = [], incomeCats = [], preDed = [], hsaEmployerMatchAnnual = 0, forecast = {}, setForecast, tax = {}, setTax, p1Name = "Person 1", p2Name = "Person 2", cSal = "0", kSal = "0", c4pre = "0", c4ro = "0", k4pre = "0", k4ro = "0" }) {
  const [returnPct, setReturnPct] = useState(() => { try { return localStorage.getItem("forecast-return") || "7"; } catch { return "7"; } });
  const [inflationPct, setInflationPct] = useState(() => { try { return localStorage.getItem("forecast-inflation") || "3"; } catch { return "3"; } });
  // Phase 7: nominal income growth rate. Default 3% to match inflation default —
  // at defaults this means real contributions roughly flat (matches old
  // behavior). Setting above inflation models real career growth (raises that
  // beat cost-of-living); setting below models stagnation. Applied to total
  // annual contribution, which approximates well — most savings flows scale
  // with salary (take-home, 401k%, HSA, bonus%, employer match). The flat
  // HSA employer match is technically over-credited but the error is tiny.
  const [incomeGrowthPct, setIncomeGrowthPct] = useState(() => { try { return localStorage.getItem("forecast-income-growth") || "3"; } catch { return "3"; } });
  const [initialBalance, setInitialBalance] = useState(() => { try { return localStorage.getItem("forecast-initial") || "0"; } catch { return "0"; } });
  const [horizon, setHorizon] = useState(() => { try { return Number(localStorage.getItem("forecast-horizon")) || 30; } catch { return 30; } });
  const [valueMode, setValueMode] = useState(() => { try { return localStorage.getItem("forecast-value-mode") || "both"; } catch { return "both"; } }); // both | nominal | real
  const [targetMonths, setTargetMonths] = useState(() => { try { return localStorage.getItem("forecast-target-months") || "12"; } catch { return "12"; } });
  // Phase 7: contribution source — "budget" | "actual3" | "actual6" | "actual12"
  const [contribSource, setContribSource] = useState(() => { try { return localStorage.getItem("forecast-contrib-source") || "budget"; } catch { return "budget"; } });
  // Phase 7: actuals mode — "net" (income − expenses) | "expenses" (budgeted income − expenses)
  // Only meaningful when contribSource !== "budget".
  const [actualMode, setActualMode] = useState(() => { try { return localStorage.getItem("forecast-actual-mode") || "net"; } catch { return "net"; } });
  // Phase 7: forecast-local pay cadence — 48 (paycheck) or 52 (calendar). Default 52.
  // Calendar is more honest for compound growth; 48 matches the rest of the app's
  // budget cadence. This is intentionally independent from the rest of the app's
  // visCols 48/52 toggle (which is just a display unit, not a forecast assumption).
  const [forecastWeeks, setForecastWeeks] = useState(() => {
    try { const v = Number(localStorage.getItem("forecast-weeks")); return v === 48 || v === 52 ? v : 52; } catch { return 52; }
  });
  // Phase 7: forecast-local bonus inclusion. Default OFF (conservative). Independent
  // from the global Charts-tab `includeEaip` so changing one doesn't silently move
  // the forecast number.
  const [forecastBonus, setForecastBonus] = useState(() => {
    try { return localStorage.getItem("forecast-bonus") === "1"; } catch { return false; }
  });
  // Phase 7: retirement-contribution toggles. The base `C.net` excludes 401(k)
  // elective contributions (they're stripped pre-net), HSA (also pre-tax/pre-net),
  // and obviously employer match (never touched the paycheck). For a retirement
  // forecast you almost certainly want these IN — but they're per-toggle so the
  // user can model either "all savings" or just "after-tax savings."
  // 401(k) elective + HSA default ON (likely intent for a retirement forecast).
  // Employer match defaults ON only if a match is actually configured.
  const [include401k, setInclude401k] = useState(() => {
    try { return localStorage.getItem("forecast-include-401k") !== "0"; } catch { return true; }
  });
  const [includeMatch, setIncludeMatch] = useState(() => {
    try {
      const v = localStorage.getItem("forecast-include-match");
      if (v === "0") return false;
      if (v === "1") return true;
      return true; // default on
    } catch { return true; }
  });
  const [includeHSA, setIncludeHSA] = useState(() => {
    try { return localStorage.getItem("forecast-include-hsa") !== "0"; } catch { return true; }
  });
  // Phase 7: FIRE — financial independence target as multiple of annual expenses.
  // Standard FIRE = 25× (4% safe withdrawal). 28-33× for early retirement.
  // 20× = aggressive 5% withdrawal, only safe with flexibility.
  const [fireEnabled, setFireEnabled] = useState(() => {
    try { return localStorage.getItem("forecast-fire-enabled") === "1"; } catch { return false; }
  });
  const [fireMultiplier, setFireMultiplier] = useState(() => {
    try { return localStorage.getItem("forecast-fire-multiplier") || "25"; } catch { return "25"; }
  });

  useEffect(() => { try { localStorage.setItem("forecast-return", returnPct); } catch {} }, [returnPct]);
  useEffect(() => { try { localStorage.setItem("forecast-inflation", inflationPct); } catch {} }, [inflationPct]);
  useEffect(() => { try { localStorage.setItem("forecast-income-growth", incomeGrowthPct); } catch {} }, [incomeGrowthPct]);
  useEffect(() => { try { localStorage.setItem("forecast-initial", initialBalance); } catch {} }, [initialBalance]);
  useEffect(() => { try { localStorage.setItem("forecast-horizon", String(horizon)); } catch {} }, [horizon]);
  useEffect(() => { try { localStorage.setItem("forecast-value-mode", valueMode); } catch {} }, [valueMode]);
  useEffect(() => { try { localStorage.setItem("forecast-target-months", targetMonths); } catch {} }, [targetMonths]);
  useEffect(() => { try { localStorage.setItem("forecast-contrib-source", contribSource); } catch {} }, [contribSource]);
  useEffect(() => { try { localStorage.setItem("forecast-actual-mode", actualMode); } catch {} }, [actualMode]);
  useEffect(() => { try { localStorage.setItem("forecast-weeks", String(forecastWeeks)); } catch {} }, [forecastWeeks]);
  useEffect(() => { try { localStorage.setItem("forecast-bonus", forecastBonus ? "1" : "0"); } catch {} }, [forecastBonus]);
  useEffect(() => { try { localStorage.setItem("forecast-include-401k", include401k ? "1" : "0"); } catch {} }, [include401k]);
  useEffect(() => { try { localStorage.setItem("forecast-include-match", includeMatch ? "1" : "0"); } catch {} }, [includeMatch]);
  useEffect(() => { try { localStorage.setItem("forecast-include-hsa", includeHSA ? "1" : "0"); } catch {} }, [includeHSA]);
  useEffect(() => { try { localStorage.setItem("forecast-fire-enabled", fireEnabled ? "1" : "0"); } catch {} }, [fireEnabled]);
  useEffect(() => { try { localStorage.setItem("forecast-fire-multiplier", fireMultiplier); } catch {} }, [fireMultiplier]);

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

  /* FIRE — financial independence target.
     Annual expenses source follows the contribution-source toggle:
     - "budget"  → tExpW × 48 (annualized weekly budget)
     - actuals/N → annualized actual expenses from the window
     Target = annualExpenses × multiplier. Default multiplier 25 (4% rule).

     Math basis: flat target (today's dollars) compared against the REAL
     balance line (already inflation-adjusted in `forecastGrowth`). This
     means the target doesn't move on the chart; the real balance climbs
     to meet it. Years-to-FI uses real return rate (r − i) for the same
     reason: contributions and growth must keep pace with inflation in
     real terms. */
  const fireMultiplierNum = useMemo(() => {
    const v = evalF(fireMultiplier);
    return isFinite(v) && v > 0 ? v : 25;
  }, [fireMultiplier]);
  const fireAnnualExpenses = useMemo(() => {
    if (contribSource !== "budget" && actualsResult && actualsResult.expenses > 0 && actualsResult.months > 0) {
      return actualsResult.expenses * 12 / actualsResult.months;
    }
    return tExpW * 48;
  }, [contribSource, actualsResult, tExpW]);
  const fireTarget = useMemo(() => fireAnnualExpenses * fireMultiplierNum, [fireAnnualExpenses, fireMultiplierNum]);
  const fireWithdrawalRate = useMemo(() => fireMultiplierNum > 0 ? 100 / fireMultiplierNum : 0, [fireMultiplierNum]);

  // Forecast must be computed before years-to-X calcs so they can derive
  // crossover years from the array (which already accounts for income
  // growth via `g`). This is more robust than calling yearsToTarget with
  // a flat contribution — that would ignore the growth toggle.
  const simpleSeries = useMemo(() => forecastGrowth(init, annualContribution, r, i, horizon, g), [init, annualContribution, r, i, horizon, g]);
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

  // FIRE: target is in today's dollars (flat line on chart), so we compare
  // against the REAL balance line — the inflation-adjusted balance climbs
  // to meet the flat target. Income growth is already baked into the series.
  const yearsToFire = useMemo(() => {
    if (!fireEnabled || fireTarget <= 0) return null;
    return crossoverYear("real", fireTarget);
  }, [fireEnabled, fireTarget, simpleSeries]);

  // Time-to-X-months: target is X × today's monthly expenses (today's $).
  // Compared against NOMINAL balance for back-compat with the existing
  // calculator semantics. (Switching to real here would be more honest, but
  // it's a separate decision from this slice.)
  const yearsToGoal = useMemo(() => targetAmount > 0 ? crossoverYear("nominal", targetAmount) : null, [targetAmount, simpleSeries]);

  const horizonOpts = [1, 5, 10, 20, 30];
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
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>At Year {horizon} (Nominal)</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: finalRow.nominal < finalRow.contributions ? "#E8573A" : "#4ECDC4", marginTop: 4 }}>{fmt(finalRow.nominal)}</div>
          {finalRow.nominal < finalRow.contributions && <div style={{ fontSize: 10, color: "#E8573A", marginTop: 2 }}>below contributions</div>}
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>At Year {horizon} (Real)</div>
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
        {fireEnabled && (
          <Card>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>FI Date</div>
            {yearsToFire === null ? (
              <>
                <div style={{ fontSize: mob ? 18 : 20, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#E8573A", marginTop: 4 }}>Unreachable</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>at current contribution + return</div>
              </>
            ) : yearsToFire === 0 ? (
              <>
                <div style={{ fontSize: mob ? 18 : 20, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#2ECC71", marginTop: 4 }}>Already FI ✓</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>{fmt(fireTarget)} target hit</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#F39C12", marginTop: 4 }}>{yearsToFire.toFixed(1)} yr</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>target: {fmt(fireTarget)}</div>
              </>
            )}
          </Card>
        )}
      </div>

      {/* Growth chart */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Compound Growth <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({horizon}y)</span></h3>
          {modeBtn(valueMode, "both", "Both")}
          {modeBtn(valueMode, "nominal", "Nominal only")}
          {modeBtn(valueMode, "real", "Real only")}
        </div>
        <div style={{ width: "100%", minHeight: 320 }}>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={simpleSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#eee)" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `Yr ${v}`} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={v => fmt(v)} contentStyle={cs} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(valueMode === "both" || valueMode === "nominal") && <Line type="monotone" dataKey="nominal" stroke="#4ECDC4" strokeWidth={2.5} dot={false} name="Nominal" />}
              {(valueMode === "both" || valueMode === "real") && <Line type="monotone" dataKey="real" stroke="#556FB5" strokeWidth={2.5} dot={false} name={`Real (${i}% infl)`} />}
              <Line type="monotone" dataKey="contributions" stroke="#95A5A6" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Contributions" />
              {fireEnabled && fireTarget > 0 && <ReferenceLine y={fireTarget} stroke="#F39C12" strokeWidth={2} strokeDasharray="6 3" label={{ value: `FI: ${fmt(fireTarget)}`, position: "insideTopRight", fill: "#F39C12", fontSize: 11, fontWeight: 700 }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* FIRE — Financial Independence calculator. Toggleable; when on,
          adds a stat card to the summary row, a horizontal target line on
          the compound-growth chart, and shows full math here. Annual
          expenses follow the contribution source toggle (budget vs
          actuals/N-mo). */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: fireEnabled ? 16 : 0, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>FIRE — Financial Independence</h3>
          <button onClick={() => setFireEnabled(!fireEnabled)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: fireEnabled ? "#F39C12" : "var(--input-bg,#f5f5f5)", color: fireEnabled ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{fireEnabled ? "ON" : "OFF"}</button>
          <span style={{ fontSize: 11, color: "var(--tx3,#888)", flex: 1, minWidth: 200 }} title="When ON, adds a target line to the chart, a stat card with years-to-FI, and expands the math below.">Project when your portfolio can fund your lifestyle indefinitely.</span>
        </div>
        {fireEnabled && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 2fr", gap: 16, alignItems: "start" }}>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Multiplier (× annual expenses)
                  <span title={"Inverse of safe withdrawal rate.\n\n• 25× = 4% rule (Trinity Study, ~30yr retirement)\n• 28-33× = 3-3.5% rule (FIRE, 50+ year horizon)\n• 20× = 5% (aggressive, requires flexibility)\n\nLower withdrawal rate = larger target = safer, but takes longer to reach. Most people use 25.\n\nThe withdrawal rate matters because your portfolio has to survive forever — too high and you risk running out during a bad market sequence."} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "var(--tx3,#888)", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "help" }}>?</span>
                </label>
                <NI value={fireMultiplier} onChange={setFireMultiplier} onBlurResolve />
                <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 6 }}>Withdrawal rate: <strong>{fireWithdrawalRate.toFixed(2)}%</strong></div>
                <div style={{ fontSize: 11, color: "var(--tx3,#888)" }}>Annual expenses: {fmt(fireAnnualExpenses)}</div>
                <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2, fontStyle: "italic" }}>
                  ({contribSource === "budget" ? "from budget × 48" : `from ${contribSource === "actual3" ? 3 : contribSource === "actual12" ? 12 : 6}mo actuals`})
                </div>
                <div style={{ fontSize: 11, color: "var(--tx2,#555)", marginTop: 6, fontWeight: 700 }}>Target: {fmt(fireTarget)}</div>
              </div>
              <div style={{ padding: 16, background: "var(--input-bg,#f8f8f8)", borderRadius: 8, textAlign: "center" }}>
                {fireTarget <= 0 ? (
                  <div style={{ color: "var(--tx3,#888)", fontSize: 13 }}>Set annual expenses and a multiplier to see your FI date.</div>
                ) : yearsToFire === 0 ? (
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>Already FI ✓</div>
                    <div style={{ fontSize: 12, color: "var(--tx2,#555)", marginTop: 4 }}>Your starting balance covers {fireMultiplierNum}× expenses.</div>
                  </div>
                ) : yearsToFire === null ? (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#E8573A", fontFamily: "'Fraunces',serif" }}>Unreachable in {horizon} yr</div>
                    <div style={{ fontSize: 12, color: "var(--tx2,#555)", marginTop: 4 }}>Real balance doesn't reach {fmt(fireTarget)} within your horizon at current settings. Increase contributions, reduce expenses, raise expected return — or extend the horizon to see if it crosses later.</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: "#F39C12", fontFamily: "'Fraunces',serif" }}>{yearsToFire.toFixed(1)} years</div>
                    <div style={{ fontSize: 13, color: "var(--tx2,#555)", marginTop: 4, fontWeight: 600 }}>≈ {new Date(Date.now() + yearsToFire * 365.25 * 86400000).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</div>
                    <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 6 }}>at {r}% return, {i}% infl, {g}% income growth, {fmt(annualContribution)}/yr base</div>
                    {yearsToFire > horizon && <div style={{ fontSize: 11, color: "#E8573A", marginTop: 4, fontWeight: 600 }}>⚠️ Beyond your {horizon}yr horizon — extend horizon to see crossover.</div>}
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 12, padding: 12, background: "var(--input-bg,#f8f8f8)", borderRadius: 8, fontSize: 11, color: "var(--tx3,#888)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--tx2,#555)" }}>How this works:</strong> Target is in today's dollars (flat line on the chart). Years-to-FI is when the <em>real</em> balance line crosses the target — derived from the same projection as the chart, so income growth ({g}%) and all other settings flow through automatically. When real balance crosses the target, you can sustainably withdraw {fireWithdrawalRate.toFixed(2)}% per year forever — that's "financially independent."
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
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Nominal</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Real</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Contributed</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }} title="Cumulative contributions deflated to today's dollars. Compare against the Real column for true purchasing-power growth.">Real Contrib</th>
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

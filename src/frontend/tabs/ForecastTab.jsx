import { useMemo, useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { Card, NI } from "../components/ui.jsx";
import { forecastGrowth, yearsToTarget, fmt, evalF } from "../utils/calc.js";

/* Forecast tab: projects compound growth of savings over time.
   Uses current savings rate from the main C calculation + remaining budget.
   Annual contribution = (savings + remaining budget) * 48 paychecks/yr + optional bonus.
*/
export default function ForecastTab({ mob, C, tSavW, remW, tExpW, totalSavPlusRemW, includeEaip }) {
  const [returnPct, setReturnPct] = useState(() => { try { return localStorage.getItem("forecast-return") || "7"; } catch { return "7"; } });
  const [inflationPct, setInflationPct] = useState(() => { try { return localStorage.getItem("forecast-inflation") || "3"; } catch { return "3"; } });
  const [initialBalance, setInitialBalance] = useState(() => { try { return localStorage.getItem("forecast-initial") || "0"; } catch { return "0"; } });
  const [horizon, setHorizon] = useState(() => { try { return Number(localStorage.getItem("forecast-horizon")) || 30; } catch { return 30; } });
  const [valueMode, setValueMode] = useState(() => { try { return localStorage.getItem("forecast-value-mode") || "both"; } catch { return "both"; } }); // both | nominal | real
  const [targetMonths, setTargetMonths] = useState(() => { try { return localStorage.getItem("forecast-target-months") || "12"; } catch { return "12"; } });

  useEffect(() => { try { localStorage.setItem("forecast-return", returnPct); } catch {} }, [returnPct]);
  useEffect(() => { try { localStorage.setItem("forecast-inflation", inflationPct); } catch {} }, [inflationPct]);
  useEffect(() => { try { localStorage.setItem("forecast-initial", initialBalance); } catch {} }, [initialBalance]);
  useEffect(() => { try { localStorage.setItem("forecast-horizon", String(horizon)); } catch {} }, [horizon]);
  useEffect(() => { try { localStorage.setItem("forecast-value-mode", valueMode); } catch {} }, [valueMode]);
  useEffect(() => { try { localStorage.setItem("forecast-target-months", targetMonths); } catch {} }, [targetMonths]);

  const r = evalF(returnPct);
  const i = evalF(inflationPct);
  const init = evalF(initialBalance);

  /* Annual contribution: savings + positive remaining, times 48 paychecks. Optionally add bonus. */
  const annualContribution = useMemo(() => {
    const base = totalSavPlusRemW * 48;
    const bonus = includeEaip ? (C.eaipNet || 0) : 0;
    return base + bonus;
  }, [totalSavPlusRemW, includeEaip, C.eaipNet]);

  /* Monthly expenses for the "time to X months of expenses" calculator.
     tExpW is weekly expense base, so monthly = tExpW * 48 / 12. */
  const monthlyExpenses = useMemo(() => tExpW * 48 / 12, [tExpW]);
  const targetMonthsNum = Math.max(0, evalF(targetMonths));
  const targetAmount = monthlyExpenses * targetMonthsNum;

  const forecast = useMemo(() => forecastGrowth(init, annualContribution, r, i, horizon), [init, annualContribution, r, i, horizon]);
  const finalRow = forecast[forecast.length - 1];

  const yearsToGoal = useMemo(() => targetAmount > 0 ? yearsToTarget(init, annualContribution, r, targetAmount) : null, [init, annualContribution, r, targetAmount]);

  const horizonOpts = [1, 5, 10, 20, 30];
  const modeBtn = (mode, val, label) => (
    <button onClick={() => setValueMode(val)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: mode === val ? "#4ECDC4" : "var(--input-bg,#f5f5f5)", color: mode === val ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{label}</button>
  );
  const horizonBtn = (h) => (
    <button key={h} onClick={() => setHorizon(h)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: horizon === h ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: horizon === h ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }}>{h}y</button>
  );

  const cs = { background: "var(--card-bg,#fff)", color: "var(--card-color,#222)", border: "none", borderRadius: 8, fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Inputs card */}
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Assumptions</h3>
        <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 12 }}>
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
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Horizon</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{horizonOpts.map(horizonBtn)}</div>
          </div>
        </div>
        <div style={{ marginTop: 16, padding: 12, background: "var(--input-bg,#f8f8f8)", borderRadius: 8, fontSize: 12, color: "var(--tx2,#555)", lineHeight: 1.6 }}>
          <div><strong>Annual contribution (from budget):</strong> {fmt(annualContribution)} {includeEaip ? "(includes bonus)" : ""}</div>
          <div style={{ color: "var(--tx3,#888)", fontSize: 11, marginTop: 4 }}>= (savings + remaining) × 48 paychecks {includeEaip ? "+ net bonus" : ""}. Adjust on the Charts tab to toggle bonus inclusion.</div>
        </div>
      </Card>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 12 }}>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>At Year {horizon} (Nominal)</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#4ECDC4", marginTop: 4 }}>{fmt(finalRow.nominal)}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>At Year {horizon} (Real)</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#556FB5", marginTop: 4 }}>{fmt(finalRow.real)}</div>
          <div style={{ fontSize: 10, color: "var(--tx3,#888)", marginTop: 2 }}>in today's dollars</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Total Contributions</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#95A5A6", marginTop: 4 }}>{fmt(finalRow.contributions)}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Investment Growth</div>
          <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "#2ECC71", marginTop: 4 }}>{fmt(finalRow.nominal - finalRow.contributions)}</div>
        </Card>
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
            <LineChart data={forecast}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#eee)" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `Yr ${v}`} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={v => fmt(v)} contentStyle={cs} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(valueMode === "both" || valueMode === "nominal") && <Line type="monotone" dataKey="nominal" stroke="#4ECDC4" strokeWidth={2.5} dot={false} name="Nominal" />}
              {(valueMode === "both" || valueMode === "real") && <Line type="monotone" dataKey="real" stroke="#556FB5" strokeWidth={2.5} dot={false} name={`Real (${i}% infl)`} />}
              <Line type="monotone" dataKey="contributions" stroke="#95A5A6" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Contributions" />
            </LineChart>
          </ResponsiveContainer>
        </div>
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
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 700, color: "var(--tx3,#888)" }}>Growth</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map(row => (
                <tr key={row.year} style={{ borderBottom: "1px solid var(--bdr,#f0f0f0)" }}>
                  <td style={{ padding: "6px", fontWeight: 600 }}>{row.year}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#4ECDC4", fontWeight: 600 }}>{fmt(row.nominal)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#556FB5" }}>{fmt(row.real)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "var(--tx3,#888)" }}>{fmt(row.contributions)}</td>
                  <td style={{ padding: "6px", textAlign: "right", color: "#2ECC71", fontWeight: 600 }}>{fmt(row.nominal - row.contributions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

    </div>
  );
}

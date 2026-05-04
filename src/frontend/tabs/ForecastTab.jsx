import { useMemo, useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ReferenceLine, AreaChart, Area } from "recharts";
import { Card, NI } from "../components/ui.jsx";
import { forecastGrowth, fmt, evalF, forecastGrowthAccounts, yearsToHitPoolLimit } from "../utils/calc.js";
import { actualAnnualContribution } from "../utils/forecastActuals.js";
import { getPoolLimit, ACCOUNT_TYPE_TO_POOL, defaultForecastAccounts } from "../data/taxDB.js";

/* ── Account type display metadata ──
   Account `type` strings map to (a) IRS pool for limit checking
   (ACCOUNT_TYPE_TO_POOL in taxDB.js) and (b) display label + pool color
   for the chart legend. Keep the type list in sync with both maps. */
const ACCOUNT_TYPE_LABELS = {
  "401k_pretax":     "401(k) — Pre-tax",
  "401k_roth":       "401(k) — Roth",
  "ira_traditional": "IRA — Traditional",
  "ira_roth":        "IRA — Roth",
  "hsa":             "HSA",
  "taxable":         "Taxable / Brokerage",
  "cash":            "Cash / Savings",
  "custom":          "Other",
};
/* Pool-level color palette for the stacked area chart. Each pool gets a
   base hue; individual accounts within a pool are shades of that hue.
   Recharts handles continuous color from a discrete list — keep these in
   the same visual family per pool. */
const POOL_COLORS = {
  "401k_employee": ["#556FB5", "#7B91C9", "#3D5499", "#9CABD8"],
  "ira":           ["#2ECC71", "#5EDC8C", "#1FAA5F", "#7FE3A1"],
  "hsa":           ["#9B59B6", "#B57BCC", "#7E45A0", "#C99FD8"],
  "_other":        ["#888888", "#A8A8A8", "#666666", "#BFBFBF"],
};

function poolForType(type) {
  return ACCOUNT_TYPE_TO_POOL[type] || "_other";
}
function colorForAccount(account, idxInPool) {
  const pool = poolForType(account.type);
  const palette = POOL_COLORS[pool] || POOL_COLORS._other;
  return palette[idxInPool % palette.length];
}

/* ── Advanced (account-based) Forecast view ──
   Self-contained sub-component rendered when forecastMode === "advanced".
   Reads the account list from `forecast.accounts` (in `st`) and writes
   updates back via `setForecast`. Re-uses simple-mode's horizon and
   inflation inputs (passed as props) so the user doesn't have to
   re-enter them when toggling modes. */
function AdvancedForecast({ mob, forecast, setForecast, tax, p1Name, p2Name, horizon, inflationPct }) {
  const accounts = (forecast && Array.isArray(forecast.accounts)) ? forecast.accounts : [];
  const hsaCoverage = (forecast && forecast.hsaCoverage) || "family";
  const baseYear = new Date().getFullYear();

  /* Per-account expand/collapse. Default: all collapsed for compactness. */
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const updateAccount = (id, patch) => {
    const next = accounts.map(a => a.id === id ? { ...a, ...patch } : a);
    setForecast({ ...forecast, accounts: next });
  };
  const addAccount = (type) => {
    const id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newAcc = {
      id,
      name: ACCOUNT_TYPE_LABELS[type] || "New Account",
      owner: "p1",
      type,
      startBalance: 0,
      annualReturn: 7,
      contribOverride: false,
      contribAmount: 0,
      annualIncrease: 0,
      capAtLimit: type !== "taxable" && type !== "cash" && type !== "custom",
    };
    setForecast({ ...forecast, accounts: [...accounts, newAcc] });
    setExpanded(p => ({ ...p, [id]: true }));
  };
  const removeAccount = (id) => {
    if (!window.confirm("Remove this account from the forecast? This only affects projections — no transaction data is touched.")) return;
    setForecast({ ...forecast, accounts: accounts.filter(a => a.id !== id) });
  };
  const resetToDefaults = () => {
    if (!window.confirm("Reset to the default account list? This replaces your current account configuration with the 6 starter accounts. Cannot be undone.")) return;
    setForecast({ ...forecast, accounts: defaultForecastAccounts() });
  };

  /* Run the projection. */
  const projection = useMemo(() => {
    return forecastGrowthAccounts(accounts, horizon, {
      baseYear,
      inflationPct,
      p1BirthYear: tax?.p1BirthYear || null,
      p2BirthYear: tax?.p2BirthYear || null,
      hsaCoverage,
      getPoolLimit,
      accountTypeToPool: ACCOUNT_TYPE_TO_POOL,
    });
  }, [accounts, horizon, baseYear, inflationPct, tax?.p1BirthYear, tax?.p2BirthYear, hsaCoverage]);

  /* Chart data: stacked area, one series per account. We use account ids
     for the dataKey so renames don't break Recharts' internal series state. */
  const chartData = useMemo(() => {
    return projection.years.map(row => {
      const point = { year: row.year, calendarYear: row.calendarYear, total: row.totals.nominal };
      for (const a of accounts) {
        point[a.id] = row.byAccount[a.id]?.nominal || 0;
      }
      return point;
    });
  }, [projection, accounts]);

  /* Color assignment per account: group accounts by pool, take palette
     index by position within pool. */
  const accountColors = useMemo(() => {
    const byPool = {};
    const colors = {};
    for (const a of accounts) {
      const p = poolForType(a.type);
      byPool[p] = byPool[p] || [];
      colors[a.id] = colorForAccount(a, byPool[p].length);
      byPool[p].push(a);
    }
    return colors;
  }, [accounts]);

  /* Per-pool ending-balance summary for the cards row. */
  const poolSummary = useMemo(() => {
    const last = projection.years[projection.years.length - 1];
    if (!last) return [];
    const pools = {};
    for (const a of accounts) {
      const pool = poolForType(a.type);
      pools[pool] = pools[pool] || { nominal: 0, real: 0, contributions: 0, count: 0 };
      pools[pool].nominal += last.byAccount[a.id]?.nominal || 0;
      pools[pool].real += last.byAccount[a.id]?.real || 0;
      pools[pool].contributions += last.byAccount[a.id]?.contribCum || 0;
      pools[pool].count += 1;
    }
    return Object.entries(pools).map(([pool, v]) => ({ pool, ...v }));
  }, [projection, accounts]);

  const POOL_LABELS = {
    "401k_employee": "401(k) Total",
    "ira": "IRA Total",
    "hsa": "HSA",
    "_other": "Cash / Taxable",
  };

  /* Look up the per-account current-year limit + ramp years for each
     account that participates in a pool. Used in the input row UI. */
  const accountInsight = (a) => {
    const pool = ACCOUNT_TYPE_TO_POOL[a.type];
    if (!pool) return null;
    const ageNow = (() => {
      if (a.owner === "p1" && tax?.p1BirthYear) return baseYear - tax.p1BirthYear;
      if (a.owner === "p2" && tax?.p2BirthYear) return baseYear - tax.p2BirthYear;
      if (a.owner === "joint") {
        if (tax?.p1BirthYear && tax?.p2BirthYear) return baseYear - Math.min(tax.p1BirthYear, tax.p2BirthYear);
        if (tax?.p1BirthYear) return baseYear - tax.p1BirthYear;
        if (tax?.p2BirthYear) return baseYear - tax.p2BirthYear;
      }
      return null;
    })();
    const limit = getPoolLimit(pool, baseYear, ageNow, hsaCoverage);
    const base = Number(a.contribAmount) || 0;
    const incr = Number(a.annualIncrease) || 0;
    const yearsToHit = yearsToHitPoolLimit(base, incr, limit);
    return { pool, limit, ageNow, yearsToHit };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Account list */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Accounts</h3>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>HSA coverage:</span>
            {["family", "self", "both-self"].map(c => (
              <button key={c} onClick={() => setForecast({ ...forecast, hsaCoverage: c })} style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, border: "none", borderRadius: 5, background: hsaCoverage === c ? "#9B59B6" : "var(--input-bg,#f5f5f5)", color: hsaCoverage === c ? "#fff" : "var(--tx2,#555)", cursor: "pointer", textTransform: "capitalize" }}>{c.replace("-", " ")}</button>
            ))}
            <span style={{ width: 1, height: 16, background: "var(--bdr,#ddd)", margin: "0 4px" }} />
            <button onClick={resetToDefaults} style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, border: "1px solid var(--bdr,#ddd)", borderRadius: 5, background: "transparent", color: "var(--tx3,#888)", cursor: "pointer" }} title="Replace all accounts with the default starter list.">Reset</button>
          </div>
        </div>

        {(!tax?.p1BirthYear && !tax?.p2BirthYear) && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 6, fontSize: 12, color: "#8A6D3B" }}>
            <strong>No birth years set.</strong> Catch-up contributions (50+ standard, 60-63 super, 55+ HSA) won't apply to projections. Add birth years on the Income tab to enable.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {accounts.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--tx3,#888)", fontSize: 12 }}>No accounts. Add one below.</div>
          )}
          {accounts.map(a => {
            const insight = accountInsight(a);
            const isOver = insight && (Number(a.contribAmount) || 0) > insight.limit;
            const color = accountColors[a.id] || "#888";
            const isExp = !!expanded[a.id];
            return (
              <div key={a.id} style={{ border: "1px solid var(--bdr,#e0e0e0)", borderLeft: `4px solid ${color}`, borderRadius: 8, overflow: "hidden" }}>
                {/* Header row — always visible */}
                <div onClick={() => toggleExpand(a.id)} style={{ display: "flex", alignItems: "center", padding: "10px 12px", cursor: "pointer", gap: 12, background: "var(--input-bg,#fafafa)", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--tx3,#888)", width: 12 }}>{isExp ? "▾" : "▸"}</span>
                  <input value={a.name} onChange={e => updateAccount(a.id, { name: e.target.value })} onClick={e => e.stopPropagation()} style={{ flex: "1 1 200px", border: "none", background: "transparent", fontSize: 13, fontWeight: 700, color: "var(--card-color,#222)", padding: 4 }} />
                  <span style={{ fontSize: 10, color: "var(--tx3,#888)", padding: "2px 6px", background: "var(--card-bg,#fff)", borderRadius: 4, fontWeight: 600 }}>{ACCOUNT_TYPE_LABELS[a.type] || a.type}</span>
                  <span style={{ fontSize: 10, color: "var(--tx3,#888)" }}>{a.owner === "p1" ? p1Name : a.owner === "p2" ? p2Name : "Joint"}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--card-color,#222)", minWidth: 90, textAlign: "right" }}>{fmt(Number(a.startBalance) || 0)}</span>
                  <button onClick={e => { e.stopPropagation(); removeAccount(a.id); }} title="Remove account" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#ccc", padding: "0 4px" }}>×</button>
                </div>

                {/* Expanded inputs */}
                {isExp && (
                  <div style={{ padding: 12, display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Type</label>
                      <select value={a.type} onChange={e => updateAccount(a.id, { type: e.target.value, capAtLimit: !["taxable","cash","custom"].includes(e.target.value) })} style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}>
                        {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Owner</label>
                      <select value={a.owner} onChange={e => updateAccount(a.id, { owner: e.target.value })} style={{ width: "100%", padding: 6, fontSize: 12, border: "1px solid var(--bdr,#ddd)", borderRadius: 6, background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}>
                        <option value="p1">{p1Name}</option>
                        <option value="p2">{p2Name}</option>
                        <option value="joint">Joint</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Starting Balance</label>
                      <NI value={String(a.startBalance)} onChange={v => updateAccount(a.id, { startBalance: evalF(v) })} onBlurResolve prefix="$" />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Annual Return %</label>
                      <NI value={String(a.annualReturn)} onChange={v => updateAccount(a.id, { annualReturn: evalF(v) })} onBlurResolve />
                    </div>
                    <div style={{ gridColumn: mob ? "1/-1" : "auto" }}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: isOver ? "#E8573A" : "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Annual Contribution {isOver && "⚠"}
                      </label>
                      <NI value={String(a.contribAmount)} onChange={v => updateAccount(a.id, { contribAmount: evalF(v) })} onBlurResolve prefix="$" />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Annual Increase %</label>
                      <NI value={String(a.annualIncrease)} onChange={v => updateAccount(a.id, { annualIncrease: evalF(v) })} onBlurResolve />
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--tx2,#555)", cursor: insight ? "pointer" : "not-allowed", opacity: insight ? 1 : 0.4 }}>
                        <input type="checkbox" checked={!!a.capAtLimit} disabled={!insight} onChange={e => updateAccount(a.id, { capAtLimit: e.target.checked })} />
                        Cap at IRS limit
                      </label>
                    </div>
                    {insight && (
                      <div style={{ gridColumn: "1/-1", padding: "8px 10px", background: "var(--input-bg,#f8f8f8)", borderRadius: 6, fontSize: 11, color: "var(--tx2,#555)", lineHeight: 1.6 }}>
                        <span style={{ color: "var(--tx3,#888)" }}>Pool limit ({baseYear}, {a.owner === "joint" ? "household" : a.owner === "p1" ? p1Name : p2Name}{insight.ageNow ? `, age ${insight.ageNow}` : ""}):</span> <strong>{fmt(insight.limit)}/yr</strong>
                        {isOver && (
                          <span style={{ color: "#E8573A", marginLeft: 8 }}>
                            ⚠ Over by {fmt((Number(a.contribAmount) || 0) - insight.limit)}{a.capAtLimit ? " — will be capped in projection" : ""}
                          </span>
                        )}
                        {!isOver && insight.yearsToHit !== null && insight.yearsToHit > 0 && (
                          <span style={{ marginLeft: 8 }}>At {a.annualIncrease}%/yr increase, hits limit in <strong>year {insight.yearsToHit}</strong></span>
                        )}
                        {(insight.pool === "401k_employee" || insight.pool === "ira") && (
                          <div style={{ color: "var(--tx3,#888)", fontSize: 10, marginTop: 4 }}>
                            Pool shared with other {insight.pool === "401k_employee" ? "401(k)" : "IRA"} accounts owned by {a.owner === "p1" ? p1Name : a.owner === "p2" ? p2Name : "this person"}.
                          </div>
                        )}
                        {insight.pool === "hsa" && (
                          <div style={{ color: "var(--tx3,#888)", fontSize: 10, marginTop: 4 }}>
                            Household HSA pool — limit shared across all HSA accounts.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(ACCOUNT_TYPE_LABELS).map(([type, label]) => (
            <button key={type} onClick={() => addAccount(type)} style={{ padding: "5px 10px", fontSize: 11, border: "1px dashed var(--bdr,#ccc)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "var(--tx2,#555)" }}>+ {label}</button>
          ))}
        </div>
      </Card>

      {/* Stacked area chart — totals over time */}
      {accounts.length > 0 && (
        <Card>
          <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>Projected Balance by Account</h3>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#e0e0e0)" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--tx2,#555)" }} label={{ value: "Years from now", position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--tx3,#888)" }} />
                <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 11, fill: "var(--tx2,#555)" }} width={70} />
                <Tooltip
                  contentStyle={{ background: "var(--card-bg,#fff)", border: "1px solid var(--bdr,#ddd)", borderRadius: 6, fontSize: 12 }}
                  formatter={(v, k) => {
                    if (k === "total") return [fmt(v), "Total"];
                    const a = accounts.find(x => x.id === k);
                    return [fmt(v), a ? a.name : k];
                  }}
                  labelFormatter={(y) => `Year ${y} (${baseYear + Number(y)})`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {accounts.map(a => (
                  <Area key={a.id} type="monotone" dataKey={a.id} name={a.name} stackId="1" fill={accountColors[a.id]} stroke={accountColors[a.id]} fillOpacity={0.7} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Per-pool summary cards */}
      {poolSummary.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : `repeat(${Math.min(poolSummary.length + 1, 5)}, 1fr)`, gap: 12 }}>
          {poolSummary.map(p => (
            <Card key={p.pool}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{POOL_LABELS[p.pool] || p.pool}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--card-color,#222)", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(p.nominal))}</div>
              <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4 }}>Real: {fmt(Math.round(p.real))}</div>
              <div style={{ fontSize: 11, color: "var(--tx3,#888)" }}>Contributed: {fmt(Math.round(p.contributions))}</div>
              <div style={{ fontSize: 10, color: "var(--tx3,#bbb)", marginTop: 2 }}>{p.count} account{p.count === 1 ? "" : "s"}</div>
            </Card>
          ))}
          <Card>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Total at Year {horizon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(poolSummary.reduce((s, p) => s + p.nominal, 0)))}</div>
            <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4 }}>Real: {fmt(Math.round(poolSummary.reduce((s, p) => s + p.real, 0)))}</div>
          </Card>
        </div>
      )}

      {/* Year-by-year table with per-account contribution columns */}
      {accounts.length > 0 && (
        <Card>
          <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>Year-by-Year Breakdown</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--input-bg,#f8f8f8)" }}>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Year</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Total</th>
                  {accounts.map(a => (
                    <th key={a.id} style={{ padding: 8, textAlign: "right", fontWeight: 700, color: accountColors[a.id], borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>{a.name}</th>
                  ))}
                  {accounts.map(a => (
                    <th key={a.id + "_c"} style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#aaa)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap", fontStyle: "italic" }}>{a.name} Contrib.</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projection.years.map(row => (
                  <tr key={row.year} style={{ borderBottom: "1px solid var(--bdr,#f0f0f0)" }}>
                    <td style={{ padding: 6, fontWeight: 700, color: "var(--card-color,#222)" }}>{row.year} <span style={{ color: "var(--tx3,#aaa)", fontWeight: 400 }}>({row.calendarYear})</span></td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 700, color: "var(--card-color,#222)" }}>{fmt(Math.round(row.totals.nominal))}</td>
                    {accounts.map(a => (
                      <td key={a.id} style={{ padding: 6, textAlign: "right", color: "var(--tx2,#555)" }}>{fmt(Math.round(row.byAccount[a.id]?.nominal || 0))}</td>
                    ))}
                    {accounts.map(a => {
                      const c = row.byAccount[a.id]?.contribution || 0;
                      const series = projection.accountSeries[a.id]?.[row.year];
                      const wasCapped = series?.capped;
                      return (
                        <td key={a.id + "_c"} style={{ padding: 6, textAlign: "right", color: wasCapped ? "#E8573A" : "var(--tx3,#888)", fontStyle: "italic", fontSize: 11 }}>
                          {row.year === 0 ? "—" : fmt(Math.round(c))}{wasCapped ? " ⚠" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {projection.poolWarnings.length > 0 && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "#FFF3F0", border: "1px solid #FFCDC2", borderRadius: 6, fontSize: 11, color: "#8A4A3F" }}>
              <strong>⚠ Capped {projection.poolWarnings.length} time{projection.poolWarnings.length === 1 ? "" : "s"}.</strong> Some contributions were reduced to fit within IRS pool limits. Toggle "Cap at IRS limit" off on individual accounts to model over-contribution scenarios.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* Forecast tab: projects compound growth of savings over time.
   Two sources for annual contribution:
   - "budget" (default): (savings + remaining budget) × 48 paychecks/yr + optional bonus
   - "actuals" (3/6/12mo): (income − expenses) over the window, annualized
   The actuals path replaces the budget-based contribution with what's actually
   happening per the transaction log — useful when actual spending diverges
   from the planned budget. Choice persists per-device to localStorage.

   Two view modes:
   - "simple": single-balance projection (the original tab UI)
   - "advanced": per-account breakdown with IRS limit pool enforcement,
     stacked area chart, per-pool summary cards. Mode persists to
     localStorage; account list persists to st.forecast (server-synced).
*/
export default function ForecastTab({ mob, C, tSavW, remW, tExpW, totalSavPlusRemW, includeEaip, transactions = [], cats = [], savCats = [], transferCats = [], incomeCats = [], preDed = [], hsaEmployerMatchAnnual = 0, forecast = {}, setForecast, tax = {}, p1Name = "Person 1", p2Name = "Person 2" }) {
  const [forecastMode, setForecastMode] = useState(() => { try { return localStorage.getItem("forecast-mode") || "simple"; } catch { return "simple"; } });
  useEffect(() => { try { localStorage.setItem("forecast-mode", forecastMode); } catch {} }, [forecastMode]);
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

      {/* Mode toggle. Simple = single-balance projection. Advanced = per-account
          breakdown with IRS limit enforcement, stacked area chart, pool cards. */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Mode:</span>
          <button onClick={() => setForecastMode("simple")} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: forecastMode === "simple" ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: forecastMode === "simple" ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Single-balance projection. Good for a quick what-if.">🎯 Simple</button>
          <button onClick={() => setForecastMode("advanced")} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 6, background: forecastMode === "advanced" ? "#556FB5" : "var(--input-bg,#f5f5f5)", color: forecastMode === "advanced" ? "#fff" : "var(--tx2,#555)", cursor: "pointer" }} title="Per-account breakdown. Tracks pre-tax/Roth 401(k), IRAs, HSA, and taxable separately, with IRS contribution limits enforced per pool.">⚙️ Advanced (Accounts)</button>
          <span style={{ fontSize: 11, color: "var(--tx3,#888)", marginLeft: "auto" }}>
            {forecastMode === "advanced"
              ? "Per-account projection. Limits enforced per IRS pool."
              : "Single-balance projection. Switch to Advanced for per-account detail."}
          </span>
        </div>
      </Card>

      {forecastMode === "advanced" && (
        <AdvancedForecast
          mob={mob}
          forecast={forecast}
          setForecast={setForecast}
          tax={tax}
          p1Name={p1Name}
          p2Name={p2Name}
          horizon={horizon}
          inflationPct={i * 100}
        />
      )}

      {forecastMode === "simple" && (<>

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

      </>)}

    </div>
  );
}

import { useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, Line, ComposedChart } from "recharts";
import { Card } from "../components/ui.jsx";
import { fmt, fmtCompact } from "../utils/calc.js";
import { newLoanId, resolveLoans, aggregateDebt, totalRemainingInterest, payoffMonthIndex } from "../utils/loans.js";

/* ── Loans subtab (Charts → Loans) ──
   Relocated out of AdvancedForecastTab (was the standalone "Loans"
   Card there). Pure debt amortization tracking, fully decoupled from
   the per-account forecast: the monthly payment is assumed to already
   live in the user's budget (which is what funds Advanced contributions
   via the savings rate). This tab surfaces remaining balance, payoff
   date, total remaining interest, and the per-loan amortization curve.

   Source of truth is unchanged: forecast.loans. Advanced still reads the
   same array for its year-by-year "Debt Remaining" column.

   horizon + baseYearMonth are re-derived here exactly as AdvancedForecastTab
   derives them, so the two tabs agree on the projection window. */
export default function LoansTab({ forecast, setForecast, mob }) {
  const horizon = (forecast && Number.isFinite(Number(forecast.horizon))) ? Number(forecast.horizon) : 30;
  const baseYearMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const loans = Array.isArray(forecast?.loans) ? forecast.loans : [];

  const updateLoan = (id, patch) => {
    setForecast(prev => {
      const cur = Array.isArray(prev?.loans) ? prev.loans : [];
      return { ...prev, loans: cur.map(ln => ln.id === id ? { ...ln, ...patch } : ln) };
    });
  };
  const removeLoan = (id) => {
    setForecast(prev => {
      const cur = Array.isArray(prev?.loans) ? prev.loans : [];
      return { ...prev, loans: cur.filter(ln => ln.id !== id) };
    });
  };
  const addLoan = () => {
    /* Default origination: 1 month out, first of that month. "Right now"
       (current month) would land in `inPast` per resolveLoans semantics
       — we'd rather the user see a working default than have to fix the
       date before anything happens. Pre-base loans ARE supported in the
       new shape (Phase 14b) — the resolver walks the schedule and resumes
       mid-payment — but as a default we still pick a future month so the
       full curve renders. */
    const defaultDate = (() => {
      const d = new Date();
      const total = d.getFullYear() * 12 + d.getMonth() + 1;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      return `${year}-${String(month).padStart(2, "0")}-01`;
    })();
    const newLoan = {
      id: newLoanId(),
      label: "",
      principal: 0,
      originationDate: defaultDate,
      interestRate: 6.5,             // reasonable post-2022 average for autos / personal
      termMonths: 60,                // 5y — typical auto loan; user picks 360 for mortgage
      extraMonthlyPrincipal: 0,      // optional acceleration
    };
    setForecast(prev => {
      const cur = Array.isArray(prev?.loans) ? prev.loans : [];
      return { ...prev, loans: [...cur, newLoan] };
    });
  };
  /* Resolve loans. Mirrors the one-time-events shape — { loans, orphans,
     inPast, outOfHorizon }. Recompute on loan/horizon change; loan
     resolution doesn't depend on accounts (Phase 14b: loans are pure
     amortization records, decoupled from forecast accounts). Same
     baseYearMonth split convention as resolveOneTimeEvents. */
  const resolvedLoans = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    const [yStr, mStr] = baseYearMonth.split("-");
    const baseYM = { year: Number(yStr), month: Number(mStr) };
    return resolveLoans(loans, baseYM, horizonMonths);
  }, [loans, baseYearMonth, horizon]);

  /* Phase 14b: derived debt aggregates. Drives the per-row Monthly /
     Payoff / Interest cells, the summary card under the Loans table,
     the Debt Paydown chart, and the per-year "Debt Remaining" column
     in the year-by-year table.

     aggregateDebt produces one row per absolute month with totalRemaining,
     perLoanRemaining, and the totals of interest/principal/payment that
     month. We sample at end-of-year (monthIndex multiples of 12) for the
     chart + table. */
  const debtAggregate = useMemo(() => {
    const horizonMonths = (Number(horizon) || 0) * 12;
    return aggregateDebt(resolvedLoans.loans, horizonMonths);
  }, [resolvedLoans.loans, horizon]);

  /* Year-end debt snapshots: index by row.year (0..horizon).
     year 0 = base date itself (no payments yet). year N = balance after
     month N*12 (end of year N). Used by both the chart and the
     year-by-year "Debt Remaining" column. */
  const debtByYear = useMemo(() => {
    const out = {};
    // Year 0 = sum of remainingAtBase across all resolved loans.
    let y0Total = 0;
    const y0PerLoan = {};
    for (const ln of resolvedLoans.loans) {
      // For a future-origination loan, remainingAtBase === principal,
      // but the loan hasn't STARTED yet at year 0 — we still show the
      // principal as "what you'll owe once it kicks in", which matches
      // what a user would expect at the chart's left edge. Pre-base
      // loans show their actual remaining-at-base.
      y0PerLoan[ln.id] = ln.remainingAtBase;
      y0Total += ln.remainingAtBase;
    }
    out[0] = { total: y0Total, perLoan: y0PerLoan };
    // Years 1..horizon: end-of-year balance from the monthly aggregate.
    const yMax = Number(horizon) || 0;
    for (let y = 1; y <= yMax; y++) {
      const row = debtAggregate[y * 12 - 1]; // monthIndex y*12 → array idx y*12-1
      if (row) {
        out[y] = { total: row.totalRemaining, perLoan: { ...row.perLoanRemaining } };
      } else {
        out[y] = { total: 0, perLoan: {} };
      }
    }
    return out;
  }, [resolvedLoans.loans, debtAggregate, horizon]);

  /* Per-loan computed display values: payoff month/date, total remaining
     interest (life-of-loan from base onward). Computed once per loan
     for the table rows and the summary card. */
  const loanComputed = useMemo(() => {
    const out = {};
    const horizonMonths = (Number(horizon) || 0) * 12;
    const [yStr, mStr] = baseYearMonth.split("-");
    const baseY = Number(yStr);
    const baseM = Number(mStr);
    for (const ln of resolvedLoans.loans) {
      const payoffM = payoffMonthIndex(ln, horizonMonths);
      let payoffDate = null;
      let payoffWithinHorizon = false;
      if (payoffM !== null) {
        payoffWithinHorizon = true;
        // Convert payoffM (absolute monthIndex from base) to a YYYY-MM date.
        const totalMonths = (baseY * 12 + (baseM - 1)) + payoffM;
        const py = Math.floor(totalMonths / 12);
        const pm = (totalMonths % 12) + 1;
        payoffDate = `${py}-${String(pm).padStart(2, "0")}`;
      }
      const totalInterest = totalRemainingInterest([ln], horizonMonths);
      out[ln.id] = {
        basePayment: ln.basePayment,
        extraMonthlyPrincipal: ln.extraMonthlyPrincipal,
        monthlyOutflow: ln.basePayment + ln.extraMonthlyPrincipal,
        payoffMonthIndex: payoffM,
        payoffDate,
        payoffWithinHorizon,
        totalInterest,
      };
    }
    return out;
  }, [resolvedLoans.loans, baseYearMonth, horizon]);

  return (
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>
              Loans
              {loans.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--tx3,#888)" }}>
                  ({loans.length})
                </span>
              )}
            </h3>
            <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginTop: 4, maxWidth: 680 }}>
              Track debt balances over time. Enter principal, rate, term, and (optionally) extra monthly principal — payoff date, monthly payment, and total interest are computed via standard amortization. <strong>Your monthly payment is assumed to already be in your budget</strong>; this section doesn't move money in the per-account projection, it tracks what you owe so the chart and table can show debt remaining over the horizon.
            </div>
          </div>
          <button
            onClick={addLoan}
            title="Add a loan"
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              border: "none",
              borderRadius: 6,
              background: "#556FB5",
              color: "#fff",
              cursor: "pointer",
            }}
          >+ Add</button>
        </div>

        {(resolvedLoans.orphans.length > 0 || resolvedLoans.outOfHorizon.length > 0) && (
          <div style={{ padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#92400E", background: "rgba(243,156,18,0.12)", border: "1px solid rgba(243,156,18,0.35)", borderRadius: 6 }}>
            {resolvedLoans.orphans.length > 0 && <div>⚠ {resolvedLoans.orphans.length} loan{resolvedLoans.orphans.length === 1 ? "" : "s"} can't be applied — fix the highlighted inputs (principal, rate, term, or date) below.</div>}
            {resolvedLoans.outOfHorizon.length > 0 && <div>ℹ {resolvedLoans.outOfHorizon.length} loan{resolvedLoans.outOfHorizon.length === 1 ? " originates" : "s originate"} beyond the forecast horizon — extend the horizon to include {resolvedLoans.outOfHorizon.length === 1 ? "it" : "them"}.</div>}
          </div>
        )}

        {loans.length === 0 ? (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--tx3,#888)", fontStyle: "italic", textAlign: "center", background: "var(--input-bg,#fafafa)", borderRadius: 6, border: "1px dashed var(--bdr,#ddd)" }}>
            No loans configured. Click <strong>+ Add</strong> to track a mortgage, auto loan, HELOC, or other debt.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--input-bg,#f8f8f8)" }}>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)" }}>Label</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Principal</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Rate %</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Term (mo)</th>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Origination</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }} title="Extra principal paid each month on top of the standard amortization">Extra/mo</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }} title="Standard amortized payment + extra monthly principal (assumed to be in your budget)">Monthly Payment</th>
                  <th style={{ padding: 8, textAlign: "left", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Payoff Date</th>
                  <th style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }} title="Total interest from the base date through the end of the loan">Total Interest</th>
                  <th style={{ padding: 8, textAlign: "center", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}>Status</th>
                  <th style={{ padding: 8, textAlign: "center", fontWeight: 700, color: "var(--tx3,#888)", borderBottom: "1px solid var(--bdr,#ddd)", whiteSpace: "nowrap" }}></th>
                </tr>
              </thead>
              <tbody>
                {loans.map(ln => {
                  /* Per-row status — derived from the resolved arrays.
                     Phase 14b: orphan reasons are bad-principal | bad-rate |
                     bad-term | bad-date. inPast = loan fully paid off
                     before base (just informational). outOfHorizon =
                     originates after projection ends. Active = applied
                     to the debt curve; Active* = applied but term outlasts
                     horizon (chart shows partial paydown). */
                  const resolved = resolvedLoans.loans.find(r => r.id === ln.id);
                  const orphan = resolvedLoans.orphans.find(r => r.id === ln.id);
                  const inPast = resolvedLoans.inPast.some(r => r.id === ln.id);
                  const outHz = resolvedLoans.outOfHorizon.some(r => r.id === ln.id);
                  const computed = loanComputed[ln.id];
                  let status = "Active";
                  let statusColor = "#27AE60";
                  let statusDetail = "";
                  if (orphan) {
                    if (orphan.reason === "bad-principal") { status = "Bad principal"; }
                    else if (orphan.reason === "bad-term") { status = "Bad term"; }
                    else if (orphan.reason === "bad-rate") { status = "Bad rate"; }
                    else if (orphan.reason === "bad-date") { status = "Bad date"; }
                    else { status = "Error"; }
                    statusColor = "#C0392B";
                  } else if (inPast) {
                    status = "Paid off"; statusColor = "#888";
                    statusDetail = "before base date";
                  } else if (outHz) {
                    status = "Future"; statusColor = "#888";
                    statusDetail = "starts after horizon";
                  } else if (resolved && computed && !computed.payoffWithinHorizon) {
                    /* Loan is applied, but term outlasts the horizon —
                       show partial paydown distinctly. */
                    status = "Active*";
                    statusColor = "#E67E22";
                    statusDetail = "term > horizon";
                  } else if (!resolved) {
                    status = "Inactive"; statusColor = "#888";
                  }
                  const monthlyDisplay = computed ? fmt(Math.round(computed.monthlyOutflow)) : "—";
                  const payoffDisplay = computed && computed.payoffDate
                    ? computed.payoffDate
                    : (resolved ? "after horizon" : "—");
                  const totalInterestDisplay = computed
                    ? fmt(Math.round(computed.totalInterest))
                    : "—";
                  return (
                    <tr key={ln.id} style={{ borderBottom: "1px solid var(--bdr,#f0f0f0)" }}>
                      <td style={{ padding: 6 }}>
                        <input
                          type="text"
                          value={ln.label || ""}
                          onChange={(e) => updateLoan(ln.id, { label: e.target.value })}
                          placeholder="e.g. home mortgage"
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", minWidth: 90, boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {/* Native numeric input — same rationale as one-time
                            events: NI's blur-only commit is unreliable on
                            mobile (iOS Safari especially). */}
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={ln.principal === 0 ? "" : ln.principal}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const n = raw === "" ? 0 : Number(raw);
                            updateLoan(ln.id, { principal: Number.isFinite(n) ? n : 0 });
                          }}
                          placeholder="$"
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", minWidth: 80, textAlign: "right", boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={ln.interestRate ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const n = raw === "" ? 0 : Number(raw);
                            updateLoan(ln.id, { interestRate: Number.isFinite(n) ? n : 0 });
                          }}
                          placeholder="%"
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", minWidth: 54, textAlign: "right", boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        <input
                          type="number"
                          inputMode="numeric"
                          step="1"
                          min="0"
                          value={ln.termMonths === 0 ? "" : ln.termMonths}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const n = raw === "" ? 0 : Number(raw);
                            updateLoan(ln.id, { termMonths: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0 });
                          }}
                          placeholder="months"
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", minWidth: 60, textAlign: "right", boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input
                          type="date"
                          value={ln.originationDate || ""}
                          onChange={(e) => updateLoan(ln.id, { originationDate: e.target.value })}
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", minWidth: 130, boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {/* Extra monthly principal — optional acceleration.
                            Defaults to 0 (no extra). Affects payoff date and
                            total interest immediately. */}
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={(ln.extraMonthlyPrincipal ?? 0) === 0 ? "" : (ln.extraMonthlyPrincipal ?? 0)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const n = raw === "" ? 0 : Number(raw);
                            updateLoan(ln.id, { extraMonthlyPrincipal: Number.isFinite(n) && n >= 0 ? n : 0 });
                          }}
                          placeholder="$"
                          style={{ fontSize: 12, padding: "4px 6px", border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fff)", color: "var(--card-color,#222)", width: "100%", minWidth: 70, textAlign: "right", boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: 6, textAlign: "right", fontWeight: 600, color: "var(--card-color,#222)", whiteSpace: "nowrap" }}>
                        {monthlyDisplay}
                      </td>
                      <td style={{ padding: 6, fontSize: 12, color: "var(--tx2,#555)" }}>
                        {payoffDisplay}
                      </td>
                      <td style={{ padding: 6, textAlign: "right", fontSize: 12, color: "#C0392B", whiteSpace: "nowrap" }}>
                        {totalInterestDisplay}
                      </td>
                      <td style={{ padding: 6, textAlign: "center", fontSize: 11, color: statusColor, fontWeight: 600 }}>
                        <div>{status}</div>
                        {statusDetail && <div style={{ fontSize: 10, fontWeight: 400, color: "var(--tx3,#888)" }}>{statusDetail}</div>}
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        <button
                          onClick={() => removeLoan(ln.id)}
                          title="Delete loan"
                          style={{ padding: "2px 8px", fontSize: 12, fontWeight: 700, border: "1px solid var(--bdr,#ddd)", borderRadius: 4, background: "var(--input-bg,#fafafa)", color: "#C0392B", cursor: "pointer" }}
                        >×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Loan summary — total remaining interest + total remaining
            principal across all active loans, plus a count of loans
            paying off within the horizon. Derived from loanComputed and
            debtByYear, not from any math-layer projection — loans are
            decoupled from the per-account forecast. */}
        {resolvedLoans.loans.length > 0 && (() => {
          const totalInterest = resolvedLoans.loans.reduce(
            (s, ln) => s + (loanComputed[ln.id]?.totalInterest || 0), 0,
          );
          const totalRemainingPrincipal = resolvedLoans.loans.reduce(
            (s, ln) => s + (ln.remainingAtBase || 0), 0,
          );
          const finishing = resolvedLoans.loans.filter(
            ln => loanComputed[ln.id]?.payoffWithinHorizon,
          ).length;
          const ongoing = resolvedLoans.loans.length - finishing;
          return (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--input-bg,#fafafa)", border: "1px solid var(--bdr,#eee)", borderRadius: 6, fontSize: 12, color: "var(--tx2,#555)" }}>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Remaining principal</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--card-color,#222)", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(totalRemainingPrincipal))}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Total remaining interest</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#C0392B", fontFamily: "'Fraunces',serif" }}>{fmt(Math.round(totalInterest))}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 0.5 }}>Paid off in horizon</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#27AE60", fontFamily: "'Fraunces',serif" }}>{finishing}{ongoing > 0 ? <span style={{ fontSize: 12, color: "var(--tx3,#888)", fontWeight: 400 }}> / {resolvedLoans.loans.length}</span> : ""}</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Debt Paydown chart — one line per loan + bold "Total debt" line.
            Each loan's line drops to zero on payoff and disappears (key
            absent from perLoanRemaining after payoff). Sampled at year
            boundaries from debtByYear. */}
        {resolvedLoans.loans.length > 0 && (() => {
          const chartData = [];
          for (let y = 0; y <= horizon; y++) {
            const snap = debtByYear[y] || { total: 0, perLoan: {} };
            const row = { year: y, total: snap.total };
            for (const ln of resolvedLoans.loans) {
              /* Show 0 for paid-off loans so the line drops to zero on
                 payoff. The perLoan map omits paid-off keys; we explicitly
                 fill 0 here for charting clarity. */
              row[ln.id] = snap.perLoan[ln.id] || 0;
            }
            chartData.push(row);
          }
          // Pick a stable per-loan color. Reuse the accountColors palette
          // pattern: hash the loan id. Keep it simple.
          const loanColors = ["#556FB5", "#9B59B6", "#16A085", "#E67E22", "#34495E", "#8E44AD", "#2C7A7B"];
          const loanColorFor = (id, idx) => loanColors[idx % loanColors.length];
          return (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--tx2,#555)", marginBottom: 6, fontFamily: "'Fraunces',serif" }}>Debt Paydown</div>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr,#eee)" />
                    <XAxis
                      dataKey="year"
                      tick={{ fontSize: 11, fill: "var(--tx3,#888)" }}
                      label={{ value: "Years from now", position: "insideBottom", offset: -6, fontSize: 11, fill: "var(--tx3,#888)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--tx3,#888)" }}
                      tickFormatter={(v) => fmtCompact(v)}
                    />
                    <Tooltip
                      formatter={(v, n) => [fmt(Math.round(Number(v) || 0)), n]}
                      labelFormatter={(y) => `Year ${y}`}
                      contentStyle={{ background: "var(--input-bg,#fff)", border: "1px solid var(--bdr,#ddd)", borderRadius: 6, fontSize: 11 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {resolvedLoans.loans.map((ln, idx) => (
                      <Line
                        key={ln.id}
                        type="monotone"
                        dataKey={ln.id}
                        name={ln.label || `Loan ${idx + 1}`}
                        stroke={loanColorFor(ln.id, idx)}
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Total debt"
                      stroke="#C0392B"
                      strokeWidth={3}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}
      </Card>
  );
}

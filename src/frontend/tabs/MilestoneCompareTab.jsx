import { useMemo, useState } from "react";
import { Card } from "../components/ui.jsx";
import { fmt } from "../utils/calc.js";
import { reconstructFromItems } from "../utils/budgetCompare.js";
import {
  compareMilestones,
  milestoneAsCompareInput,
  liveAsCompareInput,
  periodValue,
} from "../utils/milestoneCompare.js";

/* ── MilestoneCompareTab ─────────────────────────────────────────────────
   Third subtab under Budget. Diffs two budget snapshots (saved milestone or
   live "Current") and renders the result as:
     • Five aggregate summary cards (Net income / Total expense / Total
       savings / Remaining / Savings rate)
     • Income table (two salaries + two bonus %)
     • Line-item table grouped by section (Necessities → Discretionary →
       Savings), with status-colored borders.
   Period columns respect the live VisCols (Wk/Mo/Y48/Y52) — flipping a
   column on/off in the live Budget tab also flips it here.
   "Show unchanged" toggle defaults to OFF, so the diff is the diff. */

/* Color tokens — keep in sync with the rest of the budget app. */
const COLOR_ADDED   = "#2ECC71";  // green
const COLOR_REMOVED = "#9B59B6";  // purple-ish for "this is gone"
const COLOR_INC     = "#E74C3C";  // red — spending up / income down (bad)
const COLOR_DEC     = "#2ECC71";  // green — spending down / income up (good)
const COLOR_NEUTRAL = "var(--tx3, #999)";

/* Pretty delta text: signed dollar amount with explicit + for positive. */
const fmtDelta = (n) => (n >= 0 ? "+" : "") + fmt(n);

/* For SAVINGS-RATE delta we use percentage-points text. */
const fmtDeltaPct = (n) => (n >= 0 ? "+" : "") + n.toFixed(1) + " pp";

/* Color for a delta in a "more is worse" context (e.g. expenses).
   Positive → red, negative → green, zero → neutral. */
const expenseDeltaColor = (d) => (Math.abs(d) < 0.005 ? COLOR_NEUTRAL : (d > 0 ? COLOR_INC : COLOR_DEC));
/* Color for a delta in a "more is better" context (e.g. savings, net income). */
const incomeDeltaColor = (d) => (Math.abs(d) < 0.005 ? COLOR_NEUTRAL : (d > 0 ? COLOR_DEC : COLOR_INC));

/* Border accent for a row status. Added → green left border; removed → muted
   gray with strikethrough handled inline; changed/unchanged → no border. */
function rowStyle(status) {
  if (status === "added")    return { borderLeft: `3px solid ${COLOR_ADDED}`,   paddingLeft: 8 };
  if (status === "removed")  return { borderLeft: `3px solid ${COLOR_REMOVED}`, paddingLeft: 8, opacity: 0.65 };
  return { borderLeft: "3px solid transparent",                                  paddingLeft: 8 };
}

/* Pretty period header for the column. */
const PERIOD_LABEL = { w: "Weekly", m: "Monthly", y48: "Y48", y52: "Y52" };

/* Compare-input adapter for the "Current" option. Pulls every field the diff
   needs out of the live S bag. Memoized in the parent. */
function buildLiveInput(props) {
  const {
    exp, sav,
    cSal, kSal, cEaip, kEaip,
    p1Name, p2Name,
    C, tExpW, tSavW, remW,
  } = props;
  // Live savings rate, matching the Budget tab's totalAllSavingsW / netW.
  const retirementW = (C?.c4w || 0) + (C?.k4w || 0) + (C?.cIraTradW || 0) + (C?.cIraRothW || 0) + (C?.kIraTradW || 0) + (C?.kIraRothW || 0);
  const totalAllSavingsW = tSavW + remW + retirementW;
  const savRate = C?.net > 0 ? (totalAllSavingsW / C.net * 100) : 0;
  return liveAsCompareInput({
    exp, sav,
    cSal, kSal, cEaip, kEaip,
    p1Name, p2Name,
    netW: C?.net || 0,
    tExpW, tSavW, remW,
    savRate,
  });
}

export default function MilestoneCompareTab({
  mob,
  visCols,                            // { wk, mo, y48, y52 } — live VisCols
  milestones,
  // live state — everything needed to build the "Current" compare input
  exp, sav,
  cSal, kSal, cEaip, kEaip,
  p1Name, p2Name,
  C, tExpW, tSavW, remW,
}) {
  /* Dropdown selections. Each is either a string milestone id, or "live".
     Defaults: A = most-recent milestone (or live if none), B = live. */
  const sortedMilestones = useMemo(() => {
    return [...(milestones || [])]
      .map((m, i) => ({ ...m, _idx: i }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [milestones]);

  const [selA, setSelA] = useState(() => {
    if (sortedMilestones.length > 0) return `ms:${sortedMilestones[0].id ?? sortedMilestones[0]._idx}`;
    return "live";
  });
  const [selB, setSelB] = useState("live");
  const [showUnchanged, setShowUnchanged] = useState(false);

  /* Build a compare-input for a given dropdown selection. */
  const liveInput = useMemo(
    () => buildLiveInput({ exp, sav, cSal, kSal, cEaip, kEaip, p1Name, p2Name, C, tExpW, tSavW, remW }),
    [exp, sav, cSal, kSal, cEaip, kEaip, p1Name, p2Name, C, tExpW, tSavW, remW]
  );

  const inputForSelection = (sel) => {
    if (sel === "live") return liveInput;
    if (sel?.startsWith("ms:")) {
      const idOrIdx = sel.slice(3);
      // Try id match first (string compare), fall back to _idx (numeric).
      const m = sortedMilestones.find(x => String(x.id) === idOrIdx)
            || sortedMilestones[parseInt(idOrIdx, 10)];
      if (m) return milestoneAsCompareInput(m, reconstructFromItems);
    }
    return liveInput;
  };

  const aInput = useMemo(() => inputForSelection(selA), [selA, sortedMilestones, liveInput]);
  const bInput = useMemo(() => inputForSelection(selB), [selB, sortedMilestones, liveInput]);
  const diff   = useMemo(() => compareMilestones(aInput, bInput), [aInput, bInput]);

  /* Which periods to show. Default to all-on if visCols missing. */
  const periods = [];
  if (visCols?.wk  !== false) periods.push("w");
  if (visCols?.mo  !== false) periods.push("m");
  if (visCols?.y48 !== false) periods.push("y48");
  if (visCols?.y52 !== false) periods.push("y52");
  if (periods.length === 0) periods.push("m");  // safety fallback

  /* Group + filter rows for display. */
  const filteredRows = useMemo(() => {
    const rows = diff.items.rows;
    if (showUnchanged) return rows;
    return rows.filter(r => r.status !== "unchanged");
  }, [diff.items.rows, showUnchanged]);

  const rowsBySection = useMemo(() => ({
    N: filteredRows.filter(r => r.section === "N"),
    D: filteredRows.filter(r => r.section === "D"),
    S: filteredRows.filter(r => r.section === "S"),
  }), [filteredRows]);

  /* Build the dropdown options once. */
  const dropdownOptions = useMemo(() => {
    const opts = [{ value: "live", label: "Current" }];
    for (const m of sortedMilestones) {
      const datePart = m.date ? new Date(m.date + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
      const label = `${m.label || "(untitled)"} — ${datePart}`;
      opts.push({ value: `ms:${m.id ?? m._idx}`, label });
    }
    return opts;
  }, [sortedMilestones]);

  /* Empty-state: nothing to compare. */
  if (sortedMilestones.length === 0) {
    return (
      <Card style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 14, color: "var(--tx3,#999)" }}>
          No milestones yet. Save your first from the Live tab toolbar, then come back here to compare it against the current budget.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Selector card ──────────────────────────────────────────────── */}
      <Card>
        <div style={{ display: "flex", flexDirection: mob ? "column" : "row", gap: 12, alignItems: mob ? "stretch" : "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>A — Baseline</div>
            <select value={selA} onChange={e => setSelA(e.target.value)} style={{ width: "100%", padding: "8px 10px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid var(--bdr,#ddd)", background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}>
              {dropdownOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--tx3,#999)", padding: mob ? "0" : "0 4px 6px" }}>→</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>B — Compare to</div>
            <select value={selB} onChange={e => setSelB(e.target.value)} style={{ width: "100%", padding: "8px 10px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid var(--bdr,#ddd)", background: "var(--input-bg,#fafafa)", color: "var(--input-color,#222)" }}>
              {dropdownOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--tx2,#555)", cursor: "pointer", whiteSpace: "nowrap", paddingBottom: mob ? 0 : 8 }}>
            <input type="checkbox" checked={showUnchanged} onChange={e => setShowUnchanged(e.target.checked)} />
            Show unchanged
          </label>
        </div>
      </Card>

      {/* ── Aggregate summary cards ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: mob ? "repeat(2, 1fr)" : "repeat(5, 1fr)", gap: 10 }}>
        <SummaryCard label="Net income"    summary={diff.summary.netIncome}    color={incomeDeltaColor(diff.summary.netIncome.delta)} />
        <SummaryCard label="Total expense" summary={diff.summary.totalExpense} color={expenseDeltaColor(diff.summary.totalExpense.delta)} />
        <SummaryCard label="Total savings" summary={diff.summary.totalSavings} color={incomeDeltaColor(diff.summary.totalSavings.delta)} />
        <SummaryCard label="Remaining"     summary={diff.summary.remaining}    color={incomeDeltaColor(diff.summary.remaining.delta)} />
        <SummaryCard label="Savings rate"  summary={diff.summary.savRate}      color={incomeDeltaColor(diff.summary.savRate.delta)} isPct />
      </div>

      {/* ── Income section ────────────────────────────────────────────── */}
      <Card>
        <SectionHeader title="Income" aLabel={diff.aLabel} bLabel={diff.bLabel} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {diff.income
            .filter(r => showUnchanged || r.status !== "unchanged")
            .map((r, i) => (
              <IncomeRow key={i} row={r} mob={mob} />
            ))}
          {diff.income.every(r => r.status === "unchanged") && !showUnchanged && (
            <div style={{ fontSize: 12, color: "var(--tx3,#999)", fontStyle: "italic", padding: "8px 4px" }}>No income changes.</div>
          )}
        </div>
      </Card>

      {/* ── Line items ─────────────────────────────────────────────────── */}
      <Card>
        <SectionHeader title="Budget line items" aLabel={diff.aLabel} bLabel={diff.bLabel} />

        {filteredRows.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--tx3,#999)", fontStyle: "italic", padding: "16px 4px", textAlign: "center" }}>
            {showUnchanged
              ? "No line items in either snapshot."
              : "No line-item changes between these snapshots. Toggle “Show unchanged” to see the full list."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <SectionGroup title="Necessities"   color="#556FB5" rows={rowsBySection.N} periods={periods} mob={mob} />
            <SectionGroup title="Discretionary" color="#E8573A" rows={rowsBySection.D} periods={periods} mob={mob} />
            <SectionGroup title="Savings"       color="#2ECC71" rows={rowsBySection.S} periods={periods} mob={mob} />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ──────────────────────── sub-components ──────────────────────── */

function SummaryCard({ label, summary, color, isPct }) {
  const showA = isPct ? `${(summary.a || 0).toFixed(1)}%` : fmt(summary.a);
  const showB = isPct ? `${(summary.b || 0).toFixed(1)}%` : fmt(summary.b);
  const showDelta = isPct ? fmtDeltaPct(summary.delta) : fmtDelta(summary.delta);
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--tx2,#555)", display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span>{showA}</span>
        <span style={{ color: "var(--tx3,#999)" }}>→</span>
        <span>{showB}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "'Fraunces',serif" }}>
        {showDelta}
      </div>
    </Card>
  );
}

function SectionHeader({ title, aLabel, bLabel }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
      <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>{title}</h3>
      <div style={{ fontSize: 11, color: "var(--tx3,#999)" }}>
        <strong style={{ color: "var(--tx2,#555)" }}>{aLabel}</strong>
        <span style={{ margin: "0 6px" }}>→</span>
        <strong style={{ color: "var(--tx2,#555)" }}>{bLabel}</strong>
      </div>
    </div>
  );
}

function IncomeRow({ row, mob }) {
  const valFmt = row.isPct
    ? (v) => `${(v || 0).toFixed(1)}%`
    : (v) => fmt(v);
  const deltaFmt = row.isPct ? fmtDeltaPct : fmtDelta;
  const status = row.status;
  const baseStyle = rowStyle(status);
  const nameStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--tx,#333)",
    textDecoration: status === "removed" ? "line-through" : "none",
  };
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: mob ? "1.5fr 1fr 1fr 1fr" : "2fr 1fr 1fr 1fr",
      gap: 6,
      alignItems: "center",
      padding: "6px 0",
      borderTop: "1px solid var(--bdr,#f0f0f0)",
      ...baseStyle,
    }}>
      <span style={nameStyle}>{row.name}</span>
      <span style={{ fontSize: 11, color: "var(--tx2,#555)", textAlign: "right" }}>{valFmt(row.aValue)}</span>
      <span style={{ fontSize: 11, color: "var(--tx2,#555)", textAlign: "right" }}>{valFmt(row.bValue)}</span>
      <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right", color: incomeDeltaColor(row.delta) }}>
        {status === "unchanged" ? "—" : deltaFmt(row.delta)}
      </span>
    </div>
  );
}

function SectionGroup({ title, color, rows, periods, mob }) {
  if (rows.length === 0) return null;
  /* Grid columns: name | (A periods) | (B periods) | delta-annual */
  const periodCount = periods.length;
  // On mobile, show only a single period column (whichever the user has on
  // first). The diff is still annual-aware via the delta column.
  const visiblePeriods = mob ? periods.slice(0, 1) : periods;
  const cols = `1.4fr ${visiblePeriods.map(() => "1fr").join(" ")} ${visiblePeriods.map(() => "1fr").join(" ")} 1fr`;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{title}</div>
      {/* header */}
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, padding: "4px 0", borderBottom: "1px solid var(--bdr,#e0e0e0)", fontSize: 9, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        <span>Item</span>
        {visiblePeriods.map(p => <span key={`ah-${p}`} style={{ textAlign: "right" }}>A · {PERIOD_LABEL[p]}</span>)}
        {visiblePeriods.map(p => <span key={`bh-${p}`} style={{ textAlign: "right" }}>B · {PERIOD_LABEL[p]}</span>)}
        <span style={{ textAlign: "right" }}>Δ Y48</span>
      </div>
      {/* rows */}
      {rows.map((r, i) => <CompareRow key={`${r.section}-${r.name}-${i}`} row={r} periods={visiblePeriods} cols={cols} />)}
    </div>
  );
}

function CompareRow({ row, periods, cols }) {
  const aStriked = row.status === "removed";
  const bStriked = false;
  const nameTextDeco = row.status === "removed" ? "line-through" : "none";
  // For each period, convert the item's value (or 0 if absent) to that period.
  // We use the raw item if present so weekly/monthly values reflect the user's
  // declared period exactly (no rounding from the annual48 → period back-trip).
  const aDisplay = (period) => row.aItem ? periodValue(row.aItem, period) : 0;
  const bDisplay = (period) => row.bItem ? periodValue(row.bItem, period) : 0;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: cols,
      gap: 6,
      alignItems: "center",
      padding: "5px 0",
      borderTop: "1px solid var(--bdr,#f5f5f5)",
      fontSize: 12,
      ...rowStyle(row.status),
    }}>
      <span style={{ color: "var(--tx,#333)", fontWeight: 600, textDecoration: nameTextDeco }}>
        {row.name}
        {row.category && (
          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--tx3,#999)", marginLeft: 6 }}>{row.category}</span>
        )}
      </span>
      {periods.map(p => (
        <span key={`a-${p}`} style={{ textAlign: "right", color: row.aItem ? "var(--tx2,#555)" : "var(--tx3,#bbb)", textDecoration: aStriked ? "line-through" : "none" }}>
          {row.aItem ? fmt(aDisplay(p)) : "—"}
        </span>
      ))}
      {periods.map(p => (
        <span key={`b-${p}`} style={{ textAlign: "right", color: row.bItem ? "var(--tx2,#555)" : "var(--tx3,#bbb)", textDecoration: bStriked ? "line-through" : "none" }}>
          {row.bItem ? fmt(bDisplay(p)) : "—"}
        </span>
      ))}
      <span style={{
        textAlign: "right",
        fontWeight: 700,
        // For SAVINGS section, treat positive delta as "good" (more saved).
        // For expense sections, treat positive delta as "bad" (more spent).
        color: row.status === "unchanged"
          ? COLOR_NEUTRAL
          : (row.section === "S" ? incomeDeltaColor(row.delta) : expenseDeltaColor(row.delta)),
      }}>
        {row.status === "unchanged" ? "—" : fmtDelta(row.delta)}
      </span>
    </div>
  );
}

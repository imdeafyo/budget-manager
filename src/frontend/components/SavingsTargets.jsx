/* ══════════════════════════ Savings Targets ══════════════════════════
   Budget → Live: two tweakable, hideable "how much should I have saved"
   boxes — an emergency reserve and a house maintenance fund.

   - Emergency reserve = monthly expenses × months. Monthly expenses default
     to the sum of all *necessity* items (calendar-monthly), and the user can
     toggle individual necessity/discretionary items in or out, or override
     the monthly figure entirely. Item selection is stored as an *exclusion*
     set of stable item ids so a newly-added necessity is included by default
     and the set survives row delete/reorder/rename.

   - House fund = home value × maintenance percent (default 1.5%, the mid-point
     of the 1–3% annual-maintenance rule of thumb).

   All math lives in utils/savingsTargets.js (pure, tested). This file is
   presentation + wiring only.

   The whole panel is collapsible (persisted via the parent's `targets.show`),
   and each box has an expandable settings drawer.

   Numeric inputs are native (commit on change) rather than the NI component,
   which commits on blur and is unreliable on mobile. Per the WebKit gotcha,
   every number input sets BOTH color and WebkitTextFillColor.
   ─────────────────────────────────────────────────────────────────────── */
import { useState } from "react";
import { Card } from "./ui.jsx";
import { fmt } from "../utils/calc.js";
import {
  monthlyExpenseForItems,
  emergencyTarget,
  houseFundTarget,
  toggleExcluded,
  itemKey,
} from "../utils/savingsTargets.js";

const numInputStyle = {
  width: "100%",
  border: "2px solid var(--input-border, #e0e0e0)",
  borderRadius: 8,
  padding: 8,
  fontSize: 13,
  fontFamily: "'DM Sans',sans-serif",
  background: "var(--input-bg, #fafafa)",
  boxSizing: "border-box",
  color: "var(--tx, #222)",
  WebkitTextFillColor: "var(--tx, #222)",
};

const labelStyle = { fontSize: 11, fontWeight: 700, color: "var(--tx3,#999)" };

function TargetBox({ title, accent, target, children, open, onToggle }) {
  return (
    <div style={{ flex: "1 1 280px", minWidth: 260, border: `2px solid ${accent}`, borderRadius: 12, padding: 14, background: "var(--card-bg, #fff)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase", letterSpacing: 1 }}>{title}</span>
        <button onClick={onToggle} style={{ fontSize: 10, fontWeight: 700, color: accent, background: "none", border: "none", cursor: "pointer", padding: 2 }}>
          {open ? "Hide settings ▴" : "Settings ▾"}
        </button>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: accent, fontFamily: "'Fraunces',serif", margin: "6px 0 2px" }}>{fmt(target)}</div>
      {open && <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--bdr,#eee)" }}>{children}</div>}
    </div>
  );
}

export default function SavingsTargets({ necI = [], disI = [], targets, setSavingsTargets, setTargets }) {
  // The parent passes `setSavingsTargets`; accept `setTargets` too as an alias
  // so either wiring works. Without this, the setter was undefined and every
  // checkbox/field write silently threw — the whole panel was read-only.
  const applyTargets = setSavingsTargets || setTargets;
  const t = targets || {};
  const [openEmg, setOpenEmg] = useState(false);
  const [openHouse, setOpenHouse] = useState(false);

  const excluded = new Set(t.excludedIds || []);
  const months = t.months != null ? t.months : 6;
  const autoMonthly = monthlyExpenseForItems([...necI, ...disI], excluded);
  const useOverride = !!t.overrideMonthly;
  const monthly = useOverride ? Number(t.monthlyValue) || 0 : autoMonthly;
  const emgTarget = emergencyTarget(monthly, months);

  const homeValue = Number(t.homeValue) || 0;
  const maintPct = t.maintPct != null ? t.maintPct : 1.5;
  const houseTarget = houseFundTarget(homeValue, maintPct);

  const set = (patch) => applyTargets(prev => ({ ...(prev || {}), ...patch }));
  const toggleKey = (key) => {
    if (!key) return;
    applyTargets(prev => {
      const p = prev || {};
      return { ...p, excludedIds: toggleExcluded(p.excludedIds, key) };
    });
  };
  // Select all = include everything = clear the exclusion set.
  const selectAll = () => set({ excludedIds: [] });
  // Unselect all = exclude every currently-shown item's key.
  const unselectAll = () => set({ excludedIds: [...necI, ...disI].map(itemKey).filter(Boolean) });

  if (t.show === false) {
    return (
      <div style={{ maxWidth: 1100, margin: "8px auto 0", textAlign: "right" }}>
        <button onClick={() => set({ show: true })} style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", background: "none", border: "2px solid var(--bdr,#ddd)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
          Show Savings Targets ▾
        </button>
      </div>
    );
  }

  return (
    <Card style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800, color: "var(--tx,#333)" }}>Savings Targets</h3>
        <button onClick={() => set({ show: false })} style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#888)", background: "none", border: "none", cursor: "pointer" }}>Hide ▴</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {/* Emergency reserve */}
        <TargetBox title={`Emergency Reserve · ${months} mo`} accent="#4ECDC4" target={emgTarget} open={openEmg} onToggle={() => setOpenEmg(o => !o)}>
          <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginBottom: 8 }}>
            {useOverride ? "Manual monthly figure" : "From selected budget items"} · {fmt(monthly)}/mo
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={labelStyle}>Months of expenses</span>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {[3, 6, 9, 12].map(m => (
                <button key={m} onClick={() => set({ months: m })}
                  style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                    border: months === m ? "2px solid #4ECDC4" : "2px solid var(--bdr,#ddd)",
                    background: months === m ? "#E8F8F5" : "var(--input-bg,#fafafa)",
                    color: months === m ? "#159a8c" : "var(--tx3,#888)" }}>{m} mo</button>
              ))}
              <input type="number" inputMode="numeric" value={months}
                onChange={e => set({ months: e.target.value === "" ? "" : Number(e.target.value) })}
                style={{ ...numInputStyle, width: 70 }} aria-label="Custom months" />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={useOverride} onChange={e => set({ overrideMonthly: e.target.checked })} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tx,#333)" }}>Override monthly amount</span>
          </label>
          {useOverride && (
            <div style={{ marginBottom: 10 }}>
              <span style={labelStyle}>Monthly expenses ($)</span>
              <input type="number" inputMode="decimal" value={t.monthlyValue ?? ""}
                onChange={e => set({ monthlyValue: e.target.value })}
                placeholder="e.g. 4000" style={numInputStyle} />
            </div>
          )}

          {!useOverride && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8, flexWrap: "wrap" }}>
                <span style={labelStyle}>Include items (necessities on by default)</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={selectAll} style={{ fontSize: 10, fontWeight: 700, color: "#4ECDC4", background: "none", border: "2px solid #4ECDC4", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Select all</button>
                  <button onClick={unselectAll} style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)", background: "none", border: "2px solid var(--bdr,#ddd)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Unselect all</button>
                </div>
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--bdr,#eee)", borderRadius: 8, padding: 6 }}>
                {[["Necessities", necI], ["Discretionary", disI]].map(([grp, list]) => (
                  <div key={grp}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tx3,#aaa)", textTransform: "uppercase", letterSpacing: 1, margin: "4px 0 2px" }}>{grp}</div>
                    {list.length === 0 && <div style={{ fontSize: 11, color: "var(--tx3,#bbb)", padding: "2px 0" }}>none</div>}
                    {list.map(it => {
                      const k = itemKey(it);
                      const on = !excluded.has(k);
                      return (
                        <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", cursor: "pointer" }}>
                          <input type="checkbox" checked={on} onChange={() => toggleKey(k)} />
                          <span style={{ flex: 1, fontSize: 12, color: on ? "var(--tx,#333)" : "var(--tx3,#aaa)" }}>{it.n}</span>
                          <span style={{ fontSize: 11, color: "var(--tx3,#999)" }}>{fmt(it.wk * 52 / 12)}/mo</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </TargetBox>

        {/* House fund */}
        <TargetBox title="House Fund" accent="#556FB5" target={houseTarget} open={openHouse} onToggle={() => setOpenHouse(o => !o)}>
          <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginBottom: 10 }}>
            {maintPct}% of {fmt(homeValue)} home value · annual-maintenance rule of thumb is 1–3%
          </div>
          <div style={{ marginBottom: 10 }}>
            <span style={labelStyle}>Home value ($)</span>
            <input type="number" inputMode="decimal" value={t.homeValue ?? ""}
              onChange={e => set({ homeValue: e.target.value })}
              placeholder="e.g. 750000" style={numInputStyle} />
          </div>
          <div>
            <span style={labelStyle}>Maintenance %</span>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {[1, 1.5, 2, 3].map(p => (
                <button key={p} onClick={() => set({ maintPct: p })}
                  style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                    border: maintPct === p ? "2px solid #556FB5" : "2px solid var(--bdr,#ddd)",
                    background: maintPct === p ? "#EEF1FA" : "var(--input-bg,#fafafa)",
                    color: maintPct === p ? "#556FB5" : "var(--tx3,#888)" }}>{p}%</button>
              ))}
              <input type="number" inputMode="decimal" step="0.1" value={maintPct}
                onChange={e => set({ maintPct: e.target.value === "" ? "" : Number(e.target.value) })}
                style={{ ...numInputStyle, width: 70 }} aria-label="Custom maintenance percent" />
            </div>
          </div>
        </TargetBox>
      </div>

      <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--input-bg,#f7f7f7)", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 1 }}>Combined target</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>{fmt(emgTarget + houseTarget)}</span>
      </div>
    </Card>
  );
}

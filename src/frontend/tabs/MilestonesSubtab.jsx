import { Card } from "../components/ui.jsx";
import { fmt } from "../utils/calc.js";

/* MilestonesSubtab — the "list mode" for Budget→Milestones.
   Moved verbatim from ChartsTab.jsx (formerly lines ~225–295) as part of the
   nav restructure. The subtab toggles between this list and the inline
   MilestoneViewTab based on viewingMs (handled by the parent in App.jsx).
   The restore-confirm modal lives in App.jsx so it can be triggered from
   both this list and from inside MilestoneViewTab. */
export default function MilestonesSubtab({ mob, milestones, setMilestones, msHistView, setMsHistView, msHistYear, setMsHistYear, setViewingMs, setRestoreConfirm }) {
  if (milestones.length === 0) {
    return <Card style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 14, color: "#999" }}>No milestones yet. Save your first from the Live tab toolbar to start tracking trends.</div></Card>;
  }
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Milestone History</h3>
        <button onClick={() => setMsHistView(p => p === "years" ? "all" : "years")} style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, border: "2px solid #556FB5", borderRadius: 6, background: msHistView === "all" ? "#EEF1FA" : "transparent", color: "#556FB5", cursor: "pointer" }}>
          {msHistView === "years" ? "Show All" : "Group by Year"}
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, fontSize: 9, fontWeight: 700, color: "#999", marginBottom: 6, minWidth: 850 }}>
          <span>Date</span><span>Label</span><span style={{ textAlign: "right" }}>Net Income</span><span style={{ textAlign: "right" }}>Expenses</span><span style={{ textAlign: "right" }}>Savings</span><span style={{ textAlign: "right" }}>Bonus</span><span style={{ textAlign: "right" }}>Sav. Rate</span><span style={{ textAlign: "right" }}>Remaining</span><span />
        </div>
        {(() => {
          const sorted = [...milestones].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          const years = {};
          sorted.forEach(s => { const yr = (s.date || "").slice(0, 4) || "Unknown"; if (!years[yr]) years[yr] = []; years[yr].push(s); });
          const yearKeys = Object.keys(years).sort((a, b) => b.localeCompare(a));
          const activeYear = msHistYear || yearKeys[0];
          const renderRow = (s) => {
            const ri = milestones.findIndex(x => x.id === s.id);
            const dateStr = s.date || "";
            const dateObj = dateStr ? new Date(dateStr + "T00:00:00") : null;
            const formattedDate = dateObj ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : dateStr;
            return (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "100px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, padding: "6px 0", alignItems: "center", borderTop: "1px solid var(--bdr,#f0f0f0)", fontSize: 11, minWidth: 850 }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tx, #333)" }}>{formattedDate}</span>
                  <input type="date" value={s.date} onChange={e => { const n = [...milestones]; n[ri] = { ...n[ri], date: e.target.value }; setMilestones(n); }} style={{ fontSize: 9, border: "1px solid var(--bdr,#e0e0e0)", borderRadius: 4, padding: "1px 3px", color: "var(--tx3,#888)", background: "transparent", marginTop: 2 }} />
                </div>
                <input value={s.label} onChange={e => { const n = [...milestones]; n[ri] = { ...n[ri], label: e.target.value }; setMilestones(n); }} style={{ fontSize: 11, fontWeight: 600, border: "1px solid var(--bdr,#e0e0e0)", borderRadius: 4, padding: "2px 4px", color: "var(--tx,#333)", background: "transparent" }} />
                <span style={{ textAlign: "right", color: "#4ECDC4" }}>{fmt((s.netW || 0) * 48)}</span>
                <span style={{ textAlign: "right", color: "#E8573A" }}>{fmt((s.expW || 0) * 48)}</span>
                <span style={{ textAlign: "right", color: "#2ECC71" }}>{fmt((s.savW || 0) * 48)}</span>
                <span style={{ textAlign: "right", color: "#9B59B6" }}>{fmt(s.eaipNet || 0)}</span>
                <span style={{ textAlign: "right", color: "#556FB5" }}>{(s.savRate || 0).toFixed(1)}%</span>
                <span style={{ textAlign: "right", color: (s.remW || 0) >= 0 ? "#2ECC71" : "#E74C3C" }}>{fmt((s.remW || 0) * 48)}</span>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button onClick={() => setViewingMs(ri)} style={{ padding: "3px 8px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>View</button>
                  {(s.fullState || s.items) && <button onClick={() => setRestoreConfirm(ri)} style={{ padding: "3px 6px", background: "none", border: "1px solid #F2A93B", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", color: "#F2A93B" }} title={s.fullState ? "Full restore" : "Restores items only"}>↩</button>}
                  <button onClick={() => setMilestones(milestones.filter((_, j) => j !== ri))} style={{ padding: "3px 6px", background: "none", border: "1px solid var(--input-border, #ddd)", borderRadius: 4, fontSize: 10, cursor: "pointer", color: "#ccc" }}>×</button>
                </div>
              </div>
            );
          };
          if (msHistView === "all") return sorted.map(renderRow);
          return yearKeys.map(yr => (
            <div key={yr}>
              <div onClick={() => setMsHistYear(p => p === yr ? null : yr)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer", borderTop: "2px solid var(--bdr2, #d0cdc8)", userSelect: "none" }}>
                <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "var(--tx, #333)" }}>{yr}</span>
                <span style={{ fontSize: 11, color: "var(--tx3, #999)" }}>({years[yr].length} milestone{years[yr].length !== 1 ? "s" : ""})</span>
                <span style={{ fontSize: 12, color: "var(--tx3, #999)", marginLeft: "auto" }}>{activeYear === yr ? "▾" : "▸"}</span>
              </div>
              {activeYear === yr && years[yr].map(renderRow)}
            </div>
          ));
        })()}
      </div>
    </Card>
  );
}

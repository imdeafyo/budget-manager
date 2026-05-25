import { useState } from "react";
import { Card, SH, CSH, NI, Row, ExpRowInner, SavRowInner } from "../components/ui.jsx";
import { evalF, fmt, fp, p2, toWk } from "../utils/calc.js";
import log from "../utils/log.js";
import { apiFetch } from "../utils/apiFetch.js";

export function BudgetToolbar({ mob, dk, waf, C, moC, y4, y5, tSavW, remY52, bannerOpen, setBannerOpen, toolbarOpen, setToolbarOpen, visCols, setVisCols, sortBy, setSortBy, sortDir, setSortDir, hlThresh, setHlThresh, hlPeriod, setHlPeriod, showPerPerson, setShowPerPerson, isMixed, allExpanded, expandAll, collapseAll, toggleAll, setShowAddItem, setShowBulkAdd, cats, setBulkTargets, setBulkName, setBulkVal, setBulkCat, showBulkAdd: _sb, milestones, setMilestones, msDate, setMsDate, msLabel, setMsLabel, ewk, savSorted, st, C_full, tNW, tDW, tExpW, tSavW_full, remW, totalSavPlusRemW, retirementW = 0, totalAllSavingsW, cSal, kSal, cEaip, kEaip, fil, preDed, postDed, c4pre, c4ro, k4pre, k4ro, cIraTrad, cIraRoth, kIraTrad, kIraRoth, exp, sav, savCats, transferCats, incomeCats, tax, NI: _ni }) {
  // Save Milestone modal — moved from ChartsTab. Opens when 📸 button is clicked.
  const [showSaveMs, setShowSaveMs] = useState(false);
  const _Cf = C_full || C;
  const saveMilestone = () => {
    const itemMs = {};
    (ewk || []).forEach(e => { itemMs[e.n] = { v: Math.round(e.wk * 48 * 100) / 100, t: e.t, c: e.c, f: e.f || "" }; });
    (savSorted || []).forEach(s => { itemMs[s.n] = { v: Math.round(s.wk * 48 * 100) / 100, t: "S", f: s.f || "" }; });
    const newId = Date.now();
    const dateUsed = msDate || new Date().toISOString().slice(0, 10);
    const labelUsed = msLabel || "Milestone";
    setMilestones(prev => [...prev, {
      id: newId, date: dateUsed, label: labelUsed,
      grossW: _Cf.cw + _Cf.kw, netW: _Cf.net, necW: tNW, disW: tDW, expW: tExpW, savW: tSavW_full,
      remW, savRate: _Cf.net > 0 ? (totalAllSavingsW / _Cf.net * 100) : 0,
      savRateGross: (_Cf.cw + _Cf.kw) > 0 ? (totalAllSavingsW / (_Cf.cw + _Cf.kw) * 100) : 0,
      cNetW: _Cf.cNet, kNetW: _Cf.kNet, cGrossW: _Cf.cw, kGrossW: _Cf.kw,
      cSalary: evalF(cSal), kSalary: evalF(kSal), fil, p1State: tax.p1State, p2State: tax.p2State,
      eaipNet: _Cf.eaipNet, eaipGross: _Cf.eaipGross, cEaipNet: _Cf.cEaipNet, kEaipNet: _Cf.kEaipNet,
      cEaipPct: evalF(cEaip), kEaipPct: evalF(kEaip),
      items: itemMs,
      fullState: { cSal, kSal, fil, cEaip, kEaip, preDed, postDed, c4pre, c4ro, k4pre, k4ro, cIraTrad, cIraRoth, kIraTrad, kIraRoth, exp, sav, cats, savCats, transferCats, incomeCats, tax },
    }]);
    log.info("milestone.save", { id: newId, date: dateUsed, label: labelUsed, itemCount: Object.keys(itemMs).length });
    setMsLabel(""); setMsDate("");
    // Pair every saved milestone with a backup-history row. Wait out the 600ms
    // auto-save debounce so the backup captures the freshly-saved state.
    setTimeout(() => {
      log.info("milestone.backupTriggered", { id: newId, label: "manual+pre-milestone" });
      apiFetch("/api/history/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "manual+pre-milestone" }),
      }).then(r => {
        if (!r.ok) log.warn("milestone.backupFailed", { id: newId, status: r.status, reqId: r.reqId });
      }).catch(e => log.warn("milestone.backupFailed", { id: newId, message: String(e?.message || e), reqId: e?.reqId }));
    }, 800);
    setShowSaveMs(false);
  };
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "4px 12px 2px", background: dk ? "#1e1e1e" : waf ? "#d0ccc7" : "#ede7e0", borderTop: `1px solid ${dk ? "#333" : waf ? "#c0bbb5" : "#ddd"}` }}>
      <div onClick={() => setBannerOpen(p => !p)} style={{ cursor: "pointer" }}>
        {bannerOpen ? <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(7, 1fr)", gap: 6, textAlign: "center", padding: "8px 0" }}>
          {[["Net / Week", fmt(C.net), "#4ECDC4"], ["Net / Month", fmt(moC(C.net)), "#F2A93B"], ["Net / Year (48)", fmt(y4(C.net)), "#4ECDC4"], ["Net / Year (52)", fmt(y5(C.net)), "#888"], ["Bonus (net)", fmt(C.eaipNet), "#9B59B6"], ["Savings / Year", fmt(y5(tSavW) + remY52), "#2ECC71"], ["All Savings + Bonus", fmt(y5(tSavW) + remY52 + y5(retirementW) + C.eaipNet), "#1ABC9C"]].map(([l, v, c]) => (
            <div key={l}><div style={{ fontSize: 8, fontWeight: 700, color: "var(--tx3,#888)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ fontSize: mob ? 12 : 15, fontWeight: 800, color: c, fontFamily: "'Fraunces',serif" }}>{v}</div></div>
          ))}
          {mob && <div style={{ gridColumn: "1/-1", fontSize: 9, color: "var(--tx3,#999)", textAlign: "center" }}>tap to collapse ▴</div>}
        </div> : <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#4ECDC4", fontFamily: "'Fraunces',serif" }}>Net: {fmt(C.net)}/wk</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#2ECC71", fontFamily: "'Fraunces',serif" }}>Savings: {fmt(y5(tSavW) + remY52)}/yr</span>
          <span style={{ fontSize: 10, color: "var(--tx3,#999)" }}>▾</span>
        </div>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", borderTop: "1px solid var(--bdr, #ddd)" }}>
        <span onClick={() => setToolbarOpen(p => !p)} style={{ fontSize: 10, fontWeight: 700, color: toolbarOpen ? "#556FB5" : "var(--tx3, #999)", textTransform: "uppercase", cursor: "pointer", padding: "4px 10px", border: `2px solid ${toolbarOpen ? "#556FB5" : "var(--bdr, #ccc)"}`, borderRadius: 6, background: toolbarOpen ? "#EEF1FA" : "transparent", userSelect: "none" }}>Tools {toolbarOpen ? "▴" : "▾"}</span>
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--tx3, #999)", marginRight: 2 }}>Cols:</span>
          {[["wk", "Wk"], ["mo", "Mo"], ["y48", "Y48"], ["y52", "Y52"]].map(([k, lbl]) =>
            <button key={k} onClick={() => setVisCols(p => ({ ...p, [k]: !p[k] }))}
              style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, border: visCols[k] ? "2px solid #556FB5" : "2px solid var(--bdr, #ccc)", borderRadius: 6, background: visCols[k] ? "#EEF1FA" : "transparent", color: visCols[k] ? "#556FB5" : "var(--tx3, #aaa)", cursor: "pointer" }}>{lbl}</button>
          )}
        </div>
      </div>
      {toolbarOpen && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 0", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#999)", textTransform: "uppercase" }}>Sort:</span>
          {[["default", "Default"], ["amount", "Amount"], ["category", "Category"]].map(([v, l]) => (
            <button key={v} onClick={() => { if (sortBy === v && v === "amount") setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortBy(v); if (v === "amount") setSortDir("desc"); } }}
              style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: sortBy === v ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: sortBy === v ? "#EEF1FA" : "var(--input-bg, #fafafa)", color: sortBy === v ? "#556FB5" : "var(--tx3, #888)", cursor: "pointer" }}>
              {l}{sortBy === v && v === "amount" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#999)" }}>Highlight &gt;</span>
          <NI value={hlThresh} onChange={v => setHlThresh(v)} prefix="$" style={{ width: 90, height: 30 }} />
          <select value={hlPeriod} onChange={e => setHlPeriod(e.target.value)} style={{ fontSize: 11, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, padding: "4px 6px", background: "var(--input-bg, #fafafa)", cursor: "pointer" }}>
            <option value="w">/wk</option><option value="m">/mo</option><option value="y">/yr</option>
          </select>
        </div>
        <button onClick={() => setShowPerPerson(p => !p)} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: showPerPerson ? "2px solid #4ECDC4" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: showPerPerson ? "#E8F8F5" : "var(--input-bg, #fafafa)", color: showPerPerson ? "#4ECDC4" : "var(--tx3, #888)", cursor: "pointer" }}>
          {showPerPerson ? "Hide" : "Show"} Per-Person
        </button>
        {isMixed ? <>
          <button onClick={expandAll} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, background: "var(--input-bg, #fafafa)", color: "var(--tx3, #888)", cursor: "pointer" }}>
            Expand All
          </button>
          <button onClick={collapseAll} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, background: "var(--input-bg, #fafafa)", color: "var(--tx3, #888)", cursor: "pointer" }}>
            Collapse All
          </button>
        </> : <button onClick={toggleAll} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid var(--bdr, #ddd)", borderRadius: 6, background: "var(--input-bg, #fafafa)", color: "var(--tx3, #888)", cursor: "pointer" }}>
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>}
        <button onClick={() => setShowAddItem(true)} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid #E8573A", borderRadius: 6, background: "#fef5f2", color: "#E8573A", cursor: "pointer" }}>
          + Add Item
        </button>
        <button onClick={() => { setBulkTargets({ current: true }); setBulkName(""); setBulkVal(""); setBulkCat(cats[0]); setShowBulkAdd(true); }} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid #9B59B6", borderRadius: 6, background: "#F3E8FF", color: "#9B59B6", cursor: "pointer" }}>
          + Add to Multiple
        </button>
        <button onClick={() => { setMsDate(new Date().toISOString().slice(0, 10)); setMsLabel("Milestone"); setShowSaveMs(true); }} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid #556FB5", borderRadius: 6, background: "#EEF1FA", color: "#556FB5", cursor: "pointer" }}>
          📸 Save Milestone
        </button>
      </div>}
      {showSaveMs && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowSaveMs(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 24, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800, color: "var(--tx,#333)" }}>Save Milestone</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#999)" }}>Date</label>
                <input type="date" value={msDate || new Date().toISOString().slice(0, 10)} onChange={e => setMsDate(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3,#999)" }}>Label</label>
                <input value={msLabel} onChange={e => setMsLabel(e.target.value)} placeholder="What changed?" style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setShowSaveMs(false)} style={{ padding: "9px 18px", border: "2px solid var(--bdr, #ddd)", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                <button onClick={saveMilestone} style={{ padding: "9px 20px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📸 Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BudgetTab({ mob, C, moC, y4, y5, visCols, p1Name, p2Name, tax, preDed, postDed, showPerPerson, collapsed, toggleSec, necI, disI, savSorted, cats, savCats, updExp, updSav, rmExp, rmSav, tNW, tDW, tExpW, tSavW, remW, remY48, remY52, totalSavPlusRemW, retirementW = 0, totalAllSavingsW, showAddItem, setShowAddItem, niN, setNiN, niC, setNiC, niT, setNiT, niS, setNiS, niP, setNiP, niV, setNiV, exp, setExp, sav, setSav, showBulkAdd, setShowBulkAdd, bulkName, setBulkName, bulkVal, setBulkVal, bulkPer, setBulkPer, bulkType, setBulkType, bulkSec, setBulkSec, bulkCat, setBulkCat, bulkTargets, setBulkTargets, milestones, setMilestones, recalcMilestone }) {
  return (
    <div>

      <Card style={{ overflowX: "auto" }}>
        {/* Column header row used to live here. It's now rendered inside the
            outer sticky header in App.jsx so it stays pinned below the
            title/tabs/tools chrome instead of fighting for the same top:0
            stick position. The grid column widths here must continue to
            match what App.jsx's header strip uses: 1.8fr 1fr 1fr 1fr 1fr. */}

        <SH>Income</SH>
        <Row label={p1Name + " Salary"} wk={C.cw} mo={moC(C.cw)} y48={y4(C.cw)} y52={y5(C.cw)} bold />
        <Row label={p2Name + " Salary"} wk={C.kw} mo={moC(C.kw)} y48={y4(C.kw)} y52={y5(C.kw)} bold />
        <Row label="Combined Gross" wk={C.cw + C.kw} mo={moC(C.cw + C.kw)} y48={y4(C.cw + C.kw)} y52={y5(C.cw + C.kw)} bold border />

        <CSH color="var(--c-pretax, #c0392b)" collapsed={collapsed.preTax} onToggle={() => toggleSec("preTax")}>Pre-Tax Deductions</CSH>
        {!collapsed.preTax && <>{preDed.filter(d => !d.n.toLowerCase().includes("hsa")).map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k), v = cv + kv; return <div key={i}><Row label={d.n} wk={-v} mo={-moC(v)} y48={-y4(v)} y52={-y5(v)} color="var(--c-pretax, #c0392b)" />{showPerPerson && (cv > 0 || kv > 0) && <><Row label={`  ↳ ${p1Name}`} wk={-cv} mo={-moC(cv)} y48={-y4(cv)} y52={-y5(cv)} color="var(--c-pretax, #d98880)" /><Row label={`  ↳ ${p2Name}`} wk={-kv} mo={-moC(kv)} y48={-y4(kv)} y52={-y5(kv)} color="var(--c-pretax, #d98880)" /></>}</div>; })}</>}
        {(() => { const t = preDed.filter(d => !d.n.toLowerCase().includes("hsa")).reduce((s, d) => s + evalF(d.c) + evalF(d.k), 0); return t > 0 ? <Row label="Total Pre-Tax Deductions" wk={-t} mo={-moC(t)} y48={-y4(t)} y52={-y5(t)} bold border color="var(--c-pretax, #c0392b)" /> : null; })()}

        {/* Pre-Tax Savings */}
        <CSH color="var(--c-presav, #1ABC9C)" collapsed={collapsed.preSav} onToggle={() => toggleSec("preSav")}>Pre-Tax Savings (not in take-home)</CSH>
        {!collapsed.preSav && <>{preDed.filter(d => d.n.toLowerCase().includes("hsa")).map((d, i) => { const v = evalF(d.c) + evalF(d.k); return <Row key={"hs" + i} label={"💰 " + d.n + (tax.hsaEmployerMatch > 0 ? ` (+ ${fmt(tax.hsaEmployerMatch)}/yr employer)` : "")} wk={v} mo={moC(v)} y48={y4(v)} y52={y5(v)} color="var(--c-presav, #1ABC9C)" />; })}
        {showPerPerson && preDed.filter(d => d.n.toLowerCase().includes("hsa")).map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k); return (cv > 0 || kv > 0) ? <div key={"hsp" + i}><Row label={`  ↳ ${p1Name} HSA`} wk={cv} mo={moC(cv)} y48={y4(cv)} y52={y5(cv)} color="var(--c-presav, #48C9B0)" /><Row label={`  ↳ ${p2Name} HSA`} wk={kv} mo={moC(kv)} y48={y4(kv)} y52={y5(kv)} color="var(--c-presav, #48C9B0)" /></div> : null; })}
        {C.c4preW + C.k4preW > 0 && <Row label="💰 401(k) Pre-Tax" wk={C.c4preW + C.k4preW} mo={moC(C.c4preW + C.k4preW)} y48={y4(C.c4preW + C.k4preW)} y52={y5(C.c4preW + C.k4preW)} color="var(--c-presav, #1ABC9C)" />}
        {showPerPerson && C.c4preW > 0 && <Row label={`  ↳ ${p1Name} Pre-Tax`} wk={C.c4preW} mo={moC(C.c4preW)} y48={y4(C.c4preW)} y52={y5(C.c4preW)} color="var(--c-presav, #48C9B0)" />}
        {showPerPerson && C.k4preW > 0 && <Row label={`  ↳ ${p2Name} Pre-Tax`} wk={C.k4preW} mo={moC(C.k4preW)} y48={y4(C.k4preW)} y52={y5(C.k4preW)} color="var(--c-presav, #48C9B0)" />}
        {(C.cIraTradW || 0) + (C.kIraTradW || 0) > 0 && <Row label="💰 Traditional IRA" wk={(C.cIraTradW || 0) + (C.kIraTradW || 0)} mo={moC((C.cIraTradW || 0) + (C.kIraTradW || 0))} y48={y4((C.cIraTradW || 0) + (C.kIraTradW || 0))} y52={y5((C.cIraTradW || 0) + (C.kIraTradW || 0))} color="var(--c-presav, #1ABC9C)" />}
        {showPerPerson && (C.cIraTradW || 0) > 0 && <Row label={`  ↳ ${p1Name} Trad IRA`} wk={C.cIraTradW} mo={moC(C.cIraTradW)} y48={y4(C.cIraTradW)} y52={y5(C.cIraTradW)} color="var(--c-presav, #48C9B0)" />}
        {showPerPerson && (C.kIraTradW || 0) > 0 && <Row label={`  ↳ ${p2Name} Trad IRA`} wk={C.kIraTradW} mo={moC(C.kIraTradW)} y48={y4(C.kIraTradW)} y52={y5(C.kIraTradW)} color="var(--c-presav, #48C9B0)" />}</>}
        {(() => { const hsaW = preDed.filter(d => d.n.toLowerCase().includes("hsa")).reduce((s, d) => s + evalF(d.c) + evalF(d.k), 0); const preTax401 = C.c4preW + C.k4preW; const iraTradW = (C.cIraTradW || 0) + (C.kIraTradW || 0); const total = hsaW + preTax401 + iraTradW; return total > 0 ? <Row label="Total Pre-Tax Savings" wk={total} mo={moC(total)} y48={y4(total)} y52={y5(total)} bold border color="var(--c-presav, #1ABC9C)" /> : null; })()}

        <SH>Taxable Pay</SH>
        <Row label="Combined Taxable" wk={C.cTxW + C.kTxW} mo={moC(C.cTxW + C.kTxW)} y48={y4(C.cTxW + C.kTxW)} y52={y5(C.cTxW + C.kTxW)} bold color="var(--c-taxable, #556FB5)" />

        <CSH color="var(--c-fedtax, #1a5276)" collapsed={collapsed.fedTax} onToggle={() => toggleSec("fedTax")}>Federal Taxes</CSH>
        {!collapsed.fedTax && <><Row label="Fed Withholding" sub={fp(C.mr)} wk={-(C.cFed + C.kFed)} mo={-moC(C.cFed + C.kFed)} y48={-y4(C.cFed + C.kFed)} y52={-y5(C.cFed + C.kFed)} color="var(--c-fedtax, #1a5276)" />
        {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cFed} mo={-moC(C.cFed)} y48={-y4(C.cFed)} y52={-y5(C.cFed)} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kFed} mo={-moC(C.kFed)} y48={-y4(C.kFed)} y52={-y5(C.kFed)} color="var(--c-fedtax2, #3a7abf)" /></>}
        <Row label="OASDI (SS)" sub={p2(tax.ssRate)} wk={-(C.cSS + C.kSS)} mo={-moC(C.cSS + C.kSS)} y48={-y4(C.cSS + C.kSS)} y52={-y5(C.cSS + C.kSS)} color="var(--c-fedtax, #1a5276)" />
        {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cSS} mo={-moC(C.cSS)} y48={-y4(C.cSS)} y52={-y5(C.cSS)} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kSS} mo={-moC(C.kSS)} y48={-y4(C.kSS)} y52={-y5(C.kSS)} color="var(--c-fedtax2, #3a7abf)" /></>}
        <Row label="Medicare" sub={p2(tax.medRate)} wk={-(C.cMc + C.kMc)} mo={-moC(C.cMc + C.kMc)} y48={-y4(C.cMc + C.kMc)} y52={-y5(C.cMc + C.kMc)} color="var(--c-fedtax, #1a5276)" />
        {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cMc} mo={-moC(C.cMc)} y48={-y4(C.cMc)} y52={-y5(C.cMc)} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kMc} mo={-moC(C.kMc)} y48={-y4(C.kMc)} y52={-y5(C.kMc)} color="var(--c-fedtax2, #3a7abf)" /></>}</>}

        <CSH color="var(--c-sttax, #8B4513)" collapsed={collapsed.stTax} onToggle={() => toggleSec("stTax")}>State Taxes ({(tax.p1State || {}).abbr || "ST"}{(tax.p2State || {}).abbr && (tax.p2State || {}).abbr !== (tax.p1State || {}).abbr ? `/${(tax.p2State || {}).abbr}` : ""})</CSH>
        {!collapsed.stTax && (() => {
          const sameState = (tax.p1State || {}).abbr === (tax.p2State || {}).abbr;
          const p1a = (tax.p1State || {}).abbr || "ST", p2a = (tax.p2State || {}).abbr || "ST";
          return <>{sameState ? <>
            <Row label={`${p1a} State Tax`} wk={-(C.cCO + C.kCO)} mo={-moC(C.cCO + C.kCO)} y48={-y4(C.cCO + C.kCO)} y52={-y5(C.cCO + C.kCO)} color="var(--c-sttax, #8B4513)" />
            {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cCO} mo={-moC(C.cCO)} y48={-y4(C.cCO)} y52={-y5(C.cCO)} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kCO} mo={-moC(C.kCO)} y48={-y4(C.kCO)} y52={-y5(C.kCO)} color="var(--c-sttax2, #B8860B)" /></>}
            <Row label={`${p1a} State Payroll Tax`} wk={-(C.cFL + C.kFL)} mo={-moC(C.cFL + C.kFL)} y48={-y4(C.cFL + C.kFL)} y52={-y5(C.cFL + C.kFL)} color="var(--c-sttax, #8B4513)" />
            {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.cFL} mo={-moC(C.cFL)} y48={-y4(C.cFL)} y52={-y5(C.cFL)} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={-C.kFL} mo={-moC(C.kFL)} y48={-y4(C.kFL)} y52={-y5(C.kFL)} color="var(--c-sttax2, #B8860B)" /></>}
          </> : <>
            <Row label={`${p1a} State Tax (${p1Name})`} wk={-C.cCO} mo={-moC(C.cCO)} y48={-y4(C.cCO)} y52={-y5(C.cCO)} color="var(--c-sttax, #8B4513)" />
            <Row label={`${p2a} State Tax (${p2Name})`} wk={-C.kCO} mo={-moC(C.kCO)} y48={-y4(C.kCO)} y52={-y5(C.kCO)} color="var(--c-sttax, #8B4513)" />
            <Row label={`${p1a} Payroll Tax (${p1Name})`} wk={-C.cFL} mo={-moC(C.cFL)} y48={-y4(C.cFL)} y52={-y5(C.cFL)} color="var(--c-sttax, #8B4513)" />
            <Row label={`${p2a} Payroll Tax (${p2Name})`} wk={-C.kFL} mo={-moC(C.kFL)} y48={-y4(C.kFL)} y52={-y5(C.kFL)} color="var(--c-sttax, #8B4513)" />
          </>}</>;
        })()}

        {(() => { const t = C.cTx + C.kTx; return <Row label="Total Taxes" wk={-t} mo={-moC(t)} y48={-y4(t)} y52={-y5(t)} bold border color="var(--c-totaltax, #E8573A)" />; })()}
        {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name} total tax: {fmt(C.cTx)}/wk ({fmt(C.cTx * 52)}/yr) • {p2Name} total tax: {fmt(C.kTx)}/wk ({fmt(C.kTx * 52)}/yr)</div>}

        {(C.cPostDedW + C.kPostDedW > 0) && <><CSH color="var(--c-posttax, #9B59B6)" collapsed={collapsed.postTax} onToggle={() => toggleSec("postTax")}>Post-Tax Deductions</CSH>
          {!collapsed.postTax && <>{postDed.map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k), v = cv + kv; return v > 0 ? <div key={i}><Row label={d.n} wk={-v} mo={-moC(v)} y48={-y4(v)} y52={-y5(v)} color="var(--c-posttax, #9B59B6)" />{showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-cv} mo={-moC(cv)} y48={-y4(cv)} y52={-y5(cv)} color="var(--c-posttax2, #C39BD3)" /><Row label={`  ↳ ${p2Name}`} wk={-kv} mo={-moC(kv)} y48={-y4(kv)} y52={-y5(kv)} color="var(--c-posttax2, #C39BD3)" /></>}</div> : null; })}</>}
          <Row label="Total Post-Tax Deductions" wk={-(C.cPostDedW + C.kPostDedW)} mo={-moC(C.cPostDedW + C.kPostDedW)} y48={-y4(C.cPostDedW + C.kPostDedW)} y52={-y5(C.cPostDedW + C.kPostDedW)} bold border color="var(--c-posttax, #9B59B6)" />
        </>}

        {/* Post-Tax Savings — Roth 401(k) + Roth IRA. Visually green/teal to match
            Pre-Tax Savings ("savings amount" = green is the convention), not purple
            (which belongs to Post-Tax *Deductions* — actual costs like life insurance).
            Values still display negative so they read "comes out of paycheck", which
            matches the structural placement next to Post-Tax Deductions. */}
        {(C.cPostSavW + C.kPostSavW > 0) && <><CSH color="var(--c-presav, #1ABC9C)" collapsed={collapsed.postSav} onToggle={() => toggleSec("postSav")}>Post-Tax Savings</CSH>
          {!collapsed.postSav && <>{C.c4roW + C.k4roW > 0 && <><Row label="💰 Roth 401(k)" wk={-(C.c4roW + C.k4roW)} mo={-moC(C.c4roW + C.k4roW)} y48={-y4(C.c4roW + C.k4roW)} y52={-y5(C.c4roW + C.k4roW)} color="var(--c-presav, #1ABC9C)" />{showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={-C.c4roW} mo={-moC(C.c4roW)} y48={-y4(C.c4roW)} y52={-y5(C.c4roW)} color="var(--c-presav, #48C9B0)" /><Row label={`  ↳ ${p2Name}`} wk={-C.k4roW} mo={-moC(C.k4roW)} y48={-y4(C.k4roW)} y52={-y5(C.k4roW)} color="var(--c-presav, #48C9B0)" /></>}</>}
          {(C.cIraRothW || 0) + (C.kIraRothW || 0) > 0 && <Row label="💰 Roth IRA" wk={-((C.cIraRothW || 0) + (C.kIraRothW || 0))} mo={-moC((C.cIraRothW || 0) + (C.kIraRothW || 0))} y48={-y4((C.cIraRothW || 0) + (C.kIraRothW || 0))} y52={-y5((C.cIraRothW || 0) + (C.kIraRothW || 0))} color="var(--c-presav, #1ABC9C)" />}
          {showPerPerson && (C.cIraRothW || 0) > 0 && <Row label={`  ↳ ${p1Name} Roth IRA`} wk={-C.cIraRothW} mo={-moC(C.cIraRothW)} y48={-y4(C.cIraRothW)} y52={-y5(C.cIraRothW)} color="var(--c-presav, #48C9B0)" />}
          {showPerPerson && (C.kIraRothW || 0) > 0 && <Row label={`  ↳ ${p2Name} Roth IRA`} wk={-C.kIraRothW} mo={-moC(C.kIraRothW)} y48={-y4(C.kIraRothW)} y52={-y5(C.kIraRothW)} color="var(--c-presav, #48C9B0)" />}</>}
          <Row label="Total Post-Tax Savings" wk={-(C.cPostSavW + C.kPostSavW)} mo={-moC(C.cPostSavW + C.kPostSavW)} y48={-y4(C.cPostSavW + C.kPostSavW)} y52={-y5(C.cPostSavW + C.kPostSavW)} bold border color="var(--c-presav, #1ABC9C)" />
        </>}

        <div style={{ marginTop: 8, padding: "10px 0", borderTop: "3px solid #1a1a1a", borderBottom: "3px solid #1a1a1a" }}>
          <Row label="✦ Combined Net Paycheck" wk={C.net} mo={moC(C.net)} y48={y4(C.net)} y52={y5(C.net)} bold />
          {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name}: {fmt(C.cNet)}/wk ({fmt(C.cNet * 52)}/yr) • {p2Name}: {fmt(C.kNet)}/wk ({fmt(C.kNet * 52)}/yr)</div>}
        </div>

        <CSH color="var(--c-taxable, #556FB5)" collapsed={collapsed.nec} onToggle={() => toggleSec("nec")}>Necessity Expenses</CSH>
        {!collapsed.nec && necI.map(item => <ExpRowInner key={item.n + "_" + item.idx} item={item} cats={cats} onUpdate={u => updExp(item.idx, u)} onRemove={() => rmExp(item.idx)} />)}
        <Row label="Subtotal — Necessity" wk={-tNW} mo={-moC(tNW)} y48={-y4(tNW)} y52={-y4(tNW)} bold border color="var(--c-taxable, #556FB5)" />

        <CSH color="var(--c-totaltax, #E8573A)" collapsed={collapsed.dis} onToggle={() => toggleSec("dis")}>Discretionary Expenses</CSH>
        {!collapsed.dis && disI.map(item => <ExpRowInner key={item.n + "_" + item.idx} item={item} cats={cats} onUpdate={u => updExp(item.idx, u)} onRemove={() => rmExp(item.idx)} />)}
        <Row label="Subtotal — Discretionary" wk={-tDW} mo={-moC(tDW)} y48={-y4(tDW)} y52={-y4(tDW)} bold border color="var(--c-totaltax, #E8573A)" />
        <Row label="Total All Expenses" wk={-tExpW} mo={-moC(tExpW)} y48={-y4(tExpW)} y52={-y4(tExpW)} bold border />

        <CSH color="#2ECC71" collapsed={collapsed.sav} onToggle={() => toggleSec("sav")}>Savings Goals</CSH>
        {!collapsed.sav && savSorted.map(item => <SavRowInner key={item.n + "_" + item.idx} item={item} savCats={savCats} onUpdate={u => updSav(item.idx, u)} onRemove={() => rmSav(item.idx)} />)}
        <Row label="Total Savings" wk={-tSavW} mo={-moC(tSavW)} y48={-y4(tSavW)} y52={-y5(tSavW)} bold border color="#2ECC71" />

        <div style={{ marginTop: 8, padding: "10px 8px", background: remW >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
          <Row label="Remaining to Budget" wk={remW} mo={moC(remW)} y48={remY48} y52={remY52} bold signed />
        </div>
        {/* Total Savings + Remaining — the budget tab's view of "savings I'm
            committing to from my paycheck-after-retirement." When overspent
            (remW < 0), some of the `sav` lines can't actually be funded — the
            row reflects that by going below tSavW and tinting red. Previously
            this was floored at Math.max(0, remW) which hid the overspend. */}
        <div style={{ marginTop: 4, padding: "6px 8px", background: totalSavPlusRemW >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
          <Row label="Total Savings + Remaining" wk={totalSavPlusRemW} mo={moC(totalSavPlusRemW)} y48={y4(totalSavPlusRemW)} y52={y5(tSavW) + remY52} bold signed />
        </div>
        {/* Total Annual Savings — adds retirement contributions (401(k) pre+Roth,
            IRA Trad+Roth, both partners) that were already subtracted from C.net
            and therefore don't appear in the rows above. This is the "what am I
            actually saving per year" answer. Only shown when retirement > 0,
            otherwise it'd duplicate the row above. */}
        {retirementW > 0 && <div style={{ marginTop: 4, padding: "6px 8px", background: totalAllSavingsW >= 0 ? "#e8f6ed" : "#fef0ed", borderRadius: 8 }}>
          <Row label="Total Annual Savings (incl. Retirement)" wk={totalAllSavingsW} mo={moC(totalAllSavingsW)} y48={y4(totalAllSavingsW)} y52={y5(tSavW) + remY52 + y5(retirementW)} bold signed />
          <div style={{ padding: "2px 0 0", fontSize: 10, color: "var(--tx3,#888)", textAlign: "right" }}>incl. 401(k) + IRA: {fmt(y5(retirementW))}/yr</div>
        </div>}

        {/* Bonus Section */}
        {C.eaipGross > 0 && <>
          <CSH color="var(--c-posttax, #9B59B6)" collapsed={collapsed.eaip} onToggle={() => toggleSec("eaip")}>Bonus — Annual</CSH>
          {!collapsed.eaip && <>
          <Row label={p1Name + " Bonus Gross"} wk={0} mo={0} y48={C.cEaipGross} y52={C.cEaipGross} color="var(--c-posttax, #9B59B6)" />
          <Row label={p2Name + " Bonus Gross"} wk={0} mo={0} y48={C.kEaipGross} y52={C.kEaipGross} color="var(--c-posttax, #9B59B6)" />
          <Row label="Combined Bonus Gross" wk={0} mo={0} y48={C.eaipGross} y52={C.eaipGross} bold border color="var(--c-posttax, #9B59B6)" />

          <CSH color="var(--c-fedtax, #1a5276)" collapsed={collapsed.eaipTax} onToggle={() => toggleSec("eaipTax")}>Bonus Taxes</CSH>
          {!collapsed.eaipTax && <>
          <Row label="Fed Withholding" sub={fp(C.mr)} wk={0} mo={0} y48={-(C.cEaipFed + C.kEaipFed)} y52={-(C.cEaipFed + C.kEaipFed)} color="var(--c-fedtax, #1a5276)" />
          {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipFed} y52={-C.cEaipFed} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipFed} y52={-C.kEaipFed} color="var(--c-fedtax2, #3a7abf)" /></>}
          <Row label="OASDI (SS)" wk={0} mo={0} y48={-(C.cEaipSS + C.kEaipSS)} y52={-(C.cEaipSS + C.kEaipSS)} color="var(--c-fedtax, #1a5276)" />
          {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipSS} y52={-C.cEaipSS} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipSS} y52={-C.kEaipSS} color="var(--c-fedtax2, #3a7abf)" /></>}
          <Row label="Medicare" wk={0} mo={0} y48={-(C.cEaipMc + C.kEaipMc)} y52={-(C.cEaipMc + C.kEaipMc)} color="var(--c-fedtax, #1a5276)" />
          {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipMc} y52={-C.cEaipMc} color="var(--c-fedtax2, #3a7abf)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipMc} y52={-C.kEaipMc} color="var(--c-fedtax2, #3a7abf)" /></>}
          {(() => { const sameState = (tax.p1State || {}).abbr === (tax.p2State || {}).abbr; const p1a = (tax.p1State || {}).abbr || "ST", p2a = (tax.p2State || {}).abbr || "ST"; return sameState ? <>
            <Row label={`${p1a} State Tax`} wk={0} mo={0} y48={-(C.cEaipSt + C.kEaipSt)} y52={-(C.cEaipSt + C.kEaipSt)} color="var(--c-sttax, #8B4513)" />
            {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipSt} y52={-C.cEaipSt} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipSt} y52={-C.kEaipSt} color="var(--c-sttax2, #B8860B)" /></>}
            <Row label={`${p1a} State Payroll Tax`} wk={0} mo={0} y48={-(C.cEaipFL + C.kEaipFL)} y52={-(C.cEaipFL + C.kEaipFL)} color="var(--c-sttax, #8B4513)" />
            {showPerPerson && <><Row label={`  ↳ ${p1Name}`} wk={0} mo={0} y48={-C.cEaipFL} y52={-C.cEaipFL} color="var(--c-sttax2, #B8860B)" /><Row label={`  ↳ ${p2Name}`} wk={0} mo={0} y48={-C.kEaipFL} y52={-C.kEaipFL} color="var(--c-sttax2, #B8860B)" /></>}
          </> : <>
            <Row label={`${p1a} State Tax (${p1Name})`} wk={0} mo={0} y48={-C.cEaipSt} y52={-C.cEaipSt} color="var(--c-sttax, #8B4513)" />
            <Row label={`${p2a} State Tax (${p2Name})`} wk={0} mo={0} y48={-C.kEaipSt} y52={-C.kEaipSt} color="var(--c-sttax, #8B4513)" />
            <Row label={`${p1a} Payroll Tax (${p1Name})`} wk={0} mo={0} y48={-C.cEaipFL} y52={-C.cEaipFL} color="var(--c-sttax, #8B4513)" />
            <Row label={`${p2a} Payroll Tax (${p2Name})`} wk={0} mo={0} y48={-C.kEaipFL} y52={-C.kEaipFL} color="var(--c-sttax, #8B4513)" />
          </>; })()}
          </>}
          <Row label="Total Bonus Taxes" wk={0} mo={0} y48={-(C.cEaipTax + C.kEaipTax)} y52={-(C.cEaipTax + C.kEaipTax)} bold border color="var(--c-totaltax, #E8573A)" />
          {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name} tax: {fmt(C.cEaipTax)} • {p2Name} tax: {fmt(C.kEaipTax)}</div>}
          </>}

          <div style={{ marginTop: 4, padding: "8px", background: "#F3E8FF", borderRadius: 8 }}>
            <Row label="Bonus Net (take-home)" wk={0} mo={0} y48={C.eaipNet} y52={C.eaipNet} bold color="var(--c-posttax, #9B59B6)" />
            {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name}: {fmt(C.cEaipNet)} • {p2Name}: {fmt(C.kEaipNet)}</div>}
          </div>
          {/* Grand-total row when bonus exists. Builds on Total Annual Savings
              and layers Bonus net on top. y52 column is built fresh (not from
              totalAllSavingsW) because the y52 view treats expenses as fixed-
              cost 48× while income/savings/retirement scale 52×. */}
          <div style={{ marginTop: 4, padding: "8px", background: (totalAllSavingsW + C.eaipNet) >= 0 ? "#e8f6ed" : "#fef0ed", borderRadius: 8 }}>
            <Row label="Total Annual Savings + Bonus" wk={totalAllSavingsW} mo={moC(totalAllSavingsW)} y48={y4(totalAllSavingsW) + C.eaipNet} y52={y5(tSavW) + remY52 + y5(retirementW) + C.eaipNet} bold color={(totalAllSavingsW + C.eaipNet) >= 0 ? "#2ECC71" : "#E74C3C"} />
            <div style={{ padding: "2px 0 0", fontSize: 10, color: "var(--tx3,#888)", textAlign: "right" }}>budget sav + leftover + 401(k) + IRA + bonus net</div>
          </div>
        </>}

      </Card>

      {/* Add item popup */}
      {showAddItem && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowAddItem(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 28, maxWidth: 500, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Add Budget Item</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Name</label>
                <input value={niN} onChange={e => setNiN(e.target.value)} placeholder="Item name..." style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", boxSizing: "border-box" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Section</label>
                  <select value={niS} onChange={e => setNiS(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}><option value="exp">Expense</option><option value="sav">Savings</option></select></div>
                {niS === "exp" ? <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Type</label>
                  <select value={niT} onChange={e => setNiT(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}><option value="N">Necessity</option><option value="D">Discretionary</option></select></div> : <div />}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Category</label>
                  <select value={niC} onChange={e => setNiC(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}>{(niS === "sav" ? savCats : cats).map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Period</label>
                  <select value={niP} onChange={e => setNiP(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}><option value="w">Weekly</option><option value="m">Monthly</option><option value="y">Yearly</option></select></div>
              </div>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Amount</label>
                <NI value={niV} onChange={setNiV} prefix="$" /></div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setShowAddItem(false)} style={{ padding: "9px 18px", border: "2px solid var(--bdr, #ddd)", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                <button onClick={() => { if (!niN.trim()) return; if (niS === "exp") setExp([...exp, { n: niN.trim(), c: niC || cats[0], t: niT, v: niV || "0", p: niP }]); else setSav([...sav, { n: niN.trim(), c: niC || savCats[0], v: niV || "0", p: niP }]); setNiN(""); setNiV(""); setShowAddItem(false); }}
                  style={{ padding: "9px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk add to multiple milestones + current */}
      {showBulkAdd && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowBulkAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 28, maxWidth: 560, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", maxHeight: "85vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Add Item to Multiple Budgets</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Name</label>
                <input value={bulkName} onChange={e => setBulkName(e.target.value)} placeholder="Item name..." style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", boxSizing: "border-box" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Section</label>
                  <select value={bulkSec} onChange={e => setBulkSec(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}><option value="exp">Expense</option><option value="sav">Savings</option></select></div>
                {bulkSec === "exp" ? <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Type</label>
                  <select value={bulkType} onChange={e => setBulkType(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}><option value="N">Necessity</option><option value="D">Discretionary</option></select></div> : <div />}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Category</label>
                  <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}>{(bulkSec === "sav" ? savCats : cats).map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Period</label>
                  <select value={bulkPer} onChange={e => setBulkPer(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}><option value="w">Weekly</option><option value="m">Monthly</option><option value="y">Yearly</option></select></div>
              </div>
              <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Amount</label>
                <NI value={bulkVal} onChange={setBulkVal} prefix="$" /></div>
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#999", display: "block", marginBottom: 8 }}>Apply to:</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--bdr, #eee)" }}>
                  <input type="checkbox" checked={!!bulkTargets.current} onChange={e => setBulkTargets(p => ({ ...p, current: e.target.checked }))} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Current Budget</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 6 }}>
                  <button onClick={() => { const t = { current: !!bulkTargets.current }; milestones.forEach(s => { t[s.id] = true; }); setBulkTargets(t); }} style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: "1px solid #556FB5", borderRadius: 4, background: "#EEF1FA", color: "#556FB5", cursor: "pointer" }}>Select All Milestones</button>
                  <button onClick={() => { setBulkTargets({ current: !!bulkTargets.current }); }} style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: "1px solid var(--bdr, #ddd)", borderRadius: 4, background: "transparent", color: "var(--tx3, #888)", cursor: "pointer" }}>Deselect All</button>
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {[...milestones].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(s => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--bdr, #f0f0f0)" }}>
                      <input type="checkbox" checked={!!bulkTargets[s.id]} onChange={e => setBulkTargets(p => ({ ...p, [s.id]: e.target.checked }))} />
                      <span style={{ fontSize: 11, color: "var(--tx3, #888)", minWidth: 70 }}>{s.date}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tx, #333)" }}>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setShowBulkAdd(false)} style={{ padding: "9px 18px", border: "2px solid var(--bdr, #ddd)", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                <button onClick={() => {
                  if (!bulkName.trim()) return;
                  const name = bulkName.trim();
                  const val = bulkVal || "0";
                  const numVal = evalF(val);
                  let yearly = numVal;
                  if (bulkPer === "w") yearly = numVal * 48;
                  else if (bulkPer === "m") yearly = numVal * 12;
                  yearly = Math.round(yearly * 100) / 100;
                  if (bulkTargets.current) {
                    if (bulkSec === "exp") setExp(prev => [...prev, { n: name, c: bulkCat || cats[0], t: bulkType, v: val, p: bulkPer }]);
                    else setSav(prev => [...prev, { n: name, c: bulkCat || savCats[0], v: val, p: bulkPer }]);
                  }
                  const selectedIds = Object.entries(bulkTargets).filter(([k, v]) => k !== "current" && v).map(([k]) => +k || k);
                  if (selectedIds.length > 0) {
                    setMilestones(prev => prev.map(s => {
                      if (!selectedIds.includes(s.id)) return s;
                      const it = { ...(s.items || {}), [name]: { v: yearly, t: bulkSec === "exp" ? bulkType : "S", c: bulkCat || "" } };
                      return recalcMilestone({ ...s, items: it });
                    }));
                  }
                  setShowBulkAdd(false);
                  setBulkName(""); setBulkVal("");
                }} style={{ padding: "9px 18px", background: "#9B59B6", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ Add to {Object.values(bulkTargets).filter(Boolean).length} budget{Object.values(bulkTargets).filter(Boolean).length !== 1 ? "s" : ""}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

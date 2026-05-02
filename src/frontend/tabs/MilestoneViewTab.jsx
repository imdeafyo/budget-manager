import { useState } from "react";
import { Card, SH, NI, EditTxt, VisColsCtx, Row } from "../components/ui.jsx";
import { evalF, calcFed, calcStateTax, getMarg, fmt, fp, p2 } from "../utils/calc.js";
import { TAX_DB, STATE_ABBR, STATE_PAYROLL, DEF_PRE, DEF_POST } from "../data/taxDB.js";

export default function MilestoneViewTab({ mob, viewingMs, setViewingMs, milestones, setMilestones, recalcMilestone, msVisCols, setMsVisCols, p1Name, p2Name, tax, allTaxDB, fil, cats, savCats, setRestoreConfirm }) {
  const m = milestones[viewingMs];
          const items = m.items || {};
          const necItems = Object.entries(items).filter(([, d]) => d.t === "N").sort((a, b) => a[0].localeCompare(b[0]));
          const disItems = Object.entries(items).filter(([, d]) => d.t === "D").sort((a, b) => a[0].localeCompare(b[0]));
          const savItems = Object.entries(items).filter(([, d]) => d.t === "S").sort((a, b) => a[0].localeCompare(b[0]));
          const necT = necItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const disT = disItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const savT = savItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const expT = necT + disT;

          // Salary-based tax calc for milestone — includes deductions from fullState
          const mCS = m.cSalary !== undefined ? m.cSalary : (m.cGrossW || 0) * 52;
          const mKS = m.kSalary !== undefined ? m.kSalary : (m.kGrossW || 0) * 52;
          const mYr = m.date ? m.date.slice(0, 4) : tax.year;
          const mTaxData = allTaxDB[mYr] || allTaxDB[tax.year] || TAX_DB["2026"];
          const mFil = m.fil || fil;
          const mP1s = m.p1State || (tax.p1State || {});
          const mP2s = m.p2State || (tax.p2State || {});
          const scw = mCS / 52, skw = mKS / 52;
          // Deductions from fullState
          const sFS = m.fullState || {};
          const sPreDed = sFS.preDed || [];
          const sPostDed = sFS.postDed || [];
          const scPreW = sPreDed.reduce((s, d) => s + evalF(d.c), 0);
          const skPreW = sPreDed.reduce((s, d) => s + evalF(d.k), 0);
          const sc4preW = mCS * Math.min(evalF(sFS.c4pre || 0) / 100, 1) / 52;
          const sc4roW = mCS * Math.min(evalF(sFS.c4ro || 0) / 100, 1) / 52;
          const sk4preW = mKS * Math.min(evalF(sFS.k4pre || 0) / 100, 1) / 52;
          const sk4roW = mKS * Math.min(evalF(sFS.k4ro || 0) / 100, 1) / 52;
          const scTxW = scw - scPreW - sc4preW, skTxW = skw - skPreW - sk4preW;
          const sBr = mFil === "mfj" ? mTaxData.fedMFJ : mTaxData.fedSingle;
          const sSd = mFil === "mfj" ? mTaxData.stdMFJ : mTaxData.stdSingle;
          const sCombTxA = (scTxW + skTxW) * 52;
          const sFedTax = mFil === "mfj" ? calcFed(Math.max(0, sCombTxA - sSd), sBr) : calcFed(Math.max(0, scTxW * 52 - mTaxData.stdSingle), mTaxData.fedSingle) + calcFed(Math.max(0, skTxW * 52 - mTaxData.stdSingle), mTaxData.fedSingle);
          const sSsR = mTaxData.ssRate / 100, sMedR = mTaxData.medRate / 100;
          const sTot = scTxW + skTxW, sCr = sTot > 0 ? scTxW / sTot : 0.5;
          const scFed = (sFedTax / 52) * sCr, skFed = (sFedTax / 52) * (1 - sCr);
          const scSS = Math.min(scw, mTaxData.ssCap / 52) * sSsR, skSS = Math.min(skw, mTaxData.ssCap / 52) * sSsR;
          const scMc = scw * sMedR, skMc = skw * sMedR;
          const scSt = calcStateTax(scTxW * 52, mP1s.abbr || "", mFil) / 52;
          const skSt = calcStateTax(skTxW * 52, mP2s.abbr || "", mFil) / 52;
          const scFL = scw * (mP1s.famli || 0) / 100, skFL = skw * (mP2s.famli || 0) / 100;
          const scPostW = sPostDed.reduce((s, d) => s + evalF(d.c), 0);
          const skPostW = sPostDed.reduce((s, d) => s + evalF(d.k), 0);
          const scNet = scw - scPreW - sc4preW - sc4roW - scFed - scSS - scMc - scSt - scFL - scPostW;
          const skNet = skw - skPreW - sk4preW - sk4roW - skFed - skSS - skMc - skSt - skFL - skPostW;
          const mNetW = scNet + skNet;
          const netY = mNetW * 48;
          const netY52 = mNetW * 52;
          // Match the live BudgetTab math: expenses are fixed dollar amounts
          // (rent doesn't increase if you got more paychecks), savings is a
          // weekly rate so it scales 48→52, income scales 48→52. Remaining
          // therefore differs between y48 and y52 — Y52 captures the extra
          // 4 paychecks worth of income that aren't already allocated.
          const savW = savT / 48;
          const remY = netY - expT - savT;
          const remY52 = netY52 - expT - savW * 52;
          const cNetY = scNet * 48, kNetY = skNet * 48;

          const upMs = (field, val) => { const n = [...milestones]; n[viewingMs] = recalcMilestone({ ...n[viewingMs], [field]: val }); setMilestones(n); };
          const renameMsItem = (oldName, newName) => { if (oldName === newName || !newName.trim()) return; const n = [...milestones]; const it = { ...(n[viewingMs].items || {}) }; it[newName.trim()] = it[oldName]; delete it[oldName]; n[viewingMs] = recalcMilestone({ ...n[viewingMs], items: it }); setMilestones(n); };
          const upMsItem = (name, field, val) => { const n = [...milestones]; const it = { ...(n[viewingMs].items || {}) }; it[name] = { ...it[name], [field]: val }; n[viewingMs] = recalcMilestone({ ...n[viewingMs], items: it }); setMilestones(n); };
          const upMsVal = (name, rawVal, period) => {
            let yearly = +rawVal || 0;
            if (period === "w") yearly = yearly * 48;
            else if (period === "m") yearly = yearly * 12;
            upMsItem(name, "v", Math.round(yearly * 100) / 100);
          };
          const rmMsItem = (name) => { const n = [...milestones]; const it = { ...(n[viewingMs].items || {}) }; delete it[name]; n[viewingMs] = recalcMilestone({ ...n[viewingMs], items: it }); setMilestones(n); };
          const addMsItem = (type) => {
            const newName = type === "S" ? "New Savings Item" : "New Expense Item";
            let finalName = newName;
            const existing = m.items || {};
            let counter = 1;
            while (existing[finalName]) { finalName = `${newName} ${counter++}`; }
            const n = [...milestones];
            const it = { ...(n[viewingMs].items || {}), [finalName]: { v: 0, t: type, c: "" } };
            n[viewingMs] = recalcMilestone({ ...n[viewingMs], items: it });
            setMilestones(n);
          };
          const MsItemRow = ({ name, data }) => {
            const yr = data.v || 0, wk = yr / 48, mo = yr / 12;
            const [editPer, setEditPer] = useState(null);
            const allCats = [...cats, ...savCats.filter(sc => !cats.includes(sc))];
            const valFor = p => p === "w" ? wk : p === "m" ? mo : yr;
            const saveEditVal = (v, per) => {
              let yearly = evalF(v);
              if (per === "w") yearly = yearly * 48;
              else if (per === "m") yearly = yearly * 12;
              upMsItem(name, "v", Math.round(yearly * 100) / 100);
              setEditPer(null);
            };
            const svc = msVisCols;
            const msItemCols = ["50px", "1.6fr", "90px", svc.wk && "1fr", svc.mo && "1fr", svc.y48 && "1fr", svc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
            const periods = [svc.wk && "w", svc.mo && "m", svc.y48 && "y"].filter(Boolean);
            return (
              <div style={{ display: "grid", gridTemplateColumns: msItemCols, gap: 4, padding: "3px 0", alignItems: "center", fontSize: 12 }}>
                <select value={data.t || "N"} onChange={e => upMsItem(name, "t", e.target.value)} style={{ fontSize: 9, color: "#fff", fontWeight: 700, border: "none", borderRadius: 5, padding: "3px 4px", background: data.t === "N" ? "#556FB5" : data.t === "D" ? "#E8573A" : "#2ECC71", cursor: "pointer" }}>
                  <option value="N">NEC</option><option value="D">DIS</option><option value="S">SAV</option>
                </select>
                <EditTxt value={name} onChange={v => renameMsItem(name, v)} />
                <select value={data.c || ""} onChange={e => upMsItem(name, "c", e.target.value)} style={{ fontSize: 10, border: "1px solid var(--input-border, #ddd)", borderRadius: 4, padding: "2px 3px" }}>
                  <option value="">—</option>
                  {allCats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {periods.map(per => {
                  if (editPer === per) {
                    return <div key={per}><NI value={String(Math.round(valFor(per) * 100) / 100)} onChange={(v) => saveEditVal(v, per)} autoFocus onBlurResolve prefix="$" style={{ height: 28 }} /></div>;
                  }
                  return <div key={per} onClick={() => setEditPer(per)} style={{ textAlign: "right", color: "var(--tx2,#555)", cursor: "text", padding: "4px 2px", borderRadius: 4, fontSize: 11 }}>{fmt(valFor(per))}</div>;
                })}
                {svc.y52 && <div style={{ textAlign: "right", color: "var(--tx3,#888)", fontSize: 11 }}>{fmt(yr)}</div>}
                <button onClick={() => rmMsItem(name)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--tx3,#ccc)", padding: 0 }}>×</button>
              </div>
            );
          };
          // Build sorted milestone indices for paging
          const sortedMsIdx = milestones.map((s, i) => ({ i, date: s.date || "" })).sort((a, b) => a.date.localeCompare(b.date));
          const curPosInSorted = sortedMsIdx.findIndex(x => x.i === viewingMs);
          const prevMsIdx = curPosInSorted > 0 ? sortedMsIdx[curPosInSorted - 1].i : null;
          const nextMsIdx = curPosInSorted < sortedMsIdx.length - 1 ? sortedMsIdx[curPosInSorted + 1].i : null;
          return (
            <div>
              <div style={{ background: "#556FB5", color: "#fff", padding: "12px 20px", borderRadius: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, fontFamily: "'Fraunces',serif", flexShrink: 0 }}>Milestone:</span>
                  <input type="date" value={m.date || ""} onChange={e => upMs("date", e.target.value)} style={{ border: "none", borderBottom: "2px solid rgba(255,255,255,0.4)", background: "transparent", color: "#fff", fontSize: 13, fontFamily: "'DM Sans',sans-serif", padding: "2px 4px", outline: "none" }} />
                  <input value={m.label || ""} onChange={e => upMs("label", e.target.value)} style={{ border: "none", borderBottom: "2px solid rgba(255,255,255,0.4)", background: "transparent", color: "#fff", fontSize: 13, fontFamily: "'DM Sans',sans-serif", padding: "2px 4px", outline: "none", flex: 1, minWidth: 120 }} />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button disabled={prevMsIdx === null} onClick={() => prevMsIdx !== null && setViewingMs(prevMsIdx)} style={{ padding: "6px 10px", background: prevMsIdx !== null ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)", color: prevMsIdx !== null ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: prevMsIdx !== null ? "pointer" : "default" }}>◀</button>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", minWidth: 40, textAlign: "center" }}>{curPosInSorted + 1}/{sortedMsIdx.length}</span>
                  <button disabled={nextMsIdx === null} onClick={() => nextMsIdx !== null && setViewingMs(nextMsIdx)} style={{ padding: "6px 10px", background: nextMsIdx !== null ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)", color: nextMsIdx !== null ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: nextMsIdx !== null ? "pointer" : "default" }}>▶</button>
                  <button onClick={() => setRestoreConfirm && setRestoreConfirm(viewingMs)} style={{ padding: "6px 14px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Restore This</button>
                  <button onClick={() => { const clone = JSON.parse(JSON.stringify(m)); clone.id = Date.now(); clone.label = (clone.label || "Milestone") + " (copy)"; setMilestones(prev => { const n = [...prev, clone].sort((a, b) => (a.date || "").localeCompare(b.date || "")); const newIdx = n.findIndex(s => s.id === clone.id); setViewingMs(newIdx); return n; }); }} style={{ padding: "6px 14px", background: "rgba(255,255,255,0.2)", color: "#4ECDC4", border: "1px solid #4ECDC4", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⧉ Clone</button>
                  <button onClick={() => setViewingMs(null)} style={{ padding: "6px 14px", background: "#fff", color: "#556FB5", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>← Back to milestones</button>
                </div>
              </div>
              <VisColsCtx.Provider value={{ wk: msVisCols.wk, mo: msVisCols.mo, y48: msVisCols.y48, y52: msVisCols.y52 }}>
              {/* Top summary card — Income + salary + bonus + state inputs (formerly in budget sub-sub-tab) */}
              <Card dark style={{ marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, textAlign: "center" }}>
                  {[["Net Income (yr)", fmt(netY), "#4ECDC4"], ["Necessity (yr)", fmt(necT), "#556FB5"], ["Discretionary (yr)", fmt(disT), "#E8573A"], ["Savings (yr)", fmt(savT), "#2ECC71"], ["Remaining (yr)", fmt(remY), remY >= 0 ? "#2ECC71" : "#E74C3C"]].map(([l, v, c]) => (
                    <div key={l}><div style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: "'Fraunces',serif" }}>{v}</div></div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#aaa", textAlign: "center" }}>{p1Name}: {fmt(cNetY)}/yr • {p2Name}: {fmt(kNetY)}/yr • Tax Year: {mYr}</div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p1Name} Annual Salary</label>
                    <NI value={String(Math.round(mCS))} onChange={v => upMs("cSalary", evalF(v))} onBlurResolve prefix="$" style={{ height: 32, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)" }} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p2Name} Annual Salary</label>
                    <NI value={String(Math.round(mKS))} onChange={v => upMs("kSalary", evalF(v))} onBlurResolve prefix="$" style={{ height: 32, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)" }} /></div>
                </div>
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#9B59B6" }}>{p1Name} Bonus %</label>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
                      <input type="number" step="0.1" value={m.cEaipPct !== undefined ? m.cEaipPct : (m.fullState?.cEaip !== undefined ? evalF(m.fullState.cEaip) : 0)} onChange={e => upMs("cEaipPct", +e.target.value || 0)} style={{ flex: 1, border: "none", outline: "none", padding: "6px 8px", fontSize: 12, background: "transparent", color: "#fff", width: "100%", textAlign: "right" }} />
                      <span style={{ padding: "0 8px 0 2px", color: "#aaa", fontWeight: 600, fontSize: 12 }}>%</span>
                    </div></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#9B59B6" }}>{p2Name} Bonus %</label>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
                      <input type="number" step="0.1" value={m.kEaipPct !== undefined ? m.kEaipPct : (m.fullState?.kEaip !== undefined ? evalF(m.fullState.kEaip) : 0)} onChange={e => upMs("kEaipPct", +e.target.value || 0)} style={{ flex: 1, border: "none", outline: "none", padding: "6px 8px", fontSize: 12, background: "transparent", color: "#fff", width: "100%", textAlign: "right" }} />
                      <span style={{ padding: "0 8px 0 2px", color: "#aaa", fontWeight: 600, fontSize: 12 }}>%</span>
                    </div></div>
                </div>
                {(m.eaipNet > 0 || m.eaipGross > 0) && <div style={{ marginTop: 6, fontSize: 10, color: "#9B59B6", textAlign: "center" }}>Bonus net: {fmt(m.eaipNet || 0)} ({p1Name}: {fmt(m.cEaipNet || 0)} • {p2Name}: {fmt(m.kEaipNet || 0)})</div>}
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p1Name} State</label>
                    <input list="m-state-names" value={mP1s.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; upMs("p1State", { ...mP1s, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /><datalist id="m-state-names">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p2Name} State</label>
                    <input list="m-state-names-2" value={mP2s.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; upMs("p2State", { ...mP2s, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /><datalist id="m-state-names-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "#777", textAlign: "center" }}>Taxes auto-calculated from {mYr} rates • Combined gross: {fmt(mCS + mKS)}/yr</div>
              </Card>

              {/* Single Card mirroring live BudgetTab structure: Income → Pre-Tax → 401(k) → Taxes → Post-Tax → Net → Expenses → Savings → Remaining.
                  Uses the per-paycheck breakdown variables already computed at the top of this component (scFed, scSS, scMc, scSt, scFL, scPreW/skPreW, scPostW/skPostW, sc4preW/sk4preW, sc4roW/sk4roW, scNet/skNet). */}
              <Card style={{ overflowX: "auto", marginBottom: 20 }}>
                {(() => { const cols = ["1.8fr", msVisCols.wk && "1fr", msVisCols.mo && "1fr", msVisCols.y48 && "1fr", msVisCols.y52 && "1fr"].filter(Boolean).join(" "); const hdrs = [""]; if (msVisCols.wk) hdrs.push("Weekly"); if (msVisCols.mo) hdrs.push("Monthly"); if (msVisCols.y48) hdrs.push("Yr (48)"); if (msVisCols.y52) hdrs.push("Yr (52)"); return (
                <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, padding: "6px 0", borderBottom: "2px solid var(--bdr2, #d0cdc8)", position: "sticky", top: 0, background: "var(--card-bg, #fff)", zIndex: 2 }}>
                  {hdrs.map(h => <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3, #999)", textTransform: "uppercase", letterSpacing: 1, textAlign: h === "" ? "left" : "right" }}>{h}</div>)}
                </div>); })()}

                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0 4px" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#999" }}>Columns:</span>
                  {[["wk", "Wk"], ["mo", "Mo"], ["y48", "Y×48"], ["y52", "Y×52"]].map(([k, l]) => (
                    <button key={k} onClick={() => setMsVisCols(p => ({ ...p, [k]: !p[k] }))} style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: msVisCols[k] ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 5, background: msVisCols[k] ? "#EEF1FA" : "transparent", color: msVisCols[k] ? "#556FB5" : "var(--tx3, #888)", cursor: "pointer" }}>{l}</button>
                  ))}
                </div>

                <SH>Income</SH>
                <Row label={p1Name + " Salary"} wk={scw} mo={scw * 52 / 12} y48={scw * 48} y52={scw * 52} bold />
                <Row label={p2Name + " Salary"} wk={skw} mo={skw * 52 / 12} y48={skw * 48} y52={skw * 52} bold />
                <Row label="Combined Gross" wk={scw + skw} mo={(scw + skw) * 52 / 12} y48={(scw + skw) * 48} y52={(scw + skw) * 52} bold border />

                {(scPreW + skPreW > 0) && <>
                  <SH color="var(--c-pretax, #c0392b)">Pre-Tax Deductions</SH>
                  <Row label="Pre-Tax Deductions" wk={-(scPreW + skPreW)} mo={-(scPreW + skPreW) * 52 / 12} y48={-(scPreW + skPreW) * 48} y52={-(scPreW + skPreW) * 52} color="var(--c-pretax, #c0392b)" />
                </>}

                {(sc4preW + sk4preW > 0 || sc4roW + sk4roW > 0) && <>
                  <SH color="var(--c-presav, #1ABC9C)">401(k) Contributions</SH>
                  {sc4preW + sk4preW > 0 && <Row label="💰 401(k) Pre-Tax" wk={sc4preW + sk4preW} mo={(sc4preW + sk4preW) * 52 / 12} y48={(sc4preW + sk4preW) * 48} y52={(sc4preW + sk4preW) * 52} color="var(--c-presav, #1ABC9C)" />}
                  {sc4roW + sk4roW > 0 && <Row label="Roth 401(k)" wk={-(sc4roW + sk4roW)} mo={-(sc4roW + sk4roW) * 52 / 12} y48={-(sc4roW + sk4roW) * 48} y52={-(sc4roW + sk4roW) * 52} color="var(--c-posttax, #9B59B6)" />}
                </>}

                <SH color="var(--c-taxable, #556FB5)">Taxable Pay</SH>
                <Row label="Combined Taxable" wk={scTxW + skTxW} mo={(scTxW + skTxW) * 52 / 12} y48={(scTxW + skTxW) * 48} y52={(scTxW + skTxW) * 52} bold color="var(--c-taxable, #556FB5)" />

                <SH color="var(--c-fedtax, #1a5276)">Federal Taxes</SH>
                <Row label="Fed Withholding" wk={-(scFed + skFed)} mo={-(scFed + skFed) * 52 / 12} y48={-(scFed + skFed) * 48} y52={-(scFed + skFed) * 52} color="var(--c-fedtax, #1a5276)" />
                <Row label="OASDI (SS)" wk={-(scSS + skSS)} mo={-(scSS + skSS) * 52 / 12} y48={-(scSS + skSS) * 48} y52={-(scSS + skSS) * 52} color="var(--c-fedtax, #1a5276)" />
                <Row label="Medicare" wk={-(scMc + skMc)} mo={-(scMc + skMc) * 52 / 12} y48={-(scMc + skMc) * 48} y52={-(scMc + skMc) * 52} color="var(--c-fedtax, #1a5276)" />

                <SH color="var(--c-sttax, #8B4513)">State Taxes ({mP1s.abbr || "ST"}{mP2s.abbr && mP2s.abbr !== mP1s.abbr ? `/${mP2s.abbr}` : ""})</SH>
                <Row label={`${mP1s.abbr || "ST"} State Tax`} wk={-(scSt + skSt)} mo={-(scSt + skSt) * 52 / 12} y48={-(scSt + skSt) * 48} y52={-(scSt + skSt) * 52} color="var(--c-sttax, #8B4513)" />
                <Row label={`${mP1s.abbr || "ST"} Payroll Tax`} wk={-(scFL + skFL)} mo={-(scFL + skFL) * 52 / 12} y48={-(scFL + skFL) * 48} y52={-(scFL + skFL) * 52} color="var(--c-sttax, #8B4513)" />

                <Row label="Total Taxes" wk={-(scFed + skFed + scSS + skSS + scMc + skMc + scSt + skSt + scFL + skFL)} mo={-(scFed + skFed + scSS + skSS + scMc + skMc + scSt + skSt + scFL + skFL) * 52 / 12} y48={-(scFed + skFed + scSS + skSS + scMc + skMc + scSt + skSt + scFL + skFL) * 48} y52={-(scFed + skFed + scSS + skSS + scMc + skMc + scSt + skSt + scFL + skFL) * 52} bold border color="var(--c-totaltax, #E8573A)" />

                {(scPostW + skPostW > 0) && <>
                  <SH color="var(--c-posttax, #9B59B6)">Post-Tax Deductions</SH>
                  <Row label="Post-Tax Deductions" wk={-(scPostW + skPostW)} mo={-(scPostW + skPostW) * 52 / 12} y48={-(scPostW + skPostW) * 48} y52={-(scPostW + skPostW) * 52} color="var(--c-posttax, #9B59B6)" />
                </>}

                <div style={{ marginTop: 8, padding: "10px 0", borderTop: "3px solid #1a1a1a", borderBottom: "3px solid #1a1a1a" }}>
                  <Row label="✦ Combined Net Paycheck" wk={mNetW} mo={mNetW * 52 / 12} y48={mNetW * 48} y52={mNetW * 52} bold />
                  <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>{p1Name}: {fmt(scNet)}/wk ({fmt(scNet * 52)}/yr) • {p2Name}: {fmt(skNet)}/wk ({fmt(skNet * 52)}/yr)</div>
                </div>

                {(() => {
                  const svc = msVisCols;
                  const mCols = ["50px", "1.6fr", "90px", svc.wk && "1fr", svc.mo && "1fr", svc.y48 && "1fr", svc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
                  return <>
                  <div style={{ display: "grid", gridTemplateColumns: mCols, gap: 4, padding: "6px 0", borderBottom: "2px solid #d0cdc8", fontSize: 9, fontWeight: 700, color: "#999", textTransform: "uppercase", marginTop: 12 }}>
                    <span>Type</span><span>Name</span><span>Category</span>{svc.wk && <span style={{ textAlign: "right" }}>Weekly</span>}{svc.mo && <span style={{ textAlign: "right" }}>Monthly</span>}{svc.y48 && <span style={{ textAlign: "right" }}>Yearly (48)</span>}{svc.y52 && <span style={{ textAlign: "right" }}>Yearly (52)</span>}<span />
                  </div>
                  {necItems.length > 0 && <SH color="var(--c-taxable, #556FB5)">Necessity</SH>}
                  {necItems.map(([name, data]) => <MsItemRow key={name} name={name} data={data} />)}
                  {necItems.length > 0 && <Row label="Subtotal — Necessity" wk={necT / 48} mo={necT / 12} y48={necT} y52={necT} bold border color="var(--c-taxable, #556FB5)" />}
                  <button onClick={() => addMsItem("N")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Necessity</button>
                  {disItems.length > 0 && <SH color="var(--c-totaltax, #E8573A)">Discretionary</SH>}
                  {disItems.map(([name, data]) => <MsItemRow key={name} name={name} data={data} />)}
                  {disItems.length > 0 && <Row label="Subtotal — Discretionary" wk={disT / 48} mo={disT / 12} y48={disT} y52={disT} bold border color="var(--c-totaltax, #E8573A)" />}
                  <button onClick={() => addMsItem("D")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Discretionary</button>
                  <Row label="Total Expenses" wk={expT / 48} mo={expT / 12} y48={expT} y52={expT} bold border />
                  {savItems.length > 0 && <SH color="#2ECC71">Savings</SH>}
                  {savItems.map(([name, data]) => <MsItemRow key={name} name={name} data={data} />)}
                  {savItems.length > 0 && <Row label="Total Savings" wk={savW} mo={savT / 12} y48={savT} y52={savW * 52} bold border color="#2ECC71" />}
                  <button onClick={() => addMsItem("S")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Savings</button>
                  <div style={{ marginTop: 8, padding: "10px 8px", background: remY >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
                    <Row label="Remaining" wk={remY / 48} mo={remY / 12} y48={remY} y52={remY52} bold color={remY >= 0 ? "#2ECC71" : "#E74C3C"} />
                  </div>
                </>; })()}
              </Card>
              </VisColsCtx.Provider>

              {/* Editable deduction lists — kept as standalone editor cards below the main flow.
                  These let the user adjust the milestone's pre-tax / post-tax deduction line items
                  individually; the totals roll up into the per-paycheck breakdown above via recalcMilestone. */}
              {(() => {
                const fs = m.fullState || {};
                const mPreDed = fs.preDed || DEF_PRE;
                const mPostDed = fs.postDed || DEF_POST;
                const updateMsFS = (key, val) => {
                  const n = [...milestones];
                  const s = { ...n[viewingMs] };
                  const nfs = { ...(s.fullState || {}), [key]: val };
                  s.fullState = nfs;
                  n[viewingMs] = recalcMilestone(s);
                  setMilestones(n);
                };
                const mC4pre = fs.c4pre !== undefined ? fs.c4pre : "0";
                const mC4ro = fs.c4ro !== undefined ? fs.c4ro : "0";
                const mK4pre = fs.k4pre !== undefined ? fs.k4pre : "0";
                const mK4ro = fs.k4ro !== undefined ? fs.k4ro : "0";
                return <>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>401(k) Contributions <span style={{ fontSize: 11, fontWeight: 500, color: "#999" }}>(% of salary)</span></h3>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, alignItems: "center" }}>
                      <div />
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2, #555)" }}>Pre-Tax %</div>
                      <NI value={String(mC4pre)} onChange={v => updateMsFS("c4pre", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <NI value={String(mK4pre)} onChange={v => updateMsFS("k4pre", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2, #555)" }}>Roth %</div>
                      <NI value={String(mC4ro)} onChange={v => updateMsFS("c4ro", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <NI value={String(mK4ro)} onChange={v => updateMsFS("k4ro", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                    </div>
                  </Card>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Pre-Tax Deductions <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
                      {mPreDed.map((d, i) => [
                        <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...mPreDed]; n[i] = { ...n[i], n: v }; updateMsFS("preDed", n); }} /></div>,
                        <NI key={i + "c"} value={d.c} onChange={v => { const n = [...mPreDed]; n[i] = { ...n[i], c: v }; updateMsFS("preDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <NI key={i + "k"} value={d.k} onChange={v => { const n = [...mPreDed]; n[i] = { ...n[i], k: v }; updateMsFS("preDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <button key={i + "x"} onClick={() => updateMsFS("preDed", mPreDed.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                      ])}
                    </div>
                    <button onClick={() => updateMsFS("preDed", [...mPreDed, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
                  </Card>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Post-Tax Deductions <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
                      {mPostDed.map((d, i) => [
                        <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...mPostDed]; n[i] = { ...n[i], n: v }; updateMsFS("postDed", n); }} /></div>,
                        <NI key={i + "c"} value={d.c} onChange={v => { const n = [...mPostDed]; n[i] = { ...n[i], c: v }; updateMsFS("postDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <NI key={i + "k"} value={d.k} onChange={v => { const n = [...mPostDed]; n[i] = { ...n[i], k: v }; updateMsFS("postDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <button key={i + "x"} onClick={() => updateMsFS("postDed", mPostDed.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                      ])}
                    </div>
                    <button onClick={() => updateMsFS("postDed", [...mPostDed, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
                  </Card>
                </>;
              })()}

              {/* Tax settings + match tier reference. Year/filing/state are part of the milestone's
                  fullState; changing them re-runs recalcMilestone so the breakdown above stays consistent. */}
              {(() => {
                const fs = m.fullState || {};
                const mTax = fs.tax || tax;
                const mDateYr = m.date ? m.date.slice(0, 4) : tax.year;
                const effectiveTaxYr = mTax.year || mDateYr;
                const effectiveTD = allTaxDB[effectiveTaxYr] || allTaxDB[mDateYr] || allTaxDB[tax.year] || TAX_DB["2026"];
                const updateMsTax = (key, val) => {
                  const n = [...milestones];
                  const s = { ...n[viewingMs] };
                  const newTax = { ...(s.fullState?.tax || tax), [key]: val };
                  s.fullState = { ...(s.fullState || {}), tax: newTax };
                  n[viewingMs] = recalcMilestone(s);
                  setMilestones(n);
                };
                const mP1 = mTax.p1State || m.p1State || (tax.p1State || {});
                const mP2 = mTax.p2State || m.p2State || (tax.p2State || {});
                const mFiling = m.fil || fs.fil || fil;
                return <>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Tax Settings</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Tax Year <span style={{ fontSize: 9, color: "#556FB5" }}>(auto: {mDateYr})</span></label>
                        <select value={effectiveTaxYr} onChange={e => { const yr = e.target.value; const rates = allTaxDB[yr]; if (rates) { const n = [...milestones]; const s = { ...n[viewingMs] }; s.fullState = { ...(s.fullState || {}), tax: { ...mTax, year: yr, ...rates, p1State: mP1, p2State: mP2 } }; n[viewingMs] = recalcMilestone(s); setMilestones(n); } }} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}>
                          {Object.keys(allTaxDB).sort().map(y => <option key={y} value={y}>{y}</option>)}
                        </select></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Filing Status</label>
                        <select value={mFiling} onChange={e => { upMs("fil", e.target.value); const n = [...milestones]; const s = { ...n[viewingMs] }; if (s.fullState) s.fullState = { ...s.fullState, fil: e.target.value }; n[viewingMs] = recalcMilestone(s); setMilestones(n); }} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)" }}>
                          <option value="mfj">Married Filing Jointly</option><option value="single">Single</option>
                        </select></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} State</label>
                        <input list="m-tax-states" value={mP1.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; updateMsTax("p1State", { ...mP1, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)", boxSizing: "border-box" }} /><datalist id="m-tax-states">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} State</label>
                        <input list="m-tax-states-2" value={mP2.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; updateMsTax("p2State", { ...mP2, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, background: "var(--input-bg, #fafafa)", boxSizing: "border-box" }} /><datalist id="m-tax-states-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                    </div>
                    <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--input-bg, #f4f4f4)", borderRadius: 8, fontSize: 11, color: "var(--tx2, #555)" }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Rate Details ({effectiveTaxYr})</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                        <div>Std Ded ({mFiling === "mfj" ? "MFJ" : "Single"}): <strong>{fmt(mFiling === "mfj" ? effectiveTD.stdMFJ : effectiveTD.stdSingle)}</strong></div>
                        <div>SS Cap: <strong>{fmt(effectiveTD.ssCap)}</strong></div>
                        <div>SS Rate: <strong>{p2(effectiveTD.ssRate)}</strong></div>
                        <div>Medicare Rate: <strong>{p2(effectiveTD.medRate)}</strong></div>
                        <div>401k Limit: <strong>{fmt(effectiveTD.k401Lim)}</strong></div>
                        <div>{p1Name} ({mP1.abbr || "ST"}) Payroll: <strong>{p2(mP1.famli || 0)}</strong></div>
                      </div>
                    </div>
                  </Card>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Employer Match Tiers</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 8 }}>{p1Name} Match</div>
                        <div style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 4 }}>Base: {mTax.cMatchBase || 0}%</div>
                        {(mTax.cMatchTiers || []).map((t, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 2 }}>Up to {t.upTo}% → {(t.rate * 100).toFixed(0)}% match</div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 8 }}>{p2Name} Match</div>
                        <div style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 4 }}>Base: {mTax.kMatchBase || 0}%</div>
                        {(mTax.kMatchTiers || []).map((t, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 2 }}>Up to {t.upTo}% → {(t.rate * 100).toFixed(0)}% match</div>
                        ))}
                      </div>
                    </div>
                  </Card>
                </>;
              })()}
            </div>
          );
}

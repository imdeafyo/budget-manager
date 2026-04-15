import { useState } from "react";
import { Card, SH, NI, EditTxt, VisColsCtx, Row } from "../components/ui.jsx";
import { evalF, calcFed, calcStateTax, getMarg, fmt, fp, p2 } from "../utils/calc.js";
import { TAX_DB, STATE_ABBR, STATE_PAYROLL, DEF_PRE, DEF_POST } from "../data/taxDB.js";

export default function SnapshotViewTab({ mob, viewingSnap, setViewingSnap, snapshots, setSnapshots, recalcSnap, snapVisCols, setSnapVisCols, snapTab, setSnapTab, p1Name, p2Name, tax, allTaxDB, fil, cats, savCats }) {
  const snap = snapshots[viewingSnap];
          const items = snap.items || {};
          const necItems = Object.entries(items).filter(([, d]) => d.t === "N").sort((a, b) => a[0].localeCompare(b[0]));
          const disItems = Object.entries(items).filter(([, d]) => d.t === "D").sort((a, b) => a[0].localeCompare(b[0]));
          const savItems = Object.entries(items).filter(([, d]) => d.t === "S").sort((a, b) => a[0].localeCompare(b[0]));
          const necT = necItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const disT = disItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const savT = savItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const expT = necT + disT;

          // Salary-based tax calc for snapshot — includes deductions from fullState
          const snapCS = snap.cSalary !== undefined ? snap.cSalary : (snap.cGrossW || 0) * 52;
          const snapKS = snap.kSalary !== undefined ? snap.kSalary : (snap.kGrossW || 0) * 52;
          const snapYr = snap.date ? snap.date.slice(0, 4) : tax.year;
          const snapTaxData = allTaxDB[snapYr] || allTaxDB[tax.year] || TAX_DB["2026"];
          const snapFil = snap.fil || fil;
          const snapP1s = snap.p1State || (tax.p1State || {});
          const snapP2s = snap.p2State || (tax.p2State || {});
          const scw = snapCS / 52, skw = snapKS / 52;
          // Deductions from fullState
          const sFS = snap.fullState || {};
          const sPreDed = sFS.preDed || [];
          const sPostDed = sFS.postDed || [];
          const scPreW = sPreDed.reduce((s, d) => s + evalF(d.c), 0);
          const skPreW = sPreDed.reduce((s, d) => s + evalF(d.k), 0);
          const sc4preW = snapCS * Math.min(evalF(sFS.c4pre || 0) / 100, 1) / 52;
          const sc4roW = snapCS * Math.min(evalF(sFS.c4ro || 0) / 100, 1) / 52;
          const sk4preW = snapKS * Math.min(evalF(sFS.k4pre || 0) / 100, 1) / 52;
          const sk4roW = snapKS * Math.min(evalF(sFS.k4ro || 0) / 100, 1) / 52;
          const scTxW = scw - scPreW - sc4preW, skTxW = skw - skPreW - sk4preW;
          const sBr = snapFil === "mfj" ? snapTaxData.fedMFJ : snapTaxData.fedSingle;
          const sSd = snapFil === "mfj" ? snapTaxData.stdMFJ : snapTaxData.stdSingle;
          const sCombTxA = (scTxW + skTxW) * 52;
          const sFedTax = snapFil === "mfj" ? calcFed(Math.max(0, sCombTxA - sSd), sBr) : calcFed(Math.max(0, scTxW * 52 - snapTaxData.stdSingle), snapTaxData.fedSingle) + calcFed(Math.max(0, skTxW * 52 - snapTaxData.stdSingle), snapTaxData.fedSingle);
          const sSsR = snapTaxData.ssRate / 100, sMedR = snapTaxData.medRate / 100;
          const sTot = scTxW + skTxW, sCr = sTot > 0 ? scTxW / sTot : 0.5;
          const scFed = (sFedTax / 52) * sCr, skFed = (sFedTax / 52) * (1 - sCr);
          const scSS = Math.min(scw, snapTaxData.ssCap / 52) * sSsR, skSS = Math.min(skw, snapTaxData.ssCap / 52) * sSsR;
          const scMc = scw * sMedR, skMc = skw * sMedR;
          const scSt = calcStateTax(scTxW * 52, snapP1s.abbr || "", snapFil) / 52;
          const skSt = calcStateTax(skTxW * 52, snapP2s.abbr || "", snapFil) / 52;
          const scFL = scw * (snapP1s.famli || 0) / 100, skFL = skw * (snapP2s.famli || 0) / 100;
          const scPostW = sPostDed.reduce((s, d) => s + evalF(d.c), 0);
          const skPostW = sPostDed.reduce((s, d) => s + evalF(d.k), 0);
          const scNet = scw - scPreW - sc4preW - sc4roW - scFed - scSS - scMc - scSt - scFL - scPostW;
          const skNet = skw - skPreW - sk4preW - sk4roW - skFed - skSS - skMc - skSt - skFL - skPostW;
          const snapNetW = scNet + skNet;
          const netY = snapNetW * 48;
          const remY = netY - expT - savT;
          const cNetY = scNet * 48, kNetY = skNet * 48;

          const upSnap = (field, val) => { const n = [...snapshots]; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], [field]: val }); setSnapshots(n); };
          const renameSnapItem = (oldName, newName) => { if (oldName === newName || !newName.trim()) return; const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; it[newName.trim()] = it[oldName]; delete it[oldName]; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it }); setSnapshots(n); };
          const upSnapItem = (name, field, val) => { const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; it[name] = { ...it[name], [field]: val }; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it }); setSnapshots(n); };
          const upSnapVal = (name, rawVal, period) => {
            let yearly = +rawVal || 0;
            if (period === "w") yearly = yearly * 48;
            else if (period === "m") yearly = yearly * 12;
            upSnapItem(name, "v", Math.round(yearly * 100) / 100);
          };
          const rmSnapItem = (name) => { const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; delete it[name]; n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it }); setSnapshots(n); };
          const addSnapItem = (type) => {
            const newName = type === "S" ? "New Savings Item" : "New Expense Item";
            let finalName = newName;
            const existing = snap.items || {};
            let counter = 1;
            while (existing[finalName]) { finalName = `${newName} ${counter++}`; }
            const n = [...snapshots];
            const it = { ...(n[viewingSnap].items || {}), [finalName]: { v: 0, t: type, c: "" } };
            n[viewingSnap] = recalcSnap({ ...n[viewingSnap], items: it });
            setSnapshots(n);
          };
          const SnapItemRow = ({ name, data }) => {
            const yr = data.v || 0, wk = yr / 48, mo = yr / 12;
            const [editPer, setEditPer] = useState(null);
            const allCats = [...cats, ...savCats.filter(sc => !cats.includes(sc))];
            const valFor = p => p === "w" ? wk : p === "m" ? mo : yr;
            const saveEditVal = (v, per) => {
              let yearly = evalF(v);
              if (per === "w") yearly = yearly * 48;
              else if (per === "m") yearly = yearly * 12;
              upSnapItem(name, "v", Math.round(yearly * 100) / 100);
              setEditPer(null);
            };
            const svc = snapVisCols;
            const snapItemCols = ["50px", "1.6fr", "90px", svc.wk && "1fr", svc.mo && "1fr", svc.y48 && "1fr", svc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
            const periods = [svc.wk && "w", svc.mo && "m", svc.y48 && "y"].filter(Boolean);
            return (
              <div style={{ display: "grid", gridTemplateColumns: snapItemCols, gap: 4, padding: "3px 0", alignItems: "center", fontSize: 12 }}>
                <select value={data.t || "N"} onChange={e => upSnapItem(name, "t", e.target.value)} style={{ fontSize: 9, color: "#fff", fontWeight: 700, border: "none", borderRadius: 5, padding: "3px 4px", background: data.t === "N" ? "#556FB5" : data.t === "D" ? "#E8573A" : "#2ECC71", cursor: "pointer" }}>
                  <option value="N">NEC</option><option value="D">DIS</option><option value="S">SAV</option>
                </select>
                <EditTxt value={name} onChange={v => renameSnapItem(name, v)} />
                <select value={data.c || ""} onChange={e => upSnapItem(name, "c", e.target.value)} style={{ fontSize: 10, border: "1px solid #ddd", borderRadius: 4, padding: "2px 3px" }}>
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
                <button onClick={() => rmSnapItem(name)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--tx3,#ccc)", padding: 0 }}>×</button>
              </div>
            );
          };
          // Build sorted snapshot indices for paging
          const sortedSnapIdx = snapshots.map((s, i) => ({ i, date: s.date || "" })).sort((a, b) => a.date.localeCompare(b.date));
          const curPosInSorted = sortedSnapIdx.findIndex(x => x.i === viewingSnap);
          const prevSnapIdx = curPosInSorted > 0 ? sortedSnapIdx[curPosInSorted - 1].i : null;
          const nextSnapIdx = curPosInSorted < sortedSnapIdx.length - 1 ? sortedSnapIdx[curPosInSorted + 1].i : null;
          return (
            <div>
              <div style={{ background: "#556FB5", color: "#fff", padding: "12px 20px", borderRadius: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, fontFamily: "'Fraunces',serif", flexShrink: 0 }}>Snapshot:</span>
                  <input type="date" value={snap.date || ""} onChange={e => upSnap("date", e.target.value)} style={{ border: "none", borderBottom: "2px solid rgba(255,255,255,0.4)", background: "transparent", color: "#fff", fontSize: 13, fontFamily: "'DM Sans',sans-serif", padding: "2px 4px", outline: "none" }} />
                  <input value={snap.label || ""} onChange={e => upSnap("label", e.target.value)} style={{ border: "none", borderBottom: "2px solid rgba(255,255,255,0.4)", background: "transparent", color: "#fff", fontSize: 13, fontFamily: "'DM Sans',sans-serif", padding: "2px 4px", outline: "none", flex: 1, minWidth: 120 }} />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button disabled={prevSnapIdx === null} onClick={() => prevSnapIdx !== null && setViewingSnap(prevSnapIdx)} style={{ padding: "6px 10px", background: prevSnapIdx !== null ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)", color: prevSnapIdx !== null ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: prevSnapIdx !== null ? "pointer" : "default" }}>◀</button>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", minWidth: 40, textAlign: "center" }}>{curPosInSorted + 1}/{sortedSnapIdx.length}</span>
                  <button disabled={nextSnapIdx === null} onClick={() => nextSnapIdx !== null && setViewingSnap(nextSnapIdx)} style={{ padding: "6px 10px", background: nextSnapIdx !== null ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)", color: nextSnapIdx !== null ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: nextSnapIdx !== null ? "pointer" : "default" }}>▶</button>
                  <button onClick={() => setRestoreConfirm(viewingSnap)} style={{ padding: "6px 14px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Restore This</button>
                  <button onClick={() => { const clone = JSON.parse(JSON.stringify(snap)); clone.id = Date.now(); clone.label = (clone.label || "Snapshot") + " (copy)"; setSnapshots(prev => { const n = [...prev, clone].sort((a, b) => (a.date || "").localeCompare(b.date || "")); const newIdx = n.findIndex(s => s.id === clone.id); setViewingSnap(newIdx); return n; }); }} style={{ padding: "6px 14px", background: "rgba(255,255,255,0.2)", color: "#4ECDC4", border: "1px solid #4ECDC4", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⧉ Clone</button>
                  <button onClick={() => setViewingSnap(null)} style={{ padding: "6px 14px", background: "#fff", color: "#556FB5", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>← Back to Current</button>
                </div>
              </div>
              {/* Snapshot sub-tabs */}
              <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
                {[["budget", "Budget"], ["deductions", "Deductions"], ["tax", "Tax"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSnapTab(k)} style={{ padding: "8px 18px", border: snapTab === k ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 8, background: snapTab === k ? "#EEF1FA" : "transparent", color: snapTab === k ? "#556FB5" : "var(--tx3, #888)", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>{l}</button>
                ))}
              </div>
              {snapTab === "budget" && <>
              <VisColsCtx.Provider value={{ wk: snapVisCols.wk, mo: snapVisCols.mo, y48: snapVisCols.y48, y52: snapVisCols.y52 }}>
              <Card dark style={{ marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, textAlign: "center" }}>
                  {[["Net Income (yr)", fmt(netY), "#4ECDC4"], ["Necessity (yr)", fmt(necT), "#556FB5"], ["Discretionary (yr)", fmt(disT), "#E8573A"], ["Savings (yr)", fmt(savT), "#2ECC71"], ["Remaining (yr)", fmt(remY), remY >= 0 ? "#2ECC71" : "#E74C3C"]].map(([l, v, c]) => (
                    <div key={l}><div style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: "'Fraunces',serif" }}>{v}</div></div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#aaa", textAlign: "center" }}>{p1Name}: {fmt(cNetY)}/yr • {p2Name}: {fmt(kNetY)}/yr • Tax Year: {snapYr}</div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p1Name} Annual Salary</label>
                    <NI value={String(Math.round(snapCS))} onChange={v => upSnap("cSalary", evalF(v))} onBlurResolve prefix="$" style={{ height: 32, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)" }} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p2Name} Annual Salary</label>
                    <NI value={String(Math.round(snapKS))} onChange={v => upSnap("kSalary", evalF(v))} onBlurResolve prefix="$" style={{ height: 32, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)" }} /></div>
                </div>
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#9B59B6" }}>{p1Name} Bonus %</label>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
                      <input type="number" step="0.1" value={snap.cEaipPct !== undefined ? snap.cEaipPct : (snap.fullState?.cEaip !== undefined ? evalF(snap.fullState.cEaip) : 0)} onChange={e => upSnap("cEaipPct", +e.target.value || 0)} style={{ flex: 1, border: "none", outline: "none", padding: "6px 8px", fontSize: 12, background: "transparent", color: "#fff", width: "100%", textAlign: "right" }} />
                      <span style={{ padding: "0 8px 0 2px", color: "#aaa", fontWeight: 600, fontSize: 12 }}>%</span>
                    </div></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#9B59B6" }}>{p2Name} Bonus %</label>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
                      <input type="number" step="0.1" value={snap.kEaipPct !== undefined ? snap.kEaipPct : (snap.fullState?.kEaip !== undefined ? evalF(snap.fullState.kEaip) : 0)} onChange={e => upSnap("kEaipPct", +e.target.value || 0)} style={{ flex: 1, border: "none", outline: "none", padding: "6px 8px", fontSize: 12, background: "transparent", color: "#fff", width: "100%", textAlign: "right" }} />
                      <span style={{ padding: "0 8px 0 2px", color: "#aaa", fontWeight: 600, fontSize: 12 }}>%</span>
                    </div></div>
                </div>
                {(snap.eaipNet > 0 || snap.eaipGross > 0) && <div style={{ marginTop: 6, fontSize: 10, color: "#9B59B6", textAlign: "center" }}>Bonus net: {fmt(snap.eaipNet || 0)} ({p1Name}: {fmt(snap.cEaipNet || 0)} • {p2Name}: {fmt(snap.kEaipNet || 0)})</div>}
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p1Name} State</label>
                    <input list="snap-state-names" value={snapP1s.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; upSnap("p1State", { ...snapP1s, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /><datalist id="snap-state-names">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>{p2Name} State</label>
                    <input list="snap-state-names-2" value={snapP2s.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; upSnap("p2State", { ...snapP2s, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /><datalist id="snap-state-names-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "#777", textAlign: "center" }}>Taxes auto-calculated from {snapYr} rates • Combined gross: {fmt(snapCS + snapKS)}/yr</div>
              </Card>
              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#999" }}>Columns:</span>
                  {[["wk", "Wk"], ["mo", "Mo"], ["y48", "Y×48"], ["y52", "Y×52"]].map(([k, l]) => (
                    <button key={k} onClick={() => setSnapVisCols(p => ({ ...p, [k]: !p[k] }))} style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: snapVisCols[k] ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 5, background: snapVisCols[k] ? "#EEF1FA" : "transparent", color: snapVisCols[k] ? "#556FB5" : "var(--tx3, #888)", cursor: "pointer" }}>{l}</button>
                  ))}
                </div>
                {(() => {
                  const svc = snapVisCols;
                  const snapCols = ["50px", "1.6fr", "90px", svc.wk && "1fr", svc.mo && "1fr", svc.y48 && "1fr", svc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
                  return <>
                <div style={{ display: "grid", gridTemplateColumns: snapCols, gap: 4, padding: "6px 0", borderBottom: "2px solid #d0cdc8", fontSize: 9, fontWeight: 700, color: "#999", textTransform: "uppercase" }}>
                  <span>Type</span><span>Name</span><span>Category</span>{svc.wk && <span style={{ textAlign: "right" }}>Weekly</span>}{svc.mo && <span style={{ textAlign: "right" }}>Monthly</span>}{svc.y48 && <span style={{ textAlign: "right" }}>Yearly (48)</span>}{svc.y52 && <span style={{ textAlign: "right" }}>Yearly (52)</span>}<span />
                </div>
                {necItems.length > 0 && <SH color="var(--c-taxable, #556FB5)">Necessity</SH>}
                {necItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {necItems.length > 0 && <Row label="Subtotal — Necessity" wk={necT / 48} mo={necT / 12} y48={necT} y52={necT} bold border color="var(--c-taxable, #556FB5)" />}
                <button onClick={() => addSnapItem("N")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Necessity</button>
                {disItems.length > 0 && <SH color="var(--c-totaltax, #E8573A)">Discretionary</SH>}
                {disItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {disItems.length > 0 && <Row label="Subtotal — Discretionary" wk={disT / 48} mo={disT / 12} y48={disT} y52={disT} bold border color="var(--c-totaltax, #E8573A)" />}
                <button onClick={() => addSnapItem("D")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Discretionary</button>
                <Row label="Total Expenses" wk={expT / 48} mo={expT / 12} y48={expT} y52={expT} bold border />
                {savItems.length > 0 && <SH color="#2ECC71">Savings</SH>}
                {savItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {savItems.length > 0 && <Row label="Total Savings" wk={savT / 48} mo={savT / 12} y48={savT} y52={savT * 52 / 48} bold border color="#2ECC71" />}
                <button onClick={() => addSnapItem("S")} style={{ marginTop: 4, marginBottom: 8, padding: "4px 12px", fontSize: 11, border: "1px dashed var(--bdr, #ccc)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Savings</button>
                <div style={{ marginTop: 8, padding: "10px 8px", background: remY >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
                  <Row label="Remaining" wk={remY / 48} mo={remY / 12} y48={remY} y52={remY * 52 / 48} bold color={remY >= 0 ? "#2ECC71" : "#E74C3C"} />
                </div>
              </>; })()}
              </Card>
              </VisColsCtx.Provider>
              </>}
              {/* Snapshot Deductions Tab */}
              {snapTab === "deductions" && (() => {
                const fs = snap.fullState || {};
                const snapPreDed = fs.preDed || DEF_PRE;
                const snapPostDed = fs.postDed || DEF_POST;
                const updateSnapFS = (key, val) => {
                  const n = [...snapshots];
                  const s = { ...n[viewingSnap] };
                  const nfs = { ...(s.fullState || {}), [key]: val };
                  // Auto-sync HSA annual → preDed HSA row (mirrors main app behavior)
                  if (key === "cHsaAnn" || key === "kHsaAnn") {
                    const cA = evalF(key === "cHsaAnn" ? val : (nfs.cHsaAnn || "0"));
                    const kA = evalF(key === "kHsaAnn" ? val : (nfs.kHsaAnn || "0"));
                    const pd = [...(nfs.preDed || DEF_PRE)];
                    const hi = pd.findIndex(d => d.n.toLowerCase().includes("hsa"));
                    if (hi >= 0) {
                      pd[hi] = { ...pd[hi], c: String(Math.round(cA / 52 * 100) / 100), k: String(Math.round(kA / 52 * 100) / 100) };
                      nfs.preDed = pd;
                    }
                  }
                  s.fullState = nfs;
                  n[viewingSnap] = recalcSnap(s);
                  setSnapshots(n);
                };
                const snapC4pre = fs.c4pre !== undefined ? fs.c4pre : "0";
                const snapC4ro = fs.c4ro !== undefined ? fs.c4ro : "0";
                const snapK4pre = fs.k4pre !== undefined ? fs.k4pre : "0";
                const snapK4ro = fs.k4ro !== undefined ? fs.k4ro : "0";
                const snapCHsa = fs.cHsaAnn !== undefined ? fs.cHsaAnn : "0";
                const snapKHsa = fs.kHsaAnn !== undefined ? fs.kHsaAnn : "0";
                // Calculate dollar amounts from percentages
                const c4preAnn = snapCS * evalF(snapC4pre) / 100;
                const c4roAnn = snapCS * evalF(snapC4ro) / 100;
                const k4preAnn = snapKS * evalF(snapK4pre) / 100;
                const k4roAnn = snapKS * evalF(snapK4ro) / 100;
                const cPreTotal = snapPreDed.reduce((s, d) => s + evalF(d.c), 0);
                const kPreTotal = snapPreDed.reduce((s, d) => s + evalF(d.k), 0);
                const cPostTotal = snapPostDed.reduce((s, d) => s + evalF(d.c), 0);
                const kPostTotal = snapPostDed.reduce((s, d) => s + evalF(d.k), 0);
                // HSA is already included in preDed totals — don't add separately
                const cTotalDed = cPreTotal * 52 + c4preAnn + c4roAnn + cPostTotal * 52;
                const kTotalDed = kPreTotal * 52 + k4preAnn + k4roAnn + kPostTotal * 52;
                return <>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>401(k) Contributions</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, alignItems: "center" }}>
                      <div />
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2, #555)" }}>Pre-Tax %</div>
                      <NI value={String(snapC4pre)} onChange={v => updateSnapFS("c4pre", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <NI value={String(snapK4pre)} onChange={v => updateSnapFS("k4pre", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <div style={{ fontSize: 11, color: "var(--tx3, #999)" }}>Pre-Tax $/yr</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-presav, #1ABC9C)", fontWeight: 600, padding: "4px 8px" }}>{fmt(c4preAnn)}</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-presav, #1ABC9C)", fontWeight: 600, padding: "4px 8px" }}>{fmt(k4preAnn)}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2, #555)" }}>Roth %</div>
                      <NI value={String(snapC4ro)} onChange={v => updateSnapFS("c4ro", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <NI value={String(snapK4ro)} onChange={v => updateSnapFS("k4ro", v)} onBlurResolve prefix="" style={{ height: 32 }} />
                      <div style={{ fontSize: 11, color: "var(--tx3, #999)" }}>Roth $/yr</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-posttax, #9B59B6)", fontWeight: 600, padding: "4px 8px" }}>{fmt(c4roAnn)}</div>
                      <div style={{ fontSize: 12, textAlign: "right", color: "var(--c-posttax, #9B59B6)", fontWeight: 600, padding: "4px 8px" }}>{fmt(k4roAnn)}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--tx, #333)", borderTop: "2px solid var(--bdr2, #d0cdc8)", paddingTop: 6 }}>Total 401k/yr</div>
                      <div style={{ fontSize: 12, textAlign: "right", fontWeight: 700, color: "var(--tx, #333)", borderTop: "2px solid var(--bdr2, #d0cdc8)", paddingTop: 6 }}>{fmt(c4preAnn + c4roAnn)}</div>
                      <div style={{ fontSize: 12, textAlign: "right", fontWeight: 700, color: "var(--tx, #333)", borderTop: "2px solid var(--bdr2, #d0cdc8)", paddingTop: 6 }}>{fmt(k4preAnn + k4roAnn)}</div>
                    </div>
                  </Card>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>HSA Annual Contributions</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} Annual HSA</label>
                        <NI value={String(snapCHsa)} onChange={v => updateSnapFS("cHsaAnn", v)} onBlurResolve prefix="$" style={{ height: 32 }} />
                        <div style={{ fontSize: 10, color: "var(--tx3, #999)", marginTop: 2 }}>{fmt(evalF(snapCHsa) / 52)}/wk</div></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} Annual HSA</label>
                        <NI value={String(snapKHsa)} onChange={v => updateSnapFS("kHsaAnn", v)} onBlurResolve prefix="$" style={{ height: 32 }} />
                        <div style={{ fontSize: 10, color: "var(--tx3, #999)", marginTop: 2 }}>{fmt(evalF(snapKHsa) / 52)}/wk</div></div>
                    </div>
                  </Card>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Pre-Tax Deductions <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
                      {snapPreDed.map((d, i) => [
                        <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...snapPreDed]; n[i] = { ...n[i], n: v }; updateSnapFS("preDed", n); }} /></div>,
                        <NI key={i + "c"} value={d.c} onChange={v => { const n = [...snapPreDed]; n[i] = { ...n[i], c: v }; updateSnapFS("preDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <NI key={i + "k"} value={d.k} onChange={v => { const n = [...snapPreDed]; n[i] = { ...n[i], k: v }; updateSnapFS("preDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <button key={i + "x"} onClick={() => updateSnapFS("preDed", snapPreDed.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                      ])}
                    </div>
                    <button onClick={() => updateSnapFS("preDed", [...snapPreDed, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
                  </Card>
                  <Card>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Post-Tax Deductions <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
                    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
                      {snapPostDed.map((d, i) => [
                        <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...snapPostDed]; n[i] = { ...n[i], n: v }; updateSnapFS("postDed", n); }} /></div>,
                        <NI key={i + "c"} value={d.c} onChange={v => { const n = [...snapPostDed]; n[i] = { ...n[i], c: v }; updateSnapFS("postDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <NI key={i + "k"} value={d.k} onChange={v => { const n = [...snapPostDed]; n[i] = { ...n[i], k: v }; updateSnapFS("postDed", n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
                        <button key={i + "x"} onClick={() => updateSnapFS("postDed", snapPostDed.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                      ])}
                    </div>
                    <button onClick={() => updateSnapFS("postDed", [...snapPostDed, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
                  </Card>
                  <Card dark style={{ marginTop: 20 }}>
                    <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>Deductions Summary (Annual)</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, fontSize: 11 }}>
                      <div style={{ fontWeight: 700, color: "#888" }}>Category</div>
                      <div style={{ fontWeight: 700, color: "#888", textAlign: "right" }}>{p1Name}</div>
                      <div style={{ fontWeight: 700, color: "#888", textAlign: "right" }}>{p2Name}</div>
                      <div style={{ fontWeight: 700, color: "#888", textAlign: "right" }}>Total</div>
                      {[
                        ["401k Pre-Tax", c4preAnn, k4preAnn, "#1ABC9C"],
                        ["401k Roth", c4roAnn, k4roAnn, "#9B59B6"],
                        ["Pre-Tax Deductions", cPreTotal * 52, kPreTotal * 52, "#c0392b"],
                        ["Post-Tax Deductions", cPostTotal * 52, kPostTotal * 52, "#9B59B6"],
                      ].map(([label, v1, v2, color]) => [
                        <div key={label + "l"} style={{ color, padding: "3px 0" }}>{label}</div>,
                        <div key={label + "1"} style={{ textAlign: "right", color: "#ccc", padding: "3px 0" }}>{fmt(v1)}</div>,
                        <div key={label + "2"} style={{ textAlign: "right", color: "#ccc", padding: "3px 0" }}>{fmt(v2)}</div>,
                        <div key={label + "t"} style={{ textAlign: "right", color: "#fff", fontWeight: 600, padding: "3px 0" }}>{fmt(v1 + v2)}</div>,
                      ])}
                      <div style={{ fontWeight: 700, color: "#fff", borderTop: "1px solid #555", paddingTop: 6 }}>Total Deductions</div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "#fff", borderTop: "1px solid #555", paddingTop: 6 }}>{fmt(cTotalDed)}</div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "#fff", borderTop: "1px solid #555", paddingTop: 6 }}>{fmt(kTotalDed)}</div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "#4ECDC4", borderTop: "1px solid #555", paddingTop: 6 }}>{fmt(cTotalDed + kTotalDed)}</div>
                    </div>
                  </Card>
                </>;
              })()}
              {/* Snapshot Tax Tab */}
              {snapTab === "tax" && (() => {
                const fs = snap.fullState || {};
                const snapTax = fs.tax || tax;
                // Auto-match tax year to snapshot date
                const snapDateYr = snap.date ? snap.date.slice(0, 4) : tax.year;
                const effectiveTaxYr = snapTax.year || snapDateYr;
                const effectiveTD = allTaxDB[effectiveTaxYr] || allTaxDB[snapDateYr] || allTaxDB[tax.year] || TAX_DB["2026"];
                const updateSnapTax = (key, val) => {
                  const n = [...snapshots];
                  const s = { ...n[viewingSnap] };
                  const newTax = { ...(s.fullState?.tax || tax), [key]: val };
                  s.fullState = { ...(s.fullState || {}), tax: newTax };
                  n[viewingSnap] = recalcSnap(s);
                  setSnapshots(n);
                };
                const snapP1 = snapTax.p1State || snap.p1State || (tax.p1State || {});
                const snapP2 = snapTax.p2State || snap.p2State || (tax.p2State || {});
                const snapFiling = snap.fil || fs.fil || fil;
                // Calculate per-person taxes for display
                const p1Sal = snapCS, p2Sal = snapKS;
                const p1w = p1Sal / 52, p2w = p2Sal / 52;
                const eTD = effectiveTD;
                const eBr = snapFiling === "mfj" ? eTD.fedMFJ : eTD.fedSingle;
                const eSd = snapFiling === "mfj" ? eTD.stdMFJ : eTD.stdSingle;
                const combTax = (p1w + p2w) * 52;
                const fedTax = snapFiling === "mfj" ? calcFed(Math.max(0, combTax - eSd), eBr) : calcFed(Math.max(0, p1Sal - eTD.stdSingle), eTD.fedSingle) + calcFed(Math.max(0, p2Sal - eTD.stdSingle), eTD.fedSingle);
                const fedTaxP1 = snapFiling === "mfj" ? fedTax * (combTax > 0 ? p1Sal / combTax : 0.5) : calcFed(Math.max(0, p1Sal - eTD.stdSingle), eTD.fedSingle);
                const fedTaxP2 = snapFiling === "mfj" ? fedTax - fedTaxP1 : calcFed(Math.max(0, p2Sal - eTD.stdSingle), eTD.fedSingle);
                const ssR = eTD.ssRate / 100, mcR = eTD.medRate / 100;
                const p1SS = Math.min(p1Sal, eTD.ssCap) * ssR, p2SS = Math.min(p2Sal, eTD.ssCap) * ssR;
                const p1Mc = p1Sal * mcR, p2Mc = p2Sal * mcR;
                const p1St = calcStateTax(p1Sal, snapP1.abbr || "", snapFiling);
                const p2St = calcStateTax(p2Sal, snapP2.abbr || "", snapFiling);
                const p1FL = p1Sal * (snapP1.famli || 0) / 100, p2FL = p2Sal * (snapP2.famli || 0) / 100;
                const p1Total = fedTaxP1 + p1SS + p1Mc + p1St + p1FL;
                const p2Total = fedTaxP2 + p2SS + p2Mc + p2St + p2FL;
                const grandTotal = p1Total + p2Total;
                const p1EffRate = p1Sal > 0 ? (p1Total / p1Sal * 100).toFixed(1) : "0.0";
                const p2EffRate = p2Sal > 0 ? (p2Total / p2Sal * 100).toFixed(1) : "0.0";
                return <>
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Tax Settings</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Tax Year <span style={{ fontSize: 9, color: "#556FB5" }}>(auto: {snapDateYr})</span></label>
                        <select value={effectiveTaxYr} onChange={e => { const yr = e.target.value; const rates = allTaxDB[yr]; if (rates) { const n = [...snapshots]; const s = { ...n[viewingSnap] }; s.fullState = { ...(s.fullState || {}), tax: { ...snapTax, year: yr, ...rates, p1State: snapP1, p2State: snapP2 } }; n[viewingSnap] = recalcSnap(s); setSnapshots(n); } }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}>
                          {Object.keys(allTaxDB).sort().map(y => <option key={y} value={y}>{y}</option>)}
                        </select></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Filing Status</label>
                        <select value={snapFiling} onChange={e => { upSnap("fil", e.target.value); const n = [...snapshots]; const s = { ...n[viewingSnap] }; if (s.fullState) s.fullState = { ...s.fullState, fil: e.target.value }; n[viewingSnap] = recalcSnap(s); setSnapshots(n); }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}>
                          <option value="mfj">Married Filing Jointly</option><option value="single">Single</option>
                        </select></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} State</label>
                        <input list="snap-tax-states" value={snapP1.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; updateSnapTax("p1State", { ...snapP1, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa", boxSizing: "border-box" }} /><datalist id="snap-tax-states">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} State</label>
                        <input list="snap-tax-states-2" value={snapP2.name || ""} onChange={e => { const abbr = STATE_ABBR[e.target.value]; const payroll = abbr ? STATE_PAYROLL[abbr] : undefined; updateSnapTax("p2State", { ...snapP2, name: e.target.value, ...(abbr ? { abbr } : {}), ...(payroll !== undefined ? { famli: payroll } : {}) }); }} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa", boxSizing: "border-box" }} /><datalist id="snap-tax-states-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
                    </div>
                  </Card>
                  {/* Per-person tax breakdown */}
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Tax Breakdown — {effectiveTaxYr}</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "6px 0", borderBottom: "2px solid var(--bdr2, #d0cdc8)", fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase" }}>
                      <span>Tax</span><span style={{ textAlign: "right" }}>{p1Name}</span><span style={{ textAlign: "right" }}>{p2Name}</span><span style={{ textAlign: "right" }}>Total</span>
                    </div>
                    {[
                      ["Gross Salary", p1Sal, p2Sal, p1Sal + p2Sal, "var(--tx, #333)"],
                      ["Federal Income Tax", -fedTaxP1, -fedTaxP2, -fedTax, "var(--c-fedtax, #1a5276)"],
                      [`OASDI (${p2(eTD.ssRate)})`, -p1SS, -p2SS, -(p1SS + p2SS), "var(--c-fedtax, #1a5276)"],
                      [`Medicare (${p2(eTD.medRate)})`, -p1Mc, -p2Mc, -(p1Mc + p2Mc), "var(--c-fedtax, #1a5276)"],
                      [`${snapP1.abbr || "ST"} State Tax`, -p1St, -p2St, -(p1St + p2St), "var(--c-sttax, #8B4513)"],
                      ["State Payroll", -p1FL, -p2FL, -(p1FL + p2FL), "var(--c-sttax, #8B4513)"],
                    ].map(([label, v1, v2, vt, color]) => (
                      <div key={label} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "5px 0", alignItems: "center", fontSize: 12 }}>
                        <span style={{ color }}>{label}</span>
                        <span style={{ textAlign: "right", color }}>{fmt(v1)}</span>
                        <span style={{ textAlign: "right", color }}>{fmt(v2)}</span>
                        <span style={{ textAlign: "right", color, fontWeight: 600 }}>{fmt(vt)}</span>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "8px 0", alignItems: "center", fontSize: 12, borderTop: "2px solid var(--bdr2, #d0cdc8)", fontWeight: 700 }}>
                      <span style={{ color: "var(--c-totaltax, #E8573A)" }}>Total Taxes</span>
                      <span style={{ textAlign: "right", color: "var(--c-totaltax, #E8573A)" }}>{fmt(-p1Total)}</span>
                      <span style={{ textAlign: "right", color: "var(--c-totaltax, #E8573A)" }}>{fmt(-p2Total)}</span>
                      <span style={{ textAlign: "right", color: "var(--c-totaltax, #E8573A)" }}>{fmt(-grandTotal)}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "5px 0", alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: "var(--tx3, #999)" }}>Effective Rate</span>
                      <span style={{ textAlign: "right", color: "var(--tx3, #999)" }}>{p1EffRate}%</span>
                      <span style={{ textAlign: "right", color: "var(--tx3, #999)" }}>{p2EffRate}%</span>
                      <span style={{ textAlign: "right", color: "var(--tx3, #999)", fontWeight: 600 }}>{(p1Sal + p2Sal) > 0 ? (grandTotal / (p1Sal + p2Sal) * 100).toFixed(1) : "0.0"}%</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 4, padding: "5px 0", alignItems: "center", fontSize: 12, fontWeight: 700, color: "#4ECDC4" }}>
                      <span>Net After Tax</span>
                      <span style={{ textAlign: "right" }}>{fmt(p1Sal - p1Total)}</span>
                      <span style={{ textAlign: "right" }}>{fmt(p2Sal - p2Total)}</span>
                      <span style={{ textAlign: "right" }}>{fmt(p1Sal + p2Sal - grandTotal)}</span>
                    </div>
                    <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--input-bg, #f4f4f4)", borderRadius: 8, fontSize: 11, color: "var(--tx2, #555)" }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Rate Details ({effectiveTaxYr})</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                        <div>Std Ded ({snapFiling === "mfj" ? "MFJ" : "Single"}): <strong>{fmt(eSd)}</strong></div>
                        <div>Fed Marginal: <strong>{fp(getMarg(Math.max(0, combTax - eSd), eBr))}</strong></div>
                        <div>SS Cap: <strong>{fmt(eTD.ssCap)}</strong></div>
                        <div>401k Limit: <strong>{fmt(eTD.k401Lim)}</strong></div>
                        <div>{p1Name} ({snapP1.abbr || "ST"}) Payroll: <strong>{p2(snapP1.famli || 0)}</strong></div>
                        <div>{p2Name} ({snapP2.abbr || "ST"}) Payroll: <strong>{p2(snapP2.famli || 0)}</strong></div>
                      </div>
                    </div>
                  </Card>
                  <Card>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Employer Match Tiers</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 8 }}>{p1Name} Match</div>
                        <div style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 4 }}>Base: {snapTax.cMatchBase || 0}%</div>
                        {(snapTax.cMatchTiers || []).map((t, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 2 }}>Up to {t.upTo}% → {(t.rate * 100).toFixed(0)}% match</div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 8 }}>{p2Name} Match</div>
                        <div style={{ fontSize: 11, color: "var(--tx2, #555)", marginBottom: 4 }}>Base: {snapTax.kMatchBase || 0}%</div>
                        {(snapTax.kMatchTiers || []).map((t, i) => (
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

import { PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card } from "../components/ui.jsx";
import { evalF, fmt } from "../utils/calc.js";

export default function ChartsTab({ mob, C, p1Name, p2Name, tax, snapshots, setSnapshots, snapDate, setSnapDate, snapLabel, setSnapLabel, cSal, kSal, cEaip, kEaip, fil, preDed, postDed, c4pre, c4ro, k4pre, k4ro, exp, sav, cats, ewk, savSorted, tNW, tDW, tExpW, tSavW, remW, totalSavPlusRemW, savRateBase, setSavRateBase, includeEaip, setIncludeEaip, chartWeeks, setChartWeeks, catTot, typTot, PieTooltip, dragWrapRender, chartOrder, necDisMode, setNecDisMode, catHistMode, setCatHistMode, itemHistMode, setItemHistMode, catHistoryName, setCatHistoryName, itemHistoryName, setItemHistoryName, snapHistView, setSnapHistView, snapHistYear, setSnapHistYear, setViewingSnap, setTab, restoreConfirm, setRestoreConfirm, restoreFullState, st, restoreLiveState }) {
  return (
    <div>
            <Card style={{ marginBottom: 20, overflow: "hidden" }}>
              <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Save Budget Snapshot</h3>
              <div style={{ display: "flex", gap: 8, alignItems: mob ? "stretch" : "flex-end", flexDirection: mob ? "column" : "row", flexWrap: mob ? "nowrap" : "wrap" }}>
                <div style={{ flex: mob ? "none" : "0 0 auto", width: mob ? "100%" : 150 }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Date</label>
                  <input type="date" value={snapDate || new Date().toISOString().slice(0, 10)} onChange={e => setSnapDate(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: "8px 6px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", boxSizing: "border-box", maxWidth: "100%" }} /></div>
                <div style={{ flex: mob ? "none" : "1 1 120px", minWidth: 0, width: mob ? "100%" : "auto" }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Label</label>
                  <input value={snapLabel} onChange={e => setSnapLabel(e.target.value)} placeholder="What changed?" style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", boxSizing: "border-box" }} /></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => {
                  // Build per-item snapshot data
                  const itemSnaps = {};
                  ewk.forEach(e => { itemSnaps[e.n] = { v: Math.round(e.wk * 48 * 100) / 100, t: e.t, c: e.c, f: e.f || "" }; });
                  savSorted.forEach(s => { itemSnaps[s.n] = { v: Math.round(s.wk * 48 * 100) / 100, t: "S", f: s.f || "" }; });
                  setSnapshots(prev => [...prev, {
                    id: Date.now(), date: snapDate || new Date().toISOString().slice(0, 10), label: snapLabel || "Snapshot",
                    grossW: C.cw + C.kw, netW: C.net, necW: tNW, disW: tDW, expW: tExpW, savW: tSavW,
                    remW, savRate: C.net > 0 ? (totalSavPlusRemW / C.net * 100) : 0,
                    savRateGross: (C.cw + C.kw) > 0 ? (totalSavPlusRemW / (C.cw + C.kw) * 100) : 0,
                    cNetW: C.cNet, kNetW: C.kNet, cGrossW: C.cw, kGrossW: C.kw,
                    cSalary: evalF(cSal), kSalary: evalF(kSal), fil, p1State: tax.p1State, p2State: tax.p2State,
                    eaipNet: C.eaipNet, eaipGross: C.eaipGross, cEaipNet: C.cEaipNet, kEaipNet: C.kEaipNet,
                    cEaipPct: evalF(cEaip), kEaipPct: evalF(kEaip),
                    items: itemSnaps,
                    fullState: { cSal, kSal, fil, cEaip, kEaip, preDed, postDed, c4pre, c4ro, k4pre, k4ro, exp, sav, cats, tax },
                  }]);
                  setSnapLabel(""); setSnapDate("");
                }} style={{ padding: "9px 20px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📸 Save</button>
                <label style={{ padding: "9px 16px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📥 Import<input type="file" accept=".json" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { const d = JSON.parse(ev.target.result); const msgs = []; if (d.liveState) { restoreLiveState(d.liveState); msgs.push("Live state restored"); } const incoming = d.snapshots || (Array.isArray(d) ? d : null); if (incoming && Array.isArray(incoming)) { setSnapshots(prev => { const byId = new Map(prev.map(s => [s.id, s])); let updated = 0, added = 0; for (const s of incoming) { if (byId.has(s.id)) { byId.set(s.id, { ...byId.get(s.id), ...s }); updated++; } else { byId.set(s.id, s); added++; } } msgs.push(`${added} new snapshots, ${updated} updated`); return Array.from(byId.values()).sort((a, b) => (a.date || "").localeCompare(b.date || "")); }); } if (msgs.length === 0) msgs.push("No data found to import"); setTimeout(() => alert(msgs.join("\n")), 100); } catch(err) { alert("Invalid JSON: " + err.message); } }; r.readAsText(f); e.target.value = ""; }} /></label>
                <button onClick={() => { const data = { liveState: { ...st, snapshots: undefined }, snapshots }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `budget-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); }} style={{ padding: "9px 16px", background: "#F2A93B", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📤 Export</button>
                </div>
              </div>
            </Card>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999" }}>Show as % of:</span>
              <button onClick={() => setSavRateBase("net")} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: savRateBase === "net" ? "2px solid #4ECDC4" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: savRateBase === "net" ? "#E8F8F5" : "var(--input-bg, #fafafa)", color: savRateBase === "net" ? "#4ECDC4" : "#888", cursor: "pointer" }}>Net Income</button>
              <button onClick={() => setSavRateBase("gross")} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: savRateBase === "gross" ? "2px solid #F2A93B" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: savRateBase === "gross" ? "#FEF5E7" : "var(--input-bg, #fafafa)", color: savRateBase === "gross" ? "#F2A93B" : "#888", cursor: "pointer" }}>Gross Income</button>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999", marginLeft: 8 }}>Bonus:</span>
              <button onClick={() => setIncludeEaip(p => !p)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: includeEaip ? "2px solid #9B59B6" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: includeEaip ? "#F3E8FF" : "var(--input-bg, #fafafa)", color: includeEaip ? "#9B59B6" : "#888", cursor: "pointer" }}>
                {includeEaip ? "Included" : "Excluded"}
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999", marginLeft: 8 }}>Weeks:</span>
              <button onClick={() => setChartWeeks(48)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: chartWeeks === 48 ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: chartWeeks === 48 ? "#EEF1FA" : "var(--input-bg, #fafafa)", color: chartWeeks === 48 ? "#556FB5" : "#888", cursor: "pointer" }}>48 wk</button>
              <button onClick={() => setChartWeeks(52)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: chartWeeks === 52 ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: chartWeeks === 52 ? "#EEF1FA" : "var(--input-bg, #fafafa)", color: chartWeeks === 52 ? "#556FB5" : "#888", cursor: "pointer" }}>52 wk</button>
            </div>

            {(() => {
              const livePoint = { date: "Now", label: "Current", grossW: C.cw + C.kw, netW: C.net, necW: tNW, disW: tDW, expW: tExpW, savW: tSavW, remW, cNetW: C.cNet, kNetW: C.kNet, cGrossW: C.cw, kGrossW: C.kw, eaipNet: C.eaipNet, eaipGross: C.eaipGross, cEaipNet: C.cEaipNet, kEaipNet: C.kEaipNet };
              const allPoints = [...snapshots, livePoint];
              const sorted = allPoints.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
              const curEaipNet = C.eaipNet, curEaipGross = C.eaipGross;
              const curCEaipNet = C.cEaipNet, curKEaipNet = C.kEaipNet;
              const p1NetKey = `${p1Name} Net`, p2NetKey = `${p2Name} Net`;
              const p1GrossKey = `${p1Name} Gross`, p2GrossKey = `${p2Name} Gross`;
              const trendData = sorted.map(s => {
                const snapEaipNet = s.eaipNet !== undefined ? s.eaipNet : curEaipNet;
                const snapEaipGross = s.eaipGross !== undefined ? s.eaipGross : curEaipGross;
                const eaip = includeEaip ? snapEaipNet : 0;
                const eaipG = includeEaip ? snapEaipGross : 0;
                const cw = chartWeeks; // 48 or 52
                const netInc = (s.netW || 0) * cw + eaip;
                const grossInc = (s.grossW || 0) * cw + eaipG;
                const expAnn = Math.round((s.expW || 0) * 48);
                const savAnn = Math.round((s.savW || 0) * 48);
                const necAnn = Math.round((s.necW || 0) * 48);
                const disAnn = Math.round((s.disW || 0) * 48);
                const notBudgeted = Math.max(0, Math.round(netInc) - expAnn - savAnn);
                const snapCEaip = s.cEaipNet !== undefined ? s.cEaipNet : curCEaipNet;
                const snapKEaip = s.kEaipNet !== undefined ? s.kEaipNet : curKEaipNet;
                const snapCEaipG = s.eaipGross !== undefined ? ((s.cEaipNet || 0) + ((s.eaipGross || 0) - (s.eaipNet || 0)) * ((s.cEaipNet || 0) / Math.max(s.eaipNet || 1, 1))) : 0;
                // Per-person gross bonus: derive from snapshot data
                const cGrossBonus = includeEaip ? (s.cEaipPct !== undefined ? (s.cSalary || (s.cGrossW || 0) * 52) * (s.cEaipPct / 100) : (curCEaipNet > 0 ? C.cEaipGross : 0)) : 0;
                const kGrossBonus = includeEaip ? (s.kEaipPct !== undefined ? (s.kSalary || (s.kGrossW || 0) * 52) * (s.kEaipPct / 100) : (curKEaipNet > 0 ? C.kEaipGross : 0)) : 0;
                return {
                  date: s.date, label: s.label,
                  Expenses: expAnn,
                  Necessity: necAnn,
                  Discretionary: disAnn,
                  Savings: savAnn,
                  "Not Budgeted": notBudgeted,
                  "Net Salary": Math.round(netInc),
                  [p1NetKey]: Math.round(((s.cNetW || 0) * cw) + (includeEaip ? snapCEaip : 0)),
                  [p2NetKey]: Math.round(((s.kNetW || 0) * cw) + (includeEaip ? snapKEaip : 0)),
                  "Gross Salary": Math.round(grossInc),
                  [p1GrossKey]: Math.round((s.cGrossW || 0) * cw + cGrossBonus),
                  [p2GrossKey]: Math.round((s.kGrossW || 0) * cw + kGrossBonus),
                };
              });
              const cs = { borderRadius: 10, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,.1)" };
              const hasPerPerson = sorted.some(s => (s.cNetW && s.kNetW) || (s.cGrossW && s.kGrossW));
              const modeBtn = (cur, val, label, color, setter) => <button onClick={() => setter(val)} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 600, border: cur === val ? `2px solid ${color}` : "2px solid var(--bdr, #ddd)", borderRadius: 6, background: cur === val ? (color === "#556FB5" ? "#EEF1FA" : color + "22") : "transparent", color: cur === val ? color : "var(--tx3, #888)", cursor: "pointer" }}>{label}</button>;
              const xTF = v => v === "Now" ? "Now" : String(v).slice(0, 4);
              const CAT_COLORS_H = ["#E8573A", "#F2A93B", "#4ECDC4", "#556FB5", "#9B59B6", "#1ABC9C", "#E67E22", "#2ECC71", "#95A5A6", "#D35400", "#C0392B", "#3498DB", "#8E44AD", "#27AE60", "#F39C12", "#16A085"];
              const histMode = catHistMode, histView = itemHistMode, isCat = histView === "category";
              const allCatsH = new Set(); snapshots.forEach(sn => { if (sn.items) Object.values(sn.items).forEach(d => { if (d.c && d.t !== "S") allCatsH.add(d.c); }); }); ewk.forEach(e => { if (e.c) allCatsH.add(e.c); });
              const catListH = [...allCatsH].sort();
              const allNamesH = new Set(); snapshots.forEach(sn => { if (sn.items) Object.keys(sn.items).forEach(k => allNamesH.add(k)); }); ewk.forEach(e => allNamesH.add(e.n)); savSorted.forEach(sv => allNamesH.add(sv.n));
              const namesH = [...allNamesH].sort();
              const selCat = catHistoryName || catListH[0] || "", selItem = itemHistoryName || namesH[0] || "";
              const ccMap = {}; catListH.forEach((c, i) => { ccMap[c] = CAT_COLORS_H[i % CAT_COLORS_H.length]; });
              const icMap = {}; namesH.forEach((n, i) => { icMap[n] = CAT_COLORS_H[i % CAT_COLORS_H.length]; });
              const sortedH = [...snapshots].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
              const hPts = [...sortedH, { date: "Now", label: "Current", _current: true }];
              const sCatD = hPts.map(sn => { const row = { date: sn.date, label: sn.label }; if (sn._current) { catListH.forEach(c => { row[c] = Math.round(ewk.filter(e => e.c === c).reduce((sm, e) => sm + e.wk * chartWeeks, 0)); }); row._incLine = Math.round(savRateBase === "gross" ? (C.cw + C.kw) * chartWeeks + (includeEaip ? C.eaipGross : 0) : C.net * chartWeeks + (includeEaip ? C.eaipNet : 0)); } else { catListH.forEach(c => { let tot = 0; if (sn.items) Object.values(sn.items).forEach(d => { if (d.c === c && d.t !== "S") tot += d.v || 0; }); row[c] = Math.round(tot); }); const snapEaipN = sn.eaipNet !== undefined ? sn.eaipNet : curEaipNet; const snapEaipG = sn.eaipGross !== undefined ? sn.eaipGross : curEaipGross; row._incLine = Math.round(savRateBase === "gross" ? (sn.grossW || 0) * chartWeeks + (includeEaip ? snapEaipG : 0) : (sn.netW || 0) * chartWeeks + (includeEaip ? snapEaipN : 0)); } return row; });
              const lcp = sCatD[sCatD.length - 1] || {}; const clSorted = [...catListH].sort((a, b) => (lcp[b] || 0) - (lcp[a] || 0));
              const sItemD = hPts.map(sn => { const row = { date: sn.date, label: sn.label }; if (sn._current) { namesH.forEach(n => { const ex = ewk.find(x => x.n === n); const sv = savSorted.find(x => x.n === n); row[n] = Math.round((ex ? ex.wk * chartWeeks : sv ? sv.wk * chartWeeks : 0) * 100) / 100; }); row._incLine = Math.round(savRateBase === "gross" ? (C.cw + C.kw) * chartWeeks + (includeEaip ? C.eaipGross : 0) : C.net * chartWeeks + (includeEaip ? C.eaipNet : 0)); } else { namesH.forEach(n => { row[n] = sn.items?.[n]?.v || 0; }); const snapEaipN = sn.eaipNet !== undefined ? sn.eaipNet : curEaipNet; const snapEaipG = sn.eaipGross !== undefined ? sn.eaipGross : curEaipGross; row._incLine = Math.round(savRateBase === "gross" ? (sn.grossW || 0) * chartWeeks + (includeEaip ? snapEaipG : 0) : (sn.netW || 0) * chartWeeks + (includeEaip ? snapEaipN : 0)); } return row; });
              const lip = sItemD[sItemD.length - 1] || {}; const nlSorted = [...namesH].sort((a, b) => (lip[b] || 0) - (lip[a] || 0)).slice(0, 12);
              const curCatT = ewk.filter(e => e.c === selCat).reduce((sm, e) => sm + e.wk * chartWeeks, 0);
              const catLD = hPts.map(sn => { if (sn._current) return { date: "Now", label: "Current", value: Math.round(curCatT) }; let tot = 0; if (sn.items) Object.values(sn.items).forEach(d => { if (d.c === selCat && d.t !== "S") tot += d.v || 0; }); return { date: sn.date, label: sn.label, value: Math.round(tot) }; });
              const curItemV = (() => { const ex = ewk.find(x => x.n === selItem); const sv = savSorted.find(x => x.n === selItem); return ex ? ex.wk * chartWeeks : sv ? sv.wk * chartWeeks : 0; })();
              const itemLD = hPts.map(sn => { if (sn._current) return { date: "Now", label: "Current", value: Math.round(curItemV * 100) / 100 }; return { date: sn.date, label: sn.label, value: sn.items?.[selItem]?.v || 0 }; });
              const chartComponents = {
                pieCategory: dragWrapRender("pieCategory", <Card key={`pc-${chartWeeks}-${includeEaip}-${savRateBase}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>By Category <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>(% of {savRateBase} income, {chartWeeks}wk)</span></h3><div style={{ width: "100%", minHeight: 280 }}><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={catTot} cx="50%" cy="50%" outerRadius={95} innerRadius={48} paddingAngle={2} dataKey="value" stroke="none">{catTot.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<PieTooltip />} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></Card>),
                pieNecDis: dragWrapRender("pieNecDis", <Card key={`pnd-${chartWeeks}-${includeEaip}-${savRateBase}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Necessity vs Discretionary <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(% of {savRateBase} income, {chartWeeks}wk)</span></h3><div style={{ width: "100%", minHeight: 280 }}><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={typTot} cx="50%" cy="50%" outerRadius={95} innerRadius={48} paddingAngle={3} dataKey="value" stroke="none">{typTot.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<PieTooltip />} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></Card>),
                budgetVsSalary: dragWrapRender("budgetVsSalary", <Card key={`bvs-${chartWeeks}-${includeEaip}-${savRateBase}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Budget vs {savRateBase === "gross" ? "Gross" : "Net"} Salary <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({chartWeeks}wk)</span></h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><AreaChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area type="monotone" dataKey="Expenses" stackId="1" stroke="#E8573A" fill="#E8573A" fillOpacity={0.6} /><Area type="monotone" dataKey="Savings" stackId="1" stroke="#2ECC71" fill="#2ECC71" fillOpacity={0.6} /><Area type="monotone" dataKey="Not Budgeted" stackId="1" stroke="#95A5A6" fill="#95A5A6" fillOpacity={0.3} /><Line type="monotone" dataKey={savRateBase === "gross" ? "Gross Salary" : "Net Salary"} stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={savRateBase === "gross" ? "Gross Salary" : "Net Salary"} /></AreaChart></ResponsiveContainer></div></Card>),
                necVsDis: dragWrapRender("necVsDis", <Card key={`nvd-${chartWeeks}-${includeEaip}-${savRateBase}-${necDisMode}`}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Necessity vs Discretionary <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({chartWeeks}wk)</span></h3>{modeBtn(necDisMode, "line", "Line", "#556FB5", setNecDisMode)}{modeBtn(necDisMode, "stacked", "Stacked", "#E8573A", setNecDisMode)}</div><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}>{necDisMode === "stacked" ? (<AreaChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area type="monotone" dataKey="Necessity" stackId="1" stroke="#556FB5" fill="#556FB5" fillOpacity={0.6} /><Area type="monotone" dataKey="Discretionary" stackId="1" stroke="#E8573A" fill="#E8573A" fillOpacity={0.6} /><Area type="monotone" dataKey="Savings" stackId="1" stroke="#2ECC71" fill="#2ECC71" fillOpacity={0.6} /><Area type="monotone" dataKey="Not Budgeted" stackId="1" stroke="#95A5A6" fill="#95A5A6" fillOpacity={0.3} /></AreaChart>) : (<LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Necessity" stroke="#556FB5" strokeWidth={2.5} dot={{ r: 4, fill: "#556FB5" }} /><Line type="monotone" dataKey="Discretionary" stroke="#E8573A" strokeWidth={2.5} dot={{ r: 4, fill: "#E8573A" }} /><Line type="monotone" dataKey="Savings" stroke="#2ECC71" strokeWidth={2} dot={{ r: 3, fill: "#2ECC71" }} /><Line type="monotone" dataKey="Not Budgeted" stroke="#95A5A6" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: "#95A5A6" }} /></LineChart>)}</ResponsiveContainer></div></Card>),
                netSalary: dragWrapRender("netSalary", <Card key={`ns-${chartWeeks}-${includeEaip}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Net Salary ({chartWeeks}wk){includeEaip && <span style={{ fontSize: 12, fontWeight: 500, color: "#9B59B6" }}> + Bonus</span>}</h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Net Salary" stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={includeEaip ? "Net Salary + Bonus" : "Net Salary"} />{hasPerPerson && <Line type="monotone" dataKey={p1NetKey} stroke="#556FB5" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#556FB5" }} />}{hasPerPerson && <Line type="monotone" dataKey={p2NetKey} stroke="#E8573A" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#E8573A" }} />}</LineChart></ResponsiveContainer></div></Card>),
                grossSalary: dragWrapRender("grossSalary", <Card key={`gs-${chartWeeks}-${includeEaip}`}><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Gross Salary ({chartWeeks}wk){includeEaip && <span style={{ fontSize: 12, fontWeight: 500, color: "#9B59B6" }}> + Bonus</span>}</h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Gross Salary" stroke="#F2A93B" strokeWidth={2.5} dot={{ r: 4, fill: "#F2A93B" }} name={includeEaip ? "Gross + Bonus" : "Gross Salary"} />{hasPerPerson && <Line type="monotone" dataKey={p1GrossKey} stroke="#556FB5" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#556FB5" }} />}{hasPerPerson && <Line type="monotone" dataKey={p2GrossKey} stroke="#E8573A" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#E8573A" }} />}</LineChart></ResponsiveContainer></div></Card>),
                budgetHistory: snapshots.length > 1 ? dragWrapRender("budgetHistory", <Card key={`bh-${chartWeeks}-${includeEaip}-${savRateBase}`}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}><h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Budget History <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>({chartWeeks}wk)</span></h3>{modeBtn(histView, "category", "Category", "#556FB5", setItemHistMode)}{modeBtn(histView, "item", "Item", "#E67E22", setItemHistMode)}<span style={{ width: 1, height: 20, background: "var(--bdr, #ddd)" }} />{modeBtn(histMode, "line", "Line", "#4ECDC4", setCatHistMode)}{modeBtn(histMode, "stacked", "Stacked", "#E8573A", setCatHistMode)}{histMode === "line" && isCat && <select value={selCat} onChange={e => setCatHistoryName(e.target.value)} style={{ border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)" }}>{catListH.map(c => <option key={c} value={c}>{c}</option>)}</select>}{histMode === "line" && !isCat && <select value={selItem} onChange={e => setItemHistoryName(e.target.value)} style={{ border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)" }}>{namesH.map(n => <option key={n} value={n}>{n}</option>)}</select>}</div><div style={{ width: "100%", minHeight: 300 }}><ResponsiveContainer width="100%" height={300}>{histMode === "stacked" ? (isCat ? (<AreaChart data={sCatD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 9 }} />{clSorted.map(c => <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={ccMap[c]} fill={ccMap[c]} fillOpacity={0.6} />)}<Line type="monotone" dataKey="_incLine" stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={savRateBase === "gross" ? "Gross Income" : "Net Income"} /></AreaChart>) : (<AreaChart data={sItemD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 9 }} />{nlSorted.map(n => <Area key={n} type="monotone" dataKey={n} stackId="1" stroke={icMap[n]} fill={icMap[n]} fillOpacity={0.6} />)}<Line type="monotone" dataKey="_incLine" stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={savRateBase === "gross" ? "Gross Income" : "Net Income"} /></AreaChart>)) : (isCat ? (<LineChart data={catLD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Line type="monotone" dataKey="value" stroke={ccMap[selCat] || "#556FB5"} strokeWidth={2.5} dot={{ r: 4, fill: ccMap[selCat] || "#556FB5" }} name={selCat} /></LineChart>) : (<LineChart data={itemLD}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={xTF} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Line type="monotone" dataKey="value" stroke="#556FB5" strokeWidth={2.5} dot={{ r: 4, fill: "#556FB5" }} name={selItem} /></LineChart>))}</ResponsiveContainer></div></Card>, true) : null,
              };
              const validOrder = chartOrder.filter(k => chartComponents[k] !== undefined);
              Object.keys(chartComponents).forEach(k => { if (!validOrder.includes(k)) validOrder.push(k); });
              return (
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
                  {validOrder.filter(k => chartComponents[k]).map(k => chartComponents[k])}
                </div>
              );
            })()}

            {snapshots.length > 0 && (
              <Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Snapshot History</h3>
                  <button onClick={() => setSnapHistView(p => p === "years" ? "all" : "years")} style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, border: "2px solid #556FB5", borderRadius: 6, background: snapHistView === "all" ? "#EEF1FA" : "transparent", color: "#556FB5", cursor: "pointer" }}>
                    {snapHistView === "years" ? "Show All" : "Group by Year"}
                  </button>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "100px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, fontSize: 9, fontWeight: 700, color: "#999", marginBottom: 6, minWidth: 850 }}>
                    <span>Date</span><span>Label</span><span style={{ textAlign: "right" }}>Net Income</span><span style={{ textAlign: "right" }}>Expenses</span><span style={{ textAlign: "right" }}>Savings</span><span style={{ textAlign: "right" }}>Bonus</span><span style={{ textAlign: "right" }}>Sav. Rate</span><span style={{ textAlign: "right" }}>Remaining</span><span />
                  </div>
                  {(() => {
                    const sorted = [...snapshots].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                    // Group by year
                    const years = {};
                    sorted.forEach(s => { const yr = (s.date || "").slice(0, 4) || "Unknown"; if (!years[yr]) years[yr] = []; years[yr].push(s); });
                    const yearKeys = Object.keys(years).sort((a, b) => b.localeCompare(a));
                    // Auto-select first year if none selected
                    const activeYear = snapHistYear || yearKeys[0];
                    const renderRow = (s) => {
                      const ri = snapshots.findIndex(x => x.id === s.id);
                      const dateStr = s.date || "";
                      const dateObj = dateStr ? new Date(dateStr + "T00:00:00") : null;
                      const formattedDate = dateObj ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : dateStr;
                      return (
                        <div key={s.id} style={{ display: "grid", gridTemplateColumns: "100px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, padding: "6px 0", alignItems: "center", borderTop: "1px solid var(--bdr,#f0f0f0)", fontSize: 11, minWidth: 850 }}>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tx, #333)" }}>{formattedDate}</span>
                            <input type="date" value={s.date} onChange={e => { const n = [...snapshots]; n[ri] = { ...n[ri], date: e.target.value }; setSnapshots(n); }} style={{ fontSize: 9, border: "1px solid var(--bdr,#e0e0e0)", borderRadius: 4, padding: "1px 3px", color: "var(--tx3,#888)", background: "transparent", marginTop: 2 }} />
                          </div>
                          <input value={s.label} onChange={e => { const n = [...snapshots]; n[ri] = { ...n[ri], label: e.target.value }; setSnapshots(n); }} style={{ fontSize: 11, fontWeight: 600, border: "1px solid var(--bdr,#e0e0e0)", borderRadius: 4, padding: "2px 4px", color: "var(--tx,#333)", background: "transparent" }} />
                          <span style={{ textAlign: "right", color: "#4ECDC4" }}>{fmt((s.netW || 0) * 48)}</span>
                          <span style={{ textAlign: "right", color: "#E8573A" }}>{fmt((s.expW || 0) * 48)}</span>
                          <span style={{ textAlign: "right", color: "#2ECC71" }}>{fmt((s.savW || 0) * 48)}</span>
                          <span style={{ textAlign: "right", color: "#9B59B6" }}>{fmt(s.eaipNet || 0)}</span>
                          <span style={{ textAlign: "right", color: "#556FB5" }}>{(s.savRate || 0).toFixed(1)}%</span>
                          <span style={{ textAlign: "right", color: (s.remW || 0) >= 0 ? "#2ECC71" : "#E74C3C" }}>{fmt((s.remW || 0) * 48)}</span>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                            <button onClick={() => { setViewingSnap(ri); setTab("budget"); }} style={{ padding: "3px 8px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>View</button>
                            {(s.fullState || s.items) && <button onClick={() => setRestoreConfirm(ri)} style={{ padding: "3px 6px", background: "none", border: "1px solid #F2A93B", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", color: "#F2A93B" }} title={s.fullState ? "Full restore" : "Restores items only"}>↩</button>}
                            <button onClick={() => setSnapshots(snapshots.filter((_, j) => j !== ri))} style={{ padding: "3px 6px", background: "none", border: "1px solid var(--input-border, #ddd)", borderRadius: 4, fontSize: 10, cursor: "pointer", color: "#ccc" }}>×</button>
                          </div>
                        </div>
                      );
                    };
                    if (snapHistView === "all") {
                      return sorted.map(renderRow);
                    }
                    return yearKeys.map(yr => (
                      <div key={yr}>
                        <div onClick={() => setSnapHistYear(p => p === yr ? null : yr)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer", borderTop: "2px solid var(--bdr2, #d0cdc8)", userSelect: "none" }}>
                          <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Fraunces',serif", color: "var(--tx, #333)" }}>{yr}</span>
                          <span style={{ fontSize: 11, color: "var(--tx3, #999)" }}>({years[yr].length} snapshot{years[yr].length !== 1 ? "s" : ""})</span>
                          <span style={{ fontSize: 12, color: "var(--tx3, #999)", marginLeft: "auto" }}>{activeYear === yr ? "▾" : "▸"}</span>
                        </div>
                        {activeYear === yr && years[yr].map(renderRow)}
                      </div>
                    ));
                  })()}
                </div>
              </Card>
            )}

            {restoreConfirm !== null && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setRestoreConfirm(null)}>
                <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 32, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                  <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800 }}>Restore Snapshot?</h3>
                  <p style={{ fontSize: 14, color: "var(--tx2,#555)", margin: "0 0 8px" }}>This will replace your <strong>entire current budget</strong> with:</p>
                  <div style={{ padding: "10px 14px", background: "var(--input-bg, #f8f8f8)", borderRadius: 8, marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, color: "var(--tx,#333)" }}>{snapshots[restoreConfirm]?.label}</div>
                    <div style={{ fontSize: 12, color: "var(--tx3,#888)" }}>{snapshots[restoreConfirm]?.date}</div>
                  </div>
                  <p style={{ fontSize: 13, color: "#E8573A", margin: "0 0 20px" }}>Consider saving a snapshot of your current budget first.</p>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={() => setRestoreConfirm(null)} style={{ padding: "9px 20px", border: "2px solid var(--bdr, #ddd)", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                    <button onClick={() => {
                      restoreFullState(restoreConfirm);
                      setRestoreConfirm(null); setTab("budget");
                    }} style={{ padding: "9px 20px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Restore</button>
                  </div>
                </div>
              </div>
            )}

            {snapshots.length === 0 && <Card style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 14, color: "#999" }}>No snapshots yet. Save your first above to start tracking trends.</div></Card>}
    </div>
  );
}

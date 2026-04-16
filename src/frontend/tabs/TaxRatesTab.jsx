import { Card, NI } from "../components/ui.jsx";
import { fmt, fp, p2 } from "../utils/calc.js";
import { DEF_TAX, STATE_ABBR, STATE_BRACKETS } from "../data/taxDB.js";

function StateBrView({ abbr, filing, label }) {
  const st = STATE_BRACKETS[abbr];
  if (!st) return null;
  const br = filing === "mfj" ? (st.mfj && st.mfj.length > 0 ? st.mfj : st.single) : st.single;
  if (!br || br.length === 0) return <Card><h3 style={{ margin: "0 0 8px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>{label}</h3><div style={{ fontSize: 12, color: "var(--tx3,#999)" }}>No state income tax</div></Card>;
  const sd = filing === "mfj" ? st.stdMFJ : st.stdSingle;
  return (
    <Card>
      <h3 style={{ margin: "0 0 8px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800 }}>{label}</h3>
      {sd > 0 && <div style={{ fontSize: 11, color: "var(--tx3,#888)", marginBottom: 8 }}>Std Deduction: {fmt(sd)}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate</span></div>
      {br.map((b, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, marginBottom: 2, fontSize: 11, color: "var(--tx2,#555)" }}>
          <span>{fmt(b[0])}</span>
          <span>{b[1] >= 9999999 ? "∞" : fmt(b[1])}</span>
          <span style={{ fontWeight: 600 }}>{(b[2] * 100).toFixed(2)}%</span>
        </div>
      ))}
    </Card>
  );
}

export default function TaxRatesTab({ mob, tax, upTax, upP1State, upP2State, setTax, p1Name, p2Name, fil, C, allTaxDB, loadTaxYear, showTaxPaste, setShowTaxPaste, taxPaste, setTaxPaste, addTaxYear, fetchStatus, setFetchStatus }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20, maxWidth: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
      <Card>
        <h3 style={{ margin: "0 0 4px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Payroll & State Rates</h3>
        <p style={{ fontSize: 12, color: "#999", margin: "0 0 16px" }}>Update when rates change each year.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Tax Year</label><input value={tax.year} onChange={e => upTax("year", e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)", boxSizing: "border-box" }} /></div>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>401(k) Base Limit</label><NI value={tax.k401Lim} onChange={v => upTax("k401Lim", +v || 0)} prefix="$" /></div>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} State</label><input list="state-names" value={(tax.p1State || {}).name || ""} onChange={e => upP1State("name", e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)", boxSizing: "border-box" }} /><datalist id="state-names">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} State</label><input list="state-names-2" value={(tax.p2State || {}).name || ""} onChange={e => upP2State("name", e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)", boxSizing: "border-box" }} /><datalist id="state-names-2">{Object.keys(STATE_ABBR).map(s => <option key={s} value={s} />)}</datalist></div>
          <div style={{ gridColumn: "1/-1", padding: "10px 12px", background: "var(--input-bg, #f4f4f4)", borderRadius: 8, fontSize: 11, color: "var(--tx2, #555)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Calculated Rates ({tax.year})</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <div>{p1Name} ({(tax.p1State || {}).abbr || "ST"}): <strong>{fmt(C.cCO * 52)}/yr</strong> — marginal {(C.cStMR * 100).toFixed(1)}%</div>
              <div>{p2Name} ({(tax.p2State || {}).abbr || "ST"}): <strong>{fmt(C.kCO * 52)}/yr</strong> — marginal {(C.kStMR * 100).toFixed(1)}%</div>
              <div>{p1Name} Payroll Tax: <strong>{p2((tax.p1State || {}).famli || 0)}</strong> ({fmt(C.cFL * 52)}/yr)</div>
              <div>{p2Name} Payroll Tax: <strong>{p2((tax.p2State || {}).famli || 0)}</strong> ({fmt(C.kFL * 52)}/yr)</div>
              <div>OASDI: <strong>{p2(tax.ssRate)}</strong> — SS Cap: <strong>{fmt(tax.ssCap)}</strong></div>
              <div>Medicare: <strong>{p2(tax.medRate)}</strong></div>
              <div>Std Ded (Single): <strong>{fmt(tax.stdSingle)}</strong></div>
              <div>Std Ded (MFJ): <strong>{fmt(tax.stdMFJ)}</strong></div>
              <div>401(k) Limit: <strong>{fmt(tax.k401Lim)}</strong></div>
              <div>HSA Limit: <strong>{fmt(tax.hsaLimit)}</strong></div>
            </div>
          </div>
        </div>
        <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>{p1Name} — Employer Match</h4>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Base: <input type="number" value={tax.cMatchBase || 0} onChange={e => upTax("cMatchBase", +e.target.value || 0)} style={{ width: 40, border: "1px solid var(--input-border, #ddd)", borderRadius: 4, padding: "2px 4px", fontSize: 12, textAlign: "center" }} />%</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>Up to EE %</span><span>Match rate</span><span /></div>
        {(tax.cMatchTiers || []).map((t, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, marginBottom: 2 }}>
            <input type="number" value={t.upTo} onChange={e => { const n = [...(tax.cMatchTiers || [])]; n[i] = { ...n[i], upTo: +e.target.value }; upTax("cMatchTiers", n); }} style={{ border: "1px solid var(--input-border, #ddd)", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
            <input type="number" step="0.1" value={t.rate} onChange={e => { const n = [...(tax.cMatchTiers || [])]; n[i] = { ...n[i], rate: +e.target.value }; upTax("cMatchTiers", n); }} style={{ border: "1px solid var(--input-border, #ddd)", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
            <button onClick={() => upTax("cMatchTiers", (tax.cMatchTiers || []).filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
          </div>
        ))}
        <button onClick={() => upTax("cMatchTiers", [...(tax.cMatchTiers || []), { upTo: 10, rate: 0.5 }])} style={{ marginTop: 4, padding: "4px 12px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Tier</button>

        <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>{p2Name} — Employer Match</h4>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Base: <input type="number" value={tax.kMatchBase || 0} onChange={e => upTax("kMatchBase", +e.target.value || 0)} style={{ width: 40, border: "1px solid var(--input-border, #ddd)", borderRadius: 4, padding: "2px 4px", fontSize: 12, textAlign: "center" }} />%</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>Up to EE %</span><span>Match rate</span><span /></div>
        {(tax.kMatchTiers || []).map((t, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, marginBottom: 2 }}>
            <input type="number" value={t.upTo} onChange={e => { const n = [...(tax.kMatchTiers || [])]; n[i] = { ...n[i], upTo: +e.target.value }; upTax("kMatchTiers", n); }} style={{ border: "1px solid var(--input-border, #ddd)", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
            <input type="number" step="0.1" value={t.rate} onChange={e => { const n = [...(tax.kMatchTiers || [])]; n[i] = { ...n[i], rate: +e.target.value }; upTax("kMatchTiers", n); }} style={{ border: "1px solid var(--input-border, #ddd)", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
            <button onClick={() => upTax("kMatchTiers", (tax.kMatchTiers || []).filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
          </div>
        ))}
        <button onClick={() => upTax("kMatchTiers", [...(tax.kMatchTiers || []), { upTo: 10, rate: 0.5 }])} style={{ marginTop: 4, padding: "4px 12px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Tier</button>
        <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>HSA Employer Match</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Employer Annual Match</label><NI value={tax.hsaEmployerMatch} onChange={v => upTax("hsaEmployerMatch", +v || 0)} prefix="$" /></div>
        </div>
        <div style={{ marginTop: 20, padding: 16, background: "var(--input-bg, #f8f8f8)", borderRadius: 10 }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>Load Tax Year</h4>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <select value={tax.year} onChange={e => loadTaxYear(e.target.value)} style={{ border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", cursor: "pointer", minWidth: 90 }}>
              {Object.keys(allTaxDB).sort((a, b) => b - a).map(yr => <option key={yr} value={yr}>{yr}</option>)}
            </select>
            <button onClick={() => setShowTaxPaste(p => !p)} style={{ padding: "8px 16px", fontSize: 12, border: "none", borderRadius: 8, background: "#556FB5", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              + Add New Year
            </button>
            <button onClick={() => setTax(prev => ({ ...DEF_TAX, year: prev.year, p1State: prev.p1State, p2State: prev.p2State, cMatchTiers: prev.cMatchTiers, cMatchBase: prev.cMatchBase, kMatchTiers: prev.kMatchTiers, kMatchBase: prev.kMatchBase, hsaEmployerMatch: prev.hsaEmployerMatch }))} style={{ padding: "8px 16px", fontSize: 12, border: "2px solid #E8573A", borderRadius: 8, background: "none", color: "#E8573A", fontWeight: 600, cursor: "pointer" }}>Reset {tax.year}</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--tx3, #999)" }}>
            {Object.keys(allTaxDB).length} years available (1996–{Object.keys(allTaxDB).sort((a, b) => b - a)[0]}). State rates are always preserved when switching years.
          </div>
          {showTaxPaste && <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--input-border, #ddd)", borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Add a new tax year</div>
            <div style={{ fontSize: 11, color: "var(--tx3, #999)", marginBottom: 8 }}>
              Paste JSON from Claude. Use the prompt below to get the right format.
            </div>
            <textarea value={taxPaste} onChange={e => setTaxPaste(e.target.value)} placeholder='{"year":"2027","fedSingle":[[0,12500,0.10],...], ...}' rows={5} style={{ width: "100%", border: "1px solid var(--input-border, #ddd)", borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={() => addTaxYear(taxPaste)} disabled={!taxPaste.trim()} style={{ padding: "6px 14px", fontSize: 12, border: "none", borderRadius: 6, background: taxPaste.trim() ? "#2ECC71" : "#ccc", color: "#fff", fontWeight: 700, cursor: taxPaste.trim() ? "pointer" : "default" }}>Add & Load</button>
              <button onClick={() => { setShowTaxPaste(false); setTaxPaste(""); }} style={{ padding: "6px 14px", fontSize: 12, border: "1px solid #ddd", borderRadius: 6, background: "none", color: "#888", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { navigator.clipboard.writeText('Give me the US federal tax rates for tax year [YEAR] formatted exactly like this JSON. Replace ALL values with the correct [YEAR] values, keep the structure, return ONLY the JSON with no markdown or explanation:\n\n{"year":"[YEAR]","fedSingle":[[0,12400,0.10],[12400,50400,0.12],[50400,105700,0.22],[105700,201775,0.24],[201775,256225,0.32],[256225,640600,0.35],[640600,9999999,0.37]],"fedMFJ":[[0,24800,0.10],[24800,100800,0.12],[100800,211400,0.22],[211400,403550,0.24],[403550,512450,0.32],[512450,768700,0.35],[768700,9999999,0.37]],"stdSingle":16100,"stdMFJ":32200,"ssRate":6.2,"ssCap":184500,"medRate":1.45,"k401Lim":24500,"hsaLimit":8300}\n\nFields: fedSingle/fedMFJ = federal income tax brackets [from,to,rate]. stdSingle/stdMFJ = standard deductions. ssRate = OASDI employee rate %. ssCap = Social Security wage cap. medRate = Medicare employee rate %. k401Lim = 401(k) elective deferral limit (not catch-up). hsaLimit = HSA family contribution limit.'); setFetchStatus("📋 Prompt copied! Paste it in a new Claude chat, replace [YEAR], and paste the result back here."); }} style={{ padding: "6px 14px", fontSize: 12, border: "1px solid #556FB5", borderRadius: 6, background: "none", color: "#556FB5", fontWeight: 600, cursor: "pointer" }}>Copy Prompt</button>
            </div>
          </div>}
          {fetchStatus && <div style={{ fontSize: 12, marginTop: 8, color: fetchStatus.startsWith("✅") ? "#2ECC71" : fetchStatus.startsWith("❌") ? "#E8573A" : "#556FB5", wordBreak: "break-word" }}>{fetchStatus}</div>}
        </div>
      </Card>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        <Card><h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Federal — Single / MFS</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate</span></div>
          {tax.fedSingle.map((b, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, marginBottom: 2, fontSize: 11, color: "var(--tx2,#555)" }}><span>{fmt(b[0])}</span><span>{b[1] >= 9999999 ? "∞" : fmt(b[1])}</span><span style={{ fontWeight: 600 }}>{(b[2] * 100).toFixed(2)}%</span></div>))}
        </Card>
        <Card><h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Federal — MFJ</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate</span></div>
          {tax.fedMFJ.map((b, i) => (<div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 3, marginBottom: 2, fontSize: 11, color: "var(--tx2,#555)" }}><span>{fmt(b[0])}</span><span>{b[1] >= 9999999 ? "∞" : fmt(b[1])}</span><span style={{ fontWeight: 600 }}>{(b[2] * 100).toFixed(2)}%</span></div>))}
        </Card>
        {(tax.p1State || {}).abbr && STATE_BRACKETS[(tax.p1State || {}).abbr] && <StateBrView abbr={(tax.p1State).abbr} filing={fil} label={`${(tax.p1State).name || (tax.p1State).abbr} — ${p1Name} (${fil === "mfj" ? "MFJ" : "Single"})`} />}
        {(tax.p2State || {}).abbr && STATE_BRACKETS[(tax.p2State || {}).abbr] && <StateBrView abbr={(tax.p2State).abbr} filing={fil} label={`${(tax.p2State).name || (tax.p2State).abbr} — ${p2Name} (${fil === "mfj" ? "MFJ" : "Single"})`} />}
      </div>
      <Card dark style={{ gridColumn: mob ? "1" : "1/-1" }}>
        <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Active Summary</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, fontSize: 13 }}>
          {[["Fed Marginal", fp(C.mr)], ["Std Deduction", fmt(C.sd)], ["OASDI", `${p2(tax.ssRate)} to ${fmt(tax.ssCap)}`], ["Medicare", p2(tax.medRate)], [`${(tax.p1State || {}).abbr || "ST"} ${p1Name}`, `${C.cStMR ? (C.cStMR * 100).toFixed(1) : "0"}% marginal`], [`${(tax.p2State || {}).abbr || "ST"} ${p2Name}`, `${C.kStMR ? (C.kStMR * 100).toFixed(1) : "0"}% marginal`], [`401k ${p1Name}`, fmt(tax.k401Lim + (tax.c401Catch || 0))], [`401k ${p2Name}`, fmt(tax.k401Lim + (tax.k401Catch || 0))], ["HSA Limit", fmt(tax.hsaLimit)]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
              <span style={{ color: "#aaa" }}>{l}</span><span style={{ color: "#4ECDC4", fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

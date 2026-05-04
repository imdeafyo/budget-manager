import { Card, NI, PI, EditTxt } from "../components/ui.jsx";
import { evalF, fmt } from "../utils/calc.js";

export default function IncomeTab({ mob, p1Name, setP1Name, p2Name, setP2Name, cSal, setCS, kSal, setKS, cEaip, setCE, kEaip, setKE, fil, setFil, c4pre, setC4pre, c4ro, setC4ro, k4pre, setK4pre, k4ro, setK4ro, tax, upTax, preDed, setPreDed, postDed, setPostDed, C }) {

  const DedEditor = ({ items, setItems, label }) => (
    <Card>
      <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>{label} <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr 1fr 20px" : "1fr 1fr 1fr 24px", gap: "6px 8px", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p1Name}</div>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>{p2Name}</div><div />
        {items.map((d, i) => [
          <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...items]; n[i] = { ...n[i], n: v }; setItems(n); }} /></div>,
          <NI key={i + "c"} value={d.c} onChange={v => { const n = [...items]; n[i] = { ...n[i], c: v }; setItems(n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
          <NI key={i + "k"} value={d.k} onChange={v => { const n = [...items]; n[i] = { ...n[i], k: v }; setItems(n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
          <button key={i + "x"} onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
        ])}
      </div>
      <button onClick={() => setItems([...items, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
    </Card>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Income</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Person 1 Name</label><input value={p1Name} onChange={e => setP1Name(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)", boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Person 2 Name</label><input value={p2Name} onChange={e => setP2Name(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)", boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} Salary</label><NI value={cSal} onChange={setCS} prefix="$" /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} Salary</label><NI value={kSal} onChange={setKS} prefix="$" /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p1Name} Bonus %</label><PI value={cEaip} onChange={setCE} /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{p2Name} Bonus %</label><PI value={kEaip} onChange={setKE} /></div>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#999" }}>
                {p1Name} Birth Year
                <span title="Used by Forecast tab for IRS catch-up contribution tier resolution (50+ standard catch-up, 60-63 super catch-up, 55+ HSA catch-up). Empty = no catch-up applied. Year only — no month/day needed." style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "#bbb", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "help" }}>?</span>
              </label>
              <input type="number" value={tax.p1BirthYear || ""} onChange={e => upTax("p1BirthYear", +e.target.value || 0)} placeholder="e.g. 1985" style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#999" }}>
                {p2Name} Birth Year
                <span title="Used by Forecast tab for IRS catch-up contribution tier resolution. Empty = no catch-up applied." style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "#bbb", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "help" }}>?</span>
              </label>
              <input type="number" value={tax.p2BirthYear || ""} onChange={e => upTax("p2BirthYear", +e.target.value || 0)} placeholder="e.g. 1990" style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Filing Status</label>
            <select value={fil} onChange={e => setFil(e.target.value)} style={{ width: "100%", border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #222)" }}><option value="mfj">Married Filing Jointly</option><option value="single">Single / MFS</option></select></div>
        </Card>
        <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>401(k) Contributions</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#556FB5" }}>Pre-Tax 401(k)</span></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p1Name } %</label><PI value={c4pre} onChange={setC4pre} /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p2Name } %</label><PI value={k4pre} onChange={setK4pre} /></div>
            <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4, marginTop: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#E8573A" }}>Roth 401(k)</span></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p1Name } %</label><PI value={c4ro} onChange={setC4ro} /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p2Name } %</label><PI value={k4ro} onChange={setK4ro} /></div>
            <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4, marginTop: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#F2A93B" }}>Catch-Up (age 50+)</span></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p1Name } Catch-Up</label><NI value={tax.c401Catch} onChange={v => upTax("c401Catch", +v || 0)} prefix="$" />
              <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                <button onClick={() => upTax("c401CatchPreTax", true)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.c401CatchPreTax !== false) ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 4, background: (tax.c401CatchPreTax !== false) ? "#EEF1FA" : "transparent", color: (tax.c401CatchPreTax !== false) ? "#556FB5" : "#aaa", cursor: "pointer" }}>Pre-Tax</button>
                <button onClick={() => upTax("c401CatchPreTax", false)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.c401CatchPreTax === false) ? "2px solid #E8573A" : "2px solid var(--bdr, #ddd)", borderRadius: 4, background: (tax.c401CatchPreTax === false) ? "#fef5f2" : "transparent", color: (tax.c401CatchPreTax === false) ? "#E8573A" : "#aaa", cursor: "pointer" }}>Roth</button>
              </div>
            </div>
            <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{ p2Name } Catch-Up</label><NI value={tax.k401Catch} onChange={v => upTax("k401Catch", +v || 0)} prefix="$" />
              <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
                <button onClick={() => upTax("k401CatchPreTax", true)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.k401CatchPreTax !== false) ? "2px solid #556FB5" : "2px solid var(--bdr, #ddd)", borderRadius: 4, background: (tax.k401CatchPreTax !== false) ? "#EEF1FA" : "transparent", color: (tax.k401CatchPreTax !== false) ? "#556FB5" : "#aaa", cursor: "pointer" }}>Pre-Tax</button>
                <button onClick={() => upTax("k401CatchPreTax", false)} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, border: (tax.k401CatchPreTax === false) ? "2px solid #E8573A" : "2px solid var(--bdr, #ddd)", borderRadius: 4, background: (tax.k401CatchPreTax === false) ? "#fef5f2" : "transparent", color: (tax.k401CatchPreTax === false) ? "#E8573A" : "#aaa", cursor: "pointer" }}>Roth</button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--input-bg, #f8f8f8)", borderRadius: 8, fontSize: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><span style={{ color: "#999" }}>{p1Name} limit:</span> <strong>{fmt(tax.k401Lim + (tax.c401Catch || 0))}</strong>/yr</div>
              <div><span style={{ color: "#999" }}>{p2Name} limit:</span> <strong>{fmt(tax.k401Lim + (tax.k401Catch || 0))}</strong>/yr</div>
              <div><span style={{ color: "#999" }}>{p1Name} total:</span> <strong>{evalF(c4pre) + evalF(c4ro)}%</strong> ({fmt(C.c4w * 52)}/yr)</div>
              <div><span style={{ color: "#999" }}>{p2Name} total:</span> <strong>{evalF(k4pre) + evalF(k4ro)}%</strong> ({fmt(C.k4w * 52)}/yr)</div>
              <div><span style={{ color: "#999" }}>{p1Name} employer:</span> <strong>{C.cMP.toFixed(2)}%</strong> ({fmt(C.cs * C.cMP / 100)}/yr)</div>
              <div><span style={{ color: "#999" }}>{p2Name} employer:</span> <strong>{C.kMP.toFixed(2)}%</strong> ({fmt(C.ks * C.kMP / 100)}/yr)</div>
            </div>
          </div>
        </Card>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <DedEditor items={preDed} setItems={setPreDed} label="Pre-Tax Deductions" />
        <DedEditor items={postDed} setItems={setPostDed} label="Post-Tax Deductions" />
      </div>
    </div>
  );
}

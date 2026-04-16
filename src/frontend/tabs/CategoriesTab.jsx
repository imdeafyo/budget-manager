import { useState } from "react";
import { Card } from "../components/ui.jsx";

export default function CategoriesTab({ mob, cats, setCats, newCat, setNewCat, savCats, setSavCats, exp, setExp, sav, setSav }) {
  const [newSavCat, setNewSavCat] = useState("");
  const sortA = arr => [...arr].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const renameExpCat = (oldName, newName) => { if (oldName !== newName) setExp(prev => prev.map(it => it.c === oldName ? { ...it, c: newName } : it)); };
  const renameSavCat = (oldName, newName) => { if (oldName !== newName) setSav(prev => prev.map(it => it.c === oldName ? { ...it, c: newName } : it)); };
  return (
    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#E8573A" }}>Expense Categories</h3>
        {sortA(cats).map((c) => (
          <div key={c} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input value={c} onChange={e => { const nv = e.target.value; const i = cats.indexOf(c); const n = [...cats]; n[i] = nv; setCats(n); renameExpCat(c, nv); }} style={{ flex: 1, border: "2px solid var(--input-border, #f5d5ce)", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fef5f2)" }} />
            <button onClick={() => setCats(cats.filter(x => x !== c))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New expense category..." onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { setCats(sortA([...cats, newCat.trim()])); setNewCat(""); } }} style={{ flex: 1, border: "2px solid var(--input-border, #f5d5ce)", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fef5f2)" }} />
          <button onClick={() => { if (newCat.trim()) { setCats(sortA([...cats, newCat.trim()])); setNewCat(""); } }} style={{ padding: "8px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
        </div>
      </Card>
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#2ECC71" }}>Savings Categories</h3>
        {sortA(savCats).map((c) => (
          <div key={c} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input value={c} onChange={e => { const nv = e.target.value; const i = savCats.indexOf(c); const n = [...savCats]; n[i] = nv; setSavCats(n); renameSavCat(c, nv); }} style={{ flex: 1, border: "2px solid var(--input-border, #d5f5e3)", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #f0faf5)" }} />
            <button onClick={() => setSavCats(savCats.filter(x => x !== c))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input value={newSavCat} onChange={e => setNewSavCat(e.target.value)} placeholder="New savings category..." onKeyDown={e => { if (e.key === "Enter" && newSavCat.trim()) { setSavCats(sortA([...savCats, newSavCat.trim()])); setNewSavCat(""); } }} style={{ flex: 1, border: "2px solid var(--input-border, #d5f5e3)", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #f0faf5)" }} />
          <button onClick={() => { if (newSavCat.trim()) { setSavCats(sortA([...savCats, newSavCat.trim()])); setNewSavCat(""); } }} style={{ padding: "8px 18px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
        </div>
      </Card>
    </div>
  );
}

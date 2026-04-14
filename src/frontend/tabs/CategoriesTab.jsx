import { Card } from "../components/ui.jsx";

export default function CategoriesTab({ mob, cats, setCats, newCat, setNewCat, savCats, setSavCats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#E8573A" }}>Expense Categories</h3>
        {cats.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input value={c} onChange={e => { const n = [...cats]; n[i] = e.target.value; setCats(n); }} style={{ flex: 1, border: "2px solid #f5d5ce", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#fef5f2" }} />
            <button onClick={() => setCats(cats.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New expense category..." onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(""); } }} style={{ flex: 1, border: "2px solid #f5d5ce", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#fef5f2" }} />
          <button onClick={() => { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(""); } }} style={{ padding: "8px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
        </div>
      </Card>
      <Card>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#2ECC71" }}>Savings Categories</h3>
        {savCats.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input value={c} onChange={e => { const n = [...savCats]; n[i] = e.target.value; setSavCats(n); }} style={{ flex: 1, border: "2px solid #d5f5e3", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#f0faf5" }} />
            <button onClick={() => setSavCats(savCats.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input id="newSavCat" placeholder="New savings category..." onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { setSavCats([...savCats, e.target.value.trim()]); e.target.value = ""; } }} style={{ flex: 1, border: "2px solid #d5f5e3", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#f0faf5" }} />
          <button onClick={() => { const el = document.getElementById("newSavCat"); if (el?.value.trim()) { setSavCats([...savCats, el.value.trim()]); el.value = ""; } }} style={{ padding: "8px 18px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
        </div>
      </Card>
    </div>
  );
}

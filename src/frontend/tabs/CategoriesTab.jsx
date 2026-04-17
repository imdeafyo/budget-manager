import { useState, useMemo } from "react";
import { Card } from "../components/ui.jsx";

/* ── CategoryRow ──
   Editable category row. Uses local draft state so typing doesn't cause a
   re-sort / re-key cycle on every keystroke. Commits on blur or Enter. */
function CategoryRow({ name, accent, onRename, onDelete }) {
  const [draft, setDraft] = useState(name);
  const [focused, setFocused] = useState(false);

  // Keep draft in sync with the canonical name when not actively editing
  // (e.g. parent updates the list from an orphan-add action).
  if (!focused && draft !== name) {
    setDraft(name);
  }

  const commit = () => {
    setFocused(false);
    const next = draft.trim();
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    onRename(name, next);
  };

  const inputStyle = {
    flex: 1,
    border: `2px solid var(--input-border, ${accent.inputBorder})`,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "'DM Sans',sans-serif",
    background: `var(--input-bg, ${accent.inputBg})`,
  };

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") { setDraft(name); setFocused(false); e.target.blur(); }
        }}
        style={inputStyle}
      />
      <button
        onClick={() => onDelete(name)}
        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}
        title={`Remove "${name}"`}
      >×</button>
    </div>
  );
}

export default function CategoriesTab({
  mob,
  cats, setCats, newCat, setNewCat,
  savCats, setSavCats,
  exp, setExp,
  sav, setSav,
  transactions = [], setTransactions,
}) {
  const [newSavCat, setNewSavCat] = useState("");
  const sortA = arr => [...arr].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  /* ── Rename with cascade prompt ──
     Renaming affects three scopes:
       1. The category list itself (cats or savCats) — always.
       2. Budget line items (exp/sav) referencing the old name — cascaded
          silently since the line item category is a hard reference.
       3. Transactions referencing the old name — prompted, because the user
          might have meant only to rename the budget category. */
  const renameCategory = (oldName, newName, kind /* "exp" | "sav" */) => {
    // (1) Category list
    if (kind === "exp") {
      setCats(prev => prev.map(c => c === oldName ? newName : c));
    } else {
      setSavCats(prev => prev.map(c => c === oldName ? newName : c));
    }

    // (2) Budget line items — silent cascade
    if (kind === "exp") {
      setExp(prev => prev.map(it => it.c === oldName ? { ...it, c: newName } : it));
    } else {
      setSav(prev => prev.map(it => it.c === oldName ? { ...it, c: newName } : it));
    }

    // (3) Transactions — count, then prompt
    const txMatches = (transactions || []).filter(t => t.category === oldName);
    if (txMatches.length > 0 && setTransactions) {
      const msg =
        `Rename "${oldName}" → "${newName}" on ${txMatches.length} transaction${txMatches.length === 1 ? "" : "s"} too?\n\n` +
        `OK — update transactions.\n` +
        `Cancel — leave transactions pointing at "${oldName}" (they'll become orphaned).`;
      if (confirm(msg)) {
        setTransactions(prev => prev.map(t =>
          t.category === oldName
            ? { ...t, category: newName, updated_at: new Date().toISOString() }
            : t
        ));
      }
    }
  };

  const deleteCategory = (name, kind) => {
    const list = kind === "exp" ? cats : savCats;
    const setList = kind === "exp" ? setCats : setSavCats;
    if (list.length <= 1) { alert("Can't delete the last category."); return; }
    const txMatches = (transactions || []).filter(t => t.category === name);
    const lineMatches = kind === "exp"
      ? exp.filter(it => it.c === name).length
      : sav.filter(it => it.c === name).length;
    let msg = `Remove category "${name}"?`;
    if (lineMatches > 0 || txMatches.length > 0) {
      const bits = [];
      if (lineMatches > 0) bits.push(`${lineMatches} budget line item${lineMatches === 1 ? "" : "s"}`);
      if (txMatches.length > 0) bits.push(`${txMatches.length} transaction${txMatches.length === 1 ? "" : "s"}`);
      msg += `\n\n${bits.join(" and ")} still reference it. They'll become uncategorized.`;
    }
    if (!confirm(msg)) return;
    setList(list.filter(x => x !== name));
  };

  /* ── Orphan detection ──
     Any non-empty category value on a transaction that isn't in either of
     the canonical category lists. */
  const orphans = useMemo(() => {
    const known = new Set([...cats, ...savCats]);
    const tally = new Map();
    for (const t of transactions || []) {
      const c = t.category;
      if (!c) continue;
      if (known.has(c)) continue;
      tally.set(c, (tally.get(c) || 0) + 1);
    }
    return [...tally.entries()]
      .map(([c, count]) => ({ category: c, count }))
      .sort((a, b) => b.count - a.count);
  }, [cats, savCats, transactions]);

  const addOrphan = (name, kind) => {
    if (kind === "exp") setCats(prev => sortA([...prev, name]));
    else                setSavCats(prev => sortA([...prev, name]));
  };

  const ignoreOrphan = (name) => {
    if (!setTransactions) return;
    if (!confirm(`Clear "${name}" from all transactions? They'll become uncategorized and can be recategorized later.`)) return;
    setTransactions(prev => prev.map(t =>
      t.category === name
        ? { ...t, category: null, updated_at: new Date().toISOString() }
        : t
    ));
  };

  const expAccent = { inputBorder: "#f5d5ce", inputBg: "#fef5f2" };
  const savAccent = { inputBorder: "#d5f5e3", inputBg: "#f0faf5" };

  return (
    <>
      {orphans.length > 0 && (
        <Card style={{ marginBottom: 16, borderLeft: "4px solid #F2A93B" }}>
          <h3 style={{ margin: "0 0 8px", fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 800, color: "#F2A93B" }}>
            ⚠️ Transactions reference {orphans.length} unknown categor{orphans.length === 1 ? "y" : "ies"}
          </h3>
          <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
            These category names are used by transactions but don't exist in either list below.
            Add them so they show up in charts and budget line items.
          </p>
          <div>
            {orphans.map(o => (
              <div key={o.category} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--bdr2, #eee)", fontSize: 13 }}>
                <span style={{ flex: 1, color: "var(--tx, #333)" }}>
                  <strong>{o.category}</strong>
                  <span style={{ color: "var(--tx3, #999)", marginLeft: 8, fontSize: 12 }}>({o.count.toLocaleString()} tx)</span>
                </span>
                <button onClick={() => addOrphan(o.category, "exp")}
                  style={{ padding: "4px 10px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  + Expense
                </button>
                <button onClick={() => addOrphan(o.category, "sav")}
                  style={{ padding: "4px 10px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  + Savings
                </button>
                <button onClick={() => ignoreOrphan(o.category)}
                  style={{ padding: "4px 10px", background: "transparent", color: "var(--tx3, #888)", border: "1px solid var(--bdr, #ccc)", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
                  title="Clear this category from all transactions">
                  Clear
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
        <Card>
          <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#E8573A" }}>Expense Categories</h3>
          {sortA(cats).map(c => (
            <CategoryRow key={c} name={c} accent={expAccent}
              onRename={(oldN, newN) => renameCategory(oldN, newN, "exp")}
              onDelete={(n) => deleteCategory(n, "exp")} />
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New expense category..."
              onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { setCats(sortA([...cats, newCat.trim()])); setNewCat(""); } }}
              style={{ flex: 1, border: "2px solid var(--input-border, #f5d5ce)", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #fef5f2)" }} />
            <button onClick={() => { if (newCat.trim()) { setCats(sortA([...cats, newCat.trim()])); setNewCat(""); } }}
              style={{ padding: "8px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
          </div>
        </Card>

        <Card>
          <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#2ECC71" }}>Savings Categories</h3>
          {sortA(savCats).map(c => (
            <CategoryRow key={c} name={c} accent={savAccent}
              onRename={(oldN, newN) => renameCategory(oldN, newN, "sav")}
              onDelete={(n) => deleteCategory(n, "sav")} />
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input value={newSavCat} onChange={e => setNewSavCat(e.target.value)} placeholder="New savings category..."
              onKeyDown={e => { if (e.key === "Enter" && newSavCat.trim()) { setSavCats(sortA([...savCats, newSavCat.trim()])); setNewSavCat(""); } }}
              style={{ flex: 1, border: "2px solid var(--input-border, #d5f5e3)", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "var(--input-bg, #f0faf5)" }} />
            <button onClick={() => { if (newSavCat.trim()) { setSavCats(sortA([...savCats, newSavCat.trim()])); setNewSavCat(""); } }}
              style={{ padding: "8px 18px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
          </div>
        </Card>
      </div>
    </>
  );
}

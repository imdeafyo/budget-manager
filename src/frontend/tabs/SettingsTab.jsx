import { useState } from "react";
import { Card, SH } from "../components/ui.jsx";
import { BUILTIN_COLUMNS, addColumn, removeColumn, renameColumn } from "../utils/transactions.js";

export default function SettingsTab(props) {
  const {
    mob,
    transactionColumns, setTransactionColumns,
    hiddenColumns, setHiddenColumns,
    rowCapWarn, setRowCapWarn,
    rowCapThreshold, setRowCapThreshold,
    transactions,
  } = props;

  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState("string");
  const [thresholdDraft, setThresholdDraft] = useState(String(rowCapThreshold));

  const toggleHidden = (id) => {
    setHiddenColumns(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const commitAdd = () => {
    const name = newColName.trim();
    if (!name) return;
    setTransactionColumns(prev => addColumn(prev, { name, type: newColType }));
    setNewColName("");
    setNewColType("string");
  };

  const commitRename = (id, name) => {
    setTransactionColumns(prev => renameColumn(prev, id, name));
  };

  const commitRemove = (id, name) => {
    if (!confirm(`Remove column "${name}"? Existing values in this column will be lost.`)) return;
    setTransactionColumns(prev => removeColumn(prev, id));
    // Also un-hide so it doesn't linger in hiddenColumns
    setHiddenColumns(prev => prev.filter(x => x !== id));
  };

  const commitThreshold = () => {
    const n = parseInt(thresholdDraft, 10);
    if (!isNaN(n) && n > 0) setRowCapThreshold(n);
    else setThresholdDraft(String(rowCapThreshold));
  };

  return (
    <>
      <Card>
        <h2 style={{ margin: "0 0 8px", fontFamily: "'Fraunces',serif", fontWeight: 800, fontSize: mob ? 20 : 26, color: "var(--tx, #333)" }}>Settings</h2>
        <div style={{ fontSize: 12, color: "var(--tx3, #999)" }}>Preferences for transaction handling and display.</div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <SH>Transaction row cap</SH>
        <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Large transaction counts can slow down browser-based persistence (the single-file generic HTML stores
          everything in localStorage as one JSON blob). Set a threshold above which you want a warning banner
          to appear on the Transactions tab.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tx, #333)" }}>
            <input type="checkbox" checked={rowCapWarn} onChange={e => setRowCapWarn(e.target.checked)} />
            Show warning when row count exceeds threshold
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, color: "var(--tx2, #555)" }}>Threshold:</label>
            <input type="number" min="100" step="100" value={thresholdDraft}
              onChange={e => setThresholdDraft(e.target.value)} onBlur={commitThreshold}
              onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
              disabled={!rowCapWarn}
              style={inp(100)} />
            <span style={{ fontSize: 12, color: "var(--tx3, #999)" }}>rows</span>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--tx3, #888)" }}>
          Currently storing <strong style={{ color: "var(--tx, #333)" }}>{transactions.length.toLocaleString()}</strong> transactions.
          {rowCapWarn && transactions.length > rowCapThreshold && <span style={{ color: "#F2A93B", marginLeft: 8 }}>⚠️ Over threshold.</span>}
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <SH>Transaction columns</SH>
        <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Built-in columns always exist but can be hidden from the table. Custom columns let you store
          extra fields per transaction — for example, a "Merchant ID" string or a "Tax deductible" boolean.
        </p>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Built-in columns</div>
          {BUILTIN_COLUMNS.map(col => (
            <label key={col.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--bdr2, #eee)", fontSize: 13, color: "var(--tx, #333)" }}>
              <input type="checkbox" checked={!hiddenColumns.includes(col.id)} onChange={() => toggleHidden(col.id)} />
              <span style={{ flex: 1 }}>{col.name}</span>
              <span style={{ fontSize: 11, color: "var(--tx3, #999)" }}>{col.type}</span>
            </label>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            Custom columns{transactionColumns.length === 0 && <span style={{ fontWeight: 400, marginLeft: 6, textTransform: "none", color: "var(--tx3, #aaa)" }}>(none yet)</span>}
          </div>
          {transactionColumns.map(col => (
            <CustomColumnRow key={col.id} col={col}
              hidden={hiddenColumns.includes(col.id)}
              onToggleHidden={() => toggleHidden(col.id)}
              onRename={(name) => commitRename(col.id, name)}
              onRemove={() => commitRemove(col.id, col.name)} />
          ))}
        </div>

        <div style={{ padding: 12, background: "var(--input-bg, #fafafa)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Add new column</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={newColName} onChange={e => setNewColName(e.target.value)}
              placeholder="Column name (e.g. Merchant ID)"
              onKeyDown={e => { if (e.key === "Enter") commitAdd(); }}
              style={inp(240)} />
            <select value={newColType} onChange={e => setNewColType(e.target.value)} style={inp(120)}>
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Yes / No</option>
            </select>
            <button onClick={commitAdd} disabled={!newColName.trim()} style={btn("#2ECC71", "#fff")}>+ Add column</button>
          </div>
        </div>
      </Card>
    </>
  );
}

function CustomColumnRow({ col, hidden, onToggleHidden, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(col.name);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== col.name) onRename(name);
    setEditing(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--bdr2, #eee)", fontSize: 13, color: "var(--tx, #333)" }}>
      <input type="checkbox" checked={!hidden} onChange={onToggleHidden} />
      {editing ? (
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setDraft(col.name); setEditing(false); } }}
          style={{ ...inp(240), flex: 1 }} />
      ) : (
        <span onClick={() => setEditing(true)} style={{ flex: 1, cursor: "text" }} title="Click to rename">{col.name}</span>
      )}
      <span style={{ fontSize: 11, color: "var(--tx3, #999)" }}>{col.type}</span>
      <span style={{ fontSize: 11, color: "var(--tx3, #bbb)", fontFamily: "monospace" }}>{col.id}</span>
      <button onClick={onRemove} title="Remove column" style={{ border: "none", background: "none", color: "#E8573A", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
    </div>
  );
}

const inp = (width) => ({ padding: 6, fontSize: 13, borderRadius: 6, border: "1px solid var(--input-border, #e0e0e0)", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #333)", fontFamily: "'DM Sans',sans-serif", width: width ? `${width}px` : "auto", boxSizing: "border-box" });
const btn = (bg, color) => ({ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", background: bg, color, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" });

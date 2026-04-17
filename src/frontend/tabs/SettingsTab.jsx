import { useState, useMemo, useEffect } from "react";
import { Card, SH } from "../components/ui.jsx";
import { BUILTIN_COLUMNS, addColumn, removeColumn, renameColumn } from "../utils/transactions.js";

/* ── CollapsibleCard ──
   Card with a clickable header that toggles the body open/closed. Persists
   open state to localStorage under `budget-settings-open:{id}`. Defaults to
   collapsed so the Settings tab isn't a wall on first visit. */
function CollapsibleCard({ id, title, summary, children, style }) {
  const storageKey = `budget-settings-open:${id}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch {}
  }, [open, storageKey]);
  return (
    <Card style={style}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 14, color: "var(--tx2, #555)", width: 16, display: "inline-block", textAlign: "center", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 1.5 }}>{title}</div>
          {!open && summary && <div style={{ fontSize: 12, color: "var(--tx3, #888)", marginTop: 2 }}>{summary}</div>}
        </div>
      </div>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </Card>
  );
}

export default function SettingsTab(props) {
  const {
    mob,
    transactionColumns, setTransactionColumns,
    hiddenColumns, setHiddenColumns,
    rowCapWarn, setRowCapWarn,
    rowCapThreshold, setRowCapThreshold,
    transactions,
    importProfiles = [], setImportProfiles,
    deleteImportBatch,
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
    setHiddenColumns(prev => prev.filter(x => x !== id));
  };

  const commitThreshold = () => {
    const n = parseInt(thresholdDraft, 10);
    if (!isNaN(n) && n > 0) setRowCapThreshold(n);
    else setThresholdDraft(String(rowCapThreshold));
  };

  /* ── Recent import batches: group transactions by import_batch_id ── */
  const recentBatches = useMemo(() => {
    const byBatch = new Map();
    for (const tx of transactions) {
      if (!tx.import_batch_id) continue;
      if (!byBatch.has(tx.import_batch_id)) {
        byBatch.set(tx.import_batch_id, {
          batchId: tx.import_batch_id,
          source: tx.import_source || "unknown",
          count: 0,
          earliestDate: tx.date,
          latestDate: tx.date,
          createdAt: tx.created_at,
        });
      }
      const b = byBatch.get(tx.import_batch_id);
      b.count++;
      if (tx.date < b.earliestDate) b.earliestDate = tx.date;
      if (tx.date > b.latestDate) b.latestDate = tx.date;
      if (tx.created_at > b.createdAt) b.createdAt = tx.created_at;
    }
    return [...byBatch.values()].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [transactions]);

  const handleDeleteBatch = (batch) => {
    const msg = `Delete all ${batch.count} transactions imported from "${batch.source}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    if (deleteImportBatch) deleteImportBatch(batch.batchId);
  };

  /* ── Profile CRUD ── */
  const deleteProfile = (id) => {
    const p = importProfiles.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Delete profile "${p.name}"?`)) return;
    setImportProfiles(prev => prev.filter(x => x.id !== id));
  };
  const renameProfile = (id, name) => {
    setImportProfiles(prev => prev.map(p => p.id === id ? { ...p, name, updatedAt: new Date().toISOString() } : p));
  };

  return (
    <>
      <Card>
        <h2 style={{ margin: "0 0 8px", fontFamily: "'Fraunces',serif", fontWeight: 800, fontSize: mob ? 20 : 26, color: "var(--tx, #333)" }}>Settings</h2>
        <div style={{ fontSize: 12, color: "var(--tx3, #999)" }}>Preferences for transaction handling and display.</div>
      </Card>

      <CollapsibleCard
        id="rowcap"
        title="Transaction row cap"
        summary={`${transactions.length.toLocaleString()} stored · warn at ${rowCapThreshold.toLocaleString()} ${rowCapWarn ? "(enabled)" : "(disabled)"}`}
        style={{ marginTop: 16 }}>
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
      </CollapsibleCard>

      <CollapsibleCard
        id="columns"
        title="Transaction columns"
        summary={`${BUILTIN_COLUMNS.length} built-in · ${transactionColumns.length} custom · ${hiddenColumns.length} hidden`}
        style={{ marginTop: 16 }}>
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
      </CollapsibleCard>

      <CollapsibleCard
        id="profiles"
        title="Saved import profiles"
        summary={importProfiles.length === 0 ? "None yet" : `${importProfiles.length} saved`}
        style={{ marginTop: 16 }}>
        <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Profiles remember how to map a bank's CSV. They auto-match by header signature on future imports.
          Full editing happens in the Import modal — here you can rename, delete, and review what's saved.
        </p>
        {importProfiles.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--tx3, #aaa)", fontStyle: "italic" }}>
            No profiles saved yet. Import a CSV from the Transactions tab to create your first one.
          </div>
        ) : (
          <div>
            {importProfiles.map(p => (
              <ProfileRow key={p.id} profile={p} onRename={(name) => renameProfile(p.id, name)} onDelete={() => deleteProfile(p.id)} />
            ))}
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="recent"
        title="Recent imports"
        summary={recentBatches.length === 0 ? "None yet" : `${recentBatches.length} batch${recentBatches.length === 1 ? "" : "es"}`}
        style={{ marginTop: 16 }}>
        <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Every import is tagged with a batch ID so you can roll it back entirely if something went wrong.
          Manual additions aren't listed here — this is only for CSV imports.
        </p>
        {recentBatches.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--tx3, #aaa)", fontStyle: "italic" }}>
            No imports yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--input-bg, #fafafa)" }}>
                  <th style={th}>Imported</th>
                  <th style={th}>Source</th>
                  <th style={{ ...th, textAlign: "right" }}>Rows</th>
                  <th style={th}>Date range</th>
                  <th style={{ ...th, width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {recentBatches.map(b => (
                  <tr key={b.batchId} style={{ borderTop: "1px solid var(--bdr2, #eee)" }}>
                    <td style={td}>{formatTimestamp(b.createdAt)}</td>
                    <td style={td}><strong>{b.source}</strong></td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.count.toLocaleString()}</td>
                    <td style={td}>{b.earliestDate}{b.earliestDate !== b.latestDate && ` → ${b.latestDate}`}</td>
                    <td style={td}>
                      <button onClick={() => handleDeleteBatch(b)} title="Remove all rows from this import"
                        style={{ padding: "3px 8px", fontSize: 11, background: "transparent", border: "1px solid var(--bdr, #ccc)", borderRadius: 4, cursor: "pointer", color: "#E8573A" }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>
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

function ProfileRow({ profile, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== profile.name) onRename(name);
    setEditing(false);
  };

  const summary = [];
  if (profile.amountConvention) summary.push(amountLabel(profile.amountConvention));
  if (profile.dateFormat) summary.push(profile.dateFormat);
  if (profile.trustCategories) summary.push("trusts source categories");
  const aliasCount = Object.keys(profile.categoryAliases || {}).length;
  if (aliasCount) summary.push(`${aliasCount} alias${aliasCount === 1 ? "" : "es"}`);

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--bdr2, #eee)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {editing ? (
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setDraft(profile.name); setEditing(false); } }}
            style={{ ...inp(260), flex: 1 }} />
        ) : (
          <span onClick={() => setEditing(true)} style={{ flex: 1, cursor: "text", fontWeight: 600, color: "var(--tx, #333)", fontSize: 14 }} title="Click to rename">
            {profile.name}
          </span>
        )}
        <button onClick={onDelete} title="Delete profile"
          style={{ border: "none", background: "none", color: "#E8573A", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--tx3, #888)", marginTop: 3 }}>
        {summary.join(" · ") || <em>no details</em>}
      </div>
    </div>
  );
}

function amountLabel(conv) {
  return {
    "signed": "signed amount",
    "negate-for-debit": "positive amounts → expenses",
    "separate": "separate debit/credit",
    "type-column": "amount + type column",
  }[conv] || conv;
}

function formatTimestamp(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch(e) { return iso; }
}

const inp = (width) => ({ padding: 6, fontSize: 13, borderRadius: 6, border: "1px solid var(--input-border, #e0e0e0)", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #333)", fontFamily: "'DM Sans',sans-serif", width: width ? `${width}px` : "auto", boxSizing: "border-box" });
const btn = (bg, color) => ({ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", background: bg, color, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" });
const th = { padding: "8px 10px", textAlign: "left", fontSize: 11, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 };
const td = { padding: "8px 10px", verticalAlign: "middle", color: "var(--tx, #333)" };

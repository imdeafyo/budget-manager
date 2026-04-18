import { useState, useMemo, useEffect } from "react";
import { Card, SH } from "../components/ui.jsx";
import { BUILTIN_COLUMNS, addColumn, removeColumn, renameColumn } from "../utils/transactions.js";
import { newRule, compileRule, moveRule, applyRulesToAll } from "../utils/rules.js";

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
    transactions, setTransactions,
    updateTransaction,
    importProfiles = [], setImportProfiles,
    transactionRules = [], setTransactionRules,
    cats = [], savCats = [], transferCats = [],
    transferToleranceAmount = 0.01,
    setTransferToleranceAmount,
    transferToleranceDays = 2,
    setTransferToleranceDays,
    treatRefundsAsNetting = true,
    setTreatRefundsAsNetting,
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

  /* ── Dismissed transfer candidates ──
     Rows the user explicitly said "not a transfer" to in the detection modal.
     They're excluded from future detection runs; this count + the reset button
     below give the user an escape hatch if they dismissed something by mistake. */
  const dismissedCount = useMemo(
    () => transactions.reduce((n, t) => n + (t.custom_fields?._transfer_dismissed ? 1 : 0), 0),
    [transactions]
  );

  const resetAllDismissed = () => {
    if (!dismissedCount) return;
    if (!confirm(`Re-enable ${dismissedCount} dismissed transaction${dismissedCount === 1 ? "" : "s"} for transfer detection?\n\nThey'll become candidates again the next time you run "Detect transfers".`)) return;
    setTransactions(prev => prev.map(t => {
      if (!t.custom_fields?._transfer_dismissed) return t;
      const cf = { ...t.custom_fields };
      delete cf._transfer_dismissed;
      return { ...t, custom_fields: cf };
    }));
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
        id="rules"
        title="Categorization rules"
        summary={`${transactionRules.length} rule${transactionRules.length === 1 ? "" : "s"}${transactionRules.length ? ` · ${transactionRules.filter(r => r.enabled).length} enabled` : ""}`}
        style={{ marginTop: 16 }}>
        <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Rules run top-down on imports and when you ask for a re-sweep. First match wins per field — a rule
          that sets category doesn't stop a later rule from setting a custom field, but two rules that both
          set category will only apply the first matching one.
        </p>

        <RulesPanel
          rules={transactionRules}
          setRules={setTransactionRules}
          cats={cats}
          savCats={savCats}
          transferCats={transferCats}
          transactionColumns={transactionColumns || []}
          transactions={transactions}
          setTransactions={setTransactions}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="transfers"
        title="Transfer detection"
        summary={`±$${Number(transferToleranceAmount).toFixed(2)} · ±${transferToleranceDays} day${transferToleranceDays === 1 ? "" : "s"}${dismissedCount ? ` · ${dismissedCount} dismissed` : ""}`}
        style={{ marginTop: 16 }}>
        <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Transfers are matching pairs of transactions across different accounts — money you moved between
          your own accounts, not spending or income. The detector scans for opposing amounts on dates close
          together and lets you confirm each pair before committing. Tune the tolerances here if your bank
          posts the two sides of a transfer a few days apart or with small fee differences.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
          <div>
            <label style={lbl()}>Amount tolerance</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--tx3, #888)" }}>±$</span>
              <input type="number" min="0" step="0.01" value={transferToleranceAmount}
                onChange={e => setTransferToleranceAmount(parseFloat(e.target.value) || 0)}
                style={inp(100)} />
            </div>
            <div style={{ fontSize: 11, color: "var(--tx3, #999)", marginTop: 4 }}>
              How far apart the two amounts can be before they're no longer a match.
            </div>
          </div>
          <div>
            <label style={lbl()}>Date tolerance</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--tx3, #888)" }}>±</span>
              <input type="number" min="0" step="1" value={transferToleranceDays}
                onChange={e => setTransferToleranceDays(parseInt(e.target.value, 10) || 0)}
                style={inp(70)} />
              <span style={{ fontSize: 13, color: "var(--tx3, #888)" }}>days</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--tx3, #999)", marginTop: 4 }}>
              How many days apart the two sides of a transfer can post.
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--tx3, #888)", lineHeight: 1.5 }}>
          Run detection from the Transactions tab — click <strong>🔀 Detect transfers</strong> in the toolbar.
          Rows you confirm are flagged (and excluded from spending totals). Rows you dismiss are remembered
          so they won't resurface as candidates on future runs.
        </div>

        {/* Dismissed-row reset — escape hatch when you accidentally dismiss or unpair. */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--bdr2, #eee)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx2, #555)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Dismissed rows
              </div>
              <div style={{ fontSize: 12, color: "var(--tx3, #888)", marginTop: 4, lineHeight: 1.5 }}>
                {dismissedCount === 0
                  ? "No rows are currently dismissed."
                  : `${dismissedCount} row${dismissedCount === 1 ? " is" : "s are"} excluded from detection because you dismissed or unpaired them. Use this button if you unpaired something by mistake.`}
              </div>
            </div>
            <button onClick={resetAllDismissed} disabled={dismissedCount === 0}
              style={{ ...btn("var(--card-bg, #fff)", dismissedCount === 0 ? "var(--tx3, #aaa)" : "#556FB5"), border: `1px solid ${dismissedCount === 0 ? "var(--bdr, #ccc)" : "#556FB5"}`, opacity: dismissedCount === 0 ? 0.6 : 1, cursor: dismissedCount === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
              ↺ Reset all dismissed
            </button>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id="refunds"
        title="Refund handling"
        summary={treatRefundsAsNetting ? "Refunds reduce category spend" : "Refunds treated as income"}
        style={{ marginTop: 16 }}>
        <p style={{ fontSize: 13, color: "var(--tx2, #555)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          A refund is a positive-amount transaction sitting in an expense category — for example, a $40 credit
          from Amazon in your "Shopping" category. With netting on (the default), that $40 buys back $40 of
          your Shopping budget. With it off, the refund is treated as household income instead. Netting
          matches how most people mentally account for returns.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--tx, #333)" }}>
          <input type="checkbox" checked={treatRefundsAsNetting}
            onChange={e => setTreatRefundsAsNetting(e.target.checked)} />
          Treat positive amounts in expense categories as refunds (reduce the category's spend)
        </label>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--tx3, #888)", lineHeight: 1.5 }}>
          This affects how the budget-vs-actual comparison (Phase 6) calculates per-category spending.
          It doesn't change the raw transaction rows — they're still stored with their original amounts and
          categories. Rows marked as transfers are always excluded from refund calculations.
        </div>
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
  // With the Phase 5a defaults (trust=true, rulesOverride=true) everyone's a rule-first,
  // CSV-as-fallback setup. Only surface the deviations from the norm.
  if (profile.trustCategories === false) summary.push("ignores CSV categories");
  if (profile.rulesOverrideCsv === false) summary.push("CSV wins over rules");
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

/* ══════════════════════════ RulesPanel ══════════════════════════
   Manages the list of transactionRules. One component so the collapsible card
   stays tidy. Rules are stored in array order = priority. */
function RulesPanel({ rules, setRules, cats, savCats, transferCats, transactionColumns, transactions, setTransactions }) {
  const [expanded, setExpanded] = useState(() => new Set()); // rule ids with editor open
  const [sweepResult, setSweepResult] = useState(null);

  const allCatOptions = useMemo(() => {
    const s = new Set([...(cats || []), ...(savCats || []), ...(transferCats || [])]);
    (transactions || []).forEach(t => { if (t.category) s.add(t.category); });
    return [...s].sort();
  }, [cats, savCats, transferCats, transactions]);

  const addRule = () => {
    const newR = newRule({
      name: "New rule",
      conditions: [{ field: "description", operator: "contains", value: "", caseSensitive: false }],
      action: { type: "set_category", value: "" },
    });
    setRules(prev => [...prev, newR]);
    // open editor for the new rule so the user can immediately edit
    setExpanded(prev => {
      const n = new Set(prev);
      n.add(newR.id);
      return n;
    });
  };

  const updateRule = (id, patch) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r));
  };

  const deleteRule = (id) => {
    const r = rules.find(x => x.id === id);
    if (!r) return;
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    setRules(prev => prev.filter(x => x.id !== id));
    setExpanded(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const move = (idx, delta) => {
    setRules(prev => moveRule(prev, idx, idx + delta));
  };

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const reRunAll = () => {
    if (!rules.length || !setTransactions) return;
    const enabled = rules.filter(r => r.enabled);
    if (!enabled.length) { alert("No enabled rules to run."); return; }
    const msg = `Apply ${enabled.length} enabled rule${enabled.length === 1 ? "" : "s"} across ${transactions.length.toLocaleString()} transactions? Manually-categorized rows won't be overwritten.`;
    if (!confirm(msg)) return;
    const { transactions: updated, stats } = applyRulesToAll(transactions, enabled);
    setTransactions(updated);
    setSweepResult({ matched: stats.matched, total: transactions.length });
    setTimeout(() => setSweepResult(null), 6000);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button onClick={addRule} style={btn("#556FB5", "#fff")}>+ Add rule</button>
        <button onClick={reRunAll} disabled={!rules.length}
          style={{ ...btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)"), opacity: rules.length ? 1 : 0.5, cursor: rules.length ? "pointer" : "not-allowed" }}>
          Re-run rules on all transactions
        </button>
        {sweepResult && (
          <span style={{ fontSize: 12, color: "#2ECC71", fontWeight: 600 }}>
            ✓ {sweepResult.matched.toLocaleString()} of {sweepResult.total.toLocaleString()} rows matched
          </span>
        )}
      </div>

      {rules.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--tx3, #aaa)", fontStyle: "italic", padding: 12 }}>
          No rules yet. Rules are created automatically when you manually categorize a transaction and choose "Create rule," or you can add one here.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--bdr2, #eee)", borderRadius: 8, overflow: "hidden" }}>
          {rules.map((r, idx) => (
            <RuleRow
              key={r.id}
              rule={r}
              index={idx}
              total={rules.length}
              expanded={expanded.has(r.id)}
              onToggleExpand={() => toggleExpand(r.id)}
              onUpdate={(patch) => updateRule(r.id, patch)}
              onDelete={() => deleteRule(r.id)}
              onMoveUp={() => move(idx, -1)}
              onMoveDown={() => move(idx, 1)}
              allCatOptions={allCatOptions}
              transactionColumns={transactionColumns}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ RuleRow ══════════════════════════
   One rule in the list. Header row shows priority, enable toggle, name, move
   buttons, and delete. Body is an editor revealed on expand.

   The condition editor supports one primary condition; more advanced
   multi-condition rules can be added via direct state manipulation — the
   engine supports them, the UI keeps it simple for v1. */
function RuleRow({ rule, index, total, expanded, onToggleExpand, onUpdate, onDelete, onMoveUp, onMoveDown, allCatOptions, transactionColumns }) {
  const { valid, errors } = compileRule(rule);
  const primary = rule.conditions?.[0] || { field: "description", operator: "contains", value: "" };

  const setPrimary = (patch) => {
    const next = { ...primary, ...patch };
    const rest = (rule.conditions || []).slice(1);
    onUpdate({ conditions: [next, ...rest] });
  };

  const setAction = (patch) => {
    onUpdate({ action: { ...(rule.action || {}), ...patch } });
  };

  // Support for additional conditions (AND beyond the primary one). Kept compact.
  const addCondition = () => {
    onUpdate({
      conditions: [
        ...(rule.conditions || []),
        { field: "description", operator: "contains", value: "", caseSensitive: false },
      ],
    });
  };
  const updateExtraCond = (i, patch) => {
    const conds = [...(rule.conditions || [])];
    conds[i] = { ...conds[i], ...patch };
    onUpdate({ conditions: conds });
  };
  const removeCond = (i) => {
    const conds = [...(rule.conditions || [])];
    conds.splice(i, 1);
    onUpdate({ conditions: conds });
  };

  const customColOptions = (transactionColumns || []).map(c => ({ id: `custom.${c.id}`, name: c.name }));

  return (
    <div style={{ borderBottom: index < total - 1 ? "1px solid var(--bdr2, #eee)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, background: rule.enabled ? "transparent" : "var(--input-bg, #fafafa)" }}>
        <span style={{ fontSize: 11, color: "var(--tx3, #999)", fontFamily: "monospace", width: 20, textAlign: "center" }} title="Priority — lower runs first">
          {index + 1}
        </span>
        <input type="checkbox" checked={rule.enabled} onChange={e => onUpdate({ enabled: e.target.checked })}
          title={rule.enabled ? "Rule is active" : "Rule is disabled"} />
        <span onClick={onToggleExpand}
          style={{ flex: 1, cursor: "pointer", fontSize: 13, fontWeight: 600, color: rule.enabled ? "var(--tx, #333)" : "var(--tx3, #999)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
          {rule.name || <em style={{ color: "var(--tx3, #aaa)" }}>unnamed</em>}
          {!valid && (
            <span title={errors.join("\n")} style={{ fontSize: 10, padding: "2px 6px", background: "rgba(232, 87, 58, 0.12)", color: "#E8573A", borderRadius: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
              ⚠ error
            </span>
          )}
        </span>
        <button onClick={onMoveUp} disabled={index === 0}
          title="Move up (higher priority)"
          style={{ border: "none", background: "none", color: index === 0 ? "#ccc" : "var(--tx3, #888)", cursor: index === 0 ? "default" : "pointer", fontSize: 14, padding: "0 4px" }}>
          ▲
        </button>
        <button onClick={onMoveDown} disabled={index >= total - 1}
          title="Move down (lower priority)"
          style={{ border: "none", background: "none", color: index >= total - 1 ? "#ccc" : "var(--tx3, #888)", cursor: index >= total - 1 ? "default" : "pointer", fontSize: 14, padding: "0 4px" }}>
          ▼
        </button>
        <button onClick={onDelete} title="Delete rule"
          style={{ border: "none", background: "none", color: "#E8573A", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
      </div>

      {expanded && (
        <div style={{ padding: 14, background: "var(--input-bg, #fafafa)", borderTop: "1px solid var(--bdr2, #eee)" }}>
          {/* Name + match mode */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 12 }}>
            <div>
              <label style={lbl()}>Rule name</label>
              <input value={rule.name || ""} onChange={e => onUpdate({ name: e.target.value })} style={inp()} />
            </div>
            <div>
              <label style={lbl()}>Match</label>
              <select value={rule.match || "all"} onChange={e => onUpdate({ match: e.target.value })} style={inp()}>
                <option value="all">all conditions (AND)</option>
                <option value="any">any condition (OR)</option>
              </select>
            </div>
          </div>

          {/* Conditions */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl()}>Conditions</label>
            <ConditionEditor
              cond={primary}
              onChange={setPrimary}
              customColOptions={customColOptions}
              canRemove={false}
            />
            {(rule.conditions || []).slice(1).map((c, i) => (
              <ConditionEditor
                key={i}
                cond={c}
                onChange={(patch) => updateExtraCond(i + 1, patch)}
                customColOptions={customColOptions}
                canRemove
                onRemove={() => removeCond(i + 1)}
              />
            ))}
            <button onClick={addCondition}
              style={{ ...btn("transparent", "var(--tx2, #555)"), border: "1px dashed var(--bdr, #ccc)", marginTop: 6, fontSize: 11 }}>
              + Add condition
            </button>
          </div>

          {/* Action */}
          <div>
            <label style={lbl()}>Action</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select value={rule.action?.type || "set_category"} onChange={e => {
                const type = e.target.value;
                // Reset value appropriately when switching action types
                if (type === "set_category")       setAction({ type, value: "" });
                else if (type === "mark_transfer") setAction({ type, value: "" });
                else if (type === "set_custom")    setAction({ type, columnId: "", customValue: "" });
              }} style={inp()}>
                <option value="set_category">Set category</option>
                <option value="mark_transfer">Mark as transfer</option>
                <option value="set_custom">Set custom field</option>
              </select>

              {rule.action?.type === "set_category" && (
                <select value={rule.action.value || ""} onChange={e => setAction({ value: e.target.value })} style={inp()}>
                  <option value="">— pick a category —</option>
                  {allCatOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {rule.action?.type === "mark_transfer" && (
                <div style={{ fontSize: 12, color: "var(--tx3, #888)", alignSelf: "center", paddingLeft: 4 }}>
                  Flags the row as a transfer (excluded from spending totals).
                </div>
              )}
              {rule.action?.type === "set_custom" && (
                <>
                  <select value={rule.action.columnId || ""} onChange={e => setAction({ columnId: e.target.value })} style={inp()}>
                    <option value="">— pick a column —</option>
                    {(transactionColumns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input value={rule.action.customValue ?? ""} onChange={e => setAction({ customValue: e.target.value })}
                    placeholder="value" style={{ ...inp(), gridColumn: "1 / -1" }} />
                </>
              )}
            </div>
          </div>

          {!valid && (
            <div style={{ marginTop: 10, padding: 8, background: "rgba(232, 87, 58, 0.08)", borderLeft: "3px solid #E8573A", borderRadius: 4, fontSize: 12, color: "var(--tx, #333)" }}>
              {errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* A single condition row — field, operator, value (+ value2 for 'between'). */
function ConditionEditor({ cond, onChange, customColOptions = [], canRemove, onRemove }) {
  const op = cond?.operator || "contains";
  const isNumeric = ["gt", "gte", "lt", "lte", "between"].includes(op);
  const isEmptyCheck = ["is_empty", "is_not_empty"].includes(op);
  const isRegex = op === "regex";

  return (
    <div style={{ display: "grid", gridTemplateColumns: isNumeric && op === "between" ? "1fr 1fr 1fr 1fr auto" : "1fr 1fr 2fr auto", gap: 6, alignItems: "center", marginBottom: 6 }}>
      <select value={cond?.field || "description"} onChange={e => onChange({ field: e.target.value })} style={inp()}>
        <option value="description">Description</option>
        <option value="amount">Amount</option>
        <option value="account">Account</option>
        <option value="category">Category</option>
        <option value="notes">Notes</option>
        {customColOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <select value={op} onChange={e => onChange({ operator: e.target.value })} style={inp()}>
        <optgroup label="Text">
          <option value="contains">contains</option>
          <option value="not_contains">doesn't contain</option>
          <option value="equals">equals</option>
          <option value="not_equals">doesn't equal</option>
          <option value="starts_with">starts with</option>
          <option value="ends_with">ends with</option>
          <option value="regex">matches regex</option>
        </optgroup>
        <optgroup label="Number">
          <option value="gt">greater than</option>
          <option value="gte">≥</option>
          <option value="lt">less than</option>
          <option value="lte">≤</option>
          <option value="between">between</option>
        </optgroup>
        <optgroup label="Empty">
          <option value="is_empty">is empty</option>
          <option value="is_not_empty">is not empty</option>
        </optgroup>
      </select>

      {isEmptyCheck ? (
        <span style={{ fontSize: 12, color: "var(--tx3, #888)", padding: "0 6px" }}>—</span>
      ) : op === "between" ? (
        <>
          <input type="number" value={cond?.value ?? ""} onChange={e => onChange({ value: e.target.value === "" ? "" : Number(e.target.value) })} placeholder="min" style={inp()} />
          <input type="number" value={cond?.value2 ?? ""} onChange={e => onChange({ value2: e.target.value === "" ? "" : Number(e.target.value) })} placeholder="max" style={inp()} />
        </>
      ) : (
        <input
          type={isNumeric ? "number" : "text"}
          value={cond?.value ?? ""}
          onChange={e => onChange({ value: isNumeric ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })}
          placeholder={isRegex ? "regex pattern" : "value"}
          style={inp()}
        />
      )}

      {canRemove ? (
        <button onClick={onRemove} title="Remove condition"
          style={{ border: "none", background: "none", color: "#E8573A", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>×</button>
      ) : (
        <span style={{ width: 16 }} />
      )}
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
const lbl = () => ({ display: "block", fontSize: 11, color: "var(--tx3, #888)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 });
const btn = (bg, color) => ({ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", background: bg, color, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" });
const th = { padding: "8px 10px", textAlign: "left", fontSize: 11, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 };
const td = { padding: "8px 10px", verticalAlign: "middle", color: "var(--tx, #333)" };

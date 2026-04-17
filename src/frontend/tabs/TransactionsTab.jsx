import { useState, useMemo, useEffect } from "react";
import { Card, SH, NI } from "../components/ui.jsx";
import {
  BUILTIN_COLUMNS, newTransaction,
  applyFilters, presetRange, sortTransactions,
  bulkSetField, bulkDelete,
} from "../utils/transactions.js";
import { fmt } from "../utils/calc.js";

const PRESETS = [
  { id: "",            label: "All time" },
  { id: "this_month",  label: "This month" },
  { id: "last_month",  label: "Last month" },
  { id: "ytd",         label: "YTD" },
  { id: "last_30",     label: "Last 30 days" },
  { id: "last_90",     label: "Last 90 days" },
  { id: "last_year",   label: "Last year" },
];

const TRANSFER_HINT_RX = /\btransfer\b|\bxfer\b/i;

export default function TransactionsTab(props) {
  const {
    mob,
    transactions, transactionColumns, hiddenColumns, setHiddenColumns,
    rowCapWarn, rowCapThreshold,
    cats, savCats,
    addTransactions, updateTransaction, deleteTransactions, setTransactions,
    txLoaded,
  } = props;

  const [preset, setPreset] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [catSel, setCatSel] = useState([]);
  const [acctSel, setAcctSel] = useState([]);
  const [amtMin, setAmtMin] = useState("");
  const [amtMax, setAmtMax] = useState("");
  const [sortField, setSortField] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [selected, setSelected] = useState(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkCat, setBulkCat] = useState("");
  const [bulkAcct, setBulkAcct] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 200;

  // Apply preset to date fields. "All time" (empty preset) clears dateFrom/dateTo.
  // Non-empty preset values resolve to a concrete date range.
  useEffect(() => {
    if (!preset) {
      setDateFrom("");
      setDateTo("");
      return;
    }
    const r = presetRange(preset);
    setDateFrom(r.dateFrom);
    setDateTo(r.dateTo);
  }, [preset]);

  // Sorted + filtered rows
  const visibleRows = useMemo(() => {
    const filtered = applyFilters(transactions, {
      dateFrom, dateTo, search,
      categories: catSel.length ? catSel : undefined,
      accounts: acctSel.length ? acctSel : undefined,
      amountMin: amtMin !== "" ? Number(amtMin) : undefined,
      amountMax: amtMax !== "" ? Number(amtMax) : undefined,
    });
    return sortTransactions(filtered, sortField, sortDir);
  }, [transactions, dateFrom, dateTo, search, catSel, acctSel, amtMin, amtMax, sortField, sortDir]);

  // Reset page on filter changes
  useEffect(() => { setPage(0); }, [dateFrom, dateTo, search, catSel, acctSel, amtMin, amtMax, sortField, sortDir]);

  const pageRows = useMemo(() => {
    const start = page * PAGE_SIZE;
    return visibleRows.slice(start, start + PAGE_SIZE);
  }, [visibleRows, page]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));

  // All distinct values for filter dropdowns
  const allCats = useMemo(() => {
    const s = new Set();
    transactions.forEach(t => { if (t.category) s.add(t.category); });
    return [...s].sort();
  }, [transactions]);
  const allAccts = useMemo(() => {
    const s = new Set();
    transactions.forEach(t => { if (t.account) s.add(t.account); });
    return [...s].sort();
  }, [transactions]);

  // All categories combined for the inline dropdown
  const allCategoryOptions = useMemo(() => {
    const s = new Set([...(cats || []), ...(savCats || [])]);
    transactions.forEach(t => { if (t.category) s.add(t.category); });
    return [...s].sort();
  }, [cats, savCats, transactions]);

  // Summary stats for the filtered view
  const filteredTotal = useMemo(() => visibleRows.reduce((s, t) => s + Number(t.amount), 0), [visibleRows]);
  const filteredIn = useMemo(() => visibleRows.reduce((s, t) => s + (Number(t.amount) > 0 ? Number(t.amount) : 0), 0), [visibleRows]);
  const filteredOut = useMemo(() => visibleRows.reduce((s, t) => s + (Number(t.amount) < 0 ? Number(t.amount) : 0), 0), [visibleRows]);
  const uncategorizedCount = useMemo(() => transactions.filter(t => !t.category).length, [transactions]);

  const visibleColumns = useMemo(() => {
    const all = [
      ...BUILTIN_COLUMNS,
      ...(transactionColumns || []).map(c => ({ ...c, builtin: false })),
    ];
    const hidden = new Set(hiddenColumns || []);
    return all.filter(c => !hidden.has(c.id));
  }, [transactionColumns, hiddenColumns]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === pageRows.length && pageRows.length > 0) setSelected(new Set());
    else setSelected(new Set(pageRows.map(r => r.id)));
  };

  const clearFilters = () => {
    setPreset(""); setDateFrom(""); setDateTo(""); setSearch("");
    setCatSel([]); setAcctSel([]); setAmtMin(""); setAmtMax("");
  };

  const bulkApplyCategory = async () => {
    if (!bulkCat) return;
    const ids = new Set(selected);
    setTransactions(prev => bulkSetField(prev, ids, "category", bulkCat));
    // persist by sending one PUT per row (deploy); generic is no-op since setTransactions already updated
    for (const id of ids) {
      const tx = visibleRows.find(r => r.id === id);
      if (tx) updateTransaction({ ...tx, category: bulkCat });
    }
    setShowBulk(false); setBulkCat(""); setSelected(new Set());
  };

  const bulkApplyAccount = async () => {
    if (!bulkAcct) return;
    const ids = new Set(selected);
    setTransactions(prev => bulkSetField(prev, ids, "account", bulkAcct));
    for (const id of ids) {
      const tx = visibleRows.find(r => r.id === id);
      if (tx) updateTransaction({ ...tx, account: bulkAcct });
    }
    setShowBulk(false); setBulkAcct(""); setSelected(new Set());
  };

  const bulkDeleteRows = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} transaction${selected.size === 1 ? "" : "s"}?`)) return;
    await deleteTransactions(selected);
    setSelected(new Set());
  };

  const overCap = rowCapWarn && transactions.length > rowCapThreshold;

  if (!txLoaded) {
    return <Card><div style={{ padding: 24, textAlign: "center", color: "var(--tx3, #999)" }}>Loading transactions…</div></Card>;
  }

  return (
    <>
      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontWeight: 800, fontSize: mob ? 20 : 26, color: "var(--tx, #333)" }}>Transactions</h2>
            {uncategorizedCount > 0 && (
              <div style={{ fontSize: 12, color: "var(--tx3, #999)", marginTop: 4 }}>
                <span style={{ padding: "2px 8px", background: "rgba(232, 87, 58, 0.12)", color: "#E8573A", borderRadius: 10, fontWeight: 600 }}>{uncategorizedCount} uncategorized</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span onClick={() => setShowFilters(v => !v)} style={{ fontSize: 10, fontWeight: 700, color: showFilters ? "#556FB5" : "var(--tx3, #999)", textTransform: "uppercase", cursor: "pointer", padding: "4px 10px", border: `2px solid ${showFilters ? "#556FB5" : "var(--bdr, #ccc)"}`, borderRadius: 6, background: showFilters ? "#EEF1FA" : "transparent", userSelect: "none" }}>Filters {showFilters ? "▴" : "▾"}</span>
            <button onClick={() => setShowAdd(true)} style={btn("#2ECC71", "#fff")}>+ Add</button>
            <button disabled title="CSV import lands in Phase 4b" style={{ ...btn("var(--input-bg, #f5f5f5)", "var(--tx3, #aaa)"), cursor: "not-allowed" }}>📥 Import</button>
          </div>
        </div>

        {overCap && (
          <div style={{ padding: 12, background: "rgba(242, 169, 59, 0.12)", borderLeft: "4px solid #F2A93B", borderRadius: 6, fontSize: 13, color: "var(--tx, #333)", marginBottom: 12 }}>
            ⚠️ You have {transactions.length.toLocaleString()} transactions (threshold: {rowCapThreshold.toLocaleString()}).
            {" "}Large row counts can slow down browser-based persistence. Adjust the threshold on the Settings tab.
          </div>
        )}

        {showFilters && (
          <div style={{ background: "var(--input-bg, #fafafa)", padding: 12, borderRadius: 8, marginBottom: 12, display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 10 }}>
            <div>
              <label style={lbl()}>Search</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Description or notes…"
                style={inp()} />
            </div>
            <div>
              <label style={lbl()}>Date range</label>
              <div style={{ display: "flex", gap: 4 }}>
                <select value={preset} onChange={e => setPreset(e.target.value)} style={{ ...inp(), flex: 1 }}>
                  {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPreset(""); }} style={{ ...inp(), flex: 1 }} />
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPreset(""); }} style={{ ...inp(), flex: 1 }} />
              </div>
            </div>
            <div>
              <label style={lbl()}>Categories ({catSel.length || "all"})</label>
              <MultiSelect options={allCats} selected={catSel} onChange={setCatSel} placeholder="All categories" />
            </div>
            <div>
              <label style={lbl()}>Accounts ({acctSel.length || "all"})</label>
              <MultiSelect options={allAccts} selected={acctSel} onChange={setAcctSel} placeholder="All accounts" />
            </div>
            <div>
              <label style={lbl()}>Amount range</label>
              <div style={{ display: "flex", gap: 4 }}>
                <input type="number" step="0.01" value={amtMin} onChange={e => setAmtMin(e.target.value)} placeholder="Min" style={{ ...inp(), flex: 1 }} />
                <input type="number" step="0.01" value={amtMax} onChange={e => setAmtMax(e.target.value)} placeholder="Max" style={{ ...inp(), flex: 1 }} />
              </div>
            </div>
            <div style={{ alignSelf: "end" }}>
              <button onClick={clearFilters} style={btn("var(--card-bg, #fff)", "var(--tx, #333)")}>Clear filters</button>
            </div>
          </div>
        )}

        {/* Summary */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--tx2, #555)", marginBottom: 4 }}>
          <span><strong style={{ color: "var(--tx, #333)" }}>Money in:</strong> {fmt(filteredIn)}</span>
          <span><strong style={{ color: "var(--tx, #333)" }}>Money out:</strong> {fmt(filteredOut)}</span>
          <span><strong style={{ color: "var(--tx, #333)" }}>Net:</strong> {fmt(filteredTotal)}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--tx3, #999)", marginBottom: 8 }}>
          {visibleRows.length.toLocaleString()} of {transactions.length.toLocaleString()} rows
        </div>

        {selected.size > 0 && (
          <div style={{ padding: 10, background: "rgba(85, 111, 181, 0.08)", borderRadius: 8, marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <strong style={{ color: "var(--tx, #333)" }}>{selected.size} selected</strong>
            <button onClick={() => setShowBulk(true)} style={btn("#556FB5", "#fff")}>Bulk edit</button>
            <button onClick={bulkDeleteRows} style={btn("#E8573A", "#fff")}>Delete</button>
            <button onClick={() => setSelected(new Set())} style={btn("var(--card-bg, #fff)", "var(--tx2, #555)")}>Clear</button>
          </div>
        )}

        {showBulk && (
          <div style={{ padding: 12, background: "var(--input-bg, #fafafa)", borderRadius: 8, marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--tx2, #555)", fontWeight: 600 }}>Set category:</span>
            <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={inp()}>
              <option value="">— choose —</option>
              {allCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={bulkApplyCategory} disabled={!bulkCat} style={btn("#556FB5", "#fff")}>Apply</button>
            <span style={{ fontSize: 12, color: "var(--tx2, #555)", fontWeight: 600 }}>Set account:</span>
            <input value={bulkAcct} onChange={e => setBulkAcct(e.target.value)} placeholder="Account name" style={inp()} />
            <button onClick={bulkApplyAccount} disabled={!bulkAcct} style={btn("#556FB5", "#fff")}>Apply</button>
            <button onClick={() => { setShowBulk(false); setBulkCat(""); setBulkAcct(""); }} style={btn("var(--card-bg, #fff)", "var(--tx2, #555)")}>Close</button>
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 16, padding: 0, overflow: "auto" }}>
        {pageRows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--tx3, #999)" }}>
            {transactions.length === 0 ? "No transactions yet. Click + Add to create one, or use Import (coming in Phase 4b)." : "No transactions match your filters."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--input-bg, #fafafa)", borderBottom: "2px solid var(--bdr, #e0e0e0)" }}>
                <th style={{ ...th(), width: 32 }}>
                  <input type="checkbox"
                    checked={pageRows.length > 0 && pageRows.every(r => selected.has(r.id))}
                    onChange={toggleSelectAll} />
                </th>
                {visibleColumns.map(col => {
                  const sortKey = col.builtin || BUILTIN_COLUMNS.find(b => b.id === col.id) ? col.id : `custom.${col.id}`;
                  return (
                    <th key={col.id} onClick={() => toggleSort(sortKey)}
                      style={{ ...th(), cursor: "pointer", userSelect: "none", textAlign: col.type === "number" ? "right" : "left" }}>
                      {col.name}
                      {sortField === sortKey && <span style={{ marginLeft: 4, color: "var(--tx3, #999)" }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  );
                })}
                <th style={{ ...th(), width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(tx => (
                <TxRow key={tx.id}
                  tx={tx}
                  visibleColumns={visibleColumns}
                  selected={selected.has(tx.id)}
                  toggleSelect={() => toggleSelect(tx.id)}
                  allCategoryOptions={allCategoryOptions}
                  updateTransaction={updateTransaction}
                  deleteTransactions={deleteTransactions}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 12, fontSize: 13, color: "var(--tx2, #555)" }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={btn("var(--card-bg, #fff)", "var(--tx, #333)")}>← Prev</button>
          <span>Page {page + 1} of {totalPages} ({(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, visibleRows.length).toLocaleString()})</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={btn("var(--card-bg, #fff)", "var(--tx, #333)")}>Next →</button>
        </div>
      )}

      {showAdd && (
        <AddTransactionModal
          allCategoryOptions={allCategoryOptions}
          onSubmit={async (tx) => { await addTransactions([tx]); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </>
  );
}

/* ── Individual row ── */
function TxRow({ tx, visibleColumns, selected, toggleSelect, allCategoryOptions, updateTransaction, deleteTransactions }) {
  const [editing, setEditing] = useState(null); // field name currently being edited
  const [draft, setDraft] = useState("");

  const isTransferHint = TRANSFER_HINT_RX.test(tx.description || "");
  const isUncat = !tx.category;

  const rowBg = isUncat ? "rgba(242, 169, 59, 0.06)"
              : isTransferHint ? "rgba(120, 120, 120, 0.06)"
              : undefined;

  const startEdit = (field) => {
    setEditing(field);
    if (field === "category") setDraft(tx.category || "");
    else if (field === "account") setDraft(tx.account || "");
    else if (field === "notes") setDraft(tx.notes || "");
    else if (field === "description") setDraft(tx.description || "");
    else if (field === "date") setDraft(tx.date || "");
    else if (field === "amount") setDraft(String(tx.amount ?? ""));
  };
  const commitEdit = () => {
    if (!editing) return;
    let value = draft;
    if (editing === "amount") value = Number(draft) || 0;
    updateTransaction({ ...tx, [editing]: value });
    setEditing(null);
  };

  return (
    <tr style={{ borderBottom: "1px solid var(--bdr2, #eee)", background: rowBg, fontStyle: isTransferHint ? "italic" : "normal" }}>
      <td style={td()}><input type="checkbox" checked={selected} onChange={toggleSelect} /></td>
      {visibleColumns.map(col => (
        <td key={col.id} style={{ ...td(), textAlign: col.type === "number" ? "right" : "left" }} onDoubleClick={() => startEdit(col.id)}>
          {renderCell(tx, col, editing, draft, setDraft, commitEdit, startEdit, allCategoryOptions, updateTransaction)}
        </td>
      ))}
      <td style={td()}>
        <button title="Delete" onClick={() => { if (confirm("Delete this transaction?")) deleteTransactions(new Set([tx.id])); }}
          style={{ border: "none", background: "none", color: "var(--tx3, #999)", cursor: "pointer", fontSize: 14 }}>×</button>
      </td>
    </tr>
  );
}

function renderCell(tx, col, editing, draft, setDraft, commitEdit, startEdit, allCategoryOptions, updateTransaction) {
  if (col.id === "category") {
    // Inline dropdown, always editable — no double-click needed for category since it's the most common edit
    return (
      <select value={tx.category || ""} className="cat-dd"
        onChange={e => updateTransaction({ ...tx, category: e.target.value || null })}
        style={{ color: tx.category ? "var(--tx, #333)" : "#F2A93B" }}>
        <option value="">— uncategorized —</option>
        {allCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  const isEditing = editing === col.id;
  if (isEditing) {
    if (col.id === "date") {
      return <input type="date" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commitEdit}
        onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setDraft(tx[col.id] || ""); }}
        style={{ padding: 2, fontSize: 13, width: "100%", border: "1px solid #556FB5", borderRadius: 4 }} />;
    }
    if (col.id === "amount") {
      return <input type="number" step="0.01" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commitEdit}
        onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
        style={{ padding: 2, fontSize: 13, width: "100%", textAlign: "right", border: "1px solid #556FB5", borderRadius: 4 }} />;
    }
    return <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commitEdit}
      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
      style={{ padding: 2, fontSize: 13, width: "100%", border: "1px solid #556FB5", borderRadius: 4 }} />;
  }
  // Normal render
  if (col.id === "amount") {
    const n = Number(tx.amount);
    return <span style={{ color: n < 0 ? "var(--c-dis, #E8573A)" : n > 0 ? "var(--c-sav, #2ECC71)" : "var(--tx2, #555)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(n)}</span>;
  }
  if (col.id === "date") {
    return <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--tx2, #555)" }}>{tx.date}</span>;
  }
  if (!col.builtin && !BUILTIN_COLUMNS.find(b => b.id === col.id)) {
    const v = tx.custom_fields?.[col.id];
    if (v === undefined || v === null || v === "") return <span style={{ color: "var(--tx3, #ccc)" }}>—</span>;
    return <span>{String(v)}</span>;
  }
  const v = tx[col.id];
  if (v === undefined || v === null || v === "") return <span style={{ color: "var(--tx3, #ccc)" }}>—</span>;
  return <span>{String(v)}</span>;
}

// Helper no longer needed — renderCell receives updateTransaction directly.

/* ── Multi-select dropdown (checkboxes in a popover) ── */
function MultiSelect({ options, selected, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const label = selected.length === 0 ? (placeholder || "All") : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{ ...inp(), width: "100%", textAlign: "left", cursor: "pointer" }}>
        {label} <span style={{ float: "right" }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--card-bg, #fff)", border: "1px solid var(--bdr, #e0e0e0)", borderRadius: 6, zIndex: 10, maxHeight: 240, overflowY: "auto", boxShadow: "var(--shadow, 0 4px 12px rgba(0,0,0,.1))", padding: 4 }}>
          {options.length === 0 && <div style={{ padding: 8, color: "var(--tx3, #999)", fontSize: 12 }}>No options yet</div>}
          {options.map(o => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={selected.includes(o)} onChange={() => {
                if (selected.includes(o)) onChange(selected.filter(x => x !== o));
                else onChange([...selected, o]);
              }} />
              {o}
            </label>
          ))}
          <div style={{ borderTop: "1px solid var(--bdr2, #eee)", padding: "4px 8px", display: "flex", gap: 8 }}>
            <button onClick={() => onChange([])} style={{ background: "none", border: "none", color: "#556FB5", cursor: "pointer", fontSize: 12 }}>Clear</button>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--tx2, #555)", cursor: "pointer", fontSize: 12, marginLeft: "auto" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Add transaction modal ── */
function AddTransactionModal({ allCategoryOptions, onSubmit, onClose }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("USD");

  const submit = () => {
    if (!date || amount === "") { alert("Date and amount are required."); return; }
    onSubmit({
      date, amount: Number(amount), description: desc, account,
      category: category || null, notes: notes || null, currency,
    });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", padding: 24, borderRadius: 12, maxWidth: 480, width: "100%", color: "var(--tx, #333)" }}>
        <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontWeight: 800, fontSize: 20 }}>Add transaction</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={lbl()}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp()} />
          </div>
          <div>
            <label style={lbl()}>Amount (negative = expense)</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="-25.50" style={inp()} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={lbl()}>Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Starbucks" style={inp()} />
          </div>
          <div>
            <label style={lbl()}>Account</label>
            <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Visa" style={inp()} />
          </div>
          <div>
            <label style={lbl()}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={inp()}>
              <option value="">— none —</option>
              {allCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={lbl()}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} style={inp()} />
          </div>
          <div>
            <label style={lbl()}>Currency</label>
            <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} style={inp()} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}>Cancel</button>
          <button onClick={submit} style={btn("#2ECC71", "#fff")}>Add</button>
        </div>
      </div>
    </div>
  );
}

/* ── tiny style helpers, kept local so we don't bloat ui.jsx ── */
const inp = () => ({ padding: 6, fontSize: 13, borderRadius: 6, border: "1px solid var(--input-border, #e0e0e0)", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #333)", fontFamily: "'DM Sans',sans-serif", width: "100%", boxSizing: "border-box" });
const lbl = () => ({ display: "block", fontSize: 11, color: "var(--tx3, #888)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 });
const btn = (bg, color) => ({ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", background: bg, color, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" });
const th = () => ({ padding: 10, textAlign: "left", fontSize: 11, color: "var(--tx3, #999)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 });
const td = () => ({ padding: "8px 10px", verticalAlign: "middle" });

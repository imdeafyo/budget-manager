import { useState, useMemo, useEffect } from "react";
import { Card, SH, NI } from "../components/ui.jsx";
import {
  BUILTIN_COLUMNS, newTransaction,
  applyFilters, presetRange, sortTransactions,
  bulkSetField, bulkDelete, countSplitRowsInSet,
} from "../utils/transactions.js";
import {
  buildRuleFromExample, evaluateRule, applyRulesToTransaction,
} from "../utils/rules.js";
import {
  newSplit, seedSplits, validateSplits, autoBalance, splitRemainder,
  sumSplits, sanitizeSplits, hasSplits, scaleSplits,
} from "../utils/splits.js";
import {
  findTransferCandidates, applyPairs, applyDismissals, unpair as unpairTx,
  isMarkedTransfer, pairReason,
} from "../utils/transfers.js";
import { fmt } from "../utils/calc.js";
import ImportModal from "../components/ImportModal.jsx";

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
    cats, savCats, transferCats = [],
    addTransactions, updateTransaction, deleteTransactions, setTransactions,
    importProfiles, setImportProfiles,
    transactionRules = [], setTransactionRules,
    transferToleranceAmount = 0.01,
    transferToleranceDays = 2,
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
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkCat, setBulkCat] = useState("");
  const [bulkAcct, setBulkAcct] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 200;

  // Remember-my-choice modal — fires when the user manually sets a category
  // on a row whose description doesn't already match an existing rule.
  // pendingCategorize = { tx, newCategory } while the modal is open.
  const [pendingCategorize, setPendingCategorize] = useState(null);

  // Split editor — holds the transaction currently being edited (null when closed).
  const [splitEditorTx, setSplitEditorTx] = useState(null);
  // Global "expand all splits in the filtered view" toggle.
  const [expandAllSplits, setExpandAllSplits] = useState(false);

  // Transfer detection modal — { pairs, selected: Set<pairKey> } while open, null otherwise.
  // pairKey = `${aId}|${bId}` — stable per candidate, survives re-sorts.
  const [transferModal, setTransferModal] = useState(null);

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
    const s = new Set([...(cats || []), ...(savCats || []), ...(transferCats || [])]);
    transactions.forEach(t => { if (t.category) s.add(t.category); });
    return [...s].sort();
  }, [cats, savCats, transferCats, transactions]);

  // A Set of transfer category names so we can style/exclude transfer rows.
  // Kept as state-derived so changes in Categories tab reflect immediately.
  const transferCatSet = useMemo(() => new Set(transferCats || []), [transferCats]);

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
    const skipped = countSplitRowsInSet(transactions, ids);
    if (skipped === ids.size) {
      alert("All selected rows have splits — their category is controlled by the splits, not a bulk-set value. Use the split editor (📑) to change those allocations.");
      return;
    }
    if (skipped > 0) {
      const affected = ids.size - skipped;
      const msg = `${skipped} selected row${skipped === 1 ? "" : "s"} have splits and will be skipped (their split allocations are kept as-is).\n\n` +
                  `Apply "${bulkCat}" to the other ${affected} row${affected === 1 ? "" : "s"}?`;
      if (!confirm(msg)) return;
    }
    setTransactions(prev => bulkSetField(prev, ids, "category", bulkCat));
    // persist by sending one PUT per row (deploy); generic is no-op since setTransactions already updated
    for (const id of ids) {
      const tx = visibleRows.find(r => r.id === id);
      if (tx && !hasSplits(tx)) updateTransaction({ ...tx, category: bulkCat });
    }
    // Offer to remember this for future imports — use the first non-split selected row.
    const firstTx = Array.from(ids).map(id => transactions.find(t => t.id === id)).filter(Boolean).find(t => !hasSplits(t));
    if (firstTx) maybeOfferRule(firstTx, bulkCat);
    setShowBulk(false); setBulkCat(""); setSelected(new Set());
  };

  /* Wrap updateTransaction so edits that touch `amount` on a split row trigger
     the proportional-scale-vs-clear prompt. All other edits pass through. */
  const handleUpdateTransaction = (nextTx) => {
    const prev = transactions.find(t => t.id === nextTx.id);
    if (prev && hasSplits(prev) && Number(prev.amount) !== Number(nextTx.amount)) {
      // Amount changed on a row that has splits — ask how to handle.
      const prevAmt = Number(prev.amount) || 0;
      const nextAmt = Number(nextTx.amount) || 0;
      const msg = `This row has ${prev.splits.length} split${prev.splits.length === 1 ? "" : "s"} totaling ${prevAmt.toFixed(2)}.\n\n` +
                  `OK — scale splits proportionally to match the new total (${nextAmt.toFixed(2)}).\n` +
                  `Cancel — clear all splits.`;
      if (confirm(msg)) {
        const scaled = scaleSplits(prev.splits, prevAmt, nextAmt);
        updateTransaction({ ...nextTx, splits: scaled });
      } else {
        updateTransaction({ ...nextTx, splits: null });
      }
      return;
    }
    updateTransaction(nextTx);
  };

  /* ── Manual-categorize interception ──
     Called by the inline category dropdown when the user picks a new value.
     We always apply the change immediately (no waiting on a modal), then
     decide whether to prompt for rule creation as a follow-up. */
  const handleManualCategorize = (tx, newCategory) => {
    updateTransaction({ ...tx, category: newCategory });
    if (!newCategory) return; // don't prompt when clearing a category
    maybeOfferRule(tx, newCategory);
  };

  /* Decide whether the remember-my-choice modal should appear.
     Skip if:
       - any enabled rule already matches this description (they already have one)
       - there's no setTransactionRules prop (rules feature not wired) */
  const maybeOfferRule = (tx, newCategory) => {
    if (!setTransactionRules) return;
    if (!tx?.description) return;
    const alreadyMatched = transactionRules.some(r => r.enabled && evaluateRule(tx, r));
    if (alreadyMatched) return;
    setPendingCategorize({ tx, newCategory });
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
  const anyHasSplits = useMemo(() => transactions.some(t => hasSplits(t)), [transactions]);

  // How many rows are currently marked as transfers — used to show a small
  // count next to the "Detect transfers" button so the user can see at a
  // glance that the feature is doing something.
  const markedTransferCount = useMemo(
    () => transactions.reduce((n, t) => n + (isMarkedTransfer(t) ? 1 : 0), 0),
    [transactions]
  );

  const runTransferScan = (includeDismissed = false) => {
    // When including dismissed rows, strip the flag *in a scan-only copy* so
    // the candidate generator treats them as eligible. We don't mutate state
    // here — the dismissed flag gets cleared for real only if the user pairs
    // the row (markPaired clears _transfer_dismissed as a side effect).
    const rows = includeDismissed
      ? transactions.map(t => {
          if (!t.custom_fields?._transfer_dismissed) return t;
          const cf = { ...t.custom_fields };
          delete cf._transfer_dismissed;
          return { ...t, custom_fields: cf };
        })
      : transactions;
    return findTransferCandidates(rows, {
      amountTolerance: Number(transferToleranceAmount) || 0.01,
      dayTolerance:    Number(transferToleranceDays)  || 2,
      requireDifferentAccounts: true,
    });
  };

  const openTransferDetection = () => {
    const pairs = runTransferScan(false);
    const selected = new Set(pairs.map(p => `${p.a.id}|${p.b.id}`));
    setTransferModal({ pairs, selected, includeDismissed: false });
  };

  const rescanIncludingDismissed = (include) => {
    const pairs = runTransferScan(include);
    const selected = new Set(pairs.map(p => `${p.a.id}|${p.b.id}`));
    setTransferModal(m => ({ ...(m || {}), pairs, selected, includeDismissed: include }));
  };

  const commitTransferPairs = () => {
    if (!transferModal) return;
    const { pairs, selected } = transferModal;
    const keep = pairs.filter(p => selected.has(`${p.a.id}|${p.b.id}`));
    if (!keep.length) { setTransferModal(null); return; }
    const pairIds = keep.map(p => ({ aId: p.a.id, bId: p.b.id }));
    setTransactions(prev => applyPairs(prev, pairIds));
    setTransferModal(null);
  };

  const dismissSelectedPairs = () => {
    if (!transferModal) return;
    const { pairs, selected } = transferModal;
    const keep = pairs.filter(p => selected.has(`${p.a.id}|${p.b.id}`));
    if (!keep.length) { setTransferModal(null); return; }
    const pairIds = keep.map(p => ({ aId: p.a.id, bId: p.b.id }));
    setTransactions(prev => applyDismissals(prev, pairIds));
    setTransferModal(null);
  };

  const handleUnpair = (tx) => {
    if (!tx) return;
    const partnerId = tx.custom_fields?._transfer_pair_id;
    // Unpair both halves — symmetric flags are the invariant.
    updateTransaction(unpairTx(tx));
    if (partnerId) {
      const partner = transactions.find(t => t.id === partnerId);
      if (partner) updateTransaction(unpairTx(partner));
    }
  };

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
            {anyHasSplits && (
              <span onClick={() => setExpandAllSplits(v => !v)}
                title={expandAllSplits ? "Collapse all split details" : "Show all split details inline"}
                style={{ fontSize: 10, fontWeight: 700, color: expandAllSplits ? "#556FB5" : "var(--tx3, #999)", textTransform: "uppercase", cursor: "pointer", padding: "4px 10px", border: `2px solid ${expandAllSplits ? "#556FB5" : "var(--bdr, #ccc)"}`, borderRadius: 6, background: expandAllSplits ? "#EEF1FA" : "transparent", userSelect: "none" }}>
                📑 Splits {expandAllSplits ? "▴" : "▾"}
              </span>
            )}
            {transactions.length > 1 && (
              <span onClick={openTransferDetection}
                title="Scan for paired transfers between accounts"
                style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3, #999)", textTransform: "uppercase", cursor: "pointer", padding: "4px 10px", border: "2px solid var(--bdr, #ccc)", borderRadius: 6, background: "transparent", userSelect: "none" }}>
                🔀 Detect transfers{markedTransferCount > 0 ? ` · ${markedTransferCount}` : ""}
              </span>
            )}
            <button onClick={() => setShowAdd(true)} style={btn("#2ECC71", "#fff")}>+ Add</button>
            <button onClick={() => setShowImport(true)} style={btn("#556FB5", "#fff")}>📥 Import</button>
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
                  transferCatSet={transferCatSet}
                  updateTransaction={handleUpdateTransaction}
                  deleteTransactions={deleteTransactions}
                  onManualCategorize={handleManualCategorize}
                  onOpenSplitEditor={(t) => setSplitEditorTx(t)}
                  onUnpair={handleUnpair}
                  forceExpandSplits={expandAllSplits}
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

      {showImport && (
        <ImportModal
          existingTransactions={transactions}
          addTransactions={addTransactions}
          importProfiles={importProfiles || []}
          setImportProfiles={setImportProfiles}
          transactionColumns={transactionColumns || []}
          budgetCategories={allCategoryOptions}
          transactionRules={transactionRules}
          setTransactionRules={setTransactionRules}
          onClose={(result) => {
            setShowImport(false);
            if (result && result.added > 0) {
              setImportResult(result);
              setTimeout(() => setImportResult(null), 5000);
            }
          }}
        />
      )}

      {pendingCategorize && setTransactionRules && (
        <RememberChoiceModal
          tx={pendingCategorize.tx}
          category={pendingCategorize.newCategory}
          allCategoryOptions={allCategoryOptions}
          existingRules={transactionRules}
          onDismiss={() => setPendingCategorize(null)}
          onSaveRule={(rule, applyToExisting) => {
            setTransactionRules(prev => [...prev, rule]);
            if (applyToExisting) {
              // Sweep all transactions and apply the new rule only (don't clobber existing).
              setTransactions(prev => prev.map(t => {
                if (t.id === pendingCategorize.tx.id) return t; // already categorized manually above
                const { tx: updated, matchedRuleIds } = applyRulesToTransaction(t, [rule]);
                return matchedRuleIds.length ? updated : t;
              }));
            }
            setPendingCategorize(null);
          }}
        />
      )}

      {splitEditorTx && (
        <SplitEditor
          tx={splitEditorTx}
          allCategoryOptions={allCategoryOptions}
          onClose={() => setSplitEditorTx(null)}
          onSave={(nextSplits) => {
            const clean = sanitizeSplits(nextSplits);
            // If we sanitize to nothing, strip the field entirely
            updateTransaction({ ...splitEditorTx, splits: clean });
            setSplitEditorTx(null);
          }}
          onClearAll={() => {
            if (!confirm("Remove all splits from this transaction?")) return;
            updateTransaction({ ...splitEditorTx, splits: null });
            setSplitEditorTx(null);
          }}
        />
      )}

      {transferModal && (
        <TransferPairsModal
          pairs={transferModal.pairs}
          selected={transferModal.selected}
          includeDismissed={!!transferModal.includeDismissed}
          onToggleIncludeDismissed={rescanIncludingDismissed}
          onToggle={(key) => setTransferModal(m => {
            const next = new Set(m.selected);
            if (next.has(key)) next.delete(key); else next.add(key);
            return { ...m, selected: next };
          })}
          onSelectAll={() => setTransferModal(m => ({ ...m, selected: new Set(m.pairs.map(p => `${p.a.id}|${p.b.id}`)) }))}
          onSelectNone={() => setTransferModal(m => ({ ...m, selected: new Set() }))}
          onClose={() => setTransferModal(null)}
          onConfirm={commitTransferPairs}
          onDismissSelected={dismissSelectedPairs}
        />
      )}

      {importResult && (
        <div style={{ position: "fixed", bottom: 20, right: 20, padding: "12px 18px", background: "#2ECC71", color: "#fff", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.15)", fontSize: 14, fontWeight: 600, zIndex: 300 }}>
          ✓ Imported {importResult.added} transaction{importResult.added === 1 ? "" : "s"}
        </div>
      )}
    </>
  );
}

/* ── Individual row ── */
function TxRow({ tx, visibleColumns, selected, toggleSelect, allCategoryOptions, transferCatSet, updateTransaction, deleteTransactions, onManualCategorize, onOpenSplitEditor, onUnpair, forceExpandSplits }) {
  const [editing, setEditing] = useState(null); // field name currently being edited
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const txHasSplits = Array.isArray(tx.splits) && tx.splits.length > 0;
  const showChildren = txHasSplits && (expanded || forceExpandSplits);

  const isTransferHint   = TRANSFER_HINT_RX.test(tx.description || "");
  const isTransferCat    = transferCatSet && tx.category && transferCatSet.has(tx.category);
  const isTransferFlag   = !!tx.custom_fields?._is_transfer;
  const isPaired         = !!tx.custom_fields?._transfer_pair_id;
  const isTransfer       = isTransferHint || isTransferCat || isTransferFlag;
  // A row with splits isn't uncategorized even if tx.category is null — the
  // splits carry the allocations. Treat it as categorized.
  const isUncat = !tx.category && !txHasSplits;

  const rowBg = isUncat ? "rgba(242, 169, 59, 0.06)"
              : isTransfer ? "rgba(120, 120, 120, 0.06)"
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
    <>
      <tr style={{ borderBottom: showChildren ? "1px solid transparent" : "1px solid var(--bdr2, #eee)", background: rowBg, fontStyle: isTransfer ? "italic" : "normal" }}>
        <td style={td()}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {txHasSplits ? (
              <button onClick={() => setExpanded(v => !v)}
                title={expanded ? "Collapse splits" : "Show splits"}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, fontSize: 10, color: "var(--tx3, #999)", width: 14, textAlign: "center" }}>
                {expanded || forceExpandSplits ? "▾" : "▸"}
              </button>
            ) : <span style={{ width: 14 }} />}
            <input type="checkbox" checked={selected} onChange={toggleSelect} />
          </div>
        </td>
        {visibleColumns.map(col => (
          <td key={col.id} style={{ ...td(), textAlign: col.type === "number" ? "right" : "left" }} onDoubleClick={() => startEdit(col.id)}>
            {renderCell(tx, col, editing, draft, setDraft, commitEdit, startEdit, allCategoryOptions, updateTransaction, onManualCategorize)}
          </td>
        ))}
        <td style={td()}>
          <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
            {isPaired && onUnpair && (
              <button title="Unpair transfer (will be excluded from future auto-detection)"
                onClick={() => onUnpair(tx)}
                style={{ border: "none", background: "none", color: "#556FB5", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>↩</button>
            )}
            {onOpenSplitEditor && (
              <button title={txHasSplits ? "Edit splits" : "Split this transaction"}
                onClick={() => onOpenSplitEditor(tx)}
                style={{ border: "none", background: "none", color: txHasSplits ? "#556FB5" : "var(--tx3, #999)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>📑</button>
            )}
            <button title="Delete" onClick={() => { if (confirm("Delete this transaction?")) deleteTransactions(new Set([tx.id])); }}
              style={{ border: "none", background: "none", color: "var(--tx3, #999)", cursor: "pointer", fontSize: 14 }}>×</button>
          </div>
        </td>
      </tr>
      {showChildren && tx.splits.map((sp, i) => (
        <tr key={sp.id || i} style={{
          background: "var(--input-bg, #fafafa)",
          fontSize: 12,
          color: "var(--tx2, #555)",
          borderBottom: i === tx.splits.length - 1 ? "1px solid var(--bdr2, #eee)" : undefined,
        }}>
          <td style={td()} />
          {visibleColumns.map(col => {
            const style = { ...td(), padding: "4px 10px", textAlign: col.type === "number" ? "right" : "left" };
            if (col.id === "date") return <td key={col.id} style={style} />;
            if (col.id === "description") return (
              <td key={col.id} style={style}>
                <span style={{ paddingLeft: 18, color: "var(--tx3, #888)" }}>
                  ↳ {sp.notes || <em style={{ color: "var(--tx3, #bbb)" }}>split {i + 1}</em>}
                </span>
              </td>
            );
            if (col.id === "amount") return (
              <td key={col.id} style={{ ...style, fontVariantNumeric: "tabular-nums" }}>
                {fmt(Number(sp.amount) || 0)}
              </td>
            );
            if (col.id === "category") return (
              <td key={col.id} style={style}>
                <span style={{ color: "var(--tx, #333)", fontWeight: 600 }}>
                  {sp.category || <em style={{ color: "var(--tx3, #aaa)" }}>—</em>}
                </span>
              </td>
            );
            return <td key={col.id} style={style} />;
          })}
          <td style={td()} />
        </tr>
      ))}
    </>
  );
}

function renderCell(tx, col, editing, draft, setDraft, commitEdit, startEdit, allCategoryOptions, updateTransaction, onManualCategorize) {
  if (col.id === "category") {
    const hasSplits = Array.isArray(tx.splits) && tx.splits.length > 0;
    if (hasSplits) {
      // Splits are authoritative — show a read-only summary. Click the 📑
      // button in the actions column to edit. Still show the parent's own
      // category label (if any) as context, like "Target · 2 splits".
      const n = tx.splits.length;
      const title = `${n} split${n === 1 ? "" : "s"}: ${tx.splits.map(s => s.category || "—").join(", ")}`;
      return (
        <span title={title} style={{ fontSize: 12, color: "var(--tx2, #555)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {tx.category && <span style={{ color: "var(--tx3, #888)" }}>{tx.category}</span>}
          <span style={{ padding: "1px 6px", background: "rgba(85, 111, 181, 0.12)", color: "#556FB5", borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
            {n} split{n === 1 ? "" : "s"}
          </span>
        </span>
      );
    }
    // Inline dropdown, always editable — no double-click needed for category since it's the most common edit
    const handleCategoryChange = (newValue) => {
      const next = newValue || null;
      if (next === (tx.category || null)) return;
      // Route through parent if a handler is provided (triggers remember-my-choice modal).
      // Otherwise fall back to a direct update — keeps the component usable without the modal wiring.
      if (onManualCategorize) onManualCategorize(tx, next);
      else updateTransaction({ ...tx, category: next });
    };
    return (
      <select value={tx.category || ""} className="cat-dd"
        onChange={e => handleCategoryChange(e.target.value)}
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

/* ── Remember-my-choice modal ──
   Fires after the user manually recategorizes a row. Offers to save a rule that
   will auto-categorize similar transactions going forward. Three paths:
     [Just this one]    — do nothing, dismiss.
     [Create rule]      — add the starter rule (contains <signature> → category).
     [Customize rule…]  — let the user tweak match text/operator before saving.
   An "Also apply to existing transactions" checkbox sweeps past rows. */
function RememberChoiceModal({ tx, category, allCategoryOptions, existingRules, onDismiss, onSaveRule }) {
  const initialRule = useMemo(() => buildRuleFromExample(tx, category), [tx, category]);
  const [customize, setCustomize] = useState(false);
  const [draftRule, setDraftRule] = useState(initialRule);
  const [applyToExisting, setApplyToExisting] = useState(true);

  const primaryCond = draftRule.conditions[0] || { field: "description", operator: "contains", value: "" };
  const setPrimary = (patch) => {
    const next = { ...primaryCond, ...patch };
    setDraftRule({ ...draftRule, conditions: [next] });
  };

  // Heuristic: does this starter rule look similar to an existing one?
  // If yes, we suggest the user not create a duplicate.
  const looksLikeExisting = existingRules.some(r => {
    const c = r.conditions?.[0];
    return c && c.field === primaryCond.field && c.operator === primaryCond.operator
      && String(c.value || "").toLowerCase() === String(primaryCond.value || "").toLowerCase();
  });

  const save = () => {
    // Give the rule a sensible auto-generated name if the user hasn't customized one
    const name = draftRule.name && draftRule.name.trim() !== "New rule"
      ? draftRule.name
      : `${primaryCond.value || "Match"} → ${category}`;
    onSaveRule({ ...draftRule, name, updatedAt: new Date().toISOString() }, applyToExisting);
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "var(--card-bg, #fff)", color: "var(--card-color, #222)", borderRadius: 12, padding: 24, maxWidth: 520, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <h3 style={{ margin: "0 0 6px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800 }}>Remember this?</h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--tx2, #555)", lineHeight: 1.5 }}>
          You categorized <strong>{tx.description}</strong> as <strong>{category}</strong>. Want to do this automatically for future transactions?
        </p>

        {looksLikeExisting && (
          <div style={{ padding: 10, marginBottom: 12, background: "rgba(242, 169, 59, 0.12)", borderLeft: "3px solid #F2A93B", borderRadius: 6, fontSize: 12, color: "var(--tx, #333)" }}>
            A rule that looks similar already exists — you may not need to create another one.
          </div>
        )}

        {!customize ? (
          <div style={{ padding: 12, background: "var(--input-bg, #fafafa)", borderRadius: 8, marginBottom: 16, fontSize: 13, fontFamily: "'DM Sans',sans-serif", border: "1px solid var(--bdr2, #eee)" }}>
            <div style={{ fontSize: 11, color: "var(--tx3, #888)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Suggested rule</div>
            <div style={{ color: "var(--tx, #333)" }}>
              When <strong>description</strong> contains <strong>"{primaryCond.value}"</strong>, set category to <strong>{category}</strong>.
            </div>
          </div>
        ) : (
          <div style={{ padding: 12, background: "var(--input-bg, #fafafa)", borderRadius: 8, marginBottom: 16, fontSize: 13, border: "1px solid var(--bdr2, #eee)" }}>
            <div style={{ fontSize: 11, color: "var(--tx3, #888)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Customize</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lbl()}>Field</label>
                <select value={primaryCond.field} onChange={e => setPrimary({ field: e.target.value })} style={inp()}>
                  <option value="description">Description</option>
                  <option value="account">Account</option>
                  <option value="amount">Amount</option>
                  <option value="notes">Notes</option>
                </select>
              </div>
              <div>
                <label style={lbl()}>Operator</label>
                <select value={primaryCond.operator} onChange={e => setPrimary({ operator: e.target.value })} style={inp()}>
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="starts_with">starts with</option>
                  <option value="ends_with">ends with</option>
                  <option value="regex">matches regex</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={lbl()}>Value</label>
              <input value={primaryCond.value || ""} onChange={e => setPrimary({ value: e.target.value })} style={inp()} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={lbl()}>Category to set</label>
              <select value={draftRule.action.value} onChange={e => setDraftRule({ ...draftRule, action: { ...draftRule.action, value: e.target.value } })} style={inp()}>
                {allCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl()}>Rule name</label>
              <input value={draftRule.name} onChange={e => setDraftRule({ ...draftRule, name: e.target.value })} style={inp()} />
            </div>
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tx2, #555)", marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={applyToExisting} onChange={e => setApplyToExisting(e.target.checked)} />
          Also apply to existing transactions that match
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={onDismiss} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}>Just this one</button>
          {!customize && (
            <button onClick={() => setCustomize(true)} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}>Customize rule…</button>
          )}
          <button onClick={save} style={btn("#556FB5", "#fff")}>Create rule</button>
        </div>
      </div>
    </div>
  );
}

/* ── Split editor modal ──
   Locked header shows the parent transaction's description + total. The body
   is a list of split rows (category dropdown + amount + optional notes + delete).
   Footer shows live sum/remainder and action buttons.

   Save is blocked until validateSplits() reports valid. On save, the caller
   gets the draft splits array (still may include empty rows); it's responsible
   for sanitization. */
function SplitEditor({ tx, allCategoryOptions, onClose, onSave, onClearAll }) {
  const parentAmt = Number(tx.amount) || 0;
  const startsWithSplits = hasSplits(tx);
  const [splits, setSplits] = useState(() => {
    if (startsWithSplits) return tx.splits.map(sp => ({ ...sp }));
    return seedSplits(tx);
  });

  const validation = validateSplits(splits, parentAmt);
  const remainder = splitRemainder(parentAmt, splits);
  const sum = sumSplits(splits);
  const isBalanced = Math.abs(remainder) < 0.005;

  const updateRow = (i, patch) => {
    setSplits(prev => {
      const n = [...prev];
      n[i] = { ...n[i], ...patch };
      return n;
    });
  };
  const removeRow = (i) => {
    setSplits(prev => prev.filter((_, j) => j !== i));
  };
  const addRow = () => {
    setSplits(prev => [...prev, newSplit({ amount: 0 })]);
  };
  const balance = () => {
    if (!splits.length) return;
    setSplits(prev => autoBalance(prev, parentAmt));
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "var(--card-bg, #fff)", color: "var(--card-color, #222)", borderRadius: 12, padding: 24, maxWidth: 620, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <h3 style={{ margin: "0 0 4px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800 }}>
          Split transaction
        </h3>
        <div style={{ fontSize: 13, color: "var(--tx2, #555)", marginBottom: 14, lineHeight: 1.5 }}>
          <strong>{tx.description || "(no description)"}</strong>
          <span style={{ color: "var(--tx3, #888)" }}> · {tx.date}</span>
          <div style={{ fontSize: 12, color: "var(--tx3, #888)", marginTop: 2 }}>
            Total: <strong style={{ color: "var(--tx, #333)", fontFamily: "monospace" }}>{fmt(parentAmt)}</strong>
          </div>
        </div>

        {/* Header row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 1fr 30px", gap: 8, marginBottom: 6, padding: "0 2px" }}>
          <div style={lbl()}>Category</div>
          <div style={{ ...lbl(), textAlign: "right" }}>Amount</div>
          <div style={lbl()}>Notes (optional)</div>
          <div />
        </div>

        {splits.map((sp, i) => (
          <div key={sp.id || i} style={{ display: "grid", gridTemplateColumns: "1fr 110px 1fr 30px", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <select value={sp.category || ""} onChange={e => updateRow(i, { category: e.target.value })} style={inp()}>
              <option value="">— pick —</option>
              {allCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" step="0.01" value={sp.amount === "" ? "" : sp.amount}
              onChange={e => updateRow(i, { amount: e.target.value === "" ? "" : Number(e.target.value) })}
              style={{ ...inp(), textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
            <input value={sp.notes || ""} onChange={e => updateRow(i, { notes: e.target.value })}
              placeholder="" style={inp()} />
            <button onClick={() => removeRow(i)} title="Remove split"
              style={{ border: "none", background: "none", color: "#E8573A", cursor: "pointer", fontSize: 16, padding: 0 }}
              disabled={splits.length <= 1}>×</button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button onClick={addRow} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}>+ Add split</button>
          <button onClick={balance} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}
            title="Set the last row's amount so the total matches">
            Auto-balance last row
          </button>
        </div>

        {/* Live sum / remainder readout */}
        <div style={{
          marginTop: 16, padding: 12,
          background: isBalanced ? "rgba(46, 204, 113, 0.08)" : "rgba(232, 87, 58, 0.08)",
          borderLeft: `3px solid ${isBalanced ? "#2ECC71" : "#E8573A"}`,
          borderRadius: 6, fontSize: 13, color: "var(--tx, #333)",
          fontFamily: "monospace",
          display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
        }}>
          <span>Splits sum: <strong>{fmt(sum)}</strong> / {fmt(parentAmt)}</span>
          <span>
            {isBalanced
              ? <span style={{ color: "#2ECC71", fontWeight: 700 }}>✓ balanced</span>
              : <span style={{ color: "#E8573A", fontWeight: 700 }}>remaining: {fmt(remainder)}</span>}
          </span>
        </div>

        {/* Show non-balance validation errors (e.g. missing category, mixed signs).
            Balance mismatch is already surfaced in the readout above. */}
        {(() => {
          const nonBalance = validation.errors.filter(e => !/^splits sum to/i.test(e));
          if (!nonBalance.length) return null;
          return (
            <div style={{ marginTop: 10, padding: 10, background: "rgba(232, 87, 58, 0.08)", borderLeft: "3px solid #E8573A", borderRadius: 4, fontSize: 12, color: "var(--tx, #333)" }}>
              {nonBalance.map((e, i) => <div key={i}>⚠ {e}</div>)}
            </div>
          );
        })()}

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            {startsWithSplits && (
              <button onClick={onClearAll} style={btn("transparent", "#E8573A")}
                title="Remove all splits and revert to a single-category row">
                Remove all splits
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}>Cancel</button>
            <button onClick={() => onSave(splits)} disabled={!validation.valid}
              style={{ ...btn("#556FB5", "#fff"), opacity: validation.valid ? 1 : 0.5, cursor: validation.valid ? "pointer" : "not-allowed" }}>
              Save splits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Transfer pairs modal ──
   Shows the candidate pairs from findTransferCandidates. Each pair has a
   checkbox; Confirm marks the checked pairs as transfers. Dismiss flags the
   checked pairs as "not a transfer, stop suggesting." The modal is purely
   presentational — the parent owns the state and commit logic. */
function TransferPairsModal({ pairs, selected, includeDismissed, onToggleIncludeDismissed, onToggle, onSelectAll, onSelectNone, onClose, onConfirm, onDismissSelected }) {
  const checkedCount = selected.size;
  const totalCount = pairs.length;
  // A pair contains a previously-dismissed row if either endpoint still carries
  // the flag. (We feed the scanner a stripped copy, but the original tx objects
  // in the pair retain their custom_fields.)
  const dismissedInPair = (pair) =>
    !!(pair.a.custom_fields?._transfer_dismissed || pair.b.custom_fields?._transfer_dismissed);

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "var(--card-bg, #fff)", color: "var(--card-color, #222)", borderRadius: 12, padding: 24, maxWidth: 780, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <h3 style={{ margin: "0 0 4px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800 }}>
          Detected {totalCount} transfer candidate{totalCount === 1 ? "" : "s"}
        </h3>
        <div style={{ fontSize: 13, color: "var(--tx2, #555)", marginBottom: 10, lineHeight: 1.5 }}>
          Each pair below has opposing amounts in different accounts within a few days.
          Confirm the ones that are real transfers; dismiss coincidental matches so they don't resurface.
        </div>

        {/* Include-dismissed toggle — lets the user rescan with previously-dismissed rows back in play. */}
        {onToggleIncludeDismissed && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--tx2, #555)", padding: "8px 10px", background: "var(--input-bg, #fafafa)", borderRadius: 6, marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={includeDismissed}
              onChange={(e) => onToggleIncludeDismissed(e.target.checked)} />
            <span>
              <strong style={{ color: "var(--tx, #333)" }}>Include dismissed rows</strong>
              <span style={{ color: "var(--tx3, #888)", marginLeft: 6 }}>
                — rescan with previously-dismissed transactions eligible again. Pairing one will clear its dismissed flag.
              </span>
            </span>
          </label>
        )}

        {totalCount === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--tx3, #999)", fontSize: 13 }}>
            {includeDismissed
              ? "No candidate pairs found even with dismissed rows included. Adjust the tolerance knobs on the Settings tab if you expected a match."
              : "No candidate pairs found. Adjust the tolerance knobs on the Settings tab if you expected a match."}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, fontSize: 12, color: "var(--tx3, #888)" }}>
              <span><strong style={{ color: "var(--tx, #333)" }}>{checkedCount}</strong> of {totalCount} selected</span>
              <button onClick={onSelectAll} style={pillBtn()}>Select all</button>
              <button onClick={onSelectNone} style={pillBtn()}>Select none</button>
            </div>
            <div style={{ flex: 1, minHeight: 200, overflowY: "auto", border: "1px solid var(--bdr2, #eee)", borderRadius: 8 }}>
              {pairs.map(pair => {
                const key = `${pair.a.id}|${pair.b.id}`;
                const isChecked = selected.has(key);
                const wasDismissed = dismissedInPair(pair);
                return (
                  <div key={key} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--bdr2, #eee)", alignItems: "center", background: isChecked ? "rgba(85, 111, 181, 0.05)" : "transparent" }}>
                    <input type="checkbox" checked={isChecked} onChange={() => onToggle(key)}
                      style={{ width: 16, height: 16, cursor: "pointer" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <PairRow tx={pair.a} />
                      <PairRow tx={pair.b} />
                      <div style={{ fontSize: 11, color: "var(--tx3, #999)", fontStyle: "italic", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span>{pair.reason} · confidence {(pair.confidence * 100).toFixed(0)}%</span>
                        {wasDismissed && (
                          <span style={{ padding: "1px 6px", background: "rgba(85, 111, 181, 0.12)", color: "#556FB5", borderRadius: 8, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, fontStyle: "normal" }}>
                            was dismissed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={onClose} style={btn("var(--card-bg, #fff)", "var(--tx2, #555)")}>Cancel</button>
          {totalCount > 0 && (
            <>
              <button onClick={onDismissSelected} disabled={checkedCount === 0}
                title="Mark the checked pairs as 'not a transfer' so they won't be suggested again"
                style={{ ...btn("var(--card-bg, #fff)", "#E8573A"), border: "1px solid #E8573A", opacity: checkedCount === 0 ? 0.5 : 1, cursor: checkedCount === 0 ? "not-allowed" : "pointer" }}>
                Dismiss selected
              </button>
              <button onClick={onConfirm} disabled={checkedCount === 0}
                style={{ ...btn("#556FB5", "#fff"), opacity: checkedCount === 0 ? 0.5 : 1, cursor: checkedCount === 0 ? "not-allowed" : "pointer" }}>
                Pair selected ({checkedCount})
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PairRow({ tx }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 100px 120px", gap: 8, fontSize: 13, alignItems: "center" }}>
      <span style={{ color: "var(--tx3, #888)", fontFamily: "monospace", fontSize: 12 }}>{tx.date}</span>
      <span style={{ color: "var(--tx, #333)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tx.description}>{tx.description || <em style={{ color: "var(--tx3, #bbb)" }}>(no description)</em>}</span>
      <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", textAlign: "right", color: Number(tx.amount) < 0 ? "#E8573A" : "#2ECC71", fontWeight: 600 }}>{fmt(Number(tx.amount) || 0)}</span>
      <span style={{ color: "var(--tx2, #555)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tx.account}>{tx.account || <em style={{ color: "var(--tx3, #bbb)" }}>—</em>}</span>
    </div>
  );
}

const pillBtn = () => ({ padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 10, border: "1px solid var(--bdr, #ccc)", background: "var(--card-bg, #fff)", color: "var(--tx2, #555)", cursor: "pointer" });

/* ── tiny style helpers, kept local so we don't bloat ui.jsx ── */
const inp = () => ({ padding: 6, fontSize: 13, borderRadius: 6, border: "1px solid var(--input-border, #e0e0e0)", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #333)", fontFamily: "'DM Sans',sans-serif", width: "100%", boxSizing: "border-box" });
const lbl = () => ({ display: "block", fontSize: 11, color: "var(--tx3, #888)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 });
const btn = (bg, color) => ({ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", background: bg, color, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" });
const th = () => ({ padding: 10, textAlign: "left", fontSize: 11, color: "var(--tx3, #999)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 });
const td = () => ({ padding: "8px 10px", verticalAlign: "middle" });

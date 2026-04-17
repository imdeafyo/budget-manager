/* ══════════════════════════ Transactions — pure utilities ══════════════════════════
   Data model, validation, filter, sort, duplicate detection.
   Import parsing (CSV) and query building live in separate modules (Phase 4b/4c).

   Transaction shape:
   {
     id:              string  (uuid — generated client-side for generic, server-side for deploy)
     date:            string  (ISO yyyy-mm-dd)
     amount:          number  (negative = money out, positive = money in — NOT signed-by-type)
     currency:        string  (ISO 4217, default "USD")
     description:     string
     category:        string | null
     account:         string
     notes:           string | null
     import_batch_id: string | null  (null for manually-added rows)
     import_source:   string | null  (profile name or "manual")
     custom_fields:   object          (user-defined column values by column id)
     created_at:      string  (ISO)
     updated_at:      string  (ISO)
   }

   Custom column shape (lives in st.transactionColumns):
   {
     id:   string       (stable, kebab-case, e.g. "merchant-id")
     name: string       (display label)
     type: "string" | "number" | "boolean"
     order: number      (display order; built-ins always come first)
   }
*/

export const BUILTIN_COLUMNS = [
  { id: "date",        name: "Date",        type: "date",    builtin: true, order: 0 },
  { id: "description", name: "Description", type: "string",  builtin: true, order: 1 },
  { id: "amount",      name: "Amount",      type: "number",  builtin: true, order: 2 },
  { id: "category",    name: "Category",    type: "string",  builtin: true, order: 3 },
  { id: "account",     name: "Account",     type: "string",  builtin: true, order: 4 },
  { id: "notes",       name: "Notes",       type: "string",  builtin: true, order: 5 },
];

/* Safe UUID generator — works in browser, node, and jsdom.
   Falls back to crypto.randomUUID when available, otherwise a
   v4-ish hand-roll based on Math.random (good enough for client-side ids). */
export function newId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += hex[(Math.random() * 4) | 0 | 8];
    else s += hex[(Math.random() * 16) | 0];
  }
  return s;
}

/* Build a new transaction with sane defaults. All fields optional except amount+date. */
export function newTransaction(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || newId(),
    date: partial.date || now.slice(0, 10),
    amount: typeof partial.amount === "number" ? partial.amount : parseFloat(partial.amount) || 0,
    currency: partial.currency || "USD",
    description: partial.description || "",
    category: partial.category || null,
    account: partial.account || "",
    notes: partial.notes || null,
    import_batch_id: partial.import_batch_id || null,
    import_source: partial.import_source || "manual",
    custom_fields: partial.custom_fields || {},
    created_at: partial.created_at || now,
    updated_at: partial.updated_at || now,
  };
}

/* ── Duplicate detection ──
   Hash of date + amount + description + account. Normalized to lowercase,
   whitespace-collapsed so "Starbucks  " and "STARBUCKS" match.
   amount rounded to cents to avoid floating-point near-misses. */
export function dupHash(tx) {
  const date = (tx.date || "").trim();
  const amt = Math.round((Number(tx.amount) || 0) * 100);
  const desc = (tx.description || "").trim().toLowerCase().replace(/\s+/g, " ");
  const acct = (tx.account || "").trim().toLowerCase();
  return `${date}|${amt}|${desc}|${acct}`;
}

/* Given an array of existing transactions and a candidate, return the
   matching existing transaction or null. */
export function findDuplicate(candidate, existing) {
  const h = dupHash(candidate);
  for (const e of existing) {
    if (dupHash(e) === h) return e;
  }
  return null;
}

/* ── Filtering ──
   Filter spec: { dateFrom, dateTo, categories[], accounts[], amountMin, amountMax, search }
   All optional. Empty/undefined fields = no constraint.
   search is a case-insensitive substring match on description + notes. */
export function applyFilters(transactions, filters = {}) {
  const { dateFrom, dateTo, categories, accounts, amountMin, amountMax, search } = filters;
  const hasCats = Array.isArray(categories) && categories.length > 0;
  const hasAccts = Array.isArray(accounts) && accounts.length > 0;
  const searchLC = search ? String(search).toLowerCase() : null;
  const minA = amountMin !== undefined && amountMin !== "" ? Number(amountMin) : null;
  const maxA = amountMax !== undefined && amountMax !== "" ? Number(amountMax) : null;

  return transactions.filter(tx => {
    if (dateFrom && tx.date < dateFrom) return false;
    if (dateTo && tx.date > dateTo) return false;
    if (hasCats && !categories.includes(tx.category || "")) return false;
    if (hasAccts && !accounts.includes(tx.account || "")) return false;
    if (minA !== null && !isNaN(minA) && Number(tx.amount) < minA) return false;
    if (maxA !== null && !isNaN(maxA) && Number(tx.amount) > maxA) return false;
    if (searchLC) {
      const d = (tx.description || "").toLowerCase();
      const n = (tx.notes || "").toLowerCase();
      if (!d.includes(searchLC) && !n.includes(searchLC)) return false;
    }
    return true;
  });
}

/* ── Preset date ranges ──
   Returns { dateFrom, dateTo } ISO strings for the given preset.
   "today" is supplied explicitly so this stays pure and testable. */
export function presetRange(preset, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const start = (yr, mo, da) => new Date(yr, mo, da);
  if (preset === "this_month") {
    return { dateFrom: iso(start(y, m, 1)), dateTo: iso(start(y, m + 1, 0)) };
  }
  if (preset === "last_month") {
    return { dateFrom: iso(start(y, m - 1, 1)), dateTo: iso(start(y, m, 0)) };
  }
  if (preset === "ytd") {
    return { dateFrom: iso(start(y, 0, 1)), dateTo: iso(today) };
  }
  if (preset === "last_30") {
    const from = new Date(today); from.setDate(d - 30);
    return { dateFrom: iso(from), dateTo: iso(today) };
  }
  if (preset === "last_90") {
    const from = new Date(today); from.setDate(d - 90);
    return { dateFrom: iso(from), dateTo: iso(today) };
  }
  if (preset === "last_year") {
    return { dateFrom: iso(start(y - 1, 0, 1)), dateTo: iso(start(y - 1, 11, 31)) };
  }
  return { dateFrom: "", dateTo: "" };
}

/* ── Sorting ──
   Stable sort — preserves original order for equal keys.
   Supports built-in fields and custom_fields.<id> via dot notation. */
export function sortTransactions(transactions, field, direction = "desc") {
  const dir = direction === "asc" ? 1 : -1;
  const getVal = (tx) => {
    if (field.startsWith("custom.")) {
      const key = field.slice(7);
      return tx.custom_fields?.[key];
    }
    return tx[field];
  };
  // decorate-sort-undecorate for stability
  const indexed = transactions.map((tx, i) => ({ tx, i }));
  indexed.sort((a, b) => {
    const av = getVal(a.tx);
    const bv = getVal(b.tx);
    // Nulls/undefined sort last regardless of direction
    if (av === undefined || av === null || av === "") {
      if (bv === undefined || bv === null || bv === "") return a.i - b.i;
      return 1;
    }
    if (bv === undefined || bv === null || bv === "") return -1;
    // Numbers
    if (typeof av === "number" && typeof bv === "number") {
      if (av === bv) return a.i - b.i;
      return av < bv ? -dir : dir;
    }
    // Strings (includes dates as ISO strings — naturally sortable)
    const as = String(av), bs = String(bv);
    if (as === bs) return a.i - b.i;
    return as < bs ? -dir : dir;
  });
  return indexed.map(o => o.tx);
}

/* ── Custom column CRUD helpers ──
   Pure: take array in, return array out. Also returns migration function
   that applies default values to existing transaction rows where needed. */
const KEBAB_RX = /[^a-z0-9]+/g;
export function slugify(name) {
  return String(name || "").toLowerCase().replace(KEBAB_RX, "-").replace(/^-+|-+$/g, "") || "col";
}

export function addColumn(columns, { name, type }) {
  const id = ensureUniqueId(slugify(name), columns);
  const nextOrder = Math.max(0, ...columns.map(c => c.order ?? 0)) + 1;
  return [...columns, { id, name: String(name || id), type: type || "string", builtin: false, order: nextOrder }];
}

export function removeColumn(columns, id) {
  return columns.filter(c => c.id !== id || c.builtin);
}

export function renameColumn(columns, id, newName) {
  return columns.map(c => c.id === id ? { ...c, name: String(newName || c.name) } : c);
}

function ensureUniqueId(base, columns) {
  const taken = new Set([...BUILTIN_COLUMNS.map(c => c.id), ...columns.map(c => c.id)]);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* ── Bulk ops ──
   setField: apply a field=value update to all rows whose id is in idSet.
   setCustomField: same but for custom_fields.<columnId>. */
export function bulkSetField(transactions, idSet, field, value) {
  const now = new Date().toISOString();
  return transactions.map(tx =>
    idSet.has(tx.id)
      ? { ...tx, [field]: value, updated_at: now }
      : tx
  );
}

export function bulkSetCustomField(transactions, idSet, columnId, value) {
  const now = new Date().toISOString();
  return transactions.map(tx =>
    idSet.has(tx.id)
      ? { ...tx, custom_fields: { ...(tx.custom_fields || {}), [columnId]: value }, updated_at: now }
      : tx
  );
}

export function bulkDelete(transactions, idSet) {
  return transactions.filter(tx => !idSet.has(tx.id));
}

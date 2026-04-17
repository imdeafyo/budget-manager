/* ══════════════════════════ Import pipeline — pure utilities ══════════════════════════
   Date parsing, amount sign normalization, row building from a column mapping,
   duplicate flagging, category alias application, import profile matching.

   UI lives in components/ImportModal.jsx (Phase 4b Commit 2).

   Profile shape (stored in st.importProfiles):
   {
     id:              string     (uuid)
     name:            string     (user-chosen, e.g. "Chase Checking")
     headerSig:       string     (see csv.js → headerSignature)
     mapping:         object     { <builtinOrCustomFieldId>: <sourceHeader> | null }
       Special mapping keys:
         amount       → source column for single-signed amount
         debit        → source column for debit-only column (amountConvention="separate")
         credit       → source column for credit-only column (amountConvention="separate")
     dateFormat:      string     e.g. "MM/DD/YYYY" | "YYYY-MM-DD" | ...
     amountConvention: "signed" | "negate-for-debit" | "separate" | "type-column"
     typeColumn:      string?    (source column for type-column convention)
     debitValues:     string[]   (values in typeColumn that mean "debit"; default ["debit","DR","withdrawal"])
     defaultAccount:  string     (applied when account isn't mapped; falls back to profile name)
     trustCategories: boolean    (if true, imported category is used verbatim post-alias)
     categoryAliases: object     { <importedCategoryRaw>: <localCategory> }
     customMapping:   object     { <customColumnId>: <sourceHeader> }
     createdAt:       string
     updatedAt:       string
   }
*/

/* ── Date format parsing ──
   Supported tokens:
     YYYY — 4-digit year        YY   — 2-digit year (pivoted: 00-49 → 2000s, 50-99 → 1900s)
     MM   — 2-digit month       M    — 1-or-2 digit month
     MMM  — 3-letter month abbr (Jan, Feb, ...)
     DD   — 2-digit day         D    — 1-or-2 digit day
   Separators: /, -, ., space. All non-token chars are matched literally.

   Returns ISO yyyy-mm-dd on success, null on failure. */

const MONTH_ABBR = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export const COMMON_DATE_FORMATS = [
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "D/M/YYYY",
  "MM-DD-YYYY",
  "DD-MM-YYYY",
  "DD-MMM-YY",
  "DD-MMM-YYYY",
  "MMM DD, YYYY",
  "YYYYMMDD",
];

export function parseDate(str, format) {
  if (!str || !format) return null;
  const input = String(str).trim();
  if (!input) return null;

  // Tokenize the format. Order matters: longer tokens before shorter.
  const TOKENS = ["YYYY", "YY", "MMM", "MM", "DD", "M", "D"];
  const parts = [];
  let i = 0;
  while (i < format.length) {
    let matched = null;
    for (const tok of TOKENS) {
      if (format.substr(i, tok.length) === tok) { matched = tok; break; }
    }
    if (matched) {
      parts.push({ kind: "token", value: matched });
      i += matched.length;
    } else {
      parts.push({ kind: "lit", value: format[i] });
      i++;
    }
  }

  // Build regex
  const reParts = parts.map(p => {
    if (p.kind === "lit") {
      // Escape regex special chars
      return p.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    if (p.value === "YYYY") return "(\\d{4})";
    if (p.value === "YY")   return "(\\d{2})";
    if (p.value === "MMM")  return "([A-Za-z]{3})";
    if (p.value === "MM")   return "(\\d{2})";
    if (p.value === "DD")   return "(\\d{2})";
    if (p.value === "M")    return "(\\d{1,2})";
    if (p.value === "D")    return "(\\d{1,2})";
    return "";
  });
  const re = new RegExp("^" + reParts.join("") + "$");
  const m = input.match(re);
  if (!m) return null;

  let year = null, month = null, day = null;
  let groupIdx = 1;
  for (const p of parts) {
    if (p.kind !== "token") continue;
    const v = m[groupIdx++];
    if (p.value === "YYYY") year = parseInt(v, 10);
    else if (p.value === "YY") {
      const n = parseInt(v, 10);
      year = n < 50 ? 2000 + n : 1900 + n;
    }
    else if (p.value === "MMM") {
      const n = MONTH_ABBR[v.toLowerCase()];
      if (!n) return null;
      month = n;
    }
    else if (p.value === "MM" || p.value === "M") month = parseInt(v, 10);
    else if (p.value === "DD" || p.value === "D") day = parseInt(v, 10);
  }

  if (!year || !month || !day) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Validate the actual date (catches Feb 30, etc.)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* ── Amount parsing & sign normalization ──
   All output amounts follow one convention: negative = money out, positive = money in.
   This matches how banks typically display "out" on statements even though raw CSV
   conventions vary wildly between sources.

   Conventions (parameter `convention`):
     "signed"          — single amount column, already negative-for-debit. Pass-through after parsing.
     "negate-for-debit" — single amount column, positive-only. We negate ALL values (treats every
                          row as an expense). Useful for "expense-only" exports.
     "separate"        — two columns (debit / credit). debit → negative, credit → positive.
     "type-column"     — single positive amount + type column indicating debit/credit.

   Parser accepts: "1,234.56", "$1234.56", "(123.45)" [accounting-style negative],
                   " 12.34 ", "12.34-" [trailing-minus], plain "12.34".
*/

const DEFAULT_DEBIT_VALUES = ["debit", "dr", "withdrawal", "debit card"];

export function parseAmount(raw) {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  // Accounting negative — (123.45) → -123.45
  let parenNeg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    parenNeg = true;
    s = s.slice(1, -1).trim();
  }
  // Trailing minus — 12.34-
  let trailingNeg = false;
  if (s.endsWith("-")) {
    trailingNeg = true;
    s = s.slice(0, -1).trim();
  }
  // Strip currency symbols and thousands separators
  s = s.replace(/[$€£¥₹,\s]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return (parenNeg || trailingNeg) ? -Math.abs(n) : n;
}

/* Given a raw row and amount-convention settings, return the normalized amount. */
export function normalizeAmount(row, spec) {
  const {
    amountConvention = "signed",
    amountColumn,
    debitColumn,
    creditColumn,
    typeColumn,
    debitValues = DEFAULT_DEBIT_VALUES,
  } = spec || {};

  if (amountConvention === "separate") {
    const d = parseAmount(row[debitColumn]);
    const c = parseAmount(row[creditColumn]);
    // Treat absent cell as 0. If both present, net them (debit - credit) so
    // signs still mean "money out" = negative.
    if (d !== 0 && c === 0) return -Math.abs(d);
    if (c !== 0 && d === 0) return Math.abs(c);
    if (d === 0 && c === 0) return 0;
    return Math.abs(c) - Math.abs(d);
  }

  const n = parseAmount(row[amountColumn]);

  if (amountConvention === "negate-for-debit") {
    return -Math.abs(n);
  }

  if (amountConvention === "type-column") {
    const t = String(row[typeColumn] || "").trim().toLowerCase();
    const isDebit = debitValues.map(v => String(v).toLowerCase()).includes(t);
    return isDebit ? -Math.abs(n) : Math.abs(n);
  }

  // "signed" — pass-through
  return n;
}

/* ── Category alias application ──
   aliasMap is { rawCategoryString: localCategoryString }.
   Match is case-insensitive, whitespace-collapsed. Returns null for unmapped
   values when trustCategories is false; returns the raw string (trimmed) when
   trustCategories is true and no alias exists. */
export function applyCategoryAlias(raw, aliasMap, trustCategories) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (aliasMap) {
    for (const k of Object.keys(aliasMap)) {
      if (String(k).trim().toLowerCase().replace(/\s+/g, " ") === key) {
        return aliasMap[k] || null;
      }
    }
  }
  return trustCategories ? String(raw).trim() : null;
}

/* ── Build a transaction draft from a raw CSV row + mapping ──
   Returns a partial transaction (ready to be fed to newTransaction). Missing
   required fields (date, amount) surface as { _errors: [...] } on the draft. */
export function buildTransactionFromRow(rawRow, profile, batchId) {
  const errors = [];
  const warnings = [];
  const m = profile.mapping || {};

  // Date
  const dateSrc = m.date;
  const dateRaw = dateSrc ? rawRow[dateSrc] : "";
  const date = parseDate(dateRaw, profile.dateFormat);
  if (!date) errors.push(`Unparseable date: "${dateRaw || "(empty)"}"`);

  // Amount
  const amount = normalizeAmount(rawRow, {
    amountConvention: profile.amountConvention,
    amountColumn: m.amount,
    debitColumn: m.debit,
    creditColumn: m.credit,
    typeColumn: profile.typeColumn,
    debitValues: profile.debitValues,
  });
  if (amount === 0) warnings.push("Zero amount");

  // Description
  const description = m.description ? String(rawRow[m.description] || "").trim() : "";

  // Account — explicit mapping wins, then profile default, then profile name
  const accountRaw = m.account ? String(rawRow[m.account] || "").trim() : "";
  const account = accountRaw || profile.defaultAccount || profile.name || "";

  // Category (with alias + trust logic)
  const catRaw = m.category ? rawRow[m.category] : null;
  const category = applyCategoryAlias(catRaw, profile.categoryAliases, !!profile.trustCategories);

  // Notes
  const notes = m.notes ? String(rawRow[m.notes] || "").trim() || null : null;

  // Custom fields
  const custom_fields = {};
  const customMapping = profile.customMapping || {};
  for (const colId of Object.keys(customMapping)) {
    const src = customMapping[colId];
    if (src && rawRow[src] !== undefined) {
      custom_fields[colId] = rawRow[src];
    }
  }

  return {
    date: date || "",
    amount,
    description,
    category,
    account,
    notes,
    custom_fields,
    import_batch_id: batchId,
    import_source: profile.name || "import",
    _errors: errors,
    _warnings: warnings,
  };
}

/* ── Duplicate flagging ──
   Given candidate rows and existing transactions, return an array of the same
   length as candidates where each entry is:
     { candidate, status: "ok" | "duplicate" | "error", existingMatch? }
   Candidates with _errors are marked "error". */
import { dupHash } from "./transactions.js";

export function flagDuplicates(candidates, existing) {
  const existingMap = new Map();
  for (const e of existing) {
    existingMap.set(dupHash(e), e);
  }
  // Also dedupe within the incoming batch itself
  const seenInBatch = new Map();
  return candidates.map(c => {
    if (c._errors && c._errors.length) {
      return { candidate: c, status: "error" };
    }
    const h = dupHash(c);
    if (existingMap.has(h)) {
      return { candidate: c, status: "duplicate", existingMatch: existingMap.get(h) };
    }
    if (seenInBatch.has(h)) {
      return { candidate: c, status: "duplicate", existingMatch: seenInBatch.get(h) };
    }
    seenInBatch.set(h, c);
    return { candidate: c, status: "ok" };
  });
}

/* ── Profile auto-match ──
   Given a CSV's header signature, return the best-matching profile from the
   user's saved list, or null if nothing matches. */
export function findProfileByHeaders(profiles, headerSig) {
  if (!Array.isArray(profiles) || !headerSig) return null;
  for (const p of profiles) {
    if (p.headerSig === headerSig) return p;
  }
  return null;
}

/* ── Heuristic auto-mapping ──
   Given a list of CSV headers, guess reasonable source columns for built-in
   fields. Used to prefill the mapping UI for first-time imports.
   Returns { mapping, amountConvention, typeColumn }. */
const GUESS_RULES = {
  date:        [/^(transaction[\s_]?)?date$/i, /^posted/i, /^post date$/i],
  description: [/^descr/i, /^memo$/i, /^name$/i, /^payee$/i, /^details$/i, /^narration$/i],
  amount:      [/^amount$/i, /^amt$/i, /^value$/i],
  category:    [/^categ/i, /^class/i, /^tag$/i],
  account:     [/^account/i, /^bank$/i, /^card$/i],
  notes:       [/^note/i, /^comment/i, /^remark/i],
  debit:       [/^debit$/i, /^withdrawal/i, /^money out$/i, /^out$/i, /^spent$/i],
  credit:      [/^credit$/i, /^deposit/i, /^money in$/i, /^in$/i, /^received$/i],
  type:        [/^type$/i, /^transaction type$/i, /^dr\/cr$/i],
};

export function guessMapping(headers) {
  const mapping = {};
  const find = (key) => {
    for (const rx of (GUESS_RULES[key] || [])) {
      const h = headers.find(x => rx.test(String(x || "").trim()));
      if (h) return h;
    }
    return null;
  };

  for (const k of ["date", "description", "category", "account", "notes"]) {
    const h = find(k);
    if (h) mapping[k] = h;
  }

  const debitH = find("debit");
  const creditH = find("credit");
  const amountH = find("amount");
  const typeH = find("type");

  let amountConvention = "signed";
  let typeColumn = null;

  if (debitH && creditH) {
    mapping.debit = debitH;
    mapping.credit = creditH;
    amountConvention = "separate";
  } else if (amountH && typeH) {
    mapping.amount = amountH;
    typeColumn = typeH;
    amountConvention = "type-column";
  } else if (amountH) {
    mapping.amount = amountH;
    amountConvention = "signed";
  }

  return { mapping, amountConvention, typeColumn };
}

/* ── Guess date format from sample values ──
   Try each of COMMON_DATE_FORMATS and return the first one that parses ALL
   non-empty samples successfully. Returns null if no format fits all. */
export function guessDateFormat(samples) {
  const nonEmpty = (samples || []).map(s => String(s || "").trim()).filter(s => s.length > 0);
  if (!nonEmpty.length) return null;
  for (const fmt of COMMON_DATE_FORMATS) {
    if (nonEmpty.every(s => parseDate(s, fmt) !== null)) return fmt;
  }
  return null;
}

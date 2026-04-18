/* ══════════════════════════ Transaction Rules — pure engine ══════════════════════════
   Rule-based auto-categorization. First-match-wins in priority order.
   Rules are evaluated on import (before commit) and on demand via "Re-run rules on
   all transactions" in the Settings panel.

   Rule shape (stored in st.transactionRules):
   {
     id:         string    (uuid)
     name:       string    (user-chosen label, e.g. "Starbucks → Dining")
     enabled:    boolean   (default true)
     priority:   number    (lower = evaluated first; array index is canonical order)
     conditions: Condition[]  (all must match — AND)
     match:      "all" | "any"  (default "all"; "any" turns conditions into OR)
     action:     Action    (what to set when matched)
     createdAt:  string
     updatedAt:  string
   }

   Condition shape:
   {
     field:    "description" | "amount" | "account" | "category" | "notes"
                 | "custom.<columnId>"
     operator: "contains" | "equals" | "starts_with" | "ends_with"
                 | "regex" | "not_contains" | "not_equals"
                 | "gt" | "gte" | "lt" | "lte" | "between"
                 | "is_empty" | "is_not_empty"
     value:    string | number                      (primary operand)
     value2:   number?                              (only for "between")
     caseSensitive: boolean?                        (default false for string ops)
   }

   Action shape:
   {
     type:    "set_category" | "set_custom" | "mark_transfer"
     value:   string                                 (for set_category / mark_transfer)
     columnId: string?                               (for set_custom — target column)
     customValue: any?                               (for set_custom — value to set)
   }

   Design notes:
   - Regex is supported from v1. Invalid patterns caught at evaluation time and
     surfaced via compileRule() so the Settings UI can show an error badge.
   - First-match-wins: once a rule sets a field, later rules that would set the
     SAME field are skipped. Different fields can still be set by later rules.
     (e.g. rule 1 sets category, rule 3 sets a custom field — both apply.)
   - Pure: no React, no IO. Takes rules + transactions, returns updated transactions.
*/

const STRING_OPS = new Set([
  "contains", "equals", "starts_with", "ends_with",
  "regex", "not_contains", "not_equals",
  "is_empty", "is_not_empty",
]);
const NUMBER_OPS = new Set(["gt", "gte", "lt", "lte", "between"]);

/* ── Field extraction ──
   Pulls the raw value out of a transaction for a given condition field.
   Handles the custom.<id> prefix for custom_fields. */
export function getFieldValue(tx, field) {
  if (!field) return undefined;
  if (field.startsWith("custom.")) {
    const key = field.slice(7);
    return tx.custom_fields?.[key];
  }
  return tx[field];
}

/* ── Single condition evaluation ──
   Returns true/false. Throws nothing — invalid regex etc. return false silently.
   Use compileRule() up front if you want to surface errors to the user. */
export function evaluateCondition(tx, cond) {
  if (!cond || !cond.operator) return false;
  const { field, operator, value, value2, caseSensitive } = cond;
  const raw = getFieldValue(tx, field);

  // Empty checks apply to any field
  if (operator === "is_empty") {
    return raw === undefined || raw === null || raw === "";
  }
  if (operator === "is_not_empty") {
    return !(raw === undefined || raw === null || raw === "");
  }

  // For everything else, missing values never match (except negations)
  const missing = raw === undefined || raw === null || raw === "";

  if (NUMBER_OPS.has(operator)) {
    if (missing) return false;
    const n = Number(raw);
    if (!isFinite(n)) return false;
    const v = Number(value);
    if (operator === "gt")  return n >  v;
    if (operator === "gte") return n >= v;
    if (operator === "lt")  return n <  v;
    if (operator === "lte") return n <= v;
    if (operator === "between") {
      const lo = Math.min(Number(value), Number(value2));
      const hi = Math.max(Number(value), Number(value2));
      return n >= lo && n <= hi;
    }
    return false;
  }

  if (STRING_OPS.has(operator)) {
    const cs = !!caseSensitive;
    const hay = missing ? "" : String(raw);
    const needle = value == null ? "" : String(value);
    const H = cs ? hay : hay.toLowerCase();
    const N = cs ? needle : needle.toLowerCase();

    if (operator === "contains")     return missing ? false : H.includes(N);
    if (operator === "not_contains") return missing ? true  : !H.includes(N);
    if (operator === "equals")       return missing ? false : H === N;
    if (operator === "not_equals")   return missing ? true  : H !== N;
    if (operator === "starts_with")  return missing ? false : H.startsWith(N);
    if (operator === "ends_with")    return missing ? false : H.endsWith(N);
    if (operator === "regex") {
      if (missing) return false;
      try {
        const flags = cs ? "" : "i";
        return new RegExp(needle, flags).test(hay);
      } catch {
        return false;
      }
    }
  }

  return false;
}

/* ── Rule-level match ──
   AND over conditions by default; "any" flips to OR. A rule with zero
   conditions never matches (guard against accidental "apply to everything"). */
export function evaluateRule(tx, rule) {
  if (!rule || !rule.enabled) return false;
  const conds = rule.conditions || [];
  if (!conds.length) return false;
  if (rule.match === "any") {
    for (const c of conds) if (evaluateCondition(tx, c)) return true;
    return false;
  }
  for (const c of conds) if (!evaluateCondition(tx, c)) return false;
  return true;
}

/* ── Action application ──
   Returns a new transaction with the action applied. Does NOT mutate.
   alreadySet is a Set of "slot" keys already claimed by earlier-priority rules
   in this evaluation pass — used to enforce first-match-wins per target slot. */
function slotFor(action) {
  if (!action) return null;
  if (action.type === "set_category") return "category";
  if (action.type === "mark_transfer") return "is_transfer";
  if (action.type === "set_custom") return `custom:${action.columnId || ""}`;
  return null;
}

export function applyAction(tx, action) {
  if (!action) return tx;
  if (action.type === "set_category") {
    return { ...tx, category: action.value || null };
  }
  if (action.type === "mark_transfer") {
    // Store transfer flag in custom_fields so it round-trips without schema changes.
    // Full transfer-pairing logic lands in Phase 5 proper; this just flags the row.
    return { ...tx, custom_fields: { ...(tx.custom_fields || {}), _is_transfer: true } };
  }
  if (action.type === "set_custom") {
    if (!action.columnId) return tx;
    return {
      ...tx,
      custom_fields: { ...(tx.custom_fields || {}), [action.columnId]: action.customValue },
    };
  }
  return tx;
}

/* ── Apply rules to a single transaction ──
   Walks rules in array order (priority). First rule to match a given slot wins.
   Returns { tx, matchedRuleIds } so callers can report/log what fired. */
export function applyRulesToTransaction(tx, rules, options = {}) {
  const { overrideExisting = false } = options;
  if (!Array.isArray(rules) || !rules.length) return { tx, matchedRuleIds: [] };

  let out = tx;
  const claimed = new Set();
  const matchedRuleIds = [];

  // If overrideExisting is false, pre-claim any slot that already has a value
  // so rules won't overwrite it. This is the default for "Re-run rules on all"
  // to avoid clobbering manual edits.
  if (!overrideExisting) {
    if (out.category) claimed.add("category");
    if (out.custom_fields?._is_transfer) claimed.add("is_transfer");
    for (const k of Object.keys(out.custom_fields || {})) {
      const v = out.custom_fields[k];
      if (v !== undefined && v !== null && v !== "") claimed.add(`custom:${k}`);
    }
  }

  for (const rule of rules) {
    if (!rule?.enabled) continue;
    const slot = slotFor(rule.action);
    if (!slot) continue;
    if (claimed.has(slot)) continue;
    if (!evaluateRule(out, rule)) continue;
    out = applyAction(out, rule.action);
    claimed.add(slot);
    matchedRuleIds.push(rule.id);
  }

  return { tx: out, matchedRuleIds };
}

/* ── Bulk apply ──
   Map rules over an array of transactions. Returns { transactions, stats }.
   stats = { matched: N, byRule: { ruleId: count } } — useful for UI feedback. */
export function applyRulesToAll(transactions, rules, options = {}) {
  const stats = { matched: 0, byRule: {} };
  const out = transactions.map(tx => {
    const { tx: updated, matchedRuleIds } = applyRulesToTransaction(tx, rules, options);
    if (matchedRuleIds.length) {
      stats.matched++;
      for (const rid of matchedRuleIds) {
        stats.byRule[rid] = (stats.byRule[rid] || 0) + 1;
      }
    }
    return updated;
  });
  return { transactions: out, stats };
}

/* ── Rule construction helpers ── */
export function newRule(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || _newRuleId(),
    // Preserve empty string if explicitly passed — compileRule should catch it.
    // Only fall back to the default when `name` is absent or non-string-ish.
    name: typeof partial.name === "string" ? partial.name : "New rule",
    enabled: partial.enabled !== false,
    match: partial.match || "all",
    conditions: Array.isArray(partial.conditions) ? partial.conditions : [],
    action: partial.action || { type: "set_category", value: "" },
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now,
  };
}

function _newRuleId() {
  // Mirror the uuid-ish fallback from transactions.js so rules.js stays self-contained.
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
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

/* ── Validation / compilation ──
   Walk a rule and collect any errors (bad regex, missing fields, etc).
   Returns { valid: boolean, errors: string[] } so the Settings UI can surface
   per-rule error badges without crashing the engine at evaluation time. */
export function compileRule(rule) {
  const errors = [];
  if (!rule) { errors.push("Rule is empty."); return { valid: false, errors }; }
  if (!rule.name || !String(rule.name).trim()) errors.push("Rule name is required.");
  const conds = rule.conditions || [];
  if (!conds.length) errors.push("Rule must have at least one condition.");
  conds.forEach((c, i) => {
    if (!c || !c.operator) {
      errors.push(`Condition ${i + 1}: operator is required.`);
      return;
    }
    if (!c.field) errors.push(`Condition ${i + 1}: field is required.`);
    if (c.operator === "regex") {
      try { new RegExp(c.value || "", c.caseSensitive ? "" : "i"); }
      catch (e) { errors.push(`Condition ${i + 1}: invalid regex — ${e.message}`); }
    }
    if (c.operator === "between") {
      if (c.value === "" || c.value === null || c.value === undefined
          || c.value2 === "" || c.value2 === null || c.value2 === undefined) {
        errors.push(`Condition ${i + 1}: 'between' requires two values.`);
      }
    }
  });
  if (!rule.action || !rule.action.type) {
    errors.push("Action type is required.");
  } else if (rule.action.type === "set_category" && !rule.action.value) {
    errors.push("Action 'set category' requires a category.");
  } else if (rule.action.type === "set_custom" && !rule.action.columnId) {
    errors.push("Action 'set custom field' requires a column.");
  }
  return { valid: errors.length === 0, errors };
}

/* ── Build a rule from a single example ──
   Used by the remember-my-choice modal. Given a transaction and a chosen
   category, produce a reasonable starter rule matching on description.
   The user can customize before saving. */
export function buildRuleFromExample(tx, category, opts = {}) {
  const {
    field = "description",
    operator = "contains",
    caseSensitive = false,
  } = opts;

  // For "contains" on description, use the most distinctive-looking word/phrase.
  // Strip trailing numbers, card suffixes, store numbers — they're usually noise.
  let value = "";
  if (field === "description") {
    const raw = String(tx.description || "").trim();
    value = extractSignature(raw) || raw;
  } else {
    const v = getFieldValue(tx, field);
    value = v == null ? "" : String(v);
  }

  return newRule({
    name: category ? `${value || "Rule"} → ${category}` : (value || "New rule"),
    conditions: [{ field, operator, value, caseSensitive }],
    action: { type: "set_category", value: category || "" },
  });
}

/* Heuristic for pulling the "merchant-ish" part out of a bank description.
   Banks love to append location codes, store numbers, dates, and card suffixes.
   This isn't perfect — we show the result to the user for confirmation. */
export function extractSignature(description) {
  if (!description) return "";
  let s = String(description).trim();
  // Strip common leading prefixes
  s = s.replace(/^(POS |DEBIT |CREDIT |PURCHASE |ACH |CHECKCARD |VISA |MC )+/i, "");
  // Strip inline/trailing store numbers (#4421, #5432, etc.) — these can appear
  // mid-string ("STARBUCKS #4421 SEATTLE WA") or at the end
  s = s.replace(/\s+#\d+\b/g, "");
  // Strip inline/trailing card masks (xxxx1234)
  s = s.replace(/\s+x{2,}\s*\d+\b/gi, "");
  // Strip trailing date like 12/04 or 12-04
  s = s.replace(/\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s*$/, "");
  // Strip trailing 6+ digit run (transaction IDs)
  s = s.replace(/\s+\d{6,}\b/g, "");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Use the first token only as the signature — this guarantees the signature
  // is a substring of the original (so a "contains" rule built from it round-trips)
  // and it's usually the distinctive merchant name anyway ("STARBUCKS", "AMAZON.COM").
  const firstWord = s.split(" ")[0] || "";
  return firstWord;
}

/* ── Priority reordering helpers ──
   Rules are stored in an array where index === priority. These keep the
   Settings UI's drag-and-drop / up-down buttons honest. */
export function moveRule(rules, fromIdx, toIdx) {
  if (fromIdx === toIdx) return rules;
  const n = [...rules];
  if (fromIdx < 0 || fromIdx >= n.length) return rules;
  if (toIdx < 0 || toIdx >= n.length) return rules;
  const [item] = n.splice(fromIdx, 1);
  n.splice(toIdx, 0, item);
  return n;
}

export function reorderRules(rules, newOrder) {
  // newOrder is an array of rule ids in desired order. Missing ids append at end.
  const byId = new Map(rules.map(r => [r.id, r]));
  const out = [];
  for (const id of newOrder) {
    const r = byId.get(id);
    if (r) { out.push(r); byId.delete(id); }
  }
  for (const r of byId.values()) out.push(r);
  return out;
}

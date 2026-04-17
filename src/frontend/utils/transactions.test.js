import { describe, it, expect } from "vitest";
import {
  BUILTIN_COLUMNS, newId, newTransaction, dupHash, findDuplicate,
  applyFilters, presetRange, sortTransactions,
  slugify, addColumn, removeColumn, renameColumn,
  bulkSetField, bulkSetCustomField, bulkDelete,
} from "./transactions.js";

describe("newId", () => {
  it("returns a non-empty string", () => {
    const id = newId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
  it("returns unique values across many calls", () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(newId());
    expect(ids.size).toBe(1000);
  });
});

describe("newTransaction", () => {
  it("creates a transaction with sane defaults", () => {
    const tx = newTransaction({ amount: 12.34, description: "Test" });
    expect(tx.id).toBeTruthy();
    expect(tx.amount).toBe(12.34);
    expect(tx.description).toBe("Test");
    expect(tx.currency).toBe("USD");
    expect(tx.category).toBe(null);
    expect(tx.custom_fields).toEqual({});
    expect(tx.import_source).toBe("manual");
    expect(tx.created_at).toBeTruthy();
    expect(tx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("parses string amounts", () => {
    expect(newTransaction({ amount: "42.50" }).amount).toBe(42.5);
    expect(newTransaction({ amount: "not-a-number" }).amount).toBe(0);
  });
  it("preserves explicit id and timestamps", () => {
    const tx = newTransaction({ id: "abc", created_at: "2024-01-01T00:00:00Z" });
    expect(tx.id).toBe("abc");
    expect(tx.created_at).toBe("2024-01-01T00:00:00Z");
  });
  it("preserves custom_fields", () => {
    const tx = newTransaction({ amount: 1, custom_fields: { merchant: "Amazon" } });
    expect(tx.custom_fields).toEqual({ merchant: "Amazon" });
  });
});

describe("dupHash", () => {
  it("produces same hash for transactions that should collide", () => {
    const a = { date: "2026-01-15", amount: -25.50, description: "Starbucks", account: "Checking" };
    const b = { date: "2026-01-15", amount: -25.50, description: "  STARBUCKS  ", account: "checking" };
    expect(dupHash(a)).toBe(dupHash(b));
  });
  it("collapses internal whitespace", () => {
    const a = { date: "2026-01-15", amount: -10, description: "Trader Joe's", account: "Visa" };
    const b = { date: "2026-01-15", amount: -10, description: "Trader   Joe's", account: "Visa" };
    expect(dupHash(a)).toBe(dupHash(b));
  });
  it("differs when amount differs", () => {
    const a = { date: "2026-01-15", amount: -25.50, description: "Starbucks", account: "Checking" };
    const b = { date: "2026-01-15", amount: -25.51, description: "Starbucks", account: "Checking" };
    expect(dupHash(a)).not.toBe(dupHash(b));
  });
  it("differs when account differs", () => {
    const a = { date: "2026-01-15", amount: -25, description: "X", account: "Checking" };
    const b = { date: "2026-01-15", amount: -25, description: "X", account: "Savings" };
    expect(dupHash(a)).not.toBe(dupHash(b));
  });
  it("differs when date differs", () => {
    const a = { date: "2026-01-15", amount: -25, description: "X", account: "A" };
    const b = { date: "2026-01-16", amount: -25, description: "X", account: "A" };
    expect(dupHash(a)).not.toBe(dupHash(b));
  });
  it("handles float rounding correctly", () => {
    // 0.1 + 0.2 === 0.30000000000000004 without rounding; hash should normalize
    const a = { date: "2026-01-15", amount: 0.30, description: "X", account: "A" };
    const b = { date: "2026-01-15", amount: 0.1 + 0.2, description: "X", account: "A" };
    expect(dupHash(a)).toBe(dupHash(b));
  });
});

describe("findDuplicate", () => {
  const existing = [
    newTransaction({ date: "2026-01-10", amount: -25, description: "Coffee", account: "Visa" }),
    newTransaction({ date: "2026-01-11", amount: -50, description: "Grocery", account: "Visa" }),
  ];
  it("finds a duplicate when one exists", () => {
    const candidate = { date: "2026-01-10", amount: -25, description: "COFFEE", account: "visa" };
    expect(findDuplicate(candidate, existing)).toBeTruthy();
  });
  it("returns null when no duplicate", () => {
    const candidate = { date: "2026-01-10", amount: -99, description: "Other", account: "Visa" };
    expect(findDuplicate(candidate, existing)).toBeNull();
  });
});

describe("applyFilters", () => {
  const rows = [
    newTransaction({ date: "2026-01-05", amount: -10,  description: "Starbucks",  category: "Dining",  account: "Visa" }),
    newTransaction({ date: "2026-01-15", amount: -50,  description: "Whole Foods", category: "Grocery", account: "Visa" }),
    newTransaction({ date: "2026-02-01", amount: 2000, description: "Paycheck",    category: "Income",  account: "Checking" }),
    newTransaction({ date: "2026-02-10", amount: -25,  description: "Target",      category: "Shopping", account: "Amex", notes: "birthday gift" }),
  ];
  it("with no filters returns everything", () => {
    expect(applyFilters(rows, {})).toHaveLength(4);
  });
  it("filters by dateFrom", () => {
    const r = applyFilters(rows, { dateFrom: "2026-02-01" });
    expect(r).toHaveLength(2);
    expect(r.every(x => x.date >= "2026-02-01")).toBe(true);
  });
  it("filters by dateTo", () => {
    const r = applyFilters(rows, { dateTo: "2026-01-31" });
    expect(r).toHaveLength(2);
  });
  it("filters by date range", () => {
    const r = applyFilters(rows, { dateFrom: "2026-01-10", dateTo: "2026-02-05" });
    expect(r).toHaveLength(2);
    expect(r.map(x => x.description).sort()).toEqual(["Paycheck", "Whole Foods"]);
  });
  it("filters by categories multi-select", () => {
    const r = applyFilters(rows, { categories: ["Dining", "Grocery"] });
    expect(r).toHaveLength(2);
  });
  it("filters by accounts", () => {
    expect(applyFilters(rows, { accounts: ["Visa"] })).toHaveLength(2);
    expect(applyFilters(rows, { accounts: ["Amex"] })).toHaveLength(1);
  });
  it("filters by amount range", () => {
    const r = applyFilters(rows, { amountMin: -30, amountMax: 0 });
    expect(r).toHaveLength(2);
    expect(r.map(x => x.description).sort()).toEqual(["Starbucks", "Target"]);
  });
  it("search is case-insensitive on description", () => {
    expect(applyFilters(rows, { search: "whole" })).toHaveLength(1);
    expect(applyFilters(rows, { search: "WHOLE" })).toHaveLength(1);
  });
  it("search also looks in notes", () => {
    expect(applyFilters(rows, { search: "birthday" })).toHaveLength(1);
  });
  it("combines multiple filters with AND", () => {
    const r = applyFilters(rows, { accounts: ["Visa"], amountMin: -20 });
    expect(r).toHaveLength(1);
    expect(r[0].description).toBe("Starbucks");
  });
  it("empty array filter is ignored (no-op, not exclude-all)", () => {
    expect(applyFilters(rows, { categories: [] })).toHaveLength(4);
    expect(applyFilters(rows, { accounts: [] })).toHaveLength(4);
  });
});

describe("presetRange", () => {
  const today = new Date(2026, 3, 15); // April 15 2026 (month is 0-indexed)
  it("this_month returns April 1-30", () => {
    const r = presetRange("this_month", today);
    expect(r.dateFrom).toBe("2026-04-01");
    expect(r.dateTo).toBe("2026-04-30");
  });
  it("last_month returns March 1-31", () => {
    const r = presetRange("last_month", today);
    expect(r.dateFrom).toBe("2026-03-01");
    expect(r.dateTo).toBe("2026-03-31");
  });
  it("ytd returns Jan 1 to today", () => {
    const r = presetRange("ytd", today);
    expect(r.dateFrom).toBe("2026-01-01");
    expect(r.dateTo).toBe("2026-04-15");
  });
  it("last_30 returns 30 days back", () => {
    const r = presetRange("last_30", today);
    expect(r.dateFrom).toBe("2026-03-16");
    expect(r.dateTo).toBe("2026-04-15");
  });
  it("last_year returns previous calendar year", () => {
    const r = presetRange("last_year", today);
    expect(r.dateFrom).toBe("2025-01-01");
    expect(r.dateTo).toBe("2025-12-31");
  });
  it("unknown preset returns empty", () => {
    expect(presetRange("garbage", today)).toEqual({ dateFrom: "", dateTo: "" });
  });
});

describe("sortTransactions", () => {
  const rows = [
    newTransaction({ id: "a", date: "2026-01-10", amount: -50, description: "Banana" }),
    newTransaction({ id: "b", date: "2026-01-15", amount: -10, description: "Apple" }),
    newTransaction({ id: "c", date: "2026-01-05", amount: -30, description: "Cherry" }),
  ];
  it("sorts by date desc", () => {
    const r = sortTransactions(rows, "date", "desc");
    expect(r.map(x => x.id)).toEqual(["b", "a", "c"]);
  });
  it("sorts by date asc", () => {
    const r = sortTransactions(rows, "date", "asc");
    expect(r.map(x => x.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts by amount asc (most negative first)", () => {
    const r = sortTransactions(rows, "amount", "asc");
    expect(r.map(x => x.id)).toEqual(["a", "c", "b"]);
  });
  it("sorts by description alphabetically", () => {
    const r = sortTransactions(rows, "description", "asc");
    expect(r.map(x => x.id)).toEqual(["b", "a", "c"]);
  });
  it("is stable (preserves order for equal keys)", () => {
    const equal = [
      newTransaction({ id: "x", date: "2026-01-10", amount: 1, description: "one" }),
      newTransaction({ id: "y", date: "2026-01-10", amount: 2, description: "two" }),
      newTransaction({ id: "z", date: "2026-01-10", amount: 3, description: "three" }),
    ];
    const r = sortTransactions(equal, "date", "desc");
    expect(r.map(x => x.id)).toEqual(["x", "y", "z"]);
  });
  it("sorts null/empty values to the end regardless of direction", () => {
    const withNulls = [
      newTransaction({ id: "a", category: "Food" }),
      newTransaction({ id: "b", category: null }),
      newTransaction({ id: "c", category: "Transport" }),
    ];
    const desc = sortTransactions(withNulls, "category", "desc");
    expect(desc[desc.length - 1].id).toBe("b");
    const asc = sortTransactions(withNulls, "category", "asc");
    expect(asc[asc.length - 1].id).toBe("b");
  });
  it("sorts by custom field via dot notation", () => {
    const rows = [
      newTransaction({ id: "a", custom_fields: { score: 2 } }),
      newTransaction({ id: "b", custom_fields: { score: 5 } }),
      newTransaction({ id: "c", custom_fields: { score: 1 } }),
    ];
    const r = sortTransactions(rows, "custom.score", "asc");
    expect(r.map(x => x.id)).toEqual(["c", "a", "b"]);
  });
});

describe("column CRUD", () => {
  it("slugify produces kebab-case ids", () => {
    expect(slugify("Merchant ID")).toBe("merchant-id");
    expect(slugify("  Foo   Bar!!  ")).toBe("foo-bar");
    expect(slugify("123 Go")).toBe("123-go");
    expect(slugify("")).toBe("col");
  });
  it("addColumn appends a new column with generated id", () => {
    const cols = [];
    const next = addColumn(cols, { name: "Tax Year", type: "number" });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("tax-year");
    expect(next[0].name).toBe("Tax Year");
    expect(next[0].type).toBe("number");
    expect(next[0].builtin).toBe(false);
  });
  it("addColumn deduplicates ids against both custom and builtin names", () => {
    let cols = [];
    cols = addColumn(cols, { name: "Merchant", type: "string" });
    cols = addColumn(cols, { name: "Merchant", type: "string" });
    expect(cols.map(c => c.id)).toEqual(["merchant", "merchant-2"]);
  });
  it("addColumn avoids collision with builtin ids", () => {
    const cols = addColumn([], { name: "Notes", type: "string" });
    expect(cols[0].id).toBe("notes-2");
  });
  it("removeColumn drops custom columns but protects builtins", () => {
    const cols = [
      { id: "merchant", name: "Merchant", type: "string", builtin: false, order: 1 },
      { id: "notes", name: "Notes", type: "string", builtin: true, order: 5 },
    ];
    const r = removeColumn(cols, "merchant");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("notes");
    const r2 = removeColumn(cols, "notes");
    // notes is builtin (though in this test list) — removeColumn only drops non-builtin matches
    expect(r2).toHaveLength(2);
  });
  it("renameColumn updates the display name", () => {
    const cols = [{ id: "merchant", name: "Merchant", type: "string", builtin: false, order: 1 }];
    const r = renameColumn(cols, "merchant", "Vendor");
    expect(r[0].name).toBe("Vendor");
    expect(r[0].id).toBe("merchant"); // id stays stable
  });
  it("BUILTIN_COLUMNS has expected 6 entries", () => {
    expect(BUILTIN_COLUMNS).toHaveLength(6);
    expect(BUILTIN_COLUMNS.map(c => c.id)).toContain("date");
    expect(BUILTIN_COLUMNS.map(c => c.id)).toContain("amount");
    expect(BUILTIN_COLUMNS.every(c => c.builtin)).toBe(true);
  });
});

describe("bulk ops", () => {
  const rows = [
    newTransaction({ id: "a", category: "Food" }),
    newTransaction({ id: "b", category: "Transport" }),
    newTransaction({ id: "c", category: null }),
  ];
  it("bulkSetField updates only matching rows", () => {
    const r = bulkSetField(rows, new Set(["a", "c"]), "category", "Dining");
    expect(r[0].category).toBe("Dining");
    expect(r[1].category).toBe("Transport"); // untouched
    expect(r[2].category).toBe("Dining");
  });
  it("bulkSetField bumps updated_at on touched rows", async () => {
    // Give a microsecond gap so updated_at truly differs
    await new Promise(r => setTimeout(r, 5));
    const r = bulkSetField(rows, new Set(["a"]), "category", "X");
    expect(r[0].updated_at >= rows[0].updated_at).toBe(true);
    expect(r[1].updated_at).toBe(rows[1].updated_at);
  });
  it("bulkSetCustomField updates custom_fields dict", () => {
    const r = bulkSetCustomField(rows, new Set(["a", "b"]), "tag", "work");
    expect(r[0].custom_fields.tag).toBe("work");
    expect(r[1].custom_fields.tag).toBe("work");
    expect(r[2].custom_fields.tag).toBeUndefined();
  });
  it("bulkDelete removes matching rows", () => {
    const r = bulkDelete(rows, new Set(["a", "c"]));
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("b");
  });
});

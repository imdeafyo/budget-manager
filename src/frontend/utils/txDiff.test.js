import { describe, it, expect } from "vitest";
import { diffChangedTransactions } from "./txDiff.js";
import { applyRulesToAll } from "./rules.js";

/* Regression coverage for the "re-run rules doesn't persist" bug.
   The rule engine always computed correct results; the defect was that the
   sweep updated React state only and never sent the changed rows to the
   server. bulkUpdateTransactions now diffs prev→next and PATCHes the changed
   rows. These tests pin the diff that decides what gets persisted. */

const tx = (over = {}) => ({
  id: over.id || "x",
  date: "2026-01-01",
  amount: -10,
  currency: "USD",
  description: "STARBUCKS #4421",
  category: null,
  account: "checking",
  notes: null,
  import_batch_id: null,
  import_source: "manual",
  custom_fields: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("diffChangedTransactions", () => {
  it("returns empty when nothing changed", () => {
    const prev = [tx({ id: "a" }), tx({ id: "b" })];
    const next = prev.map(t => ({ ...t }));
    expect(diffChangedTransactions(prev, next)).toEqual([]);
  });

  it("returns only the rows a rule sweep actually recategorized", () => {
    const prev = [
      tx({ id: "a", description: "STARBUCKS #4421" }),
      tx({ id: "b", description: "SHELL OIL 88" }),
      tx({ id: "c", description: "STARBUCKS #9001" }),
    ];
    const rules = [{
      id: "r1", enabled: true, match: "all",
      conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
      action: { type: "set_category", value: "Dining" },
    }];
    const { transactions: next } = applyRulesToAll(prev, rules);
    const changed = diffChangedTransactions(prev, next);
    // Only the two Starbucks rows changed; the Shell row is untouched.
    expect(changed.map(t => t.id).sort()).toEqual(["a", "c"]);
    expect(changed.every(t => t.category === "Dining")).toBe(true);
  });

  it("does not re-send rows already categorized (first-match-wins, no clobber)", () => {
    const prev = [tx({ id: "a", category: "Dining", description: "STARBUCKS #1" })];
    const rules = [{
      id: "r1", enabled: true, match: "all",
      conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
      action: { type: "set_category", value: "Coffee" },
    }];
    const { transactions: next } = applyRulesToAll(prev, rules);
    // Existing category is protected, so the row is unchanged → nothing to persist.
    expect(diffChangedTransactions(prev, next)).toEqual([]);
  });

  it("flags a row as changed when only custom_fields differ", () => {
    const prev = [tx({ id: "a", custom_fields: {} })];
    const next = [{ ...prev[0], custom_fields: { _is_transfer: true } }];
    expect(diffChangedTransactions(prev, next).map(t => t.id)).toEqual(["a"]);
  });

  it("treats brand-new ids as changed", () => {
    const prev = [tx({ id: "a" })];
    const next = [tx({ id: "a" }), tx({ id: "b" })];
    expect(diffChangedTransactions(prev, next).map(t => t.id)).toEqual(["b"]);
  });

  it("is order-independent (matches on id, not position)", () => {
    const prev = [tx({ id: "a" }), tx({ id: "b" })];
    const next = [prev[1], prev[0]].map(t => ({ ...t }));
    expect(diffChangedTransactions(prev, next)).toEqual([]);
  });

  it("handles empty/undefined prev gracefully", () => {
    const next = [tx({ id: "a" })];
    expect(diffChangedTransactions(undefined, next).map(t => t.id)).toEqual(["a"]);
    expect(diffChangedTransactions([], next).map(t => t.id)).toEqual(["a"]);
  });
});

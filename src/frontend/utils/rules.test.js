import { describe, it, expect } from "vitest";
import {
  evaluateCondition, evaluateRule,
  applyAction, applyRulesToTransaction, applyRulesToAll,
  newRule, compileRule,
  buildRuleFromExample, extractSignature,
  moveRule, reorderRules,
  getFieldValue,
} from "./rules.js";

/* Fixture builders */
const tx = (partial = {}) => ({
  id: partial.id || "tx1",
  date: partial.date || "2026-01-15",
  amount: partial.amount !== undefined ? partial.amount : -12.34,
  description: partial.description || "STARBUCKS #4421 SEATTLE WA",
  category: partial.category !== undefined ? partial.category : null,
  account: partial.account || "Chase Checking",
  notes: partial.notes !== undefined ? partial.notes : null,
  custom_fields: partial.custom_fields || {},
  currency: "USD",
  import_source: "test",
  created_at: "2026-01-15T00:00:00Z",
  updated_at: "2026-01-15T00:00:00Z",
});

describe("getFieldValue", () => {
  it("reads built-in fields", () => {
    expect(getFieldValue(tx(), "description")).toBe("STARBUCKS #4421 SEATTLE WA");
    expect(getFieldValue(tx({ amount: -5 }), "amount")).toBe(-5);
  });
  it("reads custom_fields via custom.<id> prefix", () => {
    const t = tx({ custom_fields: { merchant_id: "ABC123" } });
    expect(getFieldValue(t, "custom.merchant_id")).toBe("ABC123");
  });
  it("returns undefined for missing custom fields", () => {
    expect(getFieldValue(tx(), "custom.doesnt_exist")).toBeUndefined();
  });
});

describe("evaluateCondition — string operators", () => {
  it("contains (case-insensitive by default)", () => {
    expect(evaluateCondition(tx(), { field: "description", operator: "contains", value: "starbucks" })).toBe(true);
    expect(evaluateCondition(tx(), { field: "description", operator: "contains", value: "dunkin" })).toBe(false);
  });
  it("contains respects caseSensitive flag", () => {
    expect(evaluateCondition(tx(), { field: "description", operator: "contains", value: "starbucks", caseSensitive: true })).toBe(false);
    expect(evaluateCondition(tx(), { field: "description", operator: "contains", value: "STARBUCKS", caseSensitive: true })).toBe(true);
  });
  it("equals / not_equals", () => {
    expect(evaluateCondition(tx({ account: "Chase" }), { field: "account", operator: "equals", value: "chase" })).toBe(true);
    expect(evaluateCondition(tx({ account: "Chase" }), { field: "account", operator: "not_equals", value: "chase" })).toBe(false);
    expect(evaluateCondition(tx({ account: "Chase" }), { field: "account", operator: "not_equals", value: "Wells Fargo" })).toBe(true);
  });
  it("starts_with / ends_with", () => {
    expect(evaluateCondition(tx(), { field: "description", operator: "starts_with", value: "starb" })).toBe(true);
    expect(evaluateCondition(tx(), { field: "description", operator: "ends_with", value: "wa" })).toBe(true);
    expect(evaluateCondition(tx(), { field: "description", operator: "starts_with", value: "dunkin" })).toBe(false);
  });
  it("not_contains", () => {
    expect(evaluateCondition(tx(), { field: "description", operator: "not_contains", value: "dunkin" })).toBe(true);
    expect(evaluateCondition(tx(), { field: "description", operator: "not_contains", value: "starbucks" })).toBe(false);
  });
  it("regex — simple pattern", () => {
    expect(evaluateCondition(tx(), { field: "description", operator: "regex", value: "^STARBUCKS" })).toBe(true);
    expect(evaluateCondition(tx(), { field: "description", operator: "regex", value: "dunkin" })).toBe(false);
  });
  it("regex — case-insensitive by default", () => {
    expect(evaluateCondition(tx(), { field: "description", operator: "regex", value: "starbucks" })).toBe(true);
  });
  it("regex — caseSensitive flag", () => {
    expect(evaluateCondition(tx(), { field: "description", operator: "regex", value: "starbucks", caseSensitive: true })).toBe(false);
    expect(evaluateCondition(tx(), { field: "description", operator: "regex", value: "STARBUCKS", caseSensitive: true })).toBe(true);
  });
  it("regex — invalid pattern returns false (does not throw)", () => {
    expect(() => evaluateCondition(tx(), { field: "description", operator: "regex", value: "[unclosed" })).not.toThrow();
    expect(evaluateCondition(tx(), { field: "description", operator: "regex", value: "[unclosed" })).toBe(false);
  });
});

describe("evaluateCondition — number operators", () => {
  it("gt / gte / lt / lte", () => {
    const t = tx({ amount: -50 });
    expect(evaluateCondition(t, { field: "amount", operator: "gt",  value: -100 })).toBe(true);
    expect(evaluateCondition(t, { field: "amount", operator: "gte", value: -50 })).toBe(true);
    expect(evaluateCondition(t, { field: "amount", operator: "lt",  value: 0 })).toBe(true);
    expect(evaluateCondition(t, { field: "amount", operator: "lte", value: -50 })).toBe(true);
    expect(evaluateCondition(t, { field: "amount", operator: "lt",  value: -100 })).toBe(false);
  });
  it("between — inclusive on both ends, order-agnostic", () => {
    const t = tx({ amount: -50 });
    expect(evaluateCondition(t, { field: "amount", operator: "between", value: -100, value2: -10 })).toBe(true);
    expect(evaluateCondition(t, { field: "amount", operator: "between", value: -10, value2: -100 })).toBe(true); // reversed
    expect(evaluateCondition(t, { field: "amount", operator: "between", value: -50, value2: -50 })).toBe(true); // edge
    expect(evaluateCondition(t, { field: "amount", operator: "between", value: -5, value2: 5 })).toBe(false);
  });
  it("missing numeric field never matches a range op", () => {
    const t = tx({ custom_fields: {} });
    expect(evaluateCondition(t, { field: "custom.foo", operator: "gt", value: 0 })).toBe(false);
  });
});

describe("evaluateCondition — empty checks", () => {
  it("is_empty / is_not_empty", () => {
    expect(evaluateCondition(tx({ category: null }), { field: "category", operator: "is_empty" })).toBe(true);
    expect(evaluateCondition(tx({ category: "Food" }), { field: "category", operator: "is_empty" })).toBe(false);
    expect(evaluateCondition(tx({ category: "Food" }), { field: "category", operator: "is_not_empty" })).toBe(true);
    expect(evaluateCondition(tx({ category: "" }), { field: "category", operator: "is_not_empty" })).toBe(false);
  });
});

describe("evaluateRule", () => {
  it("AND match (default) — all conditions must hit", () => {
    const rule = newRule({
      conditions: [
        { field: "description", operator: "contains", value: "starbucks" },
        { field: "amount", operator: "lt", value: 0 },
      ],
      action: { type: "set_category", value: "Dining" },
    });
    expect(evaluateRule(tx(), rule)).toBe(true);
    expect(evaluateRule(tx({ amount: 100 }), rule)).toBe(false);
  });
  it("OR match ('any') — one condition is enough", () => {
    const rule = newRule({
      match: "any",
      conditions: [
        { field: "description", operator: "contains", value: "dunkin" },
        { field: "description", operator: "contains", value: "starbucks" },
      ],
      action: { type: "set_category", value: "Dining" },
    });
    expect(evaluateRule(tx(), rule)).toBe(true);
    expect(evaluateRule(tx({ description: "TARGET" }), rule)).toBe(false);
  });
  it("disabled rule never matches", () => {
    const rule = newRule({
      enabled: false,
      conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
    });
    expect(evaluateRule(tx(), rule)).toBe(false);
  });
  it("zero-condition rule never matches (safety)", () => {
    const rule = newRule({ conditions: [], action: { type: "set_category", value: "X" } });
    expect(evaluateRule(tx(), rule)).toBe(false);
  });
});

describe("applyAction", () => {
  it("set_category writes to category", () => {
    const out = applyAction(tx(), { type: "set_category", value: "Dining" });
    expect(out.category).toBe("Dining");
  });
  it("mark_transfer flags the transaction", () => {
    const out = applyAction(tx(), { type: "mark_transfer" });
    expect(out.custom_fields._is_transfer).toBe(true);
  });
  it("set_custom writes to custom_fields[columnId]", () => {
    const out = applyAction(tx(), { type: "set_custom", columnId: "tag", customValue: "weekly" });
    expect(out.custom_fields.tag).toBe("weekly");
  });
  it("set_custom with no columnId is a no-op", () => {
    const out = applyAction(tx(), { type: "set_custom", columnId: "", customValue: "x" });
    expect(out).toEqual(tx());
  });
  it("does not mutate the original transaction", () => {
    const original = tx();
    applyAction(original, { type: "set_category", value: "Dining" });
    expect(original.category).toBe(null);
  });
});

describe("applyRulesToTransaction — priority (first-match-wins)", () => {
  it("earlier rule wins for the same slot", () => {
    const rules = [
      newRule({ id: "r1", conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_category", value: "Dining" } }),
      newRule({ id: "r2", conditions: [{ field: "amount", operator: "lt", value: 0 }],
        action: { type: "set_category", value: "Misc" } }),
    ];
    const { tx: out, matchedRuleIds } = applyRulesToTransaction(tx(), rules);
    expect(out.category).toBe("Dining");
    expect(matchedRuleIds).toEqual(["r1"]);
  });
  it("rules on different slots both apply", () => {
    const rules = [
      newRule({ id: "r1", conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_category", value: "Dining" } }),
      newRule({ id: "r2", conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_custom", columnId: "merchant", customValue: "Starbucks" } }),
    ];
    const { tx: out, matchedRuleIds } = applyRulesToTransaction(tx(), rules);
    expect(out.category).toBe("Dining");
    expect(out.custom_fields.merchant).toBe("Starbucks");
    expect(matchedRuleIds).toEqual(["r1", "r2"]);
  });
  it("does not override existing category by default", () => {
    const rules = [
      newRule({ id: "r1", conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_category", value: "Dining" } }),
    ];
    const t = tx({ category: "Manually Set" });
    const { tx: out, matchedRuleIds } = applyRulesToTransaction(t, rules);
    expect(out.category).toBe("Manually Set");
    expect(matchedRuleIds).toEqual([]);
  });
  it("overrideExisting: true forces rule to win over existing value", () => {
    const rules = [
      newRule({ id: "r1", conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_category", value: "Dining" } }),
    ];
    const t = tx({ category: "Manually Set" });
    const { tx: out } = applyRulesToTransaction(t, rules, { overrideExisting: true });
    expect(out.category).toBe("Dining");
  });
  it("disabled rule is skipped", () => {
    const rules = [
      newRule({ id: "r1", enabled: false, conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_category", value: "Dining" } }),
      newRule({ id: "r2", conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_category", value: "Coffee" } }),
    ];
    const { tx: out, matchedRuleIds } = applyRulesToTransaction(tx(), rules);
    expect(out.category).toBe("Coffee");
    expect(matchedRuleIds).toEqual(["r2"]);
  });
  it("empty rules list returns tx unchanged", () => {
    const { tx: out, matchedRuleIds } = applyRulesToTransaction(tx(), []);
    expect(out).toEqual(tx());
    expect(matchedRuleIds).toEqual([]);
  });
});

describe("applyRulesToAll", () => {
  it("applies across a batch and returns stats", () => {
    const txs = [
      tx({ id: "a", description: "STARBUCKS" }),
      tx({ id: "b", description: "TARGET" }),
      tx({ id: "c", description: "Starbucks Downtown" }),
    ];
    const rules = [
      newRule({ id: "r1", conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
        action: { type: "set_category", value: "Dining" } }),
    ];
    const { transactions: out, stats } = applyRulesToAll(txs, rules);
    expect(out[0].category).toBe("Dining");
    expect(out[1].category).toBe(null);
    expect(out[2].category).toBe("Dining");
    expect(stats.matched).toBe(2);
    expect(stats.byRule.r1).toBe(2);
  });
  it("empty rules preserves input", () => {
    const txs = [tx({ id: "a" }), tx({ id: "b" })];
    const { transactions: out, stats } = applyRulesToAll(txs, []);
    expect(out).toEqual(txs);
    expect(stats.matched).toBe(0);
  });
});

describe("compileRule — validation", () => {
  it("valid rule passes", () => {
    const r = newRule({
      name: "Coffee",
      conditions: [{ field: "description", operator: "contains", value: "starbucks" }],
      action: { type: "set_category", value: "Dining" },
    });
    const { valid, errors } = compileRule(r);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });
  it("missing name fails", () => {
    const r = newRule({
      name: "",
      conditions: [{ field: "description", operator: "contains", value: "x" }],
      action: { type: "set_category", value: "Y" },
    });
    const { valid, errors } = compileRule(r);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/name/i);
  });
  it("zero-condition rule fails", () => {
    const r = newRule({ conditions: [], action: { type: "set_category", value: "X" } });
    const { valid, errors } = compileRule(r);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/condition/i);
  });
  it("invalid regex is caught at compile", () => {
    const r = newRule({
      conditions: [{ field: "description", operator: "regex", value: "[unclosed" }],
      action: { type: "set_category", value: "X" },
    });
    const { valid, errors } = compileRule(r);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/regex/i);
  });
  it("between requires two values", () => {
    const r = newRule({
      conditions: [{ field: "amount", operator: "between", value: 10 }],
      action: { type: "set_category", value: "X" },
    });
    const { valid, errors } = compileRule(r);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/between/i);
  });
  it("set_category action requires a category value", () => {
    const r = newRule({
      conditions: [{ field: "description", operator: "contains", value: "x" }],
      action: { type: "set_category", value: "" },
    });
    const { valid, errors } = compileRule(r);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/category/i);
  });
  it("set_custom action requires a columnId", () => {
    const r = newRule({
      conditions: [{ field: "description", operator: "contains", value: "x" }],
      action: { type: "set_custom", columnId: "", customValue: "x" },
    });
    const { valid, errors } = compileRule(r);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/column/i);
  });
});

describe("buildRuleFromExample", () => {
  it("produces a description-contains rule from a transaction", () => {
    const rule = buildRuleFromExample(tx(), "Dining");
    expect(rule.conditions.length).toBe(1);
    expect(rule.conditions[0].field).toBe("description");
    expect(rule.conditions[0].operator).toBe("contains");
    expect(rule.action).toEqual({ type: "set_category", value: "Dining" });
    // Signature extraction should remove the store number
    expect(rule.conditions[0].value.toLowerCase()).toContain("starbucks");
    expect(rule.conditions[0].value).not.toContain("#4421");
  });
  it("round-trips — built rule matches the source transaction", () => {
    const src = tx();
    const rule = buildRuleFromExample(src, "Dining");
    expect(evaluateRule(src, rule)).toBe(true);
  });
});

describe("extractSignature", () => {
  it("strips store numbers", () => {
    expect(extractSignature("STARBUCKS #4421 SEATTLE WA")).not.toContain("4421");
  });
  it("strips card-suffix-style trailing ids", () => {
    expect(extractSignature("AMAZON.COM #9876543")).not.toContain("9876543");
  });
  it("strips trailing dates", () => {
    expect(extractSignature("COSTCO WHOLESALE 12/04")).not.toContain("12/04");
  });
  it("strips POS / DEBIT prefixes", () => {
    expect(extractSignature("POS DEBIT STARBUCKS").toLowerCase()).not.toContain("pos");
  });
  it("handles empty/null input", () => {
    expect(extractSignature("")).toBe("");
    expect(extractSignature(null)).toBe("");
  });
  it("returns the first token (distinctive merchant name) for round-trip safety", () => {
    expect(extractSignature("STARBUCKS #4421 SEATTLE WA")).toBe("STARBUCKS");
    expect(extractSignature("AMAZON.COM MARKETPLACE")).toBe("AMAZON.COM");
  });
});

describe("Reordering — moveRule / reorderRules", () => {
  const rs = () => [newRule({ id: "a" }), newRule({ id: "b" }), newRule({ id: "c" })];
  it("moveRule swaps positions", () => {
    const out = moveRule(rs(), 0, 2);
    expect(out.map(r => r.id)).toEqual(["b", "c", "a"]);
  });
  it("moveRule is a no-op on invalid index", () => {
    const orig = rs();
    expect(moveRule(orig, -1, 2)).toBe(orig);
    expect(moveRule(orig, 0, 99)).toBe(orig);
  });
  it("reorderRules by id list", () => {
    const out = reorderRules(rs(), ["c", "a", "b"]);
    expect(out.map(r => r.id)).toEqual(["c", "a", "b"]);
  });
  it("reorderRules appends missing ids at end", () => {
    const out = reorderRules(rs(), ["c"]);
    expect(out.map(r => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("newRule defaults", () => {
  it("generates an id, timestamps, enabled=true, empty conditions", () => {
    const r = newRule();
    expect(r.id).toBeTruthy();
    expect(r.enabled).toBe(true);
    expect(r.match).toBe("all");
    expect(Array.isArray(r.conditions)).toBe(true);
    expect(r.createdAt).toBeTruthy();
    expect(r.updatedAt).toBeTruthy();
  });
  it("respects partial overrides", () => {
    const r = newRule({ name: "X", enabled: false });
    expect(r.name).toBe("X");
    expect(r.enabled).toBe(false);
  });
});

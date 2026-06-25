import { describe, it, expect } from "vitest";
import {
  isExcludedDuplicate, isExcludedFromTotals,
  markExcludedDuplicate, unmarkExcludedDuplicate,
  applyExclusions, clearExclusions,
} from "./exclusions.js";
import { markPaired } from "./transfers.js";

const tx = (id, extra = {}) => ({
  id, date: "2024-01-10", amount: -10, description: "X", account: "checking",
  category: null, currency: "USD", notes: null, custom_fields: {}, splits: null,
  ...extra,
});

describe("isExcludedDuplicate", () => {
  it("true only when _is_duplicate flag is set", () => {
    expect(isExcludedDuplicate(tx("a"))).toBe(false);
    expect(isExcludedDuplicate(markExcludedDuplicate(tx("a")))).toBe(true);
  });
  it("safe on null/garbage", () => {
    expect(isExcludedDuplicate(null)).toBe(false);
    expect(isExcludedDuplicate({})).toBe(false);
  });
});

describe("isExcludedFromTotals", () => {
  it("true for excluded duplicates", () => {
    expect(isExcludedFromTotals(markExcludedDuplicate(tx("a")))).toBe(true);
  });
  it("true for marked transfers", () => {
    expect(isExcludedFromTotals(markPaired(tx("a"), "b"))).toBe(true);
  });
  it("false for a normal row", () => {
    expect(isExcludedFromTotals(tx("a"))).toBe(false);
  });
  it("true when a row is BOTH a transfer and an excluded duplicate", () => {
    const both = markExcludedDuplicate(markPaired(tx("a"), "b"));
    expect(isExcludedFromTotals(both)).toBe(true);
  });
});

describe("mark/unmark round-trip", () => {
  it("mark sets the flag, unmark clears it", () => {
    const marked = markExcludedDuplicate(tx("a"));
    expect(marked.custom_fields._is_duplicate).toBe(true);
    const cleared = unmarkExcludedDuplicate(marked);
    expect(cleared.custom_fields._is_duplicate).toBeUndefined();
    expect(isExcludedDuplicate(cleared)).toBe(false);
  });
  it("mark is idempotent", () => {
    const once = markExcludedDuplicate(tx("a"));
    const twice = markExcludedDuplicate(once);
    expect(isExcludedDuplicate(twice)).toBe(true);
  });
  it("unmark preserves other custom_fields", () => {
    const t = markExcludedDuplicate(tx("a", { custom_fields: { _is_duplicate: true, note: "keep" } }));
    const cleared = unmarkExcludedDuplicate(t);
    expect(cleared.custom_fields.note).toBe("keep");
    expect(cleared.custom_fields._is_duplicate).toBeUndefined();
  });
  it("does not mutate the input row", () => {
    const orig = tx("a");
    markExcludedDuplicate(orig);
    expect(orig.custom_fields._is_duplicate).toBeUndefined();
  });
  it("mark/unmark are null-safe", () => {
    expect(markExcludedDuplicate(null)).toBe(null);
    expect(unmarkExcludedDuplicate(null)).toBe(null);
  });
});

describe("applyExclusions / clearExclusions (bulk)", () => {
  const rows = [tx("a"), tx("b"), tx("c")];

  it("flags only the targeted ids", () => {
    const next = applyExclusions(rows, new Set(["a", "c"]));
    expect(isExcludedDuplicate(next.find(t => t.id === "a"))).toBe(true);
    expect(isExcludedDuplicate(next.find(t => t.id === "b"))).toBe(false);
    expect(isExcludedDuplicate(next.find(t => t.id === "c"))).toBe(true);
  });
  it("accepts an array of ids as well as a Set", () => {
    const next = applyExclusions(rows, ["b"]);
    expect(isExcludedDuplicate(next.find(t => t.id === "b"))).toBe(true);
  });
  it("clearExclusions reverses applyExclusions", () => {
    const excluded = applyExclusions(rows, new Set(["a", "b", "c"]));
    const restored = clearExclusions(excluded, new Set(["a", "b", "c"]));
    expect(restored.every(t => !isExcludedDuplicate(t))).toBe(true);
  });
  it("empty id set is a no-op (returns original reference)", () => {
    expect(applyExclusions(rows, new Set())).toBe(rows);
    expect(clearExclusions(rows, [])).toBe(rows);
  });
  it("unknown ids are ignored", () => {
    const next = applyExclusions(rows, new Set(["zzz"]));
    expect(next.every(t => !isExcludedDuplicate(t))).toBe(true);
  });
  it("non-array input returned unchanged", () => {
    expect(applyExclusions(null, ["a"])).toBe(null);
    expect(clearExclusions(undefined, ["a"])).toBe(undefined);
  });
});

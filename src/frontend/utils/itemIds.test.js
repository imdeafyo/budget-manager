import { describe, it, expect } from "vitest";
import { newItemId, ensureIds, ensureIdsInPlace } from "./itemIds.js";

describe("newItemId", () => {
  it("returns a string with the i_ prefix", () => {
    const id = newItemId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("i_")).toBe(true);
  });

  it("returns ids of consistent length (i_ + 8 chars = 10)", () => {
    for (let i = 0; i < 20; i++) {
      expect(newItemId()).toHaveLength(10);
    }
  });

  it("returns unique values across many calls", () => {
    const seen = new Set();
    for (let i = 0; i < 10000; i++) {
      const id = newItemId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10000);
  });
});

describe("ensureIds", () => {
  it("returns [] for non-array input", () => {
    expect(ensureIds(undefined)).toEqual([]);
    expect(ensureIds(null)).toEqual([]);
    expect(ensureIds("not an array")).toEqual([]);
    expect(ensureIds({})).toEqual([]);
  });

  it("returns [] unchanged for empty input", () => {
    const empty = [];
    expect(ensureIds(empty)).toBe(empty); // strict equality — no-op fast path
  });

  it("assigns ids to items missing them", () => {
    const arr = [{ n: "a" }, { n: "b" }];
    const out = ensureIds(arr);
    expect(out).toHaveLength(2);
    expect(out[0].id).toMatch(/^i_/);
    expect(out[1].id).toMatch(/^i_/);
    expect(out[0].id).not.toBe(out[1].id);
    // Original is not mutated
    expect(arr[0].id).toBeUndefined();
  });

  it("preserves existing ids", () => {
    const arr = [{ n: "a", id: "i_existing" }, { n: "b" }];
    const out = ensureIds(arr);
    expect(out[0].id).toBe("i_existing");
    expect(out[1].id).toMatch(/^i_/);
    expect(out[1].id).not.toBe("i_existing");
  });

  it("is idempotent (returns same array ref when nothing needs assignment)", () => {
    const arr = [{ n: "a", id: "i_x" }, { n: "b", id: "i_y" }];
    const out = ensureIds(arr);
    expect(out).toBe(arr); // referential equality — React-friendly
  });

  it("preserves referential equality of items that already have ids (in the new array)", () => {
    const itemA = { n: "a", id: "i_a" };
    const itemB = { n: "b" }; // needs id
    const arr = [itemA, itemB];
    const out = ensureIds(arr);
    expect(out).not.toBe(arr); // new array, because itemB needed change
    expect(out[0]).toBe(itemA); // itemA unchanged
    expect(out[1]).not.toBe(itemB); // itemB got an id assigned
    expect(out[1].id).toMatch(/^i_/);
    expect(out[1].n).toBe("b");
  });

  it("treats empty-string id as missing and assigns a new one", () => {
    const arr = [{ n: "a", id: "" }];
    const out = ensureIds(arr);
    expect(out[0].id).toMatch(/^i_/);
    expect(out[0].id).not.toBe("");
  });

  it("treats non-string id as missing and assigns a new one", () => {
    const arr = [{ n: "a", id: 123 }, { n: "b", id: null }];
    const out = ensureIds(arr);
    expect(typeof out[0].id).toBe("string");
    expect(typeof out[1].id).toBe("string");
    expect(out[0].id).toMatch(/^i_/);
    expect(out[1].id).toMatch(/^i_/);
  });

  it("does not crash on null/undefined items inside the array", () => {
    const arr = [null, { n: "a" }, undefined];
    const out = ensureIds(arr);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeNull();
    expect(out[1].id).toMatch(/^i_/);
    expect(out[2]).toBeUndefined();
  });

  it("doesn't collide ids within a single migration of 1000 items", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => ({ n: `item${i}` }));
    const out = ensureIds(arr);
    const ids = new Set(out.map(it => it.id));
    expect(ids.size).toBe(1000);
  });
});

describe("ensureIdsInPlace", () => {
  it("mutates items to add ids", () => {
    const arr = [{ n: "a" }, { n: "b" }];
    ensureIdsInPlace(arr);
    expect(arr[0].id).toMatch(/^i_/);
    expect(arr[1].id).toMatch(/^i_/);
  });

  it("preserves existing ids during in-place migration", () => {
    const arr = [{ n: "a", id: "i_keep" }, { n: "b" }];
    ensureIdsInPlace(arr);
    expect(arr[0].id).toBe("i_keep");
    expect(arr[1].id).toMatch(/^i_/);
  });

  it("is a no-op on non-array input", () => {
    expect(() => ensureIdsInPlace(undefined)).not.toThrow();
    expect(() => ensureIdsInPlace(null)).not.toThrow();
    expect(() => ensureIdsInPlace("nope")).not.toThrow();
  });

  it("skips null/undefined items in the array", () => {
    const arr = [null, { n: "a" }, undefined];
    expect(() => ensureIdsInPlace(arr)).not.toThrow();
    expect(arr[1].id).toMatch(/^i_/);
  });
});

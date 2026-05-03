import { describe, it, expect, beforeEach } from "vitest";
import {
  computeCacheKey,
  readCache,
  writeCache,
  clearCache,
  __INTERNALS__,
} from "./compareCache.js";

/* Minimal in-memory localStorage for deterministic tests. */
function makeMemStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    _map: map,
  };
}

describe("computeCacheKey", () => {
  it("returns a stable string for identical inputs", () => {
    const opts = {
      transactions: [{ id: 1, date: "2026-01-15", amount: -42, category: "Food", updated_at: "2026-01-15T10:00:00Z" }],
      exp: [{ n: "Groceries", c: "Food", v: 150, p: "wk" }],
      sav: [{ n: "401k", c: "Retirement", v: 200, p: "wk" }],
      cats: ["Food"],
      savCats: ["Retirement"],
      transferCats: [],
      incomeCats: ["Paycheck"],
      milestones: [],
      fromIso: "2026-01-01",
      toIso: "2026-01-31",
      todayIso: "2026-01-15",
      basis: 48,
      treatRefundsAsNetting: true,
    };
    const a = computeCacheKey(opts);
    const b = computeCacheKey(opts);
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
  });

  it("changes when transactions count changes", () => {
    const base = {
      transactions: [{ id: 1, date: "2026-01-15", amount: -42, updated_at: "2026-01-15T10:00:00Z" }],
      exp: [], sav: [], cats: [], savCats: [],
      fromIso: "2026-01-01", toIso: "2026-01-31",
      basis: 48,
    };
    const a = computeCacheKey(base);
    const b = computeCacheKey({
      ...base,
      transactions: [
        ...base.transactions,
        { id: 2, date: "2026-01-16", amount: -10, updated_at: "2026-01-16T10:00:00Z" },
      ],
    });
    expect(a).not.toBe(b);
  });

  it("changes when transaction updated_at changes (count stable)", () => {
    const t1 = [{ id: 1, date: "2026-01-15", amount: -42, updated_at: "2026-01-15T10:00:00Z" }];
    const t2 = [{ id: 1, date: "2026-01-15", amount: -50, updated_at: "2026-01-15T11:00:00Z" }];
    const a = computeCacheKey({ transactions: t1, fromIso: "2026-01-01", toIso: "2026-01-31", basis: 48 });
    const b = computeCacheKey({ transactions: t2, fromIso: "2026-01-01", toIso: "2026-01-31", basis: 48 });
    expect(a).not.toBe(b);
  });

  it("changes when basis flips 48↔52", () => {
    const opts = { transactions: [], fromIso: "2026-01-01", toIso: "2026-01-31" };
    const a = computeCacheKey({ ...opts, basis: 48 });
    const b = computeCacheKey({ ...opts, basis: 52 });
    expect(a).not.toBe(b);
  });

  it("changes when date range changes", () => {
    const opts = { transactions: [], basis: 48 };
    const a = computeCacheKey({ ...opts, fromIso: "2026-01-01", toIso: "2026-01-31" });
    const b = computeCacheKey({ ...opts, fromIso: "2026-02-01", toIso: "2026-02-28" });
    expect(a).not.toBe(b);
  });

  it("changes when an exp item amount changes", () => {
    const opts = {
      transactions: [],
      sav: [], cats: [], savCats: [],
      fromIso: "2026-01-01", toIso: "2026-01-31",
      basis: 48,
    };
    const a = computeCacheKey({ ...opts, exp: [{ n: "Groceries", c: "Food", v: 150, p: "wk" }] });
    const b = computeCacheKey({ ...opts, exp: [{ n: "Groceries", c: "Food", v: 200, p: "wk" }] });
    expect(a).not.toBe(b);
  });

  it("changes when categories list reorders", () => {
    // Note: order matters for the join — that's documented and intentional.
    // Reordering is rare and a stale paint is harmless.
    const opts = { transactions: [], fromIso: "2026-01-01", toIso: "2026-01-31", basis: 48 };
    const a = computeCacheKey({ ...opts, cats: ["Food", "Gas"] });
    const b = computeCacheKey({ ...opts, cats: ["Gas", "Food"] });
    expect(a).not.toBe(b);
  });

  it("changes when milestones added", () => {
    const opts = { transactions: [], fromIso: "2026-01-01", toIso: "2026-01-31", basis: 48 };
    const a = computeCacheKey({ ...opts, milestones: [] });
    const b = computeCacheKey({ ...opts, milestones: [{ id: "m1", date: "2025-12-31" }] });
    expect(a).not.toBe(b);
  });

  it("falls back to content fingerprint when updated_at is missing", () => {
    // Generic mode rows often lack updated_at. We still need to detect edits.
    const t1 = [{ id: 1, date: "2026-01-15", amount: -42, category: "Food" }];
    const t2 = [{ id: 1, date: "2026-01-15", amount: -50, category: "Food" }]; // amount changed
    const a = computeCacheKey({ transactions: t1, fromIso: "2026-01-01", toIso: "2026-01-31", basis: 48 });
    const b = computeCacheKey({ transactions: t2, fromIso: "2026-01-01", toIso: "2026-01-31", basis: 48 });
    expect(a).not.toBe(b);
  });

  it("treats empty / missing options as zero-state without throwing", () => {
    expect(() => computeCacheKey()).not.toThrow();
    expect(() => computeCacheKey({})).not.toThrow();
    expect(() => computeCacheKey(null)).not.toThrow();
    const a = computeCacheKey();
    const b = computeCacheKey({});
    expect(a).toBe(b);
  });
});

describe("readCache / writeCache", () => {
  let storage;
  beforeEach(() => { storage = makeMemStorage(); });

  it("round-trips a write then read with the same key", () => {
    const key = "abc";
    const compare = { expRows: [{ category: "Food", actual: 100, budgeted: 150 }] };
    expect(writeCache(key, compare, { storage })).toBe(true);
    const out = readCache(key, { storage });
    expect(out).toEqual(compare);
  });

  it("returns null on key mismatch", () => {
    writeCache("abc", { x: 1 }, { storage });
    expect(readCache("xyz", { storage })).toBeNull();
  });

  it("returns null when nothing has been written", () => {
    expect(readCache("abc", { storage })).toBeNull();
  });

  it("returns null when storage contains garbage", () => {
    storage.setItem(__INTERNALS__.STORAGE_KEY, "{not valid json");
    expect(readCache("abc", { storage })).toBeNull();
  });

  it("returns null when entry is older than TTL", () => {
    const key = "abc";
    const tooOld = Date.now() - __INTERNALS__.CACHE_TTL_MS - 1000;
    // Manually plant an old entry so we control savedAt.
    storage.setItem(__INTERNALS__.STORAGE_KEY, JSON.stringify({
      key, compare: { x: 1 }, savedAt: tooOld,
    }));
    expect(readCache(key, { storage, now: Date.now() })).toBeNull();
  });

  it("returns the entry when within TTL", () => {
    const key = "abc";
    const recent = Date.now() - 1000;
    storage.setItem(__INTERNALS__.STORAGE_KEY, JSON.stringify({
      key, compare: { ok: true }, savedAt: recent,
    }));
    expect(readCache(key, { storage, now: Date.now() })).toEqual({ ok: true });
  });

  it("readCache returns null when called with an empty key", () => {
    writeCache("abc", { x: 1 }, { storage });
    expect(readCache("", { storage })).toBeNull();
    expect(readCache(null, { storage })).toBeNull();
  });

  it("writeCache returns false when called with an empty key", () => {
    expect(writeCache("", { x: 1 }, { storage })).toBe(false);
    expect(writeCache(null, { x: 1 }, { storage })).toBe(false);
  });

  it("overwrites existing cache entry on second write", () => {
    const k1 = "key1", k2 = "key2";
    writeCache(k1, { v: 1 }, { storage });
    writeCache(k2, { v: 2 }, { storage });
    // Single-slot cache: k1 is gone.
    expect(readCache(k1, { storage })).toBeNull();
    expect(readCache(k2, { storage })).toEqual({ v: 2 });
  });

  it("clearCache removes the entry", () => {
    writeCache("abc", { v: 1 }, { storage });
    clearCache({ storage });
    expect(readCache("abc", { storage })).toBeNull();
  });

  it("survives storage that throws on getItem", () => {
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readCache("abc", { storage: broken })).toBeNull();
  });

  it("survives storage that throws on setItem (quota exceeded)", () => {
    const broken = {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
      removeItem: () => {},
    };
    expect(writeCache("abc", { v: 1 }, { storage: broken })).toBe(false);
  });

  it("returns null when no storage is available (no localStorage)", () => {
    expect(readCache("abc", { storage: null })).toBeNull();
    expect(writeCache("abc", { v: 1 }, { storage: null })).toBe(false);
  });
});

describe("hashString (internal)", () => {
  it("is deterministic", () => {
    const { hashString } = __INTERNALS__;
    expect(hashString("hello world")).toBe(hashString("hello world"));
  });

  it("produces different output for different input", () => {
    const { hashString } = __INTERNALS__;
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("hello")).not.toBe(hashString("Hello"));
  });

  it("handles empty string", () => {
    const { hashString } = __INTERNALS__;
    expect(typeof hashString("")).toBe("string");
  });
});

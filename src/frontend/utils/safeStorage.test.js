import { describe, it, expect } from "vitest";
import {
  probeStorage,
  createMemoryStorage,
  getWorkingStorage,
  installSafeStorage,
} from "./safeStorage.js";

// A working Storage stand-in.
function goodStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

describe("probeStorage", () => {
  it("true for a working storage", () => {
    expect(probeStorage(goodStorage())).toBe(true);
  });
  it("false for null/undefined", () => {
    expect(probeStorage(null)).toBe(false);
    expect(probeStorage(undefined)).toBe(false);
  });
  it("false when setItem throws (Safari Private / quota exceeded)", () => {
    expect(probeStorage({
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {},
    })).toBe(false);
  });
  it("false when writes silently no-op (embedded webviews)", () => {
    expect(probeStorage({
      getItem: () => null,   // accepted the write but read back nothing
      setItem: () => {},
      removeItem: () => {},
    })).toBe(false);
  });
  it("false when getItem throws", () => {
    expect(probeStorage({
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => {},
      removeItem: () => {},
    })).toBe(false);
  });
  it("leaves no probe key behind", () => {
    const s = goodStorage();
    probeStorage(s);
    expect(s.getItem("__bm_probe__")).toBeNull();
  });
});

describe("createMemoryStorage", () => {
  it("round-trips values as strings", () => {
    const s = createMemoryStorage();
    s.setItem("a", 1);
    expect(s.getItem("a")).toBe("1");
  });
  it("null for missing keys", () => {
    expect(createMemoryStorage().getItem("nope")).toBeNull();
  });
  it("removeItem and clear work", () => {
    const s = createMemoryStorage();
    s.setItem("a", "1"); s.setItem("b", "2");
    s.removeItem("a");
    expect(s.getItem("a")).toBeNull();
    expect(s.getItem("b")).toBe("2");
    s.clear();
    expect(s.getItem("b")).toBeNull();
  });
  it("implements length and key() like real Storage", () => {
    const s = createMemoryStorage();
    expect(s.length).toBe(0);
    s.setItem("a", "1"); s.setItem("b", "2");
    expect(s.length).toBe(2);
    expect(s.key(0)).toBe("a");
    expect(s.key(99)).toBeNull();
  });
  it("passes its own probe (it is a valid Storage)", () => {
    expect(probeStorage(createMemoryStorage())).toBe(true);
  });
  it("is marked as the fallback", () => {
    expect(createMemoryStorage().__isMemoryFallback).toBe(true);
  });
});

describe("getWorkingStorage", () => {
  it("uses real storage when it works (Safari file://, any https)", () => {
    const win = { localStorage: goodStorage() };
    const { storage, durable } = getWorkingStorage(win);
    expect(durable).toBe(true);
    expect(storage).toBe(win.localStorage);
  });

  it("THE CHROMIUM BUG: survives the property getter throwing", () => {
    // Chromium file:// — merely reading window.localStorage throws SecurityError.
    const win = {};
    Object.defineProperty(win, "localStorage", {
      get() { throw new Error("SecurityError: access is denied for this document"); },
      configurable: true,
    });
    const { storage, durable } = getWorkingStorage(win);
    expect(durable).toBe(false);
    expect(storage.__isMemoryFallback).toBe(true);
    // and it must be usable, not just present
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
  });

  it("falls back when storage exists but is broken", () => {
    const win = { localStorage: { getItem: () => null, setItem: () => { throw new Error("nope"); }, removeItem: () => {} } };
    expect(getWorkingStorage(win).durable).toBe(false);
  });

  it("falls back with no window at all (SSR/node)", () => {
    expect(getWorkingStorage(undefined).durable).toBe(false);
  });
});

describe("installSafeStorage", () => {
  it("leaves working storage untouched and reports durable", () => {
    const real = goodStorage();
    const win = { localStorage: real };
    expect(installSafeStorage(win)).toEqual({ durable: true });
    expect(win.localStorage).toBe(real);
  });

  it("THE FIX: replaces a throwing localStorage so call sites stop blowing up", () => {
    const win = {};
    Object.defineProperty(win, "localStorage", {
      get() { throw new Error("SecurityError"); },
      configurable: true,
    });
    const { durable } = installSafeStorage(win);
    expect(durable).toBe(false);
    // The whole point: this line previously threw. Now it must not.
    expect(() => win.localStorage.getItem("x")).not.toThrow();
    win.localStorage.setItem("theme", "dark");
    expect(win.localStorage.getItem("theme")).toBe("dark");
  });

  it("is idempotent", () => {
    const win = {};
    Object.defineProperty(win, "localStorage", {
      get() { throw new Error("SecurityError"); },
      configurable: true,
    });
    installSafeStorage(win);
    win.localStorage.setItem("keep", "me");
    installSafeStorage(win); // second call must not wipe the store
    expect(win.localStorage.getItem("keep")).toBe("me");
    expect(installSafeStorage(win)).toEqual({ durable: false });
  });

  it("no window → reports non-durable without throwing", () => {
    expect(installSafeStorage(undefined)).toEqual({ durable: false });
  });

  it("exposes durability on the window for the app to read", () => {
    const win = { localStorage: goodStorage() };
    installSafeStorage(win);
    expect(win.__bmStorageDurable).toBe(true);
  });
});

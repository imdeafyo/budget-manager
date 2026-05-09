import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* Minimal in-memory localStorage shim, installed before importing log.js so
   the module-load attach + first configure() see a working storage. */
function makeMemStorage() {
  const map = new Map();
  const api = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
  return api;
}
globalThis.localStorage = makeMemStorage();

const logModule = await import("./log.js");
const {
  configure, info, warn, error, getEvents, clear, exportAll, getConfig,
  _resetForTests, _flushNowForTests, _STORAGE_KEY,
} = logModule;
const log = logModule.default;

// Silence console mirror noise during tests.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Fresh storage per test.
  globalThis.localStorage = makeMemStorage();
  _resetForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("log — basic API", () => {
  it("returns no events before configure() is called (disabled by default config but config.enabled=true means push works)", () => {
    // Before configure() the module has its default config which is enabled=true,
    // but tests reset state. Without configure() it still works because defaults
    // are set in module scope. Verify direct call works.
    info("test.event", { a: 1 });
    const events = getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("test.event");
    expect(events[0].data).toEqual({ a: 1 });
    expect(events[0].level).toBe("info");
    expect(typeof events[0].ts).toBe("number");
  });

  it("supports info/warn/error and stamps level correctly", () => {
    info("e1");
    warn("e2");
    error("e3");
    const events = getEvents();
    expect(events.map(e => e.level)).toEqual(["info", "warn", "error"]);
  });

  it("default export exposes all functions", () => {
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.configure).toBe("function");
    expect(typeof log.clear).toBe("function");
  });
});

describe("log — configure / disabled", () => {
  it("when disabled, push functions are no-ops", () => {
    configure({ enabled: false, persist: false });
    info("nope");
    error("also nope");
    expect(getEvents()).toHaveLength(0);
  });

  it("re-enabling resumes capture", () => {
    configure({ enabled: false, persist: false });
    info("a");
    configure({ enabled: true, persist: false });
    info("b");
    expect(getEvents().map(e => e.event)).toEqual(["b"]);
  });

  it("getConfig returns sanitized config without internal flags", () => {
    configure({ enabled: true, persist: true, maxEvents: 250, minLevel: "warn" });
    const cfg = getConfig();
    expect(cfg).toEqual({ enabled: true, persist: true, maxEvents: 250, minLevel: "warn" });
    expect(cfg).not.toHaveProperty("_initialized");
  });

  it("coerces invalid maxEvents within bounds", () => {
    configure({ maxEvents: 0 });
    expect(getConfig().maxEvents).toBe(1);
    configure({ maxEvents: 99999 });
    expect(getConfig().maxEvents).toBe(5000);
    configure({ maxEvents: "garbage" });
    expect(getConfig().maxEvents).toBe(500); // falls back to default
  });

  it("rejects unknown minLevel and falls back to info", () => {
    configure({ minLevel: "verbose" });
    expect(getConfig().minLevel).toBe("info");
  });
});

describe("log — level filter at source", () => {
  it("drops events below minLevel before they enter the buffer", () => {
    configure({ enabled: true, persist: false, minLevel: "warn" });
    info("dropped1");
    info("dropped2");
    warn("kept1");
    error("kept2");
    expect(getEvents().map(e => e.event)).toEqual(["kept1", "kept2"]);
  });

  it("level=error keeps only errors", () => {
    configure({ minLevel: "error", persist: false });
    info("a"); warn("b"); error("c");
    expect(getEvents().map(e => e.event)).toEqual(["c"]);
  });
});

describe("log — getEvents filter", () => {
  beforeEach(() => {
    configure({ enabled: true, persist: false, minLevel: "info" });
    info("i1"); warn("w1"); error("e1"); info("i2");
  });

  it("filter by level returns >= that level", () => {
    expect(getEvents({ level: "warn" }).map(e => e.event)).toEqual(["w1", "e1"]);
    expect(getEvents({ level: "error" }).map(e => e.event)).toEqual(["e1"]);
  });

  it("filter by limit returns the most recent N", () => {
    expect(getEvents({ limit: 2 }).map(e => e.event)).toEqual(["e1", "i2"]);
  });

  it("filter by sinceMs returns recent events only", () => {
    // All events were just pushed, so a 60s window keeps them all.
    expect(getEvents({ sinceMs: 60_000 })).toHaveLength(4);
    // A 0ms window means cutoff = now, events from prior ticks are excluded.
    // (Some may match if ts === now exactly; just assert no error.)
    const out = getEvents({ sinceMs: 1 });
    expect(Array.isArray(out)).toBe(true);
  });
});

describe("log — ring buffer cap", () => {
  it("evicts oldest when exceeding maxEvents", () => {
    configure({ enabled: true, persist: false, maxEvents: 3 });
    info("a"); info("b"); info("c"); info("d"); info("e");
    expect(getEvents().map(e => e.event)).toEqual(["c", "d", "e"]);
  });

  it("shrinking maxEvents trims existing buffer", () => {
    configure({ enabled: true, persist: false, maxEvents: 100 });
    for (let i = 0; i < 50; i++) info(`e${i}`);
    expect(getEvents()).toHaveLength(50);
    configure({ maxEvents: 10 });
    expect(getEvents()).toHaveLength(10);
    expect(getEvents().map(e => e.event)).toEqual(
      ["e40","e41","e42","e43","e44","e45","e46","e47","e48","e49"]
    );
  });
});

describe("log — clear", () => {
  it("empties the buffer and removes localStorage", () => {
    configure({ enabled: true, persist: true });
    info("x");
    _flushNowForTests();
    expect(localStorage.getItem(_STORAGE_KEY)).not.toBeNull();
    clear();
    expect(getEvents()).toHaveLength(0);
    expect(localStorage.getItem(_STORAGE_KEY)).toBeNull();
  });
});

describe("log — exportAll", () => {
  it("returns JSON string of full buffer", () => {
    configure({ enabled: true, persist: false });
    info("a", { x: 1 });
    warn("b");
    const json = exportAll();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].event).toBe("a");
    expect(parsed[0].data).toEqual({ x: 1 });
    expect(parsed[1].level).toBe("warn");
  });
});

describe("log — persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not write when persist=false", () => {
    configure({ enabled: true, persist: false });
    info("nope");
    _flushNowForTests();
    expect(localStorage.getItem(_STORAGE_KEY)).toBeNull();
  });

  it("writes to localStorage when persist=true after a flush", () => {
    configure({ enabled: true, persist: true });
    info("a", { hello: "world" });
    _flushNowForTests();
    const raw = localStorage.getItem(_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].event).toBe("a");
  });

  it("errors flush immediately, not waiting for debounce", () => {
    configure({ enabled: true, persist: true });
    error("crash", { boom: true });
    // No manual flush — error path should have written synchronously.
    const raw = localStorage.getItem(_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed[0].event).toBe("crash");
  });

  it("loads persisted events on first configure()", () => {
    // Seed storage as if a previous session wrote it.
    const seed = [
      { ts: 1000, level: "info", event: "old1", data: null },
      { ts: 2000, level: "warn", event: "old2", data: null },
    ];
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(seed));
    _resetForTests();
    // Re-seed since _resetForTests clears storage too.
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(seed));
    configure({ enabled: true, persist: true });
    const events = getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("old1");
    expect(events[1].event).toBe("old2");
  });

  it("turning off persist clears the storage slot", () => {
    configure({ enabled: true, persist: true });
    info("a");
    _flushNowForTests();
    expect(localStorage.getItem(_STORAGE_KEY)).not.toBeNull();
    configure({ persist: false });
    expect(localStorage.getItem(_STORAGE_KEY)).toBeNull();
  });

  it("survives corrupt localStorage on load", () => {
    localStorage.setItem(_STORAGE_KEY, "{not json");
    _resetForTests();
    localStorage.setItem(_STORAGE_KEY, "{not json");
    expect(() => configure({ enabled: true, persist: true })).not.toThrow();
    expect(getEvents()).toHaveLength(0);
  });

  it("persisted load respects maxEvents cap", () => {
    const seed = Array.from({ length: 200 }, (_, i) => ({
      ts: i, level: "info", event: `e${i}`, data: null
    }));
    _resetForTests();
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(seed));
    configure({ enabled: true, persist: true, maxEvents: 50 });
    expect(getEvents()).toHaveLength(50);
    expect(getEvents()[0].event).toBe("e150");
    expect(getEvents()[49].event).toBe("e199");
  });
});

describe("log — debounce behavior", () => {
  it("multiple info events between flushes coalesce into one storage write", () => {
    vi.useFakeTimers();
    try {
      configure({ enabled: true, persist: true });
      const setItemSpy = vi.spyOn(globalThis.localStorage, "setItem");
      info("a"); info("b"); info("c");
      // No flush happened yet.
      const writesBefore = setItemSpy.mock.calls.filter(c => c[0] === _STORAGE_KEY);
      expect(writesBefore.length).toBe(0);
      vi.advanceTimersByTime(1100);
      // One write captured all three.
      const writesAfter = setItemSpy.mock.calls.filter(c => c[0] === _STORAGE_KEY);
      expect(writesAfter.length).toBe(1);
      const parsed = JSON.parse(writesAfter[0][1]);
      expect(parsed).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("log — entry shape", () => {
  it("entries have ts, level, event, data fields", () => {
    configure({ enabled: true, persist: false });
    const before = Date.now();
    info("shape", { foo: "bar" });
    const after = Date.now();
    const [e] = getEvents();
    expect(e.ts).toBeGreaterThanOrEqual(before);
    expect(e.ts).toBeLessThanOrEqual(after);
    expect(e.level).toBe("info");
    expect(e.event).toBe("shape");
    expect(e.data).toEqual({ foo: "bar" });
  });

  it("null data is preserved as null, not stringified", () => {
    configure({ enabled: true, persist: false });
    info("x");
    const [e] = getEvents();
    expect(e.data).toBeNull();
  });

  it("non-string event names are coerced to strings", () => {
    configure({ enabled: true, persist: false });
    info(42);
    const [e] = getEvents();
    expect(e.event).toBe("42");
  });
});

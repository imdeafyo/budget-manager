import { describe, it, expect } from "vitest";
import {
  DEFAULT_HISTORY_CONFIG,
  dueTiers,
  mergeLabels,
  labelHasTier,
  pruneRetention,
  summarizeState,
  diffSummaries,
} from "./history.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

describe("dueTiers", () => {
  it("returns all tiers when no last-snapshot map provided", () => {
    expect(dueTiers(new Date(), {})).toEqual(["hourly", "daily", "weekly", "monthly"]);
  });

  it("returns all tiers when last-snapshot map is null", () => {
    expect(dueTiers(new Date(), null)).toEqual(["hourly", "daily", "weekly", "monthly"]);
  });

  it("treats missing/null tier entries as infinitely old", () => {
    const now = Date.now();
    expect(dueTiers(now, { hourly: new Date(now - 30 * 60 * 1000).toISOString() }))
      .toEqual(["daily", "weekly", "monthly"]);
  });

  it("returns no tiers when all are within their interval", () => {
    const now = Date.now();
    const last = {
      hourly:  new Date(now - 30 * 60 * 1000).toISOString(),
      daily:   new Date(now - 12 * HOUR).toISOString(),
      weekly:  new Date(now - 3 * DAY).toISOString(),
      monthly: new Date(now - 10 * DAY).toISOString(),
    };
    expect(dueTiers(now, last)).toEqual([]);
  });

  it("returns hourly when last hourly snapshot is over 1h old", () => {
    const now = Date.now();
    const last = {
      hourly:  new Date(now - 61 * 60 * 1000).toISOString(),
      daily:   new Date(now - 12 * HOUR).toISOString(),
      weekly:  new Date(now - 3 * DAY).toISOString(),
      monthly: new Date(now - 10 * DAY).toISOString(),
    };
    expect(dueTiers(now, last)).toEqual(["hourly"]);
  });

  it("returns multiple tiers at midnight on a Sunday in week 1 of month", () => {
    const now = Date.now();
    const last = {
      hourly:  new Date(now - 2 * HOUR).toISOString(),
      daily:   new Date(now - 25 * HOUR).toISOString(),
      weekly:  new Date(now - 8 * DAY).toISOString(),
      monthly: new Date(now - 31 * DAY).toISOString(),
    };
    expect(dueTiers(now, last)).toEqual(["hourly", "daily", "weekly", "monthly"]);
  });

  it("ignores invalid date strings (treats as infinitely old)", () => {
    expect(dueTiers(new Date(), { hourly: "not-a-date" })).toContain("hourly");
  });

  it("accepts Date objects for `now`", () => {
    expect(dueTiers(new Date(), {}).length).toBe(4);
  });
});

describe("mergeLabels", () => {
  it("returns empty string for empty input", () => {
    expect(mergeLabels([])).toBe("");
    expect(mergeLabels(null)).toBe("");
  });

  it("returns single label unchanged", () => {
    expect(mergeLabels(["hourly"])).toBe("hourly");
  });

  it("joins multiple labels in canonical order", () => {
    expect(mergeLabels(["daily", "hourly"])).toBe("hourly+daily");
    expect(mergeLabels(["monthly", "hourly", "weekly", "daily"])).toBe("hourly+daily+weekly+monthly");
  });

  it("dedupes input", () => {
    expect(mergeLabels(["hourly", "hourly", "daily"])).toBe("hourly+daily");
  });
});

describe("labelHasTier", () => {
  it("matches single-tier labels", () => {
    expect(labelHasTier("hourly", "hourly")).toBe(true);
    expect(labelHasTier("hourly", "daily")).toBe(false);
  });

  it("matches compound labels", () => {
    expect(labelHasTier("hourly+daily", "hourly")).toBe(true);
    expect(labelHasTier("hourly+daily", "daily")).toBe(true);
    expect(labelHasTier("hourly+daily", "weekly")).toBe(false);
  });

  it("does not match substrings (e.g. 'hour' should not match 'hourly')", () => {
    expect(labelHasTier("hourly", "hour")).toBe(false);
  });

  it("returns false for null/empty label", () => {
    expect(labelHasTier(null, "hourly")).toBe(false);
    expect(labelHasTier("", "hourly")).toBe(false);
  });
});

describe("pruneRetention", () => {
  // Helper to make rows with newest at the top.
  const mkRow = (id, hoursAgo, label) => ({
    id,
    label,
    saved_at: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
  });

  it("returns empty array for empty input", () => {
    expect(pruneRetention([])).toEqual([]);
  });

  it("keeps the most recent N hourly rows, prunes the rest", () => {
    const cfg = { ...DEFAULT_HISTORY_CONFIG, hourly: { intervalMs: HOUR, keep: 3 } };
    const rows = [
      mkRow("a", 1, "hourly"),
      mkRow("b", 2, "hourly"),
      mkRow("c", 3, "hourly"),
      mkRow("d", 4, "hourly"),
      mkRow("e", 5, "hourly"),
    ];
    expect(pruneRetention(rows, cfg).sort()).toEqual(["d", "e"]);
  });

  it("never auto-prunes manual snapshots", () => {
    const cfg = { ...DEFAULT_HISTORY_CONFIG, hourly: { intervalMs: HOUR, keep: 1 } };
    const rows = [
      mkRow("a", 1, "manual"),
      mkRow("b", 2, "manual"),
      mkRow("c", 3, "manual"),
      mkRow("d", 4, "hourly"),
    ];
    expect(pruneRetention(rows, cfg)).toEqual([]);
  });

  it("compound labels count toward both tiers' retention", () => {
    // hourly retention 1, daily retention 5. A row labeled "hourly+daily" at
    // position #2 in hourly order is outside hourly retention but inside
    // daily retention → must be kept.
    const cfg = {
      hourly:  { intervalMs: HOUR,  keep: 1 },
      daily:   { intervalMs: DAY,   keep: 5 },
      weekly:  { intervalMs: WEEK,  keep: 0 },
      monthly: { intervalMs: MONTH, keep: 0 },
    };
    const rows = [
      mkRow("a", 1, "hourly"),
      mkRow("b", 2, "hourly+daily"),
      mkRow("c", 25, "daily"),
    ];
    expect(pruneRetention(rows, cfg)).toEqual([]);
  });

  it("prunes a row only when outside retention of every tier it belongs to", () => {
    const cfg = {
      hourly:  { intervalMs: HOUR,  keep: 1 },
      daily:   { intervalMs: DAY,   keep: 1 },
      weekly:  { intervalMs: WEEK,  keep: 0 },
      monthly: { intervalMs: MONTH, keep: 0 },
    };
    const rows = [
      mkRow("a", 1, "hourly+daily"),
      mkRow("b", 2, "hourly+daily"), // outside hourly (#2) AND outside daily (#2) → pruned
      mkRow("c", 3, "hourly"),       // outside hourly (#3) → pruned
    ];
    expect(pruneRetention(rows, cfg).sort()).toEqual(["b", "c"]);
  });

  it("handles unsorted input by sorting newest-first internally", () => {
    const cfg = { ...DEFAULT_HISTORY_CONFIG, hourly: { intervalMs: HOUR, keep: 2 } };
    const rows = [
      mkRow("c", 3, "hourly"),
      mkRow("a", 1, "hourly"),
      mkRow("b", 2, "hourly"),
    ];
    expect(pruneRetention(rows, cfg)).toEqual(["c"]);
  });
});

describe("summarizeState", () => {
  it("handles missing/empty state defensively", () => {
    expect(summarizeState(null).exp).toBe(0);
    expect(summarizeState(undefined).milestones).toBe(0);
    expect(summarizeState({}).cSal).toBe(0);
  });

  it("counts array fields and pulls headline numbers", () => {
    const s = {
      exp: [{}, {}, {}],
      sav: [{}, {}],
      milestones: [{}],
      transactions: [{}, {}, {}, {}],
      cSal: 100000,
      kSal: 80000,
    };
    const out = summarizeState(s);
    expect(out.exp).toBe(3);
    expect(out.sav).toBe(2);
    expect(out.milestones).toBe(1);
    expect(out.transactions).toBe(4);
    expect(out.cSal).toBe(100000);
    expect(out.kSal).toBe(80000);
    expect(out.sizeBytes).toBeGreaterThan(0);
  });

  it("read shim: accepts pre-rename `snapshots` key for milestone count", () => {
    const out = summarizeState({ snapshots: [{}, {}, {}] });
    expect(out.milestones).toBe(3);
  });

  it("coerces non-numeric salary fields to 0", () => {
    expect(summarizeState({ cSal: "oops" }).cSal).toBe(0);
  });
});

describe("diffSummaries", () => {
  it("computes per-field deltas", () => {
    const cur = { exp: [{}, {}], sav: [{}], milestones: [], transactions: [], cSal: 100000, kSal: 80000 };
    const cand = { exp: [{}, {}, {}], sav: [{}], milestones: [{}], transactions: [{}], cSal: 110000, kSal: 80000 };
    const d = diffSummaries(cur, cand);
    expect(d.exp.delta).toBe(1);
    expect(d.sav.delta).toBe(0);
    expect(d.milestones.delta).toBe(1);
    expect(d.transactions.delta).toBe(1);
    expect(d.cSal.delta).toBe(10000);
    expect(d.kSal.delta).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizeDesc, tokenize, descriptionsMatch, scanForDuplicates,
} from "./duplicateScan.js";

const tx = (id, date, amount, description, account = "checking", extra = {}) => ({
  id, date, amount, description, account,
  category: null, currency: "USD", notes: null,
  custom_fields: {}, splits: null,
  ...extra,
});

describe("normalizeDesc", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeDesc("  AMAZON  COM  ")).toBe("amazon com");
  });
  it("strips trailing punctuation", () => {
    expect(normalizeDesc("AMAZON.COM!!!")).toBe("amazon.com");
  });
  it("returns empty for non-string input", () => {
    expect(normalizeDesc(null)).toBe("");
    expect(normalizeDesc(undefined)).toBe("");
    expect(normalizeDesc(42)).toBe("");
  });
});

describe("tokenize", () => {
  it("splits on punctuation + whitespace", () => {
    expect(tokenize("AMAZON.COM*ABC123")).toEqual(["amazon", "com", "abc123"]);
    expect(tokenize("Costco Wholesale #1234")).toEqual(["costco", "wholesale", "1234"]);
  });
  it("returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});

describe("descriptionsMatch", () => {
  it("'off' mode always matches", () => {
    expect(descriptionsMatch("Apples", "Oranges", "off")).toBe(true);
    expect(descriptionsMatch("", "", "off")).toBe(true);
  });

  it("'exact' mode matches normalized exact strings", () => {
    expect(descriptionsMatch("AMAZON.COM", "amazon.com", "exact")).toBe(true);
    expect(descriptionsMatch("AMAZON COM", "  amazon  com  ", "exact")).toBe(true);
    expect(descriptionsMatch("AMAZON #1", "AMAZON #2", "exact")).toBe(false);
  });

  it("'first-words' mode matches the first N tokens", () => {
    expect(descriptionsMatch("AMAZON COM ABC123", "AMAZON COM XYZ789", "first-words", 2)).toBe(true);
    expect(descriptionsMatch("COSTCO #1234", "COSTCO #5678", "first-words", 1)).toBe(true);
    expect(descriptionsMatch("AMZ", "AMAZON", "first-words", 1)).toBe(false);
  });

  it("'first-words' fails when either side has no tokens", () => {
    expect(descriptionsMatch("", "amazon", "first-words", 2)).toBe(false);
    expect(descriptionsMatch("...", "amazon", "first-words", 2)).toBe(false);
  });
});

describe("scanForDuplicates — empty / edge cases", () => {
  it("returns empty for empty input", () => {
    expect(scanForDuplicates([])).toEqual({ groups: [], totalDuplicates: 0, scannedCount: 0 });
    expect(scanForDuplicates(null)).toEqual({ groups: [], totalDuplicates: 0, scannedCount: 0 });
  });

  it("ignores rows missing date or amount", () => {
    const txs = [
      tx("1", "2026-04-01", 50, "Food"),
      tx("2", "", 50, "Food"),
      tx("3", "2026-04-01", undefined, "Food"),
      tx("4", "2026-04-01", 50, "Food"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.scannedCount).toBe(2);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toHaveLength(2);
  });

  it("returns no groups when nothing matches", () => {
    const txs = [
      tx("1", "2026-04-01", 10, "A"),
      tx("2", "2026-04-02", 20, "B"),
      tx("3", "2026-04-03", 30, "C"),
    ];
    expect(scanForDuplicates(txs).groups).toHaveLength(0);
  });
});

describe("scanForDuplicates — basic same-day dedup", () => {
  it("flags two rows with same date+amount+description", () => {
    const txs = [
      tx("1", "2026-04-01", -50, "Starbucks", "card_a"),
      tx("2", "2026-04-01", -50, "Starbucks", "card_b"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map(m => m.id)).toEqual(["1", "2"]);
    expect(r.totalDuplicates).toBe(1); // 2 members - 1 = 1 "duplicate"
  });

  it("clusters triplicates into one group of 3", () => {
    const txs = [
      tx("1", "2026-04-01", -50, "Starbucks", "a"),
      tx("2", "2026-04-01", -50, "Starbucks", "b"),
      tx("3", "2026-04-01", -50, "Starbucks", "c"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toHaveLength(3);
    expect(r.totalDuplicates).toBe(2);
  });

  it("does NOT cross signs — refund and charge same-day same-desc are not duplicates", () => {
    const txs = [
      tx("1", "2026-04-01", -50, "Best Buy"),
      tx("2", "2026-04-01",  50, "Best Buy"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(0);
  });
});

describe("scanForDuplicates — cross-account matching", () => {
  it("flags duplicates regardless of account", () => {
    const txs = [
      tx("1", "2026-04-01", -25, "Lunch", "card_personal"),
      tx("2", "2026-04-01", -25, "Lunch", "card_business"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map(m => m.account)).toEqual(["card_personal", "card_business"]);
  });
});

describe("scanForDuplicates — date window", () => {
  it("flags posting-date drift within ±3 days", () => {
    const txs = [
      tx("1", "2026-04-01", -100, "Hotel"),
      tx("2", "2026-04-03", -100, "Hotel"),
    ];
    const sameDay = scanForDuplicates(txs, { dayWindow: 0 });
    expect(sameDay.groups).toHaveLength(0);
    const within3 = scanForDuplicates(txs, { dayWindow: 3 });
    expect(within3.groups).toHaveLength(1);
  });

  it("does NOT cluster rows beyond the window", () => {
    const txs = [
      tx("1", "2026-04-01", -100, "Hotel"),
      tx("2", "2026-04-15", -100, "Hotel"),
    ];
    const r = scanForDuplicates(txs, { dayWindow: 3 });
    expect(r.groups).toHaveLength(0);
  });

  it("transitively clusters chain-of-near-dates", () => {
    // Rows 1↔2 within 3d, 2↔3 within 3d, but 1↔3 = 6 days apart.
    // Union-find should still group all three.
    const txs = [
      tx("1", "2026-04-01", -100, "Hotel"),
      tx("2", "2026-04-04", -100, "Hotel"),
      tx("3", "2026-04-07", -100, "Hotel"),
    ];
    const r = scanForDuplicates(txs, { dayWindow: 3 });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toHaveLength(3);
  });
});

describe("scanForDuplicates — amount tolerance", () => {
  it("flags amounts within tolerance", () => {
    const txs = [
      tx("1", "2026-04-01", -50.00, "Coffee"),
      tx("2", "2026-04-01", -50.02, "Coffee"),
    ];
    const strict = scanForDuplicates(txs, { amountTolerance: 0.01 });
    expect(strict.groups).toHaveLength(0);
    const loose = scanForDuplicates(txs, { amountTolerance: 0.05 });
    expect(loose.groups).toHaveLength(1);
  });

  it("does NOT cluster across larger gaps", () => {
    const txs = [
      tx("1", "2026-04-01", -50, "Coffee"),
      tx("2", "2026-04-01", -55, "Coffee"),
    ];
    expect(scanForDuplicates(txs).groups).toHaveLength(0);
  });
});

describe("scanForDuplicates — description mode", () => {
  it("'off' mode clusters by date+amount only (potentially aggressive)", () => {
    const txs = [
      tx("1", "2026-04-01", -25, "Different Place A"),
      tx("2", "2026-04-01", -25, "Different Place B"),
    ];
    const off = scanForDuplicates(txs, { descriptionMode: "off" });
    expect(off.groups).toHaveLength(1);
    const exact = scanForDuplicates(txs, { descriptionMode: "exact" });
    expect(exact.groups).toHaveLength(0);
  });

  it("'first-words' clusters merchants with reference-number drift", () => {
    const txs = [
      tx("1", "2026-04-01", -25, "AMAZON.COM*ABC123"),
      tx("2", "2026-04-01", -25, "AMAZON.COM*XYZ789"),
    ];
    const exact = scanForDuplicates(txs, { descriptionMode: "exact" });
    expect(exact.groups).toHaveLength(0);
    const fw = scanForDuplicates(txs, { descriptionMode: "first-words", firstWordCount: 2 });
    expect(fw.groups).toHaveLength(1);
  });

  it("'first-words' with count=1 catches very short merchant names", () => {
    const txs = [
      tx("1", "2026-04-01", -10, "STARBUCKS #1234"),
      tx("2", "2026-04-01", -10, "STARBUCKS #5678"),
    ];
    const fw1 = scanForDuplicates(txs, { descriptionMode: "first-words", firstWordCount: 1 });
    expect(fw1.groups).toHaveLength(1);
  });
});

describe("scanForDuplicates — transfers excluded", () => {
  it("ignores marked-transfer rows", () => {
    // Two transfer rows with the same date+amount+desc would normally be
    // flagged as duplicates, but they're confirmed transfers.
    const txs = [
      tx("1", "2026-04-01", -500, "Transfer to Savings", "checking", { custom_fields: { _is_transfer: true } }),
      tx("2", "2026-04-01", -500, "Transfer to Savings", "checking", { custom_fields: { _is_transfer: true } }),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(0);
    expect(r.scannedCount).toBe(0);
  });

  it("flags non-transfer rows even when transfers are also present", () => {
    const txs = [
      tx("1", "2026-04-01", -500, "Transfer to Savings", "checking", { custom_fields: { _is_transfer: true } }),
      tx("2", "2026-04-01", -50, "Lunch"),
      tx("3", "2026-04-01", -50, "Lunch"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map(m => m.id)).toEqual(["2", "3"]);
  });
});

describe("scanForDuplicates — sort order", () => {
  it("sorts members within a group by date ascending", () => {
    const txs = [
      tx("c", "2026-04-03", -50, "Bagel"),
      tx("a", "2026-04-01", -50, "Bagel"),
      tx("b", "2026-04-02", -50, "Bagel"),
    ];
    const r = scanForDuplicates(txs, { dayWindow: 5 });
    expect(r.groups[0].members.map(m => m.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts groups by member count desc, then by amount desc", () => {
    const txs = [
      // 2 members at $50
      tx("a1", "2026-04-01", -50, "Coffee"),
      tx("a2", "2026-04-01", -50, "Coffee"),
      // 3 members at $20 (smaller amount but bigger group)
      tx("b1", "2026-04-01", -20, "Tea"),
      tx("b2", "2026-04-01", -20, "Tea"),
      tx("b3", "2026-04-01", -20, "Tea"),
      // 2 members at $200 (bigger amount, same group size as group A)
      tx("c1", "2026-04-01", -200, "Hotel"),
      tx("c2", "2026-04-01", -200, "Hotel"),
    ];
    const r = scanForDuplicates(txs);
    // Order: B (3 members) → C ($200, 2 members) → A ($50, 2 members)
    expect(r.groups.map(g => Math.abs(g.members[0].amount))).toEqual([20, 200, 50]);
  });
});

describe("scanForDuplicates — combined criteria", () => {
  it("only clusters when ALL criteria pass", () => {
    const txs = [
      // Same desc, same day, but $5 apart — should NOT cluster with $0.01 tol
      tx("1", "2026-04-01", -100, "Hotel"),
      tx("2", "2026-04-01", -105, "Hotel"),
      // Real cluster
      tx("3", "2026-04-05", -100, "Hotel"),
      tx("4", "2026-04-06", -100, "Hotel"),
    ];
    const r = scanForDuplicates(txs, { dayWindow: 3, amountTolerance: 0.01, descriptionMode: "exact" });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map(m => m.id)).toEqual(["3", "4"]);
  });

  it("real-world: same merchant, same amount, posted to two cards 1 day apart", () => {
    const txs = [
      tx("a", "2026-03-15", -47.83, "WHOLEFDS", "amex_personal"),
      tx("b", "2026-03-16", -47.83, "WHOLEFDS", "chase_business"),
    ];
    const r = scanForDuplicates(txs, { dayWindow: 3, amountTolerance: 0.01, descriptionMode: "exact" });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizeDesc, tokenize, descriptionsMatch, scanForDuplicates, normalizeAccount,
  analyzeDuplicateGroups, looksLikeContributionAccount, classifyBatchRelationship,
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
      tx("2", "2026-04-01", -50, "Starbucks", "card_a"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map(m => m.id)).toEqual(["1", "2"]);
    expect(r.totalDuplicates).toBe(1); // 2 members - 1 = 1 "duplicate"
  });

  it("clusters triplicates into one group of 3", () => {
    const txs = [
      tx("1", "2026-04-01", -50, "Starbucks", "a"),
      tx("2", "2026-04-01", -50, "Starbucks", "a"),
      tx("3", "2026-04-01", -50, "Starbucks", "a"),
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
  it("flags duplicates across accounts when crossAccount is enabled", () => {
    const txs = [
      tx("1", "2026-04-01", -25, "Lunch", "card_personal"),
      tx("2", "2026-04-01", -25, "Lunch", "card_business"),
    ];
    const r = scanForDuplicates(txs, { crossAccount: true });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map(m => m.account)).toEqual(["card_personal", "card_business"]);
    expect(r.groups[0].crossAccount).toBe(true);
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
    const r = scanForDuplicates(txs, { dayWindow: 3, amountTolerance: 0.01, descriptionMode: "exact", crossAccount: true });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toHaveLength(2);
    expect(r.groups[0].crossAccount).toBe(true);
  });
});

describe("normalizeAccount", () => {
  it("trims, lowercases, collapses whitespace", () => {
    expect(normalizeAccount("  Amex   Platinum ")).toBe("amex platinum");
  });
  it("returns empty for missing/non-string", () => {
    expect(normalizeAccount(null)).toBe("");
    expect(normalizeAccount(undefined)).toBe("");
    expect(normalizeAccount(123)).toBe("");
  });
});

describe("scanForDuplicates — account awareness", () => {
  it("default (same-account only) does NOT cluster matching rows on different accounts", () => {
    const txs = [
      tx("a", "2024-01-10", -4.5, "Starbucks", "Amex Platinum"),
      tx("b", "2024-01-10", -4.5, "Starbucks", "Amex Platinum Additional"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(0);
    expect(r.totalDuplicates).toBe(0);
  });

  it("default DOES cluster matching rows on the same account", () => {
    const txs = [
      tx("a", "2024-01-10", -4.5, "Starbucks", "Amex Platinum"),
      tx("b", "2024-01-10", -4.5, "Starbucks", "Amex Platinum"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toHaveLength(2);
    expect(r.groups[0].crossAccount).toBe(false);
  });

  it("crossAccount:true clusters across accounts and tags the group", () => {
    const txs = [
      tx("a", "2024-01-10", -4.5, "Starbucks", "Amex Platinum"),
      tx("b", "2024-01-10", -4.5, "Starbucks", "Amex Platinum Additional"),
    ];
    const r = scanForDuplicates(txs, { crossAccount: true });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toHaveLength(2);
    expect(r.groups[0].crossAccount).toBe(true);
  });

  it("treats blank/missing accounts as the same (unknown) account", () => {
    const txs = [
      tx("a", "2024-01-10", -4.5, "Starbucks", ""),
      tx("b", "2024-01-10", -4.5, "Starbucks", "   "),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].crossAccount).toBe(false);
  });

  it("account match is case/whitespace-insensitive", () => {
    const txs = [
      tx("a", "2024-01-10", -4.5, "Starbucks", "Amex Platinum"),
      tx("b", "2024-01-10", -4.5, "Starbucks", "amex  platinum"),
    ];
    const r = scanForDuplicates(txs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].crossAccount).toBe(false);
  });

  it("sorts same-account groups before cross-account groups", () => {
    const txs = [
      // same-account pair, small amount
      tx("a", "2024-01-10", -4.5, "Starbucks", "Checking"),
      tx("b", "2024-01-10", -4.5, "Starbucks", "Checking"),
      // cross-account pair, larger amount (would sort first on amount alone)
      tx("c", "2024-02-10", -99.0, "BigStore", "Amex Platinum"),
      tx("d", "2024-02-10", -99.0, "BigStore", "Amex Platinum Additional"),
    ];
    const r = scanForDuplicates(txs, { crossAccount: true });
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].crossAccount).toBe(false); // same-account first despite smaller amount
    expect(r.groups[1].crossAccount).toBe(true);
  });

  it("in crossAccount mode, a group confined to one account is not tagged cross", () => {
    const txs = [
      tx("a", "2024-01-10", -4.5, "Starbucks", "Checking"),
      tx("b", "2024-01-10", -4.5, "Starbucks", "Checking"),
    ];
    const r = scanForDuplicates(txs, { crossAccount: true });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].crossAccount).toBe(false);
  });
});

describe("looksLikeContributionAccount", () => {
  it("flags retirement/investment account names", () => {
    expect(looksLikeContributionAccount("Lockheed Martin Savings Plans")).toBe(true);
    expect(looksLikeContributionAccount("Corey Roth IRA")).toBe(true);
    expect(looksLikeContributionAccount("Health Savings Account")).toBe(true);
    expect(looksLikeContributionAccount("Fidelity 401k")).toBe(true);
  });
  it("does not flag ordinary spending accounts", () => {
    expect(looksLikeContributionAccount("Amex Platinum")).toBe(false);
    expect(looksLikeContributionAccount("Chase Checking")).toBe(false);
    expect(looksLikeContributionAccount("Paypal Balance")).toBe(false);
  });
  it("is safe on blank/garbage", () => {
    expect(looksLikeContributionAccount("")).toBe(false);
    expect(looksLikeContributionAccount(null)).toBe(false);
  });
});

describe("classifyBatchRelationship", () => {
  const m = (id, batch) => ({ id, import_batch_id: batch });
  it("INTRA-BATCH when members share a batch id", () => {
    expect(classifyBatchRelationship({ members: [m("a", "b1"), m("b", "b1")] })).toBe("INTRA-BATCH");
  });
  it("CROSS-BATCH when members span different batches", () => {
    expect(classifyBatchRelationship({ members: [m("a", "b1"), m("b", "b2")] })).toBe("CROSS-BATCH");
  });
  it("MANUAL/UNKNOWN when a member lacks a batch id", () => {
    expect(classifyBatchRelationship({ members: [m("a", null), m("b", "b2")] })).toBe("MANUAL/UNKNOWN");
  });
  it("reads batch id from custom_fields fallback", () => {
    const g = { members: [
      { id: "a", custom_fields: { import_batch_id: "b1" } },
      { id: "b", custom_fields: { import_batch_id: "b1" } },
    ] };
    expect(classifyBatchRelationship(g)).toBe("INTRA-BATCH");
  });
});

describe("analyzeDuplicateGroups", () => {
  const grp = (amount, account, batch, n = 2) => ({
    key: `k${amount}${account}`,
    members: Array.from({ length: n }, (_, i) => ({
      id: `${account}-${amount}-${i}`, amount, account, import_batch_id: batch,
    })),
  });

  it("tallies batch, bracket, and account breakdowns", () => {
    const groups = [
      grp(-1847, "Checking", "b1"),       // big, intra, spending
      grp(-52.30, "Amex Platinum", "b1"), // mid, intra, spending
      grp(-4.50, "Amex Platinum", "b2", 3), // small, but 2 removable
      grp(-370.74, "Lockheed Martin Savings", "b1"), // big, intra, CONTRIB
    ];
    const a = analyzeDuplicateGroups(groups);
    expect(a.totalGroups).toBe(4);
    expect(a.removableRows).toBe(1 + 1 + 2 + 1); // 5
    expect(a.byBatch["INTRA-BATCH"]).toBe(4);
    expect(a.byBracket.big).toBe(2);
    expect(a.byBracket.mid).toBe(1);
    expect(a.byBracket.small).toBe(1);
    expect(a.contribGroups).toBe(1);
    expect(a.spendingGroups).toBe(3);
  });

  it("per-account rows count removable (members beyond the first)", () => {
    const groups = [grp(-10, "Amex", "b1", 4)]; // 3 removable
    const a = analyzeDuplicateGroups(groups);
    const amex = a.byAccount.find(x => x.account === "Amex");
    expect(amex.rows).toBe(3);
    expect(amex.groups).toBe(1);
    expect(amex.contrib).toBe(false);
  });

  it("flags contribution accounts in byAccount", () => {
    const groups = [grp(-370.74, "Corey Roth IRA", "b1")];
    const a = analyzeDuplicateGroups(groups);
    expect(a.byAccount[0].contrib).toBe(true);
  });

  it("handles empty input", () => {
    const a = analyzeDuplicateGroups([]);
    expect(a.totalGroups).toBe(0);
    expect(a.removableRows).toBe(0);
    expect(a.byAccount).toEqual([]);
  });

  it("respects custom bracket thresholds", () => {
    const groups = [grp(-100, "Amex", "b1")];
    expect(analyzeDuplicateGroups(groups, { big: 50 }).byBracket.big).toBe(1);
    expect(analyzeDuplicateGroups(groups, { big: 200 }).byBracket.mid).toBe(1);
  });
});

describe("scanForDuplicates — group key uniqueness (regression)", () => {
  it("assigns unique keys to groups sharing amount + description but differing by date", () => {
    // Recurring identical contribution: same amount, same description, same
    // account, different weeks. Each week is its own duplicate pair. These used
    // to collide on key (amt|fp), causing React key collisions in the modal —
    // stale rows lingered and per-group actions hit every same-amount group.
    const mk = (id, date) => ({
      id, date, amount: -269.74, description: "Lmimco Target-date Fund 2060",
      account: "Lockheed Martin Savings", custom_fields: {},
    });
    const txns = [
      mk("a1", "2023-09-01"), mk("a2", "2023-09-01"),
      mk("b1", "2023-09-08"), mk("b2", "2023-09-08"),
      mk("c1", "2023-09-15"), mk("c2", "2023-09-15"),
    ];
    const r = scanForDuplicates(txns);
    expect(r.groups.length).toBe(3);
    const keys = r.groups.map(g => g.key);
    expect(new Set(keys).size).toBe(3); // all unique
  });
});

describe("scanForDuplicates — dismissed rows skipped", () => {
  it("does not surface a group whose rows are marked _dup_dismissed", () => {
    const mk = (id, dismissed) => ({
      id, date: "2024-01-10", amount: -50, description: "Lunch", account: "amex",
      custom_fields: dismissed ? { _dup_dismissed: true } : {},
    });
    // Without dismissal: one group of 2.
    const live = scanForDuplicates([mk("a"), mk("b")]);
    expect(live.groups).toHaveLength(1);
    // With both dismissed: skipped entirely.
    const dismissed = scanForDuplicates([mk("a", true), mk("b", true)]);
    expect(dismissed.groups).toHaveLength(0);
  });
});

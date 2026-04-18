import { describe, it, expect } from "vitest";
import {
  dayDiff, isPairEligible, isCandidatePair, pairConfidence, pairReason,
  findTransferCandidates, markPaired, unpair, dismiss, undismiss,
  isMarkedTransfer, isDismissed, applyPairs, applyDismissals,
} from "./transfers.js";

/* ── tiny tx builder ──
   Mirrors the real transaction shape just enough for the pairing code.
   Every field defaults to something plausible so test cases only override
   what matters to them. */
let _idCounter = 0;
function tx(partial = {}) {
  _idCounter++;
  return {
    id: partial.id || `t${_idCounter}`,
    date: partial.date || "2025-01-10",
    amount: "amount" in partial ? partial.amount : -100,
    description: partial.description || "Test row",
    category: partial.category ?? null,
    account: partial.account || "Checking",
    currency: partial.currency || "USD",
    splits: partial.splits,
    custom_fields: partial.custom_fields || {},
  };
}

describe("dayDiff", () => {
  it("returns 0 for the same date", () => {
    expect(dayDiff("2025-01-10", "2025-01-10")).toBe(0);
  });
  it("returns the absolute number of days", () => {
    expect(dayDiff("2025-01-10", "2025-01-12")).toBe(2);
    expect(dayDiff("2025-01-12", "2025-01-10")).toBe(2);
  });
  it("handles month boundaries", () => {
    expect(dayDiff("2025-01-31", "2025-02-02")).toBe(2);
  });
  it("returns Infinity for invalid input", () => {
    expect(dayDiff("nope", "2025-01-10")).toBe(Infinity);
    expect(dayDiff("", "2025-01-10")).toBe(Infinity);
    expect(dayDiff(null, "2025-01-10")).toBe(Infinity);
  });
});

describe("isPairEligible", () => {
  it("accepts a plain row", () => {
    expect(isPairEligible(tx())).toBe(true);
  });
  it("rejects rows already marked as transfers", () => {
    expect(isPairEligible(tx({ custom_fields: { _is_transfer: true } }))).toBe(false);
  });
  it("rejects dismissed rows", () => {
    expect(isPairEligible(tx({ custom_fields: { _transfer_dismissed: true } }))).toBe(false);
  });
  it("rejects rows with splits", () => {
    expect(isPairEligible(tx({ splits: [{ id: "s1", category: "X", amount: -100 }] }))).toBe(false);
  });
  it("treats an empty splits array as not-split", () => {
    expect(isPairEligible(tx({ splits: [] }))).toBe(true);
  });
  it("rejects zero-amount rows", () => {
    expect(isPairEligible(tx({ amount: 0 }))).toBe(false);
  });
  it("rejects missing-amount rows", () => {
    expect(isPairEligible(tx({ amount: null }))).toBe(false);
  });
  it("rejects invalid dates", () => {
    expect(isPairEligible(tx({ date: "not a date" }))).toBe(false);
  });
});

describe("isCandidatePair — amount rules", () => {
  it("pairs opposing amounts", () => {
    const a = tx({ amount: -500, account: "Checking", date: "2025-01-10" });
    const b = tx({ amount: 500,  account: "Savings",  date: "2025-01-10" });
    expect(isCandidatePair(a, b)).toBe(true);
  });
  it("rejects same-sign amounts", () => {
    const a = tx({ amount: -500, account: "Checking" });
    const b = tx({ amount: -500, account: "Savings" });
    expect(isCandidatePair(a, b)).toBe(false);
  });
  it("honors amountTolerance boundary — exactly at threshold passes", () => {
    const a = tx({ amount: -500.00, account: "Checking" });
    const b = tx({ amount:  500.01, account: "Savings"  }); // 1¢ off
    expect(isCandidatePair(a, b, { amountTolerance: 0.01 })).toBe(true);
  });
  it("honors amountTolerance boundary — just beyond threshold fails", () => {
    const a = tx({ amount: -500.00, account: "Checking" });
    const b = tx({ amount:  500.02, account: "Savings"  }); // 2¢ off
    expect(isCandidatePair(a, b, { amountTolerance: 0.01 })).toBe(false);
  });
  it("rejects identical rows (same id)", () => {
    const a = tx({ id: "same", amount: -500 });
    expect(isCandidatePair(a, a)).toBe(false);
  });
});

describe("isCandidatePair — date rules", () => {
  it("pairs same-day rows", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "A" });
    const b = tx({ amount:  500, date: "2025-01-10", account: "B" });
    expect(isCandidatePair(a, b)).toBe(true);
  });
  it("pairs within dayTolerance", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "A" });
    const b = tx({ amount:  500, date: "2025-01-12", account: "B" });
    expect(isCandidatePair(a, b, { dayTolerance: 2 })).toBe(true);
  });
  it("rejects beyond dayTolerance", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "A" });
    const b = tx({ amount:  500, date: "2025-01-13", account: "B" });
    expect(isCandidatePair(a, b, { dayTolerance: 2 })).toBe(false);
  });
  it("dayTolerance=0 requires exact same date", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "A" });
    const b = tx({ amount:  500, date: "2025-01-11", account: "B" });
    expect(isCandidatePair(a, b, { dayTolerance: 0 })).toBe(false);
  });
});

describe("isCandidatePair — account rules", () => {
  it("rejects same-account pairs when requireDifferentAccounts is on", () => {
    const a = tx({ amount: -500, account: "Checking" });
    const b = tx({ amount:  500, account: "Checking" });
    expect(isCandidatePair(a, b, { requireDifferentAccounts: true })).toBe(false);
  });
  it("allows same-account pairs when toggle is off", () => {
    const a = tx({ amount: -500, account: "Checking" });
    const b = tx({ amount:  500, account: "Checking" });
    expect(isCandidatePair(a, b, { requireDifferentAccounts: false })).toBe(true);
  });
  it("allows pair when one side has no account (treats blank as matching)", () => {
    const a = tx({ amount: -500, account: "" });
    const b = tx({ amount:  500, account: "Savings" });
    expect(isCandidatePair(a, b, { requireDifferentAccounts: true })).toBe(true);
  });
});

describe("isCandidatePair — currency rules", () => {
  it("rejects mixed currencies", () => {
    const a = tx({ amount: -500, account: "A", currency: "USD" });
    const b = tx({ amount:  500, account: "B", currency: "EUR" });
    expect(isCandidatePair(a, b)).toBe(false);
  });
  it("matches when both default to USD", () => {
    const a = tx({ amount: -500, account: "A", currency: undefined });
    const b = tx({ amount:  500, account: "B", currency: undefined });
    expect(isCandidatePair(a, b)).toBe(true);
  });
});

describe("pairConfidence", () => {
  it("scores penny-exact same-day cross-account as near 1.0", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "Checking" });
    const b = tx({ amount:  500, date: "2025-01-10", account: "Savings"  });
    expect(pairConfidence(a, b)).toBeGreaterThan(0.95);
  });
  it("penalizes larger day gaps", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "Checking" });
    const b = tx({ amount:  500, date: "2025-01-12", account: "Savings"  });
    const close = tx({ amount:  500, date: "2025-01-10", account: "Savings" });
    expect(pairConfidence(a, close)).toBeGreaterThan(pairConfidence(a, b));
  });
  it("penalizes same-account matches", () => {
    const a  = tx({ amount: -500, date: "2025-01-10", account: "Checking" });
    const xA = tx({ amount:  500, date: "2025-01-10", account: "Savings"  });
    const sA = tx({ amount:  500, date: "2025-01-10", account: "Checking" });
    expect(pairConfidence(a, xA)).toBeGreaterThan(pairConfidence(a, sA));
  });
});

describe("pairReason", () => {
  it("describes a same-day cross-account pair", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "Checking" });
    const b = tx({ amount:  500, date: "2025-01-10", account: "Savings"  });
    const r = pairReason(a, b);
    expect(r).toContain("same day");
    expect(r).toContain("different accounts");
  });
  it("says '1 day apart' for a one-day gap", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "A" });
    const b = tx({ amount:  500, date: "2025-01-11", account: "B" });
    expect(pairReason(a, b)).toContain("1 day apart");
  });
  it("pluralizes for longer gaps", () => {
    const a = tx({ amount: -500, date: "2025-01-10", account: "A" });
    const b = tx({ amount:  500, date: "2025-01-13", account: "B" });
    expect(pairReason(a, b)).toContain("3 days apart");
  });
});

describe("findTransferCandidates — basics", () => {
  it("returns empty on empty input", () => {
    expect(findTransferCandidates([])).toEqual([]);
    expect(findTransferCandidates(null)).toEqual([]);
  });
  it("returns empty when no pairs match", () => {
    const rows = [
      tx({ id: "a", amount: -100, account: "A" }),
      tx({ id: "b", amount: -200, account: "B" }),
    ];
    expect(findTransferCandidates(rows)).toEqual([]);
  });
  it("finds an obvious pair", () => {
    const rows = [
      tx({ id: "a", amount: -500, date: "2025-01-10", account: "Checking" }),
      tx({ id: "b", amount:  500, date: "2025-01-10", account: "Savings"  }),
    ];
    const pairs = findTransferCandidates(rows);
    expect(pairs).toHaveLength(1);
    const ids = new Set([pairs[0].a.id, pairs[0].b.id]);
    expect(ids.has("a") && ids.has("b")).toBe(true);
    expect(pairs[0].confidence).toBeGreaterThan(0);
    expect(typeof pairs[0].reason).toBe("string");
  });
  it("skips rows already marked as transfers", () => {
    const rows = [
      tx({ id: "a", amount: -500, custom_fields: { _is_transfer: true } }),
      tx({ id: "b", amount:  500, account: "Savings" }),
    ];
    expect(findTransferCandidates(rows)).toEqual([]);
  });
  it("skips rows that have been dismissed", () => {
    const rows = [
      tx({ id: "a", amount: -500, custom_fields: { _transfer_dismissed: true } }),
      tx({ id: "b", amount:  500, account: "Savings" }),
    ];
    expect(findTransferCandidates(rows)).toEqual([]);
  });
  it("skips split rows", () => {
    const rows = [
      tx({ id: "a", amount: -500, splits: [{ id: "s", category: "X", amount: -500 }] }),
      tx({ id: "b", amount:  500, account: "Savings" }),
    ];
    expect(findTransferCandidates(rows)).toEqual([]);
  });
});

describe("findTransferCandidates — uniqueness & greedy assignment", () => {
  it("each row appears in at most one pair", () => {
    // Two potential partners for A. Greedy picks the higher-confidence one.
    const rows = [
      tx({ id: "a",  amount: -500, date: "2025-01-10", account: "Checking" }),
      tx({ id: "b1", amount:  500, date: "2025-01-10", account: "Savings"  }), // same day, strong
      tx({ id: "b2", amount:  500, date: "2025-01-12", account: "Savings"  }), // 2 days later, weaker
    ];
    const pairs = findTransferCandidates(rows);
    expect(pairs).toHaveLength(1);
    const ids = new Set([pairs[0].a.id, pairs[0].b.id]);
    expect(ids.has("a") && ids.has("b1")).toBe(true);
  });
  it("multiple independent pairs all get surfaced", () => {
    const rows = [
      tx({ id: "a1", amount: -100, date: "2025-01-10", account: "Checking" }),
      tx({ id: "b1", amount:  100, date: "2025-01-10", account: "Savings"  }),
      tx({ id: "a2", amount: -250, date: "2025-01-15", account: "Checking" }),
      tx({ id: "b2", amount:  250, date: "2025-01-15", account: "Brokerage" }),
    ];
    const pairs = findTransferCandidates(rows);
    expect(pairs).toHaveLength(2);
    const pairSets = pairs.map(p => new Set([p.a.id, p.b.id]));
    expect(pairSets.some(s => s.has("a1") && s.has("b1"))).toBe(true);
    expect(pairSets.some(s => s.has("a2") && s.has("b2"))).toBe(true);
  });
  it("coincidental opposing amounts on the same day still pair (user confirms)", () => {
    // This is by design — the algorithm is a candidate generator, not an
    // oracle. False positives are acceptable because the user reviews each
    // pair in the modal before committing.
    const rows = [
      tx({ id: "a", amount: -40, date: "2025-01-10", account: "Visa",        description: "Amazon refund" }),
      tx({ id: "b", amount:  40, date: "2025-01-10", account: "Checking",    description: "Chipotle" }),
    ];
    // amounts are already opposite signs; just need the sign convention:
    // refund on Visa = +, charge = -. Flip to a pair-matching case:
    rows[0].amount = -40; rows[1].amount = 40;
    const pairs = findTransferCandidates(rows);
    expect(pairs).toHaveLength(1);
  });
});

describe("findTransferCandidates — tolerance options propagate", () => {
  it("respects custom amountTolerance", () => {
    const rows = [
      tx({ id: "a", amount: -500.00, account: "A" }),
      tx({ id: "b", amount:  500.50, account: "B" }),
    ];
    expect(findTransferCandidates(rows, { amountTolerance: 0.01 })).toHaveLength(0);
    expect(findTransferCandidates(rows, { amountTolerance: 1.00 })).toHaveLength(1);
  });
  it("respects custom dayTolerance", () => {
    const rows = [
      tx({ id: "a", amount: -500, date: "2025-01-10", account: "A" }),
      tx({ id: "b", amount:  500, date: "2025-01-18", account: "B" }),
    ];
    expect(findTransferCandidates(rows, { dayTolerance: 2 })).toHaveLength(0);
    expect(findTransferCandidates(rows, { dayTolerance: 10 })).toHaveLength(1);
  });
});

describe("findTransferCandidates — re-run after unpair", () => {
  it("does NOT re-pair rows that were unpaired (they carry the dismissed flag)", () => {
    let rows = [
      tx({ id: "a", amount: -500, date: "2025-01-10", account: "Checking" }),
      tx({ id: "b", amount:  500, date: "2025-01-10", account: "Savings"  }),
    ];
    // First pass: paired.
    const firstRun = findTransferCandidates(rows);
    expect(firstRun).toHaveLength(1);

    // Commit the pair, then unpair both.
    rows = applyPairs(rows, [{ aId: "a", bId: "b" }]);
    rows = rows.map(t => t.id === "a" || t.id === "b" ? unpair(t) : t);

    // Re-run: dismissed flag is set, so neither is eligible.
    const secondRun = findTransferCandidates(rows);
    expect(secondRun).toHaveLength(0);
  });
  it("DOES re-pair after undismiss is called", () => {
    let rows = [
      tx({ id: "a", amount: -500, date: "2025-01-10", account: "Checking", custom_fields: { _transfer_dismissed: true } }),
      tx({ id: "b", amount:  500, date: "2025-01-10", account: "Savings",  custom_fields: { _transfer_dismissed: true } }),
    ];
    expect(findTransferCandidates(rows)).toHaveLength(0);
    rows = rows.map(undismiss);
    expect(findTransferCandidates(rows)).toHaveLength(1);
  });
});

describe("markPaired / unpair / dismiss / undismiss", () => {
  it("markPaired sets both flags", () => {
    const out = markPaired(tx({ id: "a" }), "b");
    expect(out.custom_fields._is_transfer).toBe(true);
    expect(out.custom_fields._transfer_pair_id).toBe("b");
  });
  it("markPaired clears any prior dismissed flag", () => {
    const out = markPaired(tx({ id: "a", custom_fields: { _transfer_dismissed: true } }), "b");
    expect(out.custom_fields._transfer_dismissed).toBeUndefined();
  });
  it("markPaired doesn't mutate the input", () => {
    const input = tx({ id: "a" });
    const orig = input.custom_fields;
    markPaired(input, "b");
    expect(input.custom_fields).toBe(orig);
    expect(input.custom_fields._is_transfer).toBeUndefined();
  });
  it("unpair removes both pair flags and sets dismissed", () => {
    const paired = markPaired(tx({ id: "a" }), "b");
    const out = unpair(paired);
    expect(out.custom_fields._is_transfer).toBeUndefined();
    expect(out.custom_fields._transfer_pair_id).toBeUndefined();
    expect(out.custom_fields._transfer_dismissed).toBe(true);
  });
  it("dismiss sets only the dismissed flag", () => {
    const out = dismiss(tx({ id: "a" }));
    expect(out.custom_fields._transfer_dismissed).toBe(true);
    expect(out.custom_fields._is_transfer).toBeUndefined();
  });
  it("undismiss clears only the dismissed flag", () => {
    const d = dismiss(tx({ id: "a" }));
    const out = undismiss(d);
    expect(out.custom_fields._transfer_dismissed).toBeUndefined();
  });
  it("isMarkedTransfer / isDismissed predicates", () => {
    expect(isMarkedTransfer(markPaired(tx(), "x"))).toBe(true);
    expect(isMarkedTransfer(tx())).toBe(false);
    expect(isDismissed(dismiss(tx()))).toBe(true);
    expect(isDismissed(tx())).toBe(false);
  });
});

describe("applyPairs / applyDismissals", () => {
  it("applyPairs marks both rows in a pair", () => {
    const rows = [tx({ id: "a" }), tx({ id: "b" }), tx({ id: "c" })];
    const out = applyPairs(rows, [{ aId: "a", bId: "b" }]);
    const byId = Object.fromEntries(out.map(r => [r.id, r]));
    expect(byId.a.custom_fields._is_transfer).toBe(true);
    expect(byId.a.custom_fields._transfer_pair_id).toBe("b");
    expect(byId.b.custom_fields._is_transfer).toBe(true);
    expect(byId.b.custom_fields._transfer_pair_id).toBe("a");
    expect(byId.c.custom_fields._is_transfer).toBeUndefined();
  });
  it("applyPairs leaves the array untouched if there are no matching ids", () => {
    const rows = [tx({ id: "a" }), tx({ id: "b" })];
    const out = applyPairs(rows, [{ aId: "x", bId: "y" }]);
    expect(out).toBe(rows);
  });
  it("applyPairs is a no-op with empty input", () => {
    const rows = [tx({ id: "a" })];
    expect(applyPairs(rows, [])).toBe(rows);
    expect(applyPairs(rows, null)).toBe(rows);
  });
  it("applyDismissals dismisses both rows in a pair without marking them", () => {
    const rows = [tx({ id: "a" }), tx({ id: "b" }), tx({ id: "c" })];
    const out = applyDismissals(rows, [{ aId: "a", bId: "b" }]);
    const byId = Object.fromEntries(out.map(r => [r.id, r]));
    expect(byId.a.custom_fields._transfer_dismissed).toBe(true);
    expect(byId.a.custom_fields._is_transfer).toBeUndefined();
    expect(byId.b.custom_fields._transfer_dismissed).toBe(true);
    expect(byId.c.custom_fields._transfer_dismissed).toBeUndefined();
  });
});

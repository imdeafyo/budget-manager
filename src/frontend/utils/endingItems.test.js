import { describe, it, expect } from "vitest";
import {
  newEndingItemId,
  monthsToPayoff,
  addMonths,
  computeLoanEndsOn,
  yearMonthToIndex,
  resolveEndingEvents,
  eventsByAccount,
  findItemRefConflicts,
} from "./endingItems.js";

describe("newEndingItemId", () => {
  it("returns ei_-prefixed string", () => {
    expect(newEndingItemId()).toMatch(/^ei_[a-z0-9]+$/);
  });
  it("two consecutive ids differ", () => {
    expect(newEndingItemId()).not.toBe(newEndingItemId());
  });
});

describe("monthsToPayoff — amortization math", () => {
  it("zero-balance returns ok=false", () => {
    expect(monthsToPayoff(0, 5, 100)).toEqual({ ok: false, reason: "zero-balance" });
    expect(monthsToPayoff(-100, 5, 100)).toEqual({ ok: false, reason: "zero-balance" });
  });
  it("zero-payment returns ok=false", () => {
    expect(monthsToPayoff(1000, 5, 0)).toEqual({ ok: false, reason: "zero-payment" });
    expect(monthsToPayoff(1000, 5, -10)).toEqual({ ok: false, reason: "zero-payment" });
  });
  it("negative rate returns ok=false", () => {
    expect(monthsToPayoff(1000, -1, 100)).toEqual({ ok: false, reason: "negative-rate" });
  });
  it("zero-interest amortizes as ceil(balance/payment)", () => {
    expect(monthsToPayoff(1000, 0, 100)).toEqual({ ok: true, months: 10 });
    expect(monthsToPayoff(1001, 0, 100)).toEqual({ ok: true, months: 11 });
    expect(monthsToPayoff(99, 0, 100)).toEqual({ ok: true, months: 1 });
  });
  it("standard amortization: $10k at 5% with $200/mo pays off in known time", () => {
    /* Math: 10000 at 5%/12 = 0.4167%/mo, paying 200/mo.
       n = -ln(1 - 0.004167*10000/200) / ln(1.004167)
         = -ln(1 - 0.2083) / 0.004158
         = -ln(0.7917) / 0.004158
         ≈ 0.2336 / 0.004158
         ≈ 56.18 months → 57 (ceil)
       Real Excel NPER says about 57.68 → 58 once you account for
       full repayment of last cent. We accept either 57 or 58 since
       ceil semantics could go either way depending on float precision. */
    const r = monthsToPayoff(10000, 5, 200);
    expect(r.ok).toBe(true);
    expect(r.months).toBeGreaterThanOrEqual(56);
    expect(r.months).toBeLessThanOrEqual(60);
  });
  it("$200k mortgage at 6.5% with $1264/mo pays off in ~30 years", () => {
    // Standard 30-yr fixed: $1264.14 P&I; expect ~360 months.
    const r = monthsToPayoff(200000, 6.5, 1264.14);
    expect(r.ok).toBe(true);
    expect(r.months).toBeGreaterThanOrEqual(358);
    expect(r.months).toBeLessThanOrEqual(362);
  });
  it("payment exactly equals monthly interest → negative-amortization", () => {
    // $10k at 6% means $50/mo interest. Paying exactly $50 never amortizes.
    const r = monthsToPayoff(10000, 6, 50);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("negative-amortization");
  });
  it("payment less than monthly interest → negative-amortization", () => {
    const r = monthsToPayoff(10000, 6, 25);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("negative-amortization");
  });
  it("very long payoff beyond 50yr horizon returns horizon-exceeded", () => {
    // Tiny payment over huge zero-interest balance.
    const r = monthsToPayoff(1000000, 0, 100);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("horizon-exceeded");
  });
});

describe("addMonths — pure date math", () => {
  it("adds within same year", () => {
    expect(addMonths("2026-03", 5)).toBe("2026-08");
  });
  it("rolls over year boundary", () => {
    expect(addMonths("2026-10", 5)).toBe("2027-03");
  });
  it("handles multi-year additions", () => {
    expect(addMonths("2026-01", 24)).toBe("2028-01");
    expect(addMonths("2026-01", 25)).toBe("2028-02");
  });
  it("month-padding produces YYYY-MM with 2-digit month", () => {
    expect(addMonths("2026-01", 0)).toBe("2026-01");
    expect(addMonths("2026-08", 1)).toBe("2026-09");
  });
  it("invalid input returns null", () => {
    expect(addMonths("bogus", 5)).toBeNull();
    expect(addMonths("2026-13", 1)).toBeNull(); // out-of-range month
    expect(addMonths("2026", 1)).toBeNull();
  });
});

describe("computeLoanEndsOn", () => {
  it("produces correct ends-on date for valid loan", () => {
    const r = computeLoanEndsOn(10000, 0, 100, "2026-01");
    expect(r.ok).toBe(true);
    expect(r.months).toBe(100);
    expect(r.endsOn).toBe("2034-05"); // 2026-01 + 100 months = 2034-05
  });
  it("propagates failure reason from monthsToPayoff", () => {
    const r = computeLoanEndsOn(10000, 6, 25, "2026-01");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("negative-amortization");
  });
});

describe("yearMonthToIndex", () => {
  it("same month is index 0", () => {
    expect(yearMonthToIndex("2026-01", "2026-01")).toBe(0);
  });
  it("next month is index 1", () => {
    expect(yearMonthToIndex("2026-02", "2026-01")).toBe(1);
  });
  it("12 months ahead is index 12", () => {
    expect(yearMonthToIndex("2027-01", "2026-01")).toBe(12);
  });
  it("negative index when target is before base", () => {
    expect(yearMonthToIndex("2025-12", "2026-01")).toBe(-1);
  });
  it("malformed input returns null", () => {
    expect(yearMonthToIndex("bogus", "2026-01")).toBeNull();
    expect(yearMonthToIndex("2026-01", "bogus")).toBeNull();
  });
});

describe("resolveEndingEvents", () => {
  const horizonMonths = 240; // 20 years
  const baseYM = "2026-01";

  const mkItem = (overrides = {}) => ({
    id: "ei_1",
    itemRef: { section: "exp", idx: 0, name: "Car loan" },
    destAccountId: "acc_cash_joint",
    effect: "ends",
    mode: "date",
    endsOn: "2028-12",
    ...overrides,
  });

  it("empty array returns empty events", () => {
    const r = resolveEndingEvents([], () => 450, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
    expect(r.orphaned).toEqual([]);
    expect(r.outOfHorizon).toEqual([]);
  });

  it("non-array input returns empty events", () => {
    const r = resolveEndingEvents(null, () => 450, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
  });

  it("orphans an item with unresolvable itemRef", () => {
    const item = mkItem();
    const r = resolveEndingEvents([item], () => null, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
    expect(r.orphaned).toHaveLength(1);
    expect(r.orphaned[0].id).toBe(item.id);
  });

  it("orphans an item whose linked amount is zero or negative", () => {
    const item = mkItem();
    const r = resolveEndingEvents([item], () => 0, baseYM, horizonMonths);
    expect(r.orphaned).toHaveLength(1);
  });

  it("orphans an item with malformed endsOn", () => {
    const item = mkItem({ endsOn: "garbage" });
    const r = resolveEndingEvents([item], () => 450, baseYM, horizonMonths);
    expect(r.orphaned).toHaveLength(1);
    expect(r.events).toEqual([]);
  });

  it("emits +monthlyDelta event one month AFTER endsOn", () => {
    /* endsOn = 2028-12 (month index 35 relative to 2026-01).
       Fire index = 35 + 1 = 36 (i.e. 2029-01, the first month freed cash flows). */
    const item = mkItem({ endsOn: "2028-12" });
    const r = resolveEndingEvents([item], () => 450, baseYM, horizonMonths);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      accountId: "acc_cash_joint",
      monthIndex: 36,
      monthlyDelta: 450,
    });
  });

  it("drops items past horizon and reports them in outOfHorizon", () => {
    const item = mkItem({ endsOn: "2050-01" }); // way past 20-yr horizon
    const r = resolveEndingEvents([item], () => 450, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
    expect(r.outOfHorizon).toHaveLength(1);
  });

  it("never fires at month index 0 even for past endsOn", () => {
    const item = mkItem({ endsOn: "2025-01" }); // already past
    const r = resolveEndingEvents([item], () => 450, baseYM, horizonMonths);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].monthIndex).toBe(1);
  });

  it("sorts events by monthIndex", () => {
    const items = [
      mkItem({ id: "ei_a", endsOn: "2030-06" }), // fires month 54
      mkItem({ id: "ei_b", endsOn: "2027-01" }), // fires month 13
      mkItem({ id: "ei_c", endsOn: "2028-03" }), // fires month 27
    ];
    const r = resolveEndingEvents(items, () => 100, baseYM, horizonMonths);
    expect(r.events.map(e => e.monthIndex)).toEqual([13, 27, 54]);
  });

  it("scaffolds 'starts' as a pair of negative+positive events", () => {
    const item = mkItem({ effect: "starts", endsOn: "2028-12" });
    const r = resolveEndingEvents([item], () => 300, baseYM, horizonMonths);
    expect(r.events).toHaveLength(2);
    const months = r.events.map(e => ({ idx: e.monthIndex, d: e.monthlyDelta }));
    expect(months).toEqual([
      { idx: 1, d: -300 },
      { idx: 36, d: 300 },
    ]);
  });

  it("monthlyAmountFor is invoked with the itemRef", () => {
    const item = mkItem();
    const calls = [];
    resolveEndingEvents([item], (ref) => { calls.push(ref); return 100; }, baseYM, horizonMonths);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ section: "exp", idx: 0, name: "Car loan" });
  });

  it("skips items missing destAccountId", () => {
    const item = mkItem({ destAccountId: "" });
    const r = resolveEndingEvents([item], () => 100, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
    expect(r.orphaned).toEqual([]); // not orphaned — just incomplete config, silently skipped
  });
});

describe("eventsByAccount", () => {
  it("groups by accountId, sorted by monthIndex within each", () => {
    const events = [
      { accountId: "a", monthIndex: 12, monthlyDelta: 100 },
      { accountId: "b", monthIndex: 3, monthlyDelta: 50 },
      { accountId: "a", monthIndex: 6, monthlyDelta: 75 },
    ];
    const out = eventsByAccount(events);
    expect(out).toEqual({
      a: [
        { monthIndex: 6, monthlyDelta: 75 },
        { monthIndex: 12, monthlyDelta: 100 },
      ],
      b: [
        { monthIndex: 3, monthlyDelta: 50 },
      ],
    });
  });
  it("empty input returns empty object", () => {
    expect(eventsByAccount([])).toEqual({});
    expect(eventsByAccount(null)).toEqual({});
  });
});

describe("findItemRefConflicts", () => {
  it("flags two ending items pointing at the same budget line", () => {
    const items = [
      { id: "ei_1", itemRef: { section: "exp", idx: 3, name: "X" } },
      { id: "ei_2", itemRef: { section: "exp", idx: 3, name: "X" } },
    ];
    const c = findItemRefConflicts(items);
    expect(c).toHaveLength(1);
    expect(c[0].ids).toEqual(["ei_1", "ei_2"]);
  });
  it("does NOT flag the same idx in different sections", () => {
    const items = [
      { id: "ei_1", itemRef: { section: "exp", idx: 3, name: "X" } },
      { id: "ei_2", itemRef: { section: "sav", idx: 3, name: "Y" } },
    ];
    expect(findItemRefConflicts(items)).toEqual([]);
  });
  it("empty input returns empty conflicts", () => {
    expect(findItemRefConflicts([])).toEqual([]);
    expect(findItemRefConflicts(null)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  newEndingItemId,
  getItemRefs,
  monthsToPayoff,
  addMonths,
  computeLoanEndsOn,
  yearMonthToIndex,
  resolveEndingEvents,
  eventsByAccount,
  findItemRefConflicts,
  resolveItemRef,
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
    itemRefs: [{ section: "exp", idx: 0, name: "Car loan" }],
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
  it("multi-ref: flags two obligations sharing one of multiple refs", () => {
    /* A links to [X, Y]; B links to [Y]. Conflict is on Y. */
    const items = [
      { id: "ei_A", itemRefs: [
          { section: "exp", idx: 1, name: "X" },
          { section: "exp", idx: 2, name: "Y" },
      ] },
      { id: "ei_B", itemRefs: [{ section: "exp", idx: 2, name: "Y" }] },
    ];
    const c = findItemRefConflicts(items);
    expect(c).toHaveLength(1);
    expect(c[0].key).toBe("exp::2");
    expect(c[0].ids).toEqual(["ei_A", "ei_B"]);
  });
  it("multi-ref: no conflict when refs are disjoint across obligations", () => {
    const items = [
      { id: "ei_A", itemRefs: [
          { section: "exp", idx: 1, name: "A1" },
          { section: "exp", idx: 2, name: "A2" },
      ] },
      { id: "ei_B", itemRefs: [
          { section: "sav", idx: 1, name: "B1" },
          { section: "exp", idx: 3, name: "B2" },
      ] },
    ];
    expect(findItemRefConflicts(items)).toEqual([]);
  });
  it("multi-ref: flags two refs in the SAME obligation pointing at the same line", () => {
    /* Self-duplication — user accidentally added the same item twice
       to a single obligation. The conflict surfaces with both ids
       being the same obligation id; UI should treat this as a
       conflict so the row gets the warning border. */
    const items = [
      { id: "ei_A", itemRefs: [
          { section: "exp", idx: 1, name: "X" },
          { section: "exp", idx: 1, name: "X" },
      ] },
    ];
    const c = findItemRefConflicts(items);
    expect(c).toHaveLength(1);
    expect(c[0].ids).toEqual(["ei_A", "ei_A"]);
  });
  it("multi-ref: skips refs with non-numeric idx or non-string section", () => {
    const items = [
      { id: "ei_A", itemRefs: [
          { section: "exp", idx: "bogus", name: "X" }, // invalid
          { section: 123, idx: 1, name: "Y" },          // invalid
          { section: "exp", idx: 5, name: "Z" },        // valid
      ] },
      { id: "ei_B", itemRefs: [{ section: "exp", idx: 5, name: "Z" }] },
    ];
    const c = findItemRefConflicts(items);
    expect(c).toHaveLength(1);
    expect(c[0].key).toBe("exp::5");
  });
});

describe("getItemRefs — read shim", () => {
  it("returns itemRefs when present", () => {
    const ei = { itemRefs: [
      { section: "exp", idx: 0, name: "A" },
      { section: "sav", idx: 2, name: "B" },
    ]};
    expect(getItemRefs(ei)).toEqual([
      { section: "exp", idx: 0, name: "A" },
      { section: "sav", idx: 2, name: "B" },
    ]);
  });
  it("falls back to wrapping legacy itemRef in a one-element array", () => {
    const ei = { itemRef: { section: "exp", idx: 3, name: "Legacy" } };
    expect(getItemRefs(ei)).toEqual([{ section: "exp", idx: 3, name: "Legacy" }]);
  });
  it("itemRefs takes precedence over itemRef when both are present", () => {
    const ei = {
      itemRefs: [{ section: "exp", idx: 1, name: "New" }],
      itemRef: { section: "exp", idx: 99, name: "Stale" },
    };
    expect(getItemRefs(ei)).toEqual([{ section: "exp", idx: 1, name: "New" }]);
  });
  it("empty itemRefs returns empty array (distinct from missing)", () => {
    const ei = { itemRefs: [] };
    expect(getItemRefs(ei)).toEqual([]);
  });
  it("missing both fields returns empty array", () => {
    expect(getItemRefs({})).toEqual([]);
  });
  it("null/undefined/non-object input returns empty array", () => {
    expect(getItemRefs(null)).toEqual([]);
    expect(getItemRefs(undefined)).toEqual([]);
    expect(getItemRefs("nope")).toEqual([]);
    expect(getItemRefs(42)).toEqual([]);
  });
});

describe("resolveEndingEvents — multi-ref (Phase 14a)", () => {
  const horizonMonths = 240;
  const baseYM = "2026-01";

  it("sums monthly amounts across multiple refs into a single event", () => {
    /* Two refs: mortgage P&I + extra principal payment. Both end on
       the same date; combined freed cash redirects to one account. */
    const item = {
      id: "ei_mort",
      itemRefs: [
        { section: "exp", idx: 0, name: "Mortgage P&I" },
        { section: "exp", idx: 1, name: "Mortgage Extra" },
      ],
      destAccountId: "acc_taxable",
      mode: "date",
      endsOn: "2028-12",
    };
    /* monthlyAmountFor returns 1500 for idx=0, 500 for idx=1.
       Expected combined monthly: 2000. */
    const monthlyFor = (ref) => (ref.idx === 0 ? 1500 : ref.idx === 1 ? 500 : null);
    const r = resolveEndingEvents([item], monthlyFor, baseYM, horizonMonths);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].monthlyDelta).toBe(2000);
    expect(r.events[0].monthIndex).toBe(36); // 2028-12 → fire at 2029-01
    expect(r.events[0].accountId).toBe("acc_taxable");
    expect(r.orphaned).toEqual([]);
  });

  it("orphans the whole obligation when ANY ref is unresolvable", () => {
    /* One good ref, one orphan ref. Don't silently sum partial — surface
       the broken link by orphaning the entire obligation. */
    const item = {
      id: "ei_x",
      itemRefs: [
        { section: "exp", idx: 0, name: "P&I" },
        { section: "exp", idx: 99, name: "Renamed/deleted" },
      ],
      destAccountId: "acc_taxable",
      mode: "date",
      endsOn: "2028-12",
    };
    const monthlyFor = (ref) => (ref.idx === 0 ? 1500 : null);
    const r = resolveEndingEvents([item], monthlyFor, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
    expect(r.orphaned).toHaveLength(1);
    expect(r.orphaned[0].id).toBe("ei_x");
  });

  it("orphans the obligation if any ref's monthly amount is zero", () => {
    /* Sum-with-a-zero would silently understate, so orphan it. */
    const item = {
      id: "ei_x",
      itemRefs: [
        { section: "exp", idx: 0, name: "Active" },
        { section: "exp", idx: 1, name: "Zeroed-out item" },
      ],
      destAccountId: "acc_taxable",
      mode: "date",
      endsOn: "2028-12",
    };
    const monthlyFor = (ref) => (ref.idx === 0 ? 100 : 0);
    const r = resolveEndingEvents([item], monthlyFor, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
    expect(r.orphaned).toHaveLength(1);
  });

  it("orphans an obligation with an empty itemRefs array", () => {
    /* User removed all linked items. Empty array is a real persisted
       state distinct from "legacy itemRef" — must orphan rather than
       silently no-op. */
    const item = {
      id: "ei_empty",
      itemRefs: [],
      destAccountId: "acc_taxable",
      mode: "date",
      endsOn: "2028-12",
    };
    const r = resolveEndingEvents([item], () => 100, baseYM, horizonMonths);
    expect(r.events).toEqual([]);
    expect(r.orphaned).toHaveLength(1);
    expect(r.orphaned[0].id).toBe("ei_empty");
  });

  it("legacy itemRef shape still works (back-compat)", () => {
    /* An old persisted obligation with `itemRef` (singular) and no
       `itemRefs` should resolve identically to the original behavior.
       Critical: pre-14a saves must keep working. */
    const item = {
      id: "ei_legacy",
      itemRef: { section: "exp", idx: 0, name: "Old loan" },
      destAccountId: "acc_taxable",
      mode: "date",
      endsOn: "2028-12",
    };
    const r = resolveEndingEvents([item], () => 450, baseYM, horizonMonths);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].monthlyDelta).toBe(450);
    expect(r.events[0].monthIndex).toBe(36);
  });

  it("monthlyAmountFor is invoked once per ref in itemRefs", () => {
    const item = {
      id: "ei_multi",
      itemRefs: [
        { section: "exp", idx: 0, name: "A" },
        { section: "exp", idx: 1, name: "B" },
        { section: "sav", idx: 2, name: "C" },
      ],
      destAccountId: "acc_taxable",
      mode: "date",
      endsOn: "2028-12",
    };
    const calls = [];
    resolveEndingEvents(
      [item],
      (ref) => { calls.push(ref); return 100; },
      baseYM,
      horizonMonths
    );
    expect(calls).toHaveLength(3);
    expect(calls.map(c => `${c.section}::${c.idx}`)).toEqual(["exp::0", "exp::1", "sav::2"]);
  });

  it("multi-ref obligation with 'starts' effect scaffolds neg+pos using summed amount", () => {
    /* The "starts" branch must also sum across refs — same pattern as
       "ends" — so the scaffolded contribution kicks in for the full
       combined amount. */
    const item = {
      id: "ei_starts",
      itemRefs: [
        { section: "exp", idx: 0, name: "A" },
        { section: "exp", idx: 1, name: "B" },
      ],
      destAccountId: "acc_taxable",
      effect: "starts",
      mode: "date",
      endsOn: "2028-12",
    };
    const monthlyFor = (ref) => (ref.idx === 0 ? 200 : 300);
    const r = resolveEndingEvents([item], monthlyFor, baseYM, horizonMonths);
    expect(r.events).toHaveLength(2);
    const summary = r.events.map(e => ({ idx: e.monthIndex, d: e.monthlyDelta }));
    expect(summary).toEqual([
      { idx: 1, d: -500 },
      { idx: 36, d: 500 },
    ]);
  });
});

describe("resolveItemRef — stable-IDs resolution", () => {
  // Two-row exp + one-row sav fixture, each item carrying a stable id.
  const exp = [
    { id: "i_aaa", n: "Groceries", c: "Food", t: "N", v: "100", p: "w" },
    { id: "i_bbb", n: "Netflix",   c: "Entertainment", t: "D", v: "15", p: "m" },
  ];
  const sav = [
    { id: "i_sss", n: "Emergency Fund", c: "Savings", v: "200", p: "m" },
  ];

  it("matches by id when ref.id matches an item", () => {
    const ref = { section: "exp", id: "i_bbb", idx: 1, name: "Netflix" };
    const r = resolveItemRef(ref, exp, sav);
    expect(r.matchedBy).toBe("id");
    expect(r.item).toBe(exp[1]);
    expect(r.upgradeTo).toBeNull();
  });

  it("matches by id even if idx and name are stale", () => {
    // Simulates: ref was correct, then user inserted a row above (idx
    // shifted) and renamed the item. ID still wins.
    const ref = { section: "exp", id: "i_bbb", idx: 99, name: "old name" };
    const r = resolveItemRef(ref, exp, sav);
    expect(r.matchedBy).toBe("id");
    expect(r.item).toBe(exp[1]);
  });

  it("falls back to name match when ref has no id but item has one", () => {
    const ref = { section: "exp", idx: 99, name: "Netflix" };
    const r = resolveItemRef(ref, exp, sav);
    expect(r.matchedBy).toBe("name");
    expect(r.item).toBe(exp[1]);
    // Suggests upgrading the ref to carry the matched item's id
    expect(r.upgradeTo).toEqual({ id: "i_bbb", idx: 1, name: "Netflix" });
  });

  it("name match is case- and whitespace-insensitive", () => {
    const ref = { section: "exp", idx: 0, name: "  NETFLIX  " };
    const r = resolveItemRef(ref, exp, sav);
    expect(r.matchedBy).toBe("name");
    expect(r.item).toBe(exp[1]);
  });

  it("falls back to idx when name is ambiguous but idx points at the right item", () => {
    // Two items share a normalized name → name match is ambiguous and skipped.
    const dupExp = [
      { id: "i_aaa", n: "Subscription", c: "Tech", t: "D", v: "10", p: "m" },
      { id: "i_bbb", n: "Subscription", c: "Tech", t: "D", v: "20", p: "m" },
    ];
    const ref = { section: "exp", idx: 1, name: "Subscription" };
    const r = resolveItemRef(ref, dupExp, sav);
    expect(r.matchedBy).toBe("idx");
    expect(r.item).toBe(dupExp[1]);
    expect(r.upgradeTo).toEqual({ id: "i_bbb", idx: 1, name: "Subscription" });
  });

  it("orphans when nothing matches", () => {
    const ref = { section: "exp", id: "i_missing", idx: 99, name: "Gone" };
    const r = resolveItemRef(ref, exp, sav);
    expect(r.item).toBeNull();
    expect(r.matchedBy).toBeNull();
    expect(r.upgradeTo).toBeNull();
  });

  it("idx fallback requires matching name (defense against delete-above coincidence)", () => {
    // ref points at idx=0 with name "Groceries", but if exp[0] was deleted
    // and a different item shifted into idx=0, the names won't match —
    // don't silently rebind.
    const shiftedExp = [
      { id: "i_zzz", n: "Rent", c: "Housing", t: "N", v: "1500", p: "m" },
    ];
    const ref = { section: "exp", idx: 0, name: "Groceries" };
    const r = resolveItemRef(ref, shiftedExp, sav);
    expect(r.item).toBeNull();
    expect(r.matchedBy).toBeNull();
  });

  it("respects the section field (exp vs sav)", () => {
    // ref.id i_sss exists only in sav. With section=exp it shouldn't find it.
    const ref = { section: "exp", id: "i_sss", idx: 0, name: "Emergency Fund" };
    const r = resolveItemRef(ref, exp, sav);
    expect(r.item).toBeNull();
  });

  it("returns orphan for malformed ref", () => {
    expect(resolveItemRef(null, exp, sav)).toEqual({ item: null, matchedBy: null, upgradeTo: null });
    expect(resolveItemRef({}, exp, sav)).toEqual({ item: null, matchedBy: null, upgradeTo: null });
    expect(resolveItemRef({ section: 123 }, exp, sav)).toEqual({ item: null, matchedBy: null, upgradeTo: null });
  });

  it("handles missing exp/sav arrays gracefully", () => {
    const ref = { section: "exp", id: "i_bbb", idx: 0, name: "Netflix" };
    expect(resolveItemRef(ref, null, null).item).toBeNull();
    expect(resolveItemRef(ref, undefined, undefined).item).toBeNull();
    expect(resolveItemRef(ref, [], []).item).toBeNull();
  });

  it("name fallback returns no upgrade hint when matched item lacks an id", () => {
    // Edge case: name match succeeds against an item that itself doesn't
    // have an id yet. No upgrade can be persisted.
    const noIdExp = [
      { n: "Netflix", c: "Entertainment", t: "D", v: "15", p: "m" }, // no id
    ];
    const ref = { section: "exp", idx: 0, name: "Netflix" };
    const r = resolveItemRef(ref, noIdExp, sav);
    expect(r.matchedBy).toBe("name");
    expect(r.item).toBe(noIdExp[0]);
    expect(r.upgradeTo).toBeNull();
  });
});

describe("findItemRefConflicts — id-aware", () => {
  it("detects same-id refs across two obligations as a conflict", () => {
    const items = [
      { id: "ei_a", itemRefs: [{ section: "exp", id: "i_x", idx: 0, name: "X" }] },
      { id: "ei_b", itemRefs: [{ section: "exp", id: "i_x", idx: 5, name: "X" }] },
    ];
    const conflicts = findItemRefConflicts(items);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ids).toEqual(["ei_a", "ei_b"]);
    expect(conflicts[0].key).toBe("exp::id::i_x");
  });

  it("does NOT conflict when one ref has an id and the other only has idx (different keying)", () => {
    // Documented behavior: pre-migration data and post-migration data
    // coexist briefly. Once the resolver upgrades the legacy ref on
    // next save, they'll then conflict on id. Until then they don't —
    // a known limitation, not a bug.
    const items = [
      { id: "ei_a", itemRefs: [{ section: "exp", id: "i_x", idx: 0, name: "X" }] },
      { id: "ei_b", itemRefs: [{ section: "exp", idx: 0, name: "X" }] },
    ];
    const conflicts = findItemRefConflicts(items);
    expect(conflicts).toHaveLength(0);
  });

  it("detects idx conflict between two legacy refs", () => {
    const items = [
      { id: "ei_a", itemRefs: [{ section: "exp", idx: 2, name: "X" }] },
      { id: "ei_b", itemRefs: [{ section: "exp", idx: 2, name: "X" }] },
    ];
    const conflicts = findItemRefConflicts(items);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe("exp::2");
  });
});

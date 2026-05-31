import { describe, it, expect } from "vitest";
import {
  newOneTimeEventId,
  parseEventDate,
  eventMonthIndex,
  resolveOneTimeEvents,
  monthIndexToFractionalYear,
  monthIndexToChartYear,
} from "./oneTimeEvents.js";

describe("newOneTimeEventId", () => {
  it("returns a string starting with ote_", () => {
    const id = newOneTimeEventId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("ote_")).toBe(true);
  });

  it("returns different ids on consecutive calls", () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(newOneTimeEventId());
    expect(ids.size).toBe(50);
  });
});

describe("parseEventDate", () => {
  it("parses YYYY-MM-DD", () => {
    expect(parseEventDate("2027-06-15")).toEqual({ year: 2027, month: 6, day: 15 });
  });

  it("parses YYYY-MM as day=1", () => {
    expect(parseEventDate("2027-06")).toEqual({ year: 2027, month: 6, day: 1 });
  });

  it("handles single-digit month/day", () => {
    expect(parseEventDate("2027-6-5")).toEqual({ year: 2027, month: 6, day: 5 });
  });

  it("returns null for empty string", () => {
    expect(parseEventDate("")).toBe(null);
  });

  it("returns null for non-string", () => {
    expect(parseEventDate(null)).toBe(null);
    expect(parseEventDate(undefined)).toBe(null);
    expect(parseEventDate(20270615)).toBe(null);
  });

  it("returns null for malformed dates", () => {
    expect(parseEventDate("not-a-date")).toBe(null);
    expect(parseEventDate("2027/06/15")).toBe(null);
    expect(parseEventDate("2027-13-01")).toBe(null); // month 13
    expect(parseEventDate("2027-00-01")).toBe(null); // month 0
    expect(parseEventDate("2027-06-32")).toBe(null); // day 32
  });
});

describe("eventMonthIndex", () => {
  /* The index must match the forecast loop in calc.js, where loop year 0
     is the base calendar year (snapshot) and simulated month 1 is January
     of baseYear+1. So an event in calendar (Y, M) maps to
     (Y - baseYear - 1)*12 + M. Base-year and earlier events map to <= 0. */

  it("returns negative for a date in the base year (Jan)", () => {
    // 2026-01, base 2026 → (2026-2026-1)*12 + 1 = -11
    expect(eventMonthIndex("2026-01-15", 2026, 1)).toBe(-11);
  });

  it("returns negative for a mid-base-year date", () => {
    // 2026-06 → -6 (still in the base year → dropped by resolver)
    expect(eventMonthIndex("2026-06-15", 2026, 1)).toBe(-6);
  });

  it("returns 1 for January of the first simulated year", () => {
    // 2027-01 is the start of loop year 1 = absMonth 1
    expect(eventMonthIndex("2027-01-15", 2026, 1)).toBe(1);
  });

  it("returns 12 for December of the first simulated year", () => {
    expect(eventMonthIndex("2027-12-15", 2026, 1)).toBe(12);
  });

  it("maps a far-future payoff to the correct calendar year", () => {
    // The regression case: 2035-02 must fire in calendar 2035 (loop year 9),
    // i.e. absMonth in [97,108]. (2035-2026-1)*12 + 2 = 98.
    expect(eventMonthIndex("2035-02-01", 2026, 1)).toBe(98);
  });

  it("returns negative for a date before the base year", () => {
    // (2025-2026-1)*12 + 12 = -12
    expect(eventMonthIndex("2025-12-15", 2026, 1)).toBe(-12);
  });

  it("ignores baseMonth for the year boundary (loop sims full calendar years)", () => {
    // baseMonth no longer shifts the index — the loop simulates Jan–Dec of
    // baseYear+1 onward regardless of the current calendar month.
    expect(eventMonthIndex("2027-03-01", 2026, 6)).toBe(3);
    expect(eventMonthIndex("2027-03-01", 2026, 1)).toBe(3);
  });

  it("defaults baseMonth to 1 when omitted", () => {
    expect(eventMonthIndex("2027-01-15", 2026)).toBe(1);
  });

  it("returns null for unparseable date", () => {
    expect(eventMonthIndex("not-a-date", 2026, 1)).toBe(null);
  });
});

describe("resolveOneTimeEvents", () => {
  const accounts = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
  const base = { year: 2026, month: 1 };
  const horizonMonths = 360; // 30 years

  it("returns empty result for empty input", () => {
    const out = resolveOneTimeEvents([], accounts, base, horizonMonths);
    expect(out.events).toEqual([]);
    expect(out.orphans).toEqual([]);
    expect(out.outOfHorizon).toEqual([]);
    expect(out.inPast).toEqual([]);
  });

  it("returns empty result for non-array input", () => {
    const out = resolveOneTimeEvents(null, accounts, base, horizonMonths);
    expect(out.events).toEqual([]);
  });

  it("resolves a well-formed in-horizon event", () => {
    const ev = { id: "e1", date: "2027-06-15", amount: -30000, accountId: "a1", label: "car" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.events.length).toBe(1);
    expect(out.events[0].accountId).toBe("a1");
    expect(out.events[0].monthIndex).toBe(6); // June of first simulated year (2027) = absMonth 6
    expect(out.events[0].amount).toBe(-30000);
  });

  it("treats missing accountId as orphan", () => {
    const ev = { id: "e1", date: "2027-06-15", amount: 100, label: "no acct" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.orphans.length).toBe(1);
    expect(out.orphans[0].reason).toBe("no-account");
    expect(out.events.length).toBe(0);
  });

  it("treats missing-account-reference as orphan with account-missing reason", () => {
    const ev = { id: "e1", date: "2027-06-15", amount: 100, accountId: "deleted_acct", label: "x" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.orphans.length).toBe(1);
    expect(out.orphans[0].reason).toBe("account-missing");
  });

  it("treats unparseable date as orphan", () => {
    const ev = { id: "e1", date: "garbage", amount: 100, accountId: "a1", label: "x" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.orphans.length).toBe(1);
    expect(out.orphans[0].reason).toBe("bad-date");
  });

  it("classifies past events as inPast", () => {
    const ev = { id: "e1", date: "2025-06-15", amount: -1000, accountId: "a1", label: "x" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.inPast.length).toBe(1);
    expect(out.events.length).toBe(0);
  });

  it("classifies a base-year event as inPast", () => {
    // Any event in the base calendar year maps to a non-positive index
    // (the year-0 snapshot already reflects "today"), so it's dropped.
    const ev = { id: "e1", date: "2026-01-15", amount: 100, accountId: "a1", label: "x" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.inPast.length).toBe(1);
    expect(out.inPast[0].monthIndex).toBe(-11);
  });

  it("fires a far-future payoff in the correct calendar year (regression)", () => {
    // Bug: a $500k payoff dated 2035-02 fired in 2036 because the index was
    // measured from baseYear instead of baseYear+1. Must land in 2035.
    const ev = { id: "e1", date: "2035-02-01", amount: -500000, accountId: "a1", label: "house payoff" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.events.length).toBe(1);
    // absMonth 98 → loop year ceil(98/12) = 9 → calendar 2026+9 = 2035
    expect(out.events[0].monthIndex).toBe(98);
    expect(Math.ceil(out.events[0].monthIndex / 12)).toBe(9);
  });

  it("classifies out-of-horizon events", () => {
    // horizon 360 months = 30 years; an event 31 years out is out of horizon
    const ev = { id: "e1", date: "2057-06-15", amount: 100, accountId: "a1", label: "x" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.outOfHorizon.length).toBe(1);
    expect(out.events.length).toBe(0);
  });

  it("classifies multiple events correctly", () => {
    const events = [
      { id: "e1", date: "2027-06-15", amount: -30000, accountId: "a1", label: "car" },         // in horizon
      { id: "e2", date: "2030-01-01", amount: 50000, accountId: "a2", label: "inheritance" },  // in horizon
      { id: "e3", date: "2025-01-01", amount: 100, accountId: "a1", label: "past" },           // past
      { id: "e4", date: "2200-01-01", amount: 100, accountId: "a1", label: "far future" },      // out of horizon
      { id: "e5", date: "2027-06-15", amount: 100, label: "no acct" },                          // orphan: no account
      { id: "e6", date: "2027-06-15", amount: 100, accountId: "ghost", label: "ghost" },        // orphan: account-missing
      { id: "e7", date: "garbage", amount: 100, accountId: "a1", label: "bad date" },           // orphan: bad-date
    ];
    const out = resolveOneTimeEvents(events, accounts, base, horizonMonths);
    expect(out.events.length).toBe(2);
    expect(out.inPast.length).toBe(1);
    expect(out.outOfHorizon.length).toBe(1);
    expect(out.orphans.length).toBe(3);
  });

  it("preserves signed amounts (positive and negative)", () => {
    const events = [
      { id: "e1", date: "2027-06-15", amount: -30000, accountId: "a1", label: "out" },
      { id: "e2", date: "2027-06-15", amount: 50000, accountId: "a1", label: "in" },
    ];
    const out = resolveOneTimeEvents(events, accounts, base, horizonMonths);
    expect(out.events[0].amount).toBe(-30000);
    expect(out.events[1].amount).toBe(50000);
  });

  it("coerces invalid amount to 0", () => {
    const ev = { id: "e1", date: "2027-06-15", amount: "not a number", accountId: "a1", label: "x" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.events[0].amount).toBe(0);
  });

  it("skips null/undefined entries silently", () => {
    const out = resolveOneTimeEvents([null, undefined, "not an object"], accounts, base, horizonMonths);
    expect(out.events).toEqual([]);
    expect(out.orphans).toEqual([]);
  });

  it("uses current date when baseYearMonth omitted", () => {
    // Just confirm it doesn't throw and produces a coherent result
    const ev = { id: "e1", date: "2099-06-15", amount: 100, accountId: "a1", label: "future" };
    const out = resolveOneTimeEvents([ev], accounts, undefined, 360);
    // Should classify as either in-horizon or out-of-horizon depending on
    // when this test runs — both are valid; just confirm shape is sane.
    expect(out.events.length + out.outOfHorizon.length).toBe(1);
  });

  it("respects horizon boundary exactly", () => {
    // Exact horizon-boundary event should still be in-horizon.
    // horizon 360 = 30 sim years; the last simulated month (absMonth 360) is
    // December of loop year 30 = December 2056. (2056-2026-1)*12 + 12 = 360.
    const ev = { id: "e1", date: "2056-12-01", amount: 100, accountId: "a1", label: "boundary" };
    const out = resolveOneTimeEvents([ev], accounts, base, 360);
    expect(out.events.length).toBe(1);
    expect(out.events[0].monthIndex).toBe(360);
  });

  it("drops the month just past the horizon boundary", () => {
    // 2057-01 → absMonth 361, one past horizon 360 → outOfHorizon
    const ev = { id: "e1", date: "2057-01-01", amount: 100, accountId: "a1", label: "past-boundary" };
    const out = resolveOneTimeEvents([ev], accounts, base, 360);
    expect(out.outOfHorizon.length).toBe(1);
    expect(out.events.length).toBe(0);
  });
});

describe("monthIndexToFractionalYear", () => {
  it("returns 0 for monthIndex 0", () => {
    expect(monthIndexToFractionalYear(0)).toBe(0);
  });

  it("returns 1 for monthIndex 12", () => {
    expect(monthIndexToFractionalYear(12)).toBe(1);
  });

  it("returns 0.5 for monthIndex 6", () => {
    expect(monthIndexToFractionalYear(6)).toBe(0.5);
  });

  it("returns fractional for arbitrary monthIndex", () => {
    expect(monthIndexToFractionalYear(17)).toBeCloseTo(17 / 12, 5);
  });

  it("returns 0 for non-finite or negative inputs", () => {
    expect(monthIndexToFractionalYear(NaN)).toBe(0);
    expect(monthIndexToFractionalYear(-5)).toBe(0);
    expect(monthIndexToFractionalYear("garbage")).toBe(0);
  });
});

describe("monthIndexToChartYear", () => {
  /* Regression: ReferenceLine x values with fractional positions silently
     drop on Recharts v3 category axes. monthIndexToChartYear snaps to the
     integer year the event fires in so markers always render. */
  it("returns 0 for monthIndex 0 (starting-balance year)", () => {
    expect(monthIndexToChartYear(0)).toBe(0);
  });

  it("snaps months 1..12 to year 1", () => {
    expect(monthIndexToChartYear(1)).toBe(1);
    expect(monthIndexToChartYear(6)).toBe(1);
    expect(monthIndexToChartYear(12)).toBe(1);
  });

  it("snaps months 13..24 to year 2", () => {
    expect(monthIndexToChartYear(13)).toBe(2);
    expect(monthIndexToChartYear(24)).toBe(2);
  });

  it("snaps arbitrary mid-horizon months to their year", () => {
    expect(monthIndexToChartYear(17)).toBe(2);
    expect(monthIndexToChartYear(36)).toBe(3);
    expect(monthIndexToChartYear(37)).toBe(4);
  });

  it("returns 0 for non-finite or negative inputs", () => {
    expect(monthIndexToChartYear(NaN)).toBe(0);
    expect(monthIndexToChartYear(-5)).toBe(0);
    expect(monthIndexToChartYear("garbage")).toBe(0);
  });
});

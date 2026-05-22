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
  it("returns 0 for date in baseYear+baseMonth", () => {
    expect(eventMonthIndex("2026-01-15", 2026, 1)).toBe(0);
  });

  it("returns 1 for date one month after base", () => {
    expect(eventMonthIndex("2026-02-15", 2026, 1)).toBe(1);
  });

  it("returns 12 for date one year after base", () => {
    expect(eventMonthIndex("2027-01-15", 2026, 1)).toBe(12);
  });

  it("returns negative for date before base", () => {
    expect(eventMonthIndex("2025-12-15", 2026, 1)).toBe(-1);
  });

  it("handles cross-year correctly", () => {
    // base = 2026-06, event = 2027-03 → 9 months forward
    expect(eventMonthIndex("2027-03-01", 2026, 6)).toBe(9);
  });

  it("defaults baseMonth to 1 when omitted", () => {
    expect(eventMonthIndex("2027-01-15", 2026)).toBe(12);
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
    expect(out.events[0].monthIndex).toBe(17); // 12 (to 2027-01) + 5 (to 2027-06) = 17
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

  it("classifies base-month event as inPast (monthIndex 0)", () => {
    const ev = { id: "e1", date: "2026-01-15", amount: 100, accountId: "a1", label: "x" };
    const out = resolveOneTimeEvents([ev], accounts, base, horizonMonths);
    expect(out.inPast.length).toBe(1);
    expect(out.inPast[0].monthIndex).toBe(0);
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
    // Exact horizon-boundary event should still be in-horizon
    const ev = { id: "e1", date: "2056-01-01", amount: 100, accountId: "a1", label: "boundary" };
    // 2056-01 vs base 2026-01 = 360 months forward, horizon 360 → in horizon
    const out = resolveOneTimeEvents([ev], accounts, base, 360);
    expect(out.events.length).toBe(1);
    expect(out.events[0].monthIndex).toBe(360);
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

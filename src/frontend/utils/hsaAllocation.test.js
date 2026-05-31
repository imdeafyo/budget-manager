import { describe, it, expect } from "vitest";
import { isHsaType, firstHsaAccountByOwner, resolveHsaContribution } from "./hsaAllocation.js";

describe("isHsaType", () => {
  it("recognizes all three HSA account types", () => {
    expect(isHsaType("hsa_cash")).toBe(true);
    expect(isHsaType("hsa_invested")).toBe(true);
    expect(isHsaType("hsa")).toBe(true);
  });
  it("rejects non-HSA types", () => {
    expect(isHsaType("401k_pretax")).toBe(false);
    expect(isHsaType("taxable")).toBe(false);
    expect(isHsaType(undefined)).toBe(false);
  });
});

describe("firstHsaAccountByOwner", () => {
  it("picks the first HSA account per owner in account order", () => {
    const accounts = [
      { id: "a", owner: "p1", type: "hsa_cash" },
      { id: "b", owner: "p1", type: "hsa_invested" },
      { id: "c", owner: "p2", type: "hsa_cash" },
    ];
    expect(firstHsaAccountByOwner(accounts)).toEqual({ p1: "a", p2: "c" });
  });
  it("ignores non-HSA accounts when finding the first", () => {
    const accounts = [
      { id: "x", owner: "p1", type: "401k_pretax" },
      { id: "y", owner: "p1", type: "hsa_invested" },
    ];
    expect(firstHsaAccountByOwner(accounts)).toEqual({ p1: "y" });
  });
  it("handles joint owner key", () => {
    const accounts = [
      { id: "j1", owner: "joint", type: "hsa_cash" },
      { id: "j2", owner: "joint", type: "hsa_invested" },
    ];
    expect(firstHsaAccountByOwner(accounts)).toEqual({ joint: "j1" });
  });
  it("returns empty for no accounts / bad input", () => {
    expect(firstHsaAccountByOwner([])).toEqual({});
    expect(firstHsaAccountByOwner(null)).toEqual({});
  });
});

describe("resolveHsaContribution — double-count fix", () => {
  // Corey's real case: two HSA accounts (Cash + Invested), both owner p1,
  // Income HSA total $4,400/yr. The whole total goes to Cash, Invested gets 0,
  // so the $4,400 is counted ONCE — not $2,200 + $2,200 manual that ignored
  // the payroll HSA already in the budget.
  const accounts = [
    { id: "cash", owner: "p1", type: "hsa_cash" },
    { id: "inv", owner: "p1", type: "hsa_invested" },
  ];
  const firstMap = firstHsaAccountByOwner(accounts);

  it("routes the full owner total to the first HSA account", () => {
    expect(resolveHsaContribution(accounts[0], 4400, firstMap)).toBe(4400);
  });
  it("gives sibling HSA accounts 0 (no double-count)", () => {
    expect(resolveHsaContribution(accounts[1], 4400, firstMap)).toBe(0);
  });
  it("total across both accounts equals the owner total exactly once", () => {
    const a = resolveHsaContribution(accounts[0], 4400, firstMap);
    const b = resolveHsaContribution(accounts[1], 4400, firstMap);
    expect(a + b).toBe(4400);
  });

  it("returns null when owner total is 0 (fall through to manual, no silent wipe)", () => {
    expect(resolveHsaContribution(accounts[0], 0, firstMap)).toBeNull();
    expect(resolveHsaContribution(accounts[1], 0, firstMap)).toBeNull();
  });
  it("treats blank/NaN owner total as 0 → null", () => {
    expect(resolveHsaContribution(accounts[0], NaN, firstMap)).toBeNull();
    expect(resolveHsaContribution(accounts[0], undefined, firstMap)).toBeNull();
  });
  it("returns null for non-HSA accounts", () => {
    expect(resolveHsaContribution({ id: "k", owner: "p1", type: "401k_pretax" }, 4400, firstMap)).toBeNull();
  });

  it("single HSA account gets the whole total", () => {
    const one = [{ id: "solo", owner: "p2", type: "hsa_cash" }];
    const fm = firstHsaAccountByOwner(one);
    expect(resolveHsaContribution(one[0], 3000, fm)).toBe(3000);
  });

  it("joint HSA routes household total to the first joint account", () => {
    const joint = [
      { id: "jc", owner: "joint", type: "hsa_cash" },
      { id: "ji", owner: "joint", type: "hsa_invested" },
    ];
    const fm = firstHsaAccountByOwner(joint);
    expect(resolveHsaContribution(joint[0], 8000, fm)).toBe(8000);
    expect(resolveHsaContribution(joint[1], 8000, fm)).toBe(0);
  });
});

import { hasShare, ownerUsesShareMode, hsaShareSumByOwner } from "./hsaAllocation.js";

describe("hasShare", () => {
  it("treats blank/null/undefined/NaN as unset", () => {
    expect(hasShare("")).toBe(false);
    expect(hasShare(null)).toBe(false);
    expect(hasShare(undefined)).toBe(false);
    expect(hasShare("abc")).toBe(false);
  });
  it("treats finite numbers (incl. 0) as set", () => {
    expect(hasShare(0)).toBe(true);
    expect(hasShare(60)).toBe(true);
    expect(hasShare("40")).toBe(true);
  });
});

describe("ownerUsesShareMode", () => {
  it("false when no HSA account for owner has a share", () => {
    const accts = [{ id: "a", owner: "p1", type: "hsa_cash" }, { id: "b", owner: "p1", type: "hsa_invested" }];
    expect(ownerUsesShareMode(accts, "p1")).toBe(false);
  });
  it("true when any HSA account for owner has a share", () => {
    const accts = [{ id: "a", owner: "p1", type: "hsa_cash", hsaShare: 70 }, { id: "b", owner: "p1", type: "hsa_invested" }];
    expect(ownerUsesShareMode(accts, "p1")).toBe(true);
  });
  it("scoped per owner", () => {
    const accts = [{ id: "a", owner: "p1", type: "hsa_cash", hsaShare: 50 }, { id: "b", owner: "p2", type: "hsa_cash" }];
    expect(ownerUsesShareMode(accts, "p2")).toBe(false);
  });
});

describe("resolveHsaContribution — percent split mode", () => {
  const accounts = [
    { id: "cash", owner: "p1", type: "hsa_cash", hsaShare: 60 },
    { id: "inv", owner: "p1", type: "hsa_invested", hsaShare: 40 },
  ];
  const firstMap = firstHsaAccountByOwner(accounts);

  it("allocates ownerTotal × share% per account", () => {
    expect(resolveHsaContribution(accounts[0], 5000, firstMap, accounts)).toBe(3000);
    expect(resolveHsaContribution(accounts[1], 5000, firstMap, accounts)).toBe(2000);
  });
  it("split sums to the owner total when shares sum to 100", () => {
    const a = resolveHsaContribution(accounts[0], 5000, firstMap, accounts);
    const b = resolveHsaContribution(accounts[1], 5000, firstMap, accounts);
    expect(a + b).toBe(5000);
  });
  it("a sibling with no share set gets 0 in share mode", () => {
    const mixed = [
      { id: "cash", owner: "p1", type: "hsa_cash", hsaShare: 100 },
      { id: "inv", owner: "p1", type: "hsa_invested" }, // no share
    ];
    const fm = firstHsaAccountByOwner(mixed);
    expect(resolveHsaContribution(mixed[0], 4000, fm, mixed)).toBe(4000);
    expect(resolveHsaContribution(mixed[1], 4000, fm, mixed)).toBe(0);
  });
  it("under-sum leaves the remainder unallocated (literal, no rescale)", () => {
    const under = [
      { id: "cash", owner: "p1", type: "hsa_cash", hsaShare: 50 },
      { id: "inv", owner: "p1", type: "hsa_invested", hsaShare: 30 },
    ];
    const fm = firstHsaAccountByOwner(under);
    const a = resolveHsaContribution(under[0], 1000, fm, under);
    const b = resolveHsaContribution(under[1], 1000, fm, under);
    expect(a).toBe(500);
    expect(b).toBe(300);
    expect(a + b).toBe(800); // 20% ($200) unallocated, by design
  });
  it("falls back to legacy 100%-to-first when allAccounts omitted", () => {
    // Back-compat: old call signature without the accounts arg.
    expect(resolveHsaContribution(accounts[0], 5000, firstMap)).toBe(5000);
    expect(resolveHsaContribution(accounts[1], 5000, firstMap)).toBe(0);
  });
  it("zero owner total still returns null even in share mode", () => {
    expect(resolveHsaContribution(accounts[0], 0, firstMap, accounts)).toBeNull();
  });
});

describe("hsaShareSumByOwner", () => {
  it("sums shares per owner and counts contributing accounts", () => {
    const accts = [
      { id: "a", owner: "p1", type: "hsa_cash", hsaShare: 60 },
      { id: "b", owner: "p1", type: "hsa_invested", hsaShare: 40 },
      { id: "c", owner: "p2", type: "hsa_cash", hsaShare: 100 },
    ];
    expect(hsaShareSumByOwner(accts)).toEqual({ p1: { sum: 100, count: 2 }, p2: { sum: 100, count: 1 } });
  });
  it("ignores accounts without a share (legacy owners absent)", () => {
    const accts = [
      { id: "a", owner: "p1", type: "hsa_cash" },
      { id: "b", owner: "p2", type: "hsa_cash", hsaShare: 90 },
    ];
    expect(hsaShareSumByOwner(accts)).toEqual({ p2: { sum: 90, count: 1 } });
  });
});

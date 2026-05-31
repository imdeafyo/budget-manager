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

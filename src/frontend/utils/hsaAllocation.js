// HSA contribution allocation for the Advanced forecast.
//
// Session 2 made HSA a first-class per-person Income field and routes each
// owner's full annual HSA total (employee + employer) into their FIRST HSA
// account in account order, with sibling HSA accounts for the same owner
// receiving 0. This prevents the double-count that occurred when per-person
// HSA accounts fell through to manually-typed amounts while the payroll HSA
// was already in the budget.
//
// A per-account split UI (send X% to cash, Y% to invested) is the planned
// follow-up; until then "100% to first" is the unambiguous default and any
// sibling can be flipped to manual to allocate by hand.

const HSA_TYPES = new Set(["hsa_cash", "hsa_invested", "hsa"]);

export function isHsaType(type) {
  return HSA_TYPES.has(type);
}

// Map each owner ("p1" | "p2" | "joint") to the id of their first HSA account
// in the given account order. Owners with no HSA account are absent from the
// returned object.
export function firstHsaAccountByOwner(accounts) {
  const seen = {};
  if (!Array.isArray(accounts)) return seen;
  for (const a of accounts) {
    if (!a || !isHsaType(a.type)) continue;
    if (seen[a.owner] === undefined) seen[a.owner] = a.id;
  }
  return seen;
}

// Resolve the auto-derived HSA contribution for a single account.
//   account   — the account being resolved
//   ownerTotal — that owner's total annual HSA (employee + employer)
//   firstMap  — output of firstHsaAccountByOwner(accounts)
// Returns:
//   null  → owner total is 0/blank; caller should fall through to the
//           account's manual contribAmount (mirrors the IRA guard so an
//           existing manual value isn't silently zeroed)
//   total → this account is the owner's first HSA account
//   0     → this account is a sibling HSA account for the owner
export function resolveHsaContribution(account, ownerTotal, firstMap) {
  if (!account || !isHsaType(account.type)) return null;
  const total = Number(ownerTotal) || 0;
  if (total <= 0) return null;
  return firstMap[account.owner] === account.id ? total : 0;
}

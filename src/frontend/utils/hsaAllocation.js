// HSA contribution allocation for the Advanced forecast.
//
// Background (Session 2): HSA is a first-class per-person Income field. Each
// owner's full annual HSA total (employee + employer) needs to land in that
// owner's HSA forecast account(s) — exactly once — so it isn't double-counted
// against the payroll HSA already in the budget.
//
// Allocation modes:
//   • Legacy / default — when NO HSA account for an owner has a `hsaShare`
//     set, the owner's whole total goes to their FIRST HSA account and
//     siblings get 0. This is the original Session 2 behavior and remains the
//     fallback so existing saved accounts (which have no hsaShare) keep
//     working unchanged after a deploy.
//   • Percent split — when one or more of an owner's HSA accounts has a
//     numeric `hsaShare` (a percent, 0–100), each account gets
//     ownerTotal × share / 100. Accounts without a share contribute 0 in this
//     mode. The UI warns when an owner's shares don't sum to 100%, but the
//     math still allocates literally by whatever shares are entered (so a
//     90% sum simply leaves 10% unallocated rather than silently rescaling).
//
// Fixed-dollar and "remainder" modes are a planned follow-up (the buffer
// pattern: keep $X in cash, sweep the rest to invested). Not built yet.

const HSA_TYPES = new Set(["hsa_cash", "hsa_invested", "hsa"]);

export function isHsaType(type) {
  return HSA_TYPES.has(type);
}

// Map each owner ("p1" | "p2" | "joint") to the id of their first HSA account
// in the given account order. Owners with no HSA account are absent.
export function firstHsaAccountByOwner(accounts) {
  const seen = {};
  if (!Array.isArray(accounts)) return seen;
  for (const a of accounts) {
    if (!a || !isHsaType(a.type)) continue;
    if (seen[a.owner] === undefined) seen[a.owner] = a.id;
  }
  return seen;
}

// True when a share value is "set" — a finite number ≥ 0. Blank string,
// null, undefined, NaN all count as unset (→ legacy mode).
export function hasShare(v) {
  if (v === "" || v === null || v === undefined) return false;
  const n = Number(v);
  return Number.isFinite(n);
}

// Does this owner have ANY HSA account with a share set? Drives mode selection.
export function ownerUsesShareMode(accounts, owner) {
  if (!Array.isArray(accounts)) return false;
  return accounts.some(a => a && isHsaType(a.type) && a.owner === owner && hasShare(a.hsaShare));
}

// Sum of shares per owner (only HSA accounts, only those with a share set).
// Returns { [owner]: { sum, count } } — count is how many accounts contribute
// to the sum, so the UI can skip the warning when an owner uses legacy mode.
export function hsaShareSumByOwner(accounts) {
  const out = {};
  if (!Array.isArray(accounts)) return out;
  for (const a of accounts) {
    if (!a || !isHsaType(a.type)) continue;
    if (!hasShare(a.hsaShare)) continue;
    const o = a.owner;
    if (!out[o]) out[o] = { sum: 0, count: 0 };
    out[o].sum += Number(a.hsaShare);
    out[o].count += 1;
  }
  return out;
}

// Resolve the auto-derived HSA contribution for a single account.
//   account    — the account being resolved
//   ownerTotal — that owner's total annual HSA (employee + employer)
//   firstMap   — output of firstHsaAccountByOwner(accounts)
//   allAccounts (optional) — full account list, needed to detect share mode.
//                If omitted, behaves in legacy mode (back-compat).
// Returns:
//   null  → owner total is 0/blank; caller falls through to the account's
//           manual contribAmount (mirrors the IRA guard, no silent wipe)
//   number → the dollar contribution for this account
export function resolveHsaContribution(account, ownerTotal, firstMap, allAccounts) {
  if (!account || !isHsaType(account.type)) return null;
  const total = Number(ownerTotal) || 0;
  if (total <= 0) return null;

  // Share mode — only when the owner has at least one share set.
  if (allAccounts && ownerUsesShareMode(allAccounts, account.owner)) {
    if (!hasShare(account.hsaShare)) return 0; // unset sibling gets nothing
    const pct = Math.max(0, Number(account.hsaShare));
    return total * pct / 100;
  }

  // Legacy / default — 100% to the owner's first HSA account.
  return firstMap[account.owner] === account.id ? total : 0;
}

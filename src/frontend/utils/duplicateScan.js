/* ══════════════════════════ Duplicate scan — pure utility ══════════════════════════
   Cross-account duplicate detection over the entire transaction history,
   driven by user-configurable thresholds. Distinct from the import-time
   `findDuplicate` in transactions.js, which only catches exact same-account
   collisions during a single import.

   Why a separate module:
   - The matcher is O(n × m) inside amount buckets, which warrants its own
     home and its own tests.
   - The settings (day window, amount tolerance, description match mode)
     are user-configurable and change the heuristic shape, not just the
     thresholds.
   - The output is groups (clusters), not pairs — a triplicate should
     surface as one group of 3, not three groups of 2.

   Account awareness (crossAccount option):
   A *real* duplicate is almost always two imports of the SAME charge into
   the SAME account. A match across two different accounts is usually a
   coincidence — two cards, same coffee shop, same day, same $4.50. So the
   account field is a strong signal and the scan uses it:
   - crossAccount: false (default) — rows only cluster with same-account
     rows. Cross-account coincidences never surface. This is the safe
     default for the common "Amex Platinum + Amex Platinum Additional are
     two views but I imported both" worry: those are different account
     names, so their matches simply don't show unless you opt in.
   - crossAccount: true — rows cluster regardless of account. Any group
     that ends up spanning 2+ distinct accounts is tagged crossAccount:true
     and sorted BELOW the same-account groups, so high-confidence
     same-account dups are reviewed first.

   Algorithm:
   1. Drop marked-transfer rows — pairing the two sides of a confirmed
      transfer as duplicates would be a false positive every time.
   2. Bucket remaining rows by amount, rounded to the nearest tolerance.
      $50.00 with a $0.01 tolerance buckets to "5000". Negative amounts
      stay negative (a -$50 expense and a +$50 income shouldn't pair).
   3. Within each bucket, walk the rows and build clusters via union-find.
      Two rows merge into the same cluster when ALL configured criteria
      pass: |dateDiff| ≤ dayWindow AND descriptionMatches per the mode
      AND (crossAccount OR same account).
   4. Return only clusters with 2+ members.

   Output shape:
   {
     groups: [
       { key: "amt:-5000|fp:starbucks", members: [tx, tx, tx], crossAccount: false },
       ...
     ],
     totalDuplicates: 5,        // total rows in any group beyond the first
     scannedCount: 1234,        // rows considered after transfer filter
   }
   `crossAccount` on a group is true when its members span 2+ distinct
   account names (only possible when the crossAccount option is on).
   `members` is sorted by date ascending so the "earliest" row is first —
   downstream UI can default to "keep the earliest, delete the rest." */

import { isMarkedTransfer } from "./transfers.js";
import { isExcludedDuplicate, isDuplicateDismissed } from "./exclusions.js";

/* ── Description normalization ──
   Lowercase, collapse whitespace, strip leading/trailing punctuation. Used
   by both "exact" and "first-words" match modes as the base. */
export function normalizeDesc(s) {
  if (typeof s !== "string") return "";
  return s
    .trim()
    .toLowerCase()
    // Collapse runs of whitespace into a single space
    .replace(/\s+/g, " ")
    // Strip non-alphanumeric trailing junk (e.g. trailing punctuation)
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/* Tokenize the normalized description into words for the "first-words" mode.
   Splits on whitespace AND punctuation so "AMAZON.COM*ABC" becomes
   ["amazon", "com", "abc"]. */
export function tokenize(s) {
  const norm = normalizeDesc(s);
  if (!norm) return [];
  return norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/* Per-mode description-match check. Returns true if `a` and `b` count as
   the "same" description under the given mode + word count. */
export function descriptionsMatch(a, b, mode = "exact", firstWordCount = 2) {
  if (mode === "off") return true;
  if (mode === "exact") {
    return normalizeDesc(a) === normalizeDesc(b);
  }
  if (mode === "first-words") {
    const ta = tokenize(a).slice(0, firstWordCount).join(" ");
    const tb = tokenize(b).slice(0, firstWordCount).join(" ");
    if (!ta || !tb) return false;
    return ta === tb;
  }
  return false;
}

/* Normalize an account name for same-account comparison: trim + lowercase +
   collapse whitespace. Missing/blank accounts normalize to "" — two rows that
   both lack an account are treated as the "same" (unknown) account, which is
   the conservative choice (they can still cluster in same-account mode). */
export function normalizeAccount(s) {
  if (typeof s !== "string") return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/* ── Date diff in days, ISO yyyy-mm-dd inputs ── */
function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return Infinity;
  // Use UTC midnight to avoid DST off-by-one
  const a = Date.UTC(+isoA.slice(0, 4), +isoA.slice(5, 7) - 1, +isoA.slice(8, 10));
  const b = Date.UTC(+isoB.slice(0, 4), +isoB.slice(5, 7) - 1, +isoB.slice(8, 10));
  if (!isFinite(a) || !isFinite(b)) return Infinity;
  return Math.abs((a - b) / 86400000);
}

/* ── Tiny union-find for clustering rows in a bucket ── */
function makeUF(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

/* ── Main entry ──
   Scan the transaction list for duplicates per the supplied options.
   Defaults are conservative: same day, exact amount, exact description.
   The caller (Settings UI) overrides these with whatever the user picked. */
export function scanForDuplicates(transactions, opts = {}) {
  const {
    dayWindow = 0,           // ±N days; 0 = same calendar day only
    amountTolerance = 0.01,  // $X tolerance; default penny-precision
    descriptionMode = "exact", // "off" | "exact" | "first-words"
    firstWordCount = 2,
    crossAccount = false,    // false = only cluster within the same account;
                             // true = cluster across accounts, tag mixed groups
  } = opts;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return { groups: [], totalDuplicates: 0, scannedCount: 0 };
  }

  // Drop marked transfers — confirmed transfer pairs would always look like
  // duplicates by amount (one side negative, one positive) but they aren't.
  // We also drop rows missing date or amount, which can't be matched.
  const rows = transactions.filter(tx => {
    if (!tx) return false;
    if (isMarkedTransfer(tx)) return false;
    // Already-excluded duplicates shouldn't resurface in a fresh scan.
    if (isExcludedDuplicate(tx)) return false;
    // Rows the user marked "not a duplicate" are permanently skipped, so a
    // legitimate recurring group doesn't reappear on every scan.
    if (isDuplicateDismissed(tx)) return false;
    if (!tx.date) return false;
    if (typeof tx.amount !== "number" || !isFinite(tx.amount)) return false;
    return true;
  });

  // Bucket by amount rounded to the tolerance. Tolerance is $0.01 → multiply
  // by 100 and round; tolerance $1.00 → divide by 100, round, multiply back.
  // Use a normalized bucket key string to keep this simple.
  const tol = Math.max(0.01, Number(amountTolerance) || 0.01);
  const bucketKey = (amount) => {
    const cents = Math.round(amount * 100);
    const tolCents = Math.round(tol * 100);
    // Snap to the nearest multiple of tolCents. Negative amounts work naturally
    // because Math.round rounds toward 0 then the modulo aligns the bucket.
    const snapped = Math.round(cents / tolCents) * tolCents;
    return String(snapped);
  };

  const buckets = new Map();
  for (const tx of rows) {
    const k = bucketKey(tx.amount);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(tx);
  }

  const groups = [];
  let totalDuplicates = 0;

  // Within each bucket, cluster via union-find. Bucket sizes are typically
  // tiny (handful of $5.00-rounded transactions), so the O(n²) inner pair-check
  // is fine in practice. If a real user hits a bucket with 1000s of identical
  // amounts, the inner loop is still bounded by that bucket's size, not n.
  for (const [, bucket] of buckets) {
    if (bucket.length < 2) continue;

    const uf = makeUF(bucket.length);
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i], b = bucket[j];
        // Already in same cluster? skip (shaves a bit off pathological cases)
        if (uf.find(i) === uf.find(j)) continue;
        // Account gate: in same-account mode, two rows from different accounts
        // never cluster — a cross-account match is almost always a coincidence,
        // not a re-imported duplicate.
        if (!crossAccount && normalizeAccount(a.account) !== normalizeAccount(b.account)) continue;
        if (daysBetween(a.date, b.date) > dayWindow) continue;
        if (!descriptionsMatch(a.description, b.description, descriptionMode, firstWordCount)) continue;
        // All criteria match — merge clusters.
        uf.union(i, j);
      }
    }

    // Materialize clusters from union-find roots.
    const clusters = new Map();
    for (let i = 0; i < bucket.length; i++) {
      const root = uf.find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(bucket[i]);
    }
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;
      // Sort members by date asc so the "first" row is the earliest.
      cluster.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const firstAmtCents = Math.round((cluster[0].amount || 0) * 100);
      const fp = descriptionMode === "off"
        ? "any"
        : descriptionMode === "first-words"
          ? tokenize(cluster[0].description).slice(0, firstWordCount).join("-") || "blank"
          : normalizeDesc(cluster[0].description) || "blank";
      // A group is "cross-account" when its members span 2+ distinct accounts.
      // Only possible when the crossAccount option is on; in same-account mode
      // every group is single-account by construction.
      const distinctAccts = new Set(cluster.map(m => normalizeAccount(m.account)));
      // Key must be UNIQUE per group. Amount + description fingerprint is NOT
      // unique: recurring identical charges (e.g. a weekly contribution to the
      // same fund for the same amount) produce many distinct groups that share
      // amount and description but differ by date. Append the earliest member's
      // id — ids are unique and clusters never share members, so this is a
      // stable unique key. (Previously the non-unique key caused React key
      // collisions: stale rows lingered in the list and per-group actions hit
      // every same-amount/description group at once.)
      const groupKey = `amt:${firstAmtCents}|fp:${fp}|id:${cluster[0].id}`;
      groups.push({
        key: groupKey,
        members: cluster,
        crossAccount: distinctAccts.size > 1,
      });
      // "duplicates" = members beyond the first (i.e., rows that could be
      // deleted to dedupe the cluster).
      totalDuplicates += cluster.length - 1;
    }
  }

  // Sort groups so the most-confident matches surface first: same-account
  // groups (high confidence) before cross-account groups (likely coincidence),
  // then groups with more members, then by amount desc (largest impact first).
  groups.sort((g1, g2) => {
    if (!!g1.crossAccount !== !!g2.crossAccount) return g1.crossAccount ? 1 : -1;
    if (g2.members.length !== g1.members.length) return g2.members.length - g1.members.length;
    const a1 = Math.abs(g1.members[0].amount || 0);
    const a2 = Math.abs(g2.members[0].amount || 0);
    return a2 - a1;
  });

  return {
    groups,
    totalDuplicates,
    scannedCount: rows.length,
  };
}

/* ── Group analysis (for the scan modal's insight panel) ──
   Takes the `groups` array from scanForDuplicates and produces the same
   breakdown the local diagnostic script shows, so the user can make informed
   choices in the UI instead of bulk-acting blind:

   - byBatch:   how groups relate across import batches.
       INTRA-BATCH   : 2+ members share one import_batch_id (same charge twice
                       within one import).
       CROSS-BATCH   : members span different import_batch_id values (overlapping
                       re-imports).
       MANUAL/UNKNOWN: a member has no import_batch_id.
   - byBracket: groups bucketed by absolute amount (big / mid / small).
   - byAccount: per-account group + removable-row counts, with a `contrib` flag
       when the account name looks like a retirement/investment account. Those
       are the ones where identical-looking rows can be legitimate fragmented
       contributions rather than duplicates — so the UI can warn before bulk
       action.

   Pure: no side effects, safe to memoize on the groups array. */

const CONTRIB_ACCOUNT_RX = /\b(401|403b|457|ira|roth|hsa|health savings|brokerage|invest|fund|pension|retirement|vanguard|fidelity|schwab|lockheed|lmimco|tsp|espp|rsu)\b/i;

export function looksLikeContributionAccount(name) {
  return CONTRIB_ACCOUNT_RX.test(name || "");
}

function batchIdOf(tx) {
  return tx?.import_batch_id ?? tx?.custom_fields?.import_batch_id ?? null;
}

export function classifyBatchRelationship(group) {
  const ids = (group?.members || []).map(batchIdOf);
  const distinct = new Set(ids.filter(id => id != null));
  const counts = {};
  for (const id of ids) if (id != null) counts[id] = (counts[id] || 0) + 1;
  const hasIntra = Object.values(counts).some(c => c >= 2);
  if (hasIntra) return "INTRA-BATCH";
  if (distinct.size >= 2) return "CROSS-BATCH";
  return "MANUAL/UNKNOWN";
}

export function analyzeDuplicateGroups(groups, opts = {}) {
  const big = Number(opts.big ?? 200);
  const mid = Number(opts.mid ?? 25);

  const byBatch = { "INTRA-BATCH": 0, "CROSS-BATCH": 0, "MANUAL/UNKNOWN": 0 };
  const byBracket = { big: 0, mid: 0, small: 0 };
  const accounts = new Map(); // name -> { account, groups, rows, contrib }
  let removableRows = 0;
  let contribGroups = 0;

  for (const g of (groups || [])) {
    const members = g.members || [];
    const extra = Math.max(0, members.length - 1);
    removableRows += extra;

    byBatch[classifyBatchRelationship(g)]++;

    const amt = Math.abs(Number(members[0]?.amount) || 0);
    const bracket = amt >= big ? "big" : amt >= mid ? "mid" : "small";
    byBracket[bracket]++;

    const acct = (members[0]?.account || "—").trim() || "—";
    if (!accounts.has(acct)) {
      accounts.set(acct, { account: acct, groups: 0, rows: 0, contrib: looksLikeContributionAccount(acct) });
    }
    const rec = accounts.get(acct);
    rec.groups++;
    rec.rows += extra;
    if (rec.contrib) contribGroups++;
  }

  const byAccount = [...accounts.values()].sort((a, b) => b.groups - a.groups);

  return {
    totalGroups: (groups || []).length,
    removableRows,
    byBatch,
    byBracket,
    byAccount,
    contribGroups,
    spendingGroups: (groups || []).length - contribGroups,
    thresholds: { big, mid },
  };
}

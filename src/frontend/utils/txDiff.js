/* ══════════════════════════ Transaction diff — pure helper ══════════════════════════
   Given the previous transactions array and the next one (e.g. after a rule
   sweep), return only the rows that actually changed. Used by
   bulkUpdateTransactions so a sweep that recategorizes a handful of rows sends
   a small PATCH instead of rewriting the whole table.

   A row counts as changed if it's new (id not present before) or if its
   serialized content differs from the previous version. Order-independent:
   matches on id, not array position.
*/
export function diffChangedTransactions(prev, next) {
  if (!Array.isArray(next)) return [];
  const prevById = new Map((prev || []).map(t => [t.id, t]));
  return next.filter(t => {
    const before = prevById.get(t.id);
    return !before || JSON.stringify(before) !== JSON.stringify(t);
  });
}

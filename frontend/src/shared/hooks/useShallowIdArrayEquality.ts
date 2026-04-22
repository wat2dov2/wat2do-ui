/**
 * Shallow ID-array equality helper.
 *
 * Zustand re-sets ID arrays on every reconcile, so the reference changes even
 * when the ID set is identical. Pass this as the second argument to a Zustand
 * selector to compare element-wise and skip spurious re-renders.
 *
 * Generic over number | string IDs — both variants show up in the codebase
 * (saved events use numeric IDs; string IDs appear elsewhere).
 *
 * Usage:
 *   const ids = useSomeStore((s) => s.someIds, idArrayEqual);
 */
export function idArrayEqual(
  a: readonly (number | string)[],
  b: readonly (number | string)[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

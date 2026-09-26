/**
 * Deep-freezes plain objects and arrays so snapshots and results handed out
 * of the core cannot be mutated by consumers. Already-frozen subtrees are
 * trusted and skipped (templates and pieces freeze themselves on creation);
 * typed arrays are left alone because freezing a non-empty one throws.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value) || ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

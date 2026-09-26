/**
 * Deterministic hashing for replay checkpoints, terrain identity and noise
 * (ADR 0012, proposed).
 *
 * These are regression tripwires, not security properties: 32-bit FNV-1a
 * over canonical JSON is enough to notice that two runs diverged, and the
 * replay harness then diffs the canonical JSON to find where. All arithmetic
 * is `Math.imul` plus shifts, so the results are identical on every engine.
 * Hashing works modulo 2^32 on purpose; that is the one place in the core
 * where bitwise ops on large values are the intent rather than a bug.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * 32-bit FNV-1a over the UTF-16 code units of `text`, as an unsigned integer.
 *
 * Each code unit is folded in whole, so for ASCII (all canonical JSON built
 * from ASCII keys and numbers) this equals byte-wise FNV-1a. Pass a previous
 * result as `seed` to continue a running hash across several inputs.
 */
export function fnv1a32(text: string, seed: number = FNV_OFFSET_BASIS): number {
  let h = seed | 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** 32-bit FNV-1a over raw bytes; `seed` continues a running hash. */
export function fnv1a32Bytes(bytes: Uint8Array, seed: number = FNV_OFFSET_BASIS): number {
  let h = seed | 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] ?? 0;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Formats a uint32 as exactly 8 lowercase hex digits. */
export function hex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace,
 * −0 written as 0, typed arrays as plain arrays and Maps as entry arrays
 * sorted by canonical key, then canonical value.
 *
 * `JSON.stringify` would silently drop `undefined`, turn NaN into null and
 * keep insertion order, each of which could make two different states hash
 * alike or equal states hash apart. So anything without one obvious
 * encoding throws a RangeError instead: NaN/±Infinity, undefined (including
 * array holes), functions, symbols, bigints, cycles, Sets and class
 * instances. Collections whose order matters are the caller's to sort.
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  writeCanonical(value, out, new Set<object>(), "$");
  return out.join("");
}

/** 8-hex-digit FNV-1a of `canonicalJson(value)`. */
export function hashCanonical(value: unknown): string {
  return hex32(fnv1a32(canonicalJson(value)));
}

function writeCanonical(value: unknown, out: string[], stack: Set<object>, path: string): void {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "number":
      if (!Number.isFinite(value)) throw new RangeError(`canonicalJson: non-finite number at ${path}`);
      out.push(value === 0 ? "0" : JSON.stringify(value));
      return;
    case "string":
      out.push(JSON.stringify(value));
      return;
    case "object":
      break;
    default:
      throw new RangeError(`canonicalJson: ${typeof value} has no canonical form at ${path}`);
  }

  if (stack.has(value)) throw new RangeError(`canonicalJson: cycle at ${path}`);
  stack.add(value);
  if (Array.isArray(value)) {
    out.push("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(",");
      writeCanonical(value[i], out, stack, `${path}[${i}]`);
    }
    out.push("]");
  } else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const items = value as unknown as ArrayLike<unknown>;
    out.push("[");
    for (let i = 0; i < items.length; i++) {
      if (i > 0) out.push(",");
      writeCanonical(items[i], out, stack, `${path}[${i}]`);
    }
    out.push("]");
  } else if (value instanceof Map) {
    const entries: [string, string][] = [];
    let n = 0;
    for (const [k, v] of value) {
      entries.push([subCanonical(k, stack, `${path}<key ${n}>`), subCanonical(v, stack, `${path}<value ${n}>`)]);
      n += 1;
    }
    // Distinct keys can share a canonical text (two equal object keys), so ties
    // break on the value too; otherwise insertion order would decide the output.
    entries.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    out.push("[", entries.map(([k, v]) => `[${k},${v}]`).join(","), "]");
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new RangeError(`canonicalJson: only plain objects, arrays, typed arrays and Maps are canonical (at ${path})`);
    }
    const record = value as Record<string, unknown>;
    // Default sort compares UTF-16 code units, never locale.
    const keys = Object.keys(record).sort();
    out.push("{");
    keys.forEach((key, i) => {
      if (i > 0) out.push(",");
      out.push(JSON.stringify(key), ":");
      writeCanonical(record[key], out, stack, `${path}.${key}`);
    });
    out.push("}");
  }
  stack.delete(value);
}

/** Canonical text of a nested value that shares the caller's cycle stack. */
function subCanonical(value: unknown, stack: Set<object>, path: string): string {
  const out: string[] = [];
  writeCanonical(value, out, stack, path);
  return out.join("");
}

/**
 * Mixes safe integers into one uint32 (MurmurHash3's 32-bit block and
 * finalizer steps). Inputs are taken modulo 2^32, so negatives are fine; the
 * argument count is mixed in too, so (1, 2) and (1, 2, 0) differ. Used for
 * noise lattices, where it replaces PRNG state with a pure function of the
 * coordinates.
 */
export function hash32(...ints: number[]): number {
  let h = 0x9747b28c;
  for (const v of ints) {
    if (!Number.isSafeInteger(v)) throw new RangeError(`hash32 needs safe integers, got ${v}`);
    let k = Math.imul(v | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= ints.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

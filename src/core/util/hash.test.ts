import { describe, expect, it } from "vitest";
import { canonicalJson, fnv1a32, fnv1a32Bytes, hash32, hashCanonical, hex32 } from "./hash";

describe("fnv1a32", () => {
  it("matches the published 32-bit FNV-1a test vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("agrees with the byte version on ASCII and continues a running hash through the seed", () => {
    const bytes = Uint8Array.from("foobar", (ch) => ch.charCodeAt(0));
    expect(fnv1a32Bytes(bytes)).toBe(fnv1a32("foobar"));
    expect(fnv1a32("bar", fnv1a32("foo"))).toBe(fnv1a32("foobar"));
    expect(fnv1a32Bytes(bytes.subarray(3), fnv1a32Bytes(bytes.subarray(0, 3)))).toBe(fnv1a32("foobar"));
  });

  it("always returns an unsigned 32-bit integer", () => {
    for (const text of ["", "x", "baltic-diorama", "ä€𝄞"]) {
      const h = fnv1a32(text);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    }
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth, drops whitespace and flattens typed arrays and Maps", () => {
    const value = {
      b: [1, -0, 2.5],
      a: { y: null, x: "é\n" },
      t: new Int16Array([3, -4]),
      m: new Map([
        ["z", 1],
        ["a", 2],
      ]),
    };
    expect(canonicalJson(value)).toBe('{"a":{"x":"é\\n","y":null},"b":[1,0,2.5],"m":[["a",2],["z",1]],"t":[3,-4]}');
  });

  it("gives the same text for the same content whatever the insertion order", () => {
    const one = { seed: "s", size: { rows: 2, columns: 3 }, flags: [true, false] };
    const two = { flags: [true, false], size: { columns: 3, rows: 2 }, seed: "s" };
    expect(canonicalJson(one)).toBe(canonicalJson(two));
    expect(hashCanonical(one)).toBe(hashCanonical(two));
  });

  it("orders Map entries whose keys canonicalize alike by value, not by insertion", () => {
    const one = new Map([
      [{ a: 1 }, 1],
      [{ a: 1 }, 2],
    ]);
    const two = new Map([
      [{ a: 1 }, 2],
      [{ a: 1 }, 1],
    ]);
    expect(canonicalJson(one)).toBe('[[{"a":1},1],[{"a":1},2]]');
    expect(canonicalJson(two)).toBe(canonicalJson(one));
  });

  it("orders keys by UTF-16 code unit, not by locale", () => {
    expect(canonicalJson({ b: 1, B: 2, "é": 3, a: 4 })).toBe('{"B":2,"a":4,"b":1,"é":3}');
  });

  it("rejects values without a single canonical encoding with a RangeError", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const rejected: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      { a: undefined },
      [1, undefined],
      [1, , 3],
      () => 1,
      Symbol("s"),
      10n,
      cyclic,
      new Set([1]),
      new (class Point {
        x = 1;
      })(),
    ];
    for (const value of rejected) expect(() => canonicalJson(value)).toThrow(RangeError);
  });

  it("allows a shared object to appear twice when there is no cycle", () => {
    const shared = { k: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}');
  });
});

describe("hashCanonical and hex32", () => {
  it("formats as exactly 8 lowercase hex digits", () => {
    expect(hex32(0)).toBe("00000000");
    expect(hex32(0xdeadbeef)).toBe("deadbeef");
    expect(hashCanonical({ b: 1, a: [true, "x"] })).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps a golden value so an encoding change cannot slip through", () => {
    expect(hashCanonical({ b: 1, a: [true, "x"] })).toBe("c25d016b");
  });
});

describe("hash32", () => {
  it("is a deterministic pure function with golden values", () => {
    expect([hash32(), hash32(0), hash32(1, 2), hash32(1, 2, 0), hash32(-1, 5, 3, 0xdeadbeef)]).toEqual([
      3954623016, 2754643151, 3415096096, 3098368677, 2361587052,
    ]);
  });

  it("separates argument order, argument count and sign", () => {
    const seen = new Set([hash32(1, 2), hash32(2, 1), hash32(1, 2, 0), hash32(-1, 2), hash32(1, -2)]);
    expect(seen.size).toBe(5);
  });

  it("spreads neighbouring lattice cells across the whole uint32 range", () => {
    const buckets = new Array<number>(16).fill(0);
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) buckets[hash32(x, y, 0, 12345) >>> 28]! += 1;
    }
    // 4096 samples over 16 buckets: expect 256 each, allow generous noise.
    for (const count of buckets) expect(count).toBeGreaterThan(200);
  });

  it("rejects fractional and unsafe inputs with a RangeError", () => {
    expect(() => hash32(1.5)).toThrow(RangeError);
    expect(() => hash32(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

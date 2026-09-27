import { describe, expect, it } from "vitest";
import type { Command, Result } from "../core/sim/api";
import { PREVIEW_MEMO_CAPACITY, commandKey, createPreviewMemo } from "./previewMemo";

const ok: Result = { ok: true, networkRev: 1, diff: { added: [], removed: [] }, counts: { new: 0, reused: 0 } };

function build(q: number): Command {
  return { type: "build-track", structure: "auto", pieces: [{ kind: "straight", from: { q, r: 0, zMm: 0 }, heading: 0, z1Mm: 0 }] };
}

describe("preview memo", () => {
  it("keys commands canonically by type and resolved pieces", () => {
    expect(commandKey(build(3))).toBe("build:auto:S:3,0,0:0:0");
    expect(commandKey(build(3))).toBe(commandKey(build(3)));
    expect(commandKey(build(3))).not.toBe(commandKey(build(4)));
    expect(commandKey({ type: "undo" })).toBe("undo");
    expect(commandKey({ type: "demolish", pieces: ["S:0,0,0:0:0"] })).toBe("demolish:S:0,0,0:0:0");
  });

  it("calls preview once per key and revision", () => {
    let calls = 0;
    let rev = 0;
    const memo = createPreviewMemo(
      () => {
        calls += 1;
        return ok;
      },
      () => rev,
    );
    memo.preview(build(1));
    memo.preview(build(1));
    expect(calls).toBe(1);
    rev = 1;
    memo.preview(build(1));
    expect(calls).toBe(2);
    expect(memo.stats()).toEqual({ hits: 1, misses: 2, size: 2 });
  });

  it("evicts the least recently used entry beyond 16", () => {
    let calls = 0;
    const memo = createPreviewMemo(
      () => {
        calls += 1;
        return ok;
      },
      () => 0,
    );
    expect(PREVIEW_MEMO_CAPACITY).toBe(16);
    for (let q = 0; q < 16; q++) memo.preview(build(q));
    memo.preview(build(0)); // refreshes 0, so 1 is now the oldest
    memo.preview(build(16)); // evicts 1
    expect(memo.stats().size).toBe(16);
    calls = 0;
    memo.preview(build(0));
    expect(calls).toBe(0);
    memo.preview(build(1));
    expect(calls).toBe(1);
  });

  it("rejects a capacity below one", () => {
    expect(() => createPreviewMemo(() => ok, () => 0, 0)).toThrow(RangeError);
  });
});

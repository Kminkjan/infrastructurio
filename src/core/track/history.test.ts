import { describe, expect, it } from "vitest";
import { type Diff, EMPTY_DIFF, invertDiff, makeDiff } from "./authored";
import { EMPTY_HISTORY, HISTORY_DEPTH, recordEdit, stepHistory } from "./history";
import type { Validation } from "./validate";

function edit(i: number): Diff {
  return makeDiff([{ key: `S:${i},0,0:0:0`, structure: "ground" }], []);
}

const accept = (diff: Diff): Validation => ({ ok: true, diff, counts: { new: diff.added.length, reused: 0 } });

describe("construction history", () => {
  it("keeps the last 100 edits and drops the oldest", () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_DEPTH + 5; i++) h = recordEdit(h, edit(i));
    expect(h.undo).toHaveLength(100);
    expect(h.undo[0]).toEqual(edit(5));
    expect(h.undo[99]).toEqual(edit(104));
  });

  it("records nothing for an empty diff and clears redo on a new edit", () => {
    const h1 = recordEdit(EMPTY_HISTORY, edit(1));
    expect(recordEdit(h1, EMPTY_DIFF)).toBe(h1);
    const undone = stepHistory(h1, "undo", accept);
    if (!undone.ok) throw new Error("undo failed");
    expect(undone.next.redo).toHaveLength(1);
    expect(recordEdit(undone.next, EMPTY_DIFF).redo).toHaveLength(1);
    expect(recordEdit(undone.next, edit(2)).redo).toHaveLength(0);
  });

  it("undoes with the inverse diff and redoes with the original", () => {
    const h1 = recordEdit(EMPTY_HISTORY, edit(1));
    const seen: Diff[] = [];
    const spy = (diff: Diff): Validation => {
      seen.push(diff);
      return accept(diff);
    };
    const undone = stepHistory(h1, "undo", spy);
    if (!undone.ok) throw new Error("undo failed");
    const redone = stepHistory(undone.next, "redo", spy);
    if (!redone.ok) throw new Error("redo failed");
    expect(seen).toEqual([invertDiff(edit(1)), edit(1)]);
    expect(redone.next).toEqual(h1);
  });

  it("reports undo-empty and redo-empty with nothing to step", () => {
    const u = stepHistory(EMPTY_HISTORY, "undo", accept);
    const r = stepHistory(EMPTY_HISTORY, "redo", accept);
    expect(!u.ok && u.reason.code).toBe("undo-empty");
    expect(!r.ok && r.reason.code).toBe("redo-empty");
  });

  it("wraps a failed validation as undo-blocked with the inner reason as cause", () => {
    const h1 = recordEdit(EMPTY_HISTORY, edit(1));
    const inner = { code: "tracks-too-close", message: "Tracks a and b come 1.00 m apart; move the tracks apart.", refs: [] } as const;
    const step = stepHistory(h1, "undo", () => ({ ok: false, reason: inner, highlight: ["a", "b"] }));
    expect(step.ok).toBe(false);
    if (step.ok) return;
    expect(step.reason.code).toBe("undo-blocked");
    expect(step.reason.cause).toEqual(inner);
    expect(step.reason.message).toContain(inner.message);
    expect(step.highlight).toEqual(["a", "b"]);
  });
});

import { describe, expect, it } from "vitest";
import { type PieceSpec, resolvePiece } from "../geometry/piece";
import { CURVE_TEMPLATES } from "../geometry/templates";
import { generateTerrain, nodeOfOffset, offsetOfNode, terrainBoundsM } from "../terrain";
import { emptyAuthored } from "./authored";
import { REASON_CODES, RULES, RULE_ORDER, createTrackIndex, heightsAt, indexAdd, indexRemove, resolveStructure, validate } from "./validate";

const terrain = generateTerrain({ seed: "d2-validate", columns: 60, rows: 52 });
const ctx = () => ({ terrain, authored: emptyAuthored(), index: createTrackIndex() });

describe("construction validator", () => {
  it("runs one rule per family in the fixed order", () => {
    expect(RULES.map(([family]) => family)).toEqual([...RULE_ORDER]);
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
    for (const code of REASON_CODES) expect(code).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("resolves auto to ground until D4 infers structures", () => {
    expect(resolveStructure("auto")).toBe("ground");
    expect(resolveStructure("bridge")).toBe("bridge");
    expect(() => resolveStructure("viaduct" as "ground")).toThrow(TypeError);
  });

  it("rejects a curve whose nodes are on the map but whose centreline leaves it", () => {
    const bounds = terrainBoundsM(terrain);
    let found: PieceSpec | undefined;
    for (let row = 0; row < terrain.rows && !found; row++) {
      for (const col of [terrain.columns - 1, terrain.columns - 2, terrain.columns - 3]) {
        const n = nodeOfOffset(col, row);
        for (const t of CURVE_TEMPLATES) {
          const spec: PieceSpec = { kind: "curve", from: { q: n.q, r: n.r, zMm: 0 }, heading: t.heading, turn: t.turn, radiusM: t.radiusM, variant: t.variant, z1Mm: 0 };
          const res = resolvePiece(spec);
          if (!res.ok) continue;
          const [a, b] = res.piece.ends;
          if (!offsetOfNode(terrain, a.node) || !offsetOfNode(terrain, b.node)) continue;
          if (res.piece.boundsM.maxX > bounds.maxX + 0.01) {
            found = spec;
            break;
          }
        }
        if (found) break;
      }
    }
    if (!found) throw new Error("no bulging curve found near the east edge");
    const verdict = validate(ctx(), { kind: "build", specs: [found], structure: "ground" });
    expect(!verdict.ok && verdict.reason.code).toBe("out-of-bounds");
  });

  it("accepts an empty build and an empty demolish as no-ops", () => {
    expect(validate(ctx(), { kind: "build", specs: [], structure: "ground" })).toMatchObject({ ok: true, counts: { new: 0, reused: 0 } });
    expect(validate(ctx(), { kind: "demolish", keys: [] })).toMatchObject({ ok: true, diff: { added: [], removed: [] } });
  });

  it("indexes the committed node heights per lattice position, ascending, as pieces come and go", () => {
    const straight = (q: number, z0Mm: number, z1Mm: number) => {
      const res = resolvePiece({ kind: "straight", from: { q, r: 10, zMm: z0Mm }, heading: 0, z1Mm });
      if (!res.ok) throw new Error(res.failure.message);
      return res.piece;
    };
    const low = straight(10, 0, 100);
    const next = straight(11, 100, 200);
    const high = straight(11, 7000, 7000);
    const index = createTrackIndex([high, low, next]);
    expect(heightsAt(index, 11, 10)).toEqual([100, 7000]);
    expect(heightsAt(index, 10, 10)).toEqual([0]);
    expect(heightsAt(index, 13, 10)).toEqual([]);
    // (11, 10, 100) stays while `next` still ends there.
    indexRemove(index, low);
    expect(heightsAt(index, 11, 10)).toEqual([100, 7000]);
    expect(heightsAt(index, 10, 10)).toEqual([]);
    indexRemove(index, next);
    expect(heightsAt(index, 11, 10)).toEqual([7000]);
    indexAdd(index, low);
    expect(heightsAt(index, 11, 10)).toEqual([100, 7000]);
    expect(index.heights).toEqual(createTrackIndex([low, high]).heights);
  });
});

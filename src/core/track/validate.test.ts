import { describe, expect, it } from "vitest";
import { type PieceSpec, resolvePiece } from "../geometry/piece";
import { CURVE_TEMPLATES } from "../geometry/templates";
import { generateTerrain, nodeOfOffset, offsetOfNode, terrainBoundsM } from "../terrain";
import { emptyAuthored } from "./authored";
import { REASON_CODES, RULES, RULE_ORDER, createTrackIndex, resolveStructure, validate } from "./validate";

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
});

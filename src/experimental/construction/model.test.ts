import { describe, expect, it } from "vitest";
import {
  ConstructionModel,
  LIMITS,
  sampleCurve,
  snapPoint,
  type Result,
  type Point,
  type Counts,
} from "./model";
const p = (x: number, y: number, z = 0): Point => ({ x, y, z });
const counts: Counts = { forward: 2, backward: 1 };
function success(result: Result) {
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result;
}
function draw(m: ConstructionModel, start: Point, end: Point, lanes = counts) {
  return success(m.execute({ type: "draw", start, end, lanes }))
    .affectedRoadIds[0];
}
function fixture() {
  const model = new ConstructionModel();
  const a = draw(model, p(-200, 0), p(0, 0));
  const b = draw(model, p(400, 400), p(400, 600));
  return {
    model,
    a,
    b,
    command: {
      type: "connect" as const,
      from: { roadId: a, end: "end" as const },
      to: { roadId: b, end: "start" as const },
      lanes: counts,
    },
  };
}
describe("bounded construction model", () => {
  it("snaps, authors directional lanes and previews without allocation or mutation", () => {
    const m = new ConstructionModel(),
      empty = m.snapshot();
    const command = {
      type: "draw" as const,
      start: p(1, 4),
      end: p(101, -3),
      lanes: { forward: 3, backward: 0 },
    };
    const preview = success(m.preview(command));
    expect(m.snapshot()).toBe(empty);
    const committed = success(m.execute(command));
    expect(committed).toEqual(preview);
    expect(committed.snapshot.geometry[0].centerline[0]).toEqual(p(0, 0));
    expect(
      committed.snapshot.authored.roads[0].lanes.map((l) => l.direction),
    ).toEqual(["forward", "forward", "forward"]);
    expect(committed.snapshot.geometry[0]).toMatchObject({
      width: 10.5,
      leftWidth: 0,
      rightWidth: 10.5,
    });
    expect(Object.isFrozen(committed.snapshot.authored.roads[0].lanes[0])).toBe(
      true,
    );
  });
  it("fits smooth curve and continuous directional lanes between approaches", () => {
    const { model, command } = fixture();
    const result = success(model.execute(command)),
      curve = result.snapshot.geometry[2];
    expect(curve.controls[0]).toEqual(p(0, 0));
    expect(curve.controls[3]).toEqual(p(400, 400));
    expect(curve.controls[1].y).toBe(0);
    expect(curve.controls[2].x).toBe(400);
    expect(sampleCurve(curve.controls, 0.5).x).toBeGreaterThan(200);
    expect(result.snapshot.movements).toHaveLength(6);
    for (const movement of result.snapshot.movements)
      expect(movement.points[0]).toEqual(movement.points[1]);
    const ids = result.snapshot.authored.roads.map((r) => [
      r.id,
      r.lanes.map((l) => l.id),
    ]);
    success(
      model.execute({
        type: "reshape",
        roadId: result.snapshot.authored.roads[0].id,
        start: p(-300, 0),
        end: p(0, 0),
      }),
    );
    expect(
      model
        .snapshot()
        .authored.roads.map((r) => [r.id, r.lanes.map((l) => l.id)]),
    ).toEqual(ids);
    expect(model.snapshot().geometry[2]).toEqual(curve);
  });
  it("regenerates deterministically and undo restores exact allocation and derived state", () => {
    const { model, command } = fixture(),
      before = model.snapshot();
    const first = success(model.execute(command));
    success(model.undo());
    expect(model.snapshot()).toBe(before);
    expect(success(model.execute(command))).toEqual(first);
    success(model.undo());
    success(model.undo());
    success(model.undo());
    expect(model.snapshot().authored).toEqual({
      nextId: 1,
      roads: [],
      overrides: [],
    });
    expect(model.undo().ok).toBe(false);
  });
  it("rejects impossible curves and dependent reshapes atomically with reasons", () => {
    const { model, a, command } = fixture();
    success(model.execute(command));
    const before = model.snapshot();
    expect(
      model.execute({
        type: "reshape",
        roadId: a,
        start: p(200, 0),
        end: p(0, 0),
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "curve-direction" }] });
    expect(model.snapshot()).toBe(before);
    const tight = new ConstructionModel();
    const x = draw(tight, p(-100, 0), p(0, 0)),
      y = draw(tight, p(20, 20), p(20, 100));
    const state = tight.snapshot();
    expect(
      tight.execute({
        type: "connect",
        from: { roadId: x, end: "end" },
        to: { roadId: y, end: "start" },
        lanes: counts,
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "curvature" }] });
    expect(tight.snapshot()).toBe(state);
  });
  it("allows elevated crossing without movements and rejects surface conflicts", () => {
    const m = new ConstructionModel();
    draw(m, p(-100, 0), p(100, 0));
    const before = m.snapshot();
    for (const z of [0, 4]) {
      expect(
        m.execute({
          type: "draw",
          start: p(0, -100, z),
          end: p(0, 100, z),
          lanes: counts,
        }),
      ).toMatchObject({ ok: false, reasons: [{ code: "clearance" }] });
      expect(m.snapshot()).toBe(before);
    }
    const bridge = draw(m, p(0, -100, 6), p(0, 100, 6));
    expect(m.snapshot().movements).toEqual([]);
    success(m.execute({ type: "remove", roadId: bridge }));
    expect(m.snapshot().geometry).toEqual(before.geometry);
    expect(m.snapshot().lanePaths).toEqual(before.lanePaths);
  });
  it("removes dependent curves, leaves unrelated roads and supports exact undo", () => {
    const { model, a, b, command } = fixture();
    const connection = success(model.execute(command)).affectedRoadIds[0];
    const unrelated = draw(model, p(-100, -300), p(100, -300));
    const before = model.snapshot();
    expect(
      success(model.execute({ type: "remove", roadId: a })).affectedRoadIds,
    ).toEqual([a, connection]);
    expect(model.snapshot().authored.roads.map((r) => r.id)).toEqual([
      b,
      unrelated,
    ]);
    expect(model.snapshot().movements).toEqual([]);
    success(model.undo());
    expect(model.snapshot()).toBe(before);
  });
  it("validates coordinates, snapped length, angle, width, slope and elevation", () => {
    const m = new ConstructionModel();
    for (const [start, end, lanes, code] of [
      [p(NaN, 0), p(100, 0), counts, "coordinate"],
      [p(0, 0), p(1, 0), counts, "length"],
      [p(0, 0), p(100, 30), counts, "angle"],
      [p(0, 0), p(100, 0), { forward: 5, backward: 1 }, "lanes"],
      [p(0, 0), p(100, 0, 20), counts, "slope"],
      [p(0, 0), p(100, 0, 31), counts, "bounds"],
    ] as const) {
      expect(m.execute({ type: "draw", start, end, lanes })).toMatchObject({
        ok: false,
        reasons: [{ code }],
      });
      expect(m.snapshot().authored.nextId).toBe(1);
    }
    expect(snapPoint(p(5, -5, 0.5))).toEqual(p(10, -0, 1));
  });
  it("handles straight snapped joins but rejects angled endpoint joins and overlaps", () => {
    const m = new ConstructionModel();
    draw(m, p(-100, 0), p(0, 0));
    draw(m, p(1, 0), p(100, 0));
    expect(m.snapshot().movements).toHaveLength(3);
    expect(
      m.execute({
        type: "draw",
        start: p(100, 0),
        end: p(100, 100),
        lanes: counts,
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "join-direction" }] });
    expect(
      m.execute({
        type: "draw",
        start: p(-50, 0),
        end: p(50, 0),
        lanes: counts,
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "clearance" }] });
  });
  it("includes asymmetric widths in clearance checks", () => {
    const m = new ConstructionModel();
    draw(m, p(-100, 0), p(100, 0), { forward: 4, backward: 0 });
    expect(
      m.execute({
        type: "draw",
        start: p(-100, -10),
        end: p(100, -10),
        lanes: { forward: 1, backward: 0 },
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "clearance" }] });
  });
  it("checks a graded collinear connector across its full width, including vertical bow", () => {
    const m = new ConstructionModel();
    const a = draw(m, p(-200, 0, -10), p(0, 0)),
      b = draw(m, p(400, 0), p(600, 0, -10));
    success(
      m.execute({
        type: "connect",
        from: { roadId: a, end: "end" },
        to: { roadId: b, end: "start" },
        lanes: counts,
      }),
    );
    const curve = m.snapshot().geometry[2];
    expect(sampleCurve(curve.controls, 0.5).z).toBeCloseTo(5);
    const before = m.snapshot();
    expect(
      m.execute({
        type: "draw",
        start: p(200, -100),
        end: p(200, 100),
        lanes: counts,
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "clearance" }] });
    expect(m.snapshot()).toBe(before);
    draw(m, p(200, -100, -1), p(200, 100, -1));
    expect(m.snapshot().movements).toHaveLength(6);
  });
  it("connects reversed approach orientation and does not add wrong-way movements", () => {
    const m = new ConstructionModel();
    const a = draw(m, p(0, 0), p(-200, 0), { forward: 1, backward: 2 });
    const b = draw(m, p(400, 600), p(400, 400), { forward: 1, backward: 2 });
    success(
      m.execute({
        type: "connect",
        from: { roadId: a, end: "start" },
        to: { roadId: b, end: "end" },
        lanes: counts,
      }),
    );
    expect(m.snapshot().movements).toHaveLength(6);
    for (const move of m.snapshot().movements)
      expect(move.points[0]).toEqual(move.points[1]);
  });
  it("gives a practical 90 degree gap boundary for the default width", () => {
    for (const [gap, valid] of [
      [120, false],
      [130, true],
    ] as const) {
      const m = new ConstructionModel();
      const a = draw(m, p(-100, 0), p(0, 0)),
        b = draw(m, p(gap, gap), p(gap, gap + 100));
      const result = m.execute({
        type: "connect",
        from: { roadId: a, end: "end" },
        to: { roadId: b, end: "start" },
        lanes: counts,
      });
      expect(result.ok).toBe(valid);
      if (!result.ok) expect(result.reasons[0].code).toBe("curvature");
    }
  });
  it("bounds continuous curvature and grade in accepted geometry", () => {
    const { model, command } = fixture();
    success(model.execute(command));
    for (const g of model.snapshot().geometry) {
      const h = 0.0001;
      for (let i = 1; i < 1000; i++) {
        const t = i / 1000,
          a = sampleCurve(g.controls, t - h),
          b = sampleCurve(g.controls, t),
          c = sampleCurve(g.controls, t + h);
        const dx = (c.x - a.x) / (2 * h),
          dy = (c.y - a.y) / (2 * h),
          dz = (c.z - a.z) / (2 * h);
        const ddx = (c.x - 2 * b.x + a.x) / (h * h),
          ddy = (c.y - 2 * b.y + a.y) / (h * h);
        expect(
          Math.abs(dx * ddy - dy * ddx) / Math.hypot(dx, dy) ** 3,
        ).toBeLessThanOrEqual(
          1 / (LIMITS.minRadius + Math.max(g.leftWidth, g.rightWidth)) + 1e-6,
        );
        expect(Math.abs(dz) / Math.hypot(dx, dy)).toBeLessThanOrEqual(
          LIMITS.maxSlope,
        );
      }
    }
  });
});

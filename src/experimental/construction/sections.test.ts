import { describe, expect, it } from "vitest";
import { ConstructionModel, type Result, type Snapshot } from "./model";
const p = (x: number, y = 0, z = 0) => ({ x, y, z });
function ok(r: Result) {
  if (!r.ok) throw Error(JSON.stringify(r.reasons));
  return r;
}
function setup() {
  const m = new ConstructionModel();
  const a = ok(
    m.execute({
      type: "draw",
      start: p(-500),
      end: p(0),
      lanes: { forward: 2, backward: 1 },
    }),
  ).affectedRoadIds[0];
  const b = ok(
    m.execute({
      type: "draw",
      start: p(400, 400),
      end: p(400, 700),
      lanes: { forward: 2, backward: 1 },
    }),
  ).affectedRoadIds[0];
  ok(
    m.execute({
      type: "connect",
      from: { roadId: a, end: "end" },
      to: { roadId: b, end: "start" },
      lanes: { forward: 2, backward: 1 },
    }),
  );
  return { m, a, b };
}
const widening = (roadId: string, start = 0.3, end = 0.6) => ({
  type: "section" as const,
  roadId,
  start,
  end,
  lanes: { forward: 3, backward: 1 },
});
describe("local sections and explicit lane targets", () => {
  it("widens only a bounded stretch, retaining unrelated state and identities", () => {
    const { m, a } = setup(),
      before = m.snapshot();
    const command = widening(a);
    const preview = ok(m.preview(command));
    expect(m.snapshot()).toBe(before);
    const after = ok(m.execute(command)).snapshot;
    expect(after).toEqual(preview.snapshot);
    expect(after.authored.roads.slice(1)).toEqual(
      before.authored.roads.slice(1),
    );
    expect(after.geometry.slice(1)).toEqual(before.geometry.slice(1));
    expect(after.authored.roads[0].lanes).toEqual(
      before.authored.roads[0].lanes,
    );
    expect(after.geometry[0].edges[0]).toEqual(before.geometry[0].edges[0]);
    expect(after.geometry[0].edges.at(-1)).toEqual(
      before.geometry[0].edges.at(-1),
    );
    expect(after.geometry[0].edges[30]).not.toEqual(
      before.geometry[0].edges[30],
    );
    expect(after.authored.roads[0].sections[0]).toMatchObject({
      start: 0.3,
      end: 0.6,
      taperStart: 0.3 - 0.07,
      taperEnd: 0.6 + 0.07,
    });
    expect(Object.isFrozen(after.authored.roads[0].sections[0].lanes)).toBe(
      true,
    );
    expect(ok(m.undo()).snapshot).toEqual(before);
  });
  it("rejects insufficient space, overlap, narrowing, and shortened tapers atomically", () => {
    const { m, a } = setup();
    let before = m.snapshot();
    for (const c of [
      widening(a, 0.02, 0.9),
      widening(a, 0.6, 0.3),
      { ...widening(a), lanes: { forward: 1, backward: 1 } },
    ]) {
      expect(m.execute(c).ok).toBe(false);
      expect(m.snapshot()).toBe(before);
    }
    ok(m.execute(widening(a)));
    before = m.snapshot();
    expect(m.execute(widening(a, 0.4, 0.7)).ok).toBe(false);
    expect(
      m.execute({ type: "reshape", roadId: a, start: p(-200), end: p(0) }).ok,
    ).toBe(false);
    expect(m.snapshot()).toBe(before);
  });
  it("exposes taper attachment parameters and paths, with add/remove targets and exact undo", () => {
    const { m, a } = setup();
    const states: Snapshot[] = [m.snapshot()];
    ok(m.execute(widening(a)));
    states.push(m.snapshot());
    const extra = m.snapshot().authored.roads[0].sections[0].lanes[0];
    const movement = m
      .snapshot()
      .candidates.find((c) => c.fromLaneId === extra.id)!;
    expect(movement.fromT).toBe(0.6);
    expect(movement.toT).toBeCloseTo(0.67);
    expect(movement.points).toHaveLength(17);
    expect(movement.points[0]).not.toEqual(movement.points.at(-1));
    ok(m.execute({ type: "assign", fromLaneId: extra.id, toLaneIds: [] }));
    states.push(m.snapshot());
    expect(m.snapshot().movements.some((c) => c.fromLaneId === extra.id)).toBe(
      false,
    );
    ok(
      m.execute({
        type: "assign",
        fromLaneId: extra.id,
        toLaneIds: [movement.toLaneId],
      }),
    );
    expect(m.snapshot().movements).toContainEqual(movement);
    for (const expected of states.reverse())
      expect(ok(m.undo()).snapshot).toEqual(expected);
  });
  it("preserves explicit targets through unrelated edits and rejects invalidation until cleared", () => {
    const { m, a, b } = setup();
    ok(m.execute(widening(a)));
    const section = m.snapshot().authored.roads[0].sections[0],
      extra = section.lanes[0];
    const target = m
      .snapshot()
      .candidates.find((c) => c.fromLaneId === extra.id)!.toLaneId;
    ok(
      m.execute({ type: "assign", fromLaneId: extra.id, toLaneIds: [target] }),
    );
    const override = m.snapshot().authored.overrides;
    ok(m.execute(widening(b, 0.3, 0.6)));
    expect(m.snapshot().authored.overrides).toEqual(override);
    let before = m.snapshot();
    for (const c of [
      { type: "remove-section" as const, roadId: a, sectionId: section.id },
      { type: "remove" as const, roadId: a },
      { type: "assign" as const, fromLaneId: extra.id, toLaneIds: ["absent"] },
    ]) {
      const r = m.execute(c);
      expect(r.ok).toBe(false);
      expect(m.snapshot()).toBe(before);
    }
    ok(m.execute({ type: "assign", fromLaneId: extra.id, toLaneIds: null }));
    ok(m.execute({ type: "remove-section", roadId: a, sectionId: section.id }));
    expect(m.snapshot().authored.roads[0].sections).toHaveLength(0);
  });
  it("keeps separate sections independent without summing disjoint width", () => {
    const m = new ConstructionModel();
    const a = ok(
      m.execute({
        type: "draw",
        start: p(0),
        end: p(1000),
        lanes: { forward: 2, backward: 1 },
      }),
    ).affectedRoadIds[0];
    ok(m.execute(widening(a, 0.15, 0.3)));
    const first = m.snapshot().authored.roads[0].sections[0];
    ok(m.execute(widening(a, 0.65, 0.8)));
    expect(m.snapshot().authored.roads[0].sections[0]).toEqual(first);
    expect(m.snapshot().geometry[0].rightWidth).toBe(10.5);
    expect(m.snapshot().geometry[0].width).toBe(14);
  });
  it("undoes the complete sequence to the empty immutable site", () => {
    const m = new ConstructionModel(),
      history: Snapshot[] = [];
    const run = (c: Parameters<typeof m.execute>[0]) => {
      history.push(m.snapshot());
      return ok(m.execute(c));
    };
    const a = run({
      type: "draw",
      start: p(-500),
      end: p(0),
      lanes: { forward: 2, backward: 1 },
    }).affectedRoadIds[0];
    const b = run({
      type: "draw",
      start: p(400, 400),
      end: p(400, 700),
      lanes: { forward: 2, backward: 1 },
    }).affectedRoadIds[0];
    run({
      type: "connect",
      from: { roadId: a, end: "end" },
      to: { roadId: b, end: "start" },
      lanes: { forward: 2, backward: 1 },
    });
    run(widening(a));
    const extra = m.snapshot().authored.roads[0].sections[0].lanes[0];
    run({ type: "assign", fromLaneId: extra.id, toLaneIds: [] });
    expect(m.execute(widening(a, 0.01, 0.99)).ok).toBe(false);
    for (const state of history.reverse())
      expect(ok(m.undo()).snapshot).toEqual(state);
    expect(m.snapshot().authored.roads).toEqual([]);
  });
});

describe("bounded alternative lane transitions", () => {
  it("changes the outgoing target using a smooth bounded span and preserves unrelated assignments", () => {
    const { m, a } = setup();
    ok(m.execute(widening(a)));
    const road = m.snapshot().authored.roads[0];
    const extra = road.sections[0].lanes[0];
    const inner = road.lanes.find(
      (l) => l.direction === "forward" && l.index === 0,
    )!;
    const unrelated = m
      .snapshot()
      .movements.find((c) => c.fromLaneId !== extra.id)!;
    ok(
      m.execute({
        type: "assign",
        fromLaneId: unrelated.fromLaneId,
        toLaneIds: [unrelated.toLaneId],
      }),
    );
    const before = m.snapshot();
    const alternative = before.candidates.find(
      (c) => c.fromLaneId === extra.id && c.toLaneId === inner.id,
    )!;
    expect(alternative.points).toHaveLength(33);
    expect(alternative.fromT).toBe(0.3);
    expect(alternative.toT).toBeCloseTo(0.67);
    expect(alternative.points[0]).toEqual(p(-350, -8.75));
    expect(alternative.points.at(-1)!.x).toBeCloseTo(-165);
    expect(alternative.points.at(-1)!.y).toBeCloseTo(-1.75);
    for (let i = 1; i < alternative.points.length; i++) {
      const p0 = alternative.points[i - 1],
        p1 = alternative.points[i];
      expect(p1.x).toBeGreaterThan(p0.x);
      expect(Math.abs((p1.y - p0.y) / (p1.x - p0.x))).toBeLessThanOrEqual(0.1);
      expect(p1.y).toBeGreaterThanOrEqual(-10.5);
      expect(p1.y).toBeLessThanOrEqual(0);
    }
    // Smoothstep has horizontal analytic endpoint tangents; sampled endpoint slopes converge to zero.
    expect(
      Math.abs(alternative.points[1].y - alternative.points[0].y),
    ).toBeLessThan(0.03);
    const command = {
      type: "assign" as const,
      fromLaneId: extra.id,
      toLaneIds: [inner.id],
    };
    const preview = ok(m.preview(command));
    expect(m.snapshot()).toBe(before);
    const after = ok(m.execute(command)).snapshot;
    expect(after).toEqual(preview.snapshot);
    expect(after.movements.filter((c) => c.fromLaneId === extra.id)).toEqual([
      alternative,
    ]);
    expect(after.authored.overrides[0]).toEqual(before.authored.overrides[0]);
    expect(after.geometry).toEqual(before.geometry);
    expect(ok(m.undo()).snapshot).toEqual(before);
  });
  it("rejects a target without sufficient transition space and restores no history or IDs", () => {
    const { m, a } = setup();
    ok(m.execute(widening(a, 0.4, 0.42)));
    const before = m.snapshot(),
      road = before.authored.roads[0],
      extra = road.sections[0].lanes[0];
    const inner = road.lanes.find(
      (l) => l.direction === "forward" && l.index === 0,
    )!;
    expect(
      before.candidates.some(
        (c) => c.fromLaneId === extra.id && c.toLaneId === inner.id,
      ),
    ).toBe(false);
    expect(
      m.execute({ type: "assign", fromLaneId: extra.id, toLaneIds: [inner.id] })
        .ok,
    ).toBe(false);
    expect(m.snapshot()).toBe(before);
    expect(ok(m.undo()).snapshot.authored.roads[0].sections).toEqual([]);
  });
  it("derives reverse-direction interior attachments with matching endpoint geometry", () => {
    const m = new ConstructionModel();
    const a = ok(
      m.execute({
        type: "draw",
        start: p(0),
        end: p(500),
        lanes: { forward: 1, backward: 2 },
      }),
    ).affectedRoadIds[0];
    ok(
      m.execute({
        type: "section",
        roadId: a,
        start: 0.3,
        end: 0.6,
        lanes: { forward: 1, backward: 3 },
      }),
    );
    const s = m.snapshot(),
      r = s.authored.roads[0],
      extra = r.sections[0].lanes[0],
      inner = r.lanes.find((l) => l.direction === "backward" && l.index === 0)!;
    const c = s.candidates.find(
      (c) => c.fromLaneId === extra.id && c.toLaneId === inner.id,
    )!;
    expect(c.fromT).toBe(0.6);
    expect(c.toT).toBeCloseTo(0.23);
    expect(c.points[0].x).toBeCloseTo(300);
    expect(c.points[0].y).toBe(8.75);
    expect(c.points.at(-1)!.x).toBeCloseTo(115);
    expect(c.points.at(-1)!.y).toBe(1.75);
    expect(s.lanePaths.find((p) => p.laneId === extra.id)).toMatchObject({
      startT: 0.6 + 0.07,
      endT: 0.3 - 0.07,
    });
  });
});

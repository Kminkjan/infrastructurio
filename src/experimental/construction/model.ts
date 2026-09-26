/** Isolated M4 construction experiment. Metres; XY plan, Z elevation. No legacy imports. */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type End = "start" | "end";
export interface Endpoint {
  readonly roadId: string;
  readonly end: End;
}
export interface Lane {
  readonly id: string;
  readonly direction: "forward" | "backward";
  readonly index: number;
}
export interface Counts {
  readonly forward: number;
  readonly backward: number;
}
export interface Section {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly taperStart: number;
  readonly taperEnd: number;
  readonly lanes: readonly Lane[];
}
export interface Override {
  readonly fromLaneId: string;
  readonly toLaneIds: readonly string[];
}
interface BaseRoad {
  readonly sections: readonly Section[];
  readonly id: string;
  readonly lanes: readonly Lane[];
}
export interface StraightRoad extends BaseRoad {
  readonly kind: "straight";
  readonly start: Point;
  readonly end: Point;
}
export interface ConnectionRoad extends BaseRoad {
  readonly kind: "connection";
  readonly from: Endpoint;
  readonly to: Endpoint;
}
export type Road = StraightRoad | ConnectionRoad;
export interface Authored {
  readonly overrides: readonly Override[];
  readonly nextId: number;
  readonly roads: readonly Road[];
}
export interface LanePath {
  /** Road parameters for first and last point, in travel order. */
  readonly startT: number;
  readonly endT: number;
  readonly laneId: string;
  readonly roadId: string;
  readonly points: readonly Point[];
}
export interface Geometry {
  readonly roadId: string;
  readonly controls: readonly Point[];
  readonly centerline: readonly Point[];
  readonly edges: readonly { left: Point; right: Point }[];
  readonly width: number;
  readonly leftWidth: number;
  readonly rightWidth: number;
}
export interface Movement {
  readonly id: string;
  /** Attachment parameters along each road start → end, independent of travel direction. */
  readonly fromT: number;
  readonly toT: number;
  readonly fromLaneId: string;
  readonly toLaneId: string;
  readonly points: readonly Point[];
}
export interface Snapshot {
  readonly authored: Authored;
  readonly geometry: readonly Geometry[];
  readonly lanePaths: readonly LanePath[];
  readonly candidates: readonly Movement[];
  readonly movements: readonly Movement[];
}
export type Command =
  | {
      readonly type: "section";
      readonly roadId: string;
      readonly start: number;
      readonly end: number;
      readonly lanes: Counts;
    }
  | {
      readonly type: "remove-section";
      readonly roadId: string;
      readonly sectionId: string;
    }
  | {
      readonly type: "assign";
      readonly fromLaneId: string;
      readonly toLaneIds: readonly string[] | null;
    }
  | {
      readonly type: "draw";
      readonly start: Point;
      readonly end: Point;
      readonly lanes: Counts;
    }
  | {
      readonly type: "connect";
      readonly from: Endpoint;
      readonly to: Endpoint;
      readonly lanes: Counts;
    }
  | {
      readonly type: "reshape";
      readonly roadId: string;
      readonly start: Point;
      readonly end: Point;
    }
  | { readonly type: "remove"; readonly roadId: string };
export interface Reason {
  readonly code: string;
  readonly message: string;
  readonly roadIds: readonly string[];
}
export type Result =
  | {
      readonly ok: true;
      readonly snapshot: Snapshot;
      readonly affectedRoadIds: readonly string[];
    }
  | { readonly ok: false; readonly reasons: readonly Reason[] };
export const LIMITS = Object.freeze({
  grid: 10,
  elevationStep: 1,
  maxCoordinate: 2000,
  maxElevation: 30,
  minLength: 20,
  maxLength: 1000,
  maxLanesPerDirection: 4,
  laneWidth: 3.5,
  minRadius: 20,
  maxSlope: 0.1,
  clearance: 5,
  maxRoads: 32,
  samples: 64,
  taperRatio: 10,
});
const EPS = 1e-7;
const sub = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const add = (a: Point, b: Point): Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
const scale = (a: Point, s: number): Point => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});
const length = (a: Point) => Math.hypot(a.x, a.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const lerp = (a: Point, b: Point, t: number) => add(a, scale(sub(b, a), t));
const same = (a: Point, b: Point) =>
  length(sub(a, b)) < EPS && Math.abs(a.z - b.z) < EPS;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
class Invalid extends Error {
  constructor(readonly reason: Reason) {
    super(reason.message);
  }
}
function reject(code: string, message: string, ...roadIds: string[]): never {
  throw new Invalid({ code, message, roadIds });
}
export function snapPoint(p: Point): Point {
  if (![p.x, p.y, p.z].every(Number.isFinite))
    reject("coordinate", "Use finite coordinates.");
  const snapped = {
    x: Math.round(p.x / LIMITS.grid) * LIMITS.grid,
    y: Math.round(p.y / LIMITS.grid) * LIMITS.grid,
    z: Math.round(p.z / LIMITS.elevationStep) * LIMITS.elevationStep,
  };
  if (
    Math.abs(snapped.x) > LIMITS.maxCoordinate ||
    Math.abs(snapped.y) > LIMITS.maxCoordinate ||
    Math.abs(snapped.z) > LIMITS.maxElevation
  )
    reject("bounds", "Keep XY within ±2000 m and elevation within ±30 m.");
  return freeze(snapped);
}
function makeLanes(counts: Counts, allocate: () => string): Lane[] {
  if (
    ![counts.forward, counts.backward].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= LIMITS.maxLanesPerDirection,
    ) ||
    counts.forward + counts.backward === 0
  )
    reject(
      "lanes",
      "Choose 0–4 lanes per direction and at least one lane in total.",
    );
  return (["forward", "backward"] as const).flatMap((direction) =>
    Array.from({ length: counts[direction] }, (_, index) => ({
      id: allocate(),
      direction,
      index,
    })),
  );
}
function endpoint(
  roads: readonly Road[],
  ref: Endpoint,
): { point: Point; outward: Point } {
  const road = roads.find((r) => r.id === ref.roadId);
  if (!road || road.kind !== "straight" || !["start", "end"].includes(ref.end))
    reject(
      "approach",
      "Select a start or end of a straight approach road.",
      ref.roadId,
    );
  const vector = sub(road.end, road.start);
  const unit = scale(vector, 1 / length(vector));
  return {
    point: road[ref.end],
    outward: scale(unit, ref.end === "end" ? 1 : -1),
  };
}
function controls(road: Road, roads: readonly Road[]): Point[] {
  if (road.kind === "straight")
    return [
      road.start,
      lerp(road.start, road.end, 1 / 3),
      lerp(road.start, road.end, 2 / 3),
      road.end,
    ];
  if (road.from.roadId === road.to.roadId)
    reject("approach", "Connect two different approach roads.", road.id);
  const a = endpoint(roads, road.from),
    b = endpoint(roads, road.to);
  const handle = length(sub(b.point, a.point)) / 3;
  return [
    a.point,
    add(a.point, scale(a.outward, handle)),
    add(b.point, scale(b.outward, handle)),
    b.point,
  ];
}
export function sampleCurve(c: readonly Point[], t: number): Point {
  return lerp(
    lerp(lerp(c[0], c[1], t), lerp(c[1], c[2], t), t),
    lerp(lerp(c[1], c[2], t), lerp(c[2], c[3], t), t),
    t,
  );
}
function derivative(c: readonly Point[], t: number): Point {
  return scale(
    lerp(
      lerp(sub(c[1], c[0]), sub(c[2], c[1]), t),
      lerp(sub(c[2], c[1]), sub(c[3], c[2]), t),
      t,
    ),
    3,
  );
}
function validateCurve(c: readonly Point[], width: number, id: string): number {
  const chord = sub(c[3], c[0]),
    distance = length(chord);
  if (distance < LIMITS.minLength || distance > LIMITS.maxLength)
    reject("length", "Separate endpoints by 20–1000 m.", id);
  const axis = scale(chord, 1 / distance);
  const velocities = [0, 1, 2].map((i) => scale(sub(c[i + 1], c[i]), 3));
  const minSpeed = Math.min(...velocities.map((v) => dot(v, axis)));
  if (minSpeed < EPS)
    reject(
      "curve-direction",
      "Move approaches so both point into the gap; reversing or looping curves are unsupported.",
      id,
    );
  const accelerations = [
    scale(sub(velocities[1], velocities[0]), 2),
    scale(sub(velocities[2], velocities[1]), 2),
  ];
  // Bezier derivatives are convex combinations of these vectors: conservative continuous bounds.
  const curvature =
    Math.max(
      ...velocities.flatMap((v) =>
        accelerations.map((a) => Math.abs(cross(v, a))),
      ),
    ) /
    minSpeed ** 3;
  if (curvature > 1 / (LIMITS.minRadius + width / 2))
    reject(
      "curvature",
      "Increase the connection space or reduce width; conservative inner radius must be at least 20 m.",
      id,
    );
  if (
    Math.max(...velocities.map((v) => Math.abs(v.z))) / minSpeed >
    LIMITS.maxSlope + EPS
  )
    reject(
      "slope",
      "Lengthen the approach or reduce elevation change to keep slope at most 10%.",
      id,
    );
  if (
    c.some(
      (p) =>
        Math.abs(p.z) > LIMITS.maxElevation ||
        Math.abs(p.x) > LIMITS.maxCoordinate ||
        Math.abs(p.y) > LIMITS.maxCoordinate,
    )
  )
    reject(
      "bounds",
      "Curve controls exceed the experimental site or elevation bounds.",
      id,
    );
  return (
    Math.max(...accelerations.map((a) => Math.hypot(a.x, a.y, a.z))) /
    (8 * LIMITS.samples ** 2)
  );
}
// Closest XY points on two line segments, including parallel overlap.
function closest(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): { distance: number; a: Point; b: Point } {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(c, a),
    den = cross(u, v);
  if (Math.abs(den) > EPS) {
    const s = cross(w, v) / den,
      t = cross(w, u) / den;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
      return { distance: 0, a: lerp(a, b, s), b: lerp(c, d, t) };
  }
  const project = (p: Point, x: Point, y: Point) =>
    lerp(
      x,
      y,
      Math.max(
        0,
        Math.min(1, dot(sub(p, x), sub(y, x)) / dot(sub(y, x), sub(y, x))),
      ),
    );
  return [
    { a, b: project(a, c, d) },
    { a: b, b: project(b, c, d) },
    { a: project(c, a, b), b: c },
    { a: project(d, a, b), b: d },
  ]
    .map((pair) => ({ ...pair, distance: length(sub(pair.a, pair.b)) }))
    .sort((x, y) => x.distance - y.distance)[0];
}
function allLanes(road: Road): readonly Lane[] {
  return [...road.lanes, ...road.sections.flatMap((s) => s.lanes)];
}
function sectionWeight(s: Section, t: number): number {
  if (t < s.taperStart || t > s.taperEnd) return 0;
  if (t < s.start) return (t - s.taperStart) / (s.start - s.taperStart);
  if (t > s.end) return (s.taperEnd - t) / (s.taperEnd - s.end);
  return 1;
}
function offsetPoint(c: readonly Point[], t: number, offset: number): Point {
  const p = sampleCurve(c, t),
    tangent = derivative(c, t);
  return {
    ...p,
    x: p.x - (tangent.y / length(tangent)) * offset,
    y: p.y + (tangent.x / length(tangent)) * offset,
  };
}
function derive(authored: Authored): Snapshot {
  const errors = new Map<string, number>();
  const geometry = authored.roads.map((road) => {
    const c = controls(road, authored.roads),
      width =
        (road.lanes.length +
          Math.max(0, ...road.sections.map((s) => s.lanes.length))) *
        LIMITS.laneWidth;
    const leftWidth =
      (road.lanes.filter((l) => l.direction === "backward").length +
        Math.max(
          0,
          ...road.sections.map(
            (s) => s.lanes.filter((l) => l.direction === "backward").length,
          ),
        )) *
      LIMITS.laneWidth;
    const rightWidth =
      (road.lanes.filter((l) => l.direction === "forward").length +
        Math.max(
          0,
          ...road.sections.map(
            (s) => s.lanes.filter((l) => l.direction === "forward").length,
          ),
        )) *
      LIMITS.laneWidth;
    errors.set(
      road.id,
      validateCurve(c, 2 * Math.max(leftWidth, rightWidth), road.id),
    );
    return {
      roadId: road.id,
      edges: Array.from({ length: LIMITS.samples + 1 }, (_, i) => {
        const t = i / LIMITS.samples;
        const widthAt = (direction: Lane["direction"]) =>
          LIMITS.laneWidth *
          (road.lanes.filter((l) => l.direction === direction).length +
            road.sections.reduce(
              (n, s) =>
                n +
                s.lanes.filter((l) => l.direction === direction).length *
                  sectionWeight(s, t),
              0,
            ));
        return {
          left: offsetPoint(c, t, widthAt("backward")),
          right: offsetPoint(c, t, -widthAt("forward")),
        };
      }),
      controls: c,
      width,
      leftWidth,
      rightWidth,
      centerline: Array.from({ length: LIMITS.samples + 1 }, (_, i) =>
        sampleCurve(c, i / LIMITS.samples),
      ),
    };
  });
  for (let i = 0; i < geometry.length; i++)
    for (let j = i + 1; j < geometry.length; j++) {
      const a = geometry[i],
        b = geometry[j];
      const joins = [a.controls[0], a.controls[3]].filter(
        (p) => same(p, b.controls[0]) || same(p, b.controls[3]),
      );
      for (const join of joins) {
        const ta = derivative(a.controls, same(join, a.controls[0]) ? 0 : 1),
          tb = derivative(b.controls, same(join, b.controls[0]) ? 0 : 1);
        const oa = scale(ta, same(join, a.controls[0]) ? 1 : -1),
          ob = scale(tb, same(join, b.controls[0]) ? 1 : -1);
        if (
          dot(oa, ob) / (length(oa) * length(ob)) > -1 + EPS ||
          Math.abs(oa.z / length(oa) + ob.z / length(ob)) > EPS
        )
          reject(
            "join-direction",
            "Joined endpoints must align smoothly in plan and elevation; leave a gap for an automatic curve.",
            a.roadId,
            b.roadId,
          );
      }
      const radius =
        Math.max(a.leftWidth, a.rightWidth) +
        Math.max(b.leftWidth, b.rightWidth) +
        (errors.get(a.roadId) ?? 0) +
        (errors.get(b.roadId) ?? 0);
      for (let ai = 0; ai < LIMITS.samples; ai++)
        for (let bi = 0; bi < LIMITS.samples; bi++) {
          const p = a.centerline[ai],
            q = a.centerline[ai + 1],
            r = b.centerline[bi],
            s = b.centerline[bi + 1];
          const near = closest(p, q, r, s);
          if (near.distance >= radius) continue;
          // Smooth shared endpoint road surfaces intentionally meet within one width.
          if (
            joins.some(
              (join) =>
                length(sub(near.a, join)) <= radius &&
                length(sub(near.b, join)) <= radius,
            )
          )
            continue;
          // Use full segment height intervals, not only centerline crossing height.
          const verticalGap = Math.max(
            Math.min(p.z, q.z) - Math.max(r.z, s.z),
            Math.min(r.z, s.z) - Math.max(p.z, q.z),
          );
          if (
            verticalGap <
            LIMITS.clearance +
              2 * Math.max(errors.get(a.roadId) ?? 0, errors.get(b.roadId) ?? 0)
          )
            reject(
              "clearance",
              "Separate road surfaces by at least 5 m vertically, move them apart, or join aligned endpoints. Interior junctions are unsupported.",
              a.roadId,
              b.roadId,
            );
        }
    }
  const lanePaths: LanePath[] = authored.roads.flatMap((road, ri) =>
    allLanes(road).map((lane) => {
      const section = road.sections.find((s) =>
        s.lanes.some((l) => l.id === lane.id),
      );
      const points = Array.from({ length: LIMITS.samples + 1 }, (_, i) => {
        const t = section
          ? section.taperStart +
            ((section.taperEnd - section.taperStart) * i) / LIMITS.samples
          : i / LIMITS.samples;
        const p = sampleCurve(geometry[ri].controls, t);
        const tangent = derivative(geometry[ri].controls, t);
        const offset =
          (section
            ? Math.max(
                0,
                road.lanes.filter((l) => l.direction === lane.direction)
                  .length - 0.5,
              ) +
              (lane.index +
                0.5 -
                Math.max(
                  0,
                  road.lanes.filter((l) => l.direction === lane.direction)
                    .length - 0.5,
                )) *
                sectionWeight(section, t)
            : lane.index + 0.5) *
          LIMITS.laneWidth *
          (lane.direction === "forward" ? -1 : 1);
        return {
          ...p,
          x: p.x - (tangent.y / length(tangent)) * offset,
          y: p.y + (tangent.x / length(tangent)) * offset,
        };
      });
      return {
        startT:
          lane.direction === "forward"
            ? (section?.taperStart ?? 0)
            : (section?.taperEnd ?? 1),
        endT:
          lane.direction === "forward"
            ? (section?.taperEnd ?? 1)
            : (section?.taperStart ?? 0),
        laneId: lane.id,
        roadId: road.id,
        points: lane.direction === "forward" ? points : points.reverse(),
      };
    }),
  );
  const movements: Movement[] = [];
  for (const from of lanePaths)
    for (const to of lanePaths) {
      if (from.roadId === to.roadId) continue;
      const fr = authored.roads.find((r) => r.id === from.roadId)!,
        tr = authored.roads.find((r) => r.id === to.roadId)!;
      const fl = allLanes(fr).find((l) => l.id === from.laneId)!,
        tl = allLanes(tr).find((l) => l.id === to.laneId)!;
      const fg = geometry.find((g) => g.roadId === fr.id)!,
        tg = geometry.find((g) => g.roadId === tr.id)!;
      if (
        fl.index === tl.index &&
        same(
          fg.controls[fl.direction === "forward" ? 3 : 0],
          tg.controls[tl.direction === "forward" ? 0 : 3],
        )
      ) {
        // Only spatially continuous lane endpoints get defaults. No implicit lateral jump.
        if (same(from.points.at(-1)!, to.points[0]))
          movements.push({
            id: `${fl.id}>${tl.id}`,
            fromT: fl.direction === "forward" ? 1 : 0,
            toT: tl.direction === "forward" ? 0 : 1,
            fromLaneId: fl.id,
            toLaneId: tl.id,
            points: [from.points.at(-1)!, to.points[0]],
          });
      }
    }
  const candidates = [...movements];
  // Local added lanes merge into the outer continuing lane at explicit taper boundaries.
  for (const road of authored.roads)
    for (const section of road.sections)
      for (const lane of section.lanes) {
        const base = road.lanes
          .filter((l) => l.direction === lane.direction)
          .at(-1)!;
        const forward = lane.direction === "forward";
        const g = geometry.find((g) => g.roadId === road.id)!;
        const travelStart = forward ? section.taperStart : section.taperEnd;
        const plateauStart = forward ? section.start : section.end;
        const plateauEnd = forward ? section.end : section.start;
        const travelEnd = forward ? section.taperEnd : section.taperStart;
        for (const [from, to, fromT, toT] of [
          [base.id, lane.id, travelStart, plateauStart],
          [lane.id, base.id, plateauEnd, travelEnd],
        ] as const) {
          const points = Array.from({ length: 17 }, (_, i) => {
            const t = fromT + ((toT - fromT) * i) / 16;
            const offset =
              (base.index +
                0.5 +
                (lane.index - base.index) * sectionWeight(section, t)) *
              LIMITS.laneWidth *
              (forward ? -1 : 1);
            return offsetPoint(g.controls, t, offset);
          });
          const movement = {
            id: `${from}>${to}`,
            fromLaneId: from,
            toLaneId: to,
            fromT,
            toT,
            points,
          };
          candidates.push(movement);
          movements.push(movement);
        }
      }
  // A section lane may choose an inner continuing lane over its available
  // plateau plus exit taper. Smoothstep lateral displacement has max derivative
  // 1.5, so reserve 15 m longitudinal distance per metre of lateral movement.
  for (const road of authored.roads)
    for (const section of road.sections)
      for (const lane of section.lanes) {
        const g = geometry.find((g) => g.roadId === road.id)!;
        for (const target of road.lanes.filter(
          (l) => l.direction === lane.direction,
        )) {
          const id = `${lane.id}>${target.id}`;
          if (candidates.some((m) => m.id === id)) continue;
          const forward = lane.direction === "forward";
          const fromT = forward ? section.start : section.end;
          const toT = forward ? section.taperEnd : section.taperStart;
          const distance = length(
            sub(sampleCurve(g.controls, fromT), sampleCurve(g.controls, toT)),
          );
          const lateral = (lane.index - target.index) * LIMITS.laneWidth;
          if (distance + EPS < 1.5 * LIMITS.taperRatio * lateral) continue;
          const points = Array.from({ length: 33 }, (_, i) => {
            const u = i / 32,
              blend = u * u * (3 - 2 * u),
              t = fromT + (toT - fromT) * u;
            const offset =
              ((lane.index + 0.5) * (1 - blend) +
                (target.index + 0.5) * blend) *
              LIMITS.laneWidth *
              (forward ? -1 : 1);
            return offsetPoint(g.controls, t, offset);
          });
          candidates.push({
            id,
            fromLaneId: lane.id,
            toLaneId: target.id,
            fromT,
            toT,
            points,
          });
        }
      }
  // Cross-road choices are restricted to spatially continuous defaults. A lateral
  // jump at a zero-length throat is not a legal movement in this bounded proof.
  for (const override of authored.overrides) {
    if (
      !lanePaths.some((p) => p.laneId === override.fromLaneId) ||
      override.toLaneIds.some(
        (to) =>
          !candidates.some(
            (m) => m.fromLaneId === override.fromLaneId && m.toLaneId === to,
          ),
      )
    )
      reject(
        "assignment-invalidated",
        `Edit invalidates explicit lanes ${override.fromLaneId} → ${override.toLaneIds.join(", ")}. Remove that assignment first, or provide more section space for its transition.`,
      );
  }
  const legal = movements.filter(
    (m) => !authored.overrides.some((o) => o.fromLaneId === m.fromLaneId),
  );
  for (const override of authored.overrides)
    for (const to of override.toLaneIds)
      legal.push(
        candidates.find(
          (m) => m.fromLaneId === override.fromLaneId && m.toLaneId === to,
        )!,
      );
  return freeze({
    authored,
    geometry,
    lanePaths,
    candidates,
    movements: legal,
  });
}
function apply(
  before: Authored,
  command: Command,
): { authored: Authored; affectedRoadIds: string[] } {
  let nextId = before.nextId;
  const allocate = () => `authored-${nextId++}`;
  let roads = [...before.roads];
  let overrides = [...before.overrides];
  const affectedRoadIds: string[] = [];
  if (command.type === "assign") {
    if (
      !roads.some((r) => allLanes(r).some((l) => l.id === command.fromLaneId))
    )
      reject("missing-lane", "Select an existing incoming lane.");
    overrides = overrides.filter((o) => o.fromLaneId !== command.fromLaneId);
    if (command.toLaneIds !== null)
      overrides.push({
        fromLaneId: command.fromLaneId,
        toLaneIds: [...new Set(command.toLaneIds)],
      });
  } else if (command.type === "draw" || command.type === "connect") {
    if (roads.length >= LIMITS.maxRoads)
      reject("capacity", "The experimental site supports at most 32 roads.");
    const id = allocate(),
      lanes = makeLanes(command.lanes, allocate);
    if (command.type === "draw") {
      const start = snapPoint(command.start),
        end = snapPoint(command.end),
        v = sub(end, start);
      if (
        Math.abs(v.x) > EPS &&
        Math.abs(v.y) > EPS &&
        Math.abs(Math.abs(v.x) - Math.abs(v.y)) > EPS
      )
        reject(
          "angle",
          "Use horizontal, vertical or 45° diagonal straight approaches.",
        );
      roads.push({ id, kind: "straight", start, end, lanes, sections: [] });
    } else
      roads.push({
        id,
        kind: "connection",
        sections: [],
        from: { ...command.from },
        to: { ...command.to },
        lanes,
      });
    affectedRoadIds.push(id);
  } else {
    const road = roads.find((r) => r.id === command.roadId);
    if (!road)
      reject(
        "missing-road",
        "Select an existing authored road.",
        command.roadId,
      );
    if (command.type === "section") {
      if (road.kind !== "straight")
        reject(
          "section-kind",
          "Select a straight approach for local widening.",
          road.id,
        );
      const desired = makeLanes(command.lanes, () => "unused");
      const baseCount = (direction: Lane["direction"]) =>
        road.lanes.filter((l) => l.direction === direction).length;
      if (
        ["forward", "backward"].some(
          (d) =>
            command.lanes[d as keyof Counts] <
            baseCount(d as Lane["direction"]),
        )
      )
        reject(
          "section-narrow",
          "This experiment supports widening; remove a section to restore its original width.",
          road.id,
        );
      const added = desired
        .filter((l) => l.index >= baseCount(l.direction))
        .map((l) => ({ ...l, id: allocate() }));
      if (!added.length || added.some((l) => baseCount(l.direction) === 0))
        reject(
          "section-lanes",
          "Add lanes to an existing travel direction.",
          road.id,
        );
      const distance = length(sub(road.end, road.start));
      const taper =
        (Math.max(
          ...["forward", "backward"].map(
            (d) => added.filter((l) => l.direction === d).length,
          ),
        ) *
          LIMITS.laneWidth *
          LIMITS.taperRatio) /
        distance;
      const { start, end } = command;
      if (
        ![start, end].every(Number.isFinite) ||
        start >= end ||
        start - taper < 0 ||
        end + taper > 1
      )
        reject(
          "taper-space",
          `Leave ${Math.round(taper * distance)} m of taper space before and after the selected plateau.`,
          road.id,
        );
      if (
        road.sections.some(
          (s) => start - taper < s.taperEnd && end + taper > s.taperStart,
        )
      )
        reject(
          "section-overlap",
          "Tapers overlap another section; choose a separate stretch.",
          road.id,
        );
      const section = {
        id: allocate(),
        start,
        end,
        taperStart: start - taper,
        taperEnd: end + taper,
        lanes: added,
      };
      roads = roads.map((r) =>
        r.id === road.id ? { ...r, sections: [...r.sections, section] } : r,
      );
      affectedRoadIds.push(road.id);
    } else if (command.type === "remove-section") {
      if (!road.sections.some((s) => s.id === command.sectionId))
        reject("missing-section", "Select an existing section.", road.id);
      roads = roads.map((r) =>
        r.id === road.id
          ? {
              ...r,
              sections: r.sections.filter((s) => s.id !== command.sectionId),
            }
          : r,
      );
      affectedRoadIds.push(road.id);
    } else if (command.type === "remove") {
      const removed = roads.filter(
        (r) =>
          r.id === road.id ||
          (r.kind === "connection" &&
            (r.from.roadId === road.id || r.to.roadId === road.id)),
      );
      affectedRoadIds.push(...removed.map((r) => r.id));
      roads = roads.filter((r) => !affectedRoadIds.includes(r.id));
    } else {
      if (road.kind !== "straight")
        reject(
          "reshape",
          "Reshape a connection by editing its straight approaches.",
          road.id,
        );
      const start = snapPoint(command.start),
        end = snapPoint(command.end),
        v = sub(end, start);
      if (
        Math.abs(v.x) > EPS &&
        Math.abs(v.y) > EPS &&
        Math.abs(Math.abs(v.x) - Math.abs(v.y)) > EPS
      )
        reject("angle", "Use 45° increments for approaches.", road.id);
      if (
        road.sections.some(
          (s) =>
            Math.min(s.start - s.taperStart, s.taperEnd - s.end) * length(v) +
              EPS <
            Math.max(
              ...["forward", "backward"].map(
                (d) => s.lanes.filter((l) => l.direction === d).length,
              ),
            ) *
              LIMITS.laneWidth *
              LIMITS.taperRatio,
        )
      )
        reject(
          "taper-space",
          "Reshape leaves insufficient taper length. Lengthen the road or remove its section.",
          road.id,
        );
      roads = roads.map((r) =>
        r.id === road.id ? { ...road, start, end } : r,
      );
      affectedRoadIds.push(
        road.id,
        ...roads
          .filter(
            (r) =>
              r.kind === "connection" &&
              (r.from.roadId === road.id || r.to.roadId === road.id),
          )
          .map((r) => r.id),
      );
    }
  }
  return { authored: { nextId, roads, overrides }, affectedRoadIds };
}
export class ConstructionModel {
  private current = derive({ nextId: 1, roads: [], overrides: [] });
  private history: Snapshot[] = [];
  snapshot(): Snapshot {
    return this.current;
  }
  preview(command: Command): Result {
    try {
      const candidate = apply(this.current.authored, command);
      return freeze({
        ok: true,
        snapshot: derive(candidate.authored),
        affectedRoadIds: candidate.affectedRoadIds,
      });
    } catch (error) {
      if (error instanceof Invalid)
        return freeze({ ok: false, reasons: [error.reason] });
      throw error;
    }
  }
  execute(command: Command): Result {
    const result = this.preview(command);
    if (result.ok) {
      this.history.push(this.current);
      this.current = result.snapshot;
    }
    return result;
  }
  undo(): Result {
    const previous = this.history.pop();
    if (!previous)
      return freeze({
        ok: false,
        reasons: [
          {
            code: "undo-empty",
            message: "There are no committed edits to undo.",
            roadIds: [],
          },
        ],
      });
    const affectedRoadIds = [
      ...new Set(
        [...this.current.authored.roads, ...previous.authored.roads].map(
          (r) => r.id,
        ),
      ),
    ];
    this.current = previous;
    return freeze({ ok: true, snapshot: previous, affectedRoadIds });
  }
}

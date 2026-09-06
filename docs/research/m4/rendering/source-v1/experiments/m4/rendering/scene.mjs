// Research geometry only: no road topology, traffic rules, saves or gameplay commands.
export const WIDTH = 960,
  HEIGHT = 600;
export const defaultControls = [
  [90, 370],
  [250, 80],
  [540, 520],
  [710, 320],
];
export const palette = {
  ground: 0x172a28,
  road: 0x536663,
  lane: 0xa6b8ae,
  turn: 0xebb65b,
  bridge: 0x889eac,
  car: 0xe3c779,
  selected: 0x76e6d2,
  handle: 0xff8a73,
};
export function bezier(points, t) {
  const u = 1 - t;
  return [0, 1].map(
    (i) =>
      u * u * u * points[0][i] +
      3 * u * u * t * points[1][i] +
      3 * u * t * t * points[2][i] +
      t * t * t * points[3][i],
  );
}
export function strip(points, width) {
  const side = (sign) =>
    points.map((p, i) => {
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(points.length - 1, i + 1)];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [
        p[0] - (sign * (b[1] - a[1]) * width) / 2 / length,
        p[1] + (sign * (b[0] - a[0]) * width) / 2 / length,
      ];
    });
  return [...side(1), ...side(-1).reverse()];
}
export function rectangle(x, y, w, h) {
  return [
    [x - w / 2, y - h / 2],
    [x + w / 2, y - h / 2],
    [x + w / 2, y + h / 2],
    [x - w / 2, y + h / 2],
  ];
}
export function contains(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x, y] = poly[i],
      [a, b] = poly[j];
    if (y > p[1] !== b > p[1] && p[0] < ((a - x) * (p[1] - y)) / (b - y) + x)
      inside = !inside;
  }
  return inside;
}
export function makeScene(state) {
  const shapes = [];
  const add = (id, points, z, color, kind = "road") =>
    shapes.push({ id, points, z, color, kind });
  add("ground", rectangle(400, 250, 800, 500), -2, palette.ground, "ground");
  if (state.stress) {
    for (let lane = 0; lane < 128; lane++) {
      const x = 27 + (lane % 8) * 95,
        y = 28 + Math.floor(lane / 8) * 29;
      add(`lane-${lane}`, rectangle(x + 38, y, 78, 9), 0, palette.road);
    }
    return shapes;
  }
  add("approach", rectangle(400, 250, 740, 32), 0, palette.road);
  add("through-lane", rectangle(400, 258, 740, 2), 0.2, palette.lane);
  const turn = Array.from({ length: 33 }, (_, i) =>
    bezier(
      [
        [200, 242],
        [270, 242],
        [300, 210],
        [300, 155],
      ],
      i / 32,
    ),
  );
  add("turn-lane", strip(turn, 7), 0.4, palette.turn);
  if (state.controls.length === 4) {
    const curve = Array.from({ length: 65 }, (_, i) =>
      bezier(state.controls, i / 64),
    );
    add("s-curve", strip(curve, 22), 0, palette.road);
    add("curve-divider", strip(curve, 1.5), 0.2, palette.lane);
  }
  if (!state.hideBridge) {
    // Real vertical supports and deck thickness in the 3D adapter.
    add(
      "bridge",
      rectangle(400, 250, 38, 440),
      state.bridgeZ,
      palette.bridge,
      "bridge",
    );
  }
  state.controls.forEach((p, i) =>
    add(`handle-${i}`, rectangle(...p, 11, 11), 1, palette.handle, "handle"),
  );
  return shapes;
}
export function vehicles(stress) {
  return Array.from({ length: stress ? 2144 : 12 }, (_, i) =>
    stress
      ? {
          id: `vehicle-${i}`,
          x: 27 + ((i % 128) % 8) * 95 + (Math.floor(i / 128) % 17) * 4.2,
          y: 28 + Math.floor((i % 128) / 8) * 29,
          z: 1,
        }
      : { id: `queue-${i}`, x: 400 - i * 12, y: 250, z: 1 },
  );
}

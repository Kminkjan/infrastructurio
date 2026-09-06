import { Application, Container, Graphics } from "pixi.js";
import { fitCamera } from "../../../src/rendering/map-camera.ts";
import { WIDTH, HEIGHT, contains, rectangle, palette } from "./scene.mjs";
export async function createView(host) {
  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(devicePixelRatio, 2),
    background: 0x10201e,
    preference: "webgl",
  });
  app.stop();
  host.append(app.canvas);
  const world = new Container();
  app.stage.addChild(world);
  const camera = fitCamera(
    { width: 800, height: 500 },
    { width: WIDTH, height: HEIGHT },
  );
  world.position.set(camera.x, camera.y);
  world.scale.set(camera.scale);
  let shapes = [],
    cars = [],
    carLayer = new Container(),
    objects = [];
  const graphic = (s) => new Graphics().poly(s.points.flat()).fill(s.color);
  function setScene(next, vehicles, selected) {
    world.removeChildren().forEach((c) => c.destroy({ children: true }));
    shapes = next;
    cars = vehicles;
    for (const s of shapes.filter(
      (s) => s.kind !== "bridge" && s.kind !== "handle",
    ))
      world.addChild(
        graphic({
          ...s,
          color: s.id === selected ? palette.selected : s.color,
        }),
      );
    carLayer = new Container();
    world.addChild(carLayer);
    objects = cars.map((c) => {
      const g = new Graphics()
        .rect(-4, -2, 8, 4)
        .fill(c.id === selected ? palette.selected : palette.car);
      g.position.set(c.x, c.y);
      carLayer.addChild(g);
      return g;
    });
    for (const s of shapes.filter(
      (s) => s.kind === "bridge" || s.kind === "handle",
    ))
      world.addChild(
        graphic({
          ...s,
          color: s.id === selected ? palette.selected : s.color,
        }),
      );
  }
  function project([x, y]) {
    return [camera.x + x * camera.scale, camera.y + y * camera.scale];
  }
  function unproject([x, y]) {
    return [(x - camera.x) / camera.scale, (y - camera.y) / camera.scale];
  }
  function pick(p) {
    const point = unproject(p);
    const overlay = shapes
      .filter((s) => s.kind === "bridge" || s.kind === "handle")
      .reverse()
      .find((s) => contains(s.points, point));
    if (overlay) return overlay.id;
    const car = cars.find((c) => contains(rectangle(c.x, c.y, 8, 4), point));
    if (car) return car.id;
    return (
      [...shapes]
        .reverse()
        .find((s) => s.kind !== "ground" && contains(s.points, point))?.id ??
      null
    );
  }
  return {
    canvas: app.canvas,
    setScene,
    project,
    unproject,
    pick,
    setCamera() {},
    render(time, stress) {
      if (stress)
        objects.forEach((g, i) => {
          g.x = cars[i].x + Math.sin(time / 1000) * 1.5;
        });
      app.renderer.render(app.stage);
    },
    info() {
      const gl = app.renderer.gl,
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        backend: "Pixi WebGL",
        gpu: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      };
    },
  };
}

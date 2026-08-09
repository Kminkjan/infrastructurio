import { Application, Graphics } from "pixi.js";
import type { SimulationSnapshot } from "../shared";

export interface WorldRenderer {
  update(snapshot: SimulationSnapshot): void;
  destroy(): void;
}

export async function createWorldRenderer(
  host: HTMLElement,
  initialSnapshot: SimulationSnapshot,
): Promise<WorldRenderer> {
  const application = new Application();
  await application.init({
    antialias: true,
    autoDensity: true,
    background: "#15241f",
    preference: "webgl",
    resizeTo: host,
    resolution: Math.min(window.devicePixelRatio, 2),
  });

  application.canvas.className = "world-canvas";
  application.canvas.setAttribute("aria-label", "PixiJS world view");
  host.append(application.canvas);

  const terrain = new Graphics()
    .roundRect(80, 70, 800, 480, 32)
    .fill({ color: 0x78966e })
    .moveTo(90, 360)
    .bezierCurveTo(300, 250, 560, 460, 870, 300)
    .stroke({ color: 0x77b8d1, width: 58 })
    .moveTo(150, 455)
    .bezierCurveTo(360, 390, 570, 270, 810, 185)
    .stroke({ color: 0x3b4540, width: 16 });

  const market = new Graphics()
    .rect(778, 147, 64, 64)
    .fill({ color: 0xd9b26f })
    .rect(792, 162, 10, 49)
    .fill({ color: 0x675343 });

  const quarry = new Graphics()
    .circle(150, 455, 38)
    .fill({ color: 0x616b65 })
    .circle(132, 443, 8)
    .fill({ color: 0xaab1aa });

  const vehicle = new Graphics()
    .roundRect(-12, -7, 24, 14, 4)
    .fill({ color: 0xffd166 });

  application.stage.addChild(terrain, market, quarry, vehicle);

  function update(snapshot: SimulationSnapshot): void {
    const progress = (snapshot.tick % 96) / 96;
    vehicle.position.set(150 + progress * 660, 455 - progress * 270);
  }

  update(initialSnapshot);

  return {
    update,
    destroy() {
      application.destroy({ removeView: true }, { children: true });
    },
  };
}

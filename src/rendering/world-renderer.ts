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

  let geographyLayer: Graphics | undefined;
  let renderedGeography: SimulationSnapshot["geography"] | undefined;

  function drawGeography(snapshot: SimulationSnapshot): void {
    if (renderedGeography === snapshot.geography) {
      return;
    }

    geographyLayer?.destroy();
    renderedGeography = snapshot.geography;

    const geography = snapshot.geography;
    const layer = new Graphics()
      .rect(0, 0, geography.bounds.width, geography.bounds.height)
      .fill({ color: 0x78966e });

    layer
      .poly(
        geography.fertileLand.boundary.flatMap(({ x, y }) => [x, y]),
      )
      .fill({ color: 0x9dae62 });

    const [riverStart, ...riverPoints] = geography.river.path;
    if (riverStart) {
      layer.moveTo(riverStart.x, riverStart.y);
      for (const riverPoint of riverPoints) {
        layer.lineTo(riverPoint.x, riverPoint.y);
      }
      layer.stroke({ color: 0x77b8d1, width: geography.river.width });
    }

    const crossing = geography.crossingArea;
    layer
      .roundRect(
        crossing.center.x - crossing.width / 2,
        crossing.center.y - crossing.height / 2,
        crossing.width,
        crossing.height,
        18,
      )
      .stroke({ color: 0xf3c969, width: 5, alpha: 0.9 });

    for (const settlement of geography.settlementSeeds) {
      layer
        .circle(settlement.position.x, settlement.position.y, 22)
        .fill({ color: 0xe7dec3 })
        .circle(settlement.position.x, settlement.position.y, 7)
        .fill({ color: 0x80684f });
    }

    const quarry = geography.quarry.position;
    layer
      .circle(quarry.x, quarry.y, 38)
      .fill({ color: 0x616b65 })
      .circle(quarry.x - 16, quarry.y - 12, 8)
      .fill({ color: 0xaab1aa });

    const market = geography.externalMarketConnection.position;
    layer
      .rect(market.x - 60, market.y - 32, 60, 64)
      .fill({ color: 0xd9b26f })
      .rect(market.x - 46, market.y - 18, 10, 50)
      .fill({ color: 0x675343 });

    geographyLayer = layer;
    application.stage.addChild(layer);
  }

  drawGeography(initialSnapshot);

  return {
    update: drawGeography,
    destroy() {
      application.destroy({ removeView: true }, { children: true });
    },
  };
}

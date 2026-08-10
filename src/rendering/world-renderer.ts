import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
} from "pixi.js";
import type { Point, SimulationSnapshot } from "../shared";
import {
  fitCamera,
  panCamera,
  resizeCamera,
  zoomCamera,
  type MapCamera,
  type ViewportSize,
} from "./map-camera";
import {
  getSelectableMapFeatures,
  toMapSelection,
  type MapSelection,
  type SelectableMapFeature,
} from "./map-features";

export interface WorldRenderer {
  update(snapshot: SimulationSnapshot): void;
  resetView(): void;
  zoomBy(factor: number): void;
  destroy(): void;
}

export interface WorldRendererOptions {
  readonly onSelectionChange?: (selection: MapSelection | undefined) => void;
}

function drawFeatureShape(
  graphics: Graphics,
  feature: SelectableMapFeature,
  outset = 0,
): Graphics {
  const geometry = feature.geometry;

  switch (geometry.type) {
    case "point":
      return graphics.circle(
        geometry.position.x,
        geometry.position.y,
        geometry.radius + outset,
      );
    case "rectangle":
      return graphics.roundRect(
        geometry.center.x - geometry.width / 2 - outset,
        geometry.center.y - geometry.height / 2 - outset,
        geometry.width + outset * 2,
        geometry.height + outset * 2,
        18 + outset,
      );
    case "polygon":
      return graphics.poly(
        geometry.boundary.flatMap(({ x, y }) => [x, y]),
      );
  }
}

export async function createWorldRenderer(
  host: HTMLElement,
  initialSnapshot: SimulationSnapshot,
  options: WorldRendererOptions = {},
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

  const canvas = application.canvas;
  canvas.className = "world-canvas";
  canvas.setAttribute(
    "aria-label",
    "Interactive map of Millford Valley. Drag to pan and use the mouse wheel to zoom.",
  );
  host.append(canvas);

  const world = new Container();
  application.stage.addChild(world);

  let renderedGeography: SimulationSnapshot["geography"] | undefined;
  let selectableFeatures: readonly SelectableMapFeature[] = [];
  let selectedFeatureId: string | undefined;
  let selectionLayer: Graphics | undefined;
  let mapBounds = initialSnapshot.geography.bounds;
  let viewport: ViewportSize = {
    width: application.renderer.screen.width,
    height: application.renderer.screen.height,
  };
  let camera: MapCamera = fitCamera(mapBounds, viewport);
  let pointerId: number | undefined;
  let lastPointer: Point | undefined;
  let dragDistance = 0;
  let suppressNextSelection = false;
  let selectionSuppressionTimer: number | undefined;

  function applyCamera(): void {
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
  }

  function drawSelection(): void {
    if (!selectionLayer) {
      return;
    }

    selectionLayer.clear();
    const selectedFeature = selectableFeatures.find(
      ({ id }) => id === selectedFeatureId,
    );
    if (!selectedFeature) {
      return;
    }

    drawFeatureShape(selectionLayer, selectedFeature, 8).stroke({
      color: 0xffffff,
      width: 5,
      alpha: 0.98,
    });
    drawFeatureShape(selectionLayer, selectedFeature, 14).stroke({
      color: 0xf3c969,
      width: 3,
      alpha: 0.92,
    });
  }

  function clearSelection(): void {
    if (selectedFeatureId === undefined) {
      return;
    }

    selectedFeatureId = undefined;
    drawSelection();
    options.onSelectionChange?.(undefined);
  }

  function handleFeatureSelection(
    feature: SelectableMapFeature,
    event: FederatedPointerEvent,
  ): void {
    event.stopPropagation();
    if (suppressNextSelection) {
      return;
    }

    selectedFeatureId = feature.id;
    drawSelection();
    options.onSelectionChange?.(toMapSelection(feature));
  }

  function drawGeography(snapshot: SimulationSnapshot): void {
    if (renderedGeography === snapshot.geography) {
      return;
    }

    world.removeChildren().forEach((child) => child.destroy({ children: true }));
    renderedGeography = snapshot.geography;
    mapBounds = snapshot.geography.bounds;
    selectableFeatures = getSelectableMapFeatures(snapshot.geography);

    const geography = snapshot.geography;
    const geographyLayer = new Graphics()
      .rect(0, 0, geography.bounds.width, geography.bounds.height)
      .fill({ color: 0x78966e });

    geographyLayer.eventMode = "static";
    geographyLayer.cursor = "grab";
    geographyLayer.on("pointertap", () => {
      if (!suppressNextSelection) {
        clearSelection();
      }
    });

    geographyLayer
      .poly(geography.fertileLand.boundary.flatMap(({ x, y }) => [x, y]))
      .fill({ color: 0x9dae62 });

    const [riverStart, ...riverPoints] = geography.river.path;
    if (riverStart) {
      geographyLayer.moveTo(riverStart.x, riverStart.y);
      for (const riverPoint of riverPoints) {
        geographyLayer.lineTo(riverPoint.x, riverPoint.y);
      }
      geographyLayer.stroke({ color: 0x77b8d1, width: geography.river.width });
    }

    const crossing = geography.crossingArea;
    geographyLayer
      .roundRect(
        crossing.center.x - crossing.width / 2,
        crossing.center.y - crossing.height / 2,
        crossing.width,
        crossing.height,
        18,
      )
      .stroke({ color: 0xf3c969, width: 5, alpha: 0.9 });

    for (const settlement of geography.settlementSeeds) {
      geographyLayer
        .circle(settlement.position.x, settlement.position.y, 22)
        .fill({ color: 0xe7dec3 })
        .circle(settlement.position.x, settlement.position.y, 7)
        .fill({ color: 0x80684f });
    }

    const quarry = geography.quarry.position;
    geographyLayer
      .circle(quarry.x, quarry.y, 38)
      .fill({ color: 0x616b65 })
      .circle(quarry.x - 16, quarry.y - 12, 8)
      .fill({ color: 0xaab1aa });

    const market = geography.externalMarketConnection.position;
    geographyLayer
      .rect(market.x - 60, market.y - 32, 60, 64)
      .fill({ color: 0xd9b26f })
      .rect(market.x - 46, market.y - 18, 10, 50)
      .fill({ color: 0x675343 });

    const hitTargetLayer = new Container();
    for (const feature of selectableFeatures) {
      const hitTarget = drawFeatureShape(new Graphics(), feature).fill({
        color: 0xffffff,
        alpha: 0.001,
      });
      hitTarget.eventMode = "static";
      hitTarget.cursor = "pointer";
      hitTarget.on("pointertap", (event) =>
        handleFeatureSelection(feature, event),
      );
      hitTargetLayer.addChild(hitTarget);
    }

    selectionLayer = new Graphics();
    selectionLayer.eventMode = "none";
    world.addChild(geographyLayer, hitTargetLayer, selectionLayer);

    if (!selectableFeatures.some(({ id }) => id === selectedFeatureId)) {
      const hadSelection = selectedFeatureId !== undefined;
      selectedFeatureId = undefined;
      if (hadSelection) {
        options.onSelectionChange?.(undefined);
      }
    }

    camera = fitCamera(mapBounds, viewport);
    applyCamera();
    drawSelection();
  }

  function positionInCanvas(event: PointerEvent | WheelEvent): Point {
    const rectangle = canvas.getBoundingClientRect();
    return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    lastPointer = positionInCanvas(event);
    dragDistance = 0;
    suppressNextSelection = false;
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId || !lastPointer) {
      return;
    }

    const pointer = positionInCanvas(event);
    const delta = {
      x: pointer.x - lastPointer.x,
      y: pointer.y - lastPointer.y,
    };
    dragDistance += Math.hypot(delta.x, delta.y);
    lastPointer = pointer;

    if (dragDistance < 4) {
      return;
    }

    suppressNextSelection = true;
    canvas.classList.add("is-dragging");
    camera = panCamera(camera, delta, mapBounds, viewport);
    applyCamera();
  }

  function finishPointer(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pointerId = undefined;
    lastPointer = undefined;
    canvas.classList.remove("is-dragging");

    window.clearTimeout(selectionSuppressionTimer);
    selectionSuppressionTimer = window.setTimeout(() => {
      suppressNextSelection = false;
    }, 0);
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const deltaMultiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? viewport.height
          : 1;
    const factor = Math.exp(-event.deltaY * deltaMultiplier * 0.0015);
    camera = zoomCamera(
      camera,
      factor,
      positionInCanvas(event),
      mapBounds,
      viewport,
    );
    applyCamera();
  }

  function handleResize(width: number, height: number): void {
    const nextViewport = { width, height };
    camera = resizeCamera(camera, mapBounds, viewport, nextViewport);
    viewport = nextViewport;
    applyCamera();
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  application.renderer.on("resize", handleResize);

  drawGeography(initialSnapshot);

  return {
    update: drawGeography,
    resetView() {
      camera = fitCamera(mapBounds, viewport);
      applyCamera();
    },
    zoomBy(factor) {
      camera = zoomCamera(
        camera,
        factor,
        { x: viewport.width / 2, y: viewport.height / 2 },
        mapBounds,
        viewport,
      );
      applyCamera();
    },
    destroy() {
      window.clearTimeout(selectionSuppressionTimer);
      application.renderer.off("resize", handleResize);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", finishPointer);
      canvas.removeEventListener("wheel", handleWheel);
      application.destroy({ removeView: true }, { children: true });
    },
  };
}

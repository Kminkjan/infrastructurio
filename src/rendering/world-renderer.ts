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
  getSelectableRoadFeatures,
  getRoadSnapAnchors,
  toMapSelection,
  type MapSelection,
  type SelectableMapFeature,
} from "./map-features";
import {
  createRepresentativeFreightTrafficPlan,
  sampleRepresentativeFreightVehicles,
  type RepresentativeFreightTrafficPlan,
} from "./representative-freight";

export type RoadTool = "inspect" | "build" | "remove";

export interface WorldRenderer {
  update(snapshot: SimulationSnapshot): void;
  resetView(): void;
  zoomBy(factor: number): void;
  setRoadTool(tool: RoadTool): void;
  destroy(): void;
}

export interface WorldRendererOptions {
  readonly onSelectionChange?: (selection: MapSelection | undefined) => void;
  readonly onBuildRoad?: (start: Point, end: Point) => void;
  readonly onRemoveRoad?: (roadSegmentId: string) => void;
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
    case "line":
      return graphics
        .moveTo(geometry.start.x, geometry.start.y)
        .lineTo(geometry.end.x, geometry.end.y);
  }
}

function destroyChildren(container: Container): void {
  container
    .removeChildren()
    .forEach((child) => child.destroy({ children: true }));
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
    "Interactive map of Millford Valley. Drag to pan, scroll to zoom, or choose a road tool.",
  );
  host.append(canvas);

  const world = new Container();
  const geographyLayer = new Container();
  const developmentLayer = new Container();
  const roadLayer = new Container();
  const representativeVehicleLayer = new Container();
  const geographyHitLayer = new Container();
  const roadHitLayer = new Container();
  const priorityGeographyHitLayer = new Container();
  const selectionLayer = new Graphics();
  const constructionPreviewLayer = new Graphics();
  selectionLayer.eventMode = "none";
  constructionPreviewLayer.eventMode = "none";
  representativeVehicleLayer.eventMode = "none";
  world.addChild(
    geographyLayer,
    developmentLayer,
    roadLayer,
    representativeVehicleLayer,
    geographyHitLayer,
    roadHitLayer,
    priorityGeographyHitLayer,
    selectionLayer,
    constructionPreviewLayer,
  );
  application.stage.addChild(world);

  let currentSnapshot = initialSnapshot;
  let renderedGeography: SimulationSnapshot["geography"] | undefined;
  let renderedDevelopment: SimulationSnapshot["development"] | undefined;
  let renderedRoadNetwork: SimulationSnapshot["roadNetwork"] | undefined;
  let geographyFeatures: readonly SelectableMapFeature[] = [];
  let roadFeatures: readonly SelectableMapFeature[] = [];
  let selectableFeatures: readonly SelectableMapFeature[] = [];
  let selectedFeatureId: string | undefined;
  let roadTool: RoadTool = "inspect";
  let mapBounds = initialSnapshot.geography.bounds;
  let viewport: ViewportSize = {
    width: application.renderer.screen.width,
    height: application.renderer.screen.height,
  };
  let camera: MapCamera = fitCamera(mapBounds, viewport);
  let pointerId: number | undefined;
  let lastPointer: Point | undefined;
  let dragDistance = 0;
  let constructionStart: Point | undefined;
  let constructionEnd: Point | undefined;
  let suppressNextSelection = false;
  let selectionSuppressionTimer: number | undefined;
  let representativeTrafficPlan: RepresentativeFreightTrafficPlan | undefined;
  let representativeTrafficElapsedSeconds = 0;
  const representativeVehicleGraphics = new Map<string, Graphics>();

  function applyCamera(): void {
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
  }

  function drawSelection(): void {
    selectionLayer.clear();
    const selectedFeature = selectableFeatures.find(
      ({ id }) => id === selectedFeatureId,
    );
    if (!selectedFeature) {
      return;
    }

    if (selectedFeature.geometry.type === "line") {
      drawFeatureShape(selectionLayer, selectedFeature).stroke({
        color: 0xffffff,
        width: 19,
        alpha: 0.98,
      });
      drawFeatureShape(selectionLayer, selectedFeature).stroke({
        color: 0xf3c969,
        width: 13,
        alpha: 0.96,
      });
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

  function refreshSelectableFeatures(): void {
    selectableFeatures = [...geographyFeatures, ...roadFeatures];
    if (!selectableFeatures.some(({ id }) => id === selectedFeatureId)) {
      const hadSelection = selectedFeatureId !== undefined;
      selectedFeatureId = undefined;
      if (hadSelection) {
        options.onSelectionChange?.(undefined);
      }
    }
    drawSelection();
  }

  function handleFeatureSelection(
    feature: SelectableMapFeature,
    event: FederatedPointerEvent,
  ): void {
    if (roadTool !== "inspect" || suppressNextSelection) {
      return;
    }

    event.stopPropagation();
    selectedFeatureId = feature.id;
    drawSelection();
    options.onSelectionChange?.(toMapSelection(feature));
  }

  function drawGeography(snapshot: SimulationSnapshot): void {
    if (renderedGeography === snapshot.geography) {
      return;
    }

    const isInitialDraw = renderedGeography === undefined;
    destroyChildren(geographyLayer);
    destroyChildren(geographyHitLayer);
    destroyChildren(priorityGeographyHitLayer);
    renderedGeography = snapshot.geography;
    mapBounds = snapshot.geography.bounds;
    geographyFeatures = getSelectableMapFeatures(snapshot.geography);

    const geography = snapshot.geography;
    const geographyGraphics = new Graphics()
      .rect(0, 0, geography.bounds.width, geography.bounds.height)
      .fill({ color: 0x78966e });
    geographyGraphics.eventMode = "static";
    geographyGraphics.cursor = "grab";
    geographyGraphics.on("pointertap", () => {
      if (roadTool === "inspect" && !suppressNextSelection) {
        clearSelection();
      }
    });

    geographyGraphics
      .poly(geography.fertileLand.boundary.flatMap(({ x, y }) => [x, y]))
      .fill({ color: 0x9dae62 });

    const [riverStart, ...riverPoints] = geography.river.path;
    if (riverStart) {
      geographyGraphics.moveTo(riverStart.x, riverStart.y);
      for (const riverPoint of riverPoints) {
        geographyGraphics.lineTo(riverPoint.x, riverPoint.y);
      }
      geographyGraphics.stroke({
        color: 0x77b8d1,
        width: geography.river.width,
      });
    }

    const crossing = geography.crossingArea;
    geographyGraphics
      .roundRect(
        crossing.center.x - crossing.width / 2,
        crossing.center.y - crossing.height / 2,
        crossing.width,
        crossing.height,
        18,
      )
      .stroke({ color: 0xf3c969, width: 5, alpha: 0.9 });

    for (const settlement of geography.settlementSeeds) {
      geographyGraphics
        .circle(settlement.position.x, settlement.position.y, 22)
        .fill({ color: 0xe7dec3 })
        .circle(settlement.position.x, settlement.position.y, 7)
        .fill({ color: 0x80684f });
    }

    const quarry = geography.quarry.position;
    geographyGraphics
      .circle(quarry.x, quarry.y, 38)
      .fill({ color: 0x616b65 })
      .circle(quarry.x - 16, quarry.y - 12, 8)
      .fill({ color: 0xaab1aa });

    const market = geography.externalMarketConnection.position;
    geographyGraphics
      .rect(market.x - 60, market.y - 32, 60, 64)
      .fill({ color: 0xd9b26f })
      .rect(market.x - 46, market.y - 18, 10, 50)
      .fill({ color: 0x675343 });
    geographyLayer.addChild(geographyGraphics);

    for (const feature of geographyFeatures) {
      const hitTarget = drawFeatureShape(new Graphics(), feature).fill({
        color: 0xffffff,
        alpha: 0.001,
      });
      hitTarget.eventMode = "static";
      hitTarget.cursor = "pointer";
      hitTarget.on("pointertap", (event) =>
        handleFeatureSelection(feature, event),
      );
      const hitLayer =
        feature.geometry.type === "polygon"
          ? geographyHitLayer
          : priorityGeographyHitLayer;
      hitLayer.addChild(hitTarget);
    }

    if (isInitialDraw) {
      camera = fitCamera(mapBounds, viewport);
      applyCamera();
    }
    refreshSelectableFeatures();
  }

  function drawRoads(snapshot: SimulationSnapshot): void {
    if (renderedRoadNetwork === snapshot.roadNetwork) {
      return;
    }

    destroyChildren(roadLayer);
    destroyChildren(roadHitLayer);
    renderedRoadNetwork = snapshot.roadNetwork;
    roadFeatures = getSelectableRoadFeatures(snapshot.roadNetwork);

    for (const feature of roadFeatures) {
      if (feature.geometry.type !== "line") {
        continue;
      }
      const { start, end } = feature.geometry;
      const visual = new Graphics()
        .moveTo(start.x, start.y)
        .lineTo(end.x, end.y)
        .stroke({ color: 0x4a463e, width: 13 })
        .moveTo(start.x, start.y)
        .lineTo(end.x, end.y)
        .stroke({ color: 0xd9caa4, width: 8 });
      roadLayer.addChild(visual);

      const hitTarget = drawFeatureShape(new Graphics(), feature).stroke({
        color: 0xffffff,
        width: 22,
        alpha: 0.001,
      });
      hitTarget.eventMode = "static";
      hitTarget.cursor = "pointer";
      hitTarget.on("pointertap", (event) => {
        if (roadTool === "remove") {
          event.stopPropagation();
          options.onRemoveRoad?.(feature.id);
          return;
        }
        handleFeatureSelection(feature, event);
      });
      roadHitLayer.addChild(hitTarget);
    }

    refreshSelectableFeatures();
  }

  function drawDevelopment(snapshot: SimulationSnapshot): void {
    if (renderedDevelopment === snapshot.development) {
      return;
    }

    destroyChildren(developmentLayer);
    renderedDevelopment = snapshot.development;
    for (const location of snapshot.development.locations) {
      const buildingCount = Math.ceil(location.growthPopulation / 10);
      for (let index = 0; index < buildingCount; index += 1) {
        const angle = index * 2.4;
        const radius = 34 + Math.floor(index / 4) * 15;
        const x = location.position.x + Math.cos(angle) * radius;
        const y = location.position.y + Math.sin(angle) * radius;
        developmentLayer.addChild(
          new Graphics()
            .roundRect(x - 7, y - 7, 14, 14, 2)
            .fill({ color: 0xe9d7a9 })
            .rect(x - 4, y - 4, 3, 3)
            .fill({ color: 0x6f7f72 })
            .rect(x + 1, y - 4, 3, 3)
            .fill({ color: 0x6f7f72 }),
        );
      }

      if (location.pendingConstruction) {
        const angle = buildingCount * 2.4;
        const radius = 34 + Math.floor(buildingCount / 4) * 15;
        const x = location.position.x + Math.cos(angle) * radius;
        const y = location.position.y + Math.sin(angle) * radius;
        developmentLayer.addChild(
          new Graphics()
            .roundRect(x - 8, y - 8, 16, 16, 2)
            .stroke({ color: 0xf3c969, width: 3, alpha: 0.95 }),
        );
      }
    }
  }

  function createRepresentativeVehicleGraphic(): Graphics {
    return new Graphics()
      .roundRect(-9, -5, 13, 10, 2)
      .fill({ color: 0xd65f3f })
      .roundRect(4, -4, 6, 8, 1)
      .fill({ color: 0xf0c56c })
      .rect(-6, -7, 4, 2)
      .fill({ color: 0x26302c })
      .rect(-6, 5, 4, 2)
      .fill({ color: 0x26302c })
      .rect(5, -6, 3, 2)
      .fill({ color: 0x26302c })
      .rect(5, 4, 3, 2)
      .fill({ color: 0x26302c });
  }

  function clearRepresentativeVehicles(): void {
    representativeVehicleGraphics.clear();
    destroyChildren(representativeVehicleLayer);
  }

  function updateRepresentativeTraffic(snapshot: SimulationSnapshot): void {
    const nextPlan = createRepresentativeFreightTrafficPlan(
      snapshot.quarryMarketFreight,
      snapshot.roadNetwork,
    );
    if (nextPlan?.key === representativeTrafficPlan?.key) {
      return;
    }

    representativeTrafficPlan = nextPlan;
    representativeTrafficElapsedSeconds = 0;
    clearRepresentativeVehicles();
  }

  function drawRepresentativeVehicles(): void {
    const samples = representativeTrafficPlan
      ? sampleRepresentativeFreightVehicles(
          representativeTrafficPlan,
          representativeTrafficElapsedSeconds,
        )
      : [];
    const activeIds = new Set(samples.map(({ id }) => id));

    for (const [id, graphic] of representativeVehicleGraphics) {
      if (activeIds.has(id)) {
        continue;
      }
      representativeVehicleGraphics.delete(id);
      representativeVehicleLayer.removeChild(graphic);
      graphic.destroy();
    }

    for (const sample of samples) {
      let graphic = representativeVehicleGraphics.get(sample.id);
      if (!graphic) {
        graphic = createRepresentativeVehicleGraphic();
        representativeVehicleGraphics.set(sample.id, graphic);
        representativeVehicleLayer.addChild(graphic);
      }
      graphic.position.set(sample.position.x, sample.position.y);
      graphic.rotation = sample.rotation;
    }
  }

  function drawConstructionPreview(): void {
    constructionPreviewLayer.clear();
    if (!constructionStart || !constructionEnd) {
      return;
    }

    constructionPreviewLayer
      .moveTo(constructionStart.x, constructionStart.y)
      .lineTo(constructionEnd.x, constructionEnd.y)
      .stroke({ color: 0x263c35, width: 15, alpha: 0.9 })
      .moveTo(constructionStart.x, constructionStart.y)
      .lineTo(constructionEnd.x, constructionEnd.y)
      .stroke({ color: 0xf3c969, width: 8, alpha: 0.95 })
      .circle(constructionStart.x, constructionStart.y, 8)
      .fill({ color: 0xffffff })
      .circle(constructionEnd.x, constructionEnd.y, 8)
      .fill({ color: 0xffffff });
  }

  function positionInCanvas(event: PointerEvent | WheelEvent): Point {
    const rectangle = canvas.getBoundingClientRect();
    return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
  }

  function positionInWorld(event: PointerEvent): Point {
    const position = positionInCanvas(event);
    return {
      x: (position.x - camera.x) / camera.scale,
      y: (position.y - camera.y) / camera.scale,
    };
  }

  function snapRoadPoint(position: Point): Point {
    const tolerance = 14 / camera.scale;
    let nearest = position;
    let nearestDistance = tolerance;

    for (const terminal of getRoadSnapAnchors(currentSnapshot.geography)) {
      const distance = Math.hypot(
        position.x - terminal.x,
        position.y - terminal.y,
      );
      if (distance <= nearestDistance) {
        nearest = terminal;
        nearestDistance = distance;
      }
    }

    for (const node of currentSnapshot.roadNetwork.nodes) {
      const distance = Math.hypot(
        position.x - node.position.x,
        position.y - node.position.y,
      );
      if (distance <= nearestDistance) {
        nearest = node.position;
        nearestDistance = distance;
      }
    }

    for (const segment of currentSnapshot.roadNetwork.segments) {
      const delta = {
        x: segment.end.x - segment.start.x,
        y: segment.end.y - segment.start.y,
      };
      const lengthSquared = delta.x * delta.x + delta.y * delta.y;
      const parameter = Math.min(
        1,
        Math.max(
          0,
          ((position.x - segment.start.x) * delta.x +
            (position.y - segment.start.y) * delta.y) /
            lengthSquared,
        ),
      );
      const projected = {
        x: segment.start.x + delta.x * parameter,
        y: segment.start.y + delta.y * parameter,
      };
      const distance = Math.hypot(
        position.x - projected.x,
        position.y - projected.y,
      );
      if (distance < nearestDistance) {
        nearest = projected;
        nearestDistance = distance;
      }
    }

    return nearest;
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

    if (roadTool === "build") {
      constructionStart = snapRoadPoint(positionInWorld(event));
      constructionEnd = constructionStart;
      suppressNextSelection = true;
      canvas.classList.add("is-building");
      drawConstructionPreview();
    }
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

    if (roadTool === "build") {
      constructionEnd = snapRoadPoint(positionInWorld(event));
      drawConstructionPreview();
      return;
    }
    if (dragDistance < 4) {
      return;
    }

    suppressNextSelection = true;
    canvas.classList.add("is-dragging");
    camera = panCamera(camera, delta, mapBounds, viewport);
    applyCamera();
  }

  function finishPointer(
    event: PointerEvent,
    completeConstruction: boolean,
  ): void {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (
      roadTool === "build" &&
      completeConstruction &&
      constructionStart &&
      constructionEnd &&
      Math.hypot(
        constructionEnd.x - constructionStart.x,
        constructionEnd.y - constructionStart.y,
      ) > 0.001
    ) {
      options.onBuildRoad?.(constructionStart, constructionEnd);
    }

    constructionStart = undefined;
    constructionEnd = undefined;
    drawConstructionPreview();
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pointerId = undefined;
    lastPointer = undefined;
    canvas.classList.remove("is-dragging", "is-building");

    window.clearTimeout(selectionSuppressionTimer);
    selectionSuppressionTimer = window.setTimeout(() => {
      suppressNextSelection = false;
    }, 0);
  }

  function handlePointerUp(event: PointerEvent): void {
    finishPointer(event, true);
  }

  function handlePointerCancel(event: PointerEvent): void {
    finishPointer(event, false);
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

  function setRoadTool(tool: RoadTool): void {
    roadTool = tool;
    constructionStart = undefined;
    constructionEnd = undefined;
    drawConstructionPreview();
    canvas.classList.toggle("road-tool-build", tool === "build");
    canvas.classList.toggle("road-tool-remove", tool === "remove");
    for (const child of roadHitLayer.children) {
      child.cursor = "pointer";
    }
  }

  function drawSnapshot(snapshot: SimulationSnapshot): void {
    currentSnapshot = snapshot;
    drawGeography(snapshot);
    drawDevelopment(snapshot);
    drawRoads(snapshot);
    updateRepresentativeTraffic(snapshot);
    drawRepresentativeVehicles();
  }

  function animateRepresentativeTraffic(): void {
    if (!representativeTrafficPlan) {
      return;
    }

    representativeTrafficElapsedSeconds += application.ticker.deltaMS / 1_000;
    drawRepresentativeVehicles();
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  application.renderer.on("resize", handleResize);
  application.ticker.add(animateRepresentativeTraffic);

  drawSnapshot(initialSnapshot);
  applyCamera();

  return {
    update: drawSnapshot,
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
    setRoadTool,
    destroy() {
      window.clearTimeout(selectionSuppressionTimer);
      application.ticker.remove(animateRepresentativeTraffic);
      application.renderer.off("resize", handleResize);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheel);
      application.destroy({ removeView: true }, { children: true });
    },
  };
}

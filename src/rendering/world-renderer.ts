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
  getSelectableRailFeatures,
  getSelectableRoadFeatures,
  getRailSnapAnchors,
  getRoadSnapAnchors,
  toMapSelection,
  type MapSelection,
  type SelectableMapFeature,
} from "./map-features";
import { getBottleneckOverlayFeatures } from "./bottleneck-overlay";
import {
  createRepresentativeFreightTrafficPlan,
  sampleRepresentativeFreightVehicles,
  type RepresentativeFreightTrafficPlan,
} from "./representative-freight";

export type RoadTool =
  | "inspect"
  | "build"
  | "remove"
  | "build-rail"
  | "remove-rail";

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
  readonly onBuildRoadPreview?: (
    start: Point | undefined,
    end: Point | undefined,
  ) => void;
  readonly onRemoveRoad?: (roadSegmentId: string) => void;
  readonly onBuildRailTrack?: (start: Point, end: Point) => void;
  readonly onBuildRailTrackPreview?: (
    start: Point | undefined,
    end: Point | undefined,
  ) => void;
  readonly onRemoveRailTrack?: (railTrackId: string) => void;
  readonly onRemoveRailTerminal?: (railTerminalId: string) => void;
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
    "Interactive map of Millford Valley. Drag to pan, scroll to zoom, or choose an infrastructure tool.",
  );
  host.append(canvas);

  const world = new Container();
  const geographyLayer = new Container();
  const industryLayer = new Container();
  const developmentLayer = new Container();
  const roadLayer = new Container();
  const railLayer = new Container();
  const analysisOverlayLayer = new Container();
  const representativeVehicleLayer = new Container();
  const geographyHitLayer = new Container();
  const roadHitLayer = new Container();
  const railHitLayer = new Container();
  const priorityGeographyHitLayer = new Container();
  const selectionLayer = new Graphics();
  const constructionPreviewLayer = new Graphics();
  selectionLayer.eventMode = "none";
  constructionPreviewLayer.eventMode = "none";
  representativeVehicleLayer.eventMode = "none";
  analysisOverlayLayer.eventMode = "none";
  world.addChild(
    geographyLayer,
    industryLayer,
    developmentLayer,
    roadLayer,
    railLayer,
    analysisOverlayLayer,
    representativeVehicleLayer,
    geographyHitLayer,
    roadHitLayer,
    priorityGeographyHitLayer,
    railHitLayer,
    selectionLayer,
    constructionPreviewLayer,
  );
  application.stage.addChild(world);

  let currentSnapshot = initialSnapshot;
  let renderedGeography: SimulationSnapshot["geography"] | undefined;
  let renderedSupplyChain: SimulationSnapshot["stoneSupplyChain"] | undefined;
  let renderedDevelopment: SimulationSnapshot["development"] | undefined;
  let renderedRoadNetwork: SimulationSnapshot["roadNetwork"] | undefined;
  let renderedRailNetwork: SimulationSnapshot["railNetwork"] | undefined;
  let renderedBottlenecks: SimulationSnapshot["bottlenecks"] | undefined;
  let geographyFeatures: readonly SelectableMapFeature[] = [];
  let roadFeatures: readonly SelectableMapFeature[] = [];
  let railFeatures: readonly SelectableMapFeature[] = [];
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
  let representativeTrafficPlans: readonly RepresentativeFreightTrafficPlan[] = [];
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
    selectableFeatures = [...geographyFeatures, ...roadFeatures, ...railFeatures];
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

  function drawRail(snapshot: SimulationSnapshot): void {
    if (renderedRailNetwork === snapshot.railNetwork) {
      return;
    }

    destroyChildren(railLayer);
    destroyChildren(railHitLayer);
    renderedRailNetwork = snapshot.railNetwork;
    railFeatures = getSelectableRailFeatures(snapshot.railNetwork);

    for (const track of snapshot.railNetwork.tracks) {
      const delta = { x: track.end.x - track.start.x, y: track.end.y - track.start.y };
      const length = Math.hypot(delta.x, delta.y);
      const normal = { x: -delta.y / length, y: delta.x / length };
      const visual = new Graphics()
        .moveTo(track.start.x, track.start.y)
        .lineTo(track.end.x, track.end.y)
        .stroke({ color: 0x283438, width: 15 })
        .moveTo(track.start.x + normal.x * 4, track.start.y + normal.y * 4)
        .lineTo(track.end.x + normal.x * 4, track.end.y + normal.y * 4)
        .stroke({ color: 0xb9ced2, width: 2.5 })
        .moveTo(track.start.x - normal.x * 4, track.start.y - normal.y * 4)
        .lineTo(track.end.x - normal.x * 4, track.end.y - normal.y * 4)
        .stroke({ color: 0xb9ced2, width: 2.5 });
      const tieCount = Math.floor(length / 14);
      for (let index = 1; index < tieCount; index += 1) {
        const parameter = index / tieCount;
        const x = track.start.x + delta.x * parameter;
        const y = track.start.y + delta.y * parameter;
        visual
          .moveTo(x - normal.x * 7, y - normal.y * 7)
          .lineTo(x + normal.x * 7, y + normal.y * 7)
          .stroke({ color: 0x806b55, width: 2 });
      }
      railLayer.addChild(visual);
    }

    for (const terminal of snapshot.railNetwork.terminals) {
      railLayer.addChild(
        new Graphics()
          .roundRect(terminal.position.x - 21, terminal.position.y - 15, 42, 30, 4)
          .fill({ color: 0x224f58 })
          .stroke({ color: 0x9de6e4, width: 4 })
          .moveTo(terminal.position.x - 15, terminal.position.y)
          .lineTo(terminal.position.x + 15, terminal.position.y)
          .stroke({ color: 0xe9f3ef, width: 3 }),
      );
    }

    for (const feature of railFeatures) {
      const hitTarget = feature.geometry.type === "line"
        ? drawFeatureShape(new Graphics(), feature).stroke({
            color: 0xffffff,
            width: 24,
            alpha: 0.001,
          })
        : drawFeatureShape(new Graphics(), feature).fill({
            color: 0xffffff,
            alpha: 0.001,
          });
      hitTarget.eventMode = "static";
      hitTarget.cursor = "pointer";
      hitTarget.on("pointertap", (event) => {
        if (roadTool === "remove-rail") {
          event.stopPropagation();
          if (feature.geometry.type === "line") {
            options.onRemoveRailTrack?.(feature.id);
          } else {
            options.onRemoveRailTerminal?.(feature.id);
          }
          return;
        }
        handleFeatureSelection(feature, event);
      });
      railHitLayer.addChild(hitTarget);
    }

    refreshSelectableFeatures();
  }

  function drawIndustry(snapshot: SimulationSnapshot): void {
    if (renderedSupplyChain === snapshot.stoneSupplyChain) {
      return;
    }
    destroyChildren(industryLayer);
    renderedSupplyChain = snapshot.stoneSupplyChain;
    const stoneworks = snapshot.geography.stoneworks.position;
    const state = snapshot.stoneSupplyChain.stoneworks;
    const graphic = new Graphics()
      .roundRect(stoneworks.x - 30, stoneworks.y - 24, 60, 48, 5)
      .fill({ color: state.active ? 0xb8783e : 0x716d65 })
      .rect(stoneworks.x - 20, stoneworks.y - 36, 12, 20)
      .fill({ color: state.active ? 0x665044 : 0x514f4b })
      .circle(stoneworks.x + 16, stoneworks.y - 8, 7)
      .fill({ color: state.active ? 0xf0c56c : 0x99968e });
    const inventoryShare =
      state.finishedStoneInventoryTons / state.outputStorageCapacityTons;
    if (inventoryShare > 0) {
      graphic
        .rect(stoneworks.x - 25, stoneworks.y + 15, 50 * inventoryShare, 5)
        .fill({ color: 0xe9d7a9 });
    }
    industryLayer.addChild(graphic);
  }

  function drawBottleneckOverlay(snapshot: SimulationSnapshot): void {
    if (
      renderedBottlenecks === snapshot.bottlenecks &&
      renderedRoadNetwork === snapshot.roadNetwork
    ) {
      return;
    }
    destroyChildren(analysisOverlayLayer);
    renderedBottlenecks = snapshot.bottlenecks;

    for (const feature of getBottleneckOverlayFeatures(snapshot)) {
      const graphic = new Graphics()
        .moveTo(feature.start.x, feature.start.y)
        .lineTo(feature.end.x, feature.end.y);
      if (feature.role === "affected-flow") {
        graphic.stroke({ color: 0xf0a04b, width: 20, alpha: 0.34 });
      } else {
        graphic
          .stroke({ color: 0xfff3df, width: 22, alpha: 0.94 })
          .moveTo(feature.start.x, feature.start.y)
          .lineTo(feature.end.x, feature.end.y)
          .stroke({ color: 0xe64c3c, width: 15, alpha: 0.96 });
        const midpoint = {
          x: (feature.start.x + feature.end.x) / 2,
          y: (feature.start.y + feature.end.y) / 2,
        };
        graphic
          .circle(midpoint.x, midpoint.y, 17)
          .fill({ color: 0xe64c3c, alpha: 0.98 })
          .circle(midpoint.x, midpoint.y, 8)
          .stroke({ color: 0xfff3df, width: 4, alpha: 1 });
      }
      analysisOverlayLayer.addChild(graphic);
    }
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

  function createRepresentativeVehicleGraphic(mode: "road" | "rail"): Graphics {
    if (mode === "rail") {
      return new Graphics()
        .roundRect(-18, -6, 36, 12, 2)
        .fill({ color: 0x2c7f89 })
        .rect(-13, -3, 8, 6)
        .fill({ color: 0xbce8e5 })
        .rect(2, -3, 11, 6)
        .fill({ color: 0x15383d });
    }
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
    const nextPlans = [
      snapshot.stoneSupplyChain.inboundFreight,
      snapshot.stoneSupplyChain.outboundFreight,
    ].flatMap((freight) => {
      const plan = createRepresentativeFreightTrafficPlan(
        freight,
        snapshot.roadNetwork,
        snapshot.railNetwork,
      );
      return plan ? [plan] : [];
    });
    if (
      nextPlans.map(({ key }) => key).join(";") ===
      representativeTrafficPlans.map(({ key }) => key).join(";")
    ) {
      return;
    }

    representativeTrafficPlans = nextPlans;
    representativeTrafficElapsedSeconds = 0;
    clearRepresentativeVehicles();
  }

  function drawRepresentativeVehicles(): void {
    const samples = representativeTrafficPlans.flatMap((plan) =>
      sampleRepresentativeFreightVehicles(
          plan,
          representativeTrafficElapsedSeconds,
        ),
    );
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
        graphic = createRepresentativeVehicleGraphic(sample.mode);
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

    if (roadTool === "build-rail") {
      constructionPreviewLayer
        .moveTo(constructionStart.x, constructionStart.y)
        .lineTo(constructionEnd.x, constructionEnd.y)
        .stroke({ color: 0x16363d, width: 17, alpha: 0.9 })
        .moveTo(constructionStart.x, constructionStart.y)
        .lineTo(constructionEnd.x, constructionEnd.y)
        .stroke({ color: 0x75dedb, width: 7, alpha: 0.96 })
        .circle(constructionStart.x, constructionStart.y, 9)
        .fill({ color: 0x9de6e4 })
        .circle(constructionEnd.x, constructionEnd.y, 9)
        .fill({ color: 0x9de6e4 });
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

  function snapRailPoint(position: Point): Point {
    const tolerance = 14 / camera.scale;
    let nearest = position;
    let nearestDistance = tolerance;

    for (const anchor of getRailSnapAnchors(
      currentSnapshot.geography,
      currentSnapshot.railNetwork,
    )) {
      const distance = Math.hypot(position.x - anchor.x, position.y - anchor.y);
      if (distance <= nearestDistance) {
        nearest = anchor;
        nearestDistance = distance;
      }
    }

    for (const track of currentSnapshot.railNetwork.tracks) {
      const delta = { x: track.end.x - track.start.x, y: track.end.y - track.start.y };
      const lengthSquared = delta.x * delta.x + delta.y * delta.y;
      const parameter = Math.min(1, Math.max(0,
        ((position.x - track.start.x) * delta.x +
          (position.y - track.start.y) * delta.y) / lengthSquared,
      ));
      const projected = {
        x: track.start.x + delta.x * parameter,
        y: track.start.y + delta.y * parameter,
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

    if (roadTool === "build" || roadTool === "build-rail") {
      constructionStart = roadTool === "build"
        ? snapRoadPoint(positionInWorld(event))
        : snapRailPoint(positionInWorld(event));
      constructionEnd = constructionStart;
      suppressNextSelection = true;
      canvas.classList.add("is-building");
      drawConstructionPreview();
      if (roadTool === "build") {
        options.onBuildRoadPreview?.(constructionStart, constructionEnd);
      } else {
        options.onBuildRailTrackPreview?.(constructionStart, constructionEnd);
      }
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

    if (roadTool === "build" || roadTool === "build-rail") {
      constructionEnd = roadTool === "build"
        ? snapRoadPoint(positionInWorld(event))
        : snapRailPoint(positionInWorld(event));
      drawConstructionPreview();
      if (roadTool === "build") {
        options.onBuildRoadPreview?.(constructionStart, constructionEnd);
      } else {
        options.onBuildRailTrackPreview?.(constructionStart, constructionEnd);
      }
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
      (roadTool === "build" || roadTool === "build-rail") &&
      completeConstruction &&
      constructionStart &&
      constructionEnd &&
      Math.hypot(
        constructionEnd.x - constructionStart.x,
        constructionEnd.y - constructionStart.y,
      ) > 0.001
    ) {
      if (roadTool === "build") {
        options.onBuildRoad?.(constructionStart, constructionEnd);
      } else {
        options.onBuildRailTrack?.(constructionStart, constructionEnd);
      }
    }

    constructionStart = undefined;
    constructionEnd = undefined;
    drawConstructionPreview();
    options.onBuildRoadPreview?.(undefined, undefined);
    options.onBuildRailTrackPreview?.(undefined, undefined);
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
    options.onBuildRoadPreview?.(undefined, undefined);
    options.onBuildRailTrackPreview?.(undefined, undefined);
    canvas.classList.toggle("road-tool-build", tool === "build");
    canvas.classList.toggle("road-tool-remove", tool === "remove");
    canvas.classList.toggle("rail-tool-build", tool === "build-rail");
    canvas.classList.toggle("rail-tool-remove", tool === "remove-rail");
    for (const child of roadHitLayer.children) {
      child.cursor = "pointer";
    }
    for (const child of railHitLayer.children) {
      child.cursor = "pointer";
    }
  }

  function drawSnapshot(snapshot: SimulationSnapshot): void {
    currentSnapshot = snapshot;
    drawGeography(snapshot);
    drawIndustry(snapshot);
    drawDevelopment(snapshot);
    drawRoads(snapshot);
    drawRail(snapshot);
    drawBottleneckOverlay(snapshot);
    updateRepresentativeTraffic(snapshot);
    drawRepresentativeVehicles();
  }

  function animateRepresentativeTraffic(): void {
    if (representativeTrafficPlans.length === 0) {
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

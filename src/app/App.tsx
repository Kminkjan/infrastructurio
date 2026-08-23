import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  createSaveGame,
  downloadSaveFile,
  loadLocalGame,
  readSaveFile,
  restoreSaveGame,
  saveLocalGame,
} from "../persistence";
import {
  createWorldRenderer,
  type MapSelection,
  type RoadTool,
  type WorldRenderer,
} from "../rendering";
import { createSimulation, type Simulation } from "../simulation";
import type {
  AggregateFreightSnapshot,
  DevelopmentAccessFactorExplanation,
  DevelopmentDecisionExplanation,
  DevelopmentDecisionOutcome,
  DevelopmentLocationSnapshot,
  Point,
  RoadBottleneckSnapshot,
  RoadClass,
  SimulationSnapshot,
} from "../shared";
import "./app.css";

const SCENARIO_SEED = "millford-valley-foundation";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown persistence error";
}

function formatTons(value: number): string {
  return `${value.toLocaleString()} t/day`;
}

function factorLabel(factor: DevelopmentAccessFactorExplanation): string {
  return factor.factor === "resource"
    ? "Resources"
    : factor.factor[0]!.toUpperCase() + factor.factor.slice(1);
}

function factorComparison(
  factor: DevelopmentAccessFactorExplanation,
): string {
  const difference = factor.differenceFromBestAlternativePoints;
  if (difference === null || factor.bestAlternativeName === null) {
    return "no regional alternative";
  }
  if (Math.abs(difference) < 0.05) {
    return `level with ${factor.bestAlternativeName}`;
  }
  return difference > 0
    ? `${difference.toFixed(1)} more than ${factor.bestAlternativeName}`
    : `${Math.abs(difference).toFixed(1)} fewer than ${factor.bestAlternativeName}`;
}

function outcomeDescription(
  outcome: DevelopmentDecisionOutcome,
  decision: DevelopmentDecisionExplanation,
): string {
  switch (outcome) {
    case "not-evaluated":
      return "Awaiting the first weekly allocation.";
    case "selected":
      return "Selected for the latest weekly allocation.";
    case "not-selected":
      return decision.selectedLocationName
        ? `Not selected; ${decision.selectedLocationName} won the seeded choice.`
        : "Not selected for the latest weekly allocation.";
    case "not-viable":
      return "Not viable at the latest evaluation.";
    case "regional-demand-met":
      return "No allocation: regional growth demand is met.";
  }
}

function transportDescription(
  decision: DevelopmentDecisionExplanation,
): string {
  const current = decision.transport.marketNetworkCost;
  const alternative = decision.transport.bestAlternativeMarketNetworkCost;
  const alternativeName = decision.transport.bestAlternativeName;
  if (current === null) {
    return alternative === null || alternativeName === null
      ? "No market road route from either candidate"
      : `No market road route; ${alternativeName} has a ${alternative.toFixed(1)}-hour route`;
  }
  if (alternative === null || alternativeName === null) {
    return `${current.toFixed(1)} generalized hours; no alternative route`;
  }
  const difference = current - alternative;
  const comparison =
    Math.abs(difference) < 0.5
      ? `level with ${alternativeName}`
      : difference < 0
        ? `${Math.abs(difference).toFixed(1)} hours lower than ${alternativeName}`
        : `${difference.toFixed(1)} hours higher than ${alternativeName}`;
  return `${current.toFixed(1)} generalized hours; ${comparison}`;
}

function FreightInspector({
  freight,
}: {
  readonly freight: AggregateFreightSnapshot;
}) {
  const routeDescription = freight.route
    ? `${(freight.routeCost ?? 0).toFixed(1)} generalized hours · ${
        freight.route.linkIds.length
      } ${freight.route.linkIds.length === 1 ? "link" : "links"}`
    : "No connected road route";

  return (
    <>
      <dl className="freight-details">
        <div>
          <dt>Production</dt>
          <dd>{formatTons(freight.productionTonsPerDay)}</dd>
        </div>
        <div>
          <dt>Market demand</dt>
          <dd>{formatTons(freight.demandTonsPerDay)}</dd>
        </div>
        <div>
          <dt>Shipped</dt>
          <dd>{formatTons(freight.shippedTonsPerDay)}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{routeDescription}</dd>
        </div>
      </dl>
      <p className="limiting-factor">
        <strong>Limiting factor:</strong> {freight.limitingReason}
      </p>
    </>
  );
}

function assignmentTime(tick: number): string {
  const day = Math.floor(tick / 24);
  const hour = tick % 24;
  return `day ${day}, ${hour.toString().padStart(2, "0")}:00`;
}

function BottleneckInspector({
  bottleneck,
  onUpgrade,
  onPlanBypass,
}: {
  readonly bottleneck: RoadBottleneckSnapshot;
  readonly onUpgrade: (roadSegmentId: string) => void;
  readonly onPlanBypass: () => void;
}) {
  const flow = bottleneck.affectedFlows[0];
  return (
    <section className="bottleneck-diagnosis" aria-label="Bottleneck diagnosis">
      <h3>{bottleneck.name}</h3>
      <p className="bottleneck-severity">
        {Math.round(bottleneck.capacity.volumeCapacityRatio * 100)}% of
        practical capacity · +{bottleneck.congestionDelayHours.toFixed(1)} hours
        delay
      </p>
      <dl className="diagnosis-causes">
        <div>
          <dt>Demand cause</dt>
          <dd>
            {bottleneck.demand.assignedUnitsPerDay.toLocaleString()} assigned
            units/day, {bottleneck.demand.excessUnitsPerDay.toLocaleString()} over
            capacity.
          </dd>
        </div>
        <div>
          <dt>Capacity cause</dt>
          <dd>
            {bottleneck.roadClass} road with{" "}
            {bottleneck.capacity.practicalUnitsPerDay.toLocaleString()} practical
            units/day.
          </dd>
        </div>
        <div>
          <dt>Route-choice cause</dt>
          <dd>
            One minimum-cost route carries all assigned flow across{" "}
            {bottleneck.routeChoice.routeLinkCount} route{" "}
            {bottleneck.routeChoice.routeLinkCount === 1 ? "link" : "links"} at{" "}
            {bottleneck.routeChoice.routeGeneralizedCostHours.toFixed(1)}
            {" generalized hours. Routes are reconsidered at "}
            {assignmentTime(bottleneck.routeChoice.nextAssignmentTick)}.
          </dd>
        </div>
      </dl>
      {flow ? (
        <p className="affected-flow">
          <strong>Affected flow:</strong> {flow.assignedUnitsPerDay} t/day of{" "}
          {flow.commodity} from {flow.originName} to {flow.destinationName}.
        </p>
      ) : null}
      <div className="intervention-actions">
        <button
          type="button"
          onClick={() => onUpgrade(bottleneck.roadSegmentId)}
        >
          Upgrade this crossing
        </button>
        <button className="secondary" type="button" onClick={onPlanBypass}>
          Draw highway bypass
        </button>
      </div>
      <p className="intervention-tradeoff">
        Upgrading keeps traffic on this corridor. A bypass creates a new route,
        redirects affected traffic after assignment, and changes access along
        that corridor.
      </p>
    </section>
  );
}

function DevelopmentInspector({
  development,
}: {
  readonly development: DevelopmentLocationSnapshot;
}) {
  const pending = development.pendingConstruction;
  const status =
    development.status[0]!.toUpperCase() + development.status.slice(1);
  const { decision } = development;
  const strongestSupport = decision.strongestPositiveFactor;
  const landDifference = decision.land.differenceFromCheapestAlternativePoints;
  const landComparison =
    landDifference === null || decision.land.cheapestAlternativeName === null
      ? "no regional alternative"
      : Math.abs(landDifference) < 0.05
        ? `same prototype cost as ${decision.land.cheapestAlternativeName}`
        : `${landDifference.toFixed(1)} more than ${decision.land.cheapestAlternativeName}`;

  return (
    <>
      <dl className="freight-details">
        <div>
          <dt>Population</dt>
          <dd>{development.totalPopulation.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Infrastructure growth</dt>
          <dd>+{development.growthPopulation.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Development pressure</dt>
          <dd>{development.pressure.toFixed(1)} points</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status}</dd>
        </div>
      </dl>
      {pending ? (
        <p className="limiting-factor">
          <strong>Under construction:</strong> homes for {pending.population}
          {" residents, completing on day "}
          {pending.completesTick / 24}.
        </p>
      ) : null}
      <section className="decision-explanation" aria-label="Development decision">
        <h3>Latest location decision</h3>
        <p className={`decision-outcome outcome-${decision.outcome}`}>
          {outcomeDescription(decision.outcome, decision)}{" "}
          {decision.selectionWeight > 0
            ? `${(decision.selectionShare * 100).toFixed(0)}% of current viable pressure.`
            : null}
        </p>
        <p className="decision-highlight positive">
          <strong>Strongest support:</strong>{" "}
          {strongestSupport
            ? `${factorLabel(strongestSupport)} +${strongestSupport.contributionPoints.toFixed(1)} decision points.`
            : "No positive access contribution."}
        </p>
        <p className="decision-highlight negative">
          <strong>Strongest constraint:</strong> Land and viability −
          {decision.strongestNegativeFactor.costPoints.toFixed(1)} decision
          points.
        </p>
        <dl className="decision-factors">
          {decision.accessFactors.map((factor) => (
            <div key={factor.factor}>
              <dt>{factorLabel(factor)}</dt>
              <dd>
                {factor.accessScore.toFixed(1)} access points ×{" "}
                {(factor.weight * 100).toFixed(0)}% = +
                {factor.contributionPoints.toFixed(1)} decision points;{" "}
                {factorComparison(factor)}
              </dd>
            </div>
          ))}
          <div>
            <dt>Transport</dt>
            <dd>{transportDescription(decision)}</dd>
          </div>
          <div>
            <dt>Land</dt>
            <dd>
              −{decision.land.costPoints.toFixed(1)} decision points;{" "}
              {landComparison}
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}

interface WorldViewProps {
  readonly snapshot: SimulationSnapshot;
  readonly roadTool: RoadTool;
  readonly onSelectionChange: (selection: MapSelection | undefined) => void;
  readonly onBuildRoad: (start: Point, end: Point) => void;
  readonly onRemoveRoad: (roadSegmentId: string) => void;
}

function WorldView({
  snapshot,
  roadTool,
  onSelectionChange,
  onBuildRoad,
  onRemoveRoad,
}: WorldViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  const latestRoadToolRef = useRef(roadTool);
  const selectionCallbackRef = useRef(onSelectionChange);
  const buildRoadCallbackRef = useRef(onBuildRoad);
  const removeRoadCallbackRef = useRef(onRemoveRoad);
  latestSnapshotRef.current = snapshot;
  latestRoadToolRef.current = roadTool;
  selectionCallbackRef.current = onSelectionChange;
  buildRoadCallbackRef.current = onBuildRoad;
  removeRoadCallbackRef.current = onRemoveRoad;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    void createWorldRenderer(host, snapshot, {
      onSelectionChange(selection) {
        selectionCallbackRef.current(selection);
      },
      onBuildRoad(start, end) {
        buildRoadCallbackRef.current(start, end);
      },
      onRemoveRoad(roadSegmentId) {
        removeRoadCallbackRef.current(roadSegmentId);
      },
    }).then((renderer) => {
      if (disposed) {
        renderer.destroy();
        return;
      }

      rendererRef.current = renderer;
      renderer.update(latestSnapshotRef.current);
      renderer.setRoadTool(latestRoadToolRef.current);
    });

    return () => {
      disposed = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update(snapshot);
  }, [snapshot]);

  useEffect(() => {
    rendererRef.current?.setRoadTool(roadTool);
  }, [roadTool]);

  return (
    <div className="world">
      <div className="world-surface" ref={hostRef} />
      <nav className="map-controls" aria-label="Map navigation">
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => rendererRef.current?.zoomBy(1.35)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => rendererRef.current?.zoomBy(1 / 1.35)}
        >
          −
        </button>
        <button
          className="reset-map"
          type="button"
          aria-label="Fit map to view"
          title="Fit map to view"
          onClick={() => rendererRef.current?.resetView()}
        >
          Fit
        </button>
      </nav>
    </div>
  );
}

export function App() {
  const [simulation, setSimulation] = useState(() =>
    createSimulation(SCENARIO_SEED),
  );
  const [snapshot, setSnapshot] = useState(() => simulation.getSnapshot());
  const [selection, setSelection] = useState<MapSelection>();
  const [roadTool, setRoadTool] = useState<RoadTool>("inspect");
  const [buildRoadClass, setBuildRoadClass] =
    useState<RoadClass>("arterial");
  const [constructionMessage, setConstructionMessage] = useState<string>();
  const [persistenceMessage, setPersistenceMessage] = useState<string>();
  const [persistenceBusy, setPersistenceBusy] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);

  function advanceDay(): void {
    setSnapshot(simulation.dispatch({ type: "advance", ticks: 24 }));
  }

  function reset(): void {
    setSnapshot(simulation.dispatch({ type: "reset" }));
    setConstructionMessage(undefined);
  }

  function buildRoad(start: Point, end: Point): void {
    try {
      setSnapshot(
        simulation.dispatch({
          type: "build-road",
          start,
          end,
          roadClass: buildRoadClass,
        }),
      );
      setConstructionMessage(undefined);
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : "Road construction failed",
      );
    }
  }

  function upgradeRoad(roadSegmentId: string): void {
    try {
      setSnapshot(
        simulation.dispatch({ type: "upgrade-road", roadSegmentId }),
      );
      setConstructionMessage(
        "Crossing upgraded to highway capacity; current traffic has been reassigned.",
      );
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : "Road upgrade failed",
      );
    }
  }

  function planBypass(): void {
    setBuildRoadClass("highway");
    setRoadTool("build");
    setConstructionMessage(
      "Draw a connected highway route around the highlighted crossing, then advance time for route choice to respond.",
    );
  }

  function removeRoad(roadSegmentId: string): void {
    setSnapshot(
      simulation.dispatch({ type: "remove-road", roadSegmentId }),
    );
    setConstructionMessage(undefined);
  }

  function useLoadedSimulation(loadedSimulation: Simulation) {
    setSimulation(loadedSimulation);
    setSnapshot(loadedSimulation.getSnapshot());
    setSelection(undefined);
    setRoadTool("inspect");
    setBuildRoadClass("arterial");
    setConstructionMessage(undefined);
  }

  async function saveLocally(): Promise<void> {
    setPersistenceBusy(true);
    try {
      await saveLocalGame(createSaveGame(simulation));
      setPersistenceMessage("Saved locally in this browser.");
    } catch (error) {
      setPersistenceMessage(`Local save failed: ${errorMessage(error)}`);
    } finally {
      setPersistenceBusy(false);
    }
  }

  async function loadLocally(): Promise<void> {
    setPersistenceBusy(true);
    try {
      const save = await loadLocalGame();
      if (!save) {
        setPersistenceMessage("No local save exists yet.");
        return;
      }

      useLoadedSimulation(restoreSaveGame(save));
      setPersistenceMessage("Loaded the local browser save.");
    } catch (error) {
      setPersistenceMessage(`Local load failed: ${errorMessage(error)}`);
    } finally {
      setPersistenceBusy(false);
    }
  }

  function exportFile(): void {
    try {
      downloadSaveFile(createSaveGame(simulation));
      setPersistenceMessage("Exported the current scenario as a file.");
    } catch (error) {
      setPersistenceMessage(`Export failed: ${errorMessage(error)}`);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    setPersistenceBusy(true);
    try {
      useLoadedSimulation(restoreSaveGame(await readSaveFile(file)));
      setPersistenceMessage(`Imported ${file.name}.`);
    } catch (error) {
      setPersistenceMessage(`Import failed: ${errorMessage(error)}`);
    } finally {
      setPersistenceBusy(false);
    }
  }

  const selectionShowsFreight =
    selection?.id === snapshot.quarryMarketFreight.producerId ||
    selection?.id === snapshot.quarryMarketFreight.marketId;
  const selectedDevelopment = snapshot.development.locations.find(
    ({ locationId }) => locationId === selection?.id,
  );
  const selectedBottleneck = snapshot.bottlenecks.roadBottlenecks.find(
    (bottleneck) =>
      bottleneck.roadSegmentId === selection?.id ||
      (selection?.id === snapshot.geography.crossingArea.id &&
        bottleneck.isMillfordBridge),
  );
  const selectionCanShowBottleneckStatus =
    selection?.id === snapshot.geography.crossingArea.id ||
    snapshot.roadNetwork.segments.some(({ id }) => id === selection?.id);
  const millfordBridgeBottleneck =
    snapshot.bottlenecks.roadBottlenecks.find(
      ({ isMillfordBridge }) => isMillfordBridge,
    );

  return (
    <main className="prototype-shell">
      <WorldView
        snapshot={snapshot}
        roadTool={roadTool}
        onSelectionChange={setSelection}
        onBuildRoad={buildRoad}
        onRemoveRoad={removeRoad}
      />
      <button
        className="overlay-toggle"
        type="button"
        aria-controls="simulation-controls"
        aria-expanded={controlsOpen}
        onClick={() => setControlsOpen((open) => !open)}
      >
        {controlsOpen ? "Hide controls" : "Show controls"}
      </button>
      <section
        id="simulation-controls"
        className="overlay"
        aria-label="Simulation controls"
        hidden={!controlsOpen}
      >
        <p className="eyebrow">Millford Valley · Foundation</p>
        <h1>Infrastructurio</h1>
        <p className="status">
          Simulation day {snapshot.elapsedDays} ·{" "}
          {snapshot.roadNetwork.segments.length} road{" "}
          {snapshot.roadNetwork.segments.length === 1 ? "segment" : "segments"}
          {" · "}
          {snapshot.development.demand.completedGrowthPopulation} regional growth
          {millfordBridgeBottleneck ? " · Bridge overloaded" : ""}
        </p>
        <section className="road-tools" aria-label="Road construction tools">
          <p className="eyebrow">Map tool</p>
          <div className="tool-buttons">
            <button
              className="tool-button"
              type="button"
              aria-pressed={roadTool === "inspect"}
              onClick={() => setRoadTool("inspect")}
            >
              Inspect
            </button>
            <button
              className="tool-button"
              type="button"
              aria-pressed={
                roadTool === "build" && buildRoadClass === "arterial"
              }
              onClick={() => {
                setBuildRoadClass("arterial");
                setRoadTool("build");
              }}
            >
              Build arterial
            </button>
            <button
              className="tool-button"
              type="button"
              aria-pressed={
                roadTool === "build" && buildRoadClass === "highway"
              }
              onClick={() => {
                setBuildRoadClass("highway");
                setRoadTool("build");
              }}
            >
              Build highway
            </button>
            <button
              className="tool-button danger"
              type="button"
              aria-pressed={roadTool === "remove"}
              onClick={() => setRoadTool("remove")}
            >
              Remove road
            </button>
          </div>
          {constructionMessage ? (
            <p className="construction-message" role="status">
              {constructionMessage}
            </p>
          ) : null}
        </section>
        <section className="inspector" aria-live="polite">
          <p className="eyebrow">Inspector</p>
          {selection ? (
            <>
              <h2>{selection.name}</h2>
              <p className="selection-kind">{selection.kind}</p>
              <p className="selection-description">{selection.description}</p>
              {selectionShowsFreight ? (
                <FreightInspector freight={snapshot.quarryMarketFreight} />
              ) : null}
              {selectedDevelopment ? (
                <DevelopmentInspector development={selectedDevelopment} />
              ) : null}
              {selectedBottleneck ? (
                <BottleneckInspector
                  bottleneck={selectedBottleneck}
                  onUpgrade={upgradeRoad}
                  onPlanBypass={planBypass}
                />
              ) : selectionCanShowBottleneckStatus ? (
                <p className="resolved-bottleneck">
                  No overloaded link is currently detected here.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h2>Nothing selected</h2>
              <p className="selection-description">
                Select a road, crossing, market connection, resource, or
                settlement.
              </p>
            </>
          )}
        </section>
        <div className="controls">
          <button type="button" onClick={advanceDay}>
            Advance one day
          </button>
          <button className="secondary" type="button" onClick={reset}>
            Reset
          </button>
        </div>
        <section className="persistence-tools" aria-label="Save and load">
          <p className="eyebrow">Save and load</p>
          <div className="tool-buttons">
            <button
              className="tool-button"
              type="button"
              disabled={persistenceBusy}
              onClick={() => void saveLocally()}
            >
              Save local
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={persistenceBusy}
              onClick={() => void loadLocally()}
            >
              Load local
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={persistenceBusy}
              onClick={exportFile}
            >
              Export file
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={persistenceBusy}
              onClick={() => importInputRef.current?.click()}
            >
              Import file
            </button>
            <input
              ref={importInputRef}
              className="file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importFile(event)}
            />
          </div>
          {persistenceMessage ? (
            <p className="persistence-message" role="status">
              {persistenceMessage}
            </p>
          ) : null}
        </section>
        <p className="hint">
          {roadTool === "build"
            ? `Drag across the map to draw ${buildRoadClass === "arterial" ? "an" : "a"} ${buildRoadClass} road. Endpoints snap to settlements, resources, the market, nearby roads, and junctions.`
            : roadTool === "remove"
              ? "Select a player-built road segment to remove it. Drag empty map space to pan."
              : "Drag the map to pan, scroll to zoom, and select a marked feature to inspect it."}
        </p>
      </section>
    </main>
  );
}

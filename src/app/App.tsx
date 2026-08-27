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
  InfrastructureTransactionQuote,
  FreightRailTerminalSnapshot,
  Point,
  RailTerminalSite,
  RailTrackSnapshot,
  RoadBottleneckSnapshot,
  RoadClass,
  SimulationSnapshot,
  StoneworksSnapshot,
} from "../shared";
import "./app.css";

const SCENARIO_SEED = "millford-valley-foundation";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown persistence error";
}

function formatTons(value: number): string {
  return `${value.toLocaleString()} t/day`;
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function CostBreakdown({
  quote,
  label,
}: {
  readonly quote: InfrastructureTransactionQuote;
  readonly label: string;
}) {
  const { breakdown } = quote;
  return (
    <section className="cost-preview" aria-label={`${label} cost preview`}>
      <h3>{label}</h3>
      <dl className="freight-details">
        <div>
          <dt>Base work · {breakdown.length.toFixed(1)} units</dt>
          <dd>{formatMoney(breakdown.baseCost)}</dd>
        </div>
        {breakdown.landAcquisitionCost > 0 ? (
          <div>
            <dt>Eastbank land acquisition</dt>
            <dd>{formatMoney(breakdown.landAcquisitionCost)}</dd>
          </div>
        ) : null}
        {breakdown.crossingWorkCost > 0 ? (
          <div>
            <dt>
              Constrained river work · {breakdown.riverCrossingCount}
            </dt>
            <dd>{formatMoney(breakdown.crossingWorkCost)}</dd>
          </div>
        ) : null}
        {breakdown.salvageCredit > 0 ? (
          <div>
            <dt>Salvage credit</dt>
            <dd>+{formatMoney(breakdown.salvageCredit)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{breakdown.netCost < 0 ? "Treasury credit" : "Total"}</dt>
          <dd>{formatMoney(Math.abs(breakdown.netCost))}</dd>
        </div>
      </dl>
      <p className={quote.affordable ? "quote-affordable" : "quote-unaffordable"}>
        {quote.affordable
          ? `Treasury after transaction: ${formatMoney(quote.balanceAfter)}`
          : `Unaffordable with ${formatMoney(quote.balanceBefore)} available.`}
      </p>
    </section>
  );
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
    ? `${freight.route.mode === "road" ? "Road" : "Rail"} · ${(freight.routeCost ?? 0).toFixed(1)} generalized hours · ${
        freight.route.linkIds.length
      } ${freight.route.linkIds.length === 1 ? "link" : "links"}`
    : "No viable road or rail service";

  return (
    <>
      <h3>
        {freight.commodity === "raw-granite"
          ? "Inbound raw granite"
          : "Outbound finished stone"}
      </h3>
      <dl className="freight-details">
        <div>
          <dt>Available</dt>
          <dd>{formatTons(freight.availableTonsPerDay)}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{formatTons(freight.requestedTonsPerDay)}</dd>
        </div>
        <div>
          <dt>Demand</dt>
          <dd>{formatTons(freight.demandTonsPerDay)}</dd>
        </div>
        <div>
          <dt>Assigned</dt>
          <dd>{formatTons(freight.assignedTonsPerDay)}</dd>
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
      <p className="limiting-factor">
        <strong>Private operator choice:</strong> {freight.serviceChoiceReason}
      </p>
      <dl className="freight-details" aria-label="Freight service comparison">
        {freight.serviceCandidates.map((candidate) => (
          <div key={candidate.mode}>
            <dt>{candidate.mode === "road" ? "Road service" : "Rail service"}</dt>
            <dd>
              {candidate.viable
                ? `${candidate.generalizedCostHours!.toFixed(1)} generalized hours; ${candidate.capacityTonsPerDay.toLocaleString()} t/day capacity; ${candidate.congestionDelayHours.toFixed(1)} hours congestion; ${candidate.terminalHandlingTimeHours.toFixed(1)} hours terminal handling; ${candidate.accessEgressTimeHours.toFixed(1)} hours access/egress; ${candidate.priceAdjustmentHours.toFixed(1)} hours price adjustment. ${candidate.reason}`
                : candidate.reason}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function StoneworksInspector({
  stoneworks,
}: {
  readonly stoneworks: StoneworksSnapshot;
}) {
  return (
    <>
      <dl className="freight-details">
        <div>
          <dt>Industry status</dt>
          <dd>{stoneworks.active ? "Active" : "Dormant"}</dd>
        </div>
        <div>
          <dt>Raw granite</dt>
          <dd>
            {stoneworks.inputInventoryTons} / {stoneworks.inputStorageCapacityTons} t
          </dd>
        </div>
        <div>
          <dt>Processing</dt>
          <dd>
            {formatTons(stoneworks.processedTonsPerDay)} / {formatTons(stoneworks.processingCapacityTonsPerDay)}
          </dd>
        </div>
        <div>
          <dt>Finished stone</dt>
          <dd>
            {stoneworks.finishedStoneInventoryTons} / {stoneworks.outputStorageCapacityTons} t
          </dd>
        </div>
        <div>
          <dt>Labor opportunity</dt>
          <dd>{stoneworks.laborOpportunity.toFixed(1)} access weight</dd>
        </div>
      </dl>
      <p className="limiting-factor">
        <strong>Industry limit:</strong> {stoneworks.limitingReason}
      </p>
    </>
  );
}

function RailInfrastructureInspector({
  track,
  terminal,
}: {
  readonly track?: RailTrackSnapshot;
  readonly terminal?: FreightRailTerminalSnapshot;
}) {
  const capacity = track?.capacityTonsPerDay ?? terminal!.capacityTonsPerDay;
  const freeFlowTime = track
    ? track.freeFlowTravelTimeHours
    : terminal!.freeFlowTransferTimeHours;
  const constructionCost = track?.constructionCost ?? terminal!.constructionCost;
  const maintenance =
    track?.maintenanceCostPerDay ?? terminal!.maintenanceCostPerDay;
  return (
    <dl className="freight-details" aria-label="Rail infrastructure properties">
      <div>
        <dt>Practical capacity</dt>
        <dd>{capacity.toLocaleString()} t/day</dd>
      </div>
      <div>
        <dt>{track ? "Free-flow travel" : "Free-flow transfer"}</dt>
        <dd>{freeFlowTime.toFixed(2)} hours</dd>
      </div>
      <div>
        <dt>Construction cost</dt>
        <dd>{formatMoney(constructionCost)}</dd>
      </div>
      <div>
        <dt>Daily maintenance</dt>
        <dd>{formatMoney(maintenance)}</dd>
      </div>
    </dl>
  );
}

function assignmentTime(tick: number): string {
  const day = Math.floor(tick / 24);
  const hour = tick % 24;
  return `day ${day}, ${hour.toString().padStart(2, "0")}:00`;
}

function BottleneckInspector({
  bottleneck,
  upgradeQuote,
  onUpgrade,
  onPlanBypass,
}: {
  readonly bottleneck: RoadBottleneckSnapshot;
  readonly upgradeQuote: InfrastructureTransactionQuote;
  readonly onUpgrade: (roadSegmentId: string) => void;
  readonly onPlanBypass: () => void;
}) {
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
      {bottleneck.affectedFlows.map((flow) => (
        <p className="affected-flow" key={flow.id}>
          <strong>Affected flow:</strong> {flow.assignedUnitsPerDay} t/day of{" "}
          {flow.commodity.replaceAll("-", " ")} from {flow.originName} to{" "}
          {flow.destinationName}.
        </p>
      ))}
      <div className="intervention-actions">
        <button
          type="button"
          onClick={() => onUpgrade(bottleneck.roadSegmentId)}
        >
          Upgrade this crossing · {formatMoney(upgradeQuote.breakdown.netCost)}
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
  readonly onBuildRoadPreview: (
    start: Point | undefined,
    end: Point | undefined,
  ) => void;
  readonly onRemoveRoad: (roadSegmentId: string) => void;
  readonly onBuildRailTrack: (start: Point, end: Point) => void;
  readonly onBuildRailTrackPreview: (
    start: Point | undefined,
    end: Point | undefined,
  ) => void;
  readonly onRemoveRailTrack: (railTrackId: string) => void;
  readonly onRemoveRailTerminal: (railTerminalId: string) => void;
}

function WorldView({
  snapshot,
  roadTool,
  onSelectionChange,
  onBuildRoad,
  onBuildRoadPreview,
  onRemoveRoad,
  onBuildRailTrack,
  onBuildRailTrackPreview,
  onRemoveRailTrack,
  onRemoveRailTerminal,
}: WorldViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  const latestRoadToolRef = useRef(roadTool);
  const selectionCallbackRef = useRef(onSelectionChange);
  const buildRoadCallbackRef = useRef(onBuildRoad);
  const buildRoadPreviewCallbackRef = useRef(onBuildRoadPreview);
  const removeRoadCallbackRef = useRef(onRemoveRoad);
  const buildRailTrackCallbackRef = useRef(onBuildRailTrack);
  const buildRailTrackPreviewCallbackRef = useRef(onBuildRailTrackPreview);
  const removeRailTrackCallbackRef = useRef(onRemoveRailTrack);
  const removeRailTerminalCallbackRef = useRef(onRemoveRailTerminal);
  latestSnapshotRef.current = snapshot;
  latestRoadToolRef.current = roadTool;
  selectionCallbackRef.current = onSelectionChange;
  buildRoadCallbackRef.current = onBuildRoad;
  buildRoadPreviewCallbackRef.current = onBuildRoadPreview;
  removeRoadCallbackRef.current = onRemoveRoad;
  buildRailTrackCallbackRef.current = onBuildRailTrack;
  buildRailTrackPreviewCallbackRef.current = onBuildRailTrackPreview;
  removeRailTrackCallbackRef.current = onRemoveRailTrack;
  removeRailTerminalCallbackRef.current = onRemoveRailTerminal;

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
      onBuildRoadPreview(start, end) {
        buildRoadPreviewCallbackRef.current(start, end);
      },
      onRemoveRoad(roadSegmentId) {
        removeRoadCallbackRef.current(roadSegmentId);
      },
      onBuildRailTrack(start, end) {
        buildRailTrackCallbackRef.current(start, end);
      },
      onBuildRailTrackPreview(start, end) {
        buildRailTrackPreviewCallbackRef.current(start, end);
      },
      onRemoveRailTrack(railTrackId) {
        removeRailTrackCallbackRef.current(railTrackId);
      },
      onRemoveRailTerminal(railTerminalId) {
        removeRailTerminalCallbackRef.current(railTerminalId);
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
  const [constructionQuote, setConstructionQuote] =
    useState<InfrastructureTransactionQuote>();
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
    setConstructionQuote(undefined);
  }

  function previewRoad(
    start: Point | undefined,
    end: Point | undefined,
  ): void {
    if (!start || !end || (start.x === end.x && start.y === end.y)) {
      setConstructionQuote(undefined);
      return;
    }
    try {
      setConstructionQuote(
        simulation.quoteRoadConstruction(start, end, buildRoadClass),
      );
    } catch {
      setConstructionQuote(undefined);
    }
  }

  function buildRoad(start: Point, end: Point): void {
    try {
      const nextSnapshot = simulation.dispatch({
          type: "build-road",
          start,
          end,
          roadClass: buildRoadClass,
        });
      setSnapshot(nextSnapshot);
      setConstructionMessage(
        `${buildRoadClass[0]!.toUpperCase()}${buildRoadClass.slice(1)} road built for ${formatMoney(nextSnapshot.finances.lastInfrastructureTransaction!.breakdown.netCost)}.`,
      );
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : "Road construction failed",
      );
    }
  }

  function previewRailTrack(
    start: Point | undefined,
    end: Point | undefined,
  ): void {
    if (!start || !end || (start.x === end.x && start.y === end.y)) {
      setConstructionQuote(undefined);
      return;
    }
    try {
      setConstructionQuote(simulation.quoteRailTrackConstruction(start, end));
    } catch {
      setConstructionQuote(undefined);
    }
  }

  function buildRailTrack(start: Point, end: Point): void {
    try {
      const nextSnapshot = simulation.dispatch({
        type: "build-rail-track",
        start,
        end,
      });
      setSnapshot(nextSnapshot);
      setConstructionMessage(
        `Rail track built for ${formatMoney(nextSnapshot.finances.lastInfrastructureTransaction!.breakdown.netCost)}.`,
      );
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : "Rail construction failed",
      );
    }
  }

  function placeFreightRailTerminal(site: RailTerminalSite): void {
    try {
      const nextSnapshot = simulation.dispatch({
        type: "place-freight-rail-terminal",
        site,
      });
      setSnapshot(nextSnapshot);
      setConstructionMessage(
        `Freight rail terminal placed for ${formatMoney(nextSnapshot.finances.lastInfrastructureTransaction!.breakdown.netCost)}.`,
      );
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : "Terminal placement failed",
      );
    }
  }

  function removeRailTrack(railTrackId: string): void {
    const nextSnapshot = simulation.dispatch({
      type: "remove-rail-track",
      railTrackId,
    });
    setSnapshot(nextSnapshot);
    setConstructionMessage(
      `Rail track removed; ${formatMoney(nextSnapshot.finances.lastInfrastructureTransaction!.breakdown.salvageCredit)} salvage credited.`,
    );
  }

  function removeRailTerminal(railTerminalId: string): void {
    const nextSnapshot = simulation.dispatch({
      type: "remove-freight-rail-terminal",
      railTerminalId,
    });
    setSnapshot(nextSnapshot);
    setConstructionMessage(
      `Freight terminal removed; ${formatMoney(nextSnapshot.finances.lastInfrastructureTransaction!.breakdown.salvageCredit)} salvage credited.`,
    );
  }

  function upgradeRoad(roadSegmentId: string): void {
    try {
      const nextSnapshot = simulation.dispatch({
        type: "upgrade-road",
        roadSegmentId,
      });
      setSnapshot(nextSnapshot);
      setConstructionMessage(
        `Crossing upgraded for ${formatMoney(nextSnapshot.finances.lastInfrastructureTransaction!.breakdown.netCost)}; current traffic has been reassigned.`,
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
    const nextSnapshot = simulation.dispatch({
      type: "remove-road",
      roadSegmentId,
    });
    setSnapshot(nextSnapshot);
    setConstructionMessage(
      `Road removed; ${formatMoney(nextSnapshot.finances.lastInfrastructureTransaction!.breakdown.salvageCredit)} salvage credited.`,
    );
  }

  function issueBond(): void {
    try {
      const nextSnapshot = simulation.dispatch({
        type: "issue-emergency-bond",
      });
      setSnapshot(nextSnapshot);
      setConstructionMessage(
        `Emergency bond issued. The permanent ${formatMoney(nextSnapshot.finances.emergencyFinance.dailyPenalty)}/day penalty begins at the next daily update.`,
      );
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : "Emergency bond failed",
      );
    }
  }

  function useLoadedSimulation(loadedSimulation: Simulation) {
    setSimulation(loadedSimulation);
    setSnapshot(loadedSimulation.getSnapshot());
    setSelection(undefined);
    setRoadTool("inspect");
    setBuildRoadClass("arterial");
    setConstructionMessage(undefined);
    setConstructionQuote(undefined);
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

  const selectedFreightLegs = [
    snapshot.stoneSupplyChain.inboundFreight,
    snapshot.stoneSupplyChain.outboundFreight,
  ].filter(
    (freight) =>
      selection?.id === freight.originId ||
      selection?.id === freight.destinationId,
  );
  const selectedStoneworks =
    selection?.id === snapshot.stoneSupplyChain.stoneworks.id
      ? snapshot.stoneSupplyChain.stoneworks
      : undefined;
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
  const selectedRoad = snapshot.roadNetwork.segments.find(
    ({ id }) => id === selection?.id,
  );
  const selectedUpgradeQuote = selectedRoad
    ? simulation.quoteRoadUpgrade(selectedRoad.id)
    : undefined;
  const selectedRemovalQuote = selectedRoad
    ? simulation.quoteRoadRemoval(selectedRoad.id)
    : undefined;
  const selectedRailTrack = snapshot.railNetwork.tracks.find(
    ({ id }) => id === selection?.id,
  );
  const selectedRailTerminal = snapshot.railNetwork.terminals.find(
    ({ id }) => id === selection?.id,
  );
  const selectedRailRemovalQuote = selectedRailTrack
    ? simulation.quoteRailTrackRemoval(selectedRailTrack.id)
    : selectedRailTerminal
      ? simulation.quoteFreightRailTerminalRemoval(selectedRailTerminal.id)
      : undefined;
  const railTerminalSites = ["quarry", "stoneworks", "market"] as const;

  return (
    <main className="prototype-shell">
      <WorldView
        snapshot={snapshot}
        roadTool={roadTool}
        onSelectionChange={setSelection}
        onBuildRoad={buildRoad}
        onBuildRoadPreview={previewRoad}
        onRemoveRoad={removeRoad}
        onBuildRailTrack={buildRailTrack}
        onBuildRailTrackPreview={previewRailTrack}
        onRemoveRailTrack={removeRailTrack}
        onRemoveRailTerminal={removeRailTerminal}
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
          {snapshot.railNetwork.tracks.length} rail track
          {snapshot.railNetwork.tracks.length === 1 ? "" : "s"}
          {" · "}
          {snapshot.railNetwork.terminals.length} freight terminal
          {snapshot.railNetwork.terminals.length === 1 ? "" : "s"}
          {" · "}
          {snapshot.development.demand.completedGrowthPopulation} regional growth
          {" · "}
          {snapshot.stoneSupplyChain.outboundFreight.shippedTonsPerDay} t/day stone exports
          {millfordBridgeBottleneck ? " · Bridge overloaded" : ""}
        </p>
        <section className="finance-summary" aria-label="Regional finances">
          <p className="eyebrow">Regional finances</p>
          <dl className="freight-details">
            <div>
              <dt>Treasury</dt>
              <dd>{formatMoney(snapshot.finances.balance)}</dd>
            </div>
            <div>
              <dt>Capital spending</dt>
              <dd>{formatMoney(snapshot.finances.totalCapitalSpending)}</dd>
            </div>
            <div>
              <dt>Operating revenue</dt>
              <dd>{formatMoney(snapshot.finances.totalOperatingRevenue)}</dd>
            </div>
            <div>
              <dt>Daily maintenance</dt>
              <dd>{formatMoney(snapshot.finances.dailyMaintenance)}</dd>
            </div>
            <div>
              <dt>Daily bond penalty</dt>
              <dd>
                {formatMoney(snapshot.finances.emergencyFinance.dailyPenalty)}
              </dd>
            </div>
            <div>
              <dt>Emergency penalties paid</dt>
              <dd>
                {formatMoney(
                  snapshot.finances.emergencyFinance.totalPenaltiesPaid,
                )}
              </dd>
            </div>
          </dl>
          {snapshot.finances.emergencyFinance.bondAvailable ? (
            <button className="emergency-bond" type="button" onClick={issueBond}>
              Emergency bond · +
              {formatMoney(snapshot.finances.emergencyFinance.bondProceeds)} · +
              {formatMoney(
                snapshot.finances.emergencyFinance.penaltyPerBondPerDay,
              )}
              /day
            </button>
          ) : null}
          <p className="bond-penalty">
            {snapshot.finances.emergencyFinance.bondsIssued > 0
              ? `${snapshot.finances.emergencyFinance.bondsIssued} emergency bond${snapshot.finances.emergencyFinance.bondsIssued === 1 ? "" : "s"} active · −${formatMoney(snapshot.finances.emergencyFinance.dailyPenalty)}/day permanently.`
              : `Emergency bonds become available below ${formatMoney(snapshot.finances.emergencyFinance.eligibilityBalance)}; each adds a permanent ${formatMoney(snapshot.finances.emergencyFinance.penaltyPerBondPerDay)}/day penalty.`}
          </p>
        </section>
        <section className="road-tools" aria-label="Infrastructure construction tools">
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
            <button
              className="tool-button rail"
              type="button"
              aria-pressed={roadTool === "build-rail"}
              onClick={() => setRoadTool("build-rail")}
            >
              Build track
            </button>
            <button
              className="tool-button danger rail"
              type="button"
              aria-pressed={roadTool === "remove-rail"}
              onClick={() => setRoadTool("remove-rail")}
            >
              Remove rail
            </button>
          </div>
          <div className="terminal-tools" aria-label="Freight rail terminals">
            <p className="eyebrow">Freight terminals</p>
            <div className="tool-buttons">
              {railTerminalSites.map((site) => {
                const placed = snapshot.railNetwork.terminals.some(
                  (terminal) => terminal.site === site,
                );
                const label =
                  site === "quarry"
                    ? "Quarry"
                    : site === "stoneworks"
                      ? "Stoneworks"
                      : "Market";
                return (
                  <button
                    className="tool-button rail"
                    type="button"
                    disabled={placed}
                    key={site}
                    onClick={() => placeFreightRailTerminal(site)}
                  >
                    {placed ? `${label} placed` : `Place ${label}`}
                  </button>
                );
              })}
            </div>
            <p className="salvage-rule">
              Each compatible freight terminal costs {formatMoney(
                snapshot.railNetwork.terminals.length < railTerminalSites.length
                  ? simulation.quoteFreightRailTerminalConstruction(
                      railTerminalSites.find(
                        (site) =>
                          !snapshot.railNetwork.terminals.some(
                            (terminal) => terminal.site === site,
                          ),
                      )!,
                    ).breakdown.netCost
                  : snapshot.railNetwork.terminals[0]!.constructionCost,
              )} and connects only where track reaches its site.
            </p>
          </div>
          {constructionQuote ? (
            <CostBreakdown
              quote={constructionQuote}
              label={
                roadTool === "build-rail"
                  ? "Rail track cost preview"
                  : "Road cost preview"
              }
            />
          ) : null}
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
              {selectedStoneworks ? (
                <StoneworksInspector stoneworks={selectedStoneworks} />
              ) : null}
              {selectedFreightLegs.map((freight) => (
                <FreightInspector key={freight.id} freight={freight} />
              ))}
              {selectedDevelopment ? (
                <DevelopmentInspector development={selectedDevelopment} />
              ) : null}
              {selectedRailTrack || selectedRailTerminal ? (
                <RailInfrastructureInspector
                  track={selectedRailTrack}
                  terminal={selectedRailTerminal}
                />
              ) : null}
              {selectedBottleneck ? (
                <BottleneckInspector
                  bottleneck={selectedBottleneck}
                  upgradeQuote={simulation.quoteRoadUpgrade(
                    selectedBottleneck.roadSegmentId,
                  )}
                  onUpgrade={upgradeRoad}
                  onPlanBypass={planBypass}
                />
              ) : selectionCanShowBottleneckStatus ? (
                <p className="resolved-bottleneck">
                  No overloaded link is currently detected here.
                </p>
              ) : null}
              {selectedRoad && selectedRemovalQuote ? (
                <section className="road-finance" aria-label="Road finances">
                  {selectedRoad.roadClass !== "highway" &&
                  selectedUpgradeQuote ? (
                    <CostBreakdown
                      quote={selectedUpgradeQuote}
                      label="Highway upgrade preview"
                    />
                  ) : null}
                  <CostBreakdown
                    quote={selectedRemovalQuote}
                    label="Removal preview"
                  />
                  <p className="salvage-rule">
                    Removal credits 20% of current-class base road work. Land
                    acquisition and river work are not recoverable.
                  </p>
                </section>
              ) : null}
              {selectedRailRemovalQuote ? (
                <section className="road-finance" aria-label="Rail finances">
                  <CostBreakdown
                    quote={selectedRailRemovalQuote}
                    label="Rail removal preview"
                  />
                  <p className="salvage-rule">
                    Removal credits 20% of base rail construction. Land and
                    river work are not recoverable.
                  </p>
                </section>
              ) : null}
            </>
          ) : (
            <>
              <h2>Nothing selected</h2>
              <p className="selection-description">
                Select a road, rail track, freight terminal, crossing, market
                connection, resource, industry, or settlement.
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
              : roadTool === "build-rail"
                ? "Drag to build track. Endpoints snap to compatible freight sites, existing track, and rail junctions."
                : roadTool === "remove-rail"
                  ? "Select a rail track or freight terminal to remove it."
              : "Drag the map to pan, scroll to zoom, and select a marked feature to inspect it."}
        </p>
      </section>
    </main>
  );
}

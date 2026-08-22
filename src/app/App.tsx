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
  Point,
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

function FreightInspector({
  freight,
}: {
  readonly freight: AggregateFreightSnapshot;
}) {
  const routeDescription = freight.route
    ? `${Math.round(freight.routeCost ?? 0).toLocaleString()} cost units · ${
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
      setSnapshot(simulation.dispatch({ type: "build-road", start, end }));
      setConstructionMessage(undefined);
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : "Road construction failed",
      );
    }
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
              aria-pressed={roadTool === "build"}
              onClick={() => setRoadTool("build")}
            >
              Build road
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
            ? "Drag across the map to draw a road. Endpoints snap to the quarry, market, nearby roads, and junctions."
            : roadTool === "remove"
              ? "Select a player-built road segment to remove it. Drag empty map space to pan."
              : "Drag the map to pan, scroll to zoom, and select a marked feature to inspect it."}
        </p>
      </section>
    </main>
  );
}

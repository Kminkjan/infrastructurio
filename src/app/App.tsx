import { useEffect, useRef, useState } from "react";
import {
  createWorldRenderer,
  type MapSelection,
  type WorldRenderer,
} from "../rendering";
import { createSimulation } from "../simulation";
import type { SimulationSnapshot } from "../shared";
import "./app.css";

const SCENARIO_SEED = "millford-valley-foundation";

interface WorldViewProps {
  readonly snapshot: SimulationSnapshot;
  readonly onSelectionChange: (selection: MapSelection | undefined) => void;
}

function WorldView({ snapshot, onSelectionChange }: WorldViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  const selectionCallbackRef = useRef(onSelectionChange);
  latestSnapshotRef.current = snapshot;
  selectionCallbackRef.current = onSelectionChange;

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
    }).then((renderer) => {
      if (disposed) {
        renderer.destroy();
        return;
      }

      rendererRef.current = renderer;
      renderer.update(latestSnapshotRef.current);
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
  const [simulation] = useState(() => createSimulation(SCENARIO_SEED));
  const [snapshot, setSnapshot] = useState(() => simulation.getSnapshot());
  const [selection, setSelection] = useState<MapSelection>();

  function advanceDay(): void {
    setSnapshot(simulation.dispatch({ type: "advance", ticks: 24 }));
  }

  function reset(): void {
    setSnapshot(simulation.dispatch({ type: "reset" }));
  }

  return (
    <main className="prototype-shell">
      <WorldView snapshot={snapshot} onSelectionChange={setSelection} />
      <section className="overlay" aria-label="Simulation controls">
        <p className="eyebrow">Millford Valley · Foundation</p>
        <h1>Infrastructurio</h1>
        <p className="status">Simulation day {snapshot.elapsedDays}</p>
        <section className="inspector" aria-live="polite">
          <p className="eyebrow">Inspector</p>
          {selection ? (
            <>
              <h2>{selection.name}</h2>
              <p className="selection-kind">{selection.kind}</p>
              <p className="selection-description">{selection.description}</p>
            </>
          ) : (
            <>
              <h2>Nothing selected</h2>
              <p className="selection-description">
                Select a crossing, market connection, resource, or settlement.
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
        <p className="hint">
          Drag the map to pan, scroll to zoom, and select a marked feature to
          inspect it.
        </p>
      </section>
    </main>
  );
}

import { useEffect, useRef, useState } from "react";
import { createWorldRenderer, type WorldRenderer } from "../rendering";
import { createSimulation } from "../simulation";
import type { SimulationSnapshot } from "../shared";
import "./app.css";

const SCENARIO_SEED = "millford-valley-foundation";

function WorldView({ snapshot }: { readonly snapshot: SimulationSnapshot }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  latestSnapshotRef.current = snapshot;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    void createWorldRenderer(host, snapshot).then((renderer) => {
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

  return <div className="world" ref={hostRef} />;
}

export function App() {
  const [simulation] = useState(() => createSimulation(SCENARIO_SEED));
  const [snapshot, setSnapshot] = useState(() => simulation.getSnapshot());

  function advanceDay(): void {
    setSnapshot(simulation.dispatch({ type: "advance", ticks: 24 }));
  }

  function reset(): void {
    setSnapshot(simulation.dispatch({ type: "reset" }));
  }

  return (
    <main className="prototype-shell">
      <WorldView snapshot={snapshot} />
      <section className="overlay" aria-label="Simulation controls">
        <p className="eyebrow">Millford Valley · Foundation</p>
        <h1>Infrastructurio</h1>
        <p className="status">Simulation day {snapshot.elapsedDays}</p>
        <div className="controls">
          <button type="button" onClick={advanceDay}>
            Advance one day
          </button>
          <button className="secondary" type="button" onClick={reset}>
            Reset
          </button>
        </div>
        <p className="hint">
          React controls this overlay. PixiJS renders the world beneath it.
        </p>
      </section>
    </main>
  );
}

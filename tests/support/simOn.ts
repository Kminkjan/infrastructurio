import type { Sim, Terrain } from "../../src/core/sim/api";
import { createWorld } from "../../src/core/sim/world";
import { makeTerrain } from "./makeTerrain";

/**
 * A `Sim` over a given terrain, for tests: `createSim` generates its terrain
 * from a seed, and since D4 the terrain decides structures and rejections, so
 * fixtures that place track at fixed heights need ground they control.
 */
export function simOn(terrain: Terrain): Sim {
  const w = createWorld(terrain);
  return {
    tick: 0,
    planTrack: (drag) => w.plan(drag),
    preview: (cmd) => w.run(cmd, false),
    execute: (cmd) => w.run(cmd, true),
    network: () => w.network(),
  };
}

/** Flat dry ground at `heightDm` (0 by default), with the water level below it, so no node is water. */
export function flatTerrain(columns: number, rows: number, heightDm = 0): Terrain {
  return makeTerrain(columns, rows, () => heightDm, heightDm - 100);
}

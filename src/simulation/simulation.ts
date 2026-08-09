import {
  TICKS_PER_DAY,
  type SimulationCommand,
  type SimulationSnapshot,
} from "../shared";

interface SimulationState {
  readonly seed: string;
  readonly tick: number;
}

export interface Simulation {
  dispatch(command: SimulationCommand): SimulationSnapshot;
  getSnapshot(): SimulationSnapshot;
}

function snapshot(state: SimulationState): SimulationSnapshot {
  return Object.freeze({
    seed: state.seed,
    tick: state.tick,
    elapsedDays: state.tick / TICKS_PER_DAY,
  });
}

function advance(state: SimulationState, ticks: number): SimulationState {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError("advance ticks must be a non-negative safe integer");
  }

  return { ...state, tick: state.tick + ticks };
}

export function createSimulation(seed: string): Simulation {
  const initialState: SimulationState = Object.freeze({ seed, tick: 0 });
  let state = initialState;

  return {
    dispatch(command) {
      switch (command.type) {
        case "advance":
          state = advance(state, command.ticks);
          break;
        case "reset":
          state = initialState;
          break;
      }

      return snapshot(state);
    },
    getSnapshot() {
      return snapshot(state);
    },
  };
}

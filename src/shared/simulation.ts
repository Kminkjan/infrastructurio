export const TICKS_PER_DAY = 24;

export type SimulationCommand =
  | { readonly type: "advance"; readonly ticks: number }
  | { readonly type: "reset" };

export interface SimulationSnapshot {
  readonly seed: string;
  readonly tick: number;
  readonly elapsedDays: number;
}

import { type Prng, createPrng } from "../../src/core/util/prng";

/**
 * Minimal seeded property runner (src/core/CLAUDE.md, testing idioms; D12
 * owns it). Case `i` draws from sfc32 seeded with `${seed}#${i}`, so any
 * failure replays from the seed printed in its message. No dependency.
 */
export interface ForAllOptions {
  readonly seed: string;
  readonly runs: number;
}

export function forAll<T>(options: ForAllOptions, generate: (prng: Prng) => T, property: (value: T, prng: Prng) => void): void {
  for (let run = 0; run < options.runs; run++) {
    const caseSeed = `${options.seed}#${run}`;
    const prng = createPrng(caseSeed);
    const value = generate(prng);
    try {
      property(value, prng);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`forAll failed for seed "${caseSeed}" (run ${run}).\ncase: ${preview(value)}\n${detail}`, { cause: error });
    }
  }
}

function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 2000 ? `${text.slice(0, 2000)}… (${text.length} chars)` : text;
}

/** Uniform pick from a non-empty list. */
export function pick<T>(prng: Prng, items: readonly T[]): T {
  const item = items[prng.nextInt(items.length)];
  if (item === undefined) throw new RangeError("pick from an empty list");
  return item;
}

/** Fisher–Yates shuffle into a new array. */
export function shuffled<T>(prng: Prng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = prng.nextInt(i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

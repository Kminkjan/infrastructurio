# src/scenarios — seeded Millford Valley geography

- **`generateMillfordValley(seed)` is part of the save contract.** Saves store only `scenarioSeed`, and restore regenerates geography from it (`src/simulation/simulation.ts`). A moved quarry or market makes saved routes fail to restore.
- **Restore ignores `scenarioId`.** It always calls `generateMillfordValley`, and `validateSaveGame` accepts only `"millford-valley"`.
  - Never repurpose or parameterize this generator for a new region.
  - A new scenario needs its own generator, scenarioId plumbing through simulation and persistence, and its own storage namespace (M5 #38).
- **Treat each seed's output as frozen:**
  - the FNV-1a `hashSeed`, the PRNG and the inclusive `randomInteger`;
  - the **8-draw order**: 5 river y offsets, quarry x, quarry y, market y;
  - the ranges, the 960×620 bounds and the fixed coordinates.
- **Adding a feature:** derive it from existing values with no new draw, or append draws *after* the existing 8. The M3 branch's `stoneworks` feature took the first route: Millford's position + (62, −18).
- **IDs:** keep them, in kebab-case `<kind>-<name>`.
  - `settlement-millford` and `settlement-eastbank` are persisted as development location IDs.
  - There must be exactly two settlements, in that order: `src/simulation/growth/millford-development.ts` assigns base populations 60/40 by index.
  - Rendering tests pin the other IDs.
- **Purity:** shared types only, no `Math.random` or `Date`, and deep-frozen outputs.
- **Golden test:** it pins seed `"millford-valley"`; the app uses `"millford-valley-foundation"` (`src/app/App.tsx`).
  - A diff in any existing value is a save-compatibility break, not a snapshot to update.
  - The only legitimate golden edit adds the new key of a feature added under the rule above, as M3 did for `stoneworks`.

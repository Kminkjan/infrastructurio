# src/shared — legacy snapshot, command and persisted leaf types

These are the types for the legacy M0–M2 core. Read `../simulation/CLAUDE.md` before changing anything here.

- **Types only.** The sole runtime export is `TICKS_PER_DAY = 24` (one tick = one simulated hour). The barrel must use `export type` (`isolatedModules`).
- **Some of these types are saved.** `RoadSegment`, `RoadClass`, `Point` and `PendingConstruction` are persisted inside v3 saves, so changing them is a save-format change: see `src/persistence/CLAUDE.md` (bump to ≥10, never 4–9). The wrapper state snapshots live in `src/simulation`.
- **Field changes ripple** to:
  - `src/simulation`
  - `src/rendering`
  - `src/app`
  - `src/scenarios` (geography types)
  - `src/persistence`, which imports `Point`, `RoadClass` and `RoadSegment` directly
- **Checks after a change:** run `npm run typecheck` first. Vitest strips types without checking them, and `src/app` has no tests. Then run `npx vitest run src/simulation src/scenarios src/persistence src/rendering`.
- **Naming:** keep unit suffixes (`…Hours`, `…UnitsPerDay`, `…TonsPerDay`, `…Tick`). The single-flow literals `granite` and `quarry-market-granite` are baked into these types.
- **Never add M4/M5 types here.** The construction model is self-contained in `src/experimental/construction`.

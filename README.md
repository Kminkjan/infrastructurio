# Infrastructurio

> **You build the railway. The world runs on it.**

Infrastructurio is a calm infrastructure-design game set in a stylized Baltic countryside
around 1900, shown as a 2.5D isometric diorama in the browser.
- **The player** lays track on a triangular lattice with smooth curves, grades, bridges and
  tunnels, then places turnouts, signals, stations and depots.
- **The simulation** runs autonomous steam trains on that network. They run through signal
  blocks, stop at platforms, queue and sometimes jam, and every train can explain why it
  is waiting.
- **The player never** buys trains, draws lines, writes timetables or dispatches services.

## Status (2026-09-26)

The road-era build was archived and main restarted rail-first on 2026-09-26
([ADR 0008](docs/decisions/0008-archive-road-era-and-restart.md)). The current milestone is
**M4 — Living Diorama** ([roadmap](ROADMAP.md), [contract](docs/prototype-plan.md)).
Since D1 (2026-09-26, [#65](https://github.com/Kminkjan/infrastructurio/issues/65)) the tree
holds the lattice core, integer utilities and seeded terrain, the sim → Three.js coordinate
convention, the palette module, the architecture-boundary test and a render-on-demand
isometric view of the terrain. No M4 gate is measured or accepted yet.

## Run locally

Requires Node.js `^20.19` or `>=22.12`.

```sh
npm ci          # install exactly the locked dependencies
npm run dev     # open the URL Vite prints (the seeded terrain; G toggles the lattice)
```

## Checks

```sh
npm test            # Vitest: unit tests and the architecture-boundary test
npm run typecheck   # app config + the DOM-free core config (tsconfig.core.json)
npm run build       # typecheck + production build
npm run check       # npm test, then npm run build (no CI: run before every push)
```

## Documentation

- **Direction:** [vision](docs/vision.md) · [gameplay loop](docs/gameplay-loop.md) ·
  [glossary](docs/glossary.md) · [roadmap](ROADMAP.md)
- **M4:** [prototype plan](docs/prototype-plan.md) · [backlog, D1–D13](docs/backlog.md) ·
  [acceptance gates](docs/evidence/m4/2026-09-26-acceptance-gates.md) ·
  [art direction](docs/art-direction.md)
- **Design:** [architecture](docs/architecture.md) · [simulation model](docs/simulation-model.md)
- **Decisions** ([index and workflow](docs/decisions/README.md) ·
  [template](docs/decisions/template.md); statuses live in the index):
  [0001 web prototype](docs/decisions/0001-web-based-prototype.md) ·
  [0002 simulation vs presentation](docs/decisions/0002-separate-simulation-from-presentation.md) ·
  [0008 archive and restart](docs/decisions/0008-archive-road-era-and-restart.md) ·
  [0009 isometric Three.js](docs/decisions/0009-render-isometric-threejs.md) ·
  [0010 lattice geometry](docs/decisions/0010-triangular-lattice-track-geometry.md) ·
  [0011 signalling](docs/decisions/0011-signalling-and-reservation.md) ·
  [0012 tick, units, determinism](docs/decisions/0012-tick-units-determinism.md) ·
  [0013 rendering and art](docs/decisions/0013-rendering-and-art-pipeline.md) ·
  [0014 diorama operator](docs/decisions/0014-autonomous-diorama-operator.md)
- **Working here:** [contributing](CONTRIBUTING.md) · agent guides [CLAUDE.md](CLAUDE.md),
  [AGENTS.md](AGENTS.md), [docs/](docs/CLAUDE.md), [src/core/](src/core/CLAUDE.md),
  [src/render/](src/render/CLAUDE.md)

## Archive

The road-era build (the M0–M2 Millford Valley app, the M4 construction proof and its
research) is preserved at tag `legacy-m0-m4`, and the unmerged M3 slice at `legacy-m3`; see
the [archive README](docs/archive/README.md). Its evidence is history, not evidence for the
new prototype, and legacy code returns to main only through an issue the owner explicitly
approves (ADR 0008 migrates nothing).

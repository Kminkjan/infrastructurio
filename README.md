# Infrastructurio

> **You build the railway. The world runs on it.**

Infrastructurio is a calm infrastructure-design game set in a stylized Baltic countryside
around 1900.
- **The player:** lays track across a triangular lattice with smooth curves, grades, bridges
  and tunnels, then places turnouts, signals, stations and depots.
- **The simulation:** autonomous steam trains use that network. They run through signal
  blocks, stop at platforms, queue and sometimes jam, and every one of them can explain why
  it is waiting.
- **The player never** buys trains, draws lines or writes timetables.

## Status

**The road-era build was archived and main restarted on 2026-09-26** ([ADR 0008](docs/decisions/0008-archive-road-era-and-restart.md),
[archive](docs/archive/README.md)). Main currently holds the skeleton: the lattice core, the coordinate
conventions and an isometric smoke scene. The current milestone is **M4 — Living Diorama**
(see the [roadmap](ROADMAP.md)).

## Run locally

Requires Node.js `^20.19` or `>=22.12`.

```sh
npm ci          # install exactly the locked dependencies
npm run dev     # open the URL Vite prints
```

## Checks

```sh
npm test            # Vitest: unit, property, replay and architecture-boundary tests
npm run typecheck   # app config + the DOM-free core config
npm run build       # typecheck + production build
npm run check       # all of the above
```

## Project documentation

- [Roadmap](ROADMAP.md)
- [Decision records](docs/decisions/README.md)
- [Archive of the road-era build](docs/archive/README.md)
- [Contributing](CONTRIBUTING.md)

The vision, gameplay loop, glossary, prototype plan, backlog and art direction for the
rail-first prototype arrive in the next documentation PR.

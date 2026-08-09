# Infrastructurio

> **You build the infrastructure. The simulation uses it and builds around it.**

Infrastructurio is an infrastructure simulation game about creating opportunity rather than placing a finished city. The player builds strategic networks—roads, railways, crossings, terminals, and eventually utilities—while households, businesses, private transport operators, and towns decide how to use them.

Successful infrastructure attracts development. Development creates traffic, land pressure, and new dependencies. Those consequences produce the next problem for the player to solve.

## Status

The project is in pre-production. The current goal is a small web-based simulation toy that proves one loop:

1. Connect a resource to a market.
2. Observe private traffic using the connection.
3. See a settlement or industry grow where access improves.
4. Diagnose the bottleneck created by that growth.
5. Change the network and observe the world respond.

Anything that does not help prove this loop is deliberately secondary.

## Design pillars

- **Infrastructure shapes development.** The player creates conditions; the simulation chooses outcomes.
- **Growth has reasons.** Every important location and route choice should be inspectable.
- **Success creates pressure.** Good infrastructure attracts enough activity to create new constraints.
- **The player builds the skeleton.** Towns may build local streets, but strategic corridors remain player decisions.
- **Vehicles belong to the world.** Private operators choose routes and services; the player controls capacity, access, pricing, and rules.
- **Scale through abstraction.** Decisions and flows are simulated accurately; visible agents may represent aggregated activity.

## Prototype direction

The intended prototype stack is:

- TypeScript and Vite
- PixiJS for the 2D world
- React for management UI
- A deterministic, renderer-independent simulation core
- A Web Worker boundary for simulation processing
- IndexedDB and exportable files for saves
- Vitest for behavioral simulation tests

This is a direction, not a permanent technology commitment. Architecture decisions are recorded in [`docs/decisions`](docs/decisions).

## Project documentation

- [Vision and scope](docs/vision.md)
- [Core gameplay loop](docs/gameplay-loop.md)
- [Simulation model](docs/simulation-model.md)
- [Technical architecture](docs/technical-architecture.md)
- [Performance strategy](docs/performance-strategy.md)
- [Roadmap](ROADMAP.md)
- [Initial issue backlog](docs/initial-backlog.md)
- [Glossary](docs/glossary.md)
- [Contributing](CONTRIBUTING.md)

## Current milestone

**M0 — Simulation Toy:** draw a small map, place a road connection, route representative freight through it, and inspect the resulting flow.

The roadmap describes outcomes rather than dates. Issues describe the concrete work needed to reach each outcome.

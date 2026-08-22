# Infrastructurio

> **You build the infrastructure. The simulation uses it and builds around it.**

Infrastructurio is an infrastructure simulation game about creating opportunity rather than placing a finished city. The player builds strategic networks—roads, railways, crossings, terminals, and eventually utilities—while households, businesses, private transport operators, and towns decide how to use them.

Successful infrastructure attracts development. Development creates traffic, land pressure, and new dependencies. Those consequences produce the next problem for the player to solve.

## Status

The project is in pre-production. A runnable web foundation is in place, and the current goal is a small simulation toy that proves one loop:

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

## Run locally

Requires Node.js 20.19 or newer.

Install dependencies once:

```sh
npm install
```

Then start the application with one command:

```sh
npm run dev
```

Vite prints the local URL to open. The page renders the seeded Millford Valley
geography in a PixiJS world canvas with a React control overlay. Drag the map
to pan, use the mouse wheel or map controls to zoom, and select a crossing,
market connection, resource, or settlement to inspect it. The **Fit** control
returns the complete map to view. Hide the controls when you need the full map
for construction or inspection. Choose **Build road** and drag across the map
to construct a segment; endpoints snap to settlements, resources, the market,
nearby roads, and junctions. Choose **Remove road** and select a player-built
segment to delete it.

The quarry produces up to 120 tons of granite per day and the external market
demands up to 100 tons. Select either location to inspect production, demand,
the assigned road route, shipped volume, and the current limiting factor.
Freight remains at zero until the terminals are connected by a viable route.
Once freight is assigned, orange private trucks animate from the quarry to the
market along the selected route. Each truck represents up to 20 tons of assigned
daily flow, so busier viable routes show more traffic without creating persistent
shipment agents.

Millford and Eastbank now compete for a bounded 100-resident regional growth
allocation. Give a settlement useful road access and advance time: development
is evaluated weekly, selected construction takes another week to complete, and
new homes appear around the successful settlement. Select a settlement to inspect
its population, development pressure, status, pending construction, and latest
location decision. The decision view identifies the strongest support and
constraint, shows the exact weighted market, labor, resource, and service inputs,
compares transport and land assumptions, and names the candidate selected by the
seeded weekly choice. The same view remains available on the unsuccessful
settlement. Removing access applies pressure immediately and causes only gradual
weekly decline in infrastructure-enabled growth; the original settlement remains.

Use **Save local** and **Load local** to keep one scenario save in
the current browser. **Export file** downloads a portable versioned JSON save,
and **Import file** validates and loads one of those files.

## Repository checks

```sh
npm test
npm run typecheck
npm run build
```

Vitest uses its Node environment for simulation tests, so the simulation can be exercised without a DOM, React, or PixiJS renderer.

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

# Infrastructurio

> **You build the infrastructure. The simulation uses it and builds around it.**

Infrastructurio is an infrastructure simulation game about creating opportunity rather than placing a finished city. The player designs roads, lanes, junctions, railways and stations in detail, while households, businesses, private transport operators and towns decide how to use them.

Successful infrastructure attracts development. Development creates traffic, land pressure, and new dependencies. Those consequences produce the next problem for the player to solve.

## Direction

The next prototype centres on detailed road, junction, track and station design. Vehicles and train services operate autonomously; towns grow and add constrained local streets. Real queues and journey reliability change accessibility, and development generates new trips.

The agreed sequence is **M4: design and technical evidence → M5: open-ended road/growth prototype → M6: autonomous rail**. See the [vision](docs/vision.md), [roadmap](ROADMAP.md), [prototype contract](docs/next-prototype-plan.md) and [linked backlog](docs/next-prototype-backlog.md).

## Current build

The runnable foundation on main uses aggregate road freight and representative animation. Additional M3 work exists on separate branches and must be audited before reuse. It is a reuse base; detailed lane movement and autonomous train dispatch are planned, not implemented by this direction update. The run instructions describe the existing Millford scenario.

## Prototype direction

The intended prototype stack is:

- TypeScript and Vite
- PixiJS for the 2D world
- React for management UI
- A deterministic, renderer-independent simulation core
- A Web Worker boundary for simulation processing
- IndexedDB and exportable files for saves
- Vitest for behavioral simulation tests

This is a direction, not a permanent technology commitment. Architecture decisions are recorded in [the ADR index](docs/decisions/README.md).

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
for construction or inspection. Choose **Build arterial** or **Build highway**
and drag across the map to construct that road class; endpoints snap to
settlements, resources, the market, nearby roads, and junctions. Choose
**Remove road** and select a player-built segment to delete it.

The quarry produces up to 120 tons of granite per day and the external market
demands up to 100 tons. The simulation reassigns that demand every eight simulated
hours. Road class sets free-flow speed and practical capacity; an overloaded
route gains delay and may later lose traffic to a lower-cost bypass. Select either
location to inspect production, demand, the assigned road route, shipped volume,
and the current limiting factor.
When assigned flow exceeds capacity, the current freight route is highlighted in
amber and the overloaded link in red. Select the highlighted road or Millford
Crossing to separate its demand, capacity, and route-choice causes and see the
affected freight. Upgrade the crossing segment to highway capacity to retain the
route, or draw a connected highway bypass and advance time until the next
eight-hour assignment redirects traffic. The prototype does not yet have a
construction budget: the meaningful difference is whether capacity stays on the
existing corridor or access and freight shift to a new one.
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

**M4 — Infrastructure Design Foundations:** evaluate construction presentation, prove causal traffic and audit reuse before building the M5 road loop. Earlier M3 work remains tracked separately; GitHub is authoritative for its completion status.

## Current M4 handoff

See [M4 status, run instructions and continuation script](docs/M4-HANDOFF.md) before restarting the construction proof.

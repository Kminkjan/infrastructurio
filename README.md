# Infrastructurio

> **You build the infrastructure. The simulation uses it and builds around it.**

Infrastructurio is an infrastructure simulation game about creating opportunity rather than placing a finished city. The player designs roads, lanes, junctions, railways and stations in detail, while households, businesses, private transport operators and towns decide how to use them.

Successful infrastructure attracts development. Development creates traffic, land pressure, and new dependencies. Those consequences produce the next problem for the player to solve.

## Direction

The next prototype centres on detailed road, junction, track and station design. Vehicles and train services operate autonomously; towns grow and add constrained local streets. Real queues and journey reliability change accessibility, and development generates new trips.

The agreed sequence is **M4: design and technical evidence → M5: open-ended road/growth prototype → M6: autonomous rail**. See the [vision](docs/vision.md), [roadmap](ROADMAP.md), [prototype contract](docs/next-prototype-plan.md) and [linked backlog](docs/next-prototype-backlog.md).

## Current build

The runnable M0–M3 foundation below uses aggregate road/rail flows and representative animation. It is a reuse base; detailed lane movement and autonomous train dispatch are planned, not implemented by this direction update. The run instructions describe the existing Millford scenario.

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
market connection, resource, stoneworks, or settlement to inspect it. The **Fit** control
returns the complete map to view. Hide the controls when you need the full map
for construction or inspection. Choose **Build arterial** or **Build highway**
and drag across the map to construct that road class; endpoints snap to
settlements, resources, the market, nearby roads, and junctions. Choose
**Remove road** and select a road segment to delete it.

Choose **Build track** and drag a rail corridor between the quarry,
stoneworks, market, existing track, or rail junctions. Place the three compatible
freight terminals from the rail controls; a terminal becomes routable only when
track reaches its anchored site. **Remove rail** deletes selected track or a
terminal. Track, terminals, rail selection, and the cyan track preview are
visually distinct from roads. Inspect rail infrastructure to see its capacity,
free-flow time, construction cost, daily maintenance, and removal salvage. Rail
freight terminals are co-located with their compatible sites, so a complete rail
service has no additional road access or egress in this prototype.

The scenario begins with the old local-capacity Millford bridge, short approaches,
an otherwise incomplete quarry–stoneworks–market network, dormant stoneworks,
two settlements, and a $60,000 treasury. The simulation-owned objective tracker
first asks you to inspect the three supply-chain sites, then follows activation,
bridge pressure, a second intervention, and a three-day stabilization period.
Dragging a road shows the
simulation-owned construction breakdown before release, including base work,
Eastbank land acquisition, and constrained river work. Inspect a road to preview
its highway-upgrade cost and removal salvage. Unaffordable construction is
rejected without changing the network. The finance summary reports capital
spending, finished-stone operating revenue, current road-and-rail daily
maintenance, and any
emergency-finance penalty.

Granite Ridge Quarry produces up to 120 tons of raw granite per day. It must first
reach the bounded Millford Stoneworks, which can store 240 tons of input, process
100 tons per day, and store 160 tons of finished stone. The Eastern External
Market then buys up to 100 tons of finished stone per day. Connect quarry to
stoneworks and stoneworks to market, then advance time: inventories and processing
update once per simulated day, while each active road flow can reconsider its
route every eight simulated hours. Select any terminal to inspect both legs,
inventory, processing, route cost, and authoritative limiting factors.
When assigned flow exceeds capacity, the current freight route is highlighted in
amber and the overloaded link in red. Select the highlighted road or Millford
Crossing to separate its demand, capacity, and route-choice causes and see the
affected freight. Upgrade the crossing segment to highway capacity to retain the
route, or draw a connected highway bypass and advance time until the next
eight-hour assignment redirects traffic. Finished-stone deliveries earn bounded
revenue at the same daily boundary that charges road and crossing maintenance. A
recovery bond becomes available below $15,000, adds $15,000, and permanently
adds a visible $150 daily penalty. Further bonds require the treasury to fall
below the threshold again, and their penalties stack.
Use the 8-hour, one-day, and one-week time controls to match traffic-assignment,
daily economy and maintenance, and weekly development pacing. The cadence panel
shows exactly when each authoritative update will occur. A bounded consequence
forecast runs the same deterministic reducers on an isolated copy of the current
state and reports the next assignment, daily economy/finance, and weekly
development outcomes if time advances without another intervention. Success requires both
freight legs, completed infrastructure-enabled growth, a relieved bridge or
shifted freight flow, and a treasury that can cover the next maintenance and
bond-penalty charge for three consecutive daily boundaries. The ending compares
the intervention, costs, modal freight split, bridge condition, and settlement
accessibility changes, and offers a deterministic replay. Reset also remains
available after a poor plan; emergency-bond penalties disappear only because the
entire authored starting state is restored.
After bridge pressure has been observed, settlement inspectors compare current
Millford and Eastbank accessibility with the values immediately before the most
recent infrastructure edit. Active inbound and outbound routes use distinct map
overlays, overloads retain a separate outlined marker, and the visible map key
and canvas text equivalent describe the same movements and pressure.
Each freight leg remains at zero until its terminals have a viable route and the
daily economy has goods available to move. Orange private trucks animate along
road routes, while teal private trains animate along rail routes. Each vehicle
represents up to 20 tons of assigned daily flow, so busier viable routes show
more traffic without creating persistent shipment agents. Operators compare road
and rail generalized cost, capacity, congestion, terminal handling, and
co-located access/egress every eight simulated hours and immediately after a
relevant infrastructure edit. The freight inspector exposes the exact comparison,
route links, limiting values, and the scheduled or immediate changes that can
make an alternative win.
Realized stoneworks processing also adds a bounded labor opportunity near
Millford, feeding the same accessibility and delayed-development model as other
opportunities.

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
npm run measure:m3
```

Vitest uses its Node environment for simulation tests, so the simulation can be exercised without a DOM, React, or PixiJS renderer.

## Project documentation

- [Vision and scope](docs/vision.md)
- [Core gameplay loop](docs/gameplay-loop.md)
- [Simulation model](docs/simulation-model.md)
- [Technical architecture](docs/technical-architecture.md)
- [Performance strategy](docs/performance-strategy.md)
- [M3 release validation and playtest](docs/m3-release-validation.md)
- [Roadmap](ROADMAP.md)
- [Initial issue backlog](docs/initial-backlog.md)
- [Glossary](docs/glossary.md)
- [Contributing](CONTRIBUTING.md)

## Current milestone

**M4 — Infrastructure Design Foundations:** evaluate construction presentation, prove causal traffic and audit reuse before building the M5 road loop. Earlier M3 work remains tracked as historical scope; GitHub is authoritative for its completion status.

# Simulation Model

This document describes the intended conceptual model. Equations, thresholds, and implementation details are expected to change through prototyping.

## Simulation layers

### Regional demand

The region has bounded demand for population, employment, production, and trade. Demand changes through migration, economic cycles, external markets, and scenario events.

Infrastructure does not create unlimited population. It determines which opportunities are viable and where regional growth is captured.

### Accessibility

Locations are evaluated through generalized access costs rather than straight-line distance. Relevant measures include:

- Reachable workers and jobs
- Travel time to consumers and services
- Cost and reliability of reaching suppliers and resources
- Cost of reaching external markets
- Available infrastructure capacity
- Interchange and terminal penalties

Accessibility is recalculated incrementally when the network or persistent congestion changes.

### M1 accessibility research prototype

The first accessibility experiment evaluates the existing Millford and Eastbank
settlement seeds as candidate locations. It reports separate market, labor,
resource, and service values. Every opportunity contribution decays with shortest
road-network cost; straight-line distance is not a scoring fallback, and an
unreachable opportunity contributes zero. Each factor also retains its nearest
reachable network cost and number of reachable opportunities for inspection.

These values are derived simulation state. They are rebuilt from scenario and
road state after load rather than added to the save format. The initial
opportunity weights are explicit research assumptions rather than economic
quantities, and the values do not yet cause development. The experiment and its
limitations are recorded in
[`research/accessibility-scoring.md`](research/accessibility-scoring.md).

### Location choice

Households, developers, and industries compare candidate locations. A conceptual score is:

```text
opportunity
+ market access
+ labor access
+ local amenities
- transport cost
- land cost
- congestion
- pollution and risk
```

Scores produce weighted choices rather than always selecting the mathematical maximum. Inertia, moving costs, construction time, and imperfect information prevent instant reshuffling.

### M1 settlement growth prototype

The first growth implementation treats Millford and Eastbank as competing
residential development candidates. Their existing settlement seeds represent
base populations of 60 and 40 residents. Infrastructure-enabled growth is a
separate authoritative value so decline never erases that original settlement.

Every seven simulated days, positive development pressure becomes a weighted
location-choice input:

```text
pressure = 0.35 * market access
         + 0.30 * labor access
         + 0.20 * resource access
         + 0.15 * service access
         - 35 viability points
```

A deterministic value derived from the scenario seed and evaluation number
selects among all candidates with positive pressure. A stronger candidate is
more likely to win, but does not receive every project automatically. One
selected project houses up to 10 residents and takes seven simulated days to
complete. Completed and pending projects together may never exceed the scenario's
100-resident regional growth demand.

Network edits update pressure immediately. If a location loses viability, its
pending project is cancelled while completed growth remains in place. Later
weekly evaluations reduce only that infrastructure-enabled growth by five
residents at a time. This is an intentionally small pressure-and-decline model;
it has no households, land market, building types, relocation destinations, or
industry-specific resource requirements yet. The accessibility inputs also
retain the proxy weights documented in the research note. Detailed decision
explanations belong to issue #10.

## Settlements and buildings

A settlement is an emergent cluster, not an object placed by the player. It gains an identity when development density and shared access patterns cross a threshold.

Economic calculations may occur at parcel-cluster or district level. Individual buildings represent those aggregate values visually and provide inspectable history.

Building actions include:

- Construct
- Expand
- Change use
- Decline
- Demolish and redevelop

## Industries and goods

Industries transform inputs into outputs and require labor, land, infrastructure, and market access. Prototype supply chains should remain short enough to diagnose.

Example:

```text
quarry -> stone processing -> regional construction demand
farm -> food processing -> households and external market
```

Production and shipment decisions can be aggregated by day. Visible trucks and trains represent portions of those flows rather than every physical consignment.

## Traffic and route choice

Travel demand is generated between zones or economic actors. Routes minimize generalized cost, including:

- Free-flow travel time
- Congestion delay
- Tolls and operating cost
- Transfer penalties
- Reliability penalties
- Mode restrictions

Traffic assignment may update less frequently than rendered vehicle motion. Representative vehicles are sampled from assigned flows.

### M0 road topology

The authoritative road network distinguishes player-authored segments from the
graph links derived from them. Segment endpoints and at-grade intersections form
nodes; intersections split every affected segment into routable links. Queries
currently minimize geometric distance because road class, speed, capacity,
congestion, tolls, and restrictions belong to later milestones.

Deleting a player-authored segment removes all links derived from it and rebuilds
the remaining topology. The M0 graph intentionally does not model collinear
overlaps, grade-separated crossings, curved roads, or configurable junctions.

### M0 aggregate quarry freight

The Millford Valley quarry-to-market flow is a daily aggregate rate rather than
an inventory or a collection of persistent shipments. The quarry offers at most
120 tons of granite per day, while the external market requests at most 100 tons
per day. No freight is assigned unless the road graph contains a route whose
end nodes coincide with the quarry and market terminals.

For this first proof, generalized route cost equals geometric route length. A
route at or below 1,000 cost units can carry all otherwise available freight.
Between 1,000 and 2,000 units, shipped volume declines linearly; at 2,000 units
the route becomes unviable. These explicit scenario values are balancing inputs,
not a capacity or congestion model. The freight snapshot records the route and
the same production, demand, cost, and limiting-factor values shown by the
inspector.

### M0 representative freight traffic

Visible quarry trucks are presentation samples of the assigned daily freight
rate, not authoritative shipments. The renderer resolves the freight snapshot's
ordered route nodes into a polyline and displays one representative vehicle per
20 shipped tons per day, rounded up for any positive flow. Samples move at a
presentation speed of 90 map units per real-time second.

Each sample is removed when it reaches the market and a later visual trip starts
at the quarry. A changed route or shipped volume replaces the current visual
sampling plan; a missing or unviable route clears it. These animation phases are
intentionally absent from simulation snapshots and saves.

## Private operators

Vehicles belong to simulated operators. Operators respond to demand, infrastructure compatibility, operating cost, capacity, and policy.

The player influences them through infrastructure and rules rather than dispatching individual vehicles. Later systems may include track access, service subsidies, weight limits, electrification, and minimum-service contracts.

## Autonomous local roads

The default autonomy boundary is:

- The simulation may build driveways, local streets, and small access junctions.
- The player builds arterials, highways, major crossings, railways, and terminals.
- Towns may propose collector roads or upgrades for player approval.

Local road generation must respect terrain, protected corridors, maximum road class, intersection rules, and development boundaries.

## Explanation model

Important simulation outcomes retain their strongest causes. An inspector should be able to explain, for example:

> Rail reduced export cost, nearby farmland supplies inputs, and 2,800 workers are reachable within 35 minutes. High land cost is the largest constraint.

Explanations should be derived from the same values used for decisions, not generated independently after the fact.

## Simulation time

Different systems use different clocks:

- Rendering: every animation frame
- Representative vehicles: several times per second
- Traffic assignment: every few simulated hours or after material network changes
- Production and inventories: daily
- Development evaluation: weekly
- Migration and land values: monthly
- Regional economy: quarterly

# Historical Roadmap: M0–M3

The roadmap is organized around playable proofs. A milestone is complete when its player-visible claim is demonstrated, not merely when a list of systems exists.

## M0 — Simulation Toy

**Claim:** Infrastructure placed by the player can be used by autonomous traffic.

The player can navigate a small generated map, connect a resource to an external market, and observe representative private freight traffic taking a valid route.

Proof points:

- A deterministic valley scenario loads.
- The camera can pan, zoom, and select map elements.
- The player can construct and remove a simple road.
- Roads form a routable graph.
- A resource producer and external market exchange goods.
- Representative private vehicles visualize aggregate freight flow.
- Save and load preserve the scenario state.

## M1 — Emergent Settlement

**Claim:** Better accessibility creates believable development in sensible places.

The simulation calculates access to jobs, resources, markets, and labor. At least one settlement and one industry can appear or expand because player-built infrastructure changes those values.

Proof points:

- Locations receive inspectable accessibility scores.
- Regional demand limits total growth.
- Development chooses among candidate locations.
- Buildings visually represent population, employment, and industry.
- A location inspector explains why development occurred.
- The simulation may add constrained local streets around development.

## M2 — Bottleneck Loop

**Claim:** Successful development creates a legible infrastructure problem that supports multiple solutions.

Traffic responds to capacity and congestion. The player can identify an overloaded connection and improve, bypass, price, or redirect it. Growth and route choice respond over time.

Proof points:

- Link capacity affects travel time and generalized cost.
- Congestion and queues are visible.
- A bottleneck inspector identifies causes and affected flows.
- At least two interventions can solve the initial bottleneck.
- Interventions have different costs or secondary consequences.
- Development responds with delay rather than relocating instantly.

## M3 — Millford Valley Vertical Slice

**Claim:** The complete premise sustains an understandable 20–30 minute scenario.

The map contains two settlements, a quarry, fertile land, and an external market. The player enables a supply chain, observes growth, encounters a bridge bottleneck, and reshapes the region through a second strategic intervention.

Proof points:

- A guided but replayable scenario has a clear beginning and end state.
- The economy includes at least one multi-step production chain.
- Private road and rail operators respond to infrastructure.
- Construction, maintenance, and land costs constrain decisions.
- Simulation explanations make important outcomes understandable.
- Performance remains smooth at the intended prototype scale.

The playable scenario contract and delivery order are defined in
[M3 Millford Valley Vertical Slice](m3-vertical-slice-plan.md).

## Later — Scalable Prototype

Possible work after the vertical slice:

- Larger maps and hierarchical routing
- Additional infrastructure modes and utilities
- Multiple towns with local governance
- More economic sectors and external trade
- Policies, tolls, subsidies, and service requirements
- Map generation and scenario tools
- Modding and data-driven content

These are intentionally not commitments until the vertical slice validates the game.


The September 2026 direction in `../ROADMAP.md` supersedes this delivery sequence. These milestones remain historical evidence, not prerequisites for the next prototype.

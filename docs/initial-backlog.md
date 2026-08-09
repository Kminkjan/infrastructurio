# Initial Issue Backlog

This is the bootstrap source for the first GitHub issues. Once the issues have been created remotely, GitHub becomes authoritative for their status and discussion; this document continues to explain why the initial set was chosen.

## M0 — Simulation Toy

### 1. Scaffold the web prototype

**Goal:** Produce a runnable foundation using TypeScript, Vite, React, PixiJS, and Vitest while keeping the simulation independent from presentation.

Acceptance criteria:

- The application starts locally with one documented command.
- A PixiJS canvas and React overlay render together.
- `simulation`, `rendering`, `app`, and `shared` have explicit module boundaries.
- A headless simulation test runs without constructing UI or rendering objects.

Labels: `type: feature`, `area: tooling`, `priority: now`

### 2. Generate the deterministic Millford Valley test map

**Goal:** Load the same minimal valley geography for a given seed.

Acceptance criteria:

- The scenario contains a river, constrained crossing area, quarry, fertile land, two settlement seeds, and external market connection.
- The same seed produces identical simulation geography.
- Scenario data is separate from renderer code.

Labels: `type: feature`, `area: simulation`, `priority: now`

### 3. Implement map navigation and selection

**Goal:** Let the player comfortably inspect the prototype world.

Acceptance criteria:

- The player can pan and zoom without losing the map.
- Infrastructure, resources, and settlements can be selected.
- Selection is represented in both the renderer and a minimal React inspector.
- Navigation remains responsive at the M0 target object count.

Labels: `type: feature`, `area: rendering`, `priority: now`

### 4. Build and edit a routable road graph

**Goal:** Convert player road construction into authoritative network connectivity.

Acceptance criteria:

- The player can draw and remove a simple road segment.
- Intersections create graph nodes and split affected links.
- A route query finds a valid path between connected points.
- Removing a required segment makes that route unavailable.
- Graph behavior has deterministic tests.

Labels: `type: feature`, `area: infrastructure`, `priority: now`

### 5. Model aggregate quarry-to-market freight

**Goal:** Demonstrate autonomous economic use of player infrastructure.

Acceptance criteria:

- The quarry produces bounded daily output.
- The external market creates demand for that output.
- Freight is generated only when a valid route exists.
- Route cost affects shipped volume or viability.
- An inspector exposes production, demand, route, and limiting factor.

Labels: `type: feature`, `area: simulation`, `priority: now`

### 6. Render representative private freight traffic

**Goal:** Make aggregate freight flow visible without treating every shipment as a persistent agent.

Acceptance criteria:

- Representative vehicles are sampled from assigned freight flow.
- Vehicles follow the selected route and disappear cleanly at destinations.
- Changing or disconnecting the route updates visible traffic.
- Rendering density is visibly related to aggregate flow.

Labels: `type: feature`, `area: rendering`, `priority: now`

### 7. Save and load the M0 scenario

**Goal:** Preserve an authored network and simulation state across sessions.

Acceptance criteria:

- Saves contain an explicit format version and scenario seed.
- Local save and load work through IndexedDB.
- A save can be exported and imported as a file.
- A round-trip test preserves roads, time, and economic state.

Labels: `type: feature`, `area: tooling`, `priority: next`

## M1 — Emergent Settlement

### 8. Prototype generalized accessibility scoring

**Goal:** Determine whether a small set of access measures can explain plausible location differences.

Acceptance criteria:

- Candidate locations receive market, labor, resource, and service access values.
- Network travel cost—not straight-line distance—drives those values.
- Only affected locations are invalidated after a local network edit.
- A short research note records which factors produced useful behavior and which did not.

Labels: `type: research`, `area: simulation`, `priority: next`

### 9. Grow development from accessibility and regional demand

**Goal:** Cause one settlement or industry to expand because new infrastructure improves its viability.

Acceptance criteria:

- Regional demand bounds total growth.
- Multiple candidate locations compete for development.
- Seeded weighted choice avoids identical optimal placement while remaining reproducible.
- Construction occurs with delay.
- Removing access causes pressure or decline rather than immediate disappearance.

Labels: `type: feature`, `area: simulation`, `priority: next`

### 10. Explain location and development decisions

**Goal:** Let the player understand why development occurred in one location rather than another.

Acceptance criteria:

- The inspector reports the strongest positive and negative decision factors.
- Explanations use the same values as the underlying decision.
- Market, labor, resource, transport, and land factors have understandable units or comparisons.
- The player can inspect an unsuccessful candidate location.

Labels: `type: feature`, `area: ui`, `priority: next`

## M2 — Bottleneck Loop

### 11. Model road capacity and congestion cost

**Goal:** Allow successful freight and development to degrade an overloaded connection.

Acceptance criteria:

- Road class determines capacity and free-flow travel time.
- Assigned flow above practical capacity increases generalized cost.
- Persistent congestion can change route or location decisions.
- Congestion updates at a lower frequency than vehicle animation.
- A deterministic test covers an overloaded bridge.

Labels: `type: feature`, `area: infrastructure`, `priority: later`

### 12. Diagnose and resolve the bridge bottleneck in two ways

**Goal:** Prove that the central bottleneck-fixing gameplay supports a meaningful choice.

Acceptance criteria:

- A map overlay identifies the overloaded bridge and affected flows.
- The inspector distinguishes demand, capacity, and route-choice causes.
- At least two interventions materially reduce the problem.
- The interventions differ in cost, affected traffic, or development consequences.
- The world responds over simulated time after the intervention.

Labels: `type: feature`, `area: ui`, `area: infrastructure`, `priority: later`

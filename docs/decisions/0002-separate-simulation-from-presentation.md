# 0002 — Separate simulation from presentation

- Status: Accepted
- Date: 2026-08-09

## Context

The simulation must support deterministic tests, saving, fast-forwarding, background execution, and potentially a different renderer or implementation language later.

## Decision

The simulation core will be authoritative and presentation-independent. UI and rendering communicate with it through typed commands, queries, events, and snapshots.

The simulation core must not depend on React, PixiJS, or browser DOM APIs.

## Consequences

Positive:

- Simulation behavior can be tested without a browser canvas
- Moving computation into a Web Worker is straightforward
- Rendering can interpolate without changing authoritative state
- Save formats and replays have a clear ownership boundary
- Performance-critical algorithms may later be replaced independently

Costs:

- Commands and snapshots require deliberate protocol design
- Duplicate presentation state must be synchronized carefully
- Simple early features may require more structure than direct mutation

## Revisit when

This decision should be treated as a core constraint. Individual protocol choices may change, but presentation should not become authoritative simulation state.


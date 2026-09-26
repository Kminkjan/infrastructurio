# 0001 — Build the prototype for the web

- Status: Accepted
- Date: 2026-08-09

## Context

The project must test an unusual simulation loop quickly. Iteration speed, inspectability, and easy distribution are more important than maximum theoretical scale during the prototype.

## Decision

Build the first playable prototype as a browser application using TypeScript and Vite. Use PixiJS for the 2D world and React for management UI.

## Consequences

Positive:

- Fast development and reload cycle
- Easy sharing without installation
- Strong DOM tooling for information-heavy UI
- Web Workers provide a clear path for background simulation
- A static build can be hosted inexpensively

Costs and risks:

- Browser memory and threading constraints may limit eventual scale
- Care is required to keep rendering, UI, and simulation state separate
- Very CPU-heavy algorithms may later need typed arrays or WebAssembly

## Revisit when

The vertical slice is validated and profiling demonstrates that browser constraints—not the simulation design or implementation—prevent the intended product scale.

# 0007 — Present the isolated construction tool with an SVG plan editor

- Status: Proposed
- Date: 2026-09-07
- Scope: #52/#53 construction experiment only
- Tracking: [#52](https://github.com/Kminkjan/infrastructurio/issues/52), [#53](https://github.com/Kminkjan/infrastructurio/issues/53), parent #50
- Evidence: [Implementation and browser observations](../research/m4/construction-controls.md)
- Decision authority: Pending scoped PR review
- Supersedes: None
- Superseded by: None

## Context

The immediate question is whether a person can build and edit the model from #51
through ordinary controls. The existing Pixi renderer consumes SimulationSnapshot,
legacy feature selection and representative freight state. Its planar road tools
cannot express authored endpoints, road-local plateaux or explicit lane targets.
ADR 0004 accepted a bounded paired research reference, not a production renderer.

## Decision

Propose a separate React/SVG document at `/construction.html`. SVG consumes only
immutable derived geometry and forwards authored commands. Native buttons, selects
and checkboxes expose presets, lane counts, elevation, previews and assignments.
Pointer clicks place snapped endpoints and section boundaries; round endpoint
handles select automatic joins. An explicit Commit preview action makes rejection,
cancellation and dependent deletion reviewable. Camera and tool changes are view
state and do not enter model history.

Use a small SVG viewBox camera. The existing `map-camera.ts` is pure and useful as
an example, but clamps against a positive-origin rectangular gameplay map with a
fixed fit/zoom ratio. This experiment uses signed XY metres, mathematical Y-up and
freely panned construction space. Adapting those assumptions would add mapping
machinery without reusing its bounds contract. The new camera retains the familiar
pan/zoom interaction, with a 200–4000 m view width and an initial 1200 m overview.
The 10 m grid remains visible; 100 m major lines establish scale. Zoom is centered
on the viewport, not the cursor. Pointer drag is explicit in Pan mode; middle-button
panning is also handled but was not tested on physical hardware.

## Alternatives considered

- Adapting the existing Pixi WorldRenderer would pull legacy simulation and
  selection assumptions into an isolated construction task. Extracting a general
  renderer is unnecessary for this bounded question.
- A new Pixi adapter could share the dependency but would still need new picking,
  labels and selection. SVG offers DOM hit targets and native controls without
  another mutable scene authority. This is not a performance comparison.
- The old Three/Pixi research adapters demonstrate views, but use hand-authored
  fixture geometry and test-oriented selection. They do not supply this editor.
- A perspective 3D tool could clarify elevation but would add occlusion and camera
  choices before the construction sequence is usable. Here elevation is encoded
  with color and metre labels. Human assessment of that compromise remains open.

## Consequences and acceptance boundaries

The editor has no traffic, persistence, growth, money, rail or legacy imports. The
normal Vite build emits a separate construction document; the gameplay entry does
not import this model. Source is intentionally experimental rather than a production
presentation abstraction. The initial site is empty and reload resets its memory.

Automated browser work exercised visible controls, including an alternative lane
target and full undo. It is not an owner/human walkthrough. The ordinary endpoint
handles needed larger hit areas during testing. Road placement and section picking
still require a pointer; keyboard-only spatial construction and screen-reader map
navigation are incomplete. Native controls and endpoint activation support keyboard
input, with Escape and Ctrl/Cmd+Z available inside the editor. Touch, narrow-screen
usability and physical mouse/trackpad differences remain unverified.

#26/#28 production renderer decisions and #55 acceptance remain open. The old paired
human exercise is deferred, not passed. No production renderer acceptance or timing
claim follows from this proposal.

## Revisit when

#55 observations show poor lane/elevation readability, practical input problems,
or profiling at the model's 32-road bound justifies a different renderer/camera.

## History

- 2026-09-07: Proposed for combined #52/#53 implementation; allocation checked
  against baseline decision index ending at 0006.

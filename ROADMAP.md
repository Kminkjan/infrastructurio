# Roadmap

The September 2026 direction makes detailed infrastructure design the main activity, with autonomous transport and development creating emergent challenges. Milestones close on playable evidence, not feature counts. No calendar deadlines are implied.

## M4 — Infrastructure Design Foundations

[GitHub milestone](https://github.com/Kminkjan/infrastructurio/milestone/5)

**Claim:** We have demonstrated a usable construction approach and a causal traffic model suitable for the small-region prototype.

Evaluate readable 2D versus 3D with identical curved-road, elevated-crossing and lane-selection tasks. Prove lane occupancy, queues and representative-vehicle accounting in a headless experiment. Audit reusable M0–M3 systems and define migration boundaries. Record the rendering decision, simulation units, target fixture size and measured performance budget before full implementation.

The [focused construction epic #50](https://github.com/Kminkjan/infrastructurio/issues/50)
adds an isolated grid-assisted proof: draw two roads → create one curved connection
→ widen one approach → assign its lanes → undo the changes. Issues #51–#54 prepare
geometry, controls, section/lane editing and the reference site; #55 verifies and
accepts the actual workflow before scope expands. The old paired-adapter human
exercise is deferred, not passed. Renderer/camera acceptance remains open.

This is an enabling milestone, not the first complete playable game loop.

## M5 — Roads Shape a Growing Region

[GitHub milestone](https://github.com/Kminkjan/infrastructurio/milestone/6)

**Claim:** Detailed road design changes real traffic behaviour, which changes development and produces new design problems.

Deliver freeform editable roads, independent directional lane counts, lane connections, priorities, basic signals, bridges and underpasses. Integrate causal vehicle movement, autonomous trips, residential/commercial/industrial development and constrained town street growth. Provide forgiving finances, useful defaults, inspection and saving. Validate an open-ended small region with at least two viable junction interventions and no forced ending.

M5 is the first integrated playable milestone. Internal construction and traffic slices are steps toward it, not a substitute for growth integration.

## M6 — Autonomous Rail Shapes the Region

[GitHub milestone](https://github.com/Kminkjan/infrastructurio/milestone/7)

**Claim:** Player-built tracks and stations attract autonomous train services, and rail design changes service quality and regional growth.

Add editable tracks, switches, platforms, basic block signals and road access to stations/terminals. Operators choose viable routes, service frequency, train size and dispatch. Train occupancy and conflicts affect reliability, modal choice and development. Prove a small passenger and freight example, including an unused station with an inspectable reason and a service improved through infrastructure alone.

## Sequencing and scope

M4 evidence gates implementation choices for M5. M5 must demonstrate the road feedback loop before M6 expands the playable scope. [Prototype plan](docs/next-prototype-plan.md) defines acceptance and technical boundaries. [Issue backlog](docs/next-prototype-backlog.md) provides work breakdown, dependencies and GitHub links.

## Earlier work

[M0–M3 roadmap](docs/roadmap-m0-m3.md) and [M3 plan](docs/m3-vertical-slice-plan.md) remain historical context. Existing implementations are candidates for reuse, not evidence that lane-level traffic or autonomous train dispatch already exists. GitHub is authoritative for issue status. M3 completion and reconciliation are separate from the new prototype’s acceptance.

## Beyond this prototype

Larger regions, more transport modes, deeper economies and policy tools depend on evidence from M5 and M6. Vehicle fleet management and player dispatch are outside the agreed player role.

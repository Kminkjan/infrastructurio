# 0011 — Signalling and reservation

- Status: Proposed
- Date: 2026-09-26
- Scope: Prototype. Sections, conflict groups, directed sections and blocks in
  `src/core/network/derive.ts`; reservation and deadlock detection in `src/core/signals/`;
  wait reasons in `src/core/services/reasons.ts`; aspects and overlays in `src/render`
- Tracking: M4 epic "M4 — Epic: Living Diorama" (TBD); D5 (TBD), D7 (TBD), D8 (TBD),
  D9 (TBD)
- Evidence: design pass, 2026-09-26; nothing implemented. Road-era lane-fixture
  observations ([#27](https://github.com/Kminkjan/infrastructurio/issues/27)) are cited under
  Context as history only
- Decision authority: Pending (proposed 2026-09-26)
- Supersedes: None
- Superseded by: None

## Context

In M4 the player builds the layout and places the signals; trains and services are
autonomous ([vision](../vision.md)). Signalling therefore has to be safe on any layout the
player can build, including one with no signals at all, and it has to explain itself: "why
is this train waiting?" needs a precise answer that names a signal, a section and a blocking
train. It must also be deterministic ([ADR 0012](0012-tick-units-determinism.md)) and fair,
so that no train waits forever behind luckier ones.

Two road-era observations shape the design (history, not evidence for this prototype): in
the blocked-exit case, a vehicle allowed to stop just past a junction fouled it with its
tail; and a fixed-priority merge starved one side.

## Decision

Reserve paths of track sections all-or-nothing, arbitrate first-come-first-served, and
detect and explain deadlocks rather than resolve them.

1. **Resources.** A section has a holder (a train ID, or −1). Sections split at switches,
   diamonds, buffers, signals, platform ends, depot stub boundaries and fan or diamond-zone
   boundaries. A **conflict group** (holder plus refcount) is a union-find over the sections
   of each turnout fan and diamond zone; a crossover's two fans share one group. A train
   must hold every section and every group on its path before it may enter it.
2. **Signal kinds: stop (block) and chain.** Blocks are the components cut at signals. They
   drive overlays and explanations; reservation works per section.
3. **Request extent.**
   - From a stop signal, a platform or a depot: to the next signal of any kind, or to the
     destination.
   - From a chain signal: through further chain signals to the next **stop** signal, or to
     the destination. A train is therefore never left waiting between a chain signal and
     the next stop signal, which keeps junctions clear.
   - Requests are all-or-nothing. A network with no signals is one extent, so one train per
     single-track line works without any signal.
4. **Trigger.** A train requests when its distance to end of authority (EOA) is ≤
   brakeDist(v) + 150 m. EOA is the end of its last held section, less 3 m when that end is
   a signal.
5. **Arbitration.** Requests are served FIFO, sorted by (firstRequestTick, trainId).
   Reservation runs after the operator and before movement in the tick order (ADR 0012).
   - A train tries its route candidates in order; this is how it picks a free platform.
   - A candidate is grantable when every resource is free or already held by that train,
     and none is in this tick's `wanted` set.
   - A denied request records `blockedBy` and adds its needs to `wanted`. These soft wants
     block only later requests, so later trains cannot keep taking what an earlier train is
     waiting for, and nothing starves.
6. **Release.** After movement, the sections behind a train's tail are released, and group
   refcounts drop with them.
7. **Aspects are display only.** A stop signal shows green when its next section is free or
   held by the approaching train. A chain signal shows partial when its first section is
   free but a later part is blocked. Movement obeys authority, never the aspect.
8. **One-way rule.** A train may pass a signal node in direction D only if a signal faces D
   or no signal faces −D. One signal makes its line one-way; opposing signals keep it
   two-way. One-way blocks always get chevrons in the overlay, and a section can report the
   reason `one-way`. Reversal is allowed only at platform stops and in depots.
9. **Deadlock: detect, explain, then back stop.** Every 10 ticks, build the wait-for graph
   from `blockedBy` and run Tarjan's strongly-connected-components algorithm.
   - A cycle that has not moved for 300 ticks (30 s) sets status `deadlock` and emits one
     event naming the trains, sections and signals, with a hint ("add a passing loop with
     signals").
   - At 1,200 ticks (120 s) the operator withdraws the highest-ID train in the cycle and
     logs it; the line is then capped with `capped-deadlock`
     ([ADR 0014](0014-autonomous-diorama-operator.md)).
   - Separately, a train with no progress for 90 s raises `waiting-long`.

Open: the capacity cost of whole-fan conflict groups, and the exact wording of explanations
(D9). Priorities for mixed traffic are outside M4.

## Alternatives considered

- **Occupancy-only blocks** (a train may enter a block when it is empty; no path
  reservation). Simpler, but without forward reservation there is no chain signal: nothing
  can hold a train before a junction until its exit is clear, so the blocked-exit case has
  no fix the player can build. Whole-block occupancy also serialises moves through separate
  junctions that share a block, and it cannot give the "reserved by" explanations the
  inspector needs.
- **Fixed priority** (for example by line or direction). Deterministic, but at a merge it
  starved one side in the road-era study (history, not evidence here). FIFO by
  (firstRequestTick, trainId) with soft wants is just as deterministic and is designed to
  keep waits bounded; golden scenario 4 must show that.
- **Automatic deadlock resolution** (reversing, rerouting, or banker's-style lookahead so
  that cycles never form). It would hide the player's design problem, whose cure is usually
  a passing loop with signals, and add complex behaviour that is hard to explain. M4
  detects and explains instead. The 120 s withdrawal is a logged operator back stop so the
  diorama never freezes, not a silent fix.

## Consequences

- **Safety by construction.** Holdings are exclusive and a train never moves past its EOA,
  so a collision would be an invariant violation. Tests check the invariants every tick:
  exclusive sections and groups, occupied ⊆ held, head ≤ EOA, no orphan holdings.
- **Explainable waits.** `blockedBy` feeds the train reasons `waiting-signal` (signal,
  blocking train, section) and `queued-behind`; sections report `free`, `reserved-by`,
  `occupied-by` or `one-way`.
- **Deterministic and fair.** The arbitration order depends only on tick and train ID.
- **Costs.** All-or-nothing chain extents hold long paths and cost capacity. Whole-fan
  conflict groups are coarse at complex junctions. Double slips are unsupported
  ([ADR 0010](0010-triangular-lattice-track-geometry.md)). The one-way rule can surprise
  players, hence the chevrons and the `one-way` reason. Deadlocks stay possible by design,
  and the withdrawal back stop changes the running diorama.
- **Follow-up.** D5 derives fans and conflict groups; D7 blocks, signals, the one-way rule,
  aspects and the blocked-exit fixture; D8 reservation, FIFO and the soak; D9 deadlock
  detection, explanations and the forced-deadlock scenario.

## Validation and acceptance boundaries

Nothing in this ADR is implemented yet (2026-09-26); it is a design. The road-era
observations motivated two fixtures but are not evidence here. Still to prove:
- D7: blocked exit, stop versus chain (golden scenario 3): a stop signal lets the tail foul
  the junction, while a chain signal waits outside;
- D8: FIFO at a junction alternates and the wait stays bounded (golden 4); a passing loop
  runs 2 trains for 2 simulated hours without deadlock (golden 2); a 10k-tick invariant
  soak;
- D9: a forced deadlock is detected within 30 s, a train is withdrawn at 120 s, and the line
  then reports `capped-deadlock` (golden 11);
- acceptance gate A's safety soak: 50 seeded layouts × 10 simulated minutes with 0
  double-held sections, 0 signals passed at danger and 0 overlaps.

The gates are predeclared in [the acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md).
None of these establishes that players understand stop, chain and one-way semantics. The
owner walkthrough speaks only for the owner; first-time-player evidence belongs to M5.

## Revisit when

- A soak or golden scenario shows starvation, unbounded waits or a double hold under FIFO
  with soft wants.
- Deadlocks or withdrawals dominate ordinary layouts in the owner walkthrough.
- Whole-fan conflict groups cost capacity the owner notices at junctions.
- Players misread chain or one-way semantics (the owner walkthrough, or the M5
  first-time-player session).
- M5 mixed traffic or M6 level crossings need priorities or road-rail interlocking; write a
  new ADR rather than defaulting to fixed priority.

## History

- 2026-09-26: Proposed in the rail-first reset PR that adds ADRs 0009–0014 ([#61](https://github.com/Kminkjan/infrastructurio/pull/61)); owner decision pending.

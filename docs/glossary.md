# Glossary

**Status 2026-09-26.** Terms for the rail-first prototype: M4 — Living Diorama, plus the
M5–M6 terms already in use. Main implements only the lattice
([`src/core/lattice.ts`](../src/core/lattice.ts)) and the sim → Three.js coordinate
convention ([`src/render/coords.ts`](../src/render/coords.ts)). Every other entry describes
the planned design. Its numbers come from the owner-approved M4 plan, specified in
[the simulation model](simulation-model.md) and in ADRs 0010–0014, which are Proposed. A
term listed here is not evidence that it is built, measured or accepted.

- **Player role.** No term here gives the player lines, timetables, dispatch or fleet
  purchase. Where a word sounds like a player control (line, train count, depot choice), it
  names something the simulation derives.
- **Units.** The core uses integer mm, mm/s and mm/s², and integer mm for node elevation
  (terrain stays Int16 dm; see [Elevation](#elevation)). Entries quote metres and km/h for
  readability.
- **Road-era terms** are not redefined here. They live at tag `legacy-m0-m4`, in the
  [archived glossary](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/glossary.md)
  (see the [archive README](archive/README.md)), and carry no meaning on main unless an
  entry below redefines them.

[A](#a) · [B](#b) · [C](#c) · [D](#d) · [E](#e) · [F](#f) · [G](#g) · [H](#h) · [I](#i) ·
[L](#l) · [M](#m) · [N](#n) · [P](#p) · [R](#r) · [S](#s) · [T](#t) · [U](#u) · [W](#w)

## A

### Accessibility (M5)

An M5 term, not yet specified. It means how well rail access and service quality connect a
settlement or industry to the region, which the [roadmap](../ROADMAP.md) makes the driver
of where towns grow. M4 has no towns and measures nothing of the kind. Do not confuse it
with UI accessibility, which is M4 scope: an aria-live status line, a keyboard lattice
cursor, reduced motion, UI scale 90–150% and a colour-blind-safe overlay set (known gaps:
no screen-reader map, no touch).

### Actor

An autonomous participant inside the simulation that makes its own decisions. In M4 these
are trains, moving within their [end of authority](#end-of-authority-eoa), and the
[diorama operator](#diorama-operator-m4-placeholder-behaviour). M5 adds settlements,
industries and regional operators. The player is not an actor: they issue construction
commands that the simulation validates. Not the same as an
[evidence label](#evidence-label).

### Aspect

What a signal displays. It is derived each tick from reservation state and is used for
display and explanation only: trains obey their end of authority, never the aspect. A stop
signal is green when the next section is free or held by the approaching train, otherwise
red. A chain signal can also show *partial*: first section free, a later part of its extent
blocked. Carried in `FrameView.signalAspect`.

### Authored vs derived state

- **Authored state** is what construction commands create and what saves and undo history
  store: pieces (by [piece key](#piece-key)), signals, platforms and depots.
- **Derived state** is everything `derive(authored)` computes from it: nodes and ports,
  turnouts, sections, conflict groups, blocks, directed sections and stations. `derive` is
  pure and independent of insertion order (pieces are sorted by key before IDs are
  assigned), and its output is cached per network revision.
- **Runtime state** (trains, holdings, the operator, time) is neither. It never enters undo
  history.

## B

### Block

A part of the network between signals (a component cut at signals). Blocks drive the block
overlay and explanations such as "block B-7 occupied by Train 3". The overlay uses six
colours plus a colour-blind-safe set, adds chevrons on one-way blocks and keeps colours
stable across unrelated edits. Trains reserve [sections](#section), not blocks.

### Block (stop) signal

The signal kind `stop`. A reservation requested from a stop signal (or from a platform or
depot) extends to the next signal of any kind or to the destination. A train can therefore
enter a block it cannot leave: in the blocked-exit fixture its tail fouls the junction
behind it. Put a [chain signal](#chain-signal) in front of junctions instead.

### Brake distance

`brakeDist(v)`: the stopping distance at speed v with planned braking of 600 mm/s²
(capability 900 mm/s²), about 231 m from 60 km/h. It sets the reservation trigger
(distance to EOA ≤ brakeDist(v) + 150 m) and the [committed zone](#committed-zone).

## C

### Chain signal

The signal kind `chain`. A request from a chain signal extends through further chain
signals to the next stop signal or the destination, all-or-nothing. The train therefore
waits at the chain signal until it can clear the whole junction area. Its aspect can show
partial. Spec: [simulation model](simulation-model.md), signalling
([ADR 0011](decisions/0011-signalling-and-reservation.md), Proposed).

### Clearance

Validation rule 6 of 8. `tracks-too-close` fires when two tracks are under 4.0 m apart in
plan AND under 6.5 m apart vertically; `vertical-clearance` covers stacked track. Shared
nodes, turnout fans and diamond arms are exempt. It is checked incrementally with a spatial
hash of 20 m cells; arcs are sampled at sagitta ≤ 0.05 m and padded by the same. Clearance
uses floats, so it is decided only at commit time and saves never re-validate. Bridge and
tunnel clearances are under [structure](#structure-ground-bridge-tunnel).

### Committed zone

The stretch a running train cannot give up: from its tail to max(head, head +
brakeDist(v) + 10 m). A stopped train commits only its footprint. An edit is accepted only
if every committed zone still maps onto existing, connected pieces with exclusive
holdings; otherwise it fails with [`track-in-use`](#track-in-use). Reservations beyond the
zone are then cut back and re-requested. Phasing: slice S11a rejects any edit touching a
held section; S11b adds committed-zone truncation.

### Conflict group

A shared reservation resource for sections that foul each other: union-find over the
sections of each turnout fan and diamond zone. A crossover's two fans share one group. It
has a holder plus a refcount, so one train can hold several of its sections while no other
train enters any of them.

### Consist

The M4 train formation: one 10 m tank locomotive plus c coaches of 9 m with 1 m gaps. c =
min(4, ⌊(shortest platform on the line − 15 m)/10⌋), and at least 2, so trains are
30–50 m long. Train length is constant (an [invariant](#invariant)). Mixed stock and cargo
are deferred.

### Curve

See [piece](#piece-straight-curve-shift) and [radius class](#radius-class).

## D

### Deadlock

A [wait-for graph](#wait-for-graph) cycle that does not move. The graph is scanned every
10 ticks. After 300 ticks (30 s) the trains get status `deadlock`, and one event names the
trains, sections and signals with a hint ("add a passing loop with signals"). At 1,200
ticks (120 s) the operator withdraws the highest-ID train in the cycle, logs it and caps
the line (`capped-deadlock`, reset when a construction diff touches the route). Deadlocks
are detected and explained, not prevented. Separately, `waiting-long` is raised after 90 s
without progress.

### Depot

A stub section of at least 50 m behind a buffer, placed at a free track end with
`place-depot{node, facing}` (at most 8). Trains spawn and despawn there and are stored
off-network; reversal is allowed. The operator picks the depot with the shortest travel
time to a line's first station. There is no buy or dispatch UI.

### Diamond crossing

Two tracks crossing at one lattice node, each passing straight through; trains cannot
switch between them. Its arms form one conflict group. Validation rejects a crossing off a
node (`crossing-off-lattice`), a diamond combined with a junction (`diamond-with-junction`)
and double slips (`double-slip-unsupported`). Tracks at different elevations never cross:
they meet no common node, so a crossing on a bridge never connects.

### Diorama operator (M4 placeholder behaviour)

The single autonomous regional operator in M4
([ADR 0014](decisions/0014-autonomous-diorama-operator.md), Proposed).
- It derives [lines](#line-operator-derived-never-player-authored) from the reachable
  station graph and picks each line's depot.
- It sets the train count n* = ⌈round trip / 6-min headway⌉. That is capped at 6 per line
  and 64 in total and bounded by passing places, then raised by 1 per clean round trip and
  backed off on deadlock.
- It spawns and withdraws trains with reasons. It runs on network change (50-tick debounce)
  or every 600 ticks.

The 6-minute headway is a placeholder and is labelled as one in the inspector. M5 replaces
this behaviour with demand-driven operators.

### Directed section

A section plus a travel direction, the unit of pathfinding. One-way rule: a train may pass
a signal node in direction D only if a signal faces D or no signal faces −D. One-way blocks
get chevrons in the overlay. See also [reversal](#reversal).

### Dwell

The time a train stands at a platform stop: 20 s. At a terminus the train reverses in
place, bunker-first, with a 30 s dwell.

## E

### Elevation

Integer millimetres per node (z, `zMm`). Node identity is (q, r, z), so tracks at
different heights never share a node. Terrain heights are Int16 dm at lattice nodes and
convert at the terrain boundary. Millimetres are a default since 2026-09-26: dm could not
hold 35‰ on a 5 m straight, while mm gives exactly 175 mm
([ADR 0010 D2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model)).
The planner spreads elevation along a drag by length with largest-remainder rounding.

### End of authority (EOA)

The furthest point a train may reach: the end of its last held section, less 3 m where
that end is a signal. The train requests more when its distance to EOA is ≤ brakeDist(v) +
150 m, and its speed is capped by isqrt(2·b·max(0, EOA − head)). Head ≤ EOA is an
invariant, and the renderer never extrapolates, so a train never visibly overshoots a red
signal.

### Evidence label

Every recorded observation is labelled automated, agent, owner or participant. Automation
is never human evidence, and an owner session is not first-time-player validation. See
the [M4 acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md).

## F

### Fan

The pieces around a [derived turnout](#turnout-derived) whose legs are still too close to
act independently. A fan's sections share a conflict group and are exempt from
`tracks-too-close`. A fan longer than 120 m is rejected (`turnout-too-long`).

### FrameView

See [snapshot](#snapshot-networkview-frameview).

## G

### Ghost

The construction preview drawn before commit: white for new pieces, cyan for reused, red
dashed for invalid. Elevated ghosts get drop lines every 20 m and end-height tags. It
comes from `sim.preview`, which shares the `execute` code path but mutates nothing and
consumes no IDs.

### Golden scenario

A named layout, built through commands only, with expected outcomes. Eleven are planned,
from a single-track shuttle capped at 1 train to a forced deadlock (detected within 30 s,
withdrawn at 120 s). Spec: [simulation model](simulation-model.md), testing.

### Grade

Rise over run in per mille (‰) between a piece's end nodes. The maximum is 35‰, low
enough that a train can always restart; steeper track fails with `grade-too-steep`, whose
message gives the length required. A grade adds 9.81·‰ mm/s² of resistance, weighted by
how much of the train overlaps it; balancing speed on 35‰ is about 11 m/s. The tooltip
shows grade in %: green ≤ 1.5%, amber ≤ 3%, red above the maximum.

## H

### Heading

One of 12 directions at 30° steps, numbered 0–11 counter-clockwise from +x (east). Even
headings are primary, with 5 m steps: d0 (1,0), d2 (0,1), d4 (−1,1), d6 (−1,0), d8 (0,−1),
d10 (1,−1). Odd headings are secondary, with 8.66 m steps: d1 (1,1), d3 (−1,2), d5 (−2,1),
d7 (−1,−1), d9 (1,−2), d11 (2,−1). Implemented as `Heading` in
[`src/core/lattice.ts`](../src/core/lattice.ts).

## I

### Invariant

A property the simulation checks while it runs: exclusive sections and groups; occupied ⊆
held; head ≤ EOA; speed ≤ limit; constant train length; no train on missing pieces;
accounting (spawned = active + despawned + withdrawn); no orphan holdings; derive ==
cached network. Invariants run every tick in tests, every 100 ticks in dev and not at all
in production.

## L

### Lattice (triangular, axial)

The grid every track node snaps to: triangular with spacing a = 5 m, so parallel primary
rows are a·√3/2 ≈ 4.33 m apart, the double-track spacing. Adjacent secondary lines are only
2.5 m apart, so secondary double track uses 5 m. Nodes use axial integer coordinates
(q, r), with world x = a(q + r/2) and y = a·r·√3/2 in metres (math Y-up, x east). A 60°
rotation maps (q, r) → (−r, q + r). The map is about 2.0 × 1.5 km. Implemented in
[`src/core/lattice.ts`](../src/core/lattice.ts); spec in
[ADR 0010](decisions/0010-triangular-lattice-track-geometry.md) (Proposed).

### Line (operator-derived, never player-authored)

A service pattern that the operator derives from the station graph. The player never
draws, edits or assigns one. Stations with degree ≠ 2 are anchors. An anchor-to-anchor
chain is a *shuttle*; an anchor-free cycle is a *loop line* if trains can circulate
without reversing. Line IDs are monotonic and matched by station sequence across edits; at
most 16.

### Look gates

Owner-only visual judgements. **Look Gate A** follows the static diorama (slices
R3/D11a): four bookmark views are set beside the mood board and scored 1–5 on palette,
charm, legibility, cohesion and originality. **Look Gate B** is the owner walkthrough at
the end of M4: palette, charm, cohesion and originality re-scored, plus mood, readability
at 3 zoom levels and construction feel. Agents never perform, simulate or narrate either
gate.

### Loop line

See [line](#line-operator-derived-never-player-authored).

## M

### Magnetism

The planner snaps a drag's end to an existing port or node within 3 lattice nodes.
[Precision mode](#precision-mode) turns it off.

## N

### NetworkView

See [snapshot](#snapshot-networkview-frameview).

### Node and port

A node is a lattice point at an elevation, (q, r, z). Pieces meet at nodes through ports,
one per outward heading. Derived node kinds, by ports on each side: through (1,1), buffer
(1,0) (a track end), switch (1,2) and diamond.

## P

### Passing loop

A second track beside a single line, joined at both ends by turnouts (typically through
[shift pieces](#shift-piece)) and signalled, so that opposing trains can pass. It raises
the operator's passing bound. A shuttle with no divergence is capped at 1 train
(`capped-no-passing`).

### Piece (straight, curve, shift)

The unit of authored track: it runs node to node and has an integer-mm length.
- A **straight** is one lattice step (5 m primary, 8.66 m secondary).
- A **curve** is a short straight lead-in, then a circular arc of one
  [radius class](#radius-class) turning ±30°, ±60° or ±90°, then a lead-out, tangent to
  lattice lines at both ends. About 120 base templates × 6 rotations gives ≈ 720 oriented
  templates; each must close exactly on the lattice, which a planned test checks.
- A [shift piece](#shift-piece) moves the track one row.

The limit is 5,000 pieces. Spec: [simulation model](simulation-model.md), pieces.

### Piece key

A piece's canonical geometric identity, normalised so the smaller end comes first:
`S:q,r,z0:d:z1` (straight), `C:q,r,z0:d:turn:R:variant:z1` (curve), `H:q,r,z0:d:side:z1`
(shift). Because identity is geometry, the "N new, M reused" counter is a key lookup, an
all-reused drag is a no-op with no history entry, and undo can create no ID hazard.

### Planner

Turns a drag into resolved pieces: n straights, then one curve or shift template, then m
straights. It solves a 2×2 integer system over about 100 candidates and chooses valid →
largest radius under the user cap → shortest → smallest |turn| → left before right. A
two-bend fit joins into existing ports. Commands carry the resolved pieces, so tuning the
planner never breaks replays.

### Platform

A straight run of track 40–200 m long where trains stop, placed with
`place-platform{pieces}`. It may not lie on a bridge or in a tunnel or over a junction. The
stop target is 3 m before the platform end. A line's [consist](#consist) length follows
its shortest platform, and reversal is allowed at platform stops.

### Portal

The mouth of a tunnel, where a tunnel piece meets the terrain surface; it is rendered with
a hill plug. Within 10 m of a portal the 6 m minimum tunnel cover does not apply.

### Precision mode

Hold Ctrl (⌥ on macOS) while dragging. Magnetism turns off, the mouse wheel picks the
radius class, Q/E pick the end heading, and a live label reads, for example,
"R 120 m · 35 km/h · 1.2%". Precision mode stays on the lattice; off-lattice geometry and
clothoids are deferred.

### Preview and execute

`preview(cmd)` runs the same code path as `execute(cmd)` but mutates nothing and consumes
no IDs. Either returns `{ok: true, networkRev, diff, counts{new, reused}}` or
`{ok: false, reason{code, message, refs}, highlight}`, with exactly one
[reason code](#reason-code).

## R

### Radius class

One of six curve radii, each with a speed limit of about √(0.8·R) m/s: 60 m → 25 km/h (the
minimum), 90 → 30, 120 → 35, 180 → 45, 240 → 50 and 360 → 60 km/h. Anything tighter fails
with `radius-too-tight`. A curve's limit holds until the train's tail clears it.

### Reason code

The single machine-readable code, with a message suggesting a fix and refs, that a
rejected command or an inspected entity reports: for example `grade-too-steep`,
`track-in-use`, `waiting-signal` or `capped-no-passing`. Validation runs its rules in a
fixed order (structural → geometry → grade → terrain and structure → node topology →
clearance → entities → operational) and returns the first failure. Each code gets one
negative fixture. Spec: [simulation model](simulation-model.md), validation and reasons.

### Replay hash

An FNV-1a hash of the simulation state's canonical JSON, taken at checkpoints. The replay
contract has three parts:
- step(1)×N == step(N) == step(10)×N/10;
- save → load → continue == uninterrupted play;
- the command log `(tick, cmd)` replays to identical checkpoint hashes.

The determinism gate compares hashes across fresh processes and across save/load
([ADR 0012](decisions/0012-tick-units-determinism.md), Proposed).

### Reservation

How a train gets authority: an all-or-nothing request for every section and conflict group
out to the end of its extent. The extent runs to the next signal (from a stop signal,
platform or depot), to the next stop signal (from a chain signal), or to the destination.
Requests are arbitrated FIFO by (firstRequestTick, trainId), and route candidates are tried
in order, which is how a train picks a free platform. Sections behind the tail are released
after movement. A network with no signals is one extent, so it safely runs one train per
single-track line. See also [soft want](#soft-want).

### Reversal

A train changes direction only at platform stops and in depots. Pathfinding adds a 30 s
penalty per reversal. A terminus reverses in place, bunker-first, with a 30 s dwell.

## S

### Section

The unit of reservation and occupancy. Sections split at switches, diamonds, buffers,
signals, platform ends, depot stub boundaries and fan or diamond-zone boundaries. Each has
one holder (a train ID, or −1 when free). The inspector reports a section as free,
reserved-by, occupied-by or one-way.

### Shift piece

An S-shaped piece of two reverse arcs that moves the track over one row, used for
crossovers and passing loops.
- **Primary:** 37.5 m long, 4.33 m offset, R ≈ 82.3 m.
- **Secondary:** 43.3 m long, 5.0 m offset, R = 95.0 m.

Both use α = 2·atan(√3/15) ≈ 13.174°, a literal that a planned test recomputes, and both
are limited to 30 km/h.

### Shuttle

See [line](#line-operator-derived-never-player-authored).

### Slice

A PR-sized unit of M4 work: core slices S0–S12 (with S11a/b) and render slices R0–R7,
grouped under backlog keys D1–D13 ([backlog](backlog.md)), which are GitHub issues
[#65](https://github.com/Kminkjan/infrastructurio/issues/65)–[#77](https://github.com/Kminkjan/infrastructurio/issues/77).

### Snapshot (NetworkView, FrameView)

The read-only views that render and UI take from the core, and the only thing they read
from it.
- **`NetworkView`** is cached per network revision: pieces (key, kind, structure, length,
  end heights, speed limit, render prims), sections, junctions, signals, platforms,
  stations and depots.
- **`FrameView`** is produced every tick: trains (including `prevHeadMm` and `headMm`),
  aspects, section holders, occupancy, switch legs and events.

The renderer draws a train at lerp(prevHeadMm, headMm, alpha) along arc length, with alpha
= acc/100 clamped at 1, and never extrapolates.

### Soft want

When a reservation request is denied, its `blockedBy` is recorded and the resources it
needed go into that tick's `wanted` set. A later request in the FIFO may not take a wanted
resource even if it is free. Soft wants hold nothing and block only later requests, so no
train starves.

### Station

A group of platforms within 30 m of each other laterally that overlap, derived from the
network; at most 32. Station IDs come from a monotonic allocator that never rolls back.
The name comes from a Baltic place-name list indexed by that ID. The M4 command set has no
rename; see [backlog D6](backlog.md#d6--stations-platforms-and-depots).

### Stop signal

See [block (stop) signal](#block-stop-signal).

### Straight

See [piece](#piece-straight-curve-shift).

### Structure (ground, bridge, tunnel)

A per-piece property, inferred (`auto`) or forced by the Bridge and Tunnel tools. With
terrain height h:
- **ground** needs −4 m ≤ z − h ≤ +4 m and no water;
- **bridge** is needed more than 4 m above terrain or over water, and must stay 4.0 m
  above the water;
- **tunnel** is needed more than 4 m below terrain, with at least 6 m cover except within
  10 m of a [portal](#portal).

Rendering chooses a stone arch viaduct (4–20 m over land), a steel Warren truss (over water
or spans > 30 m) or a plate-girder overpass.

## T

### Tick

One fixed simulation step of 100 ms (10 Hz). The core never sees wall time. The host loop
runs up to 40 ticks per frame from an accumulator scaled by game speed (0, 1, 2, 4 or
10×). Each tick runs commands → operator → reservation requests → movement → release and
occupancy → arrival, dwell and reversal → deadlock scan (every 10 ticks) → invariants →
tick++ ([ADR 0012](decisions/0012-tick-units-determinism.md), Proposed).

### Track-in-use

The reason code for an edit that would remove or disconnect track inside a train's
[committed zone](#committed-zone) (in slice S11a, any held section). The message names the
trains and pieces. Undo and redo are validated the same way and fail with `undo-blocked`.

### Turnout (derived)

Never placed as an object. A node becomes a turnout when one side has two pieces with the
same outward heading: side A has 1 port and side B at most 2. Its blade position is
`switchLeg` in the FrameView, and its [fan](#fan) forms a conflict group. More than two
legs, double slips and fans over 120 m are rejected.

## U

### Undo and redo

A stack of up to 100 construction diffs (pieces added and removed), each validated like a
new edit (`undo-blocked`, `undo-empty`, `redo-empty`). Trains, time, the operator and ID
allocators are never in history, so undo never rewinds traffic.

## W

### Wait-for graph

A directed graph from each waiting train to the train holding what it needs (its
`blockedBy`), rebuilt every 10 ticks. Tarjan's strongly-connected-components algorithm
finds its cycles, which are [deadlock](#deadlock) candidates.

### Weight-1 vehicle principle

Every simulated entity stands for exactly one physical thing (in M4, one train whose cars
occupy real track), never a weighted stand-in for several. Capacity emerges from occupied
space, not from counters, so what is drawn is what is simulated. It is carried forward as
knowledge from archived ADR 0003 ([archive](archive/README.md)), and M6 road traffic must
follow it too.

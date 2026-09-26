# Vision

> **You build the railway. The world runs on it.**

**Status 2026-09-26.** The owner chose the rail-first direction in conversation on
2026-09-26 ([ADR 0008](decisions/0008-archive-road-era-and-restart.md)). M4 — Living
Diorama is the current milestone and is not accepted. Main holds the skeleton only: the
lattice core, the coordinate conventions and an isometric smoke scene. This page states
intent. It is not evidence that anything described here works.

## Pitch

Infrastructurio is a calm infrastructure-design game set in a stylized Baltic countryside
around 1900, in the age of steam. The player lays track across a triangular lattice with
smooth curves and grades, carries it over rivers on bridges and through hills in tunnels,
and places turnouts, signals, stations and depots. Everything that moves belongs to the
simulation. Autonomous steam trains run on what the player built: they reserve paths
through signal blocks, stop at platforms, queue and sometimes jam, and every train can say
why it is waiting. The player reads the diorama, reshapes the track and watches it settle.

The satisfaction is the craft of a layout that works and looks right: a passing loop placed
where two trains actually meet, a chain signal that keeps a junction clear, a branch that
climbs over the main line on a viaduct.

## Who does what

The player designs infrastructure. The simulation runs everything on it and explains itself.

| Area | The player designs | The simulation decides | From |
|---|---|---|---|
| Track | Straights, curves and shifts on the lattice; grades and heights | Curve speed limits, train performance on grades, the derived network of sections and blocks | M4 |
| Turnouts and diamonds | Where tracks diverge or cross (turnouts are derived from the track laid) | Which leg a train takes; turnout fans and diamonds as exclusive conflict groups | M4 |
| Signals | Stop and chain signals: position and facing | Aspects, reservations, who goes first, where running is one-way | M4 |
| Stations and platforms | Platform position, length and side | Station grouping, which platform a train uses, dwell and reversal | M4 |
| Depots | Depot position at a track end | Which depot serves a line; spawning and withdrawing trains | M4 |
| Bridges and tunnels | Where the line crosses water, valleys or hills (inferred from terrain, or forced by tool) | Structure and clearance rules | M4 |
| Trains | Nothing: no purchase, no fleet management | How many trains run, their consist, when they spawn and withdraw | M4 |
| Services | Nothing: no lines, timetables or dispatch | Lines from the station graph with a placeholder headway (M4); demand-driven operators that start, adjust and withdraw services (M5) | M4, M5 |
| Routing | Nothing | Paths, platform choice, reversal points and waiting | M4 |
| Demand, towns and growth | Nothing | Settlements and industries, their demand, where towns grow | M5 |
| Roads | Lattice roads, lane presets, priorities, level crossings, grade separation | Road traffic and mode choice | M6 |

**The player never** buys, retires or assigns trains, draws lines or routes, writes
timetables, dispatches or holds a train, or sets subsidies, in any milestone. There is no
purchase or dispatch UI, and none is planned. Service follows only from infrastructure:
reachability, platforms, passing places and signalling decide how many trains the operator
can run and where they wait.

## Design pillars

1. **Calm diorama.** A miniature world to build and watch, not a race. M4 has no money,
   score, timer, fail state or scripted ending. Time belongs to the player: pause, 1×, 2×,
   4× or 10×. The look is muted and soft: steam puffs, easing semaphore arms, a fixed
   isometric camera that rotates in six 60° steps matched to the lattice. The scene renders
   only when something changes, so an idle diorama costs nothing.
2. **Infrastructure is the craft.** Laying track must feel good before any train runs on it,
   which is why D3 carries an early owner feel check. Track snaps to the lattice with smooth
   circular curves; radius classes carry visible speed limits (60 m → 25 km/h up to
   360 m → 60 km/h); precision mode picks radius and end heading while staying on the
   lattice; grades go up to 35‰ and bridges and tunnels follow the terrain. The ghost shows
   new versus reused pieces, and the tooltip shows length, grade, minimum radius and end
   height. Layout choices have operational consequences a player can see: a tight curve or
   a steep grade slows every train that uses it.
3. **Autonomous and inspectable.** An operator reads the network and decides lines, depots
   and train counts. Every station, line, train and section has a status and a reason code,
   and the inspector turns it into a sentence ("Waiting at signal S-12: block B-7 occupied
   by Train 3") with a **Show** button that pans to the cause. A placeholder is labelled as
   one, such as M4's 6-minute headway. A state the game cannot explain is a defect.
4. **Forgiving.** A mistake costs a click, not a save. Rejections name one reason and a fix
   before anything changes; undo and redo cover construction; edits under traffic are
   either safe or refused with `track-in-use`; deadlocks are detected, explained and
   eventually cleared by the operator. Nothing is lost
   ([failure model](gameplay-loop.md#forgiving-failure-model)).
5. **Honest simulation: capacity from occupied track.** One simulated train is one physical
   consist with a real length. It holds the sections it occupies and the path it has
   reserved, all-or-nothing, and no other train may enter them; turnout fans and diamonds
   are exclusive too. Throughput limits therefore come from the layout (single track,
   missing passing loops, conflicting junctions), never from hidden rates. The same layout
   and commands give the same run, checked by replay hashes. The HUD shows only real counts
   (trains, moving, waiting, average wait) and no invented passenger or cargo numbers. This
   carries forward ADR 0003's principles as knowledge ([archive](archive/README.md)).

## Non-goals

**Never, in any milestone** (the player's role):
- player train purchase, fleet management, lines, routes, timetables, dispatch or
  subsidies;
- scripted endings, scripted bottlenecks or scripted growth: problems emerge from the
  layout and, from M5, from demand;
- anything copied from the mood reference: assets, names, UI or screenshots.

**Not a realism exercise.** Rules are simplified wherever legibility wins. For example, the
1.524 m broad gauge is purely visual, and M4 runs one kind of train (a tank locomotive with
2–4 coaches).

**Not in M4** (later milestones may take some up; see the [roadmap](../ROADMAP.md)):
- towns, demand, passengers and cargo;
- economy and money;
- roads (M6);
- IndexedDB saves (M4 has replay fixtures only);
- mixed rolling stock and competing operators;
- sound, day/night and weather;
- terrain editing;
- off-lattice geometry and transition curves;
- touch input and a screen-reader map (known accessibility gaps).

## Mood reference

*Mighty Tiny Railways* (Mighty Tiny Games, Lithuania) sets the mood the owner wants: the
steam era in the Baltics, an isometric 2.5D view and a muted, calm palette. Lattice
snapping, precision placement and block/chain signalling are genre conventions, specified
independently in ADRs [0010](decisions/0010-triangular-lattice-track-geometry.md) and
[0011](decisions/0011-signalling-and-reservation.md). It is a **mood reference only**. None of its assets, names, UI or screenshots
enter the repo or the game, and originality is scored in the owner's look rubric (Look
Gate A). Infrastructurio's own palette and forms come from public-domain sources around
1900: Library of Congress Photochrom prints of Riga, Vilnius and Baltic villages
(1890–1905), landscapes by Isaac Levitan and M. K. Čiurlionis, and period railway
photographs. The mood board, palette and sources live in [art direction](art-direction.md).

## Milestones

M4 → M5 → M6. Each closes only on playable evidence and explicit owner acceptance. On
GitHub they are [milestone 8](https://github.com/Kminkjan/infrastructurio/milestone/8),
[milestone 9](https://github.com/Kminkjan/infrastructurio/milestone/9) and
[milestone 10](https://github.com/Kminkjan/infrastructurio/milestone/10).

| Milestone | One-line claim | The player gains | The simulation gains |
|---|---|---|---|
| **M4 — Living Diorama** (current, not accepted) | A player builds a railway layout on terrain, and autonomous trains run on it safely and deterministically, stop at platforms and explain their waits; the owner judges that it looks and feels right | Track, turnouts, signals, stations, depots, bridges and tunnels | One autonomous operator with a placeholder headway; signalling, movement and inspection |
| **M5 — Autonomous Rail Serves a Growing Region** | Settlements and industries create demand, autonomous operators start, adjust and withdraw services with explanations, rail access shapes growth, and growth creates the next capacity problem: the first integrated playable loop | The same infrastructure tools, now under real demand | Demand, demand-driven operators, towns and growth, save/replay |
| **M6 — Roads Feed and Compete with Rail** | Lattice roads connect towns to stations, and causal road traffic and mode choice feed and compete with rail | Roads with lane presets and priorities, level crossings, grade separation | Road traffic, mode choice, constrained town streets |

- Full claims, exclusions and what lies beyond: [roadmap](../ROADMAP.md).
- The M4 contract, slices and exclusions: [prototype plan](prototype-plan.md); work items
  D1–D13: [backlog](backlog.md).
- The predeclared M4 gates, including the owner walkthrough:
  [acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md).
- M5 needs a first-time-player session; an owner session does not count as one.
- Road-era research at tag `legacy-m0-m4` is source material for M6, not evidence
  ([archive](archive/README.md)).

## Related documents

- [Gameplay loop](gameplay-loop.md): the M4 and M5 loops, feedback and the failure model.
- [Glossary](glossary.md): block, stop and chain signal, reservation, consist, turnout,
  lattice, precision mode.
- [Architecture](architecture.md) and [simulation model](simulation-model.md).
- [Decision records](decisions/README.md).

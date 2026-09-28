# Gameplay loop

**Status 2026-09-26.** This is design intent for M4 — Living Diorama (the current milestone,
not accepted) and M5 (planned). As of 2026-09-26 only the lattice core exists; none of the
loop is playable. Mechanics and numbers below are design values from the Proposed ADRs
[0010](decisions/0010-triangular-lattice-track-geometry.md),
[0011](decisions/0011-signalling-and-reservation.md) and
[0014](decisions/0014-autonomous-diorama-operator.md) and the
[simulation model](simulation-model.md). They are not measurements, and where an ADR
changes, the ADR wins. Terms are defined in the [glossary](glossary.md).

The player's role never changes: they design infrastructure; trains and services are
autonomous and inspectable ([vision](vision.md#who-does-what)).

## The M4 loop

lay track → signal it → trains run through blocks → watch → spot a conflict or jam →
inspect why → redesign → watch again.

1. **Lay track.** The player drags across the lattice. The ghost shows new pieces in
   white, reused pieces in cyan and an invalid plan dashed red; the tooltip reads
   "Pieces: 8 new, 2 reused" with length, grade, minimum radius and end height. Height
   keys raise or lower the end one step at a time; bridges and tunnels are inferred from
   the terrain or forced with the Bridge and Tunnel tools *(2026-09-28: the owner replaced the Bridge and Tunnel tools with one Straight line tool, key 5, which lays a steady grade; structures are always inferred.)*. Platforms are dragged along a
   straight (platforms 40–200 m, "Platform 120 m · fits N coaches"); depots go at a track
   end with a stub of at least 50 m. Turnouts appear wherever a new track leaves an
   existing one.
2. **Signal it.** The player places stop and chain signals; the cursor side sets the
   facing and R flips it. The block overlay colours the blocks the signals create, with
   chevrons on one-way blocks: a signal that faces only one way makes that track one-way.
   An unsignalled line is one block, so one train per single-track line already works.
3. **Trains run through blocks.** The player does nothing here, by design. Once a depot
   reaches two or more stations, the operator derives lines from the station graph, picks
   the depot closest in travel time and spawns trains towards a placeholder 6-minute
   headway, capped by the passing places the layout offers (at most 6 per line, 64 in
   total). Each train reserves its path all-or-nothing: from a stop signal to the next
   signal, from a chain signal through to the next stop signal. Requests are served first
   come, first served, so no approach starves. Trains stop at platforms (20 s dwell) and
   reverse at termini.
4. **Watch.** Pause, 1×, 2×, 4× or 10×. The HUD counts "Trains 12 · Moving 9 · Waiting 3 ·
   Avg wait 14 s". Reservations show as marching ants in each train's hue, occupied
   sections in red; semaphore arms drop and steam rises.
5. **Spot a conflict or jam.** A train stands at a red signal, a queue forms at a merge,
   the waiting count climbs, or a notification arrives: a train waiting over 90 s without
   progress, or a deadlock.
6. **Inspect why.** The player clicks the train, signal, station or line. The inspector
   answers in a sentence, for example "Waiting at signal S-12: block B-7 occupied by
   Train 3", and **Show** pans to the blocker and draws a leader line.
7. **Redesign.** The player adds a passing loop, turns a stop signal into a chain signal,
   lengthens a platform, adds a second track or separates a crossing onto a bridge. Edits
   are allowed while trains run when they are safe (see
   [nothing is lost](#nothing-is-lost)). The operator re-plans shortly after the network
   changes, and the loop starts again at *watch*.

### Worked cycles

These follow the golden scenarios in the [simulation model](simulation-model.md).

- **Single track.** Two stations on one single-track line with a depot run one train; the
  line reports `capped-no-passing`. The player adds a passing loop with signals. The
  passing bound becomes passing places + 1, and if the headway calls for a second train,
  the operator adds one after the next clean round trip.
- **Blocked exit.** A stop signal at a junction entrance lets a train in, which then stops
  at the exit signal with its tail fouling the junction; trains on the other route queue
  behind it. The inspector names the train and the section. The player changes the
  entrance signal to a chain signal, and the train now waits outside the junction until its
  whole path to the next stop signal is free.
- **Deadlock.** Trains wait on each other in a cycle, each holding what the next one
  needs. After 30 s the game declares a deadlock, names the trains, sections and signals
  involved, and hints "add a passing loop with signals". The player redesigns, or the
  operator clears it (see [deadlocks](#deadlocks-are-detected-and-explained)).

## The M5 loop (planned)

demand → services → growth → capacity problem → redesign → demand again.

1. **Demand.** Settlements and industries create demand.
2. **Services.** Autonomous operators start, adjust and withdraw services in response, each
   with an explanation. They replace M4's placeholder headway.
3. **Growth.** Rail access and service quality shape where towns grow. Growth is never
   scripted.
4. **Capacity problem.** Growth puts more trains on the layout until part of it saturates:
   a single-track section, a busy junction, a short platform.
5. **Redesign.** The player answers with infrastructure only, using M4's tools and M4's
   inner loop. No lines, timetables or dispatch appear.

M5 adds save/replay and a first-time-player session. As of 2026-09-26 its detailed design
is still to come, under the placeholder epic
[#63](https://github.com/Kminkjan/infrastructurio/issues/63) ([roadmap](../ROADMAP.md)). M6
then adds roads that feed stations and compete with rail through causal road traffic and
mode choice.

## Feedback and inspection expectations

These are requirements, not aspirations. A state the player cannot get explained is a
defect.

- **Every non-running state has a reason code** and a sentence:
  - station: served, not-connected-to-depot, no-other-station-reachable, line-capped;
  - line: running, no-depot, leg-unreachable, capped-no-passing, capped-deadlock,
    capped-waiting, capped-max;
  - train: running, dwelling, reversing, waiting-signal (naming the signal, the blocking
    train and the section), queued-behind, slowed-curve, slowed-grade, deadlock, no-route,
    withdrawing, stranded;
  - section: free, reserved-by, occupied-by, one-way.
- **The inspector answers "why is this train waiting?"** and **Show** pans to the cause.
  A signal explains its aspect.
- **Construction explains itself before commit.** Preview runs the same code path as
  commit without changing anything, so what the ghost and tooltip say is what the commit
  does. The tooltip colours the grade (green ≤ 1.5%, amber ≤ 3%, red above the maximum).
- **Overlays stay readable.** Block colours stay stable across unrelated edits, a
  colour-blind-safe set exists, and one-way blocks always carry chevrons.
- **Notifications** report trains stuck over 90 s, deadlocks, withdrawals and stranded
  trains.
- **Only real numbers.** HUD counters are trains, moving, waiting and average wait. There
  are no invented passenger or cargo figures, and placeholders such as the M4 headway are
  labelled in the inspector.
- **What you see is what the simulation did.** The renderer interpolates between ticks and
  never extrapolates, so a train never visibly runs past a red signal.
- **Accessible inspection:** an aria-live status line, a keyboard lattice cursor, an entity
  list of keyboard targets, reduced motion and the colour-blind overlays. Known gaps: no
  screen-reader map and no touch input.

## Forgiving failure model

M4 has no fail state: no money, no bankruptcy, no timer and no scripted ending. Things can
go wrong only in ways the player can read and undo.

### Rejections explain

- An invalid plan is refused with **one** reason, the pieces that cause it highlighted and a
  suggested fix, such as the required length for a grade that is too steep. The player sees
  it in the ghost before committing.
- A rejected command changes nothing.

### Deadlocks are detected and explained

- The game checks for trains waiting on each other every second. A cycle that has not moved
  for 30 s becomes a `deadlock`, with one notification that names the trains, sections and
  signals and suggests a fix.
- If it persists to 120 s, the operator withdraws the highest-numbered train in the cycle
  and logs it. The line is then capped (`capped-deadlock`) until a construction change
  touches its route.
- Deadlocks are detected and explained, not prevented: finding and fixing the layout's
  weak spot is part of the craft.

### Nothing is lost

- Undo and redo cover the last 100 construction changes, validated like any edit
  (`undo-blocked` when a train now stands in the way). Trains, time and the operator never
  rewind.
- Demolish lists what depends on the track first.
- An edit that would pull track from under a train, or out of its braking distance, is
  refused with `track-in-use`, naming the trains and pieces. A safe edit trims the affected
  reservations, and trains re-route; a train left with no route stops safely (`no-route`).
- A train the operator no longer needs finishes its trip and returns to a depot; with no
  depot to reach, it is marked `stranded` and removed after 60 s. A deadlock withdrawal
  removes the train in place and releases its holdings.
- By rule, a train never enters a held or red block, whatever the player does; the M4
  safety soak checks it.

## What a player can do in M4

M4's playable proof is the owner walkthrough predeclared in the
[acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md). M4 is meant to make this
possible: starting from empty terrain, a player builds an oval of track with a passing loop
and two stations. They add a branch that climbs over the main line on a bridge, and a
tunnel. They place signals and a depot, and autonomous trains start running. They watch at
1× and at 4×, click a waiting train and read why it waits, and try to demolish occupied
track, which the game should refuse with an explanation. The walkthrough is human only;
agents never perform, simulate or narrate it. The owner records a verdict on mood,
readability at three zoom levels and construction feel, plus any friction, as Look Gate B.
As of 2026-09-26 none of it is playable, and this paragraph is a target, not a result.

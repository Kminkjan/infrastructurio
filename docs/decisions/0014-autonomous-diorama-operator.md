# 0014 — Autonomous diorama operator

- Status: Proposed
- Date: 2026-09-26
- Scope: Prototype, M4 only; a placeholder. Affects `src/core/services/` (`operator.ts`,
  `reasons.ts`), deadlock withdrawal in `signals/deadlock.ts`, depot spawn and despawn,
  the inspector and notifications. Replaced by the M5 demand-driven operators
- Tracking: M4 epic "M4 — Epic: Living Diorama" (issue TBD); D9 autonomous diorama services
  (issue TBD); see [the backlog](../backlog.md). The M5 epic "Autonomous Rail Serves a
  Growing Region" (issue TBD) owns the replacement
- Evidence: design only, consolidated from the owner-approved rail-first plan
  (2026-09-26) into [the simulation model](../simulation-model.md). The product rule is in
  [the vision](../vision.md). Nothing is implemented or measured
- Decision authority: Pending (proposed 2026-09-26)
- Supersedes: None
- Superseded by: None (an M5 operator ADR, number TBD, is expected to supersede it)

## Context

- **The product rule.** The player only designs infrastructure; services are autonomous and
  inspectable. Never player train purchase, lines, timetables, dispatch, subsidies,
  scripted endings, bottlenecks or growth ([vision](../vision.md),
  [gameplay loop](../gameplay-loop.md)).
- **The M4 gap.** M4 excludes towns, demand and economy
  ([prototype plan](../prototype-plan.md)). Its claim still needs autonomous trains that run
  on the player's layout, stop at platforms and explain their waits. Something must decide
  which trains exist and where they go, without demand.
- **Constraints.** It must be deterministic ([ADR 0012](0012-tick-units-determinism.md)),
  safe under signalling ([ADR 0011](0011-signalling-and-reservation.md)) and legible. The
  owner walkthrough builds an oval with a passing loop and two stations and expects trains
  to appear.
- **The loop in miniature.** Better infrastructure (a passing loop, signals, a depot) should
  visibly lead to more or smoother service.

## Decision

One regional M4 operator: deterministic, explainable, labelled a placeholder, and replaced
by the M5 operators. Its only input from the player is the infrastructure itself.

**1. When it runs.** Tick order step 2: after a network change plus a 50-tick debounce, and
otherwise every 600 ticks. It reads the `NetworkView` and train states, and writes lines,
targets, spawns and withdrawals. It never grants movement authority: every move still goes
through reservation (ADR 0011).

**2. The station graph.**
- Reachability runs from each depot exit.
- Two stations are adjacent when routes exist in both directions between them that do not
  pass a third station's platform.

**3. Lines from a chain decomposition.**
- Stations with degree ≠ 2 are anchors. Each anchor-to-anchor chain becomes a shuttle that
  calls at every station on it and reverses at its termini (reversal happens only at
  platform stops and in depots).
- An anchor-free cycle becomes a loop line if trains can circulate without reversing.
  Open for D9: a cycle that needs reversal. The recommended default is to cut it at its
  lowest-ID station and run it as a shuttle.
- Line IDs are monotonic and matched by station sequence across re-derivations, so an edit
  that keeps a line's stations keeps its ID and its trains. At most 16 lines; stations
  beyond the cap get `line-capped`.

**4. Depot and consist.**
- Each line uses the depot with the shortest travel time (integer ms path cost) to its
  first station, ties broken by depot ID. No reachable depot → line `no-depot`.
- Consist: a tank locomotive plus c coaches, c = min(4, ⌊(shortest platform on the line −
  15 m)/10⌋), at least 2.

**5. Train count.**
- **Target** n* = ⌈round trip / headway⌉, with a **placeholder headway of 6 min** (3,600
  ticks) that the inspector labels as a placeholder. Caps: 6 per line and 64 in total
  (`capped-max`).
- **Static passing bound:** a shuttle with no divergence → 1 (`capped-no-passing`);
  otherwise passing places + 1. A loop → max(1, waiting points − 1).
- **Empirical growth:** a line starts with one train and adds one per clean round trip, up
  to the target and the bounds. A round trip on which a train raised `waiting-long` (90 s
  without progress) pauses growth (`capped-waiting`).
- **Deadlock backstop:** after a deadlock withdrawal, the line is capped at the count that
  remains (`capped-deadlock`). The cap resets only when a construction diff touches the
  line's route, so the count cannot oscillate without an edit.

**6. Deadlock.** Detection is ADR 0011's: a wait-for graph and Tarjan SCC every 10 ticks. A
cycle that has not moved for 300 ticks (30 s) sets status `deadlock` and emits one event
naming the trains, sections and signals, with a hint ("add a passing loop with signals"). At
1,200 ticks (120 s) the operator withdraws the highest-ID train in the cycle and logs it.
This is the operator's only intervention in traffic: a backstop, not a solver.

**7. Spawn and withdraw.**
- A spawn needs a free depot stub, a reservable exit and 30 s since that depot's last
  spawn.
- A withdrawal (target lowered, line removed) finishes the current trip, then routes to a
  depot and despawns. With no reachable depot the train is `stranded` and is despawned
  after 60 s. A deadlock withdrawal cannot finish its trip, so it removes the train in place
  and releases its holdings.
- Accounting invariant: spawned = active + despawned + withdrawn.

**8. The reason catalogue.** All reasons live in `services/reasons.ts`, each with an
inspector message such as "Waiting at signal S-12: block B-7 occupied by Train 3".

| Entity | Reasons |
| --- | --- |
| Station | `served`, `not-connected-to-depot`, `no-other-station-reachable`, `line-capped` |
| Line | `running`, `no-depot`, `leg-unreachable`, `capped-no-passing`, `capped-deadlock`, `capped-waiting`, `capped-max` |
| Train | `running`, `dwelling`, `reversing`, `waiting-signal` (signal, blocking train, section), `queued-behind`, `slowed-curve`, `slowed-grade`, `deadlock`, `no-route`, `withdrawing`, `stranded` |
| Section | `free`, `reserved-by`, `occupied-by`, `one-way` |

**9. What it never does.** There are no player lines, timetables, dispatch, fleet purchase,
headway settings or train buttons, in the UI or in the command set: `Command` has no
service verbs. The player influences service only by building platforms, depots, passing
loops and signals. The HUD shows no fake passenger or cargo counters.

**10. State.** Operator state (line IDs, caps, growth counters, spawn timers) is
authoritative, saved and hashed (ADR 0012), and never part of undo history. Tie-breaks use
IDs; there is no randomness.

**11. Placeholder status.** The M5 operators replace this one: settlements and industries
create demand, and operators start, adjust and withdraw services with explanations.
- Expected to carry forward: the reason catalogue, the inspector plumbing, the spawn and
  withdraw mechanics and the accounting invariant.
- Not expected to carry forward: chain-decomposition lines and the 6-min headway.
- Deferred to M5 or later: demand, passengers, cargo, towns, money, mixed stock,
  operator-run timetables (autonomous; never player-set) and competition.

## Alternatives considered

- **Player-drawn lines.** Rejected by product rule, not on engineering merit: the player
  only designs infrastructure. Technical evidence does not reopen it.
- **Random trains.** Spawning trains towards random destinations is cheap. Rejected: even
  when seeded it is unexplainable ("why did this train go there?"), it produces jams that
  look like player error, it cannot be matched across edits, and passing-capacity caps
  have nothing stable to bound.
- **A demand model now.** Deferred to M5. M4 excludes towns and demand, and a demand model
  before the construction, signalling and movement core is proven would widen M4 and blur
  its claim. M5 designs demand together with settlements and industries.

## Consequences

- **Benefits:** trains appear on any sensible layout with no player action; a passing loop
  visibly unlocks a second train; every station, line, train and section can say why; the
  operator is fully deterministic.
- **Costs:** the line derivation and the headway are thrown away once M5 lands. On complex
  layouts with many junction stations, chain decomposition yields many short shuttles.
- **Risks:**
  - the placeholder headway is mistaken for design intent or a player setting (mitigation:
    the inspector label, and no control);
  - empirical growth hides a structural problem until a deadlock (mitigation: the backstop,
    its explanation and hint);
  - a deadlock withdrawal feels like the game fixing the player's layout (mitigation: log
    it, explain it, and cap the line until the route changes).
- **Follow-up:** the D9 golden scenarios; notifications for stuck trains with the D10
  inspector.

## Validation and acceptance boundaries

- Nothing is implemented, so the design has no evidence yet.
- **Automated (D9):**
  - golden scenarios 1 (single-track shuttle capped at 1), 2 (passing loop, 2 trains, no
    deadlock over 2 simulated hours), 8 (loop line), 9 (unreachable station), 10
    (two-platform station) and 11 (forced deadlock detected ≤ 30 s, withdrawn at 120 s,
    then `capped-deadlock`);
  - one negative fixture per reason code;
  - the accounting invariant in the 10k-tick soaks;
  - a check that no line, timetable or dispatch controls or commands exist.
- **Owner:** the walkthrough judges whether the services read as a living diorama. An owner
  session is not first-time-player validation.
- **Bound:** the M4 gates do not validate this as a service model for M5. They can show
  only that the placeholder runs safely and explains itself. Accepting this ADR is the
  owner's decision and is separate from passing any gate.

## Revisit when

- M5 operator design starts (expected to supersede this ADR);
- the walkthrough finds service too sparse, too dense or confusing;
- golden or soak runs show the backstop firing on layouts the static bounds call safe,
  which means the bounds are too loose;
- chain decomposition yields lines the owner finds implausible on typical layouts.

## History

- 2026-09-26: Proposed in the rail-first reset PR that adds ADRs 0009–0014 (planned as PR 3;
  number TBD); owner decision pending.

# Roadmap

Rail-first direction agreed by the owner on 2026-09-26. Detailed infrastructure design is the
player's activity; trains, services and (later) towns are autonomous and inspectable.
Milestones close on playable evidence and explicit owner acceptance, not on feature counts.
No calendar deadlines are implied. Live status and dispositions are recorded on GitHub; the
owner decides them.

The road-era roadmap (M0–M3 and the road-first M4) is archived at tag `legacy-m0-m4`
([archive](docs/archive/README.md)).

## M4 — Living Diorama

**Status (2026-09-26):** current milestone. Main holds the skeleton only; no claim below is
implemented, measured or accepted yet.

**Claim:** A player can build a railway layout on terrain, and autonomous trains run on it
safely and deterministically. The layout can include curves, grades, bridges, tunnels,
turnouts, stations, depots, and block and chain signals. Trains run through signal blocks,
stop at platforms and explain why they wait. The owner judges that it looks and feels right.

- **Out of scope:** towns and demand, economy and money, roads, saves beyond replay
  fixtures (no IndexedDB saves), any player lines, timetables or dispatch, sound, day/night,
  weather, terrain editing and off-lattice geometry.
- **Acceptance:** predeclared automated, determinism and performance gates, plus an owner
  walkthrough ([acceptance gates](docs/evidence/m4/2026-09-26-acceptance-gates.md)).
- **Plan:** the contract, exclusions and slice order are in the
  [prototype plan](docs/prototype-plan.md); the work items D1–D13 are in the
  [backlog](docs/backlog.md).
- **Tracking:** GitHub milestone M4 (number TBD) and the epic "M4 — Epic: Living Diorama"
  (TBD), with one issue per backlog key.

## M5 — Autonomous Rail Serves a Growing Region

**Claim:** Settlements and industries create demand, and autonomous operators start, adjust and
withdraw train services with explanations. Rail access and service quality shape where towns
grow, and growth creates the next capacity problem. Save/replay and a first-time-player
session are the evidence for the first integrated playable loop.

- **Tracking:** GitHub milestone M5 (number TBD) and a placeholder epic (TBD). Detailed
  planning starts from M4 evidence.

## M6 — Roads Feed and Compete with Rail

**Claim:** Lattice roads with lane presets, priorities, level crossings and grade separation
connect towns to stations. Causal road traffic and mode choice compete with and feed rail, and
towns add constrained local streets. Road-era research at tag `legacy-m0-m4` is source material.

- **Tracking:** GitHub milestone M6 (number TBD) and a placeholder epic (TBD).

## Beyond

Larger regions, electrification, advanced signalling, more rolling stock and deeper
economies depend on evidence from M5 and M6. Player fleet management, line planning and
dispatch stay outside the player's role.

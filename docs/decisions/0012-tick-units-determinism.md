# 0012 — Tick, units and determinism

- Status: Proposed
- Date: 2026-09-26
- Scope: Prototype (M4), plus the replay contract that M5 saves inherit. Affects all of
  `src/core` (most directly `util/`, `geometry/`, `trains/`, `signals/`, `services/` and
  `sim/`), the host loop in `src/app`, `tests/replay/` and
  [`tests/architecture.test.ts`](../../tests/architecture.test.ts)
- Tracking: M4 epic "M4 — Epic: Living Diorama" (issue TBD); D8 train movement and
  reservation, and D12 replay and bench harness (issues TBD); see
  [the backlog](../backlog.md)
- Evidence: design only, consolidated from the owner-approved rail-first plan
  (2026-09-26) into [the architecture](../architecture.md) and
  [the simulation model](../simulation-model.md). The boundary scanner and the trig-free
  lattice ([`src/core/lattice.ts`](../../src/core/lattice.ts)) exist in the reset skeleton.
  Nothing in this ADR has been measured
- Decision authority: Pending (proposed 2026-09-26)
- Supersedes: None
- Superseded by: None

## Context

The M4 claim is that autonomous trains run "safely and deterministically"
([prototype plan](../prototype-plan.md)). Gate A predeclares a determinism check: 3 golden
fixtures × 1 simulated hour, with checkpoint hashes identical across fresh processes and
across save/load at the halfway point
([acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)).
[ADR 0002](0002-separate-simulation-from-presentation.md) makes the simulation
authoritative. Replays, golden fixtures, bug reports and M5 saves all need the same inputs
to produce the same state.

Three facts shape the choice:
- **Numbers.** ECMAScript Numbers are IEEE 754 doubles. `+ − × ÷` are correctly rounded
  and integers are exact up to 2^53. `Math.sin`, `cos`, `atan`, `pow`, `exp`, `log`,
  `hypot` and their relatives, and the `**` operator, are *implementation-approximated* in
  the specification, so they may differ between engines and engine versions.
- **The planner will be retuned** for feel (D3's owner feel check). Nothing that is
  replayed may depend on how a drag was interpreted.
- **Wall time is noisy.** Frame times vary by machine, the host runs at 0, 1, 2, 4 and
  10×, and a hidden tab stops the loop.

The road-era ADR 0003 (archived) established fixed steps and one physical vehicle per
entity; those principles carry forward as knowledge, not code
([archive README](../archive/README.md)).

## Decision

**1. A fixed 10 Hz tick.** One tick is 100 ms of simulated time, `simMs = tick × 100`. The
core never sees wall time. Durations are whole ticks: dwell 200, deadlock 300, withdrawal
1,200, operator period 600 with a 50-tick debounce, placeholder headway 3,600.

The host loop in `src/app`:

```
acc += dtWall × speed
while (acc >= 100 && n++ < 40) { sim.step(); acc -= 100 }
alpha = min(acc / 100, 1)
```

- At 10× that is 100 ticks per wall second.
- When the 40-step cap is hit (a hitch, or a hidden tab coming back), the host drops the
  backlog, so simulated time slows rather than jumps or spirals. PerfMonitor counts drops.
- The renderer draws `lerp(prevHeadMm, headMm, alpha)` along arc length and never
  extrapolates, so a train never visibly overshoots a red signal.
- The HUD's 1900 calendar is derived from the tick outside `src/core`.

**2. Integer units.**

| Quantity | Unit | Notes |
| --- | --- | --- |
| Time | tick (100 ms); integer ms for path costs | 30 s reversal penalty = 30,000 ms |
| Length, position | integer mm | piece lengths computed once, in `geometry/templates.ts` |
| Speed | integer mm/s | vmax 16,666 mm/s (60 km/h) |
| Acceleration | integer mm/s² | planned braking 600, capability 900 |
| Elevation | integer dm per node; terrain `Int16` dm | node identity is (q, r, z) |
| Grade | integer ‰ | maximum 35‰ |
| Lattice position, heading | integer axial (q, r); heading 0–11 in 30° steps | no angle floats in state |
| Identifiers | monotonic integers | allocators never roll back, not even on undo |

Arithmetic rules:
- Integer quantities are plain Numbers kept far below 2^53. No `|0` or other int32
  coercion in arithmetic; typed arrays only for storage, with a checked range. The design
  estimate of the largest intermediate is about 1.2e9 (2·b·d over about 1 km of
  authority); a unit test pins the bound.
- **Exact `isqrt`** (`util/int.ts`): `floor(Math.sqrt(n))`, then an integer correction
  until r² ≤ n < (r+1)², so the result is exact even if the float root were one ulp off.
  In tick modules `Math.sqrt` appears only through `isqrt`.
- **`divFloor`** for every integer division: floor division with a correction step, so
  negative numerators round toward −∞ too. Other rounding is explicit (largest-remainder
  when spreading elevation), never `toFixed`, locale formatting or implicit truncation.
- The exact-stop and end-of-authority rules clamp, so rounding can never carry a train
  past a stop target or its end of authority.

**3. No trig in authoritative code.** Transcendental `Math` is allowed only in three
whitelisted modules, which the boundary scanner enforces with a negative self-check:
- `geometry/templates.ts` builds the template table and is the only place `PI` and `atan`
  appear. Authoritative lengths are integer mm from `SQRT3` and `PI` with basic
  arithmetic. The shift angle α = 2·atan(√3/15) ≈ 13.174° is a checked literal that a test
  recomputes.
- `geometry/sample.ts` samples arcs into positions for rendering only; it never feeds
  state.
- `geometry/clearance.ts` computes float distances for the construction clearance check,
  decided once at commit time.

Tick modules (`network/`, `signals/`, `trains/`, `services/`) work in arc-length mm and
never import `sample.ts` or `clearance.ts`.

**4. Randomness in core only, and not in the tick.**
- No `Math.random` in `src/core` (scanner). The tick step consumes no random numbers.
  Tie-breaks use IDs and ticks: FIFO by (firstRequestTick, trainId), pathfinding by
  (cost, dirSectionId), deadlock withdrawal by highest train ID.
- The only authoritative PRNG is seeded `sfc32` in `util/prng.ts`, used by scenario
  generation. Terrain uses integer hash value-noise from `{seed, generatorVersion}`.
- If a later tick system needs randomness, its PRNG state goes into the save and the hash.
- Render-side cosmetic variation (sway phase, steam jitter) may use its own seeded hash
  but never feeds back into core.

**5. Order and purity.**
- No `for…in` (scanner). Maps and Sets are iterated in insertion order only when that
  order is itself deterministic; otherwise sort first.
- String keys compare by code unit (`<`), never `localeCompare` or `Intl`.
- `derive(authored)` sorts pieces by canonical key before assigning IDs, so the derived
  network is independent of insertion order.
- Movement runs in trainId order. Order does not matter because authority is exclusive;
  a shuffle property test proves it.
- `preview` shares `execute`'s code path but does not mutate and consumes no IDs. Queries
  (`network`, `frame`, `inspect`) and invariant checks are read-only, so turning invariants
  on or off cannot change a hash (tested).

**6. Canonical serialization and hashes.**
- **Authoritative state** is everything `save()` writes: authored track and entities,
  terrain `{seed, generatorVersion}`, trains, holdings, operator state, allocators, the
  undo/redo stacks and the tick. Derived caches (`NetworkView`, `FrameView`) are not hashed;
  load re-derives, and invariants check derive == cached.
- **Canonical JSON:** keys sorted by code unit; collections as arrays in ID or key order;
  Maps as sorted entry arrays; typed arrays as plain arrays; no `undefined`; safe integers
  only (an invariant rejects any non-integer number in state); −0 written as 0.
- **`util/hash.ts`:** FNV-1a (32-bit, via `Math.imul`) over the canonical JSON. It is a
  regression tripwire, not a security property. On a mismatch the replay harness diffs
  the canonical JSON and names the first differing path.
- Checkpoints every 600 ticks (one simulated minute) and at the end of a run.

**7. Commands carry resolved pieces.** `build-track` carries `PieceSpec[]` (canonical keys)
plus a structure mode. Drag input and planner candidates never enter the log:
`planTrack(drag) → TrackPlan` runs first, and the tool issues the resolved command. So
planner tuning cannot break a replay. `execute` runs synchronously between steps, which is
the start of the next tick (tick order step 1). The log records `(tick, cmd)` in call
order, plus the `Result` each produced (ok or reason code, and `networkRev`).

**8. The replay contract,** checked in `tests/replay/` (D12). "Equal" means equal
checkpoint hashes, with the canonical-JSON diff on failure.
1. `step(1)` × N == `step(N)` == `step(10)` × N/10.
2. save → load → continue == uninterrupted play.
3. The command log `(tick, cmd)` replays to identical checkpoint hashes and identical
   `Result`s.
4. Any number of `preview` calls, then `execute` == `execute` alone.

**9. Engine independence, and its limit.**
- **Claim:** the tick step uses only integer-valued Numbers and correctly rounded
  operations, so it produces bit-identical state on any conforming ECMAScript engine
  (V8, SpiderMonkey, JavaScriptCore).
- **Limit:** construction clearance uses floats. A command-log replay re-validates every
  command, so on another engine a clearance distance within float error of an exact
  threshold (4.0 m plan distance, 6.5 m vertical) could flip a commit between accept and
  reject. Clearance is therefore engine-pinned, but only at exact thresholds. Saves never
  re-validate, so save → load is unaffected. The logged `Result` turns a flip into a named
  replay failure instead of a later hash mismatch.
- The planner and render sampling are outside the contract; they reach state only through
  commands that carry resolved pieces.

**10. Main thread until measured.** The sim runs on the main thread inside the host loop.
ADR 0002's command and snapshot boundary keeps a Worker move mechanical. File a
sim-in-Worker ADR when browser `preview` p95 exceeds 8 ms, or when the sim's gate B budgets
(headless tick p95 ≤ 0.5 ms, 10-tick batch p95 ≤ 3 ms, `preview` p95 ≤ 4 ms; provisional,
the [acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md) govern) are missed in a
way the frame budget cannot absorb.

Open: whether 32-bit FNV-1a is enough once M5 saves ship (a 64-bit variant is cheap);
cross-engine identity is not gated in M4; M5 demand and growth may need fractional rates,
expected as fixed-point integers and decided in an M5 ADR; the tractive constant K = 4e6
mm²/s³ ([simulation model open point 1](../simulation-model.md#19-open-points-2026-09-26)),
on which golden scenario 6's balancing band depends, and grade-aware planned braking on
descents (open point 3), both settled in D8.

## Alternatives considered

- **A 20 Hz tick.** It halves the distance per tick (1.67 m → 0.83 m at 60 km/h) and
  tightens request timing. Rejected: rendering interpolates, so smoothness does not depend
  on the tick; exact stops and ends of authority come from clamping, not from small steps;
  the request trigger already adds 150 m to braking distance; and 10× would need 200 steps
  per wall second, doubling sim CPU against the 3 ms per-frame CPU budget. This is
  inference, not measurement.
- **Float positions.** JavaScript engines may not reassociate float operations, so basic
  float arithmetic alone would also be deterministic on one engine. Integers still win:
  invariants (head ≤ EOA, occupied ⊆ held, exact stop at target) compare exactly without
  epsilons; canonical serialization needs no float formatting; the contract ports to
  another language or a WASM core, which ADR 0002 anticipates; and one visible unit
  convention is easier to review. The cost is explicit `divFloor`/`isqrt` and care with
  rounding.
- **A Worker now.** It frees the main thread and is the path ADR 0002 anticipates.
  Rejected for M4: `preview` must answer synchronously for the ghost on every snapped-key
  change. A Worker adds async round trips, serialization of a `FrameView` every tick and
  harder debugging, for a cost not yet shown to exist. The trigger in decision 10 makes
  the move evidence-driven.

## Consequences

- **Benefits:** replays, golden fixtures and bug reports reproduce exactly; the contract is
  testable headless in Node; saves stay small and canonical; ordering bugs surface as hash
  mismatches with a named path.
- **Costs:** integer kinematics is more verbose than floats. Every new core module must
  respect the scanner. `templates.ts` and `clearance.ts` hold the only float and trig code
  and need careful tests.
- **Risks:**
  - a float leaking into state through a stray division, caught by the safe-integer
    invariant and the hash diff;
  - scanner gaps: [the boundary test](../../tests/architecture.test.ts) does not yet
    catch the `**` operator (specified like `Math.pow`), `localeCompare`/`Intl`, or tick
    modules importing `sample.ts`/`clearance.ts`;
  - the 40-step cap slows simulated time at 10× on a slow machine; this is visible and
    recorded, not hidden.
- **Compatibility:** saves and command logs carry a schema version. M4 saves are replay
  fixtures only, with no IndexedDB. M5 persistence uses a new database name, never
  `infrastructurio`.
- **Follow-up:** `util/int.ts`, `prng.ts` and `hash.ts` (S0); the replay harness,
  checkpoints and the safe-integer invariant (D12); the three scanner extensions above
  (D12); optionally, a Playwright replay of one golden fixture in Firefox and WebKit.
  That last one is not an M4 gate.

## Validation and acceptance boundaries

- **Exists (agent observation, 2026-09-26):** the boundary scanner with its negative
  self-check, and a lattice built from a `SQRT3` table with no trig. They show the rules are
  enforceable. They do not show the sim is deterministic, because no sim exists yet.
- **To be tested:** the replay equalities (D12), the movement-order shuffle property,
  preview == execute, invariants every tick in 10k-tick soaks (D8), and gate A determinism.
- **Bound:** gate A compares fresh processes on one engine (Node). Cross-engine identity is
  a design claim that M4 does not test; never cite gate A as evidence for it.
- D8's acceptance records this ADR's findings. Accepting this ADR is the owner's decision
  and is separate from passing any gate.

## Revisit when

- browser `preview` p95 exceeds 8 ms, or the sim misses its gate B budgets (→ a
  sim-in-Worker ADR);
- golden fixtures show artefacts attributable to 10 Hz, such as late requests or uneven
  stops;
- a hash mismatch across engines is observed, or a clearance flip happens in practice;
- a tick system needs randomness or fractional quantities (M5 demand and growth);
- a non-JavaScript core or lockstep networking is considered.

## History

- 2026-09-26: Proposed in the rail-first reset PR that adds ADRs 0009–0014 (planned as PR 3;
  number TBD); owner decision pending.

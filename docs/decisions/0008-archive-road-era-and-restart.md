# 0008 — Archive the road-era build and restart main rail-first

- Status: Accepted
- Date: 2026-09-26
- Scope: Prototype, meaning the whole repository layout and delivery plan. Affects every legacy system, ADRs 0003–0007, and GitHub milestones M3–M6
- Tracking: New M4 "Living Diorama" epic
- Evidence: owner direction in conversation, 2026-09-26; re-verification of the archived build ([archive README](../archive/README.md))
- Decision authority: Owner decision given explicitly in conversation on 2026-09-26: "Archive, then clean main" and "Mark ADR 0008/0009 Accepted"
- Supersedes: Road-era planning and the M4 construction proof. ADRs 0005–0007 are Withdrawn
- Superseded by: None

## Context

The road-era M4 aimed at evidence for a road-first M5. Its thin-workflow gate (#55) was never
run, and the renderer choice (#26) and the migration boundary (#28) were still open.

On 2026-09-26 the owner re-imagined M4:
- **Rail first.**
- Web + TypeScript + a Three.js 2.5D isometric view, with the mood of *Mighty Tiny Railways* as the reference.
- The M4 done-bar is a "living diorama": satisfying track construction, and autonomous trains that run safely through signal blocks on what the player built.
- All legacy code is disregarded.

Keeping the legacy code on main would carry constraints the new design doesn't need:
- a lockfile hash pin from the M4 research evidence;
- a shared IndexedDB save slot;
- road-specific construction and simulation models.

## Decision

1. **Tag first.** Annotate `legacy-m0-m4` on main after PR #59, and `legacy-m3` on
   `18dc5ee` (the unmerged M3 branch, which is also kept). Push them by explicit ref only.
2. **Clean main with an ordinary deletion commit** (no history rewrite). Remove the Millford
   app, the M4 construction proof, the research harness and evidence, ADRs 0003–0007 and the
   road-era docs and agent guides.
3. **Migrate nothing.** The new prototype re-implements useful techniques from scratch. That
   makes the road-era migration boundary (#28) moot.
4. **Keep ADR 0001's web/TypeScript/Vite/React direction and ADR 0002 in force.** ADR 0009
   replaces the renderer choice in 0001 and supersedes 0004.
5. **Record ADR dispositions.**
   - 0003: accepted for bounded research and archived. It is source material for a later roads milestone.
   - 0004: superseded by 0009.
   - 0005–0007: Withdrawn. They were abandoned because the direction changed, not rejected on merit.

## Alternatives considered

- **Keep the legacy code and build beside it.** It is safer against loss, but every dependency
  change would still need the evidence archive-and-reroute step, and the repo would stay
  cluttered and confusing for agents.
- **Start a new repository.** It loses issue, PR and ADR continuity for little gain over tags.
- **Migrate the construction proof.** Its square grid, road lanes and Bézier curves don't fit a
  triangular rail lattice. The salvage audit recommended re-implementing, not porting.

## Consequences

- Main contains only the rail-first prototype. `npm install` and dependency changes are
  normal again, done in dedicated PRs.
- History is preserved at the tags and in git. Links to old docs must use tag URLs.
- Open road-era issues are closed as superseded and tag-linked, which is not a finding that
  the work failed. #27 is closed as completed.
- There is a risk of losing the tags: GitHub has no branch or tag protection today. Mitigations:
  keep the M3 branch as well as the M3 tag, never force-push, and optionally add a tag ruleset.

## Validation and acceptance boundaries

The archived build's checks re-pass on the tag's tree (recorded in the archive README). This
ADR claims nothing about the new prototype's quality. That is decided at the M4 acceptance
gates.

## Revisit when

Never, for the archive itself. Individual road-era techniques may be revisited through new
ADRs when the roads milestone starts.

## History

- 2026-09-26: Accepted by explicit owner decision in conversation, before PR 1 of the reset.

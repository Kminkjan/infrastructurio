import { type Counts, type NodeRef, type PieceSpec, type Reason, type Structure, type TrackPlan, resolvePiece } from "../core/sim/api";
import type { GradeLevel, StructureMode, TooltipMetrics, TooltipModel } from "./types";

/**
 * Tooltip text (issue #67 "Presentation"). Display units (m, %) appear only
 * here; the plan and the core stay in integer mm and ‰.
 *
 * Line 1: "Pieces: 8 new, 2 reused"
 * Line 2: "Length 214 m · Grade 1.2 % · Min radius 180 m · End height +6 m"
 * Line 3: "Hold Ctrl (⌥ on Mac) for precision · [ ] change height"
 * Invalid: "Can't build: <reason>" plus the fix hint.
 */

export const HINT_LINE = "Hold Ctrl (⌥ on Mac) for precision · [ ] change height";
export const PRECISION_CONTROLS = "wheel radius · Q/E end heading";

/** Grade colour bands in ‰: green ≤ 1.5 %, amber up to the 35‰ (3.5 %) maximum, red above it. */
export const GRADE_GREEN_MAX_PERMILLE = 15;
export const MAX_GRADE_PERMILLE = 35;

/**
 * The grade's colour band. The issue gives green ≤ 1.5 %, amber ≤ 3 % and red
 * above the maximum (3.5 %); grades in (3 %, 3.5 %] are still buildable, so
 * they stay amber rather than read as an error.
 */
export function gradeLevel(permille: number): GradeLevel {
  const g = Math.abs(permille);
  if (g <= GRADE_GREEN_MAX_PERMILLE) return "green";
  if (g <= MAX_GRADE_PERMILLE) return "amber";
  return "red";
}

export function formatCounts(counts: Counts): string {
  return `Pieces: ${counts.new} new, ${counts.reused} reused`;
}

/** Whole metres from mm: "214 m". */
export function formatLength(mm: number): string {
  return `${Math.round(mm / 1000)} m`;
}

/** ‰ as a percentage with one decimal, rounded once (half up): 12.47 → "1.2 %". Pass the unrounded grade. */
export function formatGrade(permille: number): string {
  return `${(Math.round(Math.abs(permille)) / 10).toFixed(1)} %`;
}

/**
 * The steepest piece's grade in ‰, unrounded: the largest exact |rise| /
 * length among the pieces, the value the planner's label rounds once. The
 * plan's `maxGradePermille` is already rounded to 0.1 ‰, so rounding it
 * again could disagree with the label (12.47 ‰ → 12.5 → "1.3 %" beside
 * "1.2%"). 0 for no pieces.
 */
export function steepestPermille(pieces: readonly PieceSpec[]): number {
  let steepest = 0;
  for (const spec of pieces) {
    const res = resolvePiece(spec);
    if (res.ok) steepest = Math.max(steepest, Math.abs(res.piece.gradePermille.num) / res.piece.gradePermille.den);
  }
  return steepest;
}

/** A signed height in metres, to 0.1 m with trailing zeros trimmed: "+6 m", "−0.5 m", "0 m". */
export function formatHeight(mm: number): string {
  const tenths = Math.round(mm / 100);
  if (tenths === 0) return "0 m";
  const sign = tenths > 0 ? "+" : "−";
  const abs = Math.abs(tenths);
  const text = abs % 10 === 0 ? String(abs / 10) : (abs / 10).toFixed(1);
  return `${sign}${text} m`;
}

/**
 * Line 2's metrics. "Grade" is the steepest piece's, not the drag's average:
 * track follows the ground, so a level drag over a hill still shows its
 * flanks. "Min radius" is the tightest curve; "End height" is the end's
 * height above the ground there.
 */
export function formatMetrics(plan: TrackPlan, endHeightMm: number): TooltipMetrics {
  const grade = steepestPermille(plan.pieces);
  return {
    length: `Length ${formatLength(plan.lengthMm)}`,
    grade: `Grade ${formatGrade(grade)}`,
    gradeLevel: gradeLevel(grade),
    minRadius: `Min radius ${plan.minRadiusM === null ? "—" : `${plan.minRadiusM} m`}`,
    endHeight: `End height ${formatHeight(endHeightMm)}`,
  };
}

export function metricsLine(m: TooltipMetrics): string {
  return `${m.length} · ${m.grade} · ${m.minRadius} · ${m.endHeight}`;
}

/**
 * Splits a core message ("<what is wrong>; <how to fix it>.") into the
 * reason and the fix hint, at the last "; ". A message without one is all
 * reason.
 */
export function splitReason(reason: Pick<Reason, "message">): { reason: string; fix: string | null } {
  const text = reason.message.trim();
  const at = text.lastIndexOf("; ");
  if (at < 0) return { reason: text.replace(/\.$/, ""), fix: null };
  const fix = text.slice(at + 2);
  return { reason: text.slice(0, at), fix: fix.charAt(0).toUpperCase() + fix.slice(1) };
}

/**
 * The tooltip's structure line (D4): "Structure: bridge" when every piece shares one structure, counts
 * when they mix ("Structure: 2 bridge, 1 tunnel, 3 ground", zeros left out), and nothing for a Track
 * plan that is all ground (the D3 tooltip, unchanged).
 */
export function formatStructures(mode: StructureMode, structures: readonly Structure[]): string | null {
  if (structures.length === 0) return null;
  const counts: Record<Structure, number> = { bridge: 0, tunnel: 0, ground: 0 };
  for (const s of structures) counts[s] += 1;
  if (counts.ground === structures.length && mode === "auto") return null;
  const kinds = (["bridge", "tunnel", "ground"] as const).filter((k) => counts[k] > 0);
  if (kinds.length === 1) return `Structure: ${kinds[0]}`;
  return `Structure: ${kinds.map((k) => `${counts[k]} ${k}`).join(", ")}`;
}

export interface TooltipInput {
  readonly plan: TrackPlan;
  /** End height above the terrain at the plan's end, integer mm. */
  readonly endHeightMm: number;
  /** The preview's rejection, or null when the plan is buildable (or empty). */
  readonly rejection: Pick<Reason, "message"> | null;
  readonly precision: boolean;
  readonly anchor: NodeRef | null;
  /** The structure line (`formatStructures`), or null. */
  readonly structure?: string | null;
}

export function buildTooltip(input: TooltipInput): TooltipModel {
  const { plan } = input;
  const empty = plan.fit === "none";
  const counts = formatCounts(plan.counts);
  const structure = empty ? null : (input.structure ?? null);
  const metrics = empty ? null : formatMetrics(plan, input.endHeightMm);
  const invalid = input.rejection ? splitReason(input.rejection) : null;
  const note = empty ? plan.note : null;
  const precision = input.precision ? `Precision: ${plan.label} · ${PRECISION_CONTROLS}` : null;
  const lines: string[] = [counts];
  if (structure) lines.push(structure);
  if (metrics) lines.push(metricsLine(metrics));
  if (note) lines.push(note);
  if (invalid) {
    lines.push(`Can't build: ${invalid.reason}`);
    if (invalid.fix) lines.push(invalid.fix);
  }
  if (precision) lines.push(precision);
  lines.push(HINT_LINE);
  return { counts, structure, metrics, note, invalid, precision, hint: HINT_LINE, lines, anchor: input.anchor };
}

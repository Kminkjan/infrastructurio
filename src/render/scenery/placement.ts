import { Vector3 } from "three";
import { simToWorld } from "../coords";

/**
 * Placement helpers for scenery: turning sim plan directions into world yaw.
 * Directions go through `coords.ts` (the only sim ↔ world conversion), so a
 * change of convention there carries through here.
 */

const scratch = new Vector3();

/**
 * The yaw about world +Y that turns model +X (an asset's forward) onto the
 * sim plan direction (dx, dy). Ry(θ) maps +X to (cos θ, 0, −sin θ).
 */
export function planYaw(dx: number, dy: number): number {
  const w = simToWorld(dx, dy, 0, scratch);
  return Math.atan2(-w.z, w.x);
}

/** Yaw for a lattice heading (0–11, 30° steps counter-clockwise from east). */
export function headingYaw(heading: number): number {
  const a = (heading * Math.PI) / 6;
  return planYaw(Math.cos(a), Math.sin(a));
}

/** Chunk coordinate of a plan position for a chunk size in metres. */
export function chunkOf(xM: number, yM: number, chunkM: number): { cx: number; cy: number } {
  return { cx: Math.floor(xM / chunkM), cy: Math.floor(yM / chunkM) };
}

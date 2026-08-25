/**
 * The surface the map draws on. A screen offset goes in, a screen offset comes out.
 *
 * Pure functions. No canvas, no DOM, and no camera. The caller has already turned a world
 * position into an offset from the middle of the viewport, so this file never sees a node.
 *
 * The middle of the screen is undistorted, and the distortion grows toward the limb. Read a
 * node's offset from the middle as an arc length along a sphere of radius `R`, so the angle is
 * `t = offset / R`. The node draws at `R·sin(t)`, and it shrinks by `cos(t)`. At the middle
 * `sin(t) ≈ t`, so nothing there moves. At `t = 90°` the surface is edge-on, the node has no
 * width left, and it is gone. That angle is the limb.
 *
 * Past the limb `sin(t)` decreases again. A node there would fold back inside the disc and land
 * on top of the near side, so `project` returns null instead. Nothing wraps: a node that leaves
 * the left of the screen comes back by panning right, and no other way.
 */
import type { Point } from "./placement.js"

/**
 * The angle at which the surface turns away, in radians.
 *
 * A hair under a right angle, not a right angle. At exactly 90° the scale is zero and the
 * bearing is undefined, and the caller would be handed a node with no width. The gap is a
 * quarter of a thousandth of the way around the sphere, so nothing is given up for it.
 */
export const LIMB = Math.PI / 2 - 1e-4

/**
 * What the reader may set the curvature to, and what they get before they set anything.
 *
 * At 1 the limb sits on the shorter edge of the viewport, so the whole surface is on screen.
 * Above 1 the limb moves outside it, and the map keeps more of the corners. At 3 a corner is
 * compressed by a few per cent. The picture reads as flat there, so no separate setting has to
 * turn the globe off.
 *
 * Held here rather than in settings.ts, because this file is what the numbers mean. The setting
 * clamps against these, and the slider takes its ends from them.
 */
export const CURVATURE = { min: 0.7, max: 3, fallback: 1 } as const

/** Where a node draws, and how much of its size is left. */
export interface Projected extends Point {
  /**
   * The local scale, 1 at the middle and 0 at the limb.
   *
   * One number, not two. The surface compresses along the radius and leaves the tangent alone,
   * so a faithful mark would be an ellipse turned to face the middle. Every glyph here shrinks
   * by this instead. At the angle where the difference between the two would show, a node is
   * already down to a pixel and a half.
   */
  k: number
}

/**
 * The radius of the surface, in screen pixels.
 *
 * The shorter half-span, so at curvature 1 the limb touches the top and bottom of a wide
 * window rather than running off it. The corners are outside the disc either way, and a limb
 * the reader cannot see is a limb that explains nothing.
 */
export function radius(halfW: number, halfH: number, curvature: number): number {
  return Math.min(halfW, halfH) * curvature
}

/**
 * Project an offset from the middle of the viewport. Null once the surface has turned away.
 *
 * `sx` and `sy` are flat screen pixels: the world distance from the camera, times the zoom.
 * The result is in the same units, measured from the same point.
 */
export function project(sx: number, sy: number, R: number): Projected | null {
  const d = Math.hypot(sx, sy)
  const t = d / R
  if (t >= LIMB) return null
  // The middle is the one point with no bearing to scale along, and `d` is zero there.
  const scale = d > 1e-6 ? (R * Math.sin(t)) / d : 1
  return { x: sx * scale, y: sy * scale, k: Math.cos(t) }
}

/**
 * Run the projection backwards, for a cursor.
 *
 * This is what keeps a click working. The pointer lands on a drawn position. Every test the map
 * makes from there is a question about world coordinates.
 *
 * Clamped at the limb rather than refused. A cursor outside the disc is a real event, and the
 * answer that costs least is the point on the limb nearest it.
 */
export function unproject(mx: number, my: number, R: number): Point {
  const d = Math.hypot(mx, my)
  if (d < 1e-6) return { x: 0, y: 0 }
  const arc = R * Math.asin(Math.min(1, d / R))
  return { x: (mx / d) * arc, y: (my / d) * arc }
}

/**
 * How far a flat offset can reach before `project` refuses it.
 *
 * A box, so a caller can drop a node before doing the arithmetic. It is wider than the disc at
 * the corners, so it passes a few nodes that `project` then returns null for. That is the right
 * way round: a cheap test that never rejects a node it should have kept.
 */
export function bounds(R: number): number {
  return R * LIMB
}

/**
 * The angle past which nothing drawn is still on screen, in radians.
 *
 * At curvature 1 and below this is the limb. The disc is then drawn inside the viewport, so a
 * node inside the limb is a node on screen. Above 1 the disc is drawn wider than the window.
 * The limb alone would then call a node visible that is off the side of it.
 *
 * The corner rather than the nearest edge. A node past the corner's radius is outside the
 * rectangle on every bearing. The corners are the last part of the window a node leaves, and a
 * ghost may only stand for a node nobody can see.
 */
export function horizon(halfW: number, halfH: number, R: number): number {
  return Math.min(LIMB, Math.asin(Math.min(1, Math.hypot(halfW, halfH) / R)))
}

/**
 * How far past the limb a neighbour must be before a ghost stands for it, in radians.
 *
 * The argument is a length in screen pixels, and the answer is an angle, because that is the
 * only conversion that keeps the length's meaning. The dead band exists so that a keyboard pan
 * and the pan back give the same picture. That pan step is a number of screen pixels.
 *
 * A fixed angle cannot stay wider than that step. The same 120px is 34° of arc on a short
 * window, and 5° on a tall one at full curvature.
 */
export function marginAngle(screenPixels: number, R: number): number {
  return screenPixels / R
}

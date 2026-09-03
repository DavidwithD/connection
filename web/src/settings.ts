/** What the reader has asked the page to do, kept in the browser. */
import { CURVATURE } from "./projection.js"

/**
 * The one stored value that means on.
 *
 * Everything else is off — absent, empty, or a word some later version of this file wrote. The
 * comparison against this one string is therefore the whole of the default, and no branch has
 * to state it. A switch has no shape to get wrong, so neither of the two below parses what it
 * reads back.
 */
const ON = "on"

const WALK_BY_PAN = "connection:walk-by-pan"
const RAIL_OUT = "connection:rail-out"
const CURVATURE_KEY = "connection:curvature"

/**
 * Reading storage is allowed to fail.
 *
 * A browser with site data blocked throws on the property itself, not on the call, so both
 * directions are wrapped. A refusal is not an error state here: the page works, the setting
 * just does not outlive the tab.
 */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Nothing to do and nothing to tell the reader. The value below is already set, so the
    // toggle works for this session either way.
  }
}

/**
 * Held rather than read each time.
 *
 * `viewport` fires on every frame of a pan and asks this on each one, and `getItem` is
 * synchronous. The answer changes only when somebody clicks the box, so reading storage sixty
 * times a second would put the disk on the frame budget.
 *
 * Held, not frozen at load. The value sits behind a call, so nothing captures it in a closure,
 * and a change takes effect on the next pan rather than the next reload.
 */
let walking = stored(WALK_BY_PAN) === ON

/**
 * Whether a pan hands the centre to whatever it passes.
 *
 * Off is the rule the map is built around — the centre is named, and moving the camera is
 * looking. On gives it back to the camera, and with it the drift that costs: a seat is
 * permanent, so every node the middle crosses is placed for good.
 */
export const walkByPan = (): boolean => walking

export function setWalkByPan(on: boolean): void {
  // Before the write, not after. A browser that refuses storage still gets the setting it
  // was just asked for.
  walking = on
  keep(WALK_BY_PAN, on ? ON : "")
}

/**
 * Whether the island drawer is out.
 *
 * Not held the way `walking` is. Boot reads it once, and a click writes it without reading.
 * The markup ships shut, so a stored "" and a fresh browser agree.
 */
export const railOut = (): boolean => stored(RAIL_OUT) === ON

export function setRailOut(out: boolean): void {
  keep(RAIL_OUT, out ? ON : "")
}

/**
 * Read a stored curvature. A number in range comes back as itself, and the rest as the default.
 *
 * The first number this file keeps, and so the first value it can read back wrong. Never set
 * is `""`, which `Number` reads as 0. A radius of 0 puts every node past the limb, and the map
 * draws blank. A word another version wrote is `NaN`, and no comparison against `NaN` is true.
 * A legal number outside the range draws a picture nobody chose.
 *
 * The range and the default are projection.ts's, because that file is what the numbers mean.
 */
function asCurvature(raw: string | null): number {
  if (!raw) return CURVATURE.fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return CURVATURE.fallback
  return Math.min(CURVATURE.max, Math.max(CURVATURE.min, value))
}

/**
 * Held rather than read back on each call, which is where this differs from `railOut`.
 *
 * A refused write is the reason. The slider has to keep working in a browser with site data
 * blocked. What comes back from a re-read there is the default, not the value just set.
 */
let curve = asCurvature(stored(CURVATURE_KEY))

/** How curved the surface the map draws on is. The slider on the map page is the only writer. */
export const curvature = (): number => curve

export function setCurvature(value: number): void {
  // Through the same parse the read uses, so what is stored is what took effect. A number
  // typed into devtools is clamped on the way in rather than on the next reload.
  curve = asCurvature(String(value))
  keep(CURVATURE_KEY, String(curve))
}

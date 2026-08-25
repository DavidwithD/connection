/** What the reader has asked the page to do, kept in the browser. */

/**
 * The one stored value that means on.
 *
 * Everything else is off — absent, empty, or a word some later version of this file wrote. The
 * comparison against this one string is therefore the whole of the default, and no branch has
 * to state it. Nothing here parses either: there is no shape to get wrong and nothing to throw
 * on.
 */
const ON = "on"

const WALK_BY_PAN = "connection:walk-by-pan"
const RAIL_OUT = "connection:rail-out"

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

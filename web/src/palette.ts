/** Validated colour tokens, light and dark. */

export interface Palette {
  surface: string
  /**
   * The page behind the map, which a drawn surface sits on.
   *
   * The same `--plane` app.css gives every recessed box, so the ground around a surface reads
   * as page rather than as a second map.
   */
  plane: string
  /** The line app.css rules a box off with. A drawn surface is outlined in it. */
  hairline: string
  /** The centre node. A reserved accent. It is not a step on the hop ramp. */
  accent: string
  accentRing: string
  /**
   * The centre's name. It is drawn on the accent fill, not on the surface, so it needs its
   * own contrast pair. Dark in both themes, because the accent is a mid-tone orange in both.
   */
  inkOnAccent: string
  /**
   * Index 0 is hop 1. The last entry covers every hop beyond the ramp.
   *
   * Hop distance is an ordinal value, so the ramp is one hue stepped light to dark rather
   * than several hues. Both ramps were checked with the palette validator:
   *
   *   light  blue 250/350/450/550   ordinal: 4/4 pass (adjacent ΔL >= 0.06)
   *   dark   blue 300/400/500/600   ordinal: 4/4 pass (dark end 2.15:1 vs surface)
   *   accent vs nearest hop step    CVD ΔE 24.4 light / 24.9 dark (>= 8 target)
   *   ink on the accent fill        6.2:1 light / 5.1:1 dark (>= 4.5 target)
   *
   * Use the steps as they are. Do not interpolate between them: a value between two steps
   * has not been validated, and four classes do not need a continuous scale.
   */
  hop: readonly string[]
  edge: string
  edgeActive: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  frontierRing: string
}

const LIGHT: Palette = {
  surface: "#fcfcfb",
  plane: "#f9f9f7",
  hairline: "rgba(11, 11, 11, 0.1)",
  accent: "#eb6834",
  accentRing: "#fcfcfb",
  inkOnAccent: "#0b0b0b",
  hop: ["#1c5cab", "#2a78d6", "#5598e7", "#86b6ef"],
  edge: "#c3c2b7",
  edgeActive: "#898781",
  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  textMuted: "#898781",
  frontierRing: "#52514e",
}

const DARK: Palette = {
  surface: "#1a1a19",
  plane: "#0d0d0d",
  hairline: "rgba(255, 255, 255, 0.1)",
  accent: "#d95926",
  accentRing: "#1a1a19",
  inkOnAccent: "#0b0b0b",
  hop: ["#6da7ec", "#3987e5", "#256abf", "#184f95"],
  edge: "#383835",
  edgeActive: "#898781",
  textPrimary: "#ffffff",
  textSecondary: "#c3c2b7",
  textMuted: "#898781",
  frontierRing: "#c3c2b7",
}

/** How many hop classes the ramp can tell apart. Beyond this they all look the same. */
export const HOP_CLASSES = LIGHT.hop.length

const query = window.matchMedia("(prefers-color-scheme: dark)")

function stamped(): "light" | "dark" | null {
  const value = document.documentElement.dataset["theme"]
  return value === "light" || value === "dark" ? value : null
}

export const currentPalette = (): Palette =>
  (stamped() ?? (query.matches ? "dark" : "light")) === "dark" ? DARK : LIGHT

/**
 * Call `fn` when the theme changes. It watches the OS setting and the `data-theme`
 * attribute, so an in-page toggle works as well.
 *
 * Returns an unsubscribe function. Nothing in this project calls it, because both
 * subscribers live as long as the page. A subscriber with a shorter life needs it: the
 * leak is silent, since the restyle keeps running against an element that is gone.
 */
export function onThemeChange(fn: (palette: Palette) => void): () => void {
  const fire = (): void => fn(currentPalette())
  const stamp = new MutationObserver(fire)
  query.addEventListener("change", fire)
  stamp.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  })
  return () => {
    query.removeEventListener("change", fire)
    stamp.disconnect()
  }
}

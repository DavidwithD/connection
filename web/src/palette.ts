/**
 * Colour tokens for the graph, and the theme switch.
 *
 * Hop distance is an *ordinal* encoding — discrete, ordered marks — so it gets one
 * hue stepped light→dark, and the centre gets a reserved accent from a different
 * hue. Both ramps were run through the palette validator rather than eyeballed:
 *
 *   light  blue 250/350/450/550   ordinal: 4/4 pass (adjacent ΔL >= 0.06)
 *   dark   blue 300/400/500/600   ordinal: 4/4 pass (dark end 2.15:1 vs surface)
 *   accent vs nearest hop step    CVD ΔE 24.4 light / 24.9 dark (>= 8 target)
 *   ink on the accent fill        6.2:1 light / 5.1:1 dark (>= 4.5 target)
 *
 * The steps are applied discretely, never interpolated. Interpolating between them
 * would put colours on screen that nothing validated, and five classes do not need
 * a continuous scale.
 */

export interface Palette {
  surface: string
  /** Centre node. A reserved accent, not a step on the hop ramp. */
  accent: string
  accentRing: string
  /**
   * The centre's name, which sits *on* the accent rather than on the surface, so it needs
   * its own contrast pair. Dark in both themes: the accent is a mid-tone orange either way.
   */
  inkOnAccent: string
  /** Index 0 is hop 1; the last entry covers every hop beyond the ramp. */
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

/** How many hop classes the ramp distinguishes before everything looks the same. */
export const HOP_CLASSES = LIGHT.hop.length

const query = window.matchMedia("(prefers-color-scheme: dark)")

function stamped(): "light" | "dark" | null {
  const value = document.documentElement.dataset["theme"]
  return value === "light" || value === "dark" ? value : null
}

export const currentPalette = (): Palette =>
  (stamped() ?? (query.matches ? "dark" : "light")) === "dark" ? DARK : LIGHT

/** Fires on the OS setting and on a `data-theme` stamp, so a toggle wins both ways. */
export function onThemeChange(fn: (palette: Palette) => void): void {
  query.addEventListener("change", () => fn(currentPalette()))
  new MutationObserver(() => fn(currentPalette())).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  })
}

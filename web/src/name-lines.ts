/**
 * Split a node's name into lines that fit a width. Pure. No canvas and no DOM.
 *
 * The caller passes `measure`, so the globe measures on its own canvas and a test measures
 * with string length.
 */

/** A name broken into lines, and the width of the widest one. */
export interface NameLines {
  lines: string[]
  width: number
}

const ELLIPSIS = "…"

/**
 * Break a name at spaces so that no line is wider than `maxWidth`.
 *
 * A word wider than `maxWidth` is broken between characters. Text with no spaces, such as
 * Chinese or Japanese, wraps the same way.
 *
 * Past `maxLines`, the last line ends with an ellipsis and the rest is dropped. Pass
 * `Infinity` to keep every line.
 */
export function wrapName(
  label: string,
  measure: (text: string) => number,
  maxWidth: number,
  maxLines: number,
): NameLines {
  const words = label.split(/\s+/).filter((word) => word !== "")
  const all: string[] = []
  let line = ""

  for (const word of words) {
    const joined = line ? `${line} ${word}` : word
    if (measure(joined) <= maxWidth) {
      line = joined
      continue
    }
    if (line) all.push(line)
    line = ""
    // The word did not fit even alone on a fresh line, so break it between characters.
    let piece = ""
    for (const char of Array.from(word)) {
      if (piece && measure(piece + char) > maxWidth) {
        all.push(piece)
        piece = ""
      }
      piece += char
    }
    line = piece
  }
  if (line) all.push(line)
  if (all.length === 0) all.push("")

  const lines = all.slice(0, Math.max(1, maxLines))
  if (all.length > lines.length) {
    const last = lines.length - 1
    lines[last] = ellipsize(lines[last]!, measure, maxWidth)
  }
  return { lines, width: Math.max(...lines.map(measure)) }
}

/** Drop characters from the end of a line until the line and an ellipsis fit. */
function ellipsize(line: string, measure: (text: string) => number, maxWidth: number): string {
  const chars = Array.from(line)
  while (chars.length > 0 && measure(chars.join("").trimEnd() + ELLIPSIS) > maxWidth) {
    chars.pop()
  }
  return chars.join("").trimEnd() + ELLIPSIS
}

/**
 * The string a name is matched on, and the character that joins two names into one key.
 *
 * IndexedDB does the rest. A node is keyed by its normalised name, an edge by the pair
 * `["a", "b"]`, and neither needs a key builder.
 */

/**
 * Normalise a name. Trim it, lowercase it, and collapse runs of whitespace. Nothing else.
 *
 * So `Kavara` and `kavara` are one node, and `Zoë` and `Zoe` stay two. Folding diacritics
 * would decide for the reader which names are the same.
 */
export const normaliseLabel = (label: string): string =>
  label.trim().toLowerCase().replace(/\s+/g, " ")

/**
 * Build the display name and the key together. Nothing else writes either field.
 *
 * The two must agree. A record whose `label` is not the spelling of its own key is a node
 * found under one name and shown under another. One helper keeps them in step. `verify` in
 * transfer.ts checks that they stayed in step.
 *
 * Returns null for a name that normalises to nothing. Such a name has no key and could never
 * be found again. The caller decides what to report.
 */
export function naming(label: string): { label: string; labelKey: string } | null {
  const name = label.trim().replace(/\s+/g, " ")
  const key = normaliseLabel(name)
  return key ? { label: name, labelKey: key } : null
}

/**
 * A NUL character, used to join two names into one key.
 *
 * No name can contain it, so a key built with it needs no escaping. Everywhere in this app
 * that keys a pair joins with this character, for this reason.
 *
 * Built with `fromCodePoint` rather than written literally. A literal NUL in a file's first
 * 8000 bytes makes git treat the file as binary and stop diffing it.
 */
export const NUL = String.fromCodePoint(0)

/**
 * The key for one undirected edge. The ends are sorted, so a pair gives one key.
 *
 * The NUL joins them because no name can contain one. The tilde used before was safe when
 * ids were `n-<uuid>`. Against names it is not: `edgeKey("a~b", "c")` and
 * `edgeKey("a", "b~c")` would produce the same string.
 */
export const edgeKey = (a: string, b: string): string =>
  a < b ? `${a}${NUL}${b}` : `${b}${NUL}${a}`

/** The same pair as an array, for IndexedDB's composite key. No separator is needed. */
export const edgeEnds = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a]

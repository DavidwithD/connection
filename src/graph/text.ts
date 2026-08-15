/**
 * A graph as lines of names, read and written.
 *
 *   # a comment, and a blank line, both say nothing
 *   Thorne                        # a node and no edges — an island of one
 *   Kavara | Miselin | Vessarin   # Kavara joins Miselin, and Kavara joins Vessarin
 *
 * Both directions live here because they are one format, and a rule stated twice drifts.
 */
import type { Item } from "./bulk.js"
import { components } from "./islands.js"
import { EDGE_PREFIX, META_SK, edgeTarget, nodeId, normaliseLabel } from "./keys.js"
import { GRAPH_KEYS as KEYS } from "./table.js"

/** What separates the names on a line, and what starts a comment. A name can hold neither. */
export const SEPARATOR = "|"
export const COMMENT = "#"

/**
 * A NUL, for joining two names into one key below.
 *
 * Built from its code point rather than written into the source, for the reason
 * src/graph/restore.ts gives about the files it reads: a NUL in the first 8000 bytes makes
 * git call the whole thing binary and stop diffing it, which is an expensive way to hide a
 * separator nobody reads.
 */
const NUL = String.fromCodePoint(0)

/**
 * One pair, either way round, as one key.
 *
 * A NUL joins the two because no name can hold one, so the key needs no escaping. Not
 * `edgeKey` from keys.ts, which canonicalises a pair of *ids* with a character a name is
 * free to contain.
 */
export const pairKey = (a: string, b: string): string =>
  [normaliseLabel(a), normaliseLabel(b)].sort().join(NUL)

export interface Reading {
  /** Every distinct name, in the order the file first spells it. */
  names: string[]
  /** Every distinct pair, by those same spellings. */
  pairs: [string, string][]
  faults: string[]
  /** Lines that said something, comments and blanks not counted. */
  lines: number
}

/**
 * The file, as names and pairs. Pure: it reads no table and asks nothing of one.
 *
 * Every fault is collected rather than thrown at the first, which is the habit
 * src/graph/restore.ts sets for the same reason — a hand-typed file repaired one complaint
 * at a time is an afternoon.
 *
 * Names are deduplicated by their normalised form and kept in the spelling the file uses
 * first, because that is the spelling `createNode` will store and the one every later line
 * has to agree with. `normaliseLabel` folds case and runs of whitespace and nothing else
 * (src/graph/keys.ts), so `Kavara` and `kavara` are one node while `Zoë` and `Zoe` are two.
 */
export function parse(text: string): Reading {
  const faults: string[] = []
  const names = new Map<string, string>() // normalised -> the spelling that came first
  const pairs = new Map<string, [string, string]>()
  let lines = 0

  text.split(/\r?\n/).forEach((raw, index) => {
    const at = index + 1
    const hash = raw.indexOf(COMMENT)
    const line = (hash < 0 ? raw : raw.slice(0, hash)).trim()
    if (!line) return
    lines++

    const named: string[] = []
    for (const field of line.split(SEPARATOR)) {
      // The same tidy `createNode` performs, so what is checked here is what is written.
      const name = field.trim().replace(/\s+/g, " ")
      const key = normaliseLabel(name)
      if (!key) {
        faults.push(`line ${String(at)}: "${line}" has an empty name`)
        continue
      }
      if (!names.has(key)) names.set(key, name)
      named.push(names.get(key)!)
    }

    // Everything on the line was empty; the fault above already says so.
    const [anchor, ...rest] = named
    if (anchor === undefined) return

    for (const other of rest) {
      // Both are first spellings, so equal strings are the one node — and the store has no
      // self-edges (src/graph/edge.ts), so this is the file's mistake rather than a write's.
      if (other === anchor) {
        faults.push(`line ${String(at)}: "${anchor}" is joined to itself`)
        continue
      }
      const key = pairKey(anchor, other)
      if (!pairs.has(key)) pairs.set(key, [anchor, other])
    }
  })

  return { names: [...names.values()], pairs: [...pairs.values()], faults, lines }
}

/**
 * Which of the two files a write produces.
 *
 * `joins` is the format above. `names` is every label and nothing else, which this reader
 * still accepts — every line is a lone name, so loading one reproduces the nodes and none
 * of the edges. A vocabulary rather than a graph, and worth its own shape because that is
 * what a list of names is wanted for.
 */
export type Shape = "joins" | "names"

/**
 * A name no line can carry.
 *
 * There is no escape in this format and adding one would change what every existing file
 * means, so a graph holding such a name cannot be written down at all. Nothing rejects
 * these at the point a node is made (src/graph/node.ts), which is why the writer has to.
 */
export class Unwritable extends Error {
  constructor(readonly names: string[]) {
    super(
      `${String(names.length)} name(s) hold ${SEPARATOR} or ${COMMENT}, which a line cannot ` +
        `carry: ${names.slice(0, 5).join(", ")}${names.length > 5 ? " …" : ""}\n` +
        "  rename them, or take the graph out as JSON instead",
    )
    this.name = "Unwritable"
  }
}

/**
 * A graph's items as a file `parse` would read back.
 *
 * Pure, over whatever `select` in src/graph/export.ts hands back, so what is written is
 * what was chosen rather than a second opinion about which items belong.
 *
 * Every ordering here is by *label*, and that is load-bearing rather than tidy. A file
 * loaded into an empty table comes back with new ids — `n-<uuid>` where a seed had `n0000`
 * — so an id anywhere in the sort would make the second export of one graph differ from the
 * first, and the round trip could not be checked by comparing them. Labels are unique by
 * claim, so they order this on their own.
 *
 * Nothing here is dated, for the same reason. The JSON export stamps itself because it is a
 * backup; this file is meant to be edited and committed, and a stamp would make every
 * re-export a diff with no change in it.
 */
export function format(items: Item[], shape: Shape): string {
  const labels = new Map<string, string>()
  for (const item of items) {
    const pk = String(item[KEYS.pk] ?? "")
    if (!pk.startsWith("node#") || item[KEYS.sk] !== META_SK) continue
    labels.set(nodeId(pk), String(item["label"] ?? ""))
  }

  const unwritable = [...labels.values()]
    .filter((label) => label.includes(SEPARATOR) || label.includes(COMMENT))
    .sort()
  if (unwritable.length) throw new Unwritable(unwritable)

  const sortable = (id: string): string => normaliseLabel(labels.get(id) ?? "")
  const byLabel = (a: string, b: string): number =>
    sortable(a) < sortable(b) ? -1 : sortable(a) > sortable(b) ? 1 : 0

  if (shape === "names") {
    // The count is of this file, not of the graph it came from. Naming the edges it does not
    // carry would describe something the reader cannot get back by loading it.
    const head = `${COMMENT} ${String(labels.size)} name(s)`
    const lines = [...labels.keys()].sort(byLabel).map((id) => labels.get(id) ?? "")
    return [head, "", ...lines, ""].join("\n")
  }

  // Each edge is stored from both ends (src/graph/keys.ts), so the two copies collapse to one
  // pair. An edge naming a node that is not here is dropped rather than written as a name
  // nothing else mentions — the same rule `select` applies to the items it hands over.
  const pairs = new Map<string, [string, string]>()
  for (const item of items) {
    const pk = String(item[KEYS.pk] ?? "")
    const sk = String(item[KEYS.sk] ?? "")
    if (!pk.startsWith("node#") || !sk.startsWith(EDGE_PREFIX)) continue
    const from = nodeId(pk)
    const to = edgeTarget(sk)
    if (!labels.has(from) || !labels.has(to)) continue
    const [a, b] = from < to ? [from, to] : [to, from]
    pairs.set(`${a}~${b}`, [a, b])
  }

  // Counted from the edges kept rather than read off `degree`, which is the rule the JSON
  // export follows for the same reason: a stored count can outlive the edges it counted.
  const degree = new Map<string, number>()
  for (const id of labels.keys()) degree.set(id, 0)
  for (const [a, b] of pairs.values()) {
    degree.set(a, (degree.get(a) ?? 0) + 1)
    degree.set(b, (degree.get(b) ?? 0) + 1)
  }

  // Which end of a pair writes it: the busier node, so a hub gathers its neighbours onto one
  // line and the file reads the way somebody would have typed it. Ties by name, so one graph
  // always produces one file.
  const anchored = new Map<string, string[]>()
  for (const [a, b] of pairs.values()) {
    const da = degree.get(a) ?? 0
    const db = degree.get(b) ?? 0
    const [anchor, other] = da > db || (da === db && byLabel(a, b) < 0) ? [a, b] : [b, a]
    const group = anchored.get(anchor!)
    if (group) group.push(other!)
    else anchored.set(anchor!, [other!])
  }

  // A node with no edges is on no line above, and one of its own is the only thing that
  // carries it — the island of one, which is what a lone name means on the way back in.
  for (const [id, count] of degree) if (!count) anchored.set(id, [])

  const { parent, sizes } = components(labels.keys(), pairs.values())
  const islands = new Map<string, string[]>()
  for (const anchor of anchored.keys()) {
    const root = parent.get(anchor) ?? anchor
    const group = islands.get(root)
    if (group) group.push(anchor)
    else islands.set(root, [anchor])
  }
  for (const group of islands.values()) group.sort(byLabel)

  // Largest island first, as the page lists them, and by its first name where two are the
  // same size — which node names a component is decided by the order the unions happened
  // in, and is no more stable across a reload than the ids are.
  const order = [...islands.keys()].sort((a, b) => {
    const size = (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0)
    if (size !== 0) return size
    return byLabel(islands.get(a)?.[0] ?? "", islands.get(b)?.[0] ?? "")
  })

  const head =
    `${COMMENT} ${String(labels.size)} node(s), ${String(pairs.size)} edge(s), ` +
    `${String(islands.size)} island(s)`

  const out: string[] = [head, ""]
  for (const root of order) {
    for (const anchor of islands.get(root) ?? []) {
      const rest = (anchored.get(anchor) ?? [])
        .sort(byLabel)
        .map((id) => labels.get(id) ?? "")
      out.push([labels.get(anchor) ?? "", ...rest].join(` ${SEPARATOR} `))
    }
    // An island to a paragraph. Nothing reads the blank line; it is what makes a file of a
    // few hundred lines something a person can find their place in.
    out.push("")
  }
  return out.join("\n")
}

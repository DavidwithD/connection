/**
 * The text format: a graph as lines of names. Both the reader and the writer.
 *
 *   # comments and blank lines are ignored
 *   Thorne                        # a node with no edges
 *   Kavara | Miselin | Vessarin   # Kavara joins Miselin, and Kavara joins Vessarin
 *
 *   Kavara                        # an indented line hangs from the line above
 *       Miselin | Sarn            # Kavara joins Miselin, and Miselin joins Sarn
 *           Sarn | Veyle          # Sarn joins Veyle. Any depth
 *
 * Reading and writing are in one file because they are one format. Only the reader indents.
 * The writer never does — see `format`.
 */
import type { StoredNode } from "./db.js"
import { components } from "./islands.js"
import { NUL, normaliseLabel } from "./keys.js"

/** What separates names on a line, and what starts a comment. A name can contain neither. */
export const SEPARATOR = "|"
export const COMMENT = "#"

/**
 * One key for a pair of spellings, in either order.
 *
 * The names are normalised first, so two spellings of one name give one key. `edgeKey` does
 * not normalise, because by the time it runs the names are already keys. That is why this is
 * a separate function.
 */
export const spelledPair = (a: string, b: string): string =>
  [normaliseLabel(a), normaliseLabel(b)].sort().join(NUL)

export interface Reading {
  /** Every distinct name, in the order the file first spells it. */
  names: string[]
  /** Every distinct pair, using those same spellings. */
  pairs: [string, string][]
  faults: string[]
  /** Lines that said something. Comments and blank lines are not counted. */
  lines: number
}

/** The leading whitespace of a line. A name is trimmed, so this can never be part of one. */
const indentOf = (raw: string): string => /^[ \t]*/.exec(raw)?.[0] ?? ""

/** What an indent is built from: "tabs", "spaces", or "both" for a line holding each. */
const styleOf = (indent: string): "tabs" | "spaces" | "both" => {
  const tab = indent.includes("\t")
  return tab && indent.includes(" ") ? "both" : tab ? "tabs" : "spaces"
}

/**
 * Parse the file into names and pairs. A pure function: it reads nothing from the store.
 *
 * Every fault is collected rather than thrown at the first one. Every whole-graph check here
 * does the same, because repairing a hand-typed file one complaint at a time takes an
 * afternoon.
 *
 * Names are deduplicated by their normalised form and kept in the spelling the file uses
 * first. That is the spelling `createNode` will store, and the one every later line has to
 * match. `normaliseLabel` in keys.ts folds case and runs of whitespace and nothing else, so
 * `Kavara` and `kavara` are one node while `Zoë` and `Zoe` are two.
 *
 * An indented line hangs from the line above it. Its **first** name joins that line's first
 * name. The rest of the line reads as an ordinary star. So `Sarn | Veyle` under
 * `Kavara | Miselin` gives Kavara–Sarn and Sarn–Veyle. It does not give Kavara–Veyle. Depth
 * is not limited.
 *
 * This is why a name is typed once. Flat, every node with both a parent and children is
 * spelled twice. The second spelling is another chance to make a twin node by typo.
 */
export function parse(text: string): Reading {
  const faults: string[] = []
  const names = new Map<string, string>() // normalised -> the spelling that came first
  const pairs = new Map<string, [string, string]>()
  let lines = 0

  // The lines an indented line can hang from, outermost first. Each holds the column it
  // starts at and the name a child of it joins.
  const open: { column: number; anchor: string }[] = []

  // The first line that indented, and what it indented with. Columns can only be compared
  // inside one style, so the file has to pick one.
  let style: { at: number; used: "tabs" | "spaces" } | null = null
  let mixed = false

  const join = (anchor: string, other: string, at: number): void => {
    // Both are first spellings, so two equal strings are the same node. The store has no
    // self-edges, so report it as a fault in the file rather than letting the write fail.
    if (other === anchor) {
      faults.push(`line ${String(at)}: "${anchor}" is joined to itself`)
      return
    }
    const key = spelledPair(anchor, other)
    if (!pairs.has(key)) pairs.set(key, [anchor, other])
  }

  text.split(/\r?\n/).forEach((raw, index) => {
    const at = index + 1
    const hash = raw.indexOf(COMMENT)
    const line = (hash < 0 ? raw : raw.slice(0, hash)).trim()
    // A blank line and a comment leave `open` alone, so neither closes a block.
    if (!line) return
    lines++

    const indent = indentOf(raw)
    if (indent && !mixed) {
      const used = styleOf(indent)
      if (used === "both") {
        mixed = true
        faults.push(`line ${String(at)}: "${line}" indents with a tab and a space at once`)
      } else if (style === null) style = { at, used }
      else if (style.used !== used) {
        mixed = true
        faults.push(
          `line ${String(at)}: "${line}" indents with ${used}, but line ` +
            `${String(style.at)} indents with ${style.used}`,
        )
      }
    }

    // The line this one hangs from is the nearest line above it with a smaller indent.
    //
    // A column that no line above sits at hangs from the next one out. A typed file does not
    // hold its columns exactly, and the preview lists every pair it read.
    const column = indent.length
    while ((open.at(-1)?.column ?? -1) >= column) open.pop()
    const under = open.at(-1)?.anchor
    if (column > 0 && under === undefined) {
      faults.push(`line ${String(at)}: "${line}" is indented under nothing`)
    }

    const named: string[] = []
    for (const field of line.split(SEPARATOR)) {
      // The same cleanup `createNode` does, so what is checked here is what gets written.
      const name = field.trim().replace(/\s+/g, " ")
      const key = normaliseLabel(name)
      if (!key) {
        faults.push(`line ${String(at)}: "${line}" has an empty name`)
        continue
      }
      if (!names.has(key)) names.set(key, name)
      named.push(names.get(key)!)
    }

    // Every name on the line was empty. The fault above already reported it.
    const [anchor, ...rest] = named
    if (anchor === undefined) return

    if (under !== undefined) join(under, anchor, at)
    for (const other of rest) join(anchor, other, at)

    open.push({ column, anchor })
  })

  return { names: [...names.values()], pairs: [...pairs.values()], faults, lines }
}

/**
 * Which of the two files the writer produces.
 *
 * `joins` is the format above. `names` is every label and nothing else. This reader still
 * accepts it, because every line is a lone name: loading one reproduces the nodes and none of
 * the edges. It is a word list rather than a graph, and it has its own option because that is
 * what people want a list of names for.
 */
export type Shape = "joins" | "names"

/**
 * A name that cannot be written to a line.
 *
 * The format has no escape character, and adding one would change what every existing file
 * means. So a graph holding such a name cannot be written as text at all. `createNode` in
 * write.ts does not reject these names, so the writer has to.
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
 * Write a graph as a file that `parse` reads back.
 *
 * A pure function over the records it is given. What is written is what the caller chose.
 *
 * Every sort here is by label. That used to matter because a file loaded into an empty table
 * came back with new ids, so any id in the sort made the second export of one graph differ
 * from the first. The name is the id now, so the round trip is stable anyway. The label sort
 * stays, because it keeps two exports of one graph byte-identical.
 *
 * Nothing here is dated, for the same reason. The JSON export stamps itself because it is a
 * backup. This file is meant to be edited and committed, and a timestamp would make every
 * re-export a diff with no real change in it.
 */
export function format(
  nodes: StoredNode[],
  edges: Iterable<readonly [string, string]>,
  shape: Shape,
): string {
  const labels = new Map<string, string>()
  for (const node of nodes) labels.set(node.labelKey, node.label)

  const unwritable = [...labels.values()]
    .filter((label) => label.includes(SEPARATOR) || label.includes(COMMENT))
    .sort()
  if (unwritable.length) throw new Unwritable(unwritable)

  const sortable = (id: string): string => normaliseLabel(labels.get(id) ?? "")
  const byLabel = (a: string, b: string): number =>
    sortable(a) < sortable(b) ? -1 : sortable(a) > sortable(b) ? 1 : 0

  if (shape === "names") {
    // The count describes this file, not the graph it came from. Reporting the edges it does
    // not carry would describe something loading it cannot reproduce.
    const head = `${COMMENT} ${String(labels.size)} name(s)`
    const lines = [...labels.keys()].sort(byLabel).map((id) => labels.get(id) ?? "")
    return [head, "", ...lines, ""].join("\n")
  }

  // Drop an edge that names a node not in `nodes`. The JSON export applies the same rule to
  // the records it hands over.
  const pairs = new Map<string, [string, string]>()
  for (const [from, to] of edges) {
    if (!labels.has(from) || !labels.has(to)) continue
    const [a, b] = from < to ? [from, to] : [to, from]
    pairs.set(spelledPair(a, b), [a, b])
  }

  // Counted from the edges kept, not read from the stored `degree`. The JSON export does the
  // same: a stored count can outlive the edges it counted.
  const degree = new Map<string, number>()
  for (const id of labels.keys()) degree.set(id, 0)
  for (const [a, b] of pairs.values()) {
    degree.set(a, (degree.get(a) ?? 0) + 1)
    degree.set(b, (degree.get(b) ?? 0) + 1)
  }

  // Choose which end of a pair writes the line: the node with the higher degree. A hub then
  // gathers its neighbours onto one line, the way someone would have typed it. Ties break by
  // name, so one graph always produces one file.
  const anchored = new Map<string, string[]>()
  for (const [a, b] of pairs.values()) {
    const da = degree.get(a) ?? 0
    const db = degree.get(b) ?? 0
    const [anchor, other] = da > db || (da === db && byLabel(a, b) < 0) ? [a, b] : [b, a]
    const group = anchored.get(anchor!)
    if (group) group.push(other!)
    else anchored.set(anchor!, [other!])
  }

  // A node with no edges appears on no line above, so give it a line of its own. A lone name
  // is what the reader turns back into a node with no edges.
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

  // Largest island first, as the map page lists them. Ties break by the island's first name.
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
    // One blank line between islands. The reader ignores it. It is there so a file of a few
    // hundred lines can be read.
    out.push("")
  }
  return out.join("\n")
}

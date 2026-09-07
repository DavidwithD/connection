/**
 * The text format, from web/src/store/text.ts. The reader and the writer together.
 *
 * A file someone typed is the one input this repo does not control. Every fault it can hold
 * has to be reported rather than thrown, so most of these tests are about faults.
 */
import { describe, expect, it } from "vitest"

import type { StoredNode } from "../web/src/store/db.js"
import { normaliseLabel } from "../web/src/store/keys.js"
import { Unwritable, format, parse, spelledPair } from "../web/src/store/text.js"

/** The date every record in this file carries. `format` never reads it. */
const MADE = Date.UTC(2026, 0, 1)

/** A stored record. `format` reads the two name fields and nothing else. */
const node = (label: string): StoredNode => ({
  labelKey: normaliseLabel(label),
  label,
  degree: 0,
  parent: normaliseLabel(label),
  created: MADE,
  islandSize: 1,
})

const key = (a: string, b: string): string => spelledPair(a, b)

describe("parse", () => {
  it("reads a lone name as a node with no edges", () => {
    const reading = parse("Thorne")
    expect(reading.names).toEqual(["Thorne"])
    expect(reading.pairs).toEqual([])
    expect(reading.faults).toEqual([])
    expect(reading.lines).toBe(1)
  })

  it("joins the first name on a line to every other name on it", () => {
    const reading = parse("Kavara | Miselin | Vessarin")
    expect(reading.names).toEqual(["Kavara", "Miselin", "Vessarin"])
    expect(reading.pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Vessarin"],
    ])
  })

  it("ignores comments and blank lines, and counts neither", () => {
    const reading = parse(["# a heading", "", "Kavara | Miselin # a note", "   "].join("\n"))
    expect(reading.lines).toBe(1)
    expect(reading.names).toEqual(["Kavara", "Miselin"])
    expect(reading.faults).toEqual([])
  })

  it("reads CRLF the same as LF", () => {
    expect(parse("Kavara\r\nMiselin").names).toEqual(["Kavara", "Miselin"])
  })

  it("keeps the spelling the file uses first", () => {
    const reading = parse("Kavara | Miselin\nkavara | Vessarin")
    expect(reading.names).toEqual(["Kavara", "Miselin", "Vessarin"])
    expect(reading.pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Vessarin"],
    ])
  })

  it("keeps two names apart when only a diacritic separates them", () => {
    expect(parse("Zoë\nZoe").names).toEqual(["Zoë", "Zoe"])
  })

  it("reads one pair once, whichever order the file spells it", () => {
    expect(parse("Kavara | Miselin\nMiselin | Kavara").pairs).toEqual([
      ["Kavara", "Miselin"],
    ])
  })

  it("reports an empty name and keeps reading the line", () => {
    const reading = parse("Kavara || Miselin")
    expect(reading.faults).toHaveLength(1)
    expect(reading.faults[0]).toContain("line 1")
    expect(reading.faults[0]).toContain("empty name")
    expect(reading.pairs).toEqual([["Kavara", "Miselin"]])
  })

  it("reports each empty field on a line, not the line once", () => {
    expect(parse("Miselin ||").faults).toHaveLength(2)
  })

  it("reports a name joined to itself", () => {
    const reading = parse("Kavara | kavara")
    expect(reading.faults).toHaveLength(1)
    expect(reading.faults[0]).toContain("joined to itself")
    expect(reading.pairs).toEqual([])
  })

  it("collects every fault rather than stopping at the first", () => {
    const reading = parse("Kavara | Kavara\nMiselin |\nVessarin | Vessarin")
    expect(reading.faults).toHaveLength(3)
  })

  it("names the line each fault is on", () => {
    const reading = parse("# a heading\n\nKavara | Kavara")
    expect(reading.faults[0]).toContain("line 3")
  })

  it("reads nothing from an empty file", () => {
    expect(parse("")).toEqual({ names: [], pairs: [], faults: [], lines: 0 })
  })
})

describe("parse, indented", () => {
  /** Every pair the reading holds, sorted, so two files can be compared by their edges. */
  const edges = (text: string): string[] =>
    parse(text)
      .pairs.map(([a, b]) => key(a, b))
      .sort()

  it("joins an indented line's first name to the line it hangs from", () => {
    const reading = parse("Kavara | Miselin\n    Sarn | Veyle")
    expect(reading.pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Sarn"],
      ["Sarn", "Veyle"],
    ])
    expect(reading.faults).toEqual([])
  })

  it("hangs a child from the first name above it, never the last", () => {
    expect(edges("Kavara | Miselin\n    Sarn")).toEqual([key("Kavara", "Miselin"), key("Kavara", "Sarn")])
  })

  it("stops a join at the parent, so a grandchild does not reach the grandparent", () => {
    const reading = parse("Kavara\n    Miselin\n        Sarn")
    expect(reading.pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Miselin", "Sarn"],
    ])
    expect(reading.faults).toEqual([])
  })

  it("nests to any depth", () => {
    const deep = ["A", " B", "  C", "   D", "    E"].join("\n")
    expect(edges(deep)).toEqual(
      [key("A", "B"), key("B", "C"), key("C", "D"), key("D", "E")].sort(),
    )
  })

  it("counts an indented line, the same as any line that said something", () => {
    expect(parse("Kavara\n    Miselin").lines).toBe(2)
  })

  it("reads the same graph the flat file does", () => {
    const nested = [
      "Verb | Aspect",
      "    Tense",
      "        Past | Simple past | Past perfect",
      "        Present | Simple present",
      "    Voice | Active | Passive",
    ].join("\n")
    const flat = [
      "Verb | Aspect | Tense | Voice",
      "Tense | Past | Present",
      "Past | Simple past | Past perfect",
      "Present | Simple present",
      "Voice | Active | Passive",
    ].join("\n")
    expect(edges(nested)).toEqual(edges(flat))
    expect(edges(nested)).toHaveLength(10)
    expect(parse(nested).names).toHaveLength(11)
    expect(parse(nested).faults).toEqual([])
  })

  it("does not care what the indent step is", () => {
    expect(edges("A\n  B\n    C")).toEqual(edges("A\n        B\n                C"))
  })

  it("reads a tab-indented file", () => {
    expect(parse("Kavara\n\tMiselin").pairs).toEqual([["Kavara", "Miselin"]])
  })

  it("hangs a ragged line on the nearest line above it with a smaller indent", () => {
    const reading = parse("Kavara\n        Miselin | Sarn\n    Thorne")
    expect(reading.pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Miselin", "Sarn"],
      ["Kavara", "Thorne"],
    ])
    expect(reading.faults).toEqual([])
  })

  it("does not let a blank line close a block", () => {
    expect(parse("Kavara\n    Miselin\n\n    Sarn").pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Sarn"],
    ])
  })

  it("does not let a comment close a block, at any indent", () => {
    expect(parse("Kavara\n    Miselin\n# a note\n    Sarn").pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Sarn"],
    ])
  })

  it("reads an unindented file exactly as it did before", () => {
    const reading = parse("Kavara | Miselin | Vessarin\nThorne")
    expect(reading.pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Vessarin"],
    ])
    expect(reading.names).toEqual(["Kavara", "Miselin", "Vessarin", "Thorne"])
    expect(reading.faults).toEqual([])
  })

  it("reports a first line that is indented under nothing", () => {
    const reading = parse("    Kavara | Miselin")
    expect(reading.faults).toHaveLength(1)
    expect(reading.faults[0]).toContain("line 1")
    expect(reading.faults[0]).toContain("indented under nothing")
  })

  it("reports a child whose first name is the line it hangs from", () => {
    const reading = parse("Kavara | Miselin\n    kavara | Sarn")
    expect(reading.faults).toHaveLength(1)
    expect(reading.faults[0]).toContain("line 2")
    expect(reading.faults[0]).toContain("joined to itself")
    expect(reading.pairs).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Sarn"],
    ])
  })

  it("reports a file that indents with tabs on one line and spaces on another", () => {
    const reading = parse("Kavara\n    Miselin\n\tSarn")
    expect(reading.faults).toHaveLength(1)
    expect(reading.faults[0]).toContain("line 3")
    expect(reading.faults[0]).toContain("indents with tabs")
    expect(reading.faults[0]).toContain("line 2 indents with spaces")
  })

  it("reports the mixed indent once, however many lines carry it", () => {
    expect(parse("A\n    B\n\tC\n\tD\n\tE").faults).toHaveLength(1)
  })

  it("reports one line that indents with a tab and a space at once", () => {
    const reading = parse("Kavara\n \tMiselin")
    expect(reading.faults).toHaveLength(1)
    expect(reading.faults[0]).toContain("a tab and a space at once")
  })
})

describe("spelledPair", () => {
  it("gives one key for two spellings of one pair", () => {
    expect(key("Kavara", "miselin")).toBe(key("MISELIN", "kavara"))
  })
})

describe("format, as joins", () => {
  const nodes = [node("Kavara"), node("Miselin"), node("Vessarin"), node("Thorne")]
  const edges: [string, string][] = [
    ["kavara", "miselin"],
    ["kavara", "vessarin"],
  ]

  it("writes the hub's line, then the island with no edges", () => {
    expect(format(nodes, edges, "joins")).toBe(
      ["# 4 node(s), 2 edge(s), 2 island(s)", "", "Kavara | Miselin | Vessarin", "", "Thorne", ""].join(
        "\n",
      ),
    )
  })

  it("writes a file parse reads back as the same graph", () => {
    const reading = parse(format(nodes, edges, "joins"))
    expect(reading.faults).toEqual([])
    expect([...reading.names].sort()).toEqual(["Kavara", "Miselin", "Thorne", "Vessarin"])
    expect(reading.pairs.map(([a, b]) => key(a, b)).sort()).toEqual(
      edges.map(([a, b]) => key(a, b)).sort(),
    )
  })

  it("writes one file for one graph, whatever order the records arrive in", () => {
    const shuffled = [nodes[2]!, nodes[0]!, nodes[3]!, nodes[1]!]
    const flipped: [string, string][] = [
      ["vessarin", "kavara"],
      ["miselin", "kavara"],
    ]
    expect(format(shuffled, flipped, "joins")).toBe(format(nodes, edges, "joins"))
  })

  it("drops an edge that names a node it was not given", () => {
    const text = format([node("Kavara"), node("Miselin")], [...edges], "joins")
    expect(text).toContain("1 edge(s)")
    expect(text).not.toContain("Vessarin")
  })

  it("gives a node with no edges a line of its own", () => {
    expect(format([node("Thorne")], [], "joins")).toContain("\nThorne\n")
  })

  it("stamps nothing with a date, so re-exporting one graph is not a diff", () => {
    expect(format(nodes, edges, "joins")).toBe(format(nodes, edges, "joins"))
  })
})

describe("format, as names", () => {
  it("writes every label and no edges", () => {
    const nodes = [node("Vessarin"), node("Kavara"), node("Miselin")]
    expect(format(nodes, [["kavara", "miselin"]], "names")).toBe(
      ["# 3 name(s)", "", "Kavara", "Miselin", "Vessarin", ""].join("\n"),
    )
  })

  it("writes a word list parse reads back as nodes with no edges", () => {
    const reading = parse(format([node("Kavara"), node("Miselin")], [], "names"))
    expect(reading.names).toEqual(["Kavara", "Miselin"])
    expect(reading.pairs).toEqual([])
  })
})

describe("format, on a name no line can carry", () => {
  it("refuses a label holding the separator", () => {
    expect(() => format([node("Kav|ara")], [], "joins")).toThrow(Unwritable)
  })

  it("refuses a label holding the comment character", () => {
    expect(() => format([node("Kav#ara")], [], "names")).toThrow(Unwritable)
  })

  it("names every offending label, so one pass finds them all", () => {
    try {
      format([node("a|b"), node("Kavara"), node("c#d")], [], "joins")
      expect.unreachable("format should have refused these names")
    } catch (err) {
      expect(err).toBeInstanceOf(Unwritable)
      expect((err as Unwritable).names).toEqual(["a|b", "c#d"])
      expect((err as Unwritable).message).toContain("2 name(s)")
    }
  })
})

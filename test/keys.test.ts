/**
 * The normalised name and the pair key, from web/src/store/keys.ts.
 *
 * The name is the node's key, so what this file folds together decides which two spellings
 * are one node. A change here merges or splits nodes in every graph already stored.
 */
import { describe, expect, it } from "vitest"

import { NUL, edgeEnds, edgeKey, naming, normaliseLabel } from "../web/src/store/keys.js"

describe("normaliseLabel", () => {
  it("trims, lowercases and collapses runs of whitespace", () => {
    expect(normaliseLabel("  Kavara  ")).toBe("kavara")
    expect(normaliseLabel("KAVARA")).toBe("kavara")
    expect(normaliseLabel("Kavara\tthe\n  Second")).toBe("kavara the second")
  })

  it("folds nothing else, so two spellings stay two nodes", () => {
    // Folding diacritics would decide for the reader which names are the same.
    expect(normaliseLabel("Zoë")).not.toBe(normaliseLabel("Zoe"))
    expect(normaliseLabel("Miselin-Two")).not.toBe(normaliseLabel("Miselin Two"))
  })

  it("answers with an empty string for a name that is only whitespace", () => {
    expect(normaliseLabel("   ")).toBe("")
    expect(normaliseLabel("\t\n ")).toBe("")
  })
})

describe("naming", () => {
  it("builds the display name and the key together", () => {
    expect(naming("  Kavara   the  Second ")).toEqual({
      label: "Kavara the Second",
      labelKey: "kavara the second",
    })
  })

  it("keeps the case in the label and drops it from the key", () => {
    const named = naming("ASHANLIN")
    expect(named?.label).toBe("ASHANLIN")
    expect(named?.labelKey).toBe("ashanlin")
  })

  it("always returns a label whose own key is the key beside it", () => {
    // A record failing this is a node found under one name and shown under another.
    for (const raw of ["Kavara", " miselin ", "VESSARIN  ONE", "Zoë"]) {
      const named = naming(raw)
      expect(named).not.toBeNull()
      expect(normaliseLabel(named!.label)).toBe(named!.labelKey)
    }
  })

  it("refuses a name that normalises to nothing", () => {
    expect(naming("")).toBeNull()
    expect(naming("   ")).toBeNull()
  })
})

describe("edgeKey", () => {
  it("gives one key for a pair in either order", () => {
    expect(edgeKey("kavara", "miselin")).toBe(edgeKey("miselin", "kavara"))
  })

  it("joins with NUL, which no name can contain", () => {
    expect(NUL).toBe(String.fromCodePoint(0))
    expect(NUL).toHaveLength(1)
    expect(edgeKey("a", "b")).toBe(`a${NUL}b`)
  })

  it("keeps two different pairs apart where a tilde would not", () => {
    // The tilde was safe against `n-<uuid>` ids. Against names it is not.
    expect(edgeKey("a~b", "c")).not.toBe(edgeKey("a", "b~c"))
  })

  it("tells two pairs apart when one name is a prefix of another", () => {
    expect(edgeKey("ka", "vara")).not.toBe(edgeKey("kav", "ara"))
  })
})

describe("edgeEnds", () => {
  it("sorts the pair, so a composite key is the same from either end", () => {
    expect(edgeEnds("miselin", "kavara")).toEqual(["kavara", "miselin"])
    expect(edgeEnds("kavara", "miselin")).toEqual(["kavara", "miselin"])
  })

  it("agrees with edgeKey about which end comes first", () => {
    const [a, b] = edgeEnds("vessarin", "thorne")
    expect(edgeKey("vessarin", "thorne")).toBe(`${a}${NUL}${b}`)
  })
})

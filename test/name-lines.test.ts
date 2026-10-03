/**
 * Line breaking for a node's name, from web/src/name-lines.ts.
 *
 * Every test measures a string as ten pixels per character. A width of 50 then holds five
 * characters.
 */
import { describe, expect, it } from "vitest"

import { wrapName } from "../web/src/name-lines.js"

const measure = (text: string): number => text.length * 10

describe("wrapName", () => {
  it("keeps a name that fits on one line", () => {
    expect(wrapName("Seoul", measure, 50, 2)).toEqual({ lines: ["Seoul"], width: 50 })
  })

  it("breaks at spaces", () => {
    const out = wrapName("one two three", measure, 70, 5)
    expect(out.lines).toEqual(["one two", "three"])
    expect(out.width).toBe(70)
  })

  it("breaks a word wider than the line between characters", () => {
    expect(wrapName("abcdefghij", measure, 40, 5).lines).toEqual(["abcd", "efgh", "ij"])
  })

  it("wraps text with no spaces", () => {
    expect(wrapName("서울특별시청", measure, 30, 5).lines).toEqual(["서울특", "별시청"])
  })

  it("ends the last line with an ellipsis when lines run out", () => {
    const out = wrapName("one two three four", measure, 70, 2)
    expect(out.lines).toEqual(["one two", "three…"])
    expect(out.lines.every((line) => measure(line) <= 70)).toBe(true)
  })

  it("trims the last line until the ellipsis fits", () => {
    const out = wrapName("one two threeeee four", measure, 70, 2)
    expect(out.lines).toEqual(["one two", "threee…"])
  })

  it("adds no ellipsis when every line fits", () => {
    expect(wrapName("one two", measure, 70, 1).lines).toEqual(["one two"])
  })

  it("keeps every line for Infinity", () => {
    const out = wrapName("a b c d e f g h", measure, 10, Infinity)
    expect(out.lines).toHaveLength(8)
  })

  it("returns one empty line for an empty name", () => {
    expect(wrapName("", measure, 50, 2)).toEqual({ lines: [""], width: 0 })
  })

  it("treats runs of spaces as one", () => {
    expect(wrapName("a   b", measure, 100, 2).lines).toEqual(["a b"])
  })
})

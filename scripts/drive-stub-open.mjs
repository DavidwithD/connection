#!/usr/bin/env node
/**
 * Drive the hover that opens a long edge, and check what the map drew.
 *
 *   npm run web                             # in another terminal
 *   node scripts/drive-stub-open.mjs        # --head to watch it
 *
 * A companion to drive-part-edge.mjs, and the same deal: real Chrome, nothing downloaded, shots
 * in .shots/. It seeds a graph into Playwright's own throwaway profile first. Nothing here can
 * reach the graph in the browser on the desktop.
 *
 * An edge longer than `LONG_EDGE` is drawn as two stubs. Resting the pointer on one opens the
 * full line. Four things have to hold, and a screenshot can only show the first.
 *
 * 1. The line opens, and both stubs stop drawing.
 * 2. The line stays open when the pointer leaves the stub for the line itself. A stub is 7
 *    world pixels wide, so a reader cannot right-click one. The line is what they can reach.
 * 3. Right-click on an open line offers to part the pair. A stub's lead never did.
 * 4. The line shuts when the pointer goes somewhere else.
 *
 * Real pointer moves, not dispatched events. The element under the pointer comes from
 * Cytoscape's own hit test, and only a real move runs that test.
 */
import { mkdirSync } from "node:fs"

const { chromium } = await import("playwright").catch(() => {
  console.error("✗ needs playwright: npm i -D playwright --no-save")
  process.exit(2)
})

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const SHOTS = ".shots"
const headed = process.argv.includes("--head")

let failures = 0
const ok = (pass, what, detail = "") => {
  console.log(`  ${pass ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

/** Wait for the camera to stop. A `viewport` event closes the menu, on purpose. */
const stillCamera = async (page, quiet = 700) => {
  await page.evaluate(() => {
    const cy = document.querySelector("#stage")._cyreg.cy
    window.__moved = performance.now()
    if (!window.__watching) {
      cy.on("viewport", () => {
        window.__moved = performance.now()
      })
      window.__watching = true
    }
  })
  await page.waitForFunction((q) => performance.now() - window.__moved > q, quiet, {
    timeout: 20000,
  })
}

/** What the map is drawing for long edges right now, read off cytoscape's registration. */
const lines = (page) =>
  page.evaluate(() => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    if (!cy) return null
    const long = cy.edges("[?long]")
    const open = long.filter((e) => !e.hasClass("hidden"))
    return {
      long: long.length,
      open: open.length,
      openId: open.length ? open.first().id() : null,
      // Every stub of an open line has to be out of the picture, and every other stub drawn.
      eclipsed: cy.elements(".eclipsed").length,
      stubsDrawn: cy
        .nodes("[?stub]")
        .filter((n) => !n.hasClass("eclipsed") && !n.hasClass("hidden")).length,
      // The `[!stub]` guard. A stub carries tier 2 and takes the pointer, so without the guard
      // the hover rule would size a pill from its empty label.
      stubPills: cy.nodes("[?stub]").filter((n) => n.width() > 20).length,
      menuOpen: !document.querySelector("#map-menu")?.hidden,
      menuRow: document.querySelector("#map-remove")?.textContent ?? "",
    }
  })

/**
 * Click the farthest ring node not visited yet, and wait for its neighbourhood.
 *
 * A seeded graph draws no long edge at the opening view. Every node the centre has read is
 * seated near it, and `seat` keeps a neighbour inside `LONG_EDGE`. A long edge turns up once
 * the reader has walked: a new centre has a neighbour that an earlier visit already seated
 * somewhere else. Walking outward reaches that in about seven steps. Bouncing between two
 * centres never does, which is why the visited list is passed in.
 */
const walk = async (page, seen) => {
  const at = await page.evaluate((seen) => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    const centre = cy.nodes("[tier = 0]").first()
    if (centre.empty()) return null
    const box = document.querySelector("#stage").getBoundingClientRect()
    const pan = cy.pan()
    const zoom = cy.zoom()
    const home = centre.position()
    const far = (n) => Math.hypot(n.position().x - home.x, n.position().y - home.y)
    const ring = cy
      .nodes("[tier = 1]")
      .toArray()
      .filter((n) => !seen.includes(n.id()))
      .sort((p, q) => far(q) - far(p))
    for (const node of ring) {
      const p = node.position()
      const point = { x: box.left + p.x * zoom + pan.x, y: box.top + p.y * zoom + pan.y }
      const inside =
        point.x > box.left + 20 &&
        point.y > box.top + 20 &&
        point.x < box.right - 20 &&
        point.y < box.bottom - 20
      if (!inside) continue
      if (document.elementFromPoint(point.x, point.y)?.tagName !== "CANVAS") continue
      return { ...point, id: node.id() }
    }
    return null
  }, seen)
  if (!at) return null
  seen.push(at.id)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(900)
  return at.id
}

/**
 * A point on screen for one element of a long edge, and what is on top there.
 *
 * `where` is "stub", for the dot at the centre's end, or "line", for a point along the open
 * line clear of both stubs. Returns null when no long edge has that point on screen.
 */
const aimAt = (page, where) =>
  page.evaluate((where) => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    const centre = cy.nodes("[tier = 0]").first()
    if (centre.empty()) return null
    const box = document.querySelector("#stage").getBoundingClientRect()
    const pan = cy.pan()
    const zoom = cy.zoom()
    const renderer = cy.renderer()
    const onScreen = (p) => {
      const at = { x: box.left + p.x * zoom + pan.x, y: box.top + p.y * zoom + pan.y }
      const inside = at.x > box.left && at.y > box.top && at.x < box.right && at.y < box.bottom
      return inside ? at : null
    }

    for (const edge of cy.edges("[?long]").toArray()) {
      const ends = [edge.source(), edge.target()]
      if (!ends.some((n) => n.id() === centre.id())) continue
      const owner = ends.find((n) => n.id() === centre.id())
      const stub = cy
        .nodes("[?stub]")
        .filter((n) => n.data("key") === edge.id() && !n.hasClass("hidden"))
        .filter((n) => n.edgesWith(owner).nonempty())
        .first()
      if (stub.empty()) continue

      // Walk out from the stub toward the far end. The stub itself first, then points along the
      // line past where the other stub sits. Take the first one where this element is on top and
      // the page's own furniture is not over the canvas.
      const from = owner.position()
      const to = ends.find((n) => n.id() !== owner.id()).position()
      const steps = where === "stub" ? [0] : [0.5, 0.4, 0.6, 0.3, 0.7]
      for (const step of steps) {
        const world =
          where === "stub"
            ? stub.position()
            : { x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step }
        const at = onScreen(world)
        if (!at) continue
        if (document.elementFromPoint(at.x, at.y)?.tagName !== "CANVAS") continue
        const found = renderer.findNearestElement(world.x, world.y, true, false)
        return {
          x: at.x,
          y: at.y,
          edge: edge.id(),
          stub: stub.id(),
          nearest: found ? found.id() : "nothing",
          onTop: found ? found.id() === (where === "stub" ? stub.id() : edge.id()) : false,
        }
      }
    }
    return null
  }, where)

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } })

  const problems = []
  page.on("pageerror", (err) => problems.push(String(err)))
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      problems.push(m.text())
    }
  })

  console.log(`→ ${WEB}/transfer.html — seeding`)
  await page.goto(`${WEB}/transfer.html`, { waitUntil: "domcontentloaded" })
  await page.locator("#seed").click()
  const confirm = page.locator("#ask-yes")
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForFunction(
    () => /seed|added|nodes/i.test(document.querySelector("#told")?.textContent ?? ""),
    { timeout: 30000 },
  )
  console.log(`  ${await page.locator("#told").textContent()}`)

  console.log(`→ ${WEB} — the map`)
  await page.goto(WEB, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 30000 },
  )
  await stillCamera(page)

  // Walk until the centre has a long edge with a stub on screen. See `walk`.
  const seen = []
  let aim = await aimAt(page, "stub")
  for (let step = 0; step < 20 && !aim; step++) {
    if (!(await walk(page, seen))) break
    aim = await aimAt(page, "stub")
  }
  console.log(`  walked ${String(seen.length)} step(s) to find one`)
  await stillCamera(page)

  const rest = await lines(page)
  console.log(`\nat rest: ${JSON.stringify(rest)}`)
  ok(rest.long > 0, "the map drew at least one long edge", `${String(rest.long)} of them`)
  ok(rest.open === 0, "every line is shut at rest")
  ok(rest.eclipsed === 0, "no stub is eclipsed at rest")
  ok(rest.stubsDrawn > 0, "the stubs are drawn", `${String(rest.stubsDrawn)} of them`)

  if (!aim) {
    ok(false, "found a stub on screen to point at", "zoomed out six times and found none")
    await page.screenshot({ path: `${SHOTS}/stub-open-no-target.png` })
    await browser.close()
    return failures
  }

  console.log(`\n→ the pointer rests on a stub at ${String(Math.round(aim.x))},${String(Math.round(aim.y))}`)
  ok(aim.onTop, "the stub is the topmost element there", `nearest is ${aim.nearest}`)
  await page.mouse.move(aim.x, aim.y)
  await page.waitForTimeout(120)

  const opened = await lines(page)
  console.log(`opened: ${JSON.stringify(opened)}`)
  ok(opened.open === 1, "one line opened", `${String(opened.open)} open`)
  ok(opened.openId === aim.edge, "the line that opened is the stub's own edge")
  ok(opened.eclipsed === 4, "both stubs and both leads stopped drawing", `${String(opened.eclipsed)} eclipsed`)
  ok(opened.stubPills === 0, "no stub drew a pill")
  await page.screenshot({ path: `${SHOTS}/stub-open.png` })

  // The reason the line has to be a trigger of its own. A stub is 7 world pixels, so nothing
  // can be right-clicked on one. The pointer has to be able to walk out onto the line.
  const along = await aimAt(page, "line")
  if (!along) {
    ok(false, "found a point on the open line clear of the furniture")
  } else {
    console.log(`\n→ the pointer moves out onto the line at ${String(Math.round(along.x))},${String(Math.round(along.y))}`)
    await page.mouse.move(along.x, along.y, { steps: 12 })
    await page.waitForTimeout(120)
    const held = await lines(page)
    console.log(`held: ${JSON.stringify(held)}`)
    ok(held.open === 1, "the line is still open on the way out to it")
    ok(held.openId === aim.edge, "and it is the same line")

    await stillCamera(page, 400)
    await page.mouse.click(along.x, along.y, { button: "right" })
    await page.waitForTimeout(200)
    const menu = await lines(page)
    ok(menu.menuOpen, "right-click on the open line opened the menu")
    ok(/^part /.test(menu.menuRow), "and the menu offers to part the pair", menu.menuRow)
    await page.screenshot({ path: `${SHOTS}/stub-open-menu.png` })
    await page.keyboard.press("Escape")
    await page.mouse.click(4, 4)
    await page.waitForTimeout(120)
  }

  console.log(`\n→ the pointer goes elsewhere`)
  await page.mouse.move(8, 810, { steps: 8 })
  await page.waitForTimeout(200)
  const shut = await lines(page)
  console.log(`shut: ${JSON.stringify(shut)}`)
  ok(shut.open === 0, "the line shut", `${String(shut.open)} still open`)
  ok(shut.eclipsed === 0, "and both stubs are drawn again", `${String(shut.eclipsed)} still eclipsed`)

  ok(problems.length === 0, "no page errors", problems.slice(0, 2).join(" | "))
  await browser.close()
  return failures
}

const bad = await main()
console.log(bad ? `\n✗ ${String(bad)} failed` : "\n✓ all good")
process.exit(bad ? 1 : 0)

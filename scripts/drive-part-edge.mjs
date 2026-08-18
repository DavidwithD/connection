#!/usr/bin/env node
/**
 * Drive the right-click that parts a pair, and check what the page did about it.
 *
 *   npm run web                             # in another terminal
 *   node scripts/drive-part-edge.mjs        # --head to watch it
 *
 * A companion to drive-map.mjs, and the same deal: real Chrome, nothing downloaded, shots in
 * .shots/. Where that one photographs the map, this one asserts — the gesture writes to the
 * graph, and a screenshot cannot say whether the write landed.
 *
 * It seeds a graph first, into Playwright's own throwaway profile. Nothing here can reach the
 * graph in the browser on the desktop.
 *
 * Two things make it flaky if they are skipped, and both are the page being right rather than
 * the script being unlucky. The camera has to be still, because a `viewport` event closes the
 * menu on purpose. And the point aimed at has to be a point where the line is really on top:
 * a pill or a panel in front of it takes the click, exactly as it would from a reader.
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

/**
 * Wait for the camera to stop.
 *
 * A `viewport` event closes the menu — that is what it is for, so a menu never points at
 * whatever drifted under the pointer. Right-clicking before the camera is quiet is the script
 * racing the page, and it reads as the gesture failing.
 */
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

/** What the map is drawing right now, read off cytoscape's own registration. */
const drawn = (page) =>
  page.evaluate(() => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    if (!cy) return null
    const centre = cy.nodes("[tier = 0]").first()
    const id = centre.empty() ? null : centre.id()
    const view = cy.extent()
    const shows = (box) =>
      box.x2 >= view.x1 && box.x1 <= view.x2 && box.y2 >= view.y1 && box.y1 <= view.y2
    const ring = cy.nodes("[tier = 1]")
    return {
      centre: id,
      zoom: Number(cy.zoom().toFixed(2)),
      ring: ring.length,
      offScreen: ring.filter((n) => !shows(n.boundingBox())).length,
      centreLabel: centre.empty() ? null : centre.data("label"),
      edges: cy.edges().length,
      realEdges: cy.edges().filter((e) => !e.data("ghost") && !e.data("stub")).length,
      ghostLeads: cy.edges("[?ghost]").length,
      totals: document.querySelector("#stat-total")?.textContent ?? "",
      degree: document.querySelector("#stat-degree")?.textContent ?? "",
      status: document.querySelector("#status")?.textContent ?? "",
      undos: document.querySelectorAll("#receipts .undo").length,
      menuOpen: !document.querySelector("#map-menu")?.hidden,
      menuRow: document.querySelector("#map-remove")?.textContent ?? "",
    }
  })

/**
 * Right-click the midpoint of one drawn edge, chosen by a predicate over its data.
 * Returns the pair the edge joins, or null if there was no such edge.
 */
const rightClickEdge = async (page, kind, dry = false) =>
  page.evaluate(([kind, dry]) => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    const centre = cy.nodes("[tier = 0]").first()
    if (centre.empty()) return null
    const pick = cy.edges().filter((e) => {
      const [s, t] = [e.source(), e.target()]
      const atCentre = s.id() === centre.id() || t.id() === centre.id()
      if (kind === "ghost") return e.data("ghost") && atCentre
      if (kind === "away") return !e.data("ghost") && !e.data("stub") && !atCentre
      return !e.data("ghost") && !e.data("stub") && atCentre
    })
    if (pick.empty()) return null
    const pan = cy.pan()
    const zoom = cy.zoom()
    const box = document.querySelector("#stage").getBoundingClientRect()
    const renderer = cy.renderer()

    // Aim where the line is actually on top. A pill can cover an edge's midpoint, and
    // cytoscape hands a click to whatever is in front — which is what a reader sees too. Walk
    // along the line until the topmost thing there is this edge.
    let edge = null
    let at = null
    for (const candidate of pick.toArray()) {
      const [s, t] = [candidate.source().position(), candidate.target().position()]
      for (const step of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
        const x = s.x + (t.x - s.x) * step
        const y = s.y + (t.y - s.y) * step
        const found = renderer.findNearestElement(x, y, true, false)
        if (!found || found.id() !== candidate.id()) continue
        const point = { x: box.left + x * zoom + pan.x, y: box.top + y * zoom + pan.y }
        // And clear of the page's own furniture. The HUD and the panels sit over the canvas,
        // and a reader cannot click through them either.
        if (document.elementFromPoint(point.x, point.y)?.tagName !== "CANVAS") continue
        at = point
        edge = candidate
        break
      }
      if (edge) break
    }
    if (!edge) {
      // Nothing on this line is in front anywhere along it. Aim at the midpoint anyway and
      // let the report say what was under the pointer.
      edge = pick.first()
      const mid = edge.midpoint()
      at = { x: box.left + mid.x * zoom + pan.x, y: box.top + mid.y * zoom + pan.y }
    }

    const under = document.elementFromPoint(at.x, at.y)
    const clear = under?.tagName === "CANVAS"
    const fire = (type) =>
      under?.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2, buttons: 2,
        }),
      )
    if (!dry) {
      fire("mousedown")
      fire("mouseup")
      fire("contextmenu")
    }
    return {
      clear,
      source: edge.source().id(),
      target: edge.target().id(),
      ghost: !!edge.data("ghost"),
      at: `${String(Math.round(at.x))},${String(Math.round(at.y))}`,
      inWindow: at.x >= 0 && at.y >= 0 && at.x <= innerWidth && at.y <= innerHeight,
      under: under?.tagName ?? "nothing",
      nearest: renderer.findNearestElement(
        (at.x - box.left - pan.x) / zoom,
        (at.y - box.top - pan.y) / zoom,
        true,
        false,
      )?.id() ?? "nothing",
    }
  }, [kind, dry])

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

  // A fresh profile has no graph. Seed one from the transfer page, which is what the README
  // tells a reader to do. This profile is Playwright's own, not the browser on the desktop.
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
    { timeout: 20000 },
  )
  await page.waitForTimeout(600)

  // ---- a line into the centre -------------------------------------------------------
  console.log("\n1. right-click a line into the centre")
  await stillCamera(page)
  const before = await drawn(page)
  const hit = await rightClickEdge(page, "line")
  await page.waitForTimeout(200)
  const opened = await drawn(page)
  ok(!!hit, "found a line at the centre", hit ? `${hit.source} — ${hit.target}` : "none drawn")
  ok(opened.menuOpen, "the menu opened", opened.menuRow)
  ok(/^part .+ and .+/.test(opened.menuRow), "the row offers a part", opened.menuRow)
  ok(
    opened.menuRow.includes(before.centreLabel),
    "the centre is named first",
    `centre is ${before.centreLabel}`,
  )
  await page.screenshot({ path: `${SHOTS}/part-1-menu.png` })

  await page.locator("#map-remove").click()
  await page.waitForTimeout(700)
  const parted = await drawn(page)
  ok(parted.realEdges === before.realEdges - 1, "one line went", `${before.realEdges} → ${parted.realEdges}`)
  ok(/parted /.test(parted.status), "the status says so", parted.status)
  ok(parted.undos === 1, "the receipt carries an undo", `${parted.undos} undo button(s)`)
  ok(
    Number(parted.totals.match(/(\d+) edges/)?.[1]) ===
      Number(before.totals.match(/(\d+) edges/)?.[1]) - 1,
    "the store total dropped by one",
    `${before.totals} → ${parted.totals}`,
  )
  ok(
    Number(parted.degree.match(/\d+/)?.[0]) === Number(before.degree.match(/\d+/)?.[0]) - 1,
    "the centre's degree dropped by one",
    `${before.degree} → ${parted.degree}`,
  )
  await page.screenshot({ path: `${SHOTS}/part-2-parted.png` })

  // ---- undo -------------------------------------------------------------------------
  console.log("\n2. undo it")
  await page.locator("#receipts .undo").first().click()
  await page.waitForTimeout(700)
  const back = await drawn(page)
  ok(back.realEdges === before.realEdges, "the line came back", `${parted.realEdges} → ${back.realEdges}`)
  ok(back.totals === before.totals, "the totals came back", back.totals)
  ok(back.degree === before.degree, "the degree came back", back.degree)
  ok(back.undos === 0, "the undo button is spent", `${back.undos} left`)

  // ---- a ghost's dashed lead ---------------------------------------------------------
  console.log("\n3. right-click a ghost's dashed lead")
  // A ghost stands for a neighbour that is off screen. Zoom alone does not get there on this
  // centre — its ring still fits at maximum zoom — so shrink the window as well.
  for (let i = 0; i < 9; i++) {
    await page.locator("#zoom-in").click()
    await page.waitForTimeout(160)
  }
  let room = null
  for (const size of [
    { width: 560, height: 420 },
    { width: 640, height: 470 },
    { width: 700, height: 520 },
    { width: 760, height: 560 },
    { width: 900, height: 620 },
  ]) {
    await page.setViewportSize(size)
    await stillCamera(page)
    const seen = await drawn(page)
    if (!seen.ghostLeads) continue
    const probe = await rightClickEdge(page, "ghost", true)
    console.log(
      `  ${String(size.width)}×${String(size.height)}: ${String(seen.ghostLeads)} lead(s)` +
        `, clickable=${String(!!probe?.clear)}`,
    )
    if (probe?.clear) {
      room = size
      break
    }
  }
  ok(!!room, "a window where a ghost's lead can be clicked", room ? `${String(room.width)}×${String(room.height)}` : "none of five")
  const zoomed = await drawn(page)
  ok(
    zoomed.ghostLeads > 0,
    "ghosts are standing",
    `${zoomed.ghostLeads} lead(s) · zoom ${zoomed.zoom} · ring ${zoomed.ring} · ${zoomed.offScreen} off screen`,
  )
  if (!zoomed.ghostLeads) {
    console.log("  (no ghosts to aim at — skipping 3 and 4)")
    await browser.close()
    process.exit(failures ? 1 : 0)
  }
  await stillCamera(page)
  const ghostHit = await rightClickEdge(page, "ghost")
  await page.waitForTimeout(200)
  const ghostMenu = await drawn(page)
  ok(!!ghostHit, "found a ghost lead")
  ok(ghostMenu.menuOpen, "the menu opened on it", ghostMenu.menuRow)
  ok(/^part .+ and .+/.test(ghostMenu.menuRow), "the row offers a part", ghostMenu.menuRow)
  await page.screenshot({ path: `${SHOTS}/part-3-ghost-menu.png` })

  await page.locator("#map-remove").click()
  await page.waitForTimeout(900)
  const ghostGone = await drawn(page)
  ok(
    ghostGone.ghostLeads === zoomed.ghostLeads - 1,
    "the ghost and its lead went with the edge",
    `${zoomed.ghostLeads} → ${ghostGone.ghostLeads}`,
  )
  ok(/parted /.test(ghostGone.status), "the status says so", ghostGone.status)
  await page.screenshot({ path: `${SHOTS}/part-4-ghost-parted.png` })

  console.log("\n4. undo the ghost's edge")
  await page.locator("#receipts .undo").first().click()
  await page.waitForTimeout(900)
  const ghostBack = await drawn(page)
  ok(
    ghostBack.ghostLeads === zoomed.ghostLeads,
    "the ghost came back with the edge",
    `${ghostGone.ghostLeads} → ${ghostBack.ghostLeads}`,
  )

  // ---- a line away from the centre ---------------------------------------------------
  console.log("\n5. right-click a line that misses the centre")
  for (let i = 0; i < 9; i++) {
    await page.locator("#zoom-out").click()
    await page.waitForTimeout(200)
  }
  await stillCamera(page)
  const away = await rightClickEdge(page, "away")
  await page.waitForTimeout(200)
  const quiet = await drawn(page)
  ok(!!away, "found a line away from the centre")
  ok(!quiet.menuOpen, "nothing opened", quiet.menuRow)

  // ---- it is a real write -------------------------------------------------------------
  console.log("\n6. part one, then reload")
  // The camera has to be still first. A `viewport` event closes the menu, which is what it is
  // for, and the zoom above is still settling.
  await page.setViewportSize({ width: 1200, height: 820 })
  await stillCamera(page)
  // Put the centre back in the middle of the window. After the shrink and the zoom it can sit
  // under the HUD or the status line, and no part of its lines is then clickable.
  await page.locator("#home").click()
  await stillCamera(page)
  const last = await rightClickEdge(page, "line")
  await page.waitForTimeout(300)
  const lastMenu = await drawn(page)
  ok(!!last?.clear, "found a clickable line at the centre again", last ? `${last.source} — ${last.target}` : "none")
  ok(lastMenu.menuOpen, "the menu stayed open on a still camera", lastMenu.menuRow)
  if (!lastMenu.menuOpen) {
    await browser.close()
    process.exit(1)
  }
  await page.locator("#map-remove").click()
  await page.waitForTimeout(800)
  const written = await drawn(page)
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(500)
  const reloaded = await drawn(page)
  ok(reloaded.totals === written.totals, "the part survived a reload", `${written.totals} vs ${reloaded.totals}`)

  console.log(
    problems.length ? `\n⚠ ${String(problems.length)} console problem(s):\n  ${problems.join("\n  ")}` : "\n✓ no console errors",
  )
  await browser.close()
  console.log(failures ? `\n✗ ${String(failures)} check(s) failed` : "\n✓ every check passed")
  process.exit(failures || problems.length ? 1 : 0)
}

await main()

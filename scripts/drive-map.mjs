#!/usr/bin/env node
/**
 * Drive the map page in a real browser and photograph what it does.
 *
 *   npm run web                        # in another terminal
 *   node scripts/drive-map.mjs         # shots land in .shots/
 *   node scripts/drive-map.mjs --head  # watch it happen
 *
 * There is no test runner here and this is not one: it is the way to *see* the page, for
 * changes whose whole result is visual. A typecheck cannot tell you an island landed on top
 * of the graph it was supposed to be clear of.
 *
 * Uses the Chrome already on the machine (`channel: "chrome"`) rather than downloading a
 * browser, so this costs nothing to run the first time.
 *
 * Playwright is deliberately *not* a dependency of this project — it is a hundred megabytes
 * to make screenshots of a demo, which everything else here runs without. Install it where
 * you want it and point NODE_PATH at it, or `npm i -D playwright --no-save` for one session.
 */
import { mkdirSync } from "node:fs"

const { chromium } = await import("playwright").catch(() => {
  console.error("✗ needs playwright: npm i -D playwright --no-save")
  process.exit(2)
})

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const SHOTS = ".shots"
const headed = process.argv.includes("--head")

const shot = async (page, name) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
  console.log(`  📷 ${SHOTS}/${name}.png`)
}

/** What the HUD's chevron is saying, read off the thing itself rather than off the click. */
const fold = (page) =>
  page.evaluate(() => {
    const toggle = document.querySelector("#hud-toggle")
    const body = document.querySelector("#hud-body")
    // Decoded from the matrix rather than compared against "none": the turn is animated, so
    // a read taken on the click lands mid-rotation and every string comparison is a coin toss.
    const turn = getComputedStyle(document.querySelector(".chevron")).transform
    const [a, b] = turn === "none" ? [1, 0] : turn.slice(7, -1).split(",").map(Number)
    return (
      `open=${toggle?.getAttribute("aria-expanded")}` +
      ` body=${body && getComputedStyle(body).display}` +
      ` chevron=${Math.round((Math.atan2(b, a) * 180) / Math.PI)}°`
    )
  })

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  const problems = []
  page.on("console", (message) => {
    // "Failed to load resource" names nothing, and the listener below says the same thing
    // with the URL on it — which is the whole diagnosis. Kept out rather than counted twice.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      problems.push(message.text())
    }
  })
  page.on("pageerror", (err) => problems.push(String(err)))
  page.on("requestfailed", (req) => problems.push(`${req.method()} ${req.url()} failed`))
  page.on("response", (res) => {
    if (res.status() >= 400) problems.push(`${String(res.status())} ${res.url()}`)
  })

  console.log(`→ ${WEB}`)
  await page.goto(WEB, { waitUntil: "domcontentloaded" })

  // The map draws its first frame from two reads, so wait for the HUD to stop saying
  // "starting…" rather than for a fixed time.
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await shot(page, "1-landed")

  // A ghost stands for a neighbour of the centre while that neighbour is off screen, so the
  // camera is the only thing that can be asked whether it is right. Cytoscape registers itself
  // on its container, which is how the page can be asked what it drew without the app having
  // to expose anything for the asking.
  const drawn = (page) =>
    page.evaluate(() => {
      const cy = document.querySelector("#stage")?._cyreg?.cy
      if (!cy) return null
      const view = cy.extent()
      const shows = (box) =>
        box.x2 >= view.x1 && box.x1 <= view.x2 && box.y2 >= view.y1 && box.y1 <= view.y2
      const standing = cy.nodes("[?ghost]").map((ghost) => {
        const id = ghost.id()
        const target = cy.$id(id.slice(id.indexOf(":", 2) + 1))
        return {
          label: ghost.data("label"),
          at: `${String(Math.round(ghost.position("x")))},${String(Math.round(ghost.position("y")))}`,
          // A doorway nobody can see is no doorway. Its slot comes from `seat`, which walks
          // outward past whatever is seated and knows nothing about the viewport.
          shown: shows(ghost.boundingBox()),
          // The invariant, and the whole reason the rule reads the camera: never both.
          twin: target.nonempty() && shows(target.boundingBox()),
        }
      })
      // The ring is every neighbour of the centre, whatever its distance. How many of them
      // have left the screen is the population the doorways are drawn from — reported rather
      // than asserted on, because the threshold for raising one is a margin past the edge and
      // this script does not know it. A neighbour a few units out is correctly bare.
      const centre = cy.nodes("[tier = 0]").first()
      const ring = cy.nodes("[tier = 1]")
      const offScreen = ring.filter((node) => !shows(node.boundingBox()))

      // Slots are handed out so that no two boxes touch, so any overlap here is that
      // arithmetic being wrong rather than a judgement call about crowding.
      const boxes = cy.nodes("[?ghost]").map((ghost) => ghost.boundingBox())
      let collisions = 0
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) collisions++
        }
      }

      return {
        zoom: cy.zoom().toFixed(2),
        ring: ring.length,
        offScreen: offScreen.length,
        collisions,
        // Whether the centre is in the frame at all. A pan no longer hands the mark to whatever
        // it passes, so the doorways can be out of sight with the centre they belong to — which
        // is what makes the warning below a judgement about the picture rather than about one
        // element.
        centreShown: centre.nonempty() && shows(centre.boundingBox()),
        // How many rings the doorways spread over, which is the thing a single circle could not
        // do. Distance from the centre, bucketed to the nearest ten so that two slots on one
        // ring count once whatever rounding did to them.
        rings: new Set(
          cy.nodes("[?ghost]").map((ghost) => {
            if (centre.empty()) return 0
            const dx = ghost.position("x") - centre.position("x")
            const dy = ghost.position("y") - centre.position("y")
            return Math.round(Math.hypot(dx, dy) / 10)
          }),
        ).size,
        dashed: cy.edges("[?ghost]").length === 0 || cy.edges("[?ghost]").style("line-style") === "dashed",
        standing,
      }
    })

  const report = (what, seen) => {
    if (!seen) return console.log(`  ${what}: no map on the page`)
    const hidden = seen.standing.filter((g) => !g.shown).map((g) => g.label)
    const both = seen.standing.filter((g) => g.twin).map((g) => g.label)
    // A doorway out of frame is a fault only while the centre is in it. Panned away from, the
    // centre takes its rings along, and every doorway being out of sight is the picture working
    // as decided rather than a slot that missed the viewport.
    const stranded = seen.centreShown ? hidden : []
    console.log(
      `  ${what}: zoom ${seen.zoom} · ring ${String(seen.ring)}` +
        ` · ${String(seen.offScreen)} off screen` +
        ` · ${String(seen.standing.length)} standing in over ${String(seen.rings)} ring(s)` +
        (seen.centreShown ? "" : " · centre out of frame") +
        (seen.dashed ? "" : " · ⚠ ghost edge is not dashed") +
        (both.length ? ` · ⚠ drawn twice: ${both.join(", ")}` : "") +
        (stranded.length ? ` · ⚠ raised off screen: ${stranded.join(", ")}` : "") +
        (seen.collisions ? ` · ⚠ ${String(seen.collisions)} overlapping doorway pair(s)` : ""),
    )
    return seen
  }

  // Zoomed out, every neighbour is legible at its own seat and nothing should be standing in
  // for one. This is the picture the rule exists for: a stand-in beside the node it stands for
  // is the same name twice, and the map stops being a drawing of the graph.
  const zoom = async (button, times) => {
    for (let i = 0; i < times; i++) {
      await page.locator(`#${button}`).click()
      await page.waitForTimeout(300)
    }
    await page.waitForTimeout(300)
  }

  await zoom("zoom-out", 5)
  report("zoomed out", await drawn(page))
  await shot(page, "2-zoomed-out")

  // Zoomed in, most of a neighbourhood has left the screen and the doorways are what is left
  // of it. What stops a hub drawing a wheel of them is the rings themselves: each holds what
  // its circumference holds, and only rings the viewport can show are used at all.
  await zoom("zoom-in", 9)
  const close = report("zoomed in", await drawn(page))
  await shot(page, "3-zoomed-in")

  // A nudge and the nudge back have to land on the same picture. Any viewport rule flips a
  // node sitting on the edge unless the two thresholds are apart, and any re-derived slot
  // walks the ghosts already standing around the ring.
  if (close?.standing.length) {
    const before = close.standing.map((g) => `${g.label}@${g.at}`).sort()
    // Not clicked first, deliberately: the handler is on the window and only stands aside for a
    // text box, and a click on the stage could land on a node and glide the map somewhere else,
    // which would read as the ring having moved when nothing here moved it.
    for (const key of ["ArrowRight", "ArrowLeft"]) {
      await page.keyboard.press(key)
      await page.waitForTimeout(300)
    }
    const after = (await drawn(page))?.standing.map((g) => `${g.label}@${g.at}`).sort() ?? []
    const same = before.length === after.length && before.every((g, i) => g === after[i])
    console.log(
      `  nudge and back: ${String(before.length)} → ${String(after.length)}` +
        (same ? " · held" : ` · ⚠ the ring moved under it\n    was ${before.join(" ")}\n    now ${after.join(" ")}`),
    )
  }

  // Back to where the page opened, so what follows is read at the zoom it was written for.
  // Through `cy` rather than the buttons: this is putting the camera back, not a thing under
  // test, and 1.35 to a power does not land on 1.
  await page.evaluate(() => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    if (cy) cy.zoom(1)
  })
  await page.waitForTimeout(400)

  // The centre is named and a pan is looking. Both readouts, because handing the mark over was
  // never only a label change — every node the middle crossed had its ring read and seated for
  // good, and a seat is permanent.
  //
  // By key rather than by drag, for the reason the nudge check above gives: a press cannot land
  // on a node and glide the map somewhere on its own. A press is `NUDGE` in main.ts, so enough
  // of them to carry the viewport past its own width — and spaced under the settle they
  // provoke, so the run costs the one revision at the end of it rather than one per press.
  {
    const presses = Math.ceil(1440 / 120) + 2
    const hud = async () => ({
      centre: await page.locator("#stat-centre").textContent(),
      nodes: await page.locator("#stat-nodes").textContent(),
    })
    const before = await hud()
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(80)
    }
    await page.waitForTimeout(500)
    const after = await hud()
    const held = before.centre === after.centre && before.nodes === after.nodes
    console.log(
      `  panned a screen: centre ${before.centre} → ${after.centre}` +
        ` · ${before.nodes} nodes placed → ${after.nodes}` +
        (held ? " · held" : " · ⚠ the pan named a centre or seated a neighbourhood"),
    )
    report("panned away", await drawn(page))
    await shot(page, "4-panned")

    // Recentre, which is the way back to a centre the panning left behind — and it puts the
    // camera where the legs below expect it.
    await page.locator("#home").click()
    await page.waitForTimeout(600)
  }

  const islands = page.locator("#islands")
  const listed = await islands.isVisible()
  console.log(`  islands visible: ${listed}`)

  if (listed) {
    const names = await page.locator("#islands .island-name").allTextContents()
    const offMap = await page.locator("#islands .island.off-map .island-name").allTextContents()
    const here = await page.locator("#islands .island[aria-current] .island-name").textContent()
    console.log(`  islands: ${names.join(", ")}`)
    console.log(`  standing in: ${here ?? "—"} · off the map: ${offMap.length}/${names.length}`)

    // A list capped in pixels clips whatever row the cap lands in the middle of, which
    // reads as a broken panel rather than as something to scroll. Worth knowing on every
    // run, since the number of islands is a property of the data and not of the layout.
    const fit = await page.evaluate(() => {
      const list = document.querySelector("#islands ul")
      const row = document.querySelector("#islands li")
      return {
        row: row?.getBoundingClientRect().height ?? 0,
        shown: list?.clientHeight ?? 0,
        needed: list?.scrollHeight ?? 0,
      }
    })
    const spare = fit.shown % fit.row
    console.log(
      `  list: ${names.length} rows of ${fit.row.toFixed(1)}px, ` +
        `${fit.shown}px shown of ${fit.needed}px` +
        (fit.needed > fit.shown
          ? ` — scrolls, ${spare < 1 || fit.row - spare < 1 ? "cleanly" : `clipping a row at ${spare.toFixed(1)}px`}`
          : " — fits"),
    )

    // The list is a page of an unbounded thing, so the two questions are whether it says so
    // and whether scrolling gets the rest. Scrolled rather than clicked: coming into view is
    // what asks for the next page, and a click would prove the fallback instead.
    console.log(`  heading says: "${(await page.locator("#islands-count").textContent()) || "—"}"`)
    if (await page.locator(".island-more").count()) {
      const before = names.length
      for (let page_ = 0; page_ < 3; page_++) {
        await page.evaluate(() => {
          const list = document.querySelector("#islands ul")
          list.scrollTop = list.scrollHeight
        })
        await page.waitForTimeout(600)
      }
      const grown = await page.locator("#islands .island").count()
      console.log(
        `  scrolled for more: ${before} rows → ${grown}` +
          ` · heading now "${(await page.locator("#islands-count").textContent()) || "—"}"` +
          (grown > before ? "" : " — ⚠ nothing loaded"),
      )
      // Back to the top, so what follows is not reading rows three pages down.
      await page.evaluate(() => {
        document.querySelector("#islands ul").scrollTop = 0
      })
    }

    // The one that costs something: an island off the map is seated by the click, in water,
    // and stays seated. Anything already on the map is only the camera moving.
    const target = offMap[0]
    if (target) {
      const seated = async () => Number(await page.locator("#stat-nodes").textContent())
      const before = await seated()
      await page.locator("#islands .island.off-map").first().click()

      // The flight is a camera animation, so the centre changes a beat after the click.
      await page.waitForFunction(
        (want) => document.querySelector("#stat-centre")?.textContent === want,
        target,
        { timeout: 10000 },
      )
      console.log(`  crossed to ${target}: ${before} nodes placed → ${await seated()}`)
      await shot(page, "5-crossed")

      // The row is the point: it stays, it is the marked one now, and it is no longer dim.
      const row = page.locator("#islands .island", { hasText: target }).first()
      console.log(
        `  its row after crossing: listed=${await row.isVisible()}` +
          ` marked=${(await row.getAttribute("aria-current")) === "true"}` +
          ` dim=${(await row.getAttribute("class"))?.includes("off-map")}`,
      )

      // And back, which is the whole reason the row stayed. The node count still moves —
      // arriving anywhere draws the ring around it — so what is checked instead is that the
      // row was not dim going in, which is what says no island was set down to get there.
      //
      // The wait is on the centre *changing* rather than on a name: a row goes to the node it
      // is named after only where that node is on the map, and the island the page opened in
      // is held by whichever node the map started on.
      if (here) {
        const back = page.locator("#islands .island", { hasText: here }).first()
        const dim = (await back.getAttribute("class"))?.includes("off-map")
        const wasSeated = await seated()
        await back.click()
        await page.waitForFunction(
          (was) => document.querySelector("#stat-centre")?.textContent !== was,
          target,
          { timeout: 10000 },
        )
        console.log(
          `  back to ${here}: centre is ${await page.locator("#stat-centre").textContent()}, ` +
            `${wasSeated} nodes placed → ${await seated()}` +
            (dim ? " — ⚠ its row was dim, so that click seated an island" : " — already on the map"),
        )
      }
      await shot(page, "6-back")
    }

    // The reason the rows are built once and then only re-marked. Rebuilding empties the box,
    // and an emptied box scrolls back to the top — which on a list you navigate from means
    // finding your place again after every jump.
    // Halfway rather than to the foot: the foot is where the next page is asked for, and a
    // click that lands twenty rows is a click this cannot hold still against. What is being
    // checked is that using the list does not send it back to the top.
    if (names.length > 9) {
      // A row that is already on screen at that offset. Clicking one out of view would scroll
      // the list to it, correctly, and the check would be measuring the wrong thing.
      const target = await page.evaluate(() => {
        const list = document.querySelector("#islands ul")
        list.scrollTop = Math.floor(list.scrollHeight / 2)
        const rows = [...list.querySelectorAll(".island")]
        const box = list.getBoundingClientRect()
        const seen = rows.find((row) => {
          const at = row.getBoundingClientRect()
          return at.top >= box.top && at.bottom <= box.bottom
        })
        return { at: list.scrollTop, row: rows.indexOf(seen), name: seen?.textContent ?? "" }
      })
      await page.locator("#islands .island").nth(target.row).click()
      await page.waitForTimeout(400)
      const after = await page.evaluate(() => document.querySelector("#islands ul").scrollTop)
      console.log(
        `  scroll across a jump: row ${String(target.row)} (${target.name}) at ` +
          `${target.at}px → ${after}px` +
          (after === target.at ? " — held" : " — ⚠ the list moved under the click"),
      )
    }

    // Folded, the list lifts to the top corner and the chevron carries the status tone.
    await page.locator("#hud-toggle").click()
    // Past the chevron's 120ms turn, so what is read is where it settled and not where it
    // happened to be on the way.
    await page.waitForTimeout(200)
    console.log(`  folded: ${await fold(page)}`)
    await shot(page, "7-folded")
    await page.locator("#hud-toggle").click()
  }

  // The left column is one flow so that it can run out of room without overlapping itself.
  // Nothing but a real window says whether it does — the panels' heights come from the font,
  // the numbers and the data, and none of those is in the stylesheet.
  for (const [name, size] of [
    ["7-short", { width: 900, height: 500 }],
    ["8-narrow", { width: 420, height: 800 }],
  ]) {
    await page.setViewportSize(size)
    const rail = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll("#left-rail > .panel")]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ id: el.id, ...el.getBoundingClientRect().toJSON() }))
      const over = boxes.filter((a, i) =>
        boxes.slice(i + 1).some((b) => a.bottom > b.top && b.bottom > a.top),
      )
      const list = document.querySelector("#islands ul")
      return {
        shown: boxes.map((b) => b.id).join(" + ") || "nothing",
        overlapping: over.map((b) => b.id),
        spills: boxes.some((b) => b.bottom > window.innerHeight || b.top < 0),
        rows: list ? Math.round(list.clientHeight / 22) : 0,
      }
    })
    console.log(
      `  ${String(size.width)}×${String(size.height)}: ${rail.shown}` +
        ` · ${String(rail.rows)} island rows` +
        (rail.overlapping.length ? ` · ⚠ overlap: ${rail.overlapping.join(", ")}` : "") +
        (rail.spills ? " · ⚠ runs off the window" : ""),
    )
    await shot(page, name)
  }

  if (problems.length) {
    console.log(`\n✗ ${problems.length} console error(s):`)
    for (const problem of problems.slice(0, 10)) console.log(`  ${problem}`)
  } else {
    console.log("\n✓ no console errors")
  }

  await browser.close()
  process.exitCode = problems.length ? 1 : 0
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})

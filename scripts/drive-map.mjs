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

import { MAP, frame, read } from "./probe.mjs"

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

/** Where the island drawer is, read off the thing itself rather than off the click. */
const drawer = (page) =>
  page.evaluate(() => {
    const tab = document.querySelector("#rail-tab")
    const panel = document.querySelector("#islands")
    // Decoded from the matrix rather than compared against "none": the turn is animated, so
    // a read taken on the click lands mid-rotation and every string comparison is a coin toss.
    const turn = getComputedStyle(document.querySelector(".chevron")).transform
    const [a, b] = turn === "none" ? [1, 0] : turn.slice(7, -1).split(",").map(Number)
    return (
      `out=${tab?.getAttribute("aria-expanded")}` +
      ` panel=${panel && getComputedStyle(panel).visibility}` +
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

  console.log(`→ ${WEB}${MAP}`)

  // The graph lives in this profile's IndexedDB, and Playwright opens a fresh profile every
  // run — so there is nothing to drive until this writes one. Through the page's own buttons
  // rather than the store, because that is the only seam a browser has. Seeding overwrites, so
  // it asks in the page rather than in a native dialog: two clicks, not one.
  await page.goto(`${WEB}/transfer.html`, { waitUntil: "domcontentloaded" })
  await page.locator("#seed").click()
  await page.locator("#ask-yes").click()
  await page.waitForFunction(
    () => /Seeded/.test(document.querySelector("#told")?.textContent ?? ""),
    { timeout: 30000 },
  )
  console.log(`  seeded: ${(await page.locator("#told").textContent())?.trim() ?? ""}`)

  await page.goto(`${WEB}${MAP}`, { waitUntil: "domcontentloaded" })

  // The map draws its first frame from two reads, so wait for #status to stop saying
  // "starting…" rather than for a fixed time.
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await shot(page, "1-landed")

  // A ghost stands for a neighbour of the centre while that neighbour is off screen, so the
  // camera is the only thing that can be asked whether it is right. A canvas holds no element
  // per node, so the answer comes from the probe globe-view.ts registers on its container.
  const drawn = async (page) => {
    const seen = await frame(page)
    if (!seen) return null
    const it = read(seen)
    return {
      zoom: seen.zoom.toFixed(2),
      // The ring is every neighbour of the centre, whatever its distance. How many of them
      // have left the screen is the population the doorways are drawn from — reported rather
      // than asserted on, because the threshold for raising one is a margin past the horizon
      // and this script does not know it. A neighbour a few degrees out is correctly bare.
      ring: it.ring.length,
      offScreen: it.ring.filter((node) => node.past > 0).length,
      collisions: it.collisions,
      // Whether the centre is in the frame at all. A pan no longer hands the mark to whatever
      // it passes, so the doorways can be out of sight with the centre they belong to — which
      // is what makes the warning below a judgement about the picture rather than about one
      // element.
      centreShown: it.centreShown,
      // How many rings the doorways spread over, which is the thing a single circle could not
      // do. Distance from the centre, bucketed to the nearest ten so that two slots on one
      // ring count once whatever rounding did to them.
      rings: new Set(
        it.ghosts.map((ghost) =>
          it.centre
            ? Math.round(Math.hypot(ghost.x - it.centre.x, ghost.y - it.centre.y) / 10)
            : 0,
        ),
      ).size,
      // A doorway is a way out only while the line to it is drawn. `reviseGhosts` raises one
      // lead per ghost, and lowering a ghost takes its lead with it. A ghost without one is
      // that pairing having come apart.
      leads: it.ghosts.filter((ghost) =>
        seen.lines.some((line) => line.kind === "ghost" && line.b === ghost.id),
      ).length,
      standing: it.ghosts.map((ghost) => ({
        label: ghost.label,
        // The world position, because that is where the slot was cut and nothing on this map
        // moves. A camera that came back to where it was would hide a doorway that had not.
        at: `${String(Math.round(ghost.x))},${String(Math.round(ghost.y))}`,
        // A doorway nobody can see is no doorway. Its slot comes from `seat`, which walks
        // outward past whatever is seated and knows nothing about the viewport.
        shown: ghost.at !== null,
        // The invariant, and the whole reason the rule reads the camera: never both.
        twin: (it.targetOf(ghost.id)?.past ?? 1) <= 0,
      })),
    }
  }

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
        (seen.leads === seen.standing.length ? "" : " · ⚠ a doorway has no line to it") +
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

  // Zoomed in, more of the map is off screen and less of it is legible. Doorways do not come
  // up here on this centre. `GHOST_MARGIN` is a length in screen pixels, so on a curved
  // surface it is an angle. A ring this tight never crosses it, however far the map is
  // zoomed. What raises one is the camera leaving the centre, which the pan below does.
  await zoom("zoom-in", 9)
  report("zoomed in", await drawn(page))
  await shot(page, "3-zoomed-in")

  // Back to where the page opened, so what follows is read at the zoom it was written for. A
  // reload rather than the buttons, because 1.35 to a power does not land on 1. This is
  // putting the camera back rather than a thing under test. The graph is in IndexedDB and
  // survives a reload.
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(600)

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
    const away = report("panned away", await drawn(page))
    await shot(page, "4-panned")

    // A nudge and the nudge back have to land on the same picture. Any viewport rule flips a
    // node sitting on the edge unless the two thresholds are apart, and any re-derived slot
    // walks the ghosts already standing around the ring. Read here rather than at the zoom
    // above, because this is where the doorways are standing.
    if (away?.standing.length) {
      const was = away.standing.map((g) => `${g.label}@${g.at}`).sort()
      // Not clicked first, deliberately: the handler is on the window and only stands aside
      // for a text box, and a click on the stage could land on a node and glide the map
      // somewhere else, which would read as the ring having moved when nothing here moved it.
      for (const key of ["ArrowRight", "ArrowLeft"]) {
        await page.keyboard.press(key)
        await page.waitForTimeout(300)
      }
      const now = (await drawn(page))?.standing.map((g) => `${g.label}@${g.at}`).sort() ?? []
      // Every doorway standing before the nudge has to be in the same place after it. The set
      // may grow: the two thresholds are not opposites, so a neighbour that crossed the margin
      // on the way out keeps its doorway until it is back in view.
      const gone = was.filter((one) => !now.includes(one))
      console.log(
        `  nudge and back: ${String(was.length)} → ${String(now.length)} standing` +
          (gone.length ? ` · ⚠ moved under it: ${gone.join(" ")}` : " · none moved"),
      )
    }

    // Recentre, which is the way back to a centre the panning left behind — and it puts the
    // camera where the legs below expect it.
    await page.locator("#home").click()
    await page.waitForTimeout(600)
  }

  // The drawer ships shut, so open it before reading a row. The tab is not drawn at all when
  // the store holds no islands, which is the other reason this leg can be skipped.
  const tab = page.locator("#rail-tab")
  const listed = await tab.isVisible()
  console.log(`  islands tab: ${listed}`)

  if (listed) {
    await tab.click()
    await page.waitForTimeout(250)
    console.log(`  drawer: ${await drawer(page)}`)

    const names = await page.locator("#islands .island-name").allTextContents()
    const offMap = await page.locator("#islands .island.off-map .island-name").allTextContents()
    const here = await page.locator("#islands .island[aria-current] .island-name").textContent()
    console.log(`  islands: ${names.join(", ")}`)
    console.log(`  standing in: ${here ?? "—"} · off the map: ${offMap.length}/${names.length}`)

    // A short window, for the two checks that need more rows than the box holds. The drawer
    // grows with its rows, so the seeded ten islands fit any ordinary window. 260px is where
    // they stop fitting. Restored before the shots below.
    await page.setViewportSize({ width: 1440, height: 260 })
    await page.waitForTimeout(300)

    // The list has no scrollbar. So the two questions are whether it fills the drawer, and
    // whether the fade that replaced the bar is drawn while rows sit past the fold.
    const fit = await page.evaluate(() => {
      const list = document.querySelector("#islands-list")
      const row = document.querySelector("#islands li")
      return {
        row: row?.getBoundingClientRect().height ?? 0,
        shown: list?.clientHeight ?? 0,
        needed: list?.scrollHeight ?? 0,
        fade: document.querySelector("#islands")?.dataset.more === "true",
      }
    })
    console.log(
      `  short window: ${names.length} rows of ${fit.row.toFixed(1)}px, ` +
        `${fit.shown}px shown of ${fit.needed}px` +
        (fit.needed > fit.shown
          ? ` — scrolls, ${fit.fade ? "fade drawn" : "⚠ no fade, so nothing says rows are below"}`
          : " — ⚠ still fits, so the scroll checks are untested"),
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

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(300)

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
    if (fit.needed > fit.shown) {
      // Short again, for the same reason as above.
      await page.setViewportSize({ width: 1440, height: 260 })
      await page.waitForTimeout(300)

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

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(300)

    // Pushed back, the panel leaves the screen and stops taking focus.
    await tab.click()
    // Past the 160ms slide and the chevron's own turn, so what is read is where they settled
    // and not where they happened to be on the way.
    await page.waitForTimeout(300)
    console.log(`  shut: ${await drawer(page)}`)
    await shot(page, "7-shut")
    await tab.click()
    await page.waitForTimeout(250)
  }

  // The three reading aids sit behind one button now. What matters is that all three are in
  // there, and that the browser's own dismissal works, since nothing in the page listens for
  // Escape on this panel.
  {
    const guide = page.locator("#guide")
    const before = await guide.isVisible()
    await page.locator("#guide-toggle").click()
    await page.waitForTimeout(150)
    const inside = await page.evaluate(() => {
      const has = (selector) => Boolean(document.querySelector(`#guide ${selector}`))
      return {
        stats: has("#stat-centre"),
        walk: has("#walk-by-pan"),
        legend: has("#legend .row"),
        keys: has("#keys kbd"),
      }
    })
    const open = await guide.isVisible()
    await shot(page, "9-guide")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(150)
    const after = await guide.isVisible()
    console.log(
      `  guide: shut=${!before} open on click=${open} shut on Escape=${!after}` +
        ` · holds ${Object.entries(inside)
          .filter(([, held]) => held)
          .map(([part]) => part)
          .join(", ")}`,
    )
  }

  // Boxes pinned to a corner, in two corners now rather than one column. Nothing but a real
  // window says whether they clear each other: #ends and #controls are sized by whatever the
  // font stack does with their text, and that is not in the stylesheet.
  //
  // #status is in the list and usually absent from it. The pill is drawn only while the tone
  // is busy or error, so this leg sees it only when a read is still in flight.
  for (const [name, size] of [
    ["7-short", { width: 900, height: 500 }],
    ["8-narrow", { width: 420, height: 800 }],
  ]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(200)
    const chrome = await page.evaluate(() => {
      const boxes = ["ends", "controls", "guide-toggle", "status", "rail-tab", "islands"]
        .map((id) => document.getElementById(id))
        // Not `offsetParent`: it is null on a fixed box, and every box here is fixed.
        .filter((el) => el?.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
        .map((el) => ({ id: el.id, ...el.getBoundingClientRect().toJSON() }))
      const hits = (a, b) =>
        a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top
      const over = []
      boxes.forEach((a, i) => {
        for (const b of boxes.slice(i + 1)) if (hits(a, b)) over.push(`${a.id}×${b.id}`)
      })
      const list = document.querySelector("#islands-list")
      // Measured off a row rather than divided by a constant. --island-row used to state the
      // height; the drawer's own cap replaced it, so the only source left is a drawn row.
      const row = document.querySelector("#islands li")?.getBoundingClientRect().height
      return {
        shown: boxes.map((b) => b.id).join(" + ") || "nothing",
        overlapping: over,
        spills: boxes
          .filter((b) => b.bottom > window.innerHeight + 1 || b.top < -1)
          .map((b) => b.id),
        rows: list && row ? Math.round(list.clientHeight / row) : 0,
      }
    })
    console.log(
      `  ${String(size.width)}×${String(size.height)}: ${chrome.shown}` +
        ` · ${String(chrome.rows)} island rows` +
        (chrome.overlapping.length ? ` · ⚠ overlap: ${chrome.overlapping.join(", ")}` : "") +
        (chrome.spills.length ? ` · ⚠ off the window: ${chrome.spills.join(", ")}` : ""),
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

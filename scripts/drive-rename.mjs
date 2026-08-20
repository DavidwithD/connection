#!/usr/bin/env node
/**
 * Drive the rename, and check what the page and the store did about it.
 *
 *   npm run web                          # in another terminal
 *   node scripts/drive-rename.mjs        # --head to watch it
 *
 * A companion to drive-part-edge.mjs, and the same deal: real Chrome, nothing downloaded,
 * shots in .shots/. A rename writes to the graph, and a screenshot cannot say whether the
 * write landed, so this asserts.
 *
 * It seeds a graph first, into Playwright's own throwaway profile. Nothing here can reach the
 * graph in the browser on the desktop.
 *
 * The camera has to be still before the right-click, because a `viewport` event closes the
 * menu on purpose. That is the same trap drive-part-edge.mjs documents.
 *
 * What is worth asserting is not the new name on screen. It is the edges surviving under it,
 * the neighbours' degrees not moving, and the name still being there after a reload.
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

/** Wait for the camera to stop. A `viewport` event closes the menu, so this is not optional. */
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
    const ring = cy.nodes("[tier = 1]")
    return {
      centre: centre.empty() ? null : centre.id(),
      centreLabel: centre.empty() ? null : centre.data("label"),
      ring: ring.length,
      // Every neighbour's degree, by name, so a rename that re-added edges is visible.
      ringDegrees: Object.fromEntries(ring.map((n) => [n.id(), n.data("degree")])),
      realEdges: cy.edges().filter((e) => !e.data("ghost") && !e.data("stub")).length,
      totals: document.querySelector("#stat-total")?.textContent ?? "",
      degree: document.querySelector("#stat-degree")?.textContent ?? "",
      status: document.querySelector("#status")?.textContent ?? "",
      undos: document.querySelectorAll("#receipts .undo").length,
      menuOpen: !document.querySelector("#map-menu")?.hidden,
      editRow: document.querySelector("#map-rename")?.textContent ?? "",
      boxOpen: !document.querySelector("#map-edit")?.hidden,
      verdict: document.querySelector("#map-update")?.textContent ?? "",
      verdictState: document.querySelector("#map-update")?.dataset.state ?? "",
      armed: document.querySelector("#map-update")?.disabled === false,
    }
  })

/** Right-click the centre pill, where it is actually on top. */
const rightClickCentre = (page) =>
  page.evaluate(() => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    const centre = cy.nodes("[tier = 0]").first()
    if (centre.empty()) return null
    const pan = cy.pan()
    const zoom = cy.zoom()
    const box = document.querySelector("#stage").getBoundingClientRect()
    const at = {
      x: box.left + centre.position().x * zoom + pan.x,
      y: box.top + centre.position().y * zoom + pan.y,
    }
    const under = document.elementFromPoint(at.x, at.y)
    const fire = (type) =>
      under?.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2, buttons: 2,
        }),
      )
    fire("mousedown")
    fire("mouseup")
    fire("contextmenu")
    return { id: centre.id(), label: centre.data("label"), under: under?.tagName ?? "nothing" }
  })

/** Type a name into the box and wait for the row to settle on a verdict. */
const type = async (page, text) => {
  await page.locator("#map-name").fill(text)
  await page.waitForTimeout(250)
  return drawn(page)
}

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
    { timeout: 20000 },
  )
  await page.waitForTimeout(600)

  // ---- the menu offers an edit ------------------------------------------------------
  console.log("\n1. right-click the centre")
  await stillCamera(page)
  const before = await drawn(page)
  const hit = await rightClickCentre(page)
  await page.waitForTimeout(200)
  const opened = await drawn(page)
  ok(!!hit, "found the centre", hit ? `${hit.label} (${hit.under})` : "none drawn")
  ok(opened.menuOpen, "the menu opened", opened.editRow)
  ok(opened.editRow === `edit ${before.centreLabel}`, "the edit row names it", opened.editRow)
  ok(!opened.boxOpen, "the box is not open yet", `boxOpen=${String(opened.boxOpen)}`)
  await page.screenshot({ path: `${SHOTS}/rename-1-menu.png` })

  // ---- the row opens the box --------------------------------------------------------
  console.log("\n2. click edit")
  await page.locator("#map-rename").click()
  await page.waitForTimeout(200)
  const box = await drawn(page)
  ok(box.boxOpen, "the box opened")
  ok(
    (await page.locator("#map-name").inputValue()) === before.centreLabel,
    "seeded with the current name",
    await page.locator("#map-name").inputValue(),
  )
  ok(!box.armed, "nothing is offered before typing", `verdict=${box.verdictState || "none"}`)

  // ---- the verdict ------------------------------------------------------------------
  console.log("\n3. the verdict on three kinds of name")
  const taken = await type(page, Object.keys(before.ringDegrees)[0] ?? "vere")
  ok(taken.verdict === "is taken", "a neighbour's name is refused", taken.verdict)
  ok(!taken.armed, "and fires nothing", `armed=${String(taken.armed)}`)

  const self = await type(page, before.centreLabel.toUpperCase())
  ok(self.armed, "its own name in another case is allowed", `verdict=${self.verdict}`)

  const free = await type(page, "Qethran Hollow")
  ok(free.verdict === "↻ update", "a free name offers the write", free.verdict)
  ok(free.armed, "and is armed", `state=${free.verdictState}`)
  await page.screenshot({ path: `${SHOTS}/rename-2-verdict.png` })

  // ---- the write --------------------------------------------------------------------
  console.log("\n4. press Enter")
  await page.locator("#map-name").press("Enter")
  await page.waitForTimeout(900)
  const after = await drawn(page)
  ok(after.centreLabel === "Qethran Hollow", "the centre wears the new name", after.centreLabel)
  ok(after.centre === "qethran hollow", "and is keyed by it", String(after.centre))
  ok(!after.menuOpen, "the menu closed")
  ok(after.realEdges === before.realEdges, "every edge survived", `${before.realEdges} → ${after.realEdges}`)
  ok(after.degree === before.degree, "its own degree is unchanged", `${before.degree} → ${after.degree}`)
  ok(after.totals === before.totals, "the totals did not move", `${before.totals} → ${after.totals}`)
  ok(/renamed /.test(after.status), "the status says so", after.status)
  ok(after.undos === 1, "the receipt carries an undo", `${after.undos} undo button(s)`)

  const moved = Object.entries(before.ringDegrees).filter(
    ([id, d]) => after.ringDegrees[id] !== undefined && after.ringDegrees[id] !== d,
  )
  ok(moved.length === 0, "no neighbour's degree moved", moved.map(([id]) => id).join(", ") || "none")
  await page.screenshot({ path: `${SHOTS}/rename-3-done.png` })

  // ---- the way back -----------------------------------------------------------------
  console.log("\n5. undo")
  await page.locator("#receipts .undo").first().click()
  await page.waitForTimeout(900)
  const undone = await drawn(page)
  ok(undone.centreLabel === before.centreLabel, "the old name is back", undone.centreLabel)
  ok(undone.centre === before.centre, "under its old key", String(undone.centre))
  ok(undone.realEdges === before.realEdges, "with every edge", `${before.realEdges} → ${undone.realEdges}`)
  ok(undone.degree === before.degree, "and its degree", `${before.degree} → ${undone.degree}`)
  ok(/undid renaming/.test(undone.status), "the status says so", undone.status)

  // ---- a pan closes an edit in progress -----------------------------------------------
  console.log("\n6. pan while the box is open")
  await stillCamera(page)
  await rightClickCentre(page)
  await page.waitForTimeout(200)
  await page.locator("#map-rename").click()
  await page.locator("#map-name").fill("Never Written")
  await page.waitForTimeout(200)
  ok((await drawn(page)).boxOpen, "the box is open")
  await page.evaluate(() => {
    document.querySelector("#stage")._cyreg.cy.panBy({ x: 40, y: 0 })
  })
  await page.waitForTimeout(400)
  const panned = await drawn(page)
  ok(!panned.menuOpen, "the pan closed the menu")
  ok(panned.centreLabel === before.centreLabel, "and wrote nothing", panned.centreLabel)

  // ---- rename again, so the reload below has something to find ------------------------
  console.log("\n7. rename once more")
  await stillCamera(page)
  await rightClickCentre(page)
  await page.waitForTimeout(200)
  await page.locator("#map-rename").click()
  await type(page, "Qethran Hollow")
  await page.locator("#map-name").press("Enter")
  await page.waitForTimeout(900)
  ok((await drawn(page)).centre === "qethran hollow", "renamed again")

  // ---- it is really in the store ----------------------------------------------------
  console.log("\n8. reload")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(600)
  const stored = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open("connection")
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const read = (store, key) =>
      new Promise((res) => {
        const req = db.transaction(store).objectStore(store).get(key)
        req.onsuccess = () => res(req.result ?? null)
        req.onerror = () => res(null)
      })
    const edgesOf = (id) =>
      new Promise((res) => {
        const req = db.transaction("edges").objectStore("edges").index("byEnd").getAll(id)
        req.onsuccess = () => res(req.result.length)
        req.onerror = () => res(-1)
      })
    const node = await read("nodes", "qethran hollow")
    return {
      node,
      gone: (await read("nodes", "ashanlin")) === null,
      edges: await edgesOf("qethran hollow"),
      stale: await edgesOf("ashanlin"),
    }
  })
  ok(!!stored.node, "the store holds the new name", stored.node ? stored.node.label : "nothing")
  ok(stored.gone, "and not the old one")
  ok(stored.edges === stored.node?.degree, "its edges match its degree",
     `${String(stored.edges)} edges, degree ${String(stored.node?.degree)}`)
  ok(stored.stale === 0, "no edge is left under the old name", `${String(stored.stale)} found`)

  console.log(`\n${problems.length ? "✗" : "✓"} page errors: ${String(problems.length)}`)
  problems.slice(0, 5).forEach((p) => console.log(`    ${p}`))
  if (problems.length) failures++

  await browser.close()
  console.log(failures ? `\n✗ ${String(failures)} failed` : "\n✓ all good")
  process.exit(failures ? 1 : 0)
}

await main()

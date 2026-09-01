#!/usr/bin/env node
/**
 * Drive the join panel's keyboard in a real browser and report what each key does.
 *
 *   npm run web                        # in another terminal
 *   node scripts/drive-join.mjs        # or: npm run drive:join
 *   node scripts/drive-join.mjs --head # watch it happen
 *
 * The map has drive-map.mjs. This is the same idea for the panel at the top: the four Enter
 * combinations resolve a name and then decide what the panel keeps. Only a real browser sends
 * a keydown with metaKey on it, so only a real browser can answer whether `⌘↵` lands.
 *
 * Each case below states what it expects before it runs, and the run prints expected against
 * seen. A case that matches prints `ok`. A case that does not prints the difference.
 *
 * The browser starts on a fresh profile, so IndexedDB is empty and every name here is created
 * by the run. It writes nothing to the graph you use.
 *
 * The panel is above the map and does not touch it. The page it sits on is the map, and a
 * renderer that threw on boot would land in the console errors this run counts.
 *
 * Playwright is not a dependency of this project. Install it for one session:
 * `npm i -D playwright --no-save`. It uses the Chrome already on the machine.
 */
import { mkdirSync } from "node:fs"

import { MAP } from "./probe.mjs"

const { chromium } = await import("playwright").catch(() => {
  console.error("✗ needs playwright: npm i -D playwright --no-save")
  process.exit(2)
})

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const SHOTS = ".shots"
const headed = process.argv.includes("--head")

let failures = 0

/**
 * What the panel holds, read off the DOM rather than off the keys that were pressed.
 *
 * `focus` is part of the answer, not decoration. The point of `⌘` is that the caret does not
 * move, so a case that put the name in the right box but moved the caret has still failed.
 */
const state = (page) =>
  page.evaluate(() => {
    const near = document.querySelector("#near")
    const far = document.querySelector("#far")
    return {
      near: near.value,
      far: far.value,
      // The panel shows one input until a name is picked, then two.
      grown: !document.querySelector("#far-end").hidden,
      focus: document.activeElement?.id ?? "—",
      // A receipt per write that landed. Its text is both names and the undo button.
      receipts: [...document.querySelectorAll("#receipts > *")].map((chip) =>
        chip.textContent.trim(),
      ),
      // How many of those writes created a node. The panel marks the receipt when the pick
      // was a create, so this separates "created and joined" from "joined to what was there"
      // without having to count the store.
      fresh: document.querySelectorAll("#receipts > [data-new]").length,
      status: document.querySelector("#status")?.textContent?.trim() ?? "",
    }
  })

const check = (name, seen, want) => {
  // `receipts` is asked for as a count, because that is the readable way to write the
  // expectation. Everything else compares as it is read.
  const flat = { ...seen, receipts: seen.receipts.length }
  const wrong = Object.keys(want).filter((key) => String(flat[key]) !== String(want[key]))
  if (wrong.length) {
    failures++
    console.log(`  ✗ ${name}`)
    for (const key of wrong) {
      console.log(`      ${key}: expected ${JSON.stringify(want[key])}, saw ${JSON.stringify(seen[key])}`)
    }
  } else {
    console.log(`  ✓ ${name}`)
  }
  console.log(
    `      near="${seen.near}" far="${seen.far}" caret=${seen.focus} receipts=${seen.receipts.length}`,
  )
}

/**
 * Empty both inputs and shrink the panel back to one, the way a reader would.
 *
 * Two presses of Escape: the first closes the row list, the second empties the box. Receipts
 * are left alone. They outlive the pair that made them, which is the point of them.
 */
const reset = async (page) => {
  await page.locator("#near").focus()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(150)
}

/** Type a name into one input and press one combination. Waits for the write to land. */
const enter = async (page, box, text, keys) => {
  await page.locator(`#${box}`).focus()
  await page.keyboard.type(text, { delay: 20 })
  // The box searches on every keystroke. Let the rows arrive, so the case exercises the
  // normal path rather than the one where Enter has to run the query itself.
  await page.waitForTimeout(300)
  await page.keyboard.press(keys)
  await page.waitForTimeout(500)
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  const problems = []
  page.on("pageerror", (err) => problems.push(String(err)))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      problems.push(message.text())
    }
  })

  console.log(`→ ${WEB}${MAP}`)
  await page.goto(`${WEB}${MAP}`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )

  console.log(`\n1. ⌘↵ on the first name, with the other input empty`)
  console.log(`   expected: the name is held, nothing is joined — there is nothing to join to`)
  await enter(page, "near", "alpha", "Meta+Enter")
  check("chain is ignored without a second name", await state(page), {
    near: "alpha",
    far: "",
    grown: true,
    receipts: 0,
  })

  console.log(`\n2. plain ↵ completes the pair`)
  console.log(`   expected: alpha and beta joined, alpha stays the anchor, far input emptied`)
  await enter(page, "far", "beta", "Enter")
  check("plain Enter keeps the old anchor", await state(page), {
    near: "alpha",
    far: "",
    focus: "far",
    receipts: 1,
  })

  console.log(`\n3. ⌘↵ on a name that does NOT exist`)
  console.log(`   expected: gamma is created AND joined, and gamma replaces alpha in near`)
  await enter(page, "far", "gamma", "Meta+Enter")
  check("Meta+Enter creates the node and joins it", await state(page), {
    near: "gamma",
    far: "",
    focus: "far",
    receipts: 2,
    // Both writes so far named a node that did not exist, so both created one.
    fresh: 2,
  })
  await page.screenshot({ path: `${SHOTS}/join-3-meta-chain.png` })

  console.log(`\n4. Ctrl+↵ does the same, for keyboards without a ⌘ key`)
  console.log(`   expected: gamma and delta joined, delta replaces gamma in the near input`)
  await enter(page, "far", "delta", "Control+Enter")
  check("Control+Enter chains too", await state(page), {
    near: "delta",
    far: "",
    focus: "far",
    receipts: 3,
    fresh: 3,
  })

  console.log(`\n5. ⇧⌘↵ creates the typed name and chains`)
  console.log(`   expected: a create rather than a pick, and epsilon replaces delta`)
  await enter(page, "far", "epsilon", "Shift+Meta+Enter")
  check("Shift+Meta+Enter creates and chains", await state(page), {
    near: "epsilon",
    far: "",
    focus: "far",
    receipts: 4,
    fresh: 4,
  })

  // The other half of the question. Every name above was new, so every write above created
  // one. A name that already exists has nothing to create, and the same key must join to the
  // node that is there rather than refuse or duplicate it.
  console.log(`\n6. ⌘↵ on a name that DOES exist`)
  console.log(`   expected: joined to the existing alpha, nothing created — receipt not marked new`)
  await enter(page, "far", "alpha", "Meta+Enter")
  check("Meta+Enter joins without creating when the name exists", await state(page), {
    near: "alpha",
    far: "",
    focus: "far",
    receipts: 5,
    // Still 4. The fifth write joined to a node that was already there.
    fresh: 4,
  })

  console.log(`\n7. the anchor never moves to the far input`)
  console.log(`   expected: after a run of joins the near input holds the anchor every time`)
  await reset(page)
  await enter(page, "near", "zeta", "Enter")
  for (const [name, keys] of [
    ["eta", "Meta+Enter"],
    ["theta", "Meta+Enter"],
    ["iota", "Enter"],
  ]) {
    await enter(page, "far", name, keys)
    const seen = await state(page)
    console.log(`      after ${keys} on ${name}: near="${seen.near}" far="${seen.far}"`)
    if (seen.far) {
      failures++
      console.log(`      ✗ the far input kept a name`)
    }
  }

  // The guard that drops Enter mid-conversion, which is what an IME fires when it confirms a
  // word. Playwright cannot run a real IME, so the event is dispatched directly. This asks
  // only whether the guard swallows the key, which is the whole question.
  console.log(`\n8. ⌘↵ delivered with isComposing set, as an IME sends it`)
  console.log(`   expected: swallowed — no join, and the typed text stays in the box`)
  await reset(page)
  await enter(page, "near", "kappa", "Enter")
  const was = (await state(page)).receipts.length
  await page.locator("#far").focus()
  await page.keyboard.type("lambda", { delay: 20 })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    document.querySelector("#far").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await page.waitForTimeout(400)
  const composing = await state(page)
  check("a composing Enter writes nothing", composing, {
    near: "kappa",
    far: "lambda",
    receipts: was,
  })

  await browser.close()

  if (problems.length) {
    console.log(`\n✗ ${problems.length} console error(s):`)
    for (const problem of problems.slice(0, 10)) console.log(`  ${problem}`)
  }
  console.log(failures ? `\n✗ ${failures} case(s) did not match` : `\n✓ every case matched`)
  process.exitCode = failures || problems.length ? 1 : 0
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})

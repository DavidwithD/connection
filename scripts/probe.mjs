/**
 * How a drive script asks the map what it drew, and where.
 *
 * Cytoscape gave every node an element in the scene graph, and the five scripts beside this
 * file addressed nodes through it. A canvas holds no element per node. `globe-view.ts`
 * registers a read-only probe on `#stage` instead, and this module is the whole of what the
 * scripts say to it.
 *
 * Nothing here writes to the map. A script clicks, presses a key, or moves the pointer, the
 * way a reader does. What this module adds is the answer to "where is that node drawn" and
 * "what would a press there land on".
 */

/**
 * Where the map is, in the page's own query.
 *
 * The globe is behind a query while Cytoscape is still in the tree. Every script here names
 * this rather than the query, so the query goes in one edit when Cytoscape does.
 */
export const MAP = "/?globe"

/** One frame, as `globe-view.ts` reports it, or null where the page is not on the globe. */
export const frame = (page) =>
  page.evaluate(() => document.querySelector("#stage")?.__map?.report() ?? null)

/**
 * What a press would land on at each of several canvas points, in one round trip.
 *
 * `clear` is part of the answer. A panel over a node takes the press, exactly as it would
 * from a reader. A script that aimed under one would report the page refusing a gesture it
 * never received.
 *
 * A list rather than a point, because finding somewhere to aim means asking about a run of
 * candidates. Asking one at a time is one round trip each, over a picture that may move
 * between them.
 */
export const hitAll = (page, points) =>
  page.evaluate((list) => {
    const stage = document.querySelector("#stage")
    const map = stage?.__map
    if (!map) return null
    const box = stage.getBoundingClientRect()
    return list.map(({ x, y }) => {
      const point = { x: box.left + x, y: box.top + y }
      const under = document.elementFromPoint(point.x, point.y)
      return {
        ...map.at(x, y),
        clear: under?.tagName === "CANVAS",
        under: under?.tagName ?? "nothing",
        inWindow:
          point.x >= 0 && point.y >= 0 && point.x <= innerWidth && point.y <= innerHeight,
      }
    })
  }, points)

/** The same question about one point. */
export const hit = async (page, at) => (await hitAll(page, [at]))?.[0] ?? null

/** Where the canvas sits in the viewport, so a canvas point can be turned into a click. */
export const stageBox = (page) => page.locator("#stage").boundingBox()

/** Click where the probe says an element is drawn. A canvas has nothing to address by name. */
export const clickOn = async (page, at, options = {}) => {
  const box = await stageBox(page)
  await page.mouse.click(box.x + at.x, box.y + at.y, options)
}

/**
 * Wait for the camera to stop.
 *
 * A `viewport` event closes the map's menu — that is what it is for, so a menu never points at
 * whatever drifted under the pointer. Right-clicking before the camera is quiet is the script
 * racing the page, and it reads as the gesture failing.
 *
 * The camera's pose rather than the frame count. A still map draws no frames, so counting them
 * would report a map that had already stopped as one that never started.
 *
 * The pose is not enough on its own. Recentre on a centre already centred moves nothing and
 * still ends in a `viewport` event, so `moving` is what says the flight is over.
 */
export const still = async (page, quiet = 700) => {
  await page.waitForFunction(
    (ms) => {
      const seen = document.querySelector("#stage")?.__map?.report()
      if (!seen || seen.moving) return false
      const pose = [seen.centre.x, seen.centre.y, seen.zoom, seen.radius].join(",")
      const now = performance.now()
      if (window.__pose?.pose !== pose) {
        window.__pose = { pose, since: now }
        return false
      }
      return now - window.__pose.since > ms
    },
    quiet,
    { timeout: 20000 },
  )
}

/**
 * What one frame says about the doorways, in the terms the ghost rule is written in.
 *
 * `past` is the angle between a node's box and the horizon. Both thresholds the rule uses are
 * readable from it, so no script here needs a number of its own.
 */
export function read(seen) {
  const by = new Map(seen.elements.map((one) => [one.id, one]))
  const ghosts = seen.elements.filter((one) => one.kind === "ghost")
  const nodes = seen.elements.filter((one) => one.kind === "node")
  const drawn = seen.elements.filter((one) => one.at !== null)
  const ring = nodes.filter((one) => one.tier === 1)

  // Split on the second NUL, as `ghostTarget` in map.ts does.
  const targetOf = (id) => {
    const cut = id.indexOf("\0", 2)
    return cut < 0 ? null : by.get(id.slice(cut + 1))
  }
  // The invariant: a name is never readable at its own position and shown as a ghost at once.
  const twins = ghosts.filter((ghost) => (targetOf(ghost.id)?.past ?? 1) <= 0)
  // A doorway the surface has turned away is one nobody can open. Panned away from, the centre
  // takes its rings with it, so every doorway being gone there is the picture working as
  // decided. A slot on the far side of an off-middle centre is past the limb for the same
  // reason: the ring sits in world space. The fault is every slot being past it while the
  // centre is drawn, which leaves the reader a centre and no way out of it.
  const centre = seen.accent ? by.get(seen.accent) : undefined
  const centreShown = centre?.at != null
  const lost = centreShown && ghosts.length && !ghosts.some((one) => one.at) ? ghosts : []

  // Slots are handed out so that no two boxes touch, so any overlap is that arithmetic being
  // wrong rather than a judgement about crowding. Measured in world units, where the slots
  // were cut, because that is the space `box` is in.
  let collisions = 0
  for (let i = 0; i < ghosts.length; i++) {
    for (let j = i + 1; j < ghosts.length; j++) {
      const a = ghosts[i]
      const b = ghosts[j]
      const gapX = Math.abs(a.x - b.x) - (a.box.w + b.box.w) / 2
      const gapY = Math.abs(a.y - b.y) - (a.box.h + b.box.h) / 2
      if (gapX < 0 && gapY < 0) collisions++
    }
  }

  return {
    targetOf,
    centre,
    ghosts,
    nodes,
    drawn,
    ring,
    twins,
    lost,
    collisions,
    centreShown,
  }
}

/**
 * The first of a set of drawn elements the pointer can actually reach.
 *
 * A pill or a panel in front of one takes the press, exactly as it would from a reader. So
 * every candidate is put to the probe, and the first the probe answers with its own id is the
 * one handed back. Null where the pointer can reach none of them.
 */
export const reachable = async (page, elements) => {
  const drawn = elements.filter((one) => one.at)
  if (!drawn.length) return null
  const answers = (await hitAll(page, drawn.map((one) => one.at))) ?? []
  const found = drawn.findIndex((one, index) => answers[index]?.clear && answers[index].node === one.id)
  return found < 0 ? null : drawn[found]
}

/**
 * A canvas point with no element under it and no panel over it, in canvas pixels.
 *
 * Scanned inside the page rather than point by point from here. The answer needs the probe
 * and `elementFromPoint` together, and a grid is a few hundred points.
 */
export const emptyPoint = (page) =>
  page.evaluate(() => {
    const stage = document.querySelector("#stage")
    const map = stage?.__map
    if (!map) return null
    const box = stage.getBoundingClientRect()
    for (let y = 80; y < box.height - 80; y += 40) {
      for (let x = 80; x < box.width - 80; x += 40) {
        const found = map.at(x, y)
        if (found.node || found.line) continue
        if (document.elementFromPoint(box.left + x, box.top + y)?.tagName !== "CANVAS") continue
        return { x, y }
      }
    }
    return null
  })

/** Whether two pairs of ids name the same two elements, whichever way round each is written. */
export const samePair = ([a, b], [c, d]) => (a === c && b === d) || (a === d && b === c)

/** Whether the map holds a line between two elements. */
export const joined = (seen, a, b) =>
  seen.lines.some((line) => samePair([line.a, line.b], [a, b]))

/** The lines the map draws as real edges: not a ghost's lead, and not a stub's. */
export const realEdges = (seen) => seen.lines.filter((line) => line.kind === "edge")

/**
 * Where each line is drawn, in canvas pixels, nearest the middle of its drawn run first.
 *
 * Asked of the renderer rather than measured between the two ends. A line is drawn as
 * segments over a curved surface, and either end of it may be past the limb. The straight run
 * between two drawn ends therefore misses the curve.
 *
 * Nearest the middle first because the ends sit under whatever pill is drawn there.
 */
export const alongLines = async (page, pairs, most = 7) => {
  const paths = await page.evaluate((list) => {
    const map = document.querySelector("#stage")?.__map
    if (!map) return null
    return list.map(([a, b]) => map.path(a, b).filter(Boolean))
  }, pairs)
  return (paths ?? []).map((path) => {
    const middle = (path.length - 1) / 2
    return path
      .map((at, index) => ({ at, from: Math.abs(index - middle) }))
      .sort((one, other) => one.from - other.from)
      .slice(0, most)
      .map((one) => one.at)
  })
}

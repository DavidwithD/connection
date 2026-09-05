/**
 * The database: two object stores, three indexes, one connection.
 *
 * IMPORTANT: an IndexedDB transaction commits as soon as the microtask queue drains with no
 * request pending. Nothing inside a transaction may await a promise that is not an IndexedDB
 * request. No `fetch`, no `setTimeout`, no promise from anywhere else. Every write in this
 * directory is IndexedDB only, from `db.transaction(...)` to `tx.done`. Breaking this rule
 * shows no symptom until a write silently does not commit.
 */
import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPObjectStore,
  type StoreNames,
} from "idb"

export const DB_NAME = "connection"

/**
 * Version 2 added `created` to every node. Version 1 recorded nothing about time.
 *
 * The upgrade is one way. A browser holding version 2 refuses to open at version 1. Code from
 * before this change cannot read a database that has been through it.
 */
export const DB_VERSION = 2

/**
 * A node, as the store holds it.
 *
 * `labelKey` is both the key and an ordinary property. `keyPath` names the property the key
 * is read from, so there is one field rather than two. Uniqueness comes with it. A surrogate
 * id would mean storing the name twice: once as a key, and once in an index that does what
 * the key already does.
 */
export interface StoredNode {
  /** The key. It is `normaliseLabel(label)`. See keys.ts, which builds the pair. */
  labelKey: string
  /** The name as shown to the reader. Differs from the key only in case and spacing. */
  label: string
  /** The degree in the stored graph, denormalised. See read.ts for why it is not counted. */
  degree: number
  /** Union-find parent. A node pointing at itself is a root. */
  parent: string
  /** Set on roots only. Its absence keeps a record out of the `byIsland` index. */
  islandSize?: number
  /**
   * When the node was written, in milliseconds since the epoch.
   *
   * Written once. A rename carries it across, because a renamed node is the same node. No
   * index covers it: the node list sorts on it in memory, and an index would be maintained by
   * every write to serve one page. See read.ts.
   */
  created: number
}

/**
 * One undirected edge, stored once.
 *
 * `a` and `b` are sorted so that `a < b`, and together they are the key, as a real composite
 * key rather than a joined string. `ends` holds the same two names again, so a `multiEntry`
 * index can find the record from either end. That replaces the second copy of every edge the
 * old schema needed.
 */
export interface StoredEdge {
  a: string
  b: string
  ends: [string, string]
}

export interface GraphDB extends DBSchema {
  nodes: {
    key: string
    value: StoredNode
    indexes: {
      /** Sparse by construction: only a root has `islandSize`, so this holds one entry per
       *  component. `labelKey` breaks ties on size, so paging cannot repeat or skip a row. */
      byIsland: [number, string]
      /** Which nodes point at this one. The root-deletion repair reads it. See islands.ts. */
      byParent: string
    }
  }
  edges: {
    key: [string, string]
    value: StoredEdge
    indexes: { byEnd: string }
  }
}

/**
 * The store being unable to answer, as opposed to the graph refusing a write.
 *
 * `Refused` is an answer to act on: a taken name, a pair already joined. This is a third
 * kind, and it needs its own type so a page can tell "that name is taken" apart from "there
 * is nowhere to put it". Every case is a way IndexedDB fails that a server database did not
 * have. The graph now lives in one browser profile, so each of these is the only copy
 * failing.
 */
export class Unavailable extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "Unavailable"
  }
}

/** No graph can be stored at all: private browsing, disabled storage, or some webviews. */
const NO_INDEXEDDB =
  "this browser will not store a graph here — try a normal window, or take a file " +
  "in and out through the transfer page"

/**
 * Turn a DOMException into an `Unavailable` with a message for the reader, or return null.
 *
 * Every caller that touches the store uses this, so the messages live in one place rather
 * than in each catch block. Anything not listed here is a real fault and is left to
 * propagate. Inventing a message for an unknown error would hide it.
 */
export function unavailable(err: unknown): Unavailable | null {
  if (err instanceof Unavailable) return err
  if (!(err instanceof DOMException)) return null
  if (err.name === "QuotaExceededError") {
    return new Unavailable(
      "there is not enough room in this browser's storage for that — nothing was written",
    )
  }
  if (err.name === "AbortError") {
    return new Unavailable("the write was cut short, and none of it landed")
  }
  return null
}

/**
 * The callback for when this connection is closed from outside: another tab changing the
 * schema, or the browser closing the database. See `blocking` and `terminated` below.
 */
let onEvicted: (reason: string) => void = () => undefined

export function whenEvicted(tell: (reason: string) => void): void {
  onEvicted = tell
}

let connection: Promise<IDBPDatabase<GraphDB>> | null = null

export function open(): Promise<IDBPDatabase<GraphDB>> {
  connection ??= connect().catch((err: unknown) => {
    // Do not cache a failure. A blocked open clears when the other tab closes, and a page
    // that kept the rejection would keep reporting it for the life of the tab.
    connection = null
    throw err
  })
  return connection
}

/**
 * Give every node already in the store a `created`, in the version change itself.
 *
 * They all get the same moment: the upgrade. Version 1 recorded nothing about when a node was
 * written, so there is no truer date to give them. A graph built over months reads as one
 * day. The date control on the node list says so.
 *
 * The walk stays inside the version change transaction. Every await here is on a store
 * request, so the transaction cannot commit halfway through. Nothing awaits this function:
 * the open does not resolve until its transaction finishes, and that waits for these
 * requests. See the rule at the top of this file.
 */
async function stampCreated(
  nodes: IDBPObjectStore<GraphDB, ArrayLike<StoreNames<GraphDB>>, "nodes", "versionchange">,
): Promise<void> {
  const stamp = Date.now()
  let cursor = await nodes.openCursor()
  while (cursor) {
    await cursor.update({ ...cursor.value, created: stamp })
    cursor = await cursor.continue()
  }
}

async function connect(): Promise<IDBPDatabase<GraphDB>> {
  if (typeof indexedDB === "undefined") throw new Unavailable(NO_INDEXEDDB)

  // `blocked` fires when another tab holds a connection at an older version. The open itself
  // never settles until that tab closes. Without this race, boot hangs with no error. The
  // race turns the hang into a reported failure.
  let sayBlocked: (err: Unavailable) => void = () => undefined
  const blocked = new Promise<never>((_, reject) => {
    sayBlocked = reject
  })

  /** True once this attempt has been given up on. Its own flag rather than a check on
   *  `connection`, which a retry will have filled with a different attempt by then. */
  let abandoned = false

  const opening = openDB<GraphDB>(DB_NAME, DB_VERSION, {
    upgrade(db, from, _to, tx) {
      if (from < 1) {
        const nodes = db.createObjectStore("nodes", { keyPath: "labelKey" })
        nodes.createIndex("byIsland", ["islandSize", "labelKey"])
        nodes.createIndex("byParent", "parent")
        const edges = db.createObjectStore("edges", { keyPath: ["a", "b"] })
        edges.createIndex("byEnd", "ends", { multiEntry: true })
      }
      // A failed request aborts the version change, and `opening` below rejects with it.
      // The catch keeps that one failure from also arriving as an unhandled rejection.
      if (from >= 1 && from < 2) {
        void stampCreated(tx.objectStore("nodes")).catch(() => undefined)
      }
    },
    blocked() {
      abandoned = true
      sayBlocked(
        new Unavailable(
          "another tab has this graph open at a different version — close it and reload",
        ),
      )
    },
    blocking() {
      // Another tab wants to change the schema. A connection that ignores this blocks that
      // tab indefinitely, so close at once and tell the page. The page cannot discover on
      // its own that the store is gone.
      const held = connection
      connection = null
      forget()
      void held?.then((db) => db.close()).catch(() => undefined)
      onEvicted("another tab is changing how the graph is stored — reload this one")
    },
    terminated() {
      connection = null
      forget()
      onEvicted("the browser closed the graph — reload this page")
    },
  })

  // If the open succeeds after this call has already rejected, close it. Otherwise it is a
  // connection nobody holds, blocking whatever the other tab is trying to do.
  void opening.then((db) => {
    if (abandoned) db.close()
  })

  try {
    return await Promise.race([opening, blocked])
  } catch (err) {
    abandoned = true
    throw unavailable(err) ?? err
  }
}

/**
 * Ask the browser not to evict this origin's storage.
 *
 * A request, not a guarantee. It is the only protection there is for a graph that lives in
 * one browser profile. Both pages call it at boot. A false result is not an error: some
 * browsers decide on their own terms and report nothing, so no caller reads the result.
 */
export async function persist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/**
 * The node and edge totals, cached in memory.
 *
 * `count()` with no key range is a scan, not a maintained number. Measured at about 19ms over
 * 30,000 records, so 50 to 90ms at the size this store is built for. A write should not pay
 * that to update two numbers in the HUD. So the totals are read once when the database opens
 * and adjusted by each write. The cache needs no schema and does not survive a reload, so it
 * cannot go stale between sessions.
 */
let totals: { nodes: number; edges: number } | null = null

export async function counts(): Promise<{ nodes: number; edges: number }> {
  if (totals) return { ...totals }
  const db = await open()
  const [nodes, edges] = await Promise.all([db.count("nodes"), db.count("edges")])
  totals = { nodes, edges }
  return { ...totals }
}

/** Adjust the cached totals by what a write changed. Does nothing if nothing is cached. */
export function counted(nodes: number, edges: number): void {
  if (!totals) return
  totals.nodes = Math.max(0, totals.nodes + nodes)
  totals.edges = Math.max(0, totals.edges + edges)
}

/** Discard the cached totals. For a write that replaces the whole graph, where no delta
 *  can be computed. */
export function forget(): void {
  totals = null
}

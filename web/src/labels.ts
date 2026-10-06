/**
 * Button labels built from a node's own data, shared by the map and the node list.
 */
import type { NodeMeta } from "./store/index.js"

function edgeCount(node: NodeMeta): string {
  return node.degree === 1 ? "1 edge" : `${String(node.degree)} edges`
}

/** The button label, with the edge count when the node has edges. */
export function priced(node: NodeMeta): string {
  return node.degree ? `delete ${node.label} and its ${edgeCount(node)}` : `delete ${node.label}`
}

/** The status line after a delete lands, with the same edge count `priced` showed first. */
export function deleted(node: NodeMeta): string {
  return node.degree ? `deleted ${node.label} and its ${edgeCount(node)}` : `deleted ${node.label}`
}

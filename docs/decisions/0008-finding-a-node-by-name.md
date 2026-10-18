# 0008 — Finding a node by name

**Status:** ♻️ Superseded by [0030](0030-the-graph-moves-into-the-browser.md)
**Date:** 2026-08-02
**Deciders:** David HL

## Context
Every read starts from an id (`repo.ts`). The page knows an id only after walking to it.
Asking for a node by its label meant reading the whole table.
[ADR 0007](0007-a-table-for-the-graph.md) inherited that outcome as the sign of a wrong key
design.

[ADR 0006](0006-only-the-centre-reads.md) already listed a search box as a reason to reopen
it. With a search box, something other than the selected node would then draw.

## Decision
A label is an address. Two keys serve it, because exact and partial want different shapes.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Exact name | An item in the label's own partition | One consistent read, and a place to hold uniqueness. |
| Partial name | Index keys on the node's meta item | `begins_with` only reaches a sort key. |
| Spreading the index | Bucket by first character | A typed prefix always supplies one. |
| Two nodes, one name | Refused | An address must point at one place. |
| Arriving by name | The page places the node near the camera | It has no neighbour on screen to place it against. |

Only the selected node still draws. A search moves the selected node. It adds no second
thing that draws.

## Alternatives considered
- **The label in the index partition key.** One key instead of two, perfectly spread. It
  answers only "is this exactly Kavara". A box that answers as you type would have needed
  the whole name before it could say anything.
- **Allowing repeated labels and refusing at lookup.** No extra item per node, and honest
  about a store that never promised uniqueness. It moves the failure to whoever is typing.
- **Re-rooting the map on the searched node.** Keeps the invariant that everything on
  screen was walked to, by throwing the walk away. Losing the route costs more than the
  lone component does.

## Consequences
An item per node that exists only to reserve a name, and a seed that has to check for
collisions before it writes anything.

A node reached by name appears joined to nothing, on a map whose premise is that every node
arrived by walking. The picture stops being a single route.

Substring search is still unserved, and these keys cannot reach the middle of a name. That
question needs a different store, because another index cannot answer it. The cost of
answering it went up.

## Assumptions and unknowns
- Normalising folds case and whitespace and nothing else, so accented and unaccented
  spellings are separate names. Untested against data that has any.
- Assumed a first-character bucket spreads well enough. The seeded labels are drawn from a
  fixed syllable list (`generate.ts`), so real names may skew harder.
- Unknown whether a lone component on the map reads as arrival or as a glitch. Nobody but the
  author has used the box.

## Revisit when
- Someone searches for words inside a name rather than at the front.
- One bucket holds enough labels that a prefix query starts paginating.
- Nodes can be created or renamed outside the seed, so uniqueness needs the conditional
  write the reservation item was put there to allow.
- The lone component is what people complain about.

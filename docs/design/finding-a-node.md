# Finding a node by name

Every read starts from an id, and an id is only known by having walked to it — so a name
has to be an address or it is nothing. Two keys serve that, because an exact name and a
half-typed one want different shapes: a name owns a partition, and a claim item in it names
the node, while the node's own item carries index keys that put the label somewhere
`begins_with` can reach. The box on the page hands back nodes rather than text, and arriving
by name puts the found node on the map beside the camera, joined to nothing.

The reasoning is [ADR 0008](../decisions/0008-finding-a-node-by-name.md); the panel these
boxes live in is [ADR 0013](../decisions/0013-one-box-that-grows-into-an-edge.md). What the
box *writes* is [writing-to-the-graph.md](writing-to-the-graph.md).

## The pieces

| Name | What it is | In the code |
|---|---|---|
| claim | The one item in a name's own partition. It names the node and holds uniqueness | `labelPk(label)` / `LABEL_OWNER_SK` |
| label keys | Bucket and sort stamped on the node's meta item, for prefix search | `labelBucket`, `labelSort` |
| bucket | One partition per first character, so a prefix query lands on one | `label#a` … `label#_` |
| normalising | Case, surrounding space, runs of whitespace — and nothing else | `normaliseLabel` |
| combobox | The box that resolves what is typed into a node before anyone sees it | [combobox.ts](../../web/src/combobox.ts) |
| create row | The offer to make what was typed, when nothing already carries it | `Picked` of kind `create` |

## Two reads, two consistencies

**An exact name** is one `GetItem` on the claim partition, strongly consistent, followed by
a read of the node's meta item because the claim names the node but carries no degree
([labels.ts](../../src/graph/labels.ts)). Two round trips, on a path where being right
matters more than being quick — it feeds writes, and a claim made a moment ago has to be
visible or the same name gets made twice.

**A prefix** is one Query on the label index, eventually consistent, and that costs nothing
worse than a just-created node appearing a beat late in a search box. The index projects
everything, so a hit is already a whole node and needs no second read.

The same question asked of a whole file of names takes a third shape: the same two reads,
batched rather than run as a pair per name ([repo.ts](../../src/graph/repo.ts) holds the
batch size). It is strongly consistent for the same reason the single read is — it feeds
writes.

## Why the label is in two different key positions

A partition key answers *is this exactly this name* and nothing else. That is the right
shape for a claim, because uniqueness has to be enforceable by a conditional write on one
item, and it is the wrong shape for a box that answers as you type — you would need the
whole name before it could say anything.

`begins_with` only reaches a sort key, so prefix search needs the label there instead. A
sort key needs a partition to sit in, and bucketing by first character costs the caller
nothing because a typed prefix always supplies one.

Normalising is deliberately shallow. `Zoë` and `Zoe` are two names, not one, and the claim
key is built from the normalised form — so a label that normalises to nothing has no
partition to own and could never be found again, which is why creating one is refused.

## The box hands back nodes, not text

A prefix can match many nodes, so a string is never enough to say which one was meant.
Every box in the app that names a node resolves it through the combobox first, and its
caller only ever sees a node — which is what lets every write be addressed by id.

Two keys, and the split between them is the whole shape:

- `↵` takes the highlighted row. Typing a prefix and pressing it is how you reach a node
  that exists — the common act, and the reason this resolves names at all.
- `⇧↵` creates exactly what is typed, whatever else the list shows. Creating is a distinct
  act and gets a distinct key, because `ash` is far more often the start of a name that
  exists than a node somebody means to make.

They meet at both ends of that. A name matching nothing has no best match to take, so `↵`
creates rather than doing nothing; a name matching exactly has nothing to create, since one
name is owned by one node, so `⇧↵` takes that node rather than firing a create the store is
bound to refuse.

Neither key waits on the list. With nothing resolved in hand the box asks and then acts, so
a name typed faster than the box can search is not a keystroke that lands on nothing.

`⌘` rides on either Enter rather than joining that split. It carries no opinion about which
node was meant, so the box passes it out untouched as a flag on the pick: what going on from
a name means is the caller's, and for the panel that names an edge it is the next name
joining to the one just written ([join.ts](../../web/src/join.ts)).

A query in the air is aborted when the next one starts, so a slower earlier reply cannot
overwrite a later one. Rows fire on `mousedown` rather than `click`, because losing focus
closes the list and a `click` would arrive after it had gone.

## Arriving somewhere by name

A searched node is seated at the first clear spot near the camera and becomes the centre
([main.ts](../../web/src/main.ts)). It neighbours nothing on screen, so there is nothing to
seat it against — and the map's premise is that everything on it was walked to, which a
search breaks on purpose. The picture stops being a single route.

An island arrives differently. It is the first node of a neighbourhood that will grow as it
is walked, and grown from a seat wedged between two nodes of somewhere else it would
interleave with them — two unconnected regions on one patch of ground, with no way to tell
by looking which node belongs to which. Positions are never reassigned, so that is not a
picture that tidies itself up later. `berth` finds open water for it instead of
`landing` ([world.ts](../../web/src/world.ts)); the rest is
[the-islands.md](the-islands.md).

Only the centre draws. A search moves the centre — it does not add a second thing that
draws.

## What has to stay true

**One name is owned by one node.** The claim item, written conditionally. An address
pointing at two places is not an address, and the failure is asymmetric: the loser stays
perfectly reachable by id while being invisible to search, which is a divergence nothing
reports.

**A resolved name is a node, never a string.** The combobox is the only place that
conversion happens, and every route takes ids. Resolving a name a second time further down
restores exactly the ambiguity the box exists to remove.

**The claim and the label keys are written together, exactly as the seed writes them.** The
label index lives on two attributes on the meta item alone, so a node missing them is
invisible to search while being perfectly reachable by id.

**Search is a prefix, at the front of a name only.** These keys cannot reach the middle of
one. That is not a gap to patch with another index — it is a different store, and
[ADR 0008](../decisions/0008-finding-a-node-by-name.md) records the cost going up.

## Where the numbers are

How many hits a prefix query returns, in [labels.ts](../../src/graph/labels.ts). How long
the box waits before asking, in [combobox.ts](../../web/src/combobox.ts) — with the reason
it is shorter than either camera settle. Seat separation and the search for open water, in
[placement.ts](../../web/src/placement.ts) and [world.ts](../../web/src/world.ts).

## Records behind it

| Record | What it settled |
|---|---|
| [0008](../decisions/0008-finding-a-node-by-name.md) | That a label is an address, and the two keys that serve it |
| [0013](../decisions/0013-one-box-that-grows-into-an-edge.md) | One box rather than two tabs, and what a pick does at each end |
| [0006](../decisions/0006-only-the-centre-reads.md) | That only the centre draws — which a search moves rather than bypasses |
| [0007](../decisions/0007-a-table-for-the-graph.md) | The table these keys are laid out on |

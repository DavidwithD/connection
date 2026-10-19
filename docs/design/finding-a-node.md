# Finding a node by name

Every read starts from a node's id. A reader learns an id only by walking to its node. So a name
must work as an address, or a search has nothing to go on. Here the name *is* the address. The
store keys a node on its own normalised label. An exact name is one `get`, and a half-typed name
is a range on the same keys. The combobox returns nodes, never text. A search places the found
node on the map near the camera, joined to nothing.

What the combobox *writes* is in [writing-to-the-graph.md](writing-to-the-graph.md).

## The pieces

| Name | What it is | In the code |
|---|---|---|
| labelKey | The normalised name. The store's own key, and an ordinary property | `keyPath: "labelKey"` |
| label | The spelling, shown to the reader. Differs from the key only in case | `label` |
| normalising | Case, surrounding space, runs of whitespace. Nothing else | `normaliseLabel` |
| minting | The one function that writes both record fields, together | `naming` |
| combobox | The input that turns typed text into a node before its caller sees it | [combobox.ts](../../web/src/combobox.ts) |
| create row | The offer to make the typed name, when no node has it | `Picked` of kind `create` |

## The name is the key

The store keys a node record on `normaliseLabel(label)`. Four things follow from that:

- an exact name is `nodes.get(normaliseLabel(q))` — no index, one read
- a prefix is a bound range on the store itself — no index
- the store enforces "that name is taken", because keys are unique
- there is no id to generate, and nothing that could disagree with the name

The old store needed several parts for this. An item in the name's own partition held
uniqueness, and nothing else. A strongly consistent read checked that item. A second read
fetched the node it named. Two index attributes grouped the label by first character, so a
prefix query had a partition to search. Each part worked around a store whose key could not be
the name.

This is [0012](../decisions/0012-the-name-is-the-node.md) taken literally. The cost is
**rename**, and only rename. IndexedDB keys cannot change. So a rename of a name-keyed node is a
delete and a re-add. It also rewrites every edge that touches the node, and every `parent` that
points at it.

`renameNode` in [write.ts](../../web/src/store/write.ts) does all of that in one transaction.
[writing-to-the-graph.md](writing-to-the-graph.md) describes the cost.
[0040](../decisions/0040-a-node-under-a-new-name.md) records why it was worth paying.

A surrogate id is still possible. It would be a version bump whose upgrade rewrites every record
once, offline. Rename is no longer a reason to add one.

## Why both the key and the spelling are stored

`label` is the typed name, and `labelKey` is its normalised form. The write path already trims a
label and collapses its whitespace. So **the only difference between them is case**. Matching
must ignore case, so that `Kavara` blocks `kavara` and `kav` finds it. Display must keep case, so
the reader sees the name they typed.

Both are stored because **IndexedDB has no functional indexes and no computed keys.** A `keyPath`
can only name a property that is in the stored value. So IndexedDB has no unique index on a
lowered column. To match on the normalised form, the record must store it.

That is still less than before. The old store held the same string three times, plus the raw
label on two separate items. One key and one property replace all five.

Normalising stays shallow. `Zoë` and `Zoe` are two names. Folding diacritics would decide for the
reader which names are the same. A label that normalises to nothing has no key, so the store
refuses to create it.

## What the key costs elsewhere

An id used to use a restricted alphabet. Code could join two ids with a space, a colon or a tilde
to make one string. A name is free-form, so any of those separators can appear inside a name.
Then two different pairs can produce one string. `pairKey("a", "b c")` and `pairKey("a b", "c")`
came out identical. Two edges then became one drawn element, and no error appeared.

One rule covers all of it: **join with NUL**. No name can hold one, so nothing needs escaping.
Every site that builds a composite element id uses it. That includes an off-screen marker's id
in [map.ts](../../web/src/map.ts), and a stub's and a line's in the renderer that draws them.
The store itself needs none of this. It keys an edge on the pair `["a", "b"]`. That is a real
composite key, and IndexedDB compares arrays element by element.

## The combobox returns nodes, not text

A prefix can match many nodes, so a string cannot say which node the reader meant. Every input in
the app that names a node resolves it through the combobox first. Its caller only ever receives a
node. So every write can use an id.

Two keys split the work:

- `↵` takes the highlighted row. A reader types a prefix and presses it to reach a node that
  exists. That is the common case, and the reason the combobox resolves names at all.
- `⇧↵` creates exactly the typed name, whatever else the list shows. Creating gets its own key.
  `ash` is far more often the start of an existing name than a new node.

The two keys meet at both ends. A name that matches nothing has no best match, so `↵` creates it.
A name that matches exactly has nothing to create, because one node owns one name. So `⇧↵`
takes that node, and skips a create that the store would refuse.

Neither key handler waits for the list. If nothing is resolved yet, the combobox searches, then
acts. So a name typed faster than the search still reaches a node.

`⌘` works with either Enter and keeps the split as it is. It says nothing about which node the
reader meant. The combobox passes it to the caller as a flag on the pick. The caller decides what
it means. In the join panel, it starts the next join from the name just written
([join.ts](../../web/src/join.ts)).

The combobox now searches at once. A debounce used to space out requests during typing. A range
over the store's own keys needs no spacing. It also needs no cancel when the next search starts.
Rows still fire on `mousedown` instead of `click`. A focus loss closes the list, and a `click`
would arrive after the list had gone.

## Arriving somewhere by name

`main.ts` places a searched node at the first free spot near the camera
([main.ts](../../web/src/main.ts)). The node becomes the selected node. It has no neighbour on
screen to be placed next to. The map assumes the reader walked to every node on it, and a search
breaks that on purpose. The map then shows more than one route.

A component arrives differently. Its first node starts a neighbourhood that grows as the reader
walks it. Placed between two nodes of another component, it would mix with them. Two unconnected
regions would share one area, and the reader could not tell which node belongs where. Positions
never change, so the map would stay mixed. So `main.ts` uses `freeSpot` for it instead of
`nearestFreeSpot` ([world.ts](../../web/src/world.ts)). The rest is in
[the-components.md](the-components.md).

Only the selected node reads its neighbours. A search changes which node is selected. It adds no
second node that reads.

## What has to stay true

**One node owns one name.** The store's key enforces it. The check inside the transaction exists
so the error message is ours, and the engine's message stays hidden.

**A record's `label` is the spelling of its own key.** One helper writes the pair
([keys.ts](../../web/src/store/keys.ts)), and no other code writes either field. A record whose
label does not normalise to its key is found under a name it does not show. That is worse than a
stale count, because the reader cannot see it. **Check the graph** on the transfer page compares
the two on every record. An imported file is the likely way to break it.

**A resolved name is a node, never a string.** The combobox is the only place that conversion
happens, and every write takes ids. Code that resolves a name a second time brings back the
ambiguity the combobox removes.

**Search matches a prefix, at the front of a name only.** A key range reaches the start of a key
and nothing else. A substring search needs a second structure. Every write would have to update
it and keep it in step. That costs more than this combobox is worth.

## Where the numbers are

The number of hits a prefix range returns is in [read.ts](../../web/src/store/read.ts). The
spacing between placed nodes and the search for a free spot are in
[placement.ts](../../web/src/placement.ts) and [world.ts](../../web/src/world.ts).

## Records behind it

| Record | What it decided |
|---|---|
| [0012](../decisions/0012-the-name-is-the-node.md) | That a node is its name. The key now states it directly |
| [0008](../decisions/0008-finding-a-node-by-name.md) | That a label is an address, and the two keys that used to serve it |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | Keying on the name, its cost, and where NUL replaced a separator |
| [0013](../decisions/0013-one-box-that-grows-into-an-edge.md) | One input instead of two tabs, and what a pick does at each end |
| [0006](../decisions/0006-only-the-centre-reads.md) | That only the selected node reads. A search moves that role and keeps the rule |

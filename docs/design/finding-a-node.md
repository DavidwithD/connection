# Finding a node by name

Every read starts from a node's id, and an id is only known by having walked to it — so a name
has to be an address or it is nothing. Here the name *is* the address: a node is keyed by its
own normalised label, so an exact name is one `get` and a half-typed one is a range on the same
keys. The box on the page hands back nodes rather than text, and arriving by name puts the
found node on the map beside the camera, joined to nothing.

What the box *writes* is [writing-to-the-graph.md](writing-to-the-graph.md).

## The pieces

| Name | What it is | In the code |
|---|---|---|
| labelKey | The normalised name. The store's own key, and an ordinary property | `keyPath: "labelKey"` |
| label | The spelling, shown to the reader. Differs from the key only in case | `label` |
| normalising | Case, surrounding space, runs of whitespace — and nothing else | `normaliseLabel` |
| minting | The one place both fields are written, together | `naming` |
| combobox | The box that resolves what is typed into a node before anyone sees it | [combobox.ts](../../web/src/combobox.ts) |
| create row | The offer to make what was typed, when nothing already carries it | `Picked` of kind `create` |

## The name is the key

A node record is keyed on `normaliseLabel(label)`, and four things fall out of that at once:

- an exact name is `nodes.get(normaliseLabel(q))` — no index, one read
- a prefix is a bound range on the store itself — no index
- "that name is taken" is enforced by the store, because keys are unique
- there is no id to generate, and nothing that could disagree with the name

What it replaces is a whole apparatus: an item in the name's own partition that existed only to
hold uniqueness, a strongly consistent read of it, a second read of the node it named, and a
pair of index attributes bucketing the label by first character so a prefix query had a
partition to land in. Every one of those was working around a store where the key could not be
the name.

This is [0012](../decisions/0012-the-name-is-the-node.md) taken literally. What it costs is
**rename**, and only rename. IndexedDB keys cannot be mutated, so renaming a name-keyed node
means a delete, a re-add, a rewrite of every edge touching it, and a rewrite of every `parent`
pointing at it.

`renameNode` in [write.ts](../../web/src/store/write.ts) pays that price, in one transaction.
What it costs is in [writing-to-the-graph.md](writing-to-the-graph.md), and why it was worth
paying is [0038](../decisions/0038-a-node-under-a-new-name.md).

Adding a surrogate id would still be a version bump whose upgrade rewrites every record once,
offline. That door is still open, and rename is no longer the reason to walk through it.

## Why both the key and the spelling are stored

`label` is what was typed and `labelKey` is what it normalises to. Since a label is written
trimmed and whitespace-collapsed already, **the only difference between them is case** — which
is exactly what has to be ignored for `Kavara` to block `kavara` and for `kav` to find it, and
exactly what has to be kept for a reader to see the name they typed.

Both are stored because **IndexedDB has no functional indexes and no computed keys.** A
`keyPath` can only name a property that is really in the value, so there is no equivalent of a
unique index on a lowered column. Matching on the normalised form means materialising it.

That is still a reduction. The same string used to be materialised three times, plus the raw
label on two separate items; one key and one property replace all five.

Normalising stays shallow. `Zoë` and `Zoe` are two names, not one — folding diacritics would
decide for the reader which names are the same — and a label that normalises to nothing has no
key, so creating one is refused.

## What the key costs elsewhere

An id used to be a restricted alphabet, safe to join with a space, a colon or a tilde wherever
two of them had to make one string. A name is free-form, so every one of those separators can
now appear inside a part and make two different pairs produce one string —
`pairKey("a", "b c")` and `pairKey("a b", "c")` come out identical, and two edges collapse into
one drawn element with no error anywhere.

One rule covers all of it: **join with NUL**. No name can hold one, so nothing needs escaping,
and the sites that build composite element ids in [map-view.ts](../../web/src/map-view.ts) all
use it. The store itself needs none of this — an edge is keyed on the pair `["a", "b"]`, which
is a real composite key rather than a joined string, and arrays compare element by element.

## The box hands back nodes, not text

A prefix can match many nodes, so a string is never enough to say which one was meant. Every
box in the app that names a node resolves it through the combobox first, and its caller only
ever sees a node — which is what lets every write be addressed by id.

Two keys, and the split between them is the whole shape:

- `↵` takes the highlighted row. Typing a prefix and pressing it is how you reach a node that
  exists — the common act, and the reason this resolves names at all.
- `⇧↵` creates exactly what is typed, whatever else the list shows. Creating is a distinct act
  and gets a distinct key, because `ash` is far more often the start of a name that exists than
  a node somebody means to make.

They meet at both ends of that. A name matching nothing has no best match to take, so `↵`
creates rather than doing nothing; a name matching exactly has nothing to create, since one
name is owned by one node, so `⇧↵` takes that node rather than firing a create the store is
bound to refuse.

Neither key waits on the list. With nothing resolved in hand the box asks and then acts, so a
name typed faster than the box can search is not a keystroke that lands on nothing.

`⌘` rides on either Enter rather than joining that split. It carries no opinion about which node
was meant, so the box passes it out untouched as a flag on the pick: what going on from a name
means is the caller's, and for the panel that names an edge it is the next name joining to the
one just written ([join.ts](../../web/src/join.ts)).

The box no longer waits before it asks. A debounce spaced out requests as you type; a range
over the store's own keys does not need spacing out, and neither does it need a query in the
air to be abandoned when the next one starts. Rows still fire on `mousedown` rather than
`click`, because losing focus closes the list and a `click` would arrive after it had gone.

## Arriving somewhere by name

A searched node is seated at the first clear spot near the camera and becomes the centre
([main.ts](../../web/src/main.ts)). It neighbours nothing on screen, so there is nothing to seat
it against — and the map's premise is that everything on it was walked to, which a search
breaks on purpose. The picture stops being a single route.

An island arrives differently. It is the first node of a neighbourhood that will grow as it is
walked, and grown from a seat wedged between two nodes of somewhere else it would interleave
with them — two unconnected regions on one patch of ground, with no way to tell by looking
which node belongs to which. Positions are never reassigned, so that is not a picture that
tidies itself up later. `berth` finds open water for it instead of `landing`
([world.ts](../../web/src/world.ts)); the rest is [the-islands.md](the-islands.md).

Only the centre draws. A search moves the centre — it does not add a second thing that draws.

## What has to stay true

**One name is owned by one node.** The store's key enforces it, and the check inside the
transaction is only there so the sentence is ours rather than the engine's.

**A record's `label` is the spelling of its own key.** One helper mints the pair
([keys.ts](../../web/src/store/keys.ts)) and nothing else writes either field. A record whose
label does not normalise to its key is a node found under a name it does not display — which is
worse than a stale count, because the reader cannot see it. **Check the graph** on the transfer
page compares the two on every record, which is where an imported file would break it.

**A resolved name is a node, never a string.** The combobox is the only place that conversion
happens, and every write takes ids. Resolving a name a second time further down restores
exactly the ambiguity the box exists to remove.

**Search is a prefix, at the front of a name only.** A key range reaches the start of a key and
nothing else. Serving a substring means a second structure to write to and hold in step on
every write, which is a larger thing to own than this box is worth.

## Where the numbers are

How many hits a prefix range returns, in [read.ts](../../web/src/store/read.ts). Seat separation
and the search for open water, in [placement.ts](../../web/src/placement.ts) and
[world.ts](../../web/src/world.ts).

## Records behind it

| Record | What it settled |
|---|---|
| [0012](../decisions/0012-the-name-is-the-node.md) | That a node is its name — which the key now says outright |
| [0008](../decisions/0008-finding-a-node-by-name.md) | That a label is an address, and the two keys that used to serve it |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | Keying on the name, what it costs, and where NUL had to replace a separator |
| [0013](../decisions/0013-one-box-that-grows-into-an-edge.md) | One box rather than two tabs, and what a pick does at each end |
| [0006](../decisions/0006-only-the-centre-reads.md) | That only the centre draws — which a search moves rather than bypasses |

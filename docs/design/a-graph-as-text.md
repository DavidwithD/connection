# A graph as text

A graph can be written down as lines of names, typed by hand, and read back in. A line's first
name joins each of the rest — a star, not a chain — so a hub is one line and a line of one name
is a node with no edges. Identity is the label, never an id, so the file needs no header and no
id column. Reading it in is a *patch*: it adds, it never removes, and it goes through the same
single-node and single-edge writes everything else uses. Writing it out is the same format's
other half, ordered so that a round trip can be checked with `diff`.

Both directions live in one file ([text.ts](../../web/src/store/text.ts)) because they are one
format. What is *done* with a reading — surveying it against the store and applying it — is
[load.ts](../../web/src/store/load.ts).

## The format

```
# a comment, and a blank line, both say nothing
Thorne                        # a node and no edges — an island of one
Kavara | Miselin | Vessarin   # Kavara joins Miselin, and Kavara joins Vessarin
```

A star rather than a chain, because that is how a graph is thought about while it is being
typed: *this node, and what it connects to*. It puts a hub on one line, and it gives a line of
one name the meaning it should have — the component [the-islands.md](the-islands.md) exists
for, which a chain reading would have to bolt on as a special case. A path is still a path, one
line per step.

Neither reading is visible in the file, which is why every preview prints the pairs it read
rather than leaving them to be assumed.

## The pieces

| Name | What it is | In the code |
|---|---|---|
| reading | The file as names and pairs, plus faults. Reads no store | `parse` → `Reading` |
| survey | A reading measured against what is already stored | `survey` → `Plan` |
| plan | New names, new pairs, and how many were already there | `fresh`, `joins`, `joined` |
| apply | The plan, written one transaction at a time | `apply` |
| shape | Which file a write produces: `joins` or `names` | `Shape` |
| unwritable | A stored name no line can carry | `Unwritable` |

## Reading a file in

`parse` is pure — it reads no store and asks nothing of one. Every fault is collected rather
than thrown at the first, because a hand-typed file repaired one complaint at a time is an
afternoon.

Names are deduplicated by their normalised form and kept in the spelling the file uses first,
because that is the spelling a node will be created under and the one every later line has to
agree with. Normalising folds case and runs of whitespace and nothing else, so `Kavara` and
`kavara` are one node while `Zoë` and `Zoe` are two.

`survey` then asks the store which of those names and pairs already exist — a `get` per name on
the store's own key, and a `get` per pair on the edge key. `apply` writes what is left.

Two things this deliberately is not:

- **Authoritative.** The file is a patch, not a picture. Deleting a line does not part an edge,
  and nothing here removes anything — which makes it the one way into the graph that needs no
  confirmation before it runs.
- **Its own writer.** Every node goes through `createNode` and every edge through `addEdge`,
  one transaction each, so a load defends `degree` and the name keys exactly as the page does
  ([writing-to-the-graph.md](writing-to-the-graph.md)).

Running it twice is a no-op. Both writes refuse what is already there, and those two refusals
are counted rather than raised — which is the whole of what makes a file editable. That is why
each of those two sentences is an exported constant where it is worded, compared against rather
than copied.

## Why it is still sequential

Not for the reason it used to be. Every write once carried a conditional update on one shared
item, so running them at once made them contend and come back as a cancellation nothing could
read. That item is gone, and IndexedDB serialises overlapping transactions rather than
cancelling one.

What is left is simpler: a load is a series of ordinary writes, and each has to see what the
one before it did. The name a later line joins to may be the name an earlier line created.

There is no request to keep open, so the ceiling that capped how many writes one load could
make is gone with it. What remains is a limit on how much text is accepted at all, which is a
guard against a pasted novel rather than a bound on the graph.

A load large enough to move where the map starts wants nothing afterwards. The boot node is
derived from the island index, and a merge is recorded inside the write that caused it — so a
finished load is already described correctly.

## Writing a file out

`format` is pure over the nodes and edges it is handed, so what is written is what was chosen
rather than a second opinion about which records are the graph.

Every ordering is by **label**. That used to be load-bearing because a reloaded graph came back
with new ids; the name is the id now, so a round trip is stable for a stronger reason than the
sort. It stays because a file ordered by anything else would still change when the graph was
reloaded elsewhere.

Nothing in the file is dated. The JSON export stamps itself because it is a backup; this file is
meant to be edited and committed, and a stamp would make every re-export a diff with no change
in it.

Only one end of each pair writes it — the busier node, ties broken by name — because both ends
would be twice the file, and `a | b` beside `b | a` reads as two facts rather than one.

The `names` shape is every label and nothing else. This reader still accepts it: every line is a
lone name, so loading one reproduces the nodes and none of the edges. A vocabulary rather than a
graph, and worth its own shape because that is what a list of names is wanted for.

A text export is lossy on purpose — no degrees, no components. It is not a backup, and the JSON
export still is.

## The backup this is not

The JSON export and its import are the other pair, and they behave differently on purpose
([store/transfer.ts](../../web/src/store/transfer.ts)).

A subset of a graph is not automatically a graph, so an import checks before it writes. Each
fault is an inconsistency that reads fine right up until something walks into it.

- An edge with one end outside the file is dropped. A half-edge is a name nothing carries.
- `degree` is checked against the edges actually there. A count that outlives the edges it
  counted makes a finished node look like it has more graph behind it.
- A record's `label` must normalise to its own key, or the node is found under a name it does
  not display. This is the check the import path is most likely to break, because `label`
  arrives from a file rather than from a write.
- The components are stamped from the nodes and edges themselves, never carried in from the
  file, because a subset's components are not the ones it was exported from.

An export is the whole graph, always. It used to have a subset default, because a re-seed
dropped the table and the question was which nodes would survive it. Nothing drops a table now,
and no id shape records where a node came from, so the question has no answer and no reason to
be asked.

The file carries a version, and that is what makes the older files still readable. It writes
the store's own records now; the version before it wrote the table's items, keyed by id. Those
files are the only copy of any graph made before this store existed, so the import still reads
them — it builds an id-to-name map from the node items and rewrites the edges through it. Safe
on any file the old store produced, because it enforced one node per name.

## The page

[transfer.html](../../web/transfer.html) is its own Vite entry, sharing the stylesheet and the
store with the map and importing none of its machinery. That sharing is what makes a second page
affordable: what one otherwise costs is every fix made twice, across stylesheets and boot
helpers that were copied once and then drifted. Nothing here draws a graph.

It is now the whole data-management surface, because there is no command line left to hold one.
Five things happen here:

| | What it does | What it replaced |
|---|---|---|
| **Download** | Writes a blob and hands it to the browser | Two `href`s to routes |
| **Add a text file** | Survey, then write on the second click | The same, over HTTP |
| **Import JSON** | Reads a whole graph in, in one transaction | A command that dropped the table |
| **Seed a demo graph** | The generator, behind a button | A command that dropped the table |
| **Check the graph** | Every invariant, over every record | A command's `--check` |
| **Recount the islands** | Derives the components from the graph | A command |

The way in is still two calls, not one. Choosing a file only surveys it; the button that writes
appears once there is something to write. A page needs that preview more than a terminal does,
not less: there is no file on disk to check afterwards and no scrollback saying what was
written.

The downloads are blobs rather than links to a route. There is no route to follow, and the
anchors that used to be the only paths in the client nothing checked are gone with it.

**Everything destructive asks first, and offers the export before it runs.** Seeding and
importing each replace what is stored. On a command line that guard was an environment variable
and a rescue file written next to whoever ran it; a button inherits neither, so the asking is
the guard.

## What has to stay true

**One home for the format's rules.** The separator, the comment character and the star reading
are each a rule the reader and the writer have to agree on. A rule stated twice is a rule that
drifts, and a writer that stopped matching its reader would produce files that load as a
*different graph* rather than as an error.

**A load only ever adds.** No line removes anything. This is what lets it run without asking
first, where the other two ways in have to.

**Every text load goes through the ordinary writes.** Never a bulk path — that exists only
behind importing a whole graph, which is the one thing a patch must not be.

**A file is ordered by label alone, and carries no date.** Both exist so that export, load into
an empty store, and export again give back the same bytes.

**A name holding the separator or the comment character cannot be written at all.** There is no
escape in this format, and adding one would change what every file already written means.
Nothing rejects those characters when a node is made, so the writer has to refuse — which means
an unwritable name is reachable from the map. Which end to fix that at is open.

**An import lands whole or not at all.** One transaction, because a half-applied graph is the
one outcome worse than a rejected one — and the quota being exceeded partway is exactly how
that would arrive.

**A misspelling is a new node, not an error.** The format's real cost, and it cannot be caught
here: nothing matches a name against a near miss. The plan lists every name it would create,
and that listing is the whole defence.

## Where the numbers are

How much text is read at all, in [store/index.ts](../../web/src/store/index.ts) — beside the
two functions that read it, with the ceiling it is all that is left of. How many names or
faults are listed before the rest become a count, and what the seed button builds, in
[transfer.ts](../../web/src/transfer.ts). What separates names on a line, in
[text.ts](../../web/src/store/text.ts). What a whole-graph export costs at the ceiling, in
[storing-a-graph.md](../requirements/storing-a-graph.md).

## Records behind it

| Record | What it settled |
|---|---|
| [0021](../decisions/0021-a-graph-in-a-text-file.md) | The format, the star reading, and that a file is a patch |
| [0022](../decisions/0022-a-graph-written-back-out.md) | The writer, the ordering that makes a round trip checkable, and the open question about the separator and the comment character |
| [0023](../decisions/0023-the-graph-moves-through-the-page.md) | A second page rather than a panel, and two calls for the way in |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | That every way a graph moves is now a button, and the export is the only backup |
| [0017](../decisions/0017-the-second-view-goes.md) | That there is one view, so a second page shares rather than copies |
| [0018](../decisions/0018-the-graph-outlives-the-seed.md) | The JSON export this is deliberately not, and the subset default that went with the id shape |
| [0012](../decisions/0012-the-name-is-the-node.md) | That a node is its name, which is why the file has no ids |

# A graph as text

A graph can be written down as lines of names, typed by hand, and read back in. A line's
first name joins each of the rest — a star, not a chain — so a hub is one line and a line of
one name is a node with no edges. Identity is the label, never an id, so the file needs no
header and no id column. Reading it in is a *patch*: it adds, it never removes, and it goes
through the same single-node and single-edge writes everything else uses. Writing it out is
the same format's other half, ordered so that a round trip can be checked with `diff`.

Both directions live in one file ([text.ts](../../src/graph/text.ts)) because they are one
format. What is *done* with a reading — surveying it against the table and applying it — is
[load.ts](../../src/graph/load.ts).

## The format

```
# a comment, and a blank line, both say nothing
Thorne                        # a node and no edges — an island of one
Kavara | Miselin | Vessarin   # Kavara joins Miselin, and Kavara joins Vessarin
```

A star rather than a chain, because that is how a graph is thought about while it is being
typed: *this node, and what it connects to*. It puts a hub on one line, and it gives a line
of one name the meaning it should have — the component
[the-islands.md](the-islands.md) exists for, which a chain reading would have to bolt on as
a special case. A path is still a path, one line per step.

Neither reading is visible in the file, which is why every preview prints the pairs it read
rather than leaving them to be assumed.

## The pieces

| Name | What it is | In the code |
|---|---|---|
| reading | The file as names and pairs, plus faults. Reads no table | `parse` → `Reading` |
| survey | A reading measured against what is already stored | `survey` → `Plan` |
| plan | New names, new pairs, and how many were already there | `fresh`, `joins`, `joined` |
| apply | The plan, written one transaction at a time | `apply` |
| shape | Which file a write produces: `joins` or `names` | `Shape` |
| unwritable | A stored name no line can carry | `Unwritable` |

## Reading a file in

`parse` is pure — it reads no table and asks nothing of one. Every fault is collected rather
than thrown at the first, because a hand-typed file repaired one complaint at a time is an
afternoon.

Names are deduplicated by their normalised form and kept in the spelling the file uses
first, because that is the spelling a node will be created under and the one every later line
has to agree with. Normalising folds case and runs of whitespace and nothing else, so
`Kavara` and `kavara` are one node while `Zoë` and `Zoe` are two.

`survey` then asks the table which of those names and pairs already exist, resolving a whole
file's names in batched reads rather than a pair of round trips per name
([labels.ts](../../src/graph/labels.ts)). `apply` writes what is left.

Two things this deliberately is not:

- **Authoritative.** The file is a patch, not a picture. Deleting a line does not part an
  edge, and nothing here removes anything — which makes it the one graph command needing no
  guard against being pointed at somewhere real.
- **Its own writer.** Every node goes through `createNode` and every edge through `addEdge`,
  one transaction each, so a load defends `degree` and the label claims exactly as the
  terminal and the page do ([writing-to-the-graph.md](writing-to-the-graph.md)).

Running it twice is a no-op. Both writes refuse what is already there, and those two
refusals are counted rather than raised — which is the whole of what makes a file editable.
That is why each of those two sentences is an exported constant where it is worded, compared
against rather than copied.

## Why it is sequential

Every one of those transactions carries a conditional update on the single index item, so
running them at once makes them contend — and a transaction conflict comes back as a
cancellation with no failed condition in it, which the reason tables can only hand back raw.

So a file costs about one round trip per new name and four per new pair, in series. That is
the price of reusing the writes rather than batching items, and it is why the browser has a
size cap where the command has none: the command prints as it goes and nobody is waiting on
a socket.

A load large enough to move where the map should start wants the reckoning afterwards —
`rootId` is left alone by every single write, and the reckoning also repairs the island index
if any merge lagged on the way through.

## Writing a file out

`format` is pure over whatever the export's `select` hands back, so what is written is what
was chosen rather than a second opinion about which items are the graph.

Every ordering is by **label**, and that is load-bearing rather than tidy. A file loaded into
an empty table comes back with new ids, so an id anywhere in the sort would make the second
export of one graph differ from the first — and the round trip could not be checked by
comparing them. Labels are unique by claim, so they order this on their own.

Nothing in the file is dated, for the same reason. The JSON export stamps itself because it
is a backup; this file is meant to be edited and committed, and a stamp would make every
re-export a diff with no change in it.

Only one end of each pair writes it — the busier node, ties broken by name — because both
ends would be twice the file, and `a | b` beside `b | a` reads as two facts rather than one.

The `names` shape is every label and nothing else. This reader still accepts it: every line
is a lone name, so loading one reproduces the nodes and none of the edges. A vocabulary
rather than a graph, and worth its own shape because that is what a list of names is wanted
for.

A text export is lossy on purpose — no ids, no degrees, no `rootId`, no index item. It is not
a backup, and the JSON export still is.

## The backup this is not

The JSON export and its restore are the other pair, and they behave differently on purpose
([export.ts](../../src/graph/export.ts), [restore.ts](../../src/graph/restore.ts)).

A subset of a graph is not automatically a graph, so three things are corrected on the way
out. Each is an inconsistency that reads fine right up until something walks into it.

- An edge with one end outside the export is dropped. Half an edge left in the table is an
  unreachable orphan, and it is the reason a node holding edges cannot be deleted.
- `degree` is rewritten from the edges actually kept. A count that outlives the edges it
  counted makes a finished node look like it has more graph behind it.
- The index item is left behind and recomputed on the way in, because `rootId` usually names
  a node the export is dropping.

Whatever it drops or corrects, it says so.

The restore drops the table rather than copying into a new one, and that is DynamoDB rather
than a choice: a table's name is fixed at creation, and there is neither a copy nor a rename.
So the only way to end up with the right name is to build that table again — which is what
the seed already does, and why the machinery is shared.

Everything before the drop is a check, and that ordering is the whole safety argument. From
the moment the table goes the file is the only copy, so it is read, parsed and proved
consistent first. A file that fails any check leaves the table exactly as it was. The checks
are the invariants the writes defend one transaction at a time
([writing-to-the-graph.md](writing-to-the-graph.md)), asked of a whole graph at once: both
halves of every edge, degrees matching the edges they count, one live claim per name.

`graph:load` and `graph:restore` each take one file and one flag that stops the run before
anything is written, and they read the command line through one place
([args.ts](../../src/graph/args.ts)). What `--dry-run` is called, and what happens when a
second path arrives, is an agreement between two commands — and holding it twice is two
places for it to drift. The drift would not read as a bug either: a command that has quietly
stopped recognising a flag treats it as a filename.

## The page

[transfer.html](../../web/transfer.html) is its own Vite entry, sharing the stylesheet and
the API client with the map and importing none of its machinery. That sharing is what makes
a second page affordable: what one otherwise costs is every fix made twice, across
stylesheets and boot helpers that were copied once and then drifted. Nothing here draws a
graph.

The way in is two calls, not one. Choosing a file only surveys it; the button that writes
appears once there is something to write. A page needs that preview more than a terminal
does, not less: there is no file on disk to check afterwards and no scrollback saying what
was written.

The plan is not sent back for the write. The server parses and surveys the file again,
because a plan that made the round trip is a plan the page could have edited.

Restoring a JSON export stays a command. Its guard is an environment variable and a rescue
file written next to whoever ran it, and neither survives being turned into a button.

## What has to stay true

**One home for the format's rules.** The separator, the comment character and the star
reading are each a rule the reader and the writer have to agree on. A rule stated twice is a
rule that drifts, and a writer that stopped matching its reader would produce files that load
as a *different graph* rather than as an error.

**A load only ever adds.** No line removes anything. This is what lets it run without a
destructive-mode guard, and what makes running it twice safe.

**Every write goes through the ordinary writes.** Never a batch of whole items — that path
exists only behind dropping the table, which is the one thing a loader must not do.

**A file is ordered by label alone, and carries no date.** Both exist so that export, load
into an empty table, and export again give back the same bytes.

**A name holding the separator or the comment character cannot be written at all.** There is
no escape in this format, and adding one would change what every file already written means.
Nothing rejects those characters when a node is made, so the writer has to refuse — which
means an unwritable name is reachable from the map. Which end to fix that at is open.
Refusing the two characters when a node is made would narrow a write path that has accepted
them since it existed, and nothing anybody wanted has yet been refused.

**A misspelling is a new node, not an error.** The format's real cost, and it cannot be
caught here: nothing matches a name against a near miss. The plan lists every name it would
create, and that listing is the whole defence.

## Where the numbers are

How many writes one request will take, and how much text is accepted at all, in
[server/index.ts](../../src/server/index.ts) — with the arithmetic they were read off. How
many names or faults are printed before the rest become a count, in
[load.ts](../../src/graph/load.ts). What separates names on a line, in
[text.ts](../../src/graph/text.ts).

## Records behind it

| Record | What it settled |
|---|---|
| [0021](../decisions/0021-a-graph-in-a-text-file.md) | The format, the star reading, and that a file is a patch |
| [0022](../decisions/0022-a-graph-written-back-out.md) | The writer, the ordering that makes a round trip checkable, and the open question about the separator and the comment character |
| [0023](../decisions/0023-the-graph-moves-through-the-page.md) | A second page rather than a panel, and two calls for the way in |
| [0017](../decisions/0017-the-second-view-goes.md) | That there is one view, so a second page shares rather than copies |
| [0018](../decisions/0018-the-graph-outlives-the-seed.md) | The JSON export this is deliberately not — and the reckoning a load wants after it |
| [0012](../decisions/0012-the-name-is-the-node.md) | That a node is its name, which is why the file has no ids |

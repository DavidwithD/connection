# A graph as text

A person can write a graph as lines of names, by hand, and load it. The first name on a line
joins each of the other names on that line. That is a star, and a chain is the other reading. So
a hub is one line, and a line of one name is a node with no edges. The label identifies a node,
so the file needs no header and no id column. A load is a *patch*. It only adds, and it uses the
same single-node and single-edge writes as the rest of the app. The writer produces the same
format. Its order lets `diff` check a round trip.

[text.ts](../../web/src/store/text.ts) holds both directions, because they are one format.
[load.ts](../../web/src/store/load.ts) compares a reading against the store and applies it.

## The format

```
# a comment, and a blank line, both say nothing
Thorne                        # a node and no edges — a component of one
Kavara | Miselin | Vessarin   # Kavara joins Miselin, and Kavara joins Vessarin
```

The star reading matches how a person thinks while typing a graph: *this node, and what it
connects to*. It puts a hub on one line. It also gives a line of one name the right meaning: a
component of one node, as in [the-components.md](the-components.md). A chain reading would need
a special case for that. A path is still a path, one line per step.

The file does not show which reading applies. So every preview prints the pairs it read.

## Indenting a line

```
Kavara | Miselin              # Kavara joins Miselin
    Vessarin | Sarn           # Kavara joins Vessarin, and Vessarin joins Sarn
        Sarn | Veyle          # Sarn joins Veyle
```

An indented line hangs from the nearest line above it with a smaller indent. Its first name
joins that line's first name. The rest of the line is an ordinary star. Depth is not limited.

The join stops at the parent. `Sarn | Veyle` above gives Sarn–Veyle. It does not give
Kavara–Veyle.

With indentation, a person types each name once. In a flat file, a node with both a parent and
children is spelled twice. It appears in its parent's list, and again as its own first name.
Nothing here matches a name against a near miss. So a typo in that second spelling makes a
second node.

**The reader indents. The writer never does.** `format` writes a flat star per first name on the
line. A file typed with indentation comes back out flat.

| Rule | Why |
|---|---|
| Any indent step reads | Only *more* and *less* are compared, never a fixed width |
| A ragged column hangs from the next line out | A typed file does not hold its columns, and the preview lists every pair |
| One file uses tabs or spaces, not both | Two styles have no shared column to compare. A fault |
| A blank line and a comment close no block | Both are dropped before the indent is measured |
| An indented first line is a fault | There is no line above it to hang from |
| A child whose first name is its parent is a fault | The store has no self-edges |

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

`parse` is pure. It reads no store. It collects every fault, and it does not stop at the first.
Fixing a hand-typed file one fault at a time would take an afternoon.

`parse` removes duplicate names by their normalised form. It keeps the spelling the file uses
first. The store creates the node under that spelling, and every later line must agree with it.
Normalising folds case and runs of whitespace, and nothing else. So `Kavara` and `kavara` are one
node, and `Zoë` and `Zoe` are two.

`survey` then asks the store which of those names and pairs already exist. It makes one `get`
per name on the store's own key, and one `get` per pair on the edge key. `apply` writes the rest.

A load is deliberately neither of these:

- **Authoritative.** The file is a patch, and it does not describe the whole graph. Deleting a
  line parts no edge. Nothing here removes anything. So a load is the one way into the graph
  that runs without asking first.
- **Its own writer.** Every node goes through `createNode` and every edge through `addEdge`, one
  transaction each. So a load protects `degree` and the name keys the same way the page does
  ([writing-to-the-graph.md](writing-to-the-graph.md)).

A second run of the same file changes nothing. Both writes refuse what already exists. The load
counts those two refusals and raises no error. That is what makes a file editable. So each of
those two messages is an exported constant, defined where it is worded. The load compares against
the constant and does not copy its text.

## Why it is still sequential

The old reason is gone. Every write once made a conditional update on one shared item. Writes
that ran at once competed for it. One then came back as a cancellation that no code could read.
That item is gone. IndexedDB queues overlapping transactions and cancels none of them.

The remaining reason is simpler. A load is a series of ordinary writes, and each must see the
result of the one before. A later line may join to a name that an earlier line created.

A load keeps no request open. So the old cap on how many writes one load could make is gone too.
One limit remains, on how much text the load accepts at all. It guards against a huge paste. It
does not limit the graph.

A load large enough to change where the map starts needs no follow-up step. The app derives the
start node from the component index. Each write records a merge inside the same transaction. So
a finished load already has correct components.

## Writing a file out

`format` is pure over the nodes and edges it receives. So the file holds exactly the chosen
records. `format` makes no second choice about which records are the graph.

Every ordering is by **label**. That once mattered because a reloaded graph came back with new
ids. The name is the id now, so a round trip is stable even without the sort. The sort stays
because any other order would still change when someone reloaded the graph elsewhere.

Nothing in the file is dated. The JSON export writes its own date because it is a backup. This
file is meant to be edited and committed. A date would make every re-export a diff with no change
in it.

The writer writes each pair once, from one end: the node with the higher degree, with ties
broken by name. Both ends would double the file. `a | b` beside `b | a` also reads as two facts.

The `names` shape holds every label and nothing else. The reader still accepts it. Every line is
a single name, so a load creates the nodes and none of the edges. The result is a vocabulary, and
that is the common use of a list of names. So it gets its own shape.

A text export drops degrees and components on purpose. The JSON export is the backup.

## The backup this is not

The JSON export and its import are the other pair. They behave differently on purpose
([store/transfer.ts](../../web/src/store/transfer.ts)).

A subset of a graph may be inconsistent, so an import checks before it writes. Each fault below
looks fine until some code reads the broken record.

- An edge with one end outside the file is dropped. A half-edge names a node that no record holds.
- `degree` is checked against the edges in the file. A count larger than its edges makes a fully
  read node look like it has unread edges.
- A record's `label` must normalise to its own key. Otherwise the node is found under a name it
  does not show. The import path is the most likely way to break this. There, `label` comes from
  a file, and no write produced it.
- The import computes the components from the nodes and edges. It ignores components in the
  file, because a subset has different components from the graph it came from.

An export always holds the whole graph. It used to default to a subset, because a re-seed
dropped the table. The subset chose which nodes would survive it. No code drops a table now,
and no id shape records where a node came from. So no subset is needed.

The file carries a version, which keeps older files readable. The current version writes the
store's own records. The version before it wrote the table's items, keyed by id. Those files are
the only copy of any graph made before this store existed. So the import still reads them. It
builds an id-to-name map from the node items and rewrites the edges through it. That is safe on
any file the old store produced, because the old store enforced one node per name.

## The page

[transfer.html](../../web/transfer.html) is its own Vite entry. It shares the stylesheet and the
store with the map, and imports none of the map's code. That sharing keeps a second page cheap.
Without it, every fix is made twice, in copied stylesheets and boot helpers that change apart over
time. Nothing on this page draws a graph.

This page now holds all data management, because the app has no command line left. It does six
things:

| | What it does | What it replaced |
|---|---|---|
| **Download** | Writes a blob and hands it to the browser | Two `href`s to routes |
| **Add a text file** | Survey, then write on the second click | The same, over HTTP |
| **Import JSON** | Reads a whole graph in, in one transaction | A command that dropped the table |
| **Seed a demo graph** | The generator, behind a button | A command that dropped the table |
| **Check the graph** | Every invariant, over every record | A command's `--check` |
| **Recount the components** | Derives the components from the graph | A command |

A load still takes two clicks. Choosing a file only surveys it. The write button appears once
there is something to write. A reader on a page needs that preview more than in a terminal.
Afterwards there is no file on disk to check, and no scrollback that shows what was written.

The downloads are blobs, and the page links to no route. There is no route to follow. The old
route links were the only paths in the client that no check covered, and they are gone too.

**The page asks before every destructive action, and offers the export first.** Seeding and
importing each replace what is stored. On a command line, the guard was an environment variable
and a rescue file written next to the person who ran it. A button has neither, so the question
to the person is the guard.

## What has to stay true

**The format's rules live in one place.** The separator, the comment character and the star
reading are rules the reader and the writer must share. A rule stated twice can change in one
place only. A writer that no longer matched its reader would produce files that load as a
*different graph*, with no error.

**A load only ever adds.** No line removes anything. So a load runs without asking first, and
the other two ways in must ask.

**The writer never indents.** A graph holds no tree, so `format` has no indentation to choose.
Any rule it invented would re-indent unchanged nodes whenever an edge changed a degree.

**Every text load goes through the ordinary writes.** The bulk path serves only the whole-graph
import, and a patch must never use it.

**A file is ordered by label alone, and carries no date.** Both rules exist so that export, load
into an empty store, and export again give back the same bytes.

**The writer refuses a name that holds the separator or the comment character.** The format has
no escape. Adding one would change the meaning of every file already written. Nothing rejects
those characters when a node is made, so the writer must refuse. So a reader can reach an
unwritable name from the map. Which end should fix that is an open question.

**An import writes everything or nothing.** It uses one transaction. A half-applied graph is
worse than a rejected one. Exceeding the storage quota partway through is how one would happen.

**A misspelling makes a new node, and no error.** That is the format's real cost, and this code
cannot catch it. Nothing matches a name against a near miss. The plan lists every name it would
create, and that list is the only defence.

## Where the numbers are

The limit on how much text a load reads is in [store/index.ts](../../web/src/store/index.ts). It
sits beside the two functions that read it, and it is what remains of the old cap.
[transfer.ts](../../web/src/transfer.ts) holds how many names or faults are listed before the rest
become a count, and what the seed button builds. [text.ts](../../web/src/store/text.ts) holds what
separates names on a line. [storing-a-graph.md](../requirements/storing-a-graph.md) gives what a
whole-graph export costs at the limit.

## Records behind it

| Record | What it decided |
|---|---|
| [0021](../decisions/0021-a-graph-in-a-text-file.md) | The format, the star reading, and that a file is a patch |
| [0046](../decisions/0046-a-line-that-hangs-from-the-line-above.md) | Indentation on the reader, the forgiving column rule, and that the writer stays flat |
| [0022](../decisions/0022-a-graph-written-back-out.md) | The writer, the ordering that makes a round trip checkable, and the open question about the separator and the comment character |
| [0023](../decisions/0023-the-graph-moves-through-the-page.md) | A second page instead of a panel, and two clicks for a load |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | That every way a graph moves is now a button, and the export is the only backup |
| [0017](../decisions/0017-the-second-view-goes.md) | That there is one view, so a second page shares code and copies none |
| [0018](../decisions/0018-the-graph-outlives-the-seed.md) | The JSON export this file is not, and the subset default that went with the id shape |
| [0012](../decisions/0012-the-name-is-the-node.md) | That a node is its name, which is why the file has no ids |

# Moving a graph

**Scope: the demo, not the product.** What a graph has to be able to do to leave the store
and come back. Product scope is still open — see the [README](README.md).

Distinct from [building a graph](building-a-graph.md), which is one write at a time. This is
about a whole graph as a thing you can hold, hand over, and keep.

## Who wants it

Two readers, and they want opposite things from the same capability.

Whoever is typing a graph in. A demo's graph is invented, so anything worth showing anyone
has to be entered. One dialogue per edge is too slow to enter a real graph.

Whoever wants a graph to outlive the store it is in. Seeding replaces what is there. A graph
built by hand over an afternoon is lost to the next seed, unless a copy exists somewhere else first.

## What they cannot do without it

Trust the graph they made. Take a store you can only add to one edge at a time, and only read
through a map. Nobody can see its graph whole, back it up, review it, or hand it to anyone
else. It is real work with no way to keep it.

One property would make the format trustworthy: *a graph written down is the graph you
started with*. Without a writer for the format, nobody can check that property at all.

## The requests

- *Given a graph in the store, write it down* in something a person can read and edit.
- *Given that file, load it back* and get the graph I started with.
- *Given a file I typed by hand, load it* — names, not ids, and no header to get right.
- *Given a file with a mistake in it, tell me before you write anything.* Show what it would
  create, and what it read each line to mean.
- *Given the same file twice, leave one graph* — a second run adds nothing.
- *Given a file too big for one request, say so before I wait for it*, and tell me what to run
  instead.
- *Given a graph I want to keep exactly, give me a backup.* It holds ids, counts and all, not
  just the readable form.
- *Given a name I cannot write down, refuse it. Never write a file that reads back as a
  different graph.*

## How anyone would tell it worked

- Export a graph, load it into an empty store, export again. The two files are byte for byte
  identical — nothing in them changes just because the graph was reloaded.
- Two exports of one unchanged graph are identical, whenever they are taken.
- A file loaded twice leaves the same graph as loading it once, and the second run reports
  everything as already there rather than failing.
- The preview names every node the file would create. Somebody reading it can spot a
  misspelling before it becomes a node.
- The page shows what each line was read to mean before the write. The line itself does not
  show its reading.
- A file a person typed, with comments and blank lines in it, loads without complaint.
- A load stopped partway leaves a valid graph. Running it again finishes the job.
- The readable file and the backup file are clearly different. The backup is the one that
  says it restores everything, and it does.

## Not required

Being authoritative: deleting a line does not part an edge, and nothing about this makes the
store match a file. Merging two versions of a file. Any escape for the characters the format
reserves. Streaming progress while a load runs. Restoring a backup from the page. That guard
is on the machine of whoever runs it.

## Where the design is

[a-graph-as-text.md](../design/a-graph-as-text.md) for the format, both directions, and the
page it moves through. What each write does once a file becomes writes is
[writing-to-the-graph.md](../design/writing-to-the-graph.md).

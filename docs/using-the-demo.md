# Using the demo

What to type and what you will see. This is the fourth question the other three
directories do not answer: [requirements/](requirements/) says what the demo must do,
[design/](design/) says how it works and what must hold, [decisions/](decisions/) says why
it is that way, and this says how to drive it.

Living document, like the two design directories — edited until nothing in it is wrong.

So it holds commands, gestures, keys, and what each one puts on the screen. Where you want
to know *why* something behaves as it does, the link at the end of the paragraph goes to the
design page that answers properly — and that page wins if the two ever disagree.

One exception, stated so nobody hunts for it: `graph:export` and `graph:restore` have no
design page yet, so the paragraphs about them here carry more mechanism than the rest.

## Starting it up

Two pages, backed by the graph API. The map draws the graph. The other draws nothing at all
and is where a graph arrives as a file and leaves as one.

```bash
npm run dev:db          # local DynamoDB + tables
npm run graph:seed      # a small-world graph, sized in src/graph/seed.ts
npm run demo            # the map at :5173
```

Every knob is an environment variable, set on the command that reads it. The defaults, and
what each one costs, are in [seed.ts](../src/graph/seed.ts) and
[index.ts](../src/server/index.ts) — read them there rather than from a second copy here.

| Variable | Sets |
|---|---|
| `GRAPH_N` | How many nodes |
| `GRAPH_K` | How many neighbours each starts with |
| `GRAPH_P` | How often an edge is rewired long-range |
| `GRAPH_SEED` | The generator's seed, so a graph is reproducible |
| `GRAPH_HUBS` | How many nodes are hubs |
| `GRAPH_HUB_K` | How well connected a hub is |
| `GRAPH_ISLANDS` | How many disconnected components — more than one by default, so the page arrives holding graph it cannot walk to |
| `GRAPH_SEED_DROP` | Clears both of the seed's refusals below |
| `GRAPH_RESTORE_DROP` | The same, for `graph:restore` |
| `GRAPH_API_DELAY_MS` | The API's artificial latency floor, so a loading state is visible |
| `PORT` | Moves the API off `:8787` |

`GRAPH_ISLANDS=1` gives one connected graph, which is what you want if the islands panel is
not what you are looking at.

Re-seeding drops the graph table, so it refuses twice: anywhere but the local emulator, and
against a table holding nodes no seed wrote — saving those to a timestamped export before it
stops, so the answer is recoverable even when you meant it.

Two commands write outside the seed, one transaction each
([writing-to-the-graph.md](design/writing-to-the-graph.md)):

```bash
npm run graph:node -- "Vessarin"              # a node with no edges yet
npm run graph:edge -- "Vessarin" "Ashanlin"   # join two that exist
```

## Writing a graph down

One line per node and whoever it joins, in a file you can edit
([ADR 0021](decisions/0021-a-graph-in-a-text-file.md)):

```
# The towns, and a lighthouse nobody can reach
Kavara | Miselin | Vessarin | Thorne
Miselin | Ashanlin
Lighthouse
```

The first name on a line joins each of the rest — `a | b | c` is two edges out of `a`, not a
path through `b` — so a hub is one line, and a line of one name is a node with no edges. The
name is the identity, so nothing carries an id; case and runs of whitespace fold, so
`ashanlin` and `Ashanlin` are the same node. A name cannot hold `|` or `#`. The format's
rules, both directions, are [a-graph-as-text.md](design/a-graph-as-text.md).

```bash
npm run graph:load -- towns.txt --dry-run   # what it would add, written nowhere
npm run graph:load -- towns.txt             # add it
```

It only ever adds: deleting a line does not part an edge, and loading the same file twice
writes nothing the second time. A misspelling is a new node rather than an error, so the
plan prints every name it is about to create — and `--dry-run` prints the pairs it read,
because nothing in the file says whether a line was meant as a star or a chain.

The way back out is the same command that writes the JSON:

```bash
npm run graph:export -- --text    # names and joins → graph-export.txt
npm run graph:export -- --names   # every name, one per line, and no joins
```

Both write the whole graph, whoever made it. Each edge is written from its busier end, so a
hub gathers its neighbours onto one line; a node with no edges gets a line of its own;
islands are paragraphs, largest first. Nothing is ordered by id and nothing is dated, so the
file is stable enough to commit and diff — and the whole trip is checkable:

```bash
npm run graph:export -- --text --out a.txt
npm run ddb:reset && npm run ddb:migrate && npm run graph:init
npm run graph:load -- a.txt
npm run graph:export -- --text --out b.txt   # no diff against a.txt
```

`b.txt` matches `a.txt` though every id in the table changed on the way through.

A text file drops ids, degrees, `rootId` and the index item. A name holding `|` or `#`
cannot be written down at all, and the export refuses rather than writing a file that reads
back as a different graph.

A load runs in series, so expect seconds for a small file locally and minutes for a large
one against AWS. It leaves `rootId` where it was, which is why `npm run graph:init`
afterwards is what moves the map's starting point onto what you just added.

## Starting a graph without seeding one

Every write needs the `graph#index` item, so a table without one refuses the first node as
readily as the ten-thousandth. It also holds `rootId`, which is where the map starts, and
nothing maintains that after a write — so this is what puts it right
([the-islands.md](design/the-islands.md) for what else is derived, and what repairs it).

```bash
npm run graph:init            # write the index item from what is in the table
npm run graph:init -- --check # say what it would write, write nothing, fail if it differs
```

On an empty table that is the bootstrap — no generated nodes needed. On a graph that already
exists it recomputes `rootId` and the counts, which is the repair for a root that was deleted
or a count that drifted. It reads and puts one item; it never drops or deletes, so it is the
one graph command that needs no guard.

## Keeping what you made

A seed run replaces the graph, so anything created since the last one goes with it — but
neither `graph:seed` nor `graph:restore` will let that happen silently. Each reads the table
first, writes whatever no seed wrote to a timestamped export, and then stops. Doing it on
purpose is the two commands below; the guard is for the times you were doing something else.

```bash
npm run graph:export                             # only nodes made by hand → graph-export.json
npm run graph:restore -- graph-export.json --dry-run   # check the file, touch nothing
npm run graph:restore -- graph-export.json       # ⚠️ drop the table, rebuild from the file
```

The export keeps only what no seed wrote, telling the two apart by id shape
([keys.ts](../src/graph/keys.ts)) and refusing an id of neither shape rather than guessing. A
subset of a graph is not automatically a graph, so it drops edges with one end outside the
export, drops claims on names not coming, and rewrites `degree` to match what it kept —
saying so each time.

Restoring drops the table and builds it again. Every check runs *before* the drop — both
halves of every edge, degrees matching the edges they count, one live claim per name — so a
file that fails any of them leaves the table exactly as it was, and `--dry-run` stops after
the checks. Like the seed, it refuses to drop anything but the local emulator unless
`GRAPH_RESTORE_DROP=1` says otherwise
([ADR 0018](decisions/0018-the-graph-outlives-the-seed.md)).

What every write refuses, and what can be taken back, is
[writing-to-the-graph.md](design/writing-to-the-graph.md). The map page does all of it from
the browser — see **The map** below.

## The map — `/`

Pan around an undirected cyclic graph like a map. Whatever you stop on is what loads.

| Gesture | Does |
|---|---|
| drag | Pan |
| wheel | Zoom toward the cursor |
| click a node | Glide it to the middle |
| click a ghost | Fly to the node it stands in for |
| right-click the centre | Take it off the map, with everything joined to it |
| click under **islands** | Cross to a component, or go back to one you crossed to before |
| `↑↓←→` | Nudge the view |
| `/` | Put the caret in the box at the top, whatever the focus was on |

The node nearest the middle of the screen is the **centre**, which is what gliding a node to
the middle is for. It is the only node the map draws around, so what you see is the route you
walked — and nothing already on screen ever moves on its own. Panning does no work either:
the next read waits for the camera to go still. What the map draws around the centre, and why
none of it moves, is [the-centre.md](design/the-centre.md).

Which is why **islands** exists. A graph in pieces has components no walk from here can
reach, however long you look — and a node you make is one until you join it to something. The
list is every component, biggest first.

Rows do not leave when you use them, so crossing back is a click rather than a name typed
from memory. The marked row is the island you are standing in. A dim one is not on the map
yet: clicking it seats a whole island that was never there, while clicking any other row only
moves the camera. The list changes only when the graph's components do — a join, a split, or a
node made from the box at the top.

The list is a page of twenty and says which page it is: the heading reads `20 of 267` until it
holds them all, and scrolling to the foot fetches the next twenty. How that index is built,
and what repairs it, is [the-islands.md](design/the-islands.md).

The box at the top is one box until you name something in it, and then it is an edge: two
ends and the line between them. Naming a node takes you there. Name one in the other end and
they are joined — either end, since the graph has no direction to tell them apart. Whichever
end you leave alone is the anchor, so the same widget fans out from one node or fans in to
one, and the end you fired empties for the next name.

| Key | In an end |
|---|---|
| `↑` `↓` | Move the highlight, wrapping at both ends |
| `↵` | Take the highlighted row — with the other end filled, that writes the edge |
| `⇧↵` | Create exactly what is typed, whatever the list shows |
| `⌘↵` | Either of those, and go on from the name it just wrote |
| `Tab` | Cross to the other end |
| `Esc` | Close the list; again, put the widget away and let the focus go |

`↵` takes the best match, so a prefix and one key reaches a node that already exists; `⇧↵`
always creates, whatever the list shows. A name matching nothing is the one case where `↵`
creates too. Why the two are separate keys is
[finding-a-node.md](design/finding-a-node.md).

`⌘` rides on either of them, and changes what happens after the write rather than what is
written: the name just fired takes the *other* end, so the caret stays where it is and the
next name joins to that one. What it costs is the anchor you were fanning from, which the
moving one replaces. Ctrl does the same on a keyboard with no ⌘ to hold; over a row you
click it is ⌘ alone, since Control-click is the other mouse button on a Mac.

A path is then one name per node. `Kavara` `↵` arms the near end, `Tab` crosses to the far
one, and the rest — `Corwen` `⌘↵`, `Thessa` `⌘↵` — runs without the caret moving again.

`Esc` collapses the whole widget, not just the end you are in — both names go, the far end
with them, and the focus is handed back to the map. It is the way out, and `/` is the way
back in.

**Every write from the box can be taken back.** Each leaves a receipt carrying `undo`, which
parts the edge and deletes the node if that write is what created it. It stays for thirty
seconds. A node something else has since been joined to is kept, and the edge still parts.

A receipt names both ends, and clicking either name puts it back in the near end. That is the
way back to a write that has scrolled away, where `⌘↵` carries only the one just fired.
Clicking loads and never writes.

Taking a node off the map is the one write with no way back, since its edges cannot return
with it. So it asks first rather than offering an undo after, and the row it asks with names
what is going — `delete Ashanlin and its 3 edges`. It is offered on the centre alone.

The layers behind all of this are [architecture.md](design/architecture.md); the reasoning and
what each choice cost are [ADR 0003](decisions/0003-graph-exploration-demo-stack.md),
[ADR 0004](decisions/0004-the-centre-and-its-neighbourhood.md) and
[ADR 0006](decisions/0006-only-the-centre-reads.md).

## Graph files — `/transfer.html`

Linked from the foot of the map. Downloads first — the whole graph as names and joins, as
names alone, or as the JSON `graph:restore` reads — then the way in.

Choosing a file does not write it. It is surveyed against the table and the reading is shown
back: three numbers, and under them every new name and every pair it read. Those pairs are
the point, for the reason **Writing a graph down** gives above. **Add to the graph** appears
once there is something to add.

A file with a fault in it — a name joined to itself, an empty field — is refused whole, and
the faults are what the page shows instead of the numbers. A file the graph already holds
says so and offers no button.

Two things it will not do. Restoring a JSON export stays `npm run graph:restore`, because
what guards that command cannot be carried onto a page
([ADR 0023](decisions/0023-the-graph-moves-through-the-page.md)). A load past what one
request will hold is refused, naming `npm run graph:load`, which has no ceiling because
nothing is waiting on a socket.

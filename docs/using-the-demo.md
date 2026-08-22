# Using the demo

What to type and what you will see. This is the fourth question the other three directories
do not answer: [requirements/](requirements/) says what the demo must do, [design/](design/)
says how it works and what must hold, [decisions/](decisions/) says why it is that way, and
this says how to drive it.

Living document, like the two design directories — edited until nothing in it is wrong.

So it holds commands, gestures, keys, and what each one puts on the screen. Where you want to
know *why* something behaves as it does, the link at the end of the paragraph goes to the
design page that answers properly — and that page wins if the two ever disagree.

## Starting it up

```bash
npm install
npm run web             # both pages at :5173
```

That is the whole of it. There is no database to start, no API to run, and nothing to seed
before the page will open — the graph lives in the browser
([0030](decisions/0030-the-graph-moves-into-the-browser.md)).

Two pages. The map draws the graph. The other draws nothing at all, and is where a graph
arrives as a file, leaves as one, and is seeded, checked and repaired.

**A fresh browser holds no graph.** The map says so and points at the transfer page, where
**Seed a demo graph** gives you something to walk around.

## Where the graph lives, and how to lose it

In this browser profile, and nowhere else. That is worth reading twice:

- Clearing site data for the origin destroys the graph, and the map's settings with it.
- A different browser, a different profile, or a private window is a different graph.
- The browser may evict it under storage pressure. The page asks it not to at boot, which is
  a request rather than a promise.

**The download on the transfer page is the only backup there is.** Take one before you do
anything you would mind repeating. What that costs, and why there is no mitigation for it, is
[storing-a-graph.md](requirements/storing-a-graph.md).

One tab at a time. Two tabs will not corrupt anything — the store serialises writes — but
neither is told when the other writes, so the second one drifts until you reload it.

## The map — `/`

Pan around an undirected cyclic graph like a map. Whatever you click is what loads.

| Gesture | Does |
|---|---|
| drag | Pan |
| wheel | Zoom toward the cursor |
| hover a node | Show its name, until you point at something else |
| click a node | Make it the centre, where it stands, and copy its name. Nothing moves |
| click the centre | Put its name in the box at the top |
| click a ghost | Copy the name it stands for, and fly to that node |
| right-click the centre | Rename it, or take it off the map with everything joined to it |
| right-click a line into the centre | Part the two nodes it joins. A ghost's dashed line counts |
| shift-drag between two nodes | Join them. A ghost counts as the node it names |
| click under **islands** | Cross to a component, or go back to one you crossed to before |
| `↑↓←→` | Nudge the view |
| **Recentre** | Go back to the centre, wherever the panning left it |
| **walk by pan** | Tick it, and panning hands the centre to whatever it passes |
| `/` | Put the caret in the box at the top, whatever the focus was on |

Whatever you click becomes the **centre**, where it stands. The map does not jump, and its
neighbours draw around the node wherever it sits. A drag only changes what is on screen, and the
centre stays the centre however far you go. It is the only node the map draws around, so what
you see is the route you walked and nothing besides: drift adds nothing, and nothing already on
screen ever moves on its own.

So the centre can end up near an edge, or off it. Click near a border and some of its ring lands
outside the frame. **Recentre** brings the centre to the middle, and clicking anything you can
see is the way on. A search hit, an island row and a doorway all take you to their node instead.
What the map draws around the centre, and why none of it moves, is
[the-centre.md](design/the-centre.md).

**Every click on a node copies its name to the clipboard.** A ghost copies the name it stands
for, before it flies. Nothing is said when it works, because the name you clicked is the name
you get. The first refusal reads *could not copy …* on the status line, and every refusal after
it is silent ([ADR 0039](decisions/0039-any-nodes-name-on-the-clipboard.md)).

**walk by pan** is the box under the numbers, and it hands the centre back to the camera. Tick
it and the node nearest the middle takes the centre as you drag. A sweep across a region then
fills it in without your choosing a route. Every node the middle crosses is placed for good.
Unticking the box does not take them off again — the map keeps what the panning drew. The box is
remembered for this browser, so a session that starts ticked stays ticked.

A walk from the centre reaches only what the graph joins to it, which is why **islands** exists.
A graph in pieces has components no walk from here can reach, however long you look — and a node
you make is one until you join it to something. The list is every component, biggest first.

Rows do not leave when you use them, so crossing back is a click rather than a name typed from
memory. The marked row is the island you are standing in. A dim one is not on the map yet:
clicking it seats a whole island that was never there, while clicking any other row only moves
the camera. The list changes only when the graph's components do — a join, a split, or a node
made from the box at the top.

The list is a page of twenty and says which page it is: the heading reads `20 of 267` until it
holds them all, and scrolling to the foot fetches the next twenty. How that index is built,
and what repairs it, is [the-islands.md](design/the-islands.md).

A join now updates the list immediately. A part is allowed to be a moment behind, and
**Recount the islands** on the transfer page is what finishes it if it is.

The box at the top is one box until you name something in it, and then it is an edge: two ends
and the line between them. Naming a node takes you there. Name one in the other end and they
are joined — either end, since the graph has no direction to tell them apart. Whichever end you
leave alone is the anchor, so the same widget fans out from one node or fans in to one, and the
end you fired empties for the next name.

| Key | In an end |
|---|---|
| `↑` `↓` | Move the highlight, wrapping at both ends |
| `↵` | Take the highlighted row — with the other end filled, that writes the edge |
| `⇧↵` | Create exactly what is typed — or take it, if a node already carries that name |
| `⌘↵` | Either of those, and go on from the name it just wrote |
| `Tab` | Cross to the other end |
| `Esc` | Close the list; again, put the widget away and let the focus go |

`↵` takes the best match, so a prefix and one key reaches a node that already exists; `⇧↵`
creates instead, whatever else the list shows. They agree at both ends of that: a name matching
nothing is created by either, and a name that already exists is taken by either — the graph
holds one node per name, so there is no second one to make. Why they are separate keys at all
is [finding-a-node.md](design/finding-a-node.md).

The box answers as fast as you type. It used to wait a moment before asking, because each
keystroke was a request; a search is a key range over the store now, so there is nothing to
space out.

Names fold case and runs of whitespace, so `ashanlin` and `Ashanlin` are one node — and
creating the second is refused with *that name is taken*. Accents do not fold: `Zoë` and `Zoe`
are two nodes.

`⌘` rides on either of them, and changes what happens after the write rather than what is
written: the name just fired takes the *other* end, so the caret stays where it is and the next
name joins to that one. What it costs is the anchor you were fanning from, which the moving one
replaces. Ctrl does the same on a keyboard with no ⌘ to hold; over a row you click it is ⌘
alone, since Control-click is the other mouse button on a Mac.

A path is then one name per node. `Kavara` `↵` arms the near end, `Tab` crosses to the far one,
and the rest — `Corwen` `⌘↵`, `Thessa` `⌘↵` — runs without the caret moving again.

The map is the other way to fill an end. Click the centre and its name lands in the near end,
over whatever that end held. The far end is emptied, so the panel holds one name after a click.
The click writes nothing to the graph, and the map does not move. An edge still comes from the
far end: type a name into it and press `↵`.

The caret goes into the far end, so the arrows stop panning until `Esc` returns the focus to
the map ([ADR 0036](decisions/0036-a-click-that-writes-nothing.md)).

`Esc` collapses the whole widget, not just the end you are in — both names go, the far end with
them, and the focus is handed back to the map. It is the way out, and `/` is the way back in.

**Every write from the box can be taken back.** Each leaves a receipt carrying `undo`, which
parts the edge and deletes the node if that write is what created it. It stays for thirty
seconds. A node something else has since been joined to is kept, and the edge still parts.

A receipt names both ends, and clicking either name puts it back in the near end. That is the
way back to a write that has scrolled away, where `⌘↵` carries only the one just fired.
Clicking loads and never writes.

**Shift-drag between two nodes to join them.** Press on one with shift held, drag to the other,
and let go. An arrow follows the cursor while the button is down, and the node a release would
take draws a ring. Letting go anywhere else writes nothing. The write lands on the release and
its receipt carries the undo, the way the box above does
([ADR 0038](decisions/0038-a-drag-that-joins-two-nodes.md)). A ghost counts as the node it
names, at either end.

Both nodes have to be on screen when the drag starts, and one too far to see is joined from
the box above. A map that has just opened draws one ring, so every node on it is joined to the
centre already. Walk a step first, and the ring left behind is what the drag has to aim at.

Taking a node off the map is the one write with no way back, since its edges cannot return with
it. So it asks first rather than offering an undo after, and the row it asks with names what is
going — `delete Ashanlin and its 3 edges`. It is offered on the centre alone.

**The same menu renames it.** The other row reads `edit Ashanlin`, and clicking it puts a text
box where that row was. Type a name and press `↵`. The node keeps its position, its edges and
its degree, and every neighbour keeps its own.

Under the box is one row, and it is the button as well as the answer. `↻ update` means the name
is free, and `↵` takes it the way `↵` takes a row in the box at the top. `is taken` means a node
already carries that name, and then nothing fires — the refusal is shown before the write rather
than after it. A name differing from the node's own only in case is allowed, so `ashanlin` can
become `Ashanlin`.

A rename is reversible, so it writes on the key and puts `undo` on its receipt. That undo is
refused if something has claimed the old name since. Panning closes the box and writes nothing,
as it closes the menu ([ADR 0040](decisions/0040-a-node-under-a-new-name.md)).

**The same right-click parts a pair.** Aim it at a line reaching the centre instead of at the
centre, and the row reads `part Ashanlin and Vere`. Both nodes stay, so this one writes on the
click and puts `undo` on its receipt, the way the box above does
([ADR 0031](decisions/0031-parting-an-edge-from-the-map.md)). A ghost's dashed line is the same
gesture: it stands for the edge between the centre and the node it names.

A join too long to draw runs as two short marks instead of a line. Rest the pointer on one and
the whole line appears, from one node to the other. It stays while the pointer is on it, so
right-click parts that pair like any other line ([ADR 0041](decisions/0041-a-stub-that-opens.md)).
A dot is 7 pixels wide, so aim at the dash running out of the node rather than the dot itself.

The layers behind all of this are [architecture.md](design/architecture.md); the reasoning and
what each choice cost are [ADR 0003](decisions/0003-graph-exploration-demo-stack.md),
[ADR 0004](decisions/0004-the-centre-and-its-neighbourhood.md) and
[ADR 0006](decisions/0006-only-the-centre-reads.md).

## Graph files — `/transfer.html`

Linked from the foot of the map. Everything that moves, replaces, or repairs a whole graph
happens here, because there is no command line left to hold it
([a-graph-as-text.md](design/a-graph-as-text.md)).

### Taking a graph out

Three downloads, each the whole graph:

| | What it writes |
|---|---|
| **Names & joins** | `.txt` — one line per node and whoever it joins. Editable |
| **Names only** | `.txt` — every name, one per line, and no joins |
| **Backup** | `.json` — everything, and the only file that puts a graph back exactly |

Nothing is ordered by anything that changes when a graph is reloaded, and nothing is dated, so
a text file is stable enough to commit and diff. A name holding `|` or `#` cannot be written
down at all, and the download refuses rather than writing a file that reads back as a different
graph.

### Writing a graph down

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
name is the identity, so nothing carries an id. The format's rules, both directions, are
[a-graph-as-text.md](design/a-graph-as-text.md).

Choosing a file does not write it. It is surveyed against the graph and the reading is shown
back: three numbers, and under them every new name and every pair it read. Those pairs are the
point — nothing in the file says whether a line was meant as a star or a chain. **Add to the
graph** appears once there is something to add.

It only ever adds: deleting a line does not part an edge, and loading the same file twice
writes nothing the second time. A misspelling is a new node rather than an error, which is why
every name it is about to create is listed.

A file with a fault in it — a name joined to itself, an empty field — is refused whole, and the
faults are what the page shows instead of the numbers. A file the graph already holds says so
and offers no button.

Half the round trip is checkable without leaving the page: download **Names & joins**, then
choose that same file. The page reads every line back and says the graph already holds all of
it, which is the writer and the reader agreeing on every name and every pair. Checking the other
half — that a file rebuilds the graph it came from — needs an empty graph to load into, and
nothing here empties one. **Backup** and **Import JSON** are what put a graph back exactly.

### The four buttons that act on the whole graph

The first two replace what is stored, so each asks before it runs and offers the download in the
same breath. On a command line that guard was an environment variable and a rescue file; a
button inherits neither, so the asking *is* the guard. The last two ask nothing: one writes
nothing at all, and the other writes only what it derived from the graph in front of it.

| | Does |
|---|---|
| **Import JSON** | Reads a backup back in, replacing what is stored. One transaction — it lands whole or not at all |
| **Seed a demo graph** | Writes a generated small-world graph, replacing what is stored ([the-generated-graph.md](design/the-generated-graph.md)) |
| **Check the graph** | Reads every record and reports what disagrees. Writes nothing |
| **Recount the islands** | Derives the components from the nodes and edges themselves |

**Check the graph** is the one to reach for when something looks wrong. It compares every
node's stored degree against the edges it actually has, every record's name against the key it
is filed under, and every edge against the nodes at its ends.

**Recount the islands** is the repair for the one thing that is allowed to lag. Parting an edge
may split a component, and working out what it split into is a walk — so it happens after the
write and can be cut short. If the islands panel lists something that is not there, or misses
something that is, this is what fixes it. A join never needs it.

An old backup still reads. Files written before the graph moved into the browser key their
edges by id, and the import translates those to names on the way in.

## When something goes wrong

| What you see | What it means |
|---|---|
| *that name is taken* | One node per name, and case does not distinguish two |
| *they are already joined* | The edge is there; a second one would be the same edge |
| *a node cannot be joined to itself* | The graph has no self-edges |
| *no such node, or it still has edges* | Undo will not remove a node something else was joined to since |
| *there is not enough room…* | The browser's storage quota. Nothing was written |
| *another tab has this graph open…* | Close the other tab and reload this one |
| *this browser will not store a graph here* | Private browsing, or storage switched off |

The first four are the graph declining, and the page carries on. The last three are the store
being unable to answer at all, which is a different thing and says so
([architecture.md](design/architecture.md#when-the-store-itself-fails)).

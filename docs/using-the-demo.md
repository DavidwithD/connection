# Using the demo

What to type and what you will see. The other three directories leave one question open.
[requirements/](requirements/) says what the demo must do. [design/](design/) says how it
works and what must hold. [decisions/](decisions/) says why it is that way. This page says how
to drive it.

This is a living document, like the two design directories. It is edited until nothing in it
is wrong.

So it holds commands, gestures, keys, and what each one puts on the screen. A paragraph may end
with a link to a design page. That page explains *why* the demo behaves as it does. If the two
ever disagree, the design page is correct.

## Starting it up

```bash
npm install
npm run web             # all three pages at :5173
```

That is all. There is no database to start, no API to run, and nothing to seed before the page
opens. The graph is stored in the browser
([0030](decisions/0030-the-graph-moves-into-the-browser.md)).

There are three pages. The map draws the graph. The node list names every node at once, and
walks from one to its neighbours. The transfer page draws nothing. It loads a graph from a
file, writes one to a file, and seeds, checks and repairs the graph.

**A fresh browser holds no graph.** The map says so and links to the transfer page. There,
**Seed a demo graph** gives you something to walk around.

## Where the graph lives, and how to lose it

The graph is in this browser profile, and nowhere else. That is worth reading twice:

- Clearing site data for the origin destroys the graph, and the map's settings with it.
- A different browser, a different profile, or a private window is a different graph.
- The browser may evict it under storage pressure. The page asks it not to at boot. That is a
  request, and the browser makes no promise.

**The download on the transfer page is the only backup there is.** Take one before you do
anything you would mind repeating. [storing-a-graph.md](requirements/storing-a-graph.md) says
what that costs, and why nothing mitigates it.

Use one tab at a time. Two tabs will not corrupt anything, because the store serialises writes.
But neither tab learns when the other writes. So the second tab shows an old graph until you
reload it.

## The map — `/`

Pan around an undirected cyclic graph like a map. The map loads the nodes you click.

| Gesture | Does |
|---|---|
| drag | Pan |
| wheel | Zoom toward the cursor |
| hover a node | Show its name, until you point at something else |
| click a node | Select it where it stands, and copy its name. No node moves |
| click an off-screen marker | Copy the name it stands for, and move the camera to that node |
| right-click the selected node | Rename it, or take it off the map with every edge it has |
| right-click a line to the selected node | Part its two nodes. An off-screen marker's line counts |
| shift-drag between two nodes | Join them. An off-screen marker counts as the node it names |
| click the **components** tab | Open the component list at the left edge, or close it |
| click a row in it | Go to a component, or go back to one you went to before |
| click **guide** | Open the settings, the legend and the keys, in one panel at the bottom right |
| `↑↓←→` | Nudge the view |
| **Go to selected** | Move the camera back to the selected node, wherever the panning left it |
| **walk by pan** | In the guide. When ticked, panning selects the node nearest the middle |
| `/` | Put the caret in the box at the top, whatever the focus was on |
| `?` | Open the guide, or close it. `Esc` and a click outside close it too |

The map at rest shows four controls: the name box, the zoom buttons, the **components** tab and
the **guide** button. Everything else is behind one of the last two
([0041](decisions/0041-the-controls-come-off-the-map.md)). The side panel starts closed the
first time. After that it remembers how you left it. The guide starts closed every time.

The node you click becomes the **selected node**, where it stands. The camera stays still, and
the map draws the node's neighbours around it wherever it sits. A drag only changes what is on
screen. The selected node stays selected however far you pan. The map draws neighbours around
the selected node only. So the map shows the route you walked and nothing else. Panning adds
no nodes, and the map never moves a node that is already on screen.

So the selected node can end up near the edge of the screen, or off it. Click near a border
and some of its neighbours are placed outside the frame. **Go to selected** moves the camera
back to the selected node. To go on, click any node you can see. A search hit, a component row
and an off-screen marker each move the camera to their node.
[the-centre.md](design/the-centre.md) says what the map draws around the selected node, and why
none of it moves.

**Every click on a node copies its name to the clipboard.** A click on an off-screen marker
copies the name it stands for, before the camera moves. The page shows nothing when the copy
works, because the name you clicked is the name you get. The first refusal shows *could not
copy …* on the status line. The page shows nothing for later refusals
([ADR 0039](decisions/0039-any-nodes-name-on-the-clipboard.md)).

**walk by pan** is the first box in the guide. When it is ticked, the camera position sets the
selected node. As you drag, the node nearest the middle of the screen becomes the selected
node. A sweep across a region then fills it in, and you choose no route. Every node the middle
crosses stays placed. Those nodes stay on the map after you untick the box. The browser
remembers the box, so a session that starts ticked stays ticked.

A walk from the selected node reaches only the nodes the graph joins to it. That is why the
**components** tab exists. A graph in pieces has components no walk from here can reach. A node
you make is such a component until you join it to something. The list shows every component,
largest first.

A row stays after you use it, so going back is a click and needs no name typed from memory. The
marked row is the component the map is in. A dim row is not on the map yet. Clicking it places a
whole component in an empty area. Clicking any other row only moves the camera. The list changes
only when the graph's components change: on a join, a split, or a node made from the box at the
top.

The list shows twenty rows at a time and says how many it holds. The heading reads `20 of 267`
until it holds them all. Scrolling to the foot fetches the next twenty.
[the-components.md](design/the-components.md) says how that index is built, and what repairs it.

A join updates the list immediately. A part may leave it a moment behind. If it does,
**Recount the components** on the transfer page corrects it.

The box at the top is one input until you name a node in it. Then it shows two ends and the line
between them. Naming a node moves the camera there. Name a node in the other end and the two are
joined. Either end works, since the graph has no direction. The end you leave alone keeps the
start name. So one widget joins many nodes to one node. The end you submitted empties for the
next name.

| Key | In an end |
|---|---|
| `↑` `↓` | Move the highlight, wrapping at both ends |
| `↵` | Take the highlighted row. With the other end filled, that writes the edge |
| `⇧↵` | Create exactly what is typed, or take it if a node already has that name |
| `⌘↵` | Either of those, and go on from the name it just wrote |
| `Tab` | Move to the other end |
| `Esc` | Close the list. Press again to close the widget and release the focus |

`↵` takes the best match, so a prefix and one key reaches a node that already exists. `⇧↵`
creates the typed name, whatever else the list shows. Both keys act the same at the two extremes.
Either key creates a name that matches nothing. Either key takes a name that already exists. The
graph holds one node per name, so there is no second one to make.
[finding-a-node.md](design/finding-a-node.md) says why they are separate keys at all.

The box answers as fast as you type. It used to wait a moment before asking, because each
keystroke was a request. A search is now a key range over the store, so no delay is needed.

Names fold case and runs of whitespace, so `ashanlin` and `Ashanlin` are one node. The box
refuses to create the second, with *that name is taken*. Accents do not fold: `Zoë` and `Zoe`
are two nodes.

`⌘` works with either key. It changes what happens after the write, and leaves the write itself
as it was. The name you just submitted moves to the *other* end. So the caret stays where it is,
and the next name joins to that one. The cost is the start name you were joining from. The new
name replaces it. Ctrl does the same on a keyboard with no ⌘. On a row you click, only ⌘ works.
Control-click is the other mouse button on a Mac.

A path is then one name per node. `Kavara` `↵` fills the near end, and `Tab` moves to the far
one. The rest, `Corwen` `⌘↵` and `Thessa` `⌘↵`, needs no further caret moves.

`Esc` closes the whole widget, including the end you are not in. Both names go, and the focus
returns to the map. `Esc` is the way out, and `/` is the way back in.

**Every write from the box can be undone.** Each write adds a write log entry with `undo`. The
undo parts the edge, and deletes the node if that write created it. The entry stays for thirty
seconds. The undo keeps a node that something else has been joined to since, and still parts the
edge.

A write log entry names both ends. Clicking either name puts it back in the near end. That is
the way back to a write that has scrolled away. `⌘↵` carries only the name just submitted.
Clicking a name loads it and writes nothing.

**Shift-drag between two nodes to join them.** Press on one with shift held, drag to the other,
and let go. An arrow follows the cursor while the button is down. The drop target draws an
outline. Letting go anywhere else writes nothing. The release writes the edge. Its write log
entry carries the undo, as the box above does
([ADR 0038](decisions/0038-a-drag-that-joins-two-nodes.md)). An off-screen marker counts as the
node it names, at either end.

Both nodes have to be on screen when the drag starts. Join a node too far to see from the box
above. A map that has just opened draws one set of neighbours. So every node on it is already
joined to the selected node. Walk a step first. The neighbours of the old selected node are then
the nodes to drag to.

Taking a node off the map is the one write with no undo, because its edges cannot return with
it. So the menu asks first, where other writes offer an undo after. The menu row names what will
go: `delete Ashanlin and its 3 edges`. Only the selected node offers it.

**The same menu renames it.** The other row reads `edit Ashanlin`. Clicking it puts a text box
where that row was. Type a name and press `↵`. The node keeps its position, its edges and its
degree, and every neighbour keeps its own.

Under the box is one row. It is both the button and the answer. `↻ update` means the name is
free. `↵` then takes it, as `↵` takes a row in the box at the top. `is taken` means a node
already has that name. Then `↵` does nothing, and the refusal shows before any write. A name
that differs from the node's own only in case is allowed. So `ashanlin` can become `Ashanlin`.

A rename can be undone. So it writes on the key and puts `undo` on its write log entry. The undo
is refused if another node has taken the old name since. Panning closes the box and writes
nothing, as it closes the menu ([ADR 0040](decisions/0040-a-node-under-a-new-name.md)).

**The same right-click parts a pair.** Right-click a line to the selected node instead of the
node itself. The menu row reads `part Ashanlin and Vere`. Both nodes stay. So this write happens
on the click and puts `undo` on its write log entry, as the box above does
([ADR 0031](decisions/0031-parting-an-edge-from-the-map.md)). An off-screen marker's dashed line
works the same way. It stands for the edge between the selected node and the node it names.

One edge cannot be parted this way. The map draws an edge too long to draw as two stubs. A stub
does not take a right-click. Pan until the far end is off screen. Its off-screen marker's line
can then be right-clicked like any other line.

[architecture.md](design/architecture.md) describes the layers behind all of this.
[ADR 0003](decisions/0003-graph-exploration-demo-stack.md),
[ADR 0004](decisions/0004-the-centre-and-its-neighbourhood.md) and
[ADR 0006](decisions/0006-only-the-centre-reads.md) give the reasons and what each choice cost.

## The node list — `/nodes.html`

The guide on the map links to it. It shows every node the store holds, as rows you can search,
order and page through. The map answers "what is around this node". This page answers "what is
in the graph at all".

| Control | What it does |
|---|---|
| **search names** | Keeps a row whose name contains what you typed, spacing and case ignored |
| **order** | By name, by date newest first, or at random. **shuffle** re-rolls the random one |
| **made … to …** | Keeps a row written in that range of days. Either end can be left empty |
| **per page** | 25, 50 or 100 rows |
| **clear** | Back to every node, by name, on the first page |
| **previous**, **next** | Turns the page. A new page starts at the top of the list |

**Click a row** to open its neighbours under it. Click it again to close them. One row is open
at a time.

**Click a neighbour** and one of two things happens. A neighbour in the rows on this page opens
in place. The row you were in closes, and that node's row opens. The list scrolls to that row if
it is off the screen. A neighbour not on this page opens as a card over the row you came from.
The card is offset to the right. So the row you came from still shows as a covered-card edge at
the left. The card lists the node's neighbours. Walking on adds another card to the card stack,
and each card is a different colour.

**Click a covered-card edge** to go back to that node. The first card goes back to the list, on
whatever page holds it. The list comes back at the offset you left it on. It comes back at the
top if the page has changed since.

**A long name wraps.** The row grows to hold it, and so does the card on top of a stack.

**The dates come from the record.** Every node stored before
[ADR 0044](decisions/0044-the-node-record-carries-a-date.md) carries the date of that upgrade.
So a graph seeded or loaded before then shows one date for every node. The date order is useful
only once newer nodes exist.

The read time next to the pager covers the whole store. This page holds every node in memory.
No index in the store answers a substring, a date range or a shuffle
([architecture.md](design/architecture.md)). `npm run drive:nodes` drives the page in a real
browser and checks each of these.

## Graph files — `/transfer.html`

The foot of the map links to it. Every action that moves, replaces or repairs a whole graph is
on this page. No command line is left to hold them
([a-graph-as-text.md](design/a-graph-as-text.md)).

### Taking a graph out

Three downloads, each the whole graph:

| | What it writes |
|---|---|
| **Names & joins** | `.txt` — one line per node and the nodes it joins. Editable |
| **Names only** | `.txt` — every name, one per line, and no joins |
| **Backup** | `.json` — everything, and the only file that restores a graph exactly |

The order in the file never depends on anything that changes when a graph is reloaded. The file
has no dates. So a text file is stable enough to commit and diff. A name that holds `|` or `#`
cannot be written in this format. The download refuses it. A file with it would read back as a
different graph.

### Writing a graph down

One line per node and the nodes it joins, in a file you can edit
([ADR 0021](decisions/0021-a-graph-in-a-text-file.md)):

```
# The towns, and a lighthouse nobody can reach
Kavara | Miselin | Vessarin | Thorne
Miselin | Ashanlin
Lighthouse
```

The first name on a line joins each of the rest. `a | b | c` is two edges from `a`, and no path
through `b`. So a hub is one line, and a line of one name is a node with no edges. The name is
the identity, so no line carries an id. [a-graph-as-text.md](design/a-graph-as-text.md) gives
the format's rules in both directions.

An indented line belongs to the line above it. Its first name joins that line's first name.
Here is the same graph, with `Miselin` typed once:

```
# The towns, and a lighthouse nobody can reach
Kavara | Vessarin | Thorne
    Miselin | Ashanlin
Lighthouse
```

Depth has no limit, and any indent step reads. One file uses tabs or spaces, not both. The
download never indents, so a file typed this way comes back flat
([ADR 0046](decisions/0046-a-line-that-hangs-from-the-line-above.md)).

Choosing a file does not write it. The page compares it with the graph and shows the result:
three numbers, and under them every new name and every pair it read. The pairs matter most. The
file cannot say whether a line was meant as a star or a chain. **Add to the graph** appears once
there is something to add.

It only adds. Deleting a line does not part an edge. Loading the same file twice writes nothing
the second time. A misspelling becomes a new node and raises no error. That is why the page lists
every name it is about to create.

The page refuses a file with a fault in it, such as a name joined to itself or an empty field.
It refuses the whole file and shows the faults instead of the numbers. For a file the graph
already holds, the page says so and offers no button.

You can check half the round trip on this page. Download **Names & joins**, then choose that same
file. The page reads every line back and says the graph already holds all of it. That shows the
writer and the reader agree on every name and every pair. The other half is that a file rebuilds
the graph it came from. Checking it needs an empty graph to load into, and this page cannot empty
one. **Backup** and **Import JSON** restore a graph exactly.

### The four buttons that act on the whole graph

The first two replace what is stored. So each asks before it runs, and offers the download in
the same prompt. On a command line, an environment variable and a rescue file guarded that. A
button has neither, so the prompt is the guard. The last two ask nothing. One writes nothing at
all. The other writes only what it derived from the current graph.

| | Does |
|---|---|
| **Import JSON** | Reads a backup back in, replacing what is stored. One transaction — it lands whole or not at all |
| **Seed a demo graph** | Writes a generated small-world graph, replacing what is stored ([the-generated-graph.md](design/the-generated-graph.md)) |
| **Check the graph** | Reads every record and reports what disagrees. Writes nothing |
| **Recount the components** | Derives the components from the nodes and edges themselves |

Use **Check the graph** when something looks wrong. It compares each node's stored degree with
the edges it has. It compares each record's name with the key it is stored under. It checks each
edge against the nodes at its ends.

**Recount the components** repairs the one thing that is allowed to lag. Parting an edge may split
a component. Finding the new components takes a walk. So it happens after the write and can be
cut short. The side panel may then list a component that is gone, or miss one that exists. This
button fixes that. A join never needs it.

An old backup still reads. Files written before the graph moved into the browser key their edges
by id. The import translates those to names as it reads.

## When something goes wrong

| What you see | What it means |
|---|---|
| *that name is taken* | One node per name, and case does not distinguish two |
| *they are already joined* | The edge is there. A second one would be the same edge |
| *a node cannot be joined to itself* | The graph has no self-edges |
| *no such node, or it still has edges* | Undo keeps a node that another node was joined to since |
| *there is not enough room…* | The browser's storage quota. Nothing was written |
| *another tab has this graph open…* | Close the other tab and reload this one |
| *this browser will not store a graph here* | Private browsing, or storage switched off |

The first four are the graph refusing a write, and the page carries on. In the last three, the
store cannot answer at all. That is a different failure, and the message says so
([architecture.md](design/architecture.md#when-the-store-itself-fails)).

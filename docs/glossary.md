# Glossary

Each term the docs and the code use for this project, defined once. A page that uses a
term links here and does not define it again.

[plain-terms.txt](../scripts/plain-terms.txt) lists the old figurative terms and the term
below that replaced each one. [ADR 0051](decisions/0051-the-plain-prose-rule-covers-committed-text.md)
records why they changed.

## The graph

| Term | Meaning |
|---|---|
| node | One named item in the graph. Its name is its key in the `nodes` store. |
| edge | An undirected link between two nodes. The `edges` store holds each edge once. |
| degree | How many edges a node has in the stored graph. The node record stores it. |
| component | A set of nodes connected by edges, with no edge to a node outside the set. |
| component size | How many nodes a component holds. Only the root node stores it, in `componentSize`. |
| root | The node that union-find uses to identify a component. Its `parent` is its own key. |
| parent | The node that union-find points a node at. Following parents from any node reaches the root. |
| start component | The largest component. The map page opens on its root. |
| full recount | A rebuild of every component and size from the edges. **Recount the components** on the transfer page runs it. |
| merge | A join that connects two components into one. |
| seed | A generated demo graph, from `web/src/store/generate.ts`. Also the string a hash takes. |
| ring lattice | The generator's starting graph: each node is joined to its nearest nodes on a circle. |

## The map

| Term | Meaning |
|---|---|
| selected node | The node the map draws largest, in the accent colour. A click on a node selects it. |
| neighbour | A node joined by an edge to the selected node. |
| other node | A node that is neither the selected node nor one of its neighbours. |
| dimmed node | An other node close enough to the selected node to cover its neighbours. The map fades it. |
| new neighbour | A neighbour that a read added after the node was selected. |
| tier | The drawing class of a node: 0 selected, 1 neighbour, 2 other, 3 dimmed. |
| node with unread edges | A node whose degree is larger than the edges the map has loaded. It has a dotted border. |
| hop | One edge. A node two hops away is a neighbour of a neighbour. |
| walk | Selecting a neighbour, then one of its neighbours, and so on. |
| place | Give a node its position on the map. A placed node never moves. |
| free spot | A position far enough from every placed node. `World.freeSpot` finds one for a new component. |
| nearest free spot | The free spot closest to a point. `World.nearestFreeSpot` uses it for a searched node. |
| circle | One of the circles of candidate positions around a parent node, in `placement.ts`. |
| slot | One candidate position, sized to hold a label box. |
| world coordinates | Positions on the map, independent of the camera's pan and zoom. |
| label box | The rounded rectangle a node's name is drawn in. |
| label outline | A line of the surface colour drawn around a label box, so the name stays readable over an edge. |
| selected outline | The coloured border around the selected node's label box. |
| unread outline | The dotted border on a node with unread edges. |
| off-screen marker | A label box near the selected node that stands for a neighbour outside the view. A click on it moves the camera there. |
| connector line | The dashed line from the selected node to an off-screen marker, or from a stub to its node. |
| stub | A short mark at each end of an edge too long to draw. It points at the other end. |
| z-rank | The drawing order of label boxes. A higher z-rank is drawn later, on top. |
| drop target | The node a shift-drag would join to if the button were released now. |
| hysteresis margin | The extra distance a value must pass before a check changes its answer back. It stops flicker. |

## The camera and the view

| Term | Meaning |
|---|---|
| camera | The pan and zoom that decide which part of the map is on screen. |
| camera move | An animated pan to a node, from a search, a component row or an off-screen marker. |
| idle | The camera has not moved for a set time. The map then updates the off-screen markers. |
| walk by pan | A setting. When it is on, the node nearest the middle of the screen becomes the selected node. |
| sphere view | The renderer in `sphere-view.ts`. It projects the map onto a sphere. |
| visible limit | The angle from the middle of the sphere view past which nothing is drawn. |
| controls | The buttons, panels and status line drawn over the map. |
| side panel | The panel at the left edge of the map page that lists the components. |
| Go to selected | The button that moves the camera back to the selected node. |

## Writing to the graph

| Term | Meaning |
|---|---|
| join | Write an edge between two nodes. |
| part | Delete the edge between two nodes. |
| start name | The name in the first input of the join panel. Each join in a run starts from it. |
| write log entry | One row under the join panel that reports one write and can offer an undo. |
| first name on the line | In a text file, the name before the first separator. The other names on the line join to it. |

## The node list page

| Term | Meaning |
|---|---|
| card | One node's panel on the node list page. |
| card stack | The cards opened in a row, each one a neighbour of the card before it. |
| covered-card edge | The visible part of a card that a later card covers. A click on it opens that card again. |

## Colour

| Term | Meaning |
|---|---|
| ramp | The ordered set of node colours, from the selected node outward. |
| ink | A text colour chosen to read on a given fill. |
| accent | The colour token for the selected node. The name is the token's, from `palette.ts`. |
| sentinel | A value that marks a special case, such as `NUL` in `keys.ts`. |

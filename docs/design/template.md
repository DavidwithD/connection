# <The capability, named as the thing it is>

One paragraph: what this does, end to end, in the order it happens. Enough that somebody
can argue with the design without opening a source file — which is the whole test this
shape has to pass.

Living document. Edit it until nothing in here is wrong. If you catch yourself writing
*we chose*, you are writing a record — take the next number in [decisions/](../decisions/).

## The pieces

What the parts are called, what each one is, and where it lives. A table, because the
names are the vocabulary everything below uses.

| Name | What it is | In the code |
|---|---|---|
| | | |

Use the words the code uses. A document that renames things is a second vocabulary to
learn, and the reader came here to understand the first one.

## <The mechanism, in as many sections as it takes>

How it actually works. One section per part that has its own shape — the order operations
run in, what is atomic and what is not, what happens when a step fails partway.

State the *sequence* wherever the order is load-bearing, and say why that order rather
than the other. An order nobody explains is an order somebody will helpfully reverse.

## What has to stay true

The invariants, in bold, each with what breaking it costs. Phrase the cost as what the
system does wrong, not as an insult: *break this and the map lies* beats *don't do this*.

**<The invariant.>** What rests on it, which file carries it, and what a reader would see
if it stopped holding. An invariant with no consequence written down is a preference.

## Where the numbers are

Every limit, cap, threshold and timeout, as a pointer to the file that reads it — never as
a value. Two copies is one stale copy, and this is the copy that goes stale.

Name the number in words if you must (*a ceiling on how many edges one read returns*) and
let the file carry the digits.

## Records behind it

| Record | What it settled |
|---|---|
| | |

Not a summary of the reasoning — that is the record's job and copying it makes this the
stale half. One line on *which question* each record answered, so a reader knows which one
to open.

This is the only place on the page a record is named. The body says what holds and why it
holds, in its own words and in the present tense. A reader who wants what was turned down,
or what was unknown at the time, comes down here for it.

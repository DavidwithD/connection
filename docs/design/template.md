# <The capability, named as the thing it is>

One paragraph: what this does, end to end, in the order it happens. Write enough that
somebody can argue with the design without opening a source file. That is the whole test
for this shape.

Living document. Edit it until every statement in it is true. If you catch yourself writing
*we chose*, you are writing a record. Take the next number in [decisions/](../decisions/).

## The pieces

What the parts are called, what each one is, and where it lives. A table, because the
names are the vocabulary everything below uses.

| Name | What it is | In the code |
|---|---|---|
| | | |

Use the words the code uses. A document that renames things makes the reader learn a
second set of names. The reader came here to understand the first set.

## <The mechanism, in as many sections as it takes>

How it actually works. Write one section per part that has its own shape. Cover the order
operations run in, what is atomic and what is not, and what happens when a step fails
partway.

State the *sequence* wherever the order matters, and say why that order beats the other.
Somebody will reverse an order that nobody explains.

## What has to stay true

The invariants, in bold, each with what breaking it costs. Phrase the cost as what the
system does wrong: *break this and the map draws a deleted edge* beats *don't do this*.

**<The invariant.>** What rests on it, which file carries it, and what a reader would see
if it stopped holding. Without a written consequence, an invariant is only a preference.

## Where the numbers are

Every limit, cap, threshold and timeout, as a link to the file that reads it. Never write
the value. A second copy goes stale, and this page would hold that copy.

Name the number in words if you must (*a ceiling on how many edges one read returns*). The
file holds the digits.

## Records behind it

| Record | What it decided |
|---|---|
| | |

Write one line on *which question* each record answered, so a reader knows which one to
open. The record holds the reasoning. A copy here would go stale.

This is the only place on the page a record is named. The body says what holds and why it
holds, in its own words and in the present tense. A reader who wants what was turned down,
or what was unknown at the time, comes down here for it.

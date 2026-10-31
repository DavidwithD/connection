#!/usr/bin/env python3
"""Self-test for the prose linter: do the checks still fire, and does the hook
still read its payload?

The linter fails differently from the docs gate. That gate goes silent when an
extractor stops matching, which is why its self-test mutates a tree and asserts a
complaint. Every check here is a pure function from a sentence to codes, so there
is nothing to mutate — the table below calls them directly.

The half that matters most is the payload. `added_text` reads a shape Claude Code
owns, not this repo, and a rename there costs nothing at import time: the hook
returns 0, prints nothing, and the rule stops being enforced with no signal. A
table of sentences would pass for ever while that happened, so the fixtures come
first.

Every check is asserted both ways. A rule that never fires and a rule that always
fires are both broken, and only the negative cases tell them apart.

Usage:

    npm run prose:selftest
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prose_lint", HERE / "prose-lint.py")
assert spec and spec.loader
pl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pl)

W25 = " ".join(f"word{n}" for n in range(1, 26))          # exactly at the budget
W26 = W25 + " over"                                        # one past it

# (name, source, text, expected codes)
CASES: list[tuple[str, str, str, set[str]]] = [
    # L001, both ways.
    ("L001 fires past the budget", "prose", W26 + ".", {"L001"}),
    ("L001 holds at the budget", "prose", W25 + ".", set()),
    ("a middle dot ends a sentence", "prose", W25 + " · " + W25, set()),
    # L002: an abstract subject, and a concrete one that only looks abstract.
    ("L002 fires on an abstract subject", "prose", "Stillness costs markers.", {"L002"}),
    ("L002 spares an exempt noun", "prose", "The function returns a node.", set()),
    # L003, the aphorism shape.
    ("L003 fires on -ing is -ing", "prose", "Asking to go is asking to be taken.", {"L003"}),
    ("L003 spares an ordinary sentence", "prose", "The camera pans while the selected node stays.", set()),
    # L004 is bounded by length, so the long form must not fire.
    ("L004 fires on a short X is not a Y", "prose", "The box is not a way back.", {"L004"}),
    ("L004 spares the long form", "prose",
     "The box the reader ticked is not a way back to the nodes a pan already placed here.",
     set()),
    # L005: the subject's own verb, unless a person is named.
    ("L005 fires on a personified subject", "prose", "The box wants a name.", {"L005"}),
    ("L005 spares a named person", "prose", "The reader wants a name.", set()),
    ("L005 spares the passive", "prose", "The box is asked for a name.", set()),
    # L006: a retired term blocks, in prose, a heading and a table cell alike.
    ("L006 fires on a retired term", "prose", "Click the ghost.", {"L006"}),
    ("L006 fires in a heading", "prose", "# 0025 — When a doorway stands", {"L006"}),
    ("L006 fires in a table cell", "prose", "| island | x |", {"L006"}),
    ("L006 fires in a comment", "code", "// the island list", {"L006"}),
    ("L006 spares the literal term", "prose", "Click the off-screen marker.", set()),
    ("L006 spares a code span", "prose", "Read `islandSize` in a v2 backup.", set()),
    ("L006 spares a [keep] word", "prose", "Chrome runs the drive scripts.", set()),
    ("L006 spares a longer identifier", "code", "// ghostId and islands2", set()),
    # L007: a part of the page as the actor.
    ("L007 fires on a UI noun as the actor", "prose", "A click leaves the panel alone.", {"L007"}),
    ("L007 fires mid-sentence", "prose", "On a click on the node, the panel keeps its values.", {"L007"}),
    ("L007 spares code as the actor", "prose", "The click handler copies the name.", set()),
    ("L007 spares the passive", "prose", "The panel is left alone.", set()),
    # L008: a term with a literal sense too is a guess, and never blocks.
    ("L008 fires on a double-sense term", "prose", "The ring is drawn.", {"L008"}),
    ("L008 spares the literal term", "prose", "The neighbours are drawn.", set()),
    # Front matter is trigger text: no sentence checks, but terms still count.
    ("front matter skips the sentence checks", "prose", "---\ndescription: " + W26 + "\n---\nShort.", set()),
    ("front matter still has its terms read", "prose", "---\ndescription: the island list\n---\n", {"L006"}),
    # What prose_lines drops.
    ("a fenced block is not prose", "prose", "```\n" + W26 + "\n```", set()),
    ("a table row is not prose", "prose", "| " + W26 + " |", set()),
    # A heading is prose: a title is read like any other sentence.
    ("a heading is prose", "prose", "## " + W26, {"L001"}),
    ("a heading skips the subject guesses", "prose", "## Decision", set()),
    ("a record's metadata is not prose", "prose", "**Deciders:** " + W26, set()),
    # A code span is one token however long the identifier is.
    ("a code span counts once", "prose",
     "`" + " ".join(f"x{n}" for n in range(40)) + "` is short.", set()),
    # units() joins a wrapped sentence, or a long one hides in the wrap.
    ("a wrapped sentence is one sentence", "prose", W26.replace(" word14 ", " word14\n"), {"L001"}),
    # Source files: comments are read, code is not.
    ("a comment is prose", "code", "// " + W26, {"L001"}),
    ("a line of code is not prose", "code", "const x = [" + W26 + "]", set()),
]

# (name, payload, expected (path, added))
PAYLOADS: list[tuple[str, dict, tuple[str, str]]] = [
    ("Write sends content", {"tool_input": {"file_path": "a.md", "content": "one"}},
     ("a.md", "one")),
    ("Edit sends new_string", {"tool_input": {"file_path": "a.md", "new_string": "two"}},
     ("a.md", "two")),
    ("MultiEdit sends edits", {"tool_input": {"file_path": "a.md",
                                             "edits": [{"new_string": "a"}, {"new_string": "b"}]}},
     ("a.md", "a\nb")),
    ("an unknown shape yields nothing", {"tool_input": {"file_path": "a.md"}}, ("a.md", "")),
    ("an empty payload yields nothing", {}, ("", "")),
]

# (name, path, expected kind)
KINDS: list[tuple[str, str, str | None]] = [
    ("markdown is prose", "docs/README.md", "prose"),
    ("typescript is code", "web/src/main.ts", "code"),
    ("a driver is code", "scripts/drive-map.mjs", "code"),
    ("python is neither", "scripts/prose-lint.py", None),
    ("json is neither", "package.json", None),
]


def main() -> int:
    # The summary carries an em dash, and a cp932 console would kill this on its own
    # output. `prose-lint.py` does the same for the same reason.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    failures: list[str] = []

    for name, payload, want in PAYLOADS:
        got = pl.added_text(payload)
        ok = got == want
        print(f"  {'ok ' if ok else 'FAIL'} payload: {name}")
        if not ok:
            failures.append(f"payload: {name} — wanted {want}, got {got}")

    for name, path, want in KINDS:
        got = pl.kind(path)
        ok = got == want
        print(f"  {'ok ' if ok else 'FAIL'} kind: {name}")
        if not ok:
            failures.append(f"kind: {name} — wanted {want}, got {got}")

    for name, source, text, want in CASES:
        report = pl.lint(text, 1, source)
        got = {line.strip().split()[0] for line in report if line.strip().startswith("L")}
        ok = got == want
        print(f"  {'ok ' if ok else 'FAIL'} check: {name}")
        if not ok:
            failures.append(f"check: {name} — wanted {sorted(want) or 'nothing'}, "
                            f"got {sorted(got) or 'nothing'}")

    total = len(PAYLOADS) + len(KINDS) + len(CASES)
    print()
    if failures:
        for line in failures:
            print(f"FAIL {line}")
        print(f"\nFAIL — {total} case(s), {len(failures)} did not hold")
        print("\nA check that fires on everything is as broken as one that fires on "
              "nothing. Fix the rule, not this test.")
        return 1

    print(f"PASS — {total} case(s), every check still fires and still holds off")
    return 0


if __name__ == "__main__":
    sys.exit(main())

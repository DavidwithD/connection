#!/usr/bin/env python3
"""Docs gate — binds the living documents to the code they describe.

Each check finds one fact twice — in the code, and in the document describing it —
and fails when the two disagree.

The reference for what is bound to what, and for every rule code raised below, is
the checks document this enforces.

Every extractor is a heuristic tied to how this repo writes things, so each one
fails loudly when it finds nothing at all (`X000`). A gate that silently stops
checking is worse than no gate: it reports PASS forever.

Usage:
    scripts/docs-gate.py                # check everything
    scripts/docs-gate.py --strict       # warnings fail too
    scripts/docs-gate.py --json         # machine-readable findings
    scripts/docs-gate.py --root PATH    # check a tree elsewhere (the pre-commit hook)

Exit: 0 clean, 1 gate failed, 2 bad invocation.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------- configuration

README = "README.md"
PACKAGE_JSON = "package.json"
STORE_FILE = "web/src/store/db.ts"

# Which document carries each check's half of the comparison.
#
# A fact in the code is bound to "the document describing it". Which document that
# is was hardcoded to the README in five separate functions, so moving a bound
# section out of it failed as an X000 — a broken extractor — rather than as the
# ordinary consequence of a decision nobody had recorded. Declaring it here makes
# the location reviewable, and moving a section a one-line edit.
#
# More than one document is allowed, searched in order: the first that carries the
# fact wins. That is for a section mid-move, and for a fact that legitimately lives
# in two places. None of them carrying it is still X000, because a check that
# compares nothing reports PASS for ever.
#
# `paths` is absent on purpose: it binds to every markdown file there is, so it
# nominates no document and has nothing to declare.
BOUND_DOCS = {
    "commands": [README],       # the command table
    "engines": [README],        # the prerequisites table
    "keys": [README],           # the data model table
    "layout": [README],         # the layout tree, as a fenced block
}

# Records have their own gate, with rules this one would only duplicate.
DECISIONS_DIR = "docs/decisions"

# Trees that hold code the docs describe. Everything else is generated or vendored.
CODE_DIRS = ["web", "scripts"]

# `temp` holds plans, and a plan names files nobody has written yet. The hook and CI read
# tracked files only, so skipping it keeps a local run in agreement with them.
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__", ".next",
    "temp",
}

# What counts as a source file when comparing a directory against the layout tree.
SOURCE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".html", ".css"}

# ------------------------------------------------------------------- data model


@dataclass
class Finding:
    code: str
    severity: str  # "error" | "warn"
    path: str
    line: int
    msg: str

    def as_text(self) -> str:
        tag = "ERROR" if self.severity == "error" else "warn "
        return f"{tag} {self.path}:{self.line}  [{self.code}] {self.msg}"


class Gate:
    """Findings, plus the root every path is resolved against."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.findings: list[Finding] = []

    def add(self, code: str, severity: str, path: str, line: int, msg: str) -> None:
        self.findings.append(Finding(code, severity, path, line, msg))

    def error(self, code: str, path: str, line: int, msg: str) -> None:
        self.add(code, "error", path, line, msg)

    def warn(self, code: str, path: str, line: int, msg: str) -> None:
        self.add(code, "warn", path, line, msg)

    def read(self, rel: str) -> str | None:
        try:
            return (self.root / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None

    def exists(self, rel: str) -> bool:
        return (self.root / rel).exists()

    def empty(self, code: str, path: str, what: str) -> None:
        """An extractor that found nothing has stopped checking. Say so."""
        self.error(code, path, 1, f"found no {what} here — this gate's assumption "
                                  "about the file's shape has broken, so it is no "
                                  "longer checking anything. Fix the extractor.")


# ------------------------------------------------------------------ markdown

FENCE_RE = re.compile(r"^\s*(```|~~~)")
BACKTICK_RE = re.compile(r"`([^`]+)`")
LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


def code_blocks(text: str) -> list[tuple[int, list[str]]]:
    """Every fenced block, as (first content line number, lines)."""
    out, buf, start, inside = [], [], 0, False
    for idx, line in enumerate(text.split("\n"), start=1):
        if FENCE_RE.match(line):
            if inside:
                out.append((start, buf))
                buf = []
            else:
                start = idx + 1
            inside = not inside
            continue
        if inside:
            buf.append(line)
    return out


def outside_code(text: str) -> list[tuple[int, str]]:
    """Lines that are not inside a fenced block, numbered from 1."""
    out, inside = [], False
    for idx, line in enumerate(text.split("\n"), start=1):
        if FENCE_RE.match(line):
            inside = not inside
            continue
        if not inside:
            out.append((idx, line))
    return out


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def tables(text: str) -> list[tuple[int, list[str], list[list[str]]]]:
    """Markdown tables as (line of the header, header cells, body rows).

    Tables are found by their header, never by position, so reorganising a
    document does not quietly disable a check.
    """
    found: list[tuple[int, list[str], list[list[str]]]] = []
    lines = outside_code(text)
    idx = 0
    while idx < len(lines):
        lineno, line = lines[idx]
        is_row = line.lstrip().startswith("|")
        sep = idx + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$",
                                               lines[idx + 1][1])
        if is_row and sep:
            header = cells(line)
            body, idx = [], idx + 2
            while idx < len(lines) and lines[idx][1].lstrip().startswith("|"):
                body.append(cells(lines[idx][1]))
                idx += 1
            found.append((lineno, header, body))
            continue
        idx += 1
    return found


def table_with(text: str, *headers: str) -> tuple[int, list[list[str]]] | None:
    """The first table whose header row contains all of `headers`."""
    want = {h.lower() for h in headers}
    for lineno, header, body in tables(text):
        if want <= {h.lower() for h in header}:
            return lineno, body
    return None


# --------------------------------------------------------------------- bindings


@dataclass
class Bound:
    """Where a check found its half of the comparison."""

    path: str
    line: int
    rows: list[list[str]]


def bound_doc(gate: Gate, check: str) -> tuple[str, str] | None:
    """The first declared document for this check that can be read, and its text."""
    for rel in BOUND_DOCS[check]:
        text = gate.read(rel)
        if text is not None:
            return rel, text
    return None


def bound_table(gate: Gate, check: str, *headers: str) -> Bound | None:
    """This check's table, from whichever declared document carries it.

    Searched in declared order rather than merged: two documents holding the same
    table is the stale copy this gate exists to prevent, so the first one wins and
    the second is simply not consulted.
    """
    for rel in BOUND_DOCS[check]:
        text = gate.read(rel)
        if text is None:
            continue
        found = table_with(text, *headers)
        if found:
            lineno, rows = found
            return Bound(rel, lineno, rows)
    return None


def unbound(gate: Gate, code: str, check: str, what: str) -> None:
    """No declared document carries the fact, so this check compares nothing.

    Distinct from `Gate.empty` in what it tells you to fix: an extractor that has
    stopped matching, *or* a binding pointing at the wrong document. Both produce
    a check that certifies agreement it never looked for.
    """
    candidates = BOUND_DOCS[check]
    gate.error(code, candidates[0], 1,
               f"found no {what} in {' or '.join(candidates)} — this check is no "
               "longer comparing anything. Fix the extractor, or point "
               f"BOUND_DOCS[{check!r}] at the document that carries it now.")


def backticked(text: str) -> set[str]:
    return {m.group(1).strip() for m in BACKTICK_RE.finditer(text)}


# ------------------------------------------------------------------- extractors

# The schema, as `upgrade` writes it: a store's name and its key path, then every
# index's name and the property it is built over. Together that is every identifier
# the data model table has to carry.
STORE_RE = re.compile(
    r"""createObjectStore\(\s*["'](\w+)["']\s*,\s*\{\s*keyPath:\s*(\[[^\]]*\]|["']\w+["'])"""
)
INDEX_RE = re.compile(
    r"""createIndex\(\s*["'](\w+)["']\s*,\s*(\[[^\]]*\]|["']\w+["'])"""
)
QUOTED_RE = re.compile(r"""["'](\w+)["']""")

SCRIPT_IN_DOC_RE = re.compile(r"\bnpm (?:run )?([a-z][a-z0-9:._-]*)")


def source_files(gate: Gate) -> list[Path]:
    """Every source file under the code directories, relative to the root."""
    out: list[Path] = []
    for top in CODE_DIRS:
        base = gate.root / top
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in SOURCE_EXTS:
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            out.append(path.relative_to(gate.root))
    return out


# ----------------------------------------------------------------------- checks


def check_commands(gate: Gate) -> None:
    """The README's command table and package.json hold the same set of scripts."""
    pkg_text = gate.read(PACKAGE_JSON)
    if pkg_text is None:
        gate.error("N000", PACKAGE_JSON, 1, "missing")
        return
    try:
        scripts = set(json.loads(pkg_text).get("scripts", {}))
    except json.JSONDecodeError as err:
        gate.error("N000", PACKAGE_JSON, 1, f"will not parse: {err}")
        return
    if not scripts:
        gate.empty("N000", PACKAGE_JSON, "npm scripts")
        return

    found = bound_table(gate, "commands", "Command")
    if not found:
        unbound(gate, "N000", "commands", "table of commands")
        return

    listed: dict[str, int] = {}
    for offset, row in enumerate(found.rows, start=1):
        for token in backticked(row[0]):
            m = SCRIPT_IN_DOC_RE.match(token)
            if m:
                listed[m.group(1)] = found.line + 1 + offset

    for name in sorted(scripts - set(listed)):
        gate.error("N001", found.path, found.line,
                   f"`npm run {name}` exists but the command table does not list it")
    for name in sorted(set(listed) - scripts):
        gate.error("N002", found.path, listed[name],
                   f"the table lists `npm run {name}`, which {PACKAGE_JSON} "
                   "does not define")


def check_engines(gate: Gate) -> None:
    """Every version `engines` demands is a version the prerequisites name.

    A floor is the easiest claim in the repo to falsify: it moves when a dependency
    raises its own, and nothing about installing that dependency touches the
    sentence promising the old one.

    One direction only. The prerequisites table also names things npm knows nothing
    about — a JRE, a shell — and a rule reading those back would report every one of
    them as undeclared.
    """
    pkg_text = gate.read(PACKAGE_JSON)
    if pkg_text is None:
        gate.error("G000", PACKAGE_JSON, 1, "missing")
        return
    try:
        declared = json.loads(pkg_text).get("engines", {}).get("node", "")
    except json.JSONDecodeError:
        return  # check_commands reports the parse failure
    if not declared:
        gate.empty("G000", PACKAGE_JSON, "engines.node constraint")
        return

    # Compare on major.minor: a range says 20.19.0, prose says 20.19, and the patch
    # is noise in both.
    wanted = {f"{m.group(1)}.{m.group(2)}"
              for m in re.finditer(r"(\d+)\.(\d+)(?:\.\d+)?", declared)}
    if not wanted:
        gate.empty("G000", PACKAGE_JSON, "version numbers in engines.node")
        return

    found = bound_table(gate, "engines", "Why")
    if not found:
        unbound(gate, "G000", "engines", "prerequisites table")
        return
    prose = " ".join(cell for row in found.rows for cell in row)

    for version in sorted(wanted):
        if version not in prose:
            gate.error("G001", found.path, found.line,
                       f"engines.node requires {version} and the prerequisites do "
                       f"not mention it — `{declared}` is what a reader has to meet")


def check_keys(gate: Gate) -> None:
    """Every store, key path and index in the schema reaches the data model table.

    The schema is written once, in `upgrade`, and it is the only place the engine is
    told anything about shape. A store or an index the table omits is a reader
    believing the graph is held in fewer pieces than it is.
    """
    text = gate.read(STORE_FILE)
    if text is None:
        gate.error("K000", STORE_FILE, 1, "missing")
        return

    names: set[str] = set()
    for pattern in (STORE_RE, INDEX_RE):
        for m in pattern.finditer(text):
            names.add(m.group(1))
            names |= set(QUOTED_RE.findall(m.group(2)))

    if not names:
        gate.empty("K000", STORE_FILE, "object stores or indexes")
        return

    found = bound_table(gate, "keys", "Store", "Key")
    if not found:
        unbound(gate, "K000", "keys", "data model table")
        return
    present: set[str] = set()
    for row in found.rows:
        for cell in row:
            present |= backticked(cell)

    for name in sorted(names - present):
        gate.error("K001", found.path, found.line,
                   f"`{name}` is a store, key path or index in {STORE_FILE} and the "
                   "data model table does not mention it")


def check_layout(gate: Gate) -> None:
    """The layout tree in the README names what is on disk, both directions.

    A file missing from the tree is how a reader ends up believing a directory is
    smaller than it is, which is the failure this block exists to prevent.
    """
    doc = bound_doc(gate, "layout")
    if doc is None:
        unbound(gate, "L000", "layout", "layout tree")
        return
    where, text = doc

    tree: dict[str, tuple[int, set[str]]] = {}  # directory -> (line, filenames)
    current: str | None = None
    for start, lines in code_blocks(text):
        for offset, line in enumerate(lines):
            lineno = start + offset
            if not line.strip():
                continue
            token = line.split()[0]
            indented = line[0].isspace()
            if not indented and token.endswith("/"):
                current = token
                tree.setdefault(current, (lineno, set()))
                continue
            if indented and current and not token.endswith("/"):
                tree[current][1].add(token)
                continue
            if not indented:
                current = None  # some other code block; stop collecting

    if not tree:
        unbound(gate, "L000", "layout", "layout tree")
        return

    for directory, (lineno, files) in sorted(tree.items()):
        if not gate.exists(directory):
            gate.error("L001", where, lineno,
                       f"the tree names {directory}, which does not exist")
            continue
        for name in sorted(files):
            if not gate.exists(directory + name):
                gate.error("L001", where, lineno,
                           f"the tree names {directory}{name}, which does not exist")

        if not files:
            continue
        actual = {
            p.name for p in (gate.root / directory).iterdir()
            if p.is_file() and p.suffix.lower() in SOURCE_EXTS
        }
        # Entries like `hooks/pre-commit` name a file one level down; they are
        # checked above and do not belong in this directory's own comparison.
        for name in sorted(actual - {f for f in files if "/" not in f}):
            gate.error("L002", where, lineno,
                       f"{directory}{name} exists and the tree omits it — a reader "
                       "will believe this directory is smaller than it is")


def markdown_files(gate: Gate) -> list[str]:
    """Tracked markdown outside `DECISIONS_DIR`, which has its own gate."""
    out = []
    for path in sorted(gate.root.rglob("*.md")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        rel = str(path.relative_to(gate.root)).replace("\\", "/")
        if rel.startswith(DECISIONS_DIR + "/"):
            continue
        out.append(rel)
    return out


def check_paths(gate: Gate) -> None:
    """Every relative link resolves, and every path named in backticks exists."""
    files = markdown_files(gate)
    if not files:
        gate.empty("M000", README, "markdown files")
        return

    repo_path = re.compile(rf"^(?:{'|'.join(CODE_DIRS)}|docs)/[\w./-]+$")

    for rel in files:
        text = gate.read(rel)
        if text is None:
            continue
        base = (gate.root / rel).parent
        for lineno, line in outside_code(text):
            for m in LINK_RE.finditer(line):
                target = m.group(2)
                if re.match(r"^(https?:|mailto:|#)", target):
                    continue
                if not (base / target.split("#", 1)[0]).exists():
                    gate.error("M001", rel, lineno, f"broken link → {target}")
            for token in backticked(line):
                candidate = token.split("#", 1)[0].split(":", 1)[0]
                if repo_path.match(candidate) and not gate.exists(candidate):
                    gate.error("M002", rel, lineno,
                               f"`{token}` looks like a path in this repo and "
                               "nothing is there")


# -------------------------------------------------------------------- reporting


CHECKS = [
    ("commands", check_commands),
    ("engines", check_engines),
    ("keys", check_keys),
    ("layout", check_layout),
    ("paths", check_paths),
]


def main(argv: list[str]) -> int:
    # Findings are full of em dashes and arrows, and a Windows console defaults to a
    # codepage that cannot encode them — which crashes the gate instead of failing it,
    # and reads to the hook as a rejection nobody can act on.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="docs/code binding gate")
    ap.add_argument("--root", default=".", help="tree to check (default: cwd)")
    ap.add_argument("--strict", action="store_true", help="warnings fail too")
    ap.add_argument("--json", action="store_true", help="emit findings as JSON")
    ap.add_argument("--only", action="append", metavar="CHECK",
                    help=f"run one check: {', '.join(n for n, _ in CHECKS)}")
    args = ap.parse_args(argv)

    root = Path(args.root)
    if not root.is_dir():
        print(f"docs-gate: no such directory: {root}", file=sys.stderr)
        return 2

    names = {n for n, _ in CHECKS}
    chosen = set(args.only) if args.only else names
    unknown = chosen - names
    if unknown:
        print(f"docs-gate: no such check: {sorted(unknown)[0]}", file=sys.stderr)
        return 2

    gate = Gate(root)
    for name, run in CHECKS:
        if name in chosen:
            run(gate)

    order = {"error": 0, "warn": 1}
    gate.findings.sort(key=lambda f: (f.path, order[f.severity], f.line, f.code))
    errors = sum(1 for f in gate.findings if f.severity == "error")
    warns = len(gate.findings) - errors

    if args.json:
        print(json.dumps({
            "checks": sorted(chosen),
            "errors": errors,
            "warnings": warns,
            "findings": [vars(f) for f in gate.findings],
        }, indent=2))
    else:
        for f in gate.findings:
            print(f.as_text())
        print()
        verdict = "PASS" if not errors and not (args.strict and warns) else "FAIL"
        print(f"{verdict} — {len(chosen)} check(s), {errors} error(s), "
              f"{warns} warning(s)" + (" [strict]" if args.strict else ""))

    return 1 if errors or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

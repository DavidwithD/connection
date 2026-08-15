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
ENV_EXAMPLE = ".env.example"
PACKAGE_JSON = "package.json"
API_FILE = "src/server/index.ts"
CLIENT_FILE = "web/src/api.ts"
TABLE_FILES = ["src/db/tables.ts", "src/graph/table.ts"]

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
# `routes` and `paths` are absent on purpose. Routes bind to the API's own header
# comment beside the code, and paths bind to every markdown file there is; neither
# nominates a document, so neither has anything to declare.
BOUND_DOCS = {
    "env": [README],            # the variable table; .env.example is read as well
    "commands": [README],       # the command table
    "engines": [README],        # the prerequisites table
    "keys": [README],           # the data model table
    "layout": [README],         # the layout tree, as a fenced block
}

# Records have their own gate, with rules this one would only duplicate.
DECISIONS_DIR = "docs/decisions"

# Trees that hold code the docs describe. Everything else is generated or vendored.
CODE_DIRS = ["src", "web", "scripts"]
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__",
    "vendor", ".dynamodb-data", ".next",
}

# What counts as a source file when comparing a directory against the layout tree.
SOURCE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".html", ".css"}

# Read by the AWS SDK rather than by this repo, so they appear in no process.env
# call yet still belong in the docs. Naming them here is the whole exception list.
EXTERNAL_ENV = {
    "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION",
}

# Directories the layout tree names that are gitignored, so absence is not drift.
MAY_BE_ABSENT = {"vendor/", ".dynamodb-data/"}

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

ENV_DIRECT_RE = re.compile(r"""process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])""")
ENV_SHELL_RE = re.compile(r"\$\{([A-Z][A-Z0-9_]*)[:\-}]")
ENV_ASSIGN_RE = re.compile(r"^\s*#?\s*([A-Z][A-Z0-9_]*)=")
# A top-level declaration. Used to find the body of a helper that reads an env var
# through a parameter, so its call sites can be read as env reads too.
DECL_RE = re.compile(r"^(?:export\s+)?(?:const|let|function|async function)\s+(\w+)")

ROUTE_RE = re.compile(r"""\bapp\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']""")
ROUTE_DOC_RE = re.compile(r"^\s*\*?\s*(GET|POST|PUT|PATCH|DELETE)\s+(/\S+)")
# The client's own idiom: a typed wrapper, then the path. `del` is DELETE.
CLIENT_CALL_RE = re.compile(r"""\b(get|post|del)\s*<[^>]*>\s*\(\s*[`"']([^`"']+)""")

KEY_VALUE_RE = re.compile(r"""^\s*(\w+):\s*["']([\w]+)["'],?\s*$""")
INDEX_CONST_RE = re.compile(r"""^export const [A-Z0-9_]+\s*=\s*["']([\w]+)["']""")

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


def env_scan_files(gate: Gate) -> list[Path]:
    """Files that could read an environment variable.

    Includes the extensionless hooks, which is where the gates' own strict flags
    are read.
    """
    out = source_files(gate)
    hooks = gate.root / "scripts" / "hooks"
    if hooks.is_dir():
        out += [p.relative_to(gate.root) for p in sorted(hooks.iterdir())
                if p.is_file() and not p.suffix]
    return out


def env_helpers(text: str) -> set[str]:
    """Names of functions in `text` that read process.env through a parameter.

    `num("GRAPH_N", 600)` in src/graph/seed.ts is an environment read, and nothing
    about that call site says so — `Finding("A001", …)` looks identical. So the
    helper is found first, by its body, and only then are its call sites believed.
    A helper written in some shape this misses makes a knob invisible to the gate,
    which is a check not running rather than a check reporting nonsense.
    """
    lines = text.split("\n")
    starts = [(i, m.group(1)) for i, line in enumerate(lines)
              if (m := DECL_RE.match(line))]
    helpers = set()
    for idx, (start, name) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        if re.search(r"process\.env\[\s*\w+\s*\]", "\n".join(lines[start:end])):
            helpers.add(name)
    return helpers


def all_doc_text(gate: Gate) -> str:
    """Every document's text, for "is this knob written down anywhere?".

    Deliberately wider than the link checks: a flag documented beside the machinery
    that reads it — a gate's strict switch, in that gate's own rules — is documented,
    and a rule demanding the README's table instead would be wrong.
    """
    parts = [gate.read(ENV_EXAMPLE)]
    for path in sorted(gate.root.rglob("*.md")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        parts.append(gate.read(str(path.relative_to(gate.root)).replace("\\", "/")))
    return "\n".join(p for p in parts if p)


def normalise_path(path: str) -> str:
    """A route path and the client's call to it, reduced to one comparable shape."""
    path = path.split("?", 1)[0]
    path = re.sub(r"\$\{[^}]*\}", "*", path)   # a template hole
    path = re.sub(r":\w+", "*", path)          # a route parameter
    return path.rstrip("/") or "/"


# ----------------------------------------------------------------------- checks


def check_env(gate: Gate) -> None:
    """Every knob the code reads is documented, and every one documented is read.

    A knob the code reads and nobody wrote down is a setting no operator can find.
    One in the docs that nothing reads is worse: somebody will set it and wait for
    something to happen.
    """
    read: dict[str, str] = {}  # name -> where it is read
    for rel in env_scan_files(gate):
        where = str(rel).replace("\\", "/")
        text = gate.read(where)
        if text is None:
            continue
        for m in ENV_DIRECT_RE.finditer(text):
            read.setdefault(m.group(1) or m.group(2), where)
        for helper in env_helpers(text):
            pattern = rf"""\b{re.escape(helper)}\(\s*["']([A-Z][A-Z0-9_]*)["']"""
            for m in re.finditer(pattern, text):
                read.setdefault(m.group(1), where)
        if rel.suffix in {".sh", ""}:
            for m in ENV_SHELL_RE.finditer(text):
                read.setdefault(m.group(1), where)

    pkg = gate.read(PACKAGE_JSON) or ""
    for m in ENV_SHELL_RE.finditer(pkg):
        read.setdefault(m.group(1), PACKAGE_JSON)

    if not read:
        gate.empty("E000", PACKAGE_JSON, "environment variable reads")
        return

    prose = all_doc_text(gate)
    for name, where in sorted(read.items()):
        if not re.search(rf"\b{re.escape(name)}\b", prose):
            gate.error("E001", where, 1,
                       f"{name} is read here and no document mentions it — an "
                       "undocumented knob is an unusable one")

    # Where each name was documented, not only which line: a variable that appears
    # solely in .env.example used to be reported against the README at that file's
    # line number, which sends a reader to the wrong document.
    documented: dict[str, tuple[str, int]] = {}
    found = bound_table(gate, "env", "Variable")
    if found:
        for offset, row in enumerate(found.rows, start=1):
            for token in backticked(row[0]):
                name = token.split("=", 1)[0].strip()
                if re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
                    documented[name] = (found.path, found.line + 1 + offset)
    else:
        unbound(gate, "E000", "env", "table of environment variables")

    for lineno, line in outside_code(gate.read(ENV_EXAMPLE) or ""):
        m = ENV_ASSIGN_RE.match(line)
        if m:
            documented.setdefault(m.group(1), (ENV_EXAMPLE, lineno))

    for name, (where, lineno) in sorted(documented.items()):
        if name in read or name in EXTERNAL_ENV:
            continue
        gate.warn("E002", where, lineno,
                  f"{name} is documented but nothing reads it — delete the row, or "
                  "name it in EXTERNAL_ENV if a library reads it for us")


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


def check_routes(gate: Gate) -> None:
    """The API's header comment lists what the API serves, and the client calls it.

    The header comment is the contract both sides read, so it is the thing that has
    to be true. The client is checked against the routes rather than the comment:
    a page calling a path nothing serves is a broken feature, not a stale sentence.
    """
    api = gate.read(API_FILE)
    if api is None:
        gate.error("R000", API_FILE, 1, "missing")
        return

    registered: dict[tuple[str, str], int] = {}
    for m in ROUTE_RE.finditer(api):
        line = api[:m.start()].count("\n") + 1
        registered[(m.group(1).upper(), normalise_path(m.group(2)))] = line
    if not registered:
        gate.empty("R000", API_FILE, "registered routes")
        return

    documented: dict[tuple[str, str], int] = {}
    for lineno, line in outside_code(api):
        m = ROUTE_DOC_RE.match(line)
        if m:
            documented[(m.group(1), normalise_path(m.group(2)))] = lineno
    if not documented:
        gate.empty("R000", API_FILE, "routes listed in the header comment")
        return

    for method, path in sorted(registered.keys() - documented.keys()):
        gate.error("R001", API_FILE, registered[(method, path)],
                   f"{method} {path} is served but the header comment does not "
                   "list it — that comment is the contract the client reads")
    for method, path in sorted(documented.keys() - registered.keys()):
        gate.error("R002", API_FILE, documented[(method, path)],
                   f"the header comment promises {method} {path}, which no route "
                   "serves")

    client = gate.read(CLIENT_FILE)
    if client is None:
        gate.error("R000", CLIENT_FILE, 1, "missing")
        return
    calls: dict[tuple[str, str], int] = {}
    for m in CLIENT_CALL_RE.finditer(client):
        if not m.group(2).startswith("/api"):
            continue
        method = {"get": "GET", "post": "POST", "del": "DELETE"}[m.group(1)]
        calls[(method, normalise_path(m.group(2)))] = client[:m.start()].count("\n") + 1
    if not calls:
        gate.empty("R000", CLIENT_FILE, "API calls")
        return

    for method, path in sorted(calls.keys() - registered.keys()):
        gate.error("R003", CLIENT_FILE, calls[(method, path)],
                   f"calls {method} {path}, which {API_FILE} does not serve")


def check_keys(gate: Gate) -> None:
    """Every key attribute and index name reaches the README's data model table."""
    names: dict[str, str] = {}
    for rel in TABLE_FILES:
        text = gate.read(rel)
        if text is None:
            gate.error("K000", rel, 1, "missing")
            return
        inside = False
        for line in text.split("\n"):
            if re.search(r"=\s*\{\s*$", line):
                inside = True
                continue
            if inside:
                if line.strip().startswith("}"):
                    inside = False
                    continue
                m = KEY_VALUE_RE.match(line)
                if m:
                    names.setdefault(m.group(2), rel)
            m = INDEX_CONST_RE.match(line)
            if m:
                names.setdefault(m.group(1), rel)

    if not names:
        gate.empty("K000", TABLE_FILES[0], "key attributes or index names")
        return

    found = bound_table(gate, "keys", "Partition key", "Sort key")
    if not found:
        unbound(gate, "K000", "keys", "data model table")
        return
    present: set[str] = set()
    for row in found.rows:
        for cell in row:
            present |= backticked(cell)

    for name in sorted(set(names) - present):
        gate.error("K001", found.path, found.line,
                   f"`{name}` is a key attribute or index in {names[name]} and the "
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
        if directory in MAY_BE_ABSENT:
            continue
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
    ("env", check_env),
    ("commands", check_commands),
    ("engines", check_engines),
    ("routes", check_routes),
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

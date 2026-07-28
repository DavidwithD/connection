#!/usr/bin/env python3
"""ADR quality gate.

Checks decision records for structure, concision, accuracy hygiene, duplication,
and maintainability. Rules and budgets are documented in docs/decisions/GATE.md.

Usage:
    scripts/adr-gate.py                 # check every ADR + the index
    scripts/adr-gate.py docs/decisions/0002-foo.md
    scripts/adr-gate.py --stats         # add the metrics table
    scripts/adr-gate.py --strict        # warnings fail too
    scripts/adr-gate.py --json          # machine-readable findings

Exit: 0 clean, 1 gate failed, 2 bad invocation.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------- configuration

DECISIONS_DIR = Path("docs/decisions")

REQUIRED_SECTIONS = [
    "Context",
    "Decision",
    "Alternatives considered",
    "Consequences",
    "Assumptions and unknowns",
    "Revisit when",
]
OPTIONAL_SECTIONS = {"todo", "follow-ups", "open questions", "references", "notes"}
DECIDER_NON_NAMES = [
    "the team", "team", "everyone", "all of us", "us", "engineering", "the group",
    "tbd", "n/a", "various", "stakeholders",
]

STATUS_EMOJI = {
    "Proposed": "🔵",
    "Accepted": "✅",
    "Rejected": "❌",
    "Superseded": "♻️",
}
SETTLED = {"Accepted", "Rejected"}

# Concision budgets, in words of prose (code blocks excluded).
WORDS_TOTAL_WARN, WORDS_TOTAL_FAIL = 500, 800
SECTION_BUDGET = {  # warn at the budget, fail at 1.6x
    "Context": 220,
    "Decision": 250,
    "Alternatives considered": 200,
    "Consequences": 180,
    "Assumptions and unknowns": 120,
    "Revisit when": 100,
}
SENTENCE_WARN, SENTENCE_FAIL = 35, 55
PARAGRAPH_WORDS, PARAGRAPH_LINES = 100, 7
LINE_LENGTH = 100
MAX_BULLETS = 8
MAX_CODE_LINES = 15
MAX_DECISION_ROWS = 6
MAX_HEADING_DEPTH = 3
TITLE_CHARS = 60

# Duplication: 7-word shingles, this many shared before it is worth reporting.
# Records are compared to each other at SHARED_SHINGLES; other docs only at
# VERBATIM_RUN, because a record legitimately quotes a spec now and then.
SHINGLE = 7
SHARED_SHINGLES = 3
VERBATIM_RUN = 25

# A record that has drifted this far from its date without settling is suspect.
DRIFT_DAYS = 90

# Inbound-reference scan: a record nothing points at will not be found in time.
SCAN_EXTS = {
    ".md", ".txt", ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java",
    ".kt", ".rb", ".sh", ".sql", ".yaml", ".yml", ".toml", ".json", ".tf",
    ".html", ".css", ".proto", ".graphql",
}
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__",
    "target", ".next", ".mypy_cache", ".pytest_cache", ".ruff_cache",
}
MAX_SCAN_BYTES = 512_000

HEDGES = [
    "perhaps", "maybe", "probably", "possibly", "arguably", "hopefully",
    "it seems", "we think", "sort of", "kind of", "we might want to",
    "for the most part", "more or less",
]
TIME_RELATIVE = [
    "currently", "recently", "right now", "for now", "as of now", "at present",
    "nowadays", "these days", "at the moment", "soon", "lately", "today",
    "tomorrow", "next week", "next month", "this quarter", "going forward",
    "in the near future",
]
PASSIVE_DECIDER = ["it was decided", "it has been decided", "was decided that"]
DOWNSIDE_WORDS = [
    "trade-off", "tradeoff", "precludes", "cost", "risk", "downside", "lose",
    "harder", "slower", "accept", "give up", "gives up", "constrain", "limits",
    "we forgo", "expensive",
]
PLACEHOLDERS = ["tbd", "tk", "xxx", "fixme", "lorem ipsum", "todo:"]

QUANTITY_RE = re.compile(
    r"(?<![\w.])(?:\$\d|\d+(?:\.\d+)?\s?(?:%|x\b|ms\b|s\b|m\b|h\b|kb\b|mb\b|gb\b|tb\b"
    r"|k\b|req/s\b|rps\b|qps\b|users\b|customers\b|seats\b))",
    re.I,
)

# ------------------------------------------------------------------ data models


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


@dataclass
class Section:
    name: str
    level: int
    heading_line: int
    lines: list[tuple[int, str]] = field(default_factory=list)


@dataclass
class Doc:
    path: Path
    lines: list[str]
    code_mask: list[bool]
    number: str | None = None
    title: str = ""
    fields: dict[str, tuple[int, str]] = field(default_factory=dict)
    status: str | None = None
    sections: list[Section] = field(default_factory=list)

    def section(self, name: str) -> Section | None:
        low = name.lower()
        return next((s for s in self.sections if s.name.lower() == low), None)


# ---------------------------------------------------------------- markdown bits

FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
H1_RE = re.compile(r"^#\s+(\d{4})\s+—\s+(\S.*?)\s*$")
FIELD_RE = re.compile(r"^\*\*([A-Za-z][A-Za-z ]*):\*\*\s*(.*)$")
FNAME_RE = re.compile(r"^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
STATUS_RE = re.compile(r"^(\S+)\s+(Proposed|Accepted|Rejected|Superseded)\b(.*)$")
LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ADR_LINK_RE = re.compile(r"\((\d{4})-[a-z0-9-]+\.md")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])[\s]+")


def code_mask(lines: list[str]) -> list[bool]:
    """True for lines inside (or delimiting) a fenced code block."""
    mask, inside = [], False
    for line in lines:
        fence = bool(FENCE_RE.match(line))
        if fence:
            mask.append(True)
            inside = not inside
            continue
        mask.append(inside)
    return mask


def to_prose(text: str) -> str:
    """Strip markdown scaffolding so word/sentence counts measure prose."""
    text = re.sub(r"<!--.*?-->", " ", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = LINK_RE.sub(r"\1", text)
    text = re.sub(r"`[^`]*`", " code ", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text)
    text = re.sub(r"^\s*>\s?", "", text)
    text = re.sub(r"^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s*)?", "", text)
    text = text.replace("|", " ")
    text = re.sub(r"[*_~]{1,3}", "", text)
    return re.sub(r"\s+", " ", text).strip()


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9][A-Za-z0-9'’./_-]*", text)


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def links_in(pairs: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Extract (line, target) for every link, including links wrapped over lines."""
    text, offsets, pos = [], [], 0
    for lineno, line in pairs:
        offsets.append((pos, lineno))
        text.append(line)
        pos += len(line) + 1
    joined = "\n".join(text)
    out = []
    for m in LINK_RE.finditer(joined):
        lineno = next(
            (ln for off, ln in reversed(offsets) if off <= m.start()),
            pairs[0][0] if pairs else 1,
        )
        out.append((lineno, m.group(2)))
    return out


def prose_pairs(doc: "Doc") -> list[tuple[int, str]]:
    return [
        (i, l) for i, l in enumerate(doc.lines, start=1) if not doc.code_mask[i - 1]
    ]


def is_table_row(line: str) -> bool:
    return line.lstrip().startswith("|")


def is_separator_row(line: str) -> bool:
    return bool(re.match(r"^\s*\|[\s:|-]+\|\s*$", line))


# ---------------------------------------------------------------------- parsing


def parse(path: Path) -> Doc:
    raw = path.read_text(encoding="utf-8")
    lines = raw.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    doc = Doc(path=path, lines=lines, code_mask=code_mask(lines))

    current: Section | None = None
    seen_heading = False
    for idx, line in enumerate(lines, start=1):
        if doc.code_mask[idx - 1]:
            if current:
                current.lines.append((idx, line))
            continue

        h1 = H1_RE.match(line)
        if h1 and not seen_heading:
            doc.number, doc.title = h1.group(1), h1.group(2)

        heading = HEADING_RE.match(line)
        if heading:
            level = len(heading.group(1))
            seen_heading = True
            if level == 1:
                current = None
                continue
            if level == 2:
                current = Section(heading.group(2), level, idx)
                doc.sections.append(current)
                continue
            if current:
                current.lines.append((idx, line))
            continue

        fld = FIELD_RE.match(line)
        if fld and current is None:
            doc.fields[fld.group(1).strip().lower()] = (idx, fld.group(2).strip())

        if current:
            current.lines.append((idx, line))

    if "status" in doc.fields:
        m = STATUS_RE.match(doc.fields["status"][1])
        if m:
            doc.status = m.group(2)
    return doc


def section_prose(section: Section, mask: list[bool]) -> list[tuple[int, str]]:
    out = []
    for lineno, line in section.lines:
        if mask[lineno - 1] or is_separator_row(line):
            continue
        prose = to_prose(line)
        if prose:
            out.append((lineno, prose))
    return out


def prose_units(section: Section, mask: list[bool]) -> list[tuple[int, str]]:
    """Prose split into sentence-able units: one per list item, one per paragraph.

    Tables are dropped — cells have no terminal punctuation and would read as one
    enormous sentence. Bullets stay separate for the same reason.
    """
    units: list[tuple[int, str]] = []
    buffer: list[str] = []
    start = 0

    def flush() -> None:
        nonlocal buffer, start
        if buffer:
            units.append((start, " ".join(buffer)))
        buffer, start = [], 0

    for lineno, line in section.lines:
        if mask[lineno - 1] or is_table_row(line) or not line.strip():
            flush()
            continue
        prose = to_prose(line)
        if not prose:
            flush()
            continue
        if re.match(r"^\s*(?:[-*+]|\d+\.)\s", line):
            flush()
            units.append((lineno, prose))
            continue
        if not buffer:
            start = lineno
        buffer.append(prose)
    flush()
    return units


def paragraphs(section: Section, mask: list[bool]) -> list[list[tuple[int, str]]]:
    blocks: list[list[tuple[int, str]]] = []
    current: list[tuple[int, str]] = []
    for lineno, line in section.lines:
        blank = not line.strip()
        skip = mask[lineno - 1] or is_table_row(line) or line.lstrip().startswith(
            ("-", "*", "+")
        ) or re.match(r"^\s*\d+\.\s", line)
        if blank or skip:
            if current:
                blocks.append(current)
                current = []
            continue
        prose = to_prose(line)
        if prose:
            current.append((lineno, prose))
    if current:
        blocks.append(current)
    return blocks


# ----------------------------------------------------------------------- checks


def check_structure(doc: Doc, out: list[Finding]) -> None:
    rel = str(doc.path)
    name = doc.path.name

    fm = FNAME_RE.match(name)
    if not fm:
        out.append(Finding("S001", "error", rel, 1,
                           "filename must be NNNN-kebab-case-title.md"))
    if not doc.number:
        out.append(Finding("S002", "error", rel, 1,
                           "first line must be '# NNNN — Title' (em dash)"))
    elif fm and doc.number != fm.group(1):
        out.append(Finding("S002", "error", rel, 1,
                           f"title number {doc.number} != filename {fm.group(1)}"))

    if doc.title:
        if len(doc.title) > TITLE_CHARS:
            out.append(Finding("S008", "warn", rel, 1,
                               f"title is {len(doc.title)} chars (>{TITLE_CHARS}); "
                               "shorten it"))
        if re.search(r"\band\b|&|;|,", doc.title, re.I):
            out.append(Finding("S008", "warn", rel, 1,
                               "title joins two things — one decision per record"))

    if "status" not in doc.fields:
        out.append(Finding("S004", "error", rel, 1, "missing '**Status:**' field"))
    else:
        lineno, value = doc.fields["status"]
        m = STATUS_RE.match(value)
        if not m:
            out.append(Finding("S004", "error", rel, lineno,
                               "Status must be '<emoji> <Proposed|Accepted|Rejected|"
                               "Superseded>'"))
        elif m.group(1) != STATUS_EMOJI[m.group(2)]:
            out.append(Finding("S004", "error", rel, lineno,
                               f"{m.group(2)} must use {STATUS_EMOJI[m.group(2)]}"))

    if "date" not in doc.fields:
        out.append(Finding("S014", "error", rel, 1,
                           "missing '**Date:** YYYY-MM-DD' — a record's claims are "
                           "only true as of a date"))
    elif not DATE_RE.match(doc.fields["date"][1]):
        out.append(Finding("S014", "error", rel, doc.fields["date"][0],
                           "Date must be ISO YYYY-MM-DD"))

    if "deciders" not in doc.fields:
        out.append(Finding("S017", "error", rel, 1,
                           "missing '**Deciders:**' — a record nobody signed is a "
                           "record nobody can be asked about"))
    else:
        lineno, value = doc.fields["deciders"]
        if not value.strip():
            out.append(Finding("S017", "error", rel, lineno, "Deciders is empty"))
        elif value.strip().lower().rstrip(".") in DECIDER_NON_NAMES:
            out.append(Finding("S017", "warn", rel, lineno,
                               f"'{value}' is a group, not a person — name who to ask"))

    present = [s.name for s in doc.sections]
    lowered = [s.lower() for s in present]
    for required in REQUIRED_SECTIONS:
        count = lowered.count(required.lower())
        if count == 0:
            out.append(Finding("S005", "error", rel, 1,
                               f"missing required section '## {required}'"))
        elif count > 1:
            out.append(Finding("S005", "error", rel, 1,
                               f"section '## {required}' appears {count} times"))

    order = [lowered.index(r.lower()) for r in REQUIRED_SECTIONS if r.lower() in lowered]
    if order != sorted(order):
        out.append(Finding("S005", "error", rel, 1,
                           "required sections out of order: "
                           + " → ".join(REQUIRED_SECTIONS)))

    for sec in doc.sections:
        low = sec.name.lower()
        if low not in [r.lower() for r in REQUIRED_SECTIONS] and low not in OPTIONAL_SECTIONS:
            out.append(Finding("S006", "warn", rel, sec.heading_line,
                               f"unexpected section '{sec.name}' — keep the shape "
                               "predictable or extend the gate"))

    for idx, line in enumerate(doc.lines, start=1):
        if doc.code_mask[idx - 1]:
            continue
        h = HEADING_RE.match(line)
        if h and len(h.group(1)) > MAX_HEADING_DEPTH:
            out.append(Finding("S007", "warn", rel, idx,
                               "heading deeper than h3 — an ADR that needs this "
                               "nesting is really a design doc"))

    alts = doc.section("Alternatives considered")
    if alts:
        bullets = [l for _, l in alts.lines if l.lstrip().startswith(("-", "*"))]
        prose = section_prose(alts, doc.code_mask)
        text = " ".join(p for _, p in prose).lower()
        if not bullets and not re.search(r"\bnone\b", text):
            out.append(Finding("S011", "warn", rel, alts.heading_line,
                               "list the alternatives, or state 'None — <why>'"))

    cons = doc.section("Consequences")
    if cons:
        text = " ".join(p for _, p in section_prose(cons, doc.code_mask)).lower()
        if text and not any(w in text for w in DOWNSIDE_WORDS):
            out.append(Finding("S012", "warn", rel, cons.heading_line,
                               "no cost or trade-off named — consequences that are "
                               "all upside are usually incomplete"))

    dec = doc.section("Decision")
    if dec:
        rows = [
            l for n, l in dec.lines
            if is_table_row(l) and not is_separator_row(l) and not doc.code_mask[n - 1]
        ]
        if len(rows) - 1 > MAX_DECISION_ROWS:  # minus the header row
            out.append(Finding("S013", "warn", rel, dec.heading_line,
                               f"decision table has {len(rows) - 1} rows "
                               f"(>{MAX_DECISION_ROWS}) — split into separate ADRs"))
        text = " ".join(p for _, p in section_prose(dec, doc.code_mask)).lower()
        for hedge in HEDGES:
            if hedge in text:
                out.append(Finding("S015", "warn", rel, dec.heading_line,
                                   f"hedge '{hedge}' in Decision — state the choice "
                                   "or keep the status Proposed"))

    ctx = doc.section("Context")
    if ctx and not links_in([p for p in ctx.lines if not doc.code_mask[p[0] - 1]]):
        out.append(Finding("S016", "warn", rel, ctx.heading_line,
                           "Context links nothing — link the docs it touches instead "
                           "of restating them"))


def check_concision(doc: Doc, out: list[Finding], stats: dict) -> None:
    rel = str(doc.path)
    total = 0

    for sec in doc.sections:
        prose = section_prose(sec, doc.code_mask)
        count = sum(len(words(p)) for _, p in prose)
        total += count
        stats.setdefault("sections", {})[sec.name] = count
        budget = SECTION_BUDGET.get(sec.name)
        if budget and count > budget:
            severity = "error" if count > budget * 1.6 else "warn"
            out.append(Finding("C002", severity, rel, sec.heading_line,
                               f"'{sec.name}' is {count} words (budget {budget})"))

        for block in paragraphs(sec, doc.code_mask):
            block_words = sum(len(words(p)) for _, p in block)
            if block_words > PARAGRAPH_WORDS or len(block) > PARAGRAPH_LINES:
                out.append(Finding("C004", "warn", rel, block[0][0],
                                   f"paragraph is {block_words} words / {len(block)} "
                                   "lines — split it or cut it"))

        for lineno, unit in prose_units(sec, doc.code_mask):
            for sentence in SENTENCE_SPLIT_RE.split(unit):
                n = len(words(sentence))
                if n > SENTENCE_WARN:
                    severity = "error" if n > SENTENCE_FAIL else "warn"
                    out.append(Finding("C003", severity, rel, lineno,
                                       f"{n}-word sentence: “{sentence[:60]}…”"))

        bullets = sum(
            1 for n, l in sec.lines
            if not doc.code_mask[n - 1] and re.match(r"^\s*(?:[-*+]|\d+\.)\s", l)
        )
        if bullets > MAX_BULLETS:
            out.append(Finding("C008", "warn", rel, sec.heading_line,
                               f"{bullets} bullets in '{sec.name}' — table it or cut"))

    stats["words"] = total
    if total > WORDS_TOTAL_FAIL:
        out.append(Finding("C001", "error", rel, 1,
                           f"{total} words of prose (max {WORDS_TOTAL_FAIL})"))
    elif total > WORDS_TOTAL_WARN:
        out.append(Finding("C001", "warn", rel, 1,
                           f"{total} words of prose (budget {WORDS_TOTAL_WARN})"))

    run_start, run_len = 0, 0
    for idx, inside in enumerate(doc.code_mask + [False], start=1):
        if inside:
            run_len += 1
            run_start = run_start or idx
        elif run_len:
            if run_len - 2 > MAX_CODE_LINES:
                out.append(Finding("C009", "warn", rel, run_start,
                                   f"{run_len - 2}-line code block — a record states "
                                   "the decision; code belongs in the code"))
            run_start, run_len = 0, 0

    longest = 0
    for idx, line in enumerate(doc.lines, start=1):
        if is_table_row(line):
            continue
        longest = max(longest, len(line))
        if len(line) > LINE_LENGTH:
            out.append(Finding("C005", "warn", rel, idx,
                               f"line is {len(line)} chars (>{LINE_LENGTH}) — hard to "
                               "review in a diff"))
    stats["longest_line"] = longest

    lowered = " ".join(
        to_prose(l).lower()
        for i, l in enumerate(doc.lines, start=1)
        if not doc.code_mask[i - 1]
    )
    for bucket, code, note in (
        (FILLER, "C006", "filler"),
        (BUZZWORDS, "C007", "buzzword"),
    ):
        hits = sorted({w for w in bucket if re.search(rf"\b{re.escape(w)}\b", lowered)})
        if hits:
            out.append(Finding(code, "warn", rel, 1,
                               f"{note}: {', '.join(hits)} — cut or replace with the "
                               "specific thing"))
    for phrase in PASSIVE_DECIDER:
        if phrase in lowered:
            out.append(Finding("C010", "warn", rel, 1,
                               f"'{phrase}' — name who decided, in the active voice"))


def check_maintainability(doc: Doc, out: list[Finding], known: set[str]) -> None:
    rel = str(doc.path)
    todo_sec = doc.section("TODO")
    todo_range = range(todo_sec.heading_line, todo_sec.lines[-1][0] + 1) if (
        todo_sec and todo_sec.lines
    ) else range(0)

    for idx, line in enumerate(doc.lines, start=1):
        if line.rstrip() != line:
            out.append(Finding("M009", "warn", rel, idx, "trailing whitespace"))
        if "\t" in line:
            out.append(Finding("M009", "warn", rel, idx, "tab character"))
        if "\r" in line:
            out.append(Finding("M009", "warn", rel, idx, "CRLF line ending"))
        if doc.code_mask[idx - 1]:
            continue
        if re.search(r"/Users/|/home/[a-z]|[A-Z]:\\\\", line):
            out.append(Finding("M006", "error", rel, idx,
                               "absolute/machine-local path — use a repo-relative one"))
        if "http://" in line:
            out.append(Finding("M007", "warn", rel, idx, "http:// link — use https"))
        if re.search(r"\bTODO\b", line) and idx not in todo_range:
            out.append(Finding("M008", "warn", rel, idx,
                               "TODO outside the TODO section — it will be missed"))
        low = to_prose(line).lower()
        for phrase in TIME_RELATIVE:
            if re.search(rf"\b{re.escape(phrase)}\b", low):
                out.append(Finding("M001", "warn", rel, idx,
                                   f"'{phrase}' goes stale — pin it to a date, "
                                   "version, or event"))
                break

    for idx, target in links_in(prose_pairs(doc)):
        if re.match(r"^(https?:|mailto:|#)", target):
            continue
        if not (doc.path.parent / target.split("#", 1)[0]).exists():
            out.append(Finding("M002", "error", rel, idx, f"broken link → {target}"))
        num = ADR_LINK_RE.match(f"({target}")
        if num and num.group(1) not in known:
            out.append(Finding("M003", "error", rel, idx,
                               f"links ADR {num.group(1)}, which does not exist"))

    blanks = 0
    for idx, line in enumerate(doc.lines, start=1):
        blanks = blanks + 1 if not line.strip() else 0
        if blanks == 3:
            out.append(Finding("M009", "warn", rel, idx, "3+ blank lines in a row"))
    if doc.lines and not doc.path.read_text(encoding="utf-8").endswith("\n"):
        out.append(Finding("M009", "warn", rel, len(doc.lines),
                           "no newline at end of file"))


def check_accuracy(doc: Doc, out: list[Finding]) -> None:
    rel = str(doc.path)
    settled = doc.status in SETTLED

    open_boxes: list[int] = []
    for idx, line in enumerate(doc.lines, start=1):
        if doc.code_mask[idx - 1]:
            continue
        low = to_prose(line).lower()
        for ph in PLACEHOLDERS:
            if re.search(rf"(?<![a-z]){re.escape(ph)}(?![a-z])", low):
                if settled:
                    out.append(Finding("A001", "error", rel, idx,
                                       f"'{ph}' in a record marked {doc.status} — "
                                       "settle it or go back to Proposed"))
                break
        if settled and re.search(r"^\s*[-*+]\s*\[ \]", line):
            open_boxes.append(idx)
        if re.search(r"<[a-z][a-z -]*>", line):
            out.append(Finding("A002", "error" if settled else "warn", rel, idx,
                               "unfilled <placeholder> from the template"))

    if open_boxes:
        out.append(Finding("A001", "warn", rel, open_boxes[0],
                           f"{len(open_boxes)} unchecked box(es) in a record marked "
                           f"{doc.status} — track open work where work is tracked"))

    for sec in doc.sections:
        for block in paragraphs(sec, doc.code_mask):
            text = " ".join(p for _, p in block)
            raw = " ".join(doc.lines[n - 1] for n, _ in block)
            if QUANTITY_RE.search(text) and not LINK_RE.search(raw):
                out.append(Finding("A005", "warn", rel, block[0][0],
                                   "quantity with no source — link where the number "
                                   "came from or drop it"))

    if doc.status == "Superseded":
        body = "\n".join(doc.lines)
        if not ADR_LINK_RE.search(body):
            out.append(Finding("A004", "error", rel, 1,
                               "Superseded without a forward link to the record that "
                               "replaced it"))


def check_index(index: Path, docs: list[Doc], out: list[Finding]) -> None:
    rel = str(index)
    if not index.exists():
        out.append(Finding("M004", "error", rel, 1, "index README.md is missing"))
        return

    lines = index.read_text(encoding="utf-8").split("\n")
    rows: dict[str, tuple[int, str, str | None]] = {}
    for idx, line in enumerate(lines, start=1):
        if not is_table_row(line) or is_separator_row(line):
            continue
        m = re.search(r"\[(\d{4})\]\(([^)]+)\)", line)
        if not m:
            continue
        status = next((s for s in STATUS_EMOJI if re.search(rf"\b{s}\b", line)), None)
        rows[m.group(1)] = (idx, m.group(2), status)

    for doc in docs:
        fm = FNAME_RE.match(doc.path.name)
        num = fm.group(1) if fm else doc.number  # the filename is the canonical id
        if not num:
            continue
        if num not in rows:
            out.append(Finding("M004", "error", rel, 1,
                               f"{doc.path.name} is not in the index — add the row in "
                               "the same change"))
            continue
        lineno, target, status = rows[num]
        if (index.parent / target).name != doc.path.name:
            out.append(Finding("M004", "error", rel, lineno,
                               f"row {doc.number} points at {target}, "
                               f"not {doc.path.name}"))
        if status != doc.status:
            out.append(Finding("M005", "error", rel, lineno,
                               f"index says {status or 'no status'}, record says "
                               f"{doc.status or 'no valid status'}"))

    numbers = {m.group(1) for d in docs if (m := FNAME_RE.match(d.path.name))}
    for num, (lineno, target, _) in rows.items():
        if num not in numbers and not (index.parent / target).exists():
            out.append(Finding("M004", "error", rel, lineno,
                               f"index row {num} has no record file"))

    mask = code_mask(lines)
    fence_start, hits = 0, 0
    for idx, line in enumerate(lines, start=1):
        if not mask[idx - 1]:
            continue
        if FENCE_RE.match(line):
            if fence_start and hits >= 2:
                out.append(Finding("D004", "warn", rel, fence_start,
                                   "index inlines a copy of the template — link "
                                   "template.md so there is one copy to maintain"))
            fence_start, hits = (0, 0) if fence_start else (idx, 0)
            continue
        if any(re.match(rf"^\s*(?:#+\s*)?{s}\b", line, re.I) for s in REQUIRED_SECTIONS):
            hits += 1


def check_duplication(docs: list[Doc], corpus: list[Path], template: Path,
                      out: list[Finding]) -> dict[str, int]:
    """Shingle overlap: ADR vs ADR, ADR vs other docs, ADR vs the template."""

    def shingles(path: Path, text: str) -> dict[tuple[str, ...], int]:
        lines = text.split("\n")
        mask = code_mask(lines)
        toks: list[str] = []
        for i, line in enumerate(lines, start=1):
            if mask[i - 1] or is_separator_row(line):
                continue
            toks.extend(tokens(to_prose(line)))
        return {
            tuple(toks[i:i + SHINGLE]): i
            for i in range(max(0, len(toks) - SHINGLE + 1))
        }

    def token_list(doc: Doc) -> list[str]:
        toks = []
        for i, line in enumerate(doc.lines, start=1):
            if doc.code_mask[i - 1] or is_separator_row(line):
                continue
            toks.extend(tokens(to_prose(line)))
        return toks

    others: dict[Path, dict] = {}
    for path in corpus:
        try:
            others[path] = shingles(path, path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            continue
    tmpl = shingles(template, template.read_text(encoding="utf-8")) if template.exists() else {}

    def longest_run(toks: list[str], pool: dict) -> tuple[int, str]:
        best_len, best_text = 0, ""
        i = 0
        while i <= len(toks) - SHINGLE:
            if tuple(toks[i:i + SHINGLE]) in pool:
                end = i + SHINGLE
                while end < len(toks) and tuple(toks[end - SHINGLE + 1:end + 1]) in pool:
                    end += 1
                if end - i > best_len:
                    best_len, best_text = end - i, " ".join(toks[i:end])
                i = end
            else:
                i += 1
        return best_len, best_text

    dup_counts: dict[str, int] = {}
    for doc in docs:
        rel = str(doc.path)
        toks = token_list(doc)
        mine = {
            tuple(toks[i:i + SHINGLE])
            for i in range(max(0, len(toks) - SHINGLE + 1))
        }
        worst = 0

        shared_tmpl = mine & set(tmpl)
        if shared_tmpl:
            n, text = longest_run(toks, tmpl)
            out.append(Finding("D003", "error", rel, 1,
                               f"{len(shared_tmpl)} phrase(s) still verbatim from the "
                               f"template: “{text[:70]}…”"))

        for path, pool in others.items():
            if path == doc.path:
                continue
            shared = mine & set(pool)
            if len(shared) >= SHARED_SHINGLES:
                n, text = longest_run(toks, pool)
                worst = max(worst, len(shared))
                out.append(Finding("D001", "warn", rel, 1,
                                   f"{len(shared)} phrase(s) also in {path}"
                                   f" — longest shared run ({n} words): “{text[:70]}…”"
                                   " — link it, do not restate it"))
        dup_counts[rel] = worst

        seen: dict[str, list[int]] = {}
        for sec in doc.sections:
            for lineno, prose in section_prose(sec, doc.code_mask):
                for sentence in SENTENCE_SPLIT_RE.split(prose):
                    key = " ".join(tokens(sentence))
                    if len(key.split()) < 6:
                        continue
                    seen.setdefault(key, []).append(lineno)
        for key, hits in seen.items():
            if len(hits) > 1:
                where = ", ".join(str(n) for n in sorted(set(hits)))
                out.append(Finding("D002", "warn", rel, hits[0],
                                   f"sentence appears {len(hits)}x (line{'s' if len(set(hits)) > 1 else ''} "
                                   f"{where}): “{key[:60]}…”"))
    return dup_counts


# -------------------------------------------------------------------- reporting


def stats_table(rows: list[tuple[str, dict]]) -> str:
    header = f"{'record':<34}{'words':>7}{'ctx':>6}{'dec':>6}{'alt':>6}{'con':>6}{'col':>6}{'dup':>6}"
    lines = [header, "-" * len(header)]
    for name, st in rows:
        sec = st.get("sections", {})
        lines.append(
            f"{name:<34}{st.get('words', 0):>7}"
            f"{sec.get('Context', 0):>6}{sec.get('Decision', 0):>6}"
            f"{sec.get('Alternatives considered', 0):>6}"
            f"{sec.get('Consequences', 0):>6}"
            f"{st.get('longest_line', 0):>6}{st.get('dup', 0):>6}"
        )
    lines.append("")
    lines.append(f"budgets: words≤{WORDS_TOTAL_WARN} ctx≤{SECTION_BUDGET['Context']} "
                 f"dec≤{SECTION_BUDGET['Decision']} "
                 f"alt≤{SECTION_BUDGET['Alternatives considered']} "
                 f"con≤{SECTION_BUDGET['Consequences']} col≤{LINE_LENGTH} "
                 f"dup=shared 7-word phrases")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="ADR quality gate")
    ap.add_argument("paths", nargs="*", help="records to check (default: all)")
    ap.add_argument("--dir", default=str(DECISIONS_DIR), help="decisions directory")
    ap.add_argument("--strict", action="store_true", help="warnings fail too")
    ap.add_argument("--stats", action="store_true", help="print the metrics table")
    ap.add_argument("--json", action="store_true", help="emit findings as JSON")
    ap.add_argument("--no-index", action="store_true", help="skip index checks")
    args = ap.parse_args(argv)

    root = Path(args.dir)
    if not root.is_dir():
        print(f"adr-gate: no such directory: {root}", file=sys.stderr)
        return 2

    all_records = sorted(p for p in root.glob("*.md") if FNAME_RE.match(p.name))
    if args.paths:
        targets = [Path(p) for p in args.paths]
        missing = [p for p in targets if not p.is_file()]
        if missing:
            print(f"adr-gate: not a file: {missing[0]}", file=sys.stderr)
            return 2
    else:
        targets = all_records
        if not targets:
            print(f"adr-gate: no records found in {root}")
            return 0

    known = {m.group(1) for p in all_records if (m := FNAME_RE.match(p.name))}
    docs = [parse(p) for p in targets]

    findings: list[Finding] = []
    stats_rows: list[tuple[str, dict]] = []
    for doc in docs:
        st: dict = {}
        check_structure(doc, findings)
        check_concision(doc, findings, st)
        check_maintainability(doc, findings, known)
        check_accuracy(doc, findings)
        stats_rows.append((doc.path.name, st))

    corpus = [
        p for p in Path(args.dir).parent.rglob("*.md")
        if p.name.lower() not in {"readme.md", "template.md", "gate.md"}
    ]
    dups = check_duplication(docs, corpus, root / "template.md", findings)
    for name, st in stats_rows:
        st["dup"] = dups.get(str(root / name), 0)

    if not args.no_index and not args.paths:
        check_index(root / "README.md", docs, findings)

    order = {"error": 0, "warn": 1}
    findings.sort(key=lambda f: (f.path, order[f.severity], f.line, f.code))
    errors = sum(1 for f in findings if f.severity == "error")
    warns = len(findings) - errors

    if args.json:
        print(json.dumps({
            "records": len(docs),
            "errors": errors,
            "warnings": warns,
            "findings": [vars(f) for f in findings],
            "stats": {name: st for name, st in stats_rows},
        }, indent=2))
    else:
        for f in findings:
            print(f.as_text())
        if args.stats:
            print()
            print(stats_table(stats_rows))
        print()
        verdict = "PASS" if not errors and not (args.strict and warns) else "FAIL"
        print(f"{verdict} — {len(docs)} record(s), {errors} error(s), {warns} warning(s)"
              + (" [strict]" if args.strict else ""))

    return 1 if errors or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

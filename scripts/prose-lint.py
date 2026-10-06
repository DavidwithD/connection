#!/usr/bin/env python3
"""Lint newly written prose against docs/README.md "How it is written".

Reads a Claude Code PostToolUse payload on stdin, lints only the text the tool
just added, and prints findings as additionalContext so they arrive in the same
turn as the write rather than at commit time.

Only the added text is read. Prose already in a touched file is somebody else's
sentence, and a linter that reports it every time a neighbour is edited teaches
the reader to skip the whole report.

Also runs standalone for testing: prose-lint.py FILE... reads whole files.

Two findings are measurable and the rest are guesses.

- `L001` counts the words in a sentence.
- `L006` matches a term from the [block] list in scripts/plain-terms.txt.

The docs gate runs both over every file and fails on them. The other checks are
patterns that often go with figurative writing. A regex cannot detect a metaphor.
The writer applies the rule in docs/README.md. This script checks the part a count
or a word list can settle.

Headings and table cells are read for terms. Only paragraphs, list items and
headings are read for the sentence checks.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

MAX_WORDS = 25

# Nouns that read as subjects without naming an actor. Suffixes, plus the ones
# this repo has actually reached for.
ABSTRACT_SUFFIX = re.compile(r"(?:ness|ity|ance|ence|ment|tion|sion|ship|ism)$", re.I)
# Figurative wherever they appear. The repo's old figurative nouns are in
# scripts/plain-terms.txt, and L006 reports those.
ABSTRACT_TELLS = {"stillness", "rhythm", "cadence", "silence", "elegance"}
# Pronouns and quantifiers that are abstract by nature and fine as subjects.
SUBJECT_OK = {
    "nothing", "something", "anything", "everything", "nobody", "somebody",
    "anybody", "everybody", "none", "no", "neither", "either", "it", "there",
    "we", "you", "i", "they", "he", "she", "who", "what", "which", "that",
    "this", "these", "those", "one", "each", "every", "any", "all", "both",
}
# Concrete despite the suffix.
SUBJECT_EXEMPT = {
    "setting", "settings", "heading", "string", "listing", "meaning", "thing",
    "warning", "finding", "binding", "section", "function", "connection",
    "position", "transaction", "selection", "option", "version", "extension",
    "convention", "description", "definition", "documentation", "application",
    "relationship", "component", "element", "argument", "document", "statement",
    "decision",
    "comment", "increment", "environment", "requirement", "attachment",
    "capability", "capabilities", "identity", "entity", "priority", "quantity",
    "quality", "majority", "minority", "security", "utility", "visibility",
    "ability", "density", "direction", "position", "revision", "permission",
    "sentence", "sentences", "difference", "reference", "preference",
    "evidence", "audience", "sequence", "consequence", "consequences",
    "instance", "performance", "appearance", "balance", "distance",
}
# Verbs that give an inanimate subject a will of its own.
PERSONIFIED = {
    "wants", "want", "asks", "ask", "asked", "costs", "cost", "buys", "buy",
    "bought", "pays", "pay", "paid", "earns", "earn", "spends", "spend",
    "refuses", "refuse", "decides", "decide", "remembers", "remember",
    "forgets", "forget", "complains", "complain", "learns", "learn", "hands",
    "chooses", "choose", "prefers", "prefer", "believes", "believe", "knows",
    "know", "cares", "care", "hopes", "hope", "lies", "waits", "wait",
}
# Nouns for parts of the page and gestures. Code or a person acts on these. A
# sentence that makes one the actor hides who did the work: "a click fills the
# panel" means a click handler in main.ts fills it.
UI_NOUNS = {
    "click", "clicks", "drag", "drags", "box", "boxes", "panel", "panels", "map",
    "input", "inputs", "caret", "page", "pages", "camera", "gesture", "gestures",
    "button", "buttons", "menu", "menus", "pan", "press", "release", "list", "row",
    "rows", "tab", "pointer", "slider",
}
# Verbs that make one of those nouns an agent. PERSONIFIED is added to these.
AGENT_VERBS = PERSONIFIED | {
    "takes", "keeps", "leaves", "fills", "answers", "tells", "says", "owns",
    "stands", "names", "refuses", "gives", "needs", "lets", "hears", "sees",
}
PERSON_SUBJECT = {
    "reader", "readers", "somebody", "nobody", "anybody", "everybody",
    "someone", "no", "person", "people", "author", "maintainer", "caller",
    "user", "reviewer", "we", "you", "i", "they", "he", "she", "who",
}

FENCE = re.compile(r"^\s*(?:```|~~~)")
TABLE_ROW = re.compile(r"^\s*\|")
HEADING = re.compile(r"^\s*#{1,6}\s")
META = re.compile(r"^\s*\*\*(?:Status|Date|Deciders|Supersed\w*|Refs)\b")
BULLET = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-]*")

# One token, whatever is inside: an identifier is not a sentence's worth of words.
CODE_SPAN = re.compile(r"`[^`]*`")
LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
BOLD_ITALIC = re.compile(r"[*_]{1,3}")

GERUND_COPULA = re.compile(
    r"^\s*\w+ing\b[^.!?]*?\b(?:is|are|was|were)\b[^.!?]*?\b\w+ing\b", re.I
)
IS_NOT_A = re.compile(r"\b(?:is|are|was|were)\s+not\s+(?:a|an|the)\b", re.I)
COMMENT_LINE = re.compile(r"^\s*(?://+|\*|/\*)\s*(.*)$")


def plain(line: str) -> str:
    """Markdown scaffolding out, so a count measures prose."""
    line = CODE_SPAN.sub("CODE", line)
    line = LINK.sub(r"\1", line)
    line = BOLD_ITALIC.sub("", line)
    return line


def front_matter(text: str) -> int:
    """How many lines of YAML front matter open the file, or 0.

    A skill's `description` is trigger text for a model, and a list of phrases is
    its job. The sentence checks skip it. The term check still reads it.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return 0
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return i + 1
    return 0


def prose_lines(text: str, base: int = 1) -> list[tuple[int, str]]:
    """Numbered prose lines, with code, tables and metadata dropped.

    A heading is kept, with its hashes removed and a full stop added. The full
    stop makes the sentence split keep it apart from the paragraph after it.
    """
    out: list[tuple[int, str]] = []
    in_fence = False
    skip = front_matter(text)
    for offset, raw in enumerate(text.splitlines()):
        if offset < skip:
            continue
        if FENCE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence or TABLE_ROW.match(raw) or META.match(raw):
            continue
        body = plain(raw).strip()
        if not body:
            continue
        if HEADING.match(raw):
            body = HEADING.sub("", plain(raw)).strip().rstrip(".") + "."
        out.append((base + offset, body))
    return out


def comment_lines(text: str, base: int = 1) -> list[tuple[int, str]]:
    """The prose inside // and /* */ comments, for a source file."""
    out: list[tuple[int, str]] = []
    for offset, raw in enumerate(text.splitlines()):
        m = COMMENT_LINE.match(raw)
        if m and m.group(1).strip():
            out.append((base + offset, plain(m.group(1)).strip()))
    return out


def term_lines(text: str, base: int, source: str) -> list[tuple[int, str]]:
    """Every line that can hold a term: prose, headings and table cells.

    A code span is removed first. An identifier in backticks names code, and the
    final sweep over the code covers identifiers.
    """
    if source == "code":
        return comment_lines(text, base)
    out: list[tuple[int, str]] = []
    in_fence = False
    for offset, raw in enumerate(text.splitlines()):
        if FENCE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence or META.match(raw):
            continue
        body = plain(raw).strip()
        if body:
            out.append((base + offset, body))
    return out


TERMS_FILE = Path(__file__).resolve().parent / "plain-terms.txt"


def load_terms(path: Path = TERMS_FILE) -> tuple[dict[str, str], dict[str, str], set[str]]:
    """The [block] and [check] terms, each mapped to its replacement, and [keep]."""
    block: dict[str, str] = {}
    check: dict[str, str] = {}
    keep: set[str] = set()
    section = ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return block, check, keep
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            continue
        if section == "keep":
            keep.add(line)
            continue
        forms, _, instead = line.partition(":")
        target = block if section == "block" else check if section == "check" else None
        if target is None:
            continue
        for form in forms.split(","):
            if form.strip():
                target[form.strip().lower()] = instead.strip()
    return block, check, keep


BLOCK_TERMS, CHECK_TERMS, KEEP_TERMS = load_terms()
TERM_WORD = re.compile(r"(?<![\w-])[A-Za-z]+(?![\w])")


def term_findings(line: str) -> list[tuple[str, str]]:
    """L006 and L008 for one line, once per distinct word."""
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in TERM_WORD.finditer(line):
        word = m.group(0)
        low = word.lower()
        if word in KEEP_TERMS or low in seen:
            continue
        if low in BLOCK_TERMS:
            seen.add(low)
            found.append(("L006", f"“{word}” is a retired term — use "
                                  f"“{BLOCK_TERMS[low]}” (docs/glossary.md)"))
        elif low in CHECK_TERMS:
            seen.add(low)
            found.append(("L008", f"“{word}” may be a retired term — if it is "
                                  f"figurative, use “{CHECK_TERMS[low]}”"))
    return found


def units(lines: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Paragraphs and list items, each as one unit, so a sentence is not split
    across a wrap. A bullet stays its own unit."""
    out: list[tuple[int, str]] = []
    buf: list[str] = []
    start = 0
    prev = None
    for lineno, body in lines:
        breaks = BULLET.match(body) or (prev is not None and lineno != prev + 1)
        if breaks and buf:
            out.append((start, " ".join(buf)))
            buf = []
        if not buf:
            start = lineno
        buf.append(BULLET.sub("", body))
        prev = lineno
    if buf:
        out.append((start, " ".join(buf)))
    return out


def head_subject(sentence: str) -> str:
    """The sentence's first candidate subject word, lowercased."""
    words = WORD.findall(sentence)
    skip = {"the", "a", "an", "that", "this", "its", "their", "our", "his",
            "her", "every", "each", "any", "some", "one", "two", "only", "so",
            "and", "but", "then", "now", "also", "still", "even", "just"}
    for w in words:
        low = w.lower()
        if low in skip:
            continue
        return low
    return ""


def check(sentence: str) -> list[tuple[str, str]]:
    """Findings for one sentence, as (code, why)."""
    found: list[tuple[str, str]] = []
    n = len(WORD.findall(sentence))
    if n > MAX_WORDS:
        found.append(("L001", f"{n} words, over {MAX_WORDS} — split it"))

    subject = head_subject(sentence)
    abstract = subject and subject not in SUBJECT_OK and subject not in SUBJECT_EXEMPT and (
        subject in ABSTRACT_TELLS or ABSTRACT_SUFFIX.search(subject)
    )
    if abstract:
        found.append(("L002", f"“{subject}” is not an actor — name the file, "
                              "function or person the sentence is about"))

    if GERUND_COPULA.search(sentence):
        found.append(("L003", "reads as an aphorism: “-ing … is … -ing”"))
    if IS_NOT_A.search(sentence) and n <= 12:
        found.append(("L004", "short “X is not a Y” — say what it is"))

    # Only when the verb is the subject's own, and no person is named anywhere in
    # the sentence. "what the reader asked for" is a person asking, whatever noun
    # the sentence opened with.
    tokens = [w.lower() for w in WORD.findall(sentence)]
    if not set(tokens) & PERSON_SUBJECT:
        at = tokens.index(subject) if subject in tokens else -1
        window = tokens[at + 1:at + 3] if at >= 0 else []
        # "is asked for" is somebody asking, not the subject wanting something.
        passive = {"is", "are", "was", "were", "be", "been"} & set(window)
        verbs = set(window) & PERSONIFIED
        if verbs and not abstract and not passive:
            found.append(("L005", f"“{sorted(verbs)[0]}” gives “{subject}” a will "
                                  "of its own"))
        # L007 looks at every UI noun, not only the first word. "On a click, the
        # panel keeps its values" makes the panel the actor in its second clause.
        for at, token in enumerate(tokens):
            if token not in UI_NOUNS:
                continue
            after = tokens[at + 1:at + 3]
            if {"is", "are", "was", "were", "be", "been"} & set(after[:1]):
                continue
            agent = [w for w in after[:1] if w in AGENT_VERBS]
            if agent and not (token == subject and "L005" in {c for c, _ in found}):
                found.append(("L007", f"“{token} {agent[0]}” makes a part of the page "
                                      "the actor — name the code or the person"))
                break
    return found


# A heading is a label, so the guesses about abstract subjects and aphorisms do
# not apply to it. Length, terms and a page part as the actor still do.
HEADING_CODES = {"L001", "L006", "L007", "L008"}


def findings(text: str, base: int, source: str) -> list[tuple[str, int, str, str]]:
    """Every finding, as (code, line, why, quote)."""
    lines = comment_lines(text, base) if source == "code" else prose_lines(text, base)
    headings = set()
    if source != "code":
        headings = {base + i for i, raw in enumerate(text.splitlines()) if HEADING.match(raw)}
    out: list[tuple[str, int, str, str]] = []
    for lineno, unit in units(lines):
        for sentence in SENTENCE_SPLIT.split(unit):
            sentence = sentence.strip()
            if not sentence:
                continue
            for code, why in check(sentence):
                if lineno in headings and code not in HEADING_CODES:
                    continue
                out.append((code, lineno, why, sentence))
    for lineno, line in term_lines(text, base, source):
        for code, why in term_findings(line):
            out.append((code, lineno, why, line))
    out.sort(key=lambda f: (f[1], f[0]))
    return out


def lint(text: str, base: int, source: str) -> list[str]:
    report: list[str] = []
    for code, lineno, why, sentence in findings(text, base, source):
        quote = sentence if len(sentence) <= 70 else sentence[:67] + "…"
        report.append(f"  {code}  line {lineno}  {why}\n        “{quote}”")
    return report


def kind(path: str) -> str | None:
    if path.endswith(".md"):
        return "prose"
    if path.endswith((".ts", ".mjs", ".js")):
        return "code"
    return None


def added_text(payload: dict) -> tuple[str, str]:
    """The path written, and only the text this call added."""
    ti = payload.get("tool_input") or {}
    path = ti.get("file_path") or ""
    if "content" in ti:
        return path, ti["content"]
    if "new_string" in ti:
        return path, ti["new_string"]
    if isinstance(ti.get("edits"), list):
        return path, "\n".join(e.get("new_string", "") for e in ti["edits"])
    return path, ""


def line_of(path: str, added: str) -> int:
    """Where the added text landed, so a finding points into the file."""
    try:
        with open(path, encoding="utf-8") as fh:
            whole = fh.read()
    except OSError:
        return 1
    at = whole.find(added.split("\n", 1)[0]) if added else -1
    return whole.count("\n", 0, at) + 1 if at >= 0 else 1


def main() -> int:
    # The findings quote the prose, so they carry em dashes and curly quotes. A
    # cp932 console would kill the hook on its own output.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    if len(sys.argv) > 1:  # standalone: whole files, for testing the checks
        for path in sys.argv[1:]:
            source = kind(path)
            if not source:
                continue
            with open(path, encoding="utf-8") as fh:
                report = lint(fh.read(), 1, source)
            print(f"{path}: {len(report)} finding(s)")
            for line in report:
                print(line)
        return 0

    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 0

    path, added = added_text(payload)
    source = kind(path)
    if not source or not added.strip():
        return 0

    report = lint(added, line_of(path, added), source)
    if not report:
        return 0

    body = (
        f"prose-lint on {path} — docs/README.md \"How it is written\". "
        f"L001 is a word count and L006 is a retired term; the docs gate fails on "
        f"both. L002-L005, L007 and L008 are guesses; read the sentence and judge. "
        f"No check here sees a metaphor.\n" + "\n".join(report)
    )
    json.dump({"hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": body,
    }}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Self-test for the docs gate: does each check still compare anything?

The docs gate's own worst failure is silence. Every extractor is a pattern over how
this repo happens to write things, so a reorganised document or a refactored helper
can leave a check matching nothing at all — and a check that compares nothing
reports PASS for ever. docs/checks.md calls that "worse than no gate because it is
believed", and the `X000` rules exist to catch it.

Nothing proved the X000 rules themselves fire. This does.

It works on a throwaway copy of the tree, mutates one document, and asserts the gate
notices. Three kinds of case per bound check:

    missing   the bound document is gone            -> X000
    hollow    the document is there, the fact is not -> X000
    drift     the fact is there and disagrees        -> the check's own rule

The clean tree is asserted to pass first, so a failure here is never ambiguous
between "the mutation did nothing" and "the tree was already broken".

Usage:
    scripts/docs-gate-selftest.py           # every case
    scripts/docs-gate-selftest.py -v        # print each case as it runs

Exit: 0 all cases held, 1 a case did not, 2 bad invocation.
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATE = HERE / "docs-gate.py"
ROOT = HERE.parent


def load_gate():
    """The gate as a module, for its BOUND_DOCS and nothing else.

    Which document each check reads is taken from the gate rather than restated
    here, so moving a binding stays the one-line edit it was made to be. Everything
    else in this file is deliberately independent: a test that shares its subject's
    extraction logic agrees with it, bug for bug.
    """
    spec = importlib.util.spec_from_file_location("docs_gate", GATE)
    if spec is None or spec.loader is None:
        raise SystemExit(f"selftest: cannot load {GATE}")
    module = importlib.util.module_from_spec(spec)
    # Registered before it executes: the gate declares dataclasses under
    # `from __future__ import annotations`, and resolving those annotations looks the
    # module up in sys.modules. Absent, the import dies inside dataclasses with an
    # error naming neither file.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BOUND_DOCS = load_gate().BOUND_DOCS

# Copying the tree is the whole cost of this script, so skip what the gate never
# reads. These are the gate's own SKIP_DIRS plus the two big gitignored trees.
SKIP = {
    ".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__",
    "vendor", ".dynamodb-data", ".next",
}

# A document with no tables and no fenced blocks. Enough to be readable, not enough
# for any extractor to find its fact — which is the "hollow" case.
HOLLOW = "# Placeholder\n\nProse, and nothing an extractor can match.\n"


@dataclass
class Case:
    """One mutation, and the rule the gate is expected to raise for it."""

    check: str
    kind: str          # "missing" | "hollow" | "drift"
    expect: str        # the rule code
    note: str


def table_headed(text: str, *headers: str) -> tuple[int, int] | None:
    """Line span of the first markdown table whose header holds all of `headers`.

    A deliberately independent reimplementation. Sharing the gate's own table
    finder would make this test agree with the thing it is testing, which is how a
    test comes to certify a bug.
    """
    want = {h.lower() for h in headers}
    lines = text.split("\n")
    for idx, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        if idx + 1 >= len(lines) or not re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[idx + 1]):
            continue
        cells = {c.strip().lower() for c in line.strip().strip("|").split("|")}
        if not want <= cells:
            continue
        end = idx + 2
        while end < len(lines) and lines[end].lstrip().startswith("|"):
            end += 1
        return idx, end
    return None


def drop_table(text: str, *headers: str) -> str:
    span = table_headed(text, *headers)
    if span is None:
        raise SystemExit(f"selftest: no table headed {headers} to drop — fix the test")
    lines = text.split("\n")
    return "\n".join(lines[: span[0]] + lines[span[1] :])


def drop_row(text: str, *headers: str) -> str:
    """Remove one body row, so the document disagrees rather than falls silent."""
    span = table_headed(text, *headers)
    if span is None:
        raise SystemExit(f"selftest: no table headed {headers} to edit — fix the test")
    lines = text.split("\n")
    first_body = span[0] + 2
    if first_body >= span[1]:
        raise SystemExit(f"selftest: table headed {headers} has no rows — fix the test")
    return "\n".join(lines[:first_body] + lines[first_body + 1 :])


def drop_fenced(text: str) -> str:
    """Remove every fenced block, which is where the layout tree lives."""
    out, inside = [], False
    for line in text.split("\n"):
        if re.match(r"^\s*(```|~~~)", line):
            inside = not inside
            continue
        if not inside:
            out.append(line)
    return "\n".join(out)


# How to take each bound check's fact away, and the rule it must then raise.
#
# The codes are spelled out rather than derived from the check's name. They do not
# follow from it — `commands` raises N000 and `engines` raises G000 — and a test that
# guesses them tests its own guess.
BOUND = {
    "env": (lambda t: drop_table(t, "Variable"), "E000"),
    "commands": (lambda t: drop_table(t, "Command"), "N000"),
    "engines": (lambda t: drop_table(t, "Why"), "G000"),
    "keys": (lambda t: drop_table(t, "Partition key", "Sort key"), "K000"),
    "layout": (drop_fenced, "L000"),
}

# Drift: the fact is present and wrong. This is the half that proves a check is
# still comparing, where X000 only proves it is still looking.
DRIFT = {
    "commands": (lambda t: drop_row(t, "Command"), "N001"),
    "keys": (lambda t: drop_row(t, "Partition key", "Sort key"), "K001"),
}


def bound_document(check: str) -> str:
    """The first document the gate declares for this check."""
    docs = BOUND_DOCS.get(check)
    if not docs:
        raise SystemExit(
            f"selftest: the gate declares no document for {check!r} — either the "
            "check stopped being a bound one, or BOUND_DOCS lost an entry"
        )
    return docs[0]


CASES: list[Case] = []
for check, (_, code) in BOUND.items():
    CASES.append(Case(check, "missing", code, "the bound document is gone"))
    CASES.append(Case(check, "hollow", code,
                      "the document is there and the fact is not"))
for check, (_, code) in DRIFT.items():
    CASES.append(Case(check, "drift", code, "the fact is present and disagrees"))


def run_gate(root: Path, check: str) -> list[dict]:
    """One check against one tree, as findings."""
    proc = subprocess.run(
        [sys.executable, str(GATE), "--root", str(root), "--only", check, "--json"],
        capture_output=True, text=True,
    )
    if proc.returncode == 2:
        raise SystemExit(f"selftest: gate rejected its own invocation: {proc.stderr}")
    try:
        return json.loads(proc.stdout)["findings"]
    except (json.JSONDecodeError, KeyError) as err:
        raise SystemExit(f"selftest: gate produced no JSON ({err}): {proc.stdout[:400]}")


def copy_tree(dest: Path) -> None:
    shutil.copytree(
        ROOT, dest, dirs_exist_ok=True,
        ignore=lambda _d, names: [n for n in names if n in SKIP],
    )


def main(argv: list[str]) -> int:
    verbose = "-v" in argv or "--verbose" in argv
    if any(a not in {"-v", "--verbose"} for a in argv):
        print(__doc__)
        return 2

    failures: list[str] = []

    with tempfile.TemporaryDirectory(prefix="docs-gate-selftest-") as tmp:
        clean = Path(tmp) / "clean"
        copy_tree(clean)

        # Positive control. Without this a mutation that silently does nothing looks
        # exactly like a gate that correctly found no fault.
        for check in BOUND:
            findings = run_gate(clean, check)
            errors = [f for f in findings if f["severity"] == "error"]
            if errors:
                failures.append(
                    f"{check}/control: the unmutated tree already fails "
                    f"({errors[0]['code']} {errors[0]['path']}:{errors[0]['line']})"
                )
            elif verbose:
                print(f"  ok  {check}/control        clean tree passes")

        for case in CASES:
            work = Path(tmp) / f"{case.check}-{case.kind}"
            copy_tree(work)

            mutate, _ = DRIFT[case.check] if case.kind == "drift" \
                else BOUND[case.check]
            target = work / bound_document(case.check)

            if case.kind == "missing":
                target.unlink()
            elif case.kind == "hollow":
                target.write_text(HOLLOW, encoding="utf-8")
            else:
                target.write_text(
                    mutate(target.read_text(encoding="utf-8")), encoding="utf-8"
                )

            codes = {f["code"] for f in run_gate(work, case.check)}
            label = f"{case.check}/{case.kind}"
            if case.expect in codes:
                if verbose:
                    print(f"  ok  {label:<24} {case.expect} — {case.note}")
            else:
                failures.append(
                    f"{label}: expected {case.expect} when {case.note}, "
                    f"got {sorted(codes) or 'nothing at all'}"
                )

    print()
    if failures:
        for line in failures:
            print(f"FAIL {line}")
        print(f"\nFAIL — {len(CASES)} case(s), {len(failures)} did not hold")
        print("\nA check that raises nothing when its fact is gone is a check "
              "reporting PASS for ever. Fix the extractor, not this test.")
        return 1

    print(f"PASS — {len(CASES)} case(s), every bound check still compares")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

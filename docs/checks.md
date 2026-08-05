# Docs checks

What the living documents must clear before they land.

```
npm run docs                    # every check
scripts/docs-gate.py --json     # for a hook or CI
scripts/docs-gate.py --strict   # warnings fail too
scripts/docs-gate.py --only env # one check, while fixing it
```

`npm run hooks:install` puts this and the [decision gate](decisions/GATE.md) on every
commit, over the staged tree. Errors block, warnings print and pass, and
`DOCS_GATE_STRICT=1` makes warnings block too.

## What we're actually protecting

Records rot by sitting still, and their gate is built for that. The two living
directories fail the other way round. They hold statements about the code — this
directory contains these files, that route exists, this variable is read — and every one
of them can be made false by a change that never opens the document. Nobody edits a page
to make it wrong. A rename does it, silently, and the page goes on looking maintained.

So there is nothing here about writing. Each check finds one fact in the code, finds the
same fact in the document, and fails when the two disagree. Only identifiers are
compared — a path, a variable name, a filename — never wording, because the sentence
beside each identifier is the part a person came for and no script can grade it.

## What is bound to what

| Check | Code says | Document says |
|---|---|---|
| `env` | every variable the code reads | the README's variable table, [.env.example](../.env.example) |
| `commands` | the scripts in `package.json` | the README's command table |
| `engines` | the runtime range npm demands | the README's prerequisites |
| `routes` | the handlers [the API](../src/server/index.ts) registers | its own header comment, and [the client](../web/src/api.ts) |
| `keys` | key attributes and index names | the README's data model |
| `layout` | the files in each directory | the README's layout tree |
| `paths` | what exists | every link and backticked path |

Both directions are checked wherever both mean something. A route the header comment
omits is a contract the client cannot rely on; a route it promises and nothing serves is
a lie in the opposite direction. Same for a file missing from the layout tree, and for a
variable documented but never read — somebody will set that one and wait.

`engines` is the exception, and runs one way only: the prerequisites also name a JRE and
a shell, which npm knows nothing about and a reverse check would call undeclared.

## Rules

**Bindings** — `E001` a knob read and documented nowhere · `E002` documented and read by
nothing · `N001`/`N002` a script missing from the command table, or a row naming no
script · `G001` a version `engines` demands that the prerequisites do not name · `R001`/
`R002` a route served but not listed, or listed but not served · `R003` the client calling
a path nothing serves · `K001` a key attribute or index absent from the data model ·
`L001` the layout tree naming what does not exist · `L002` a source file the tree omits ·
`M001` a broken relative link · `M002` a backticked path with nothing behind it.

**Extraction** — `E000`, `N000`, `G000`, `R000`, `K000`, `L000`, `M000`: the check found nothing
at all to compare. Every extractor is a pattern over how this repo happens to write
things, so each one is required to match something. A gate that quietly stops looking
reports PASS for ever, and is worse than no gate because it is believed.

## Where a check cannot reach

- **Is the sentence true?** The gate knows `explore.ts` exists, never that it does what
  its line claims. A description that was right once and is now merely plausible reads
  exactly like a correct one.
- **Is the number right?** A default in prose and a default in code are two literals
  nothing compares. Cite the file instead of copying the value.
- **Was a decision made?** The hook nudges when a commit changes something whose shape is
  a commitment and records nothing, then gets out of the way. Blocking would buy empty
  records, which cost more than the missing one.
- **Should this page exist?** Nothing measures whether a document is read. A page nobody
  opens is worth deleting, and only a person can say which one that is.

Why identifiers rather than generated tables is in
[ADR 0014](decisions/0014-binding-the-docs-to-the-code.md).

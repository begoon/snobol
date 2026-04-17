# CLAUDE.md

Guidance for Claude Code working in this repo.

## Running the code

```
just ci          # typecheck + tests
just test        # tests only
just typecheck   # tsc --noEmit
bun src/cli.ts examples/sieve.sno   # run a .sno program
bun src/cli.ts foo.sno < input.txt  # with stdin piped to INPUT
```

There is no build step — Bun runs TypeScript directly via `.ts` imports. `allowImportingTsExtensions` is on.

## Architecture map

Pipeline: `src/cli.ts` → `tokenize` (`src/lexer.ts`) → `parse` (`src/parser.ts`) → `Interpreter.run` (`src/interpreter.ts`).

- **Lexer** is line-oriented. `mergeContinuations` runs *before* tokenization and merges `+`/`.` continuation lines into the preceding non-comment line. Columns 1 are special: `*` → comment, letter → label, whitespace → statement body. Inside the body, WS is a real token (`WS`) because adjacency matters for concatenation.
- **Parser** builds an AST. Statement shape (`assign` / `subscriptAssign` / `match` / `matchReplace` / `eval`) is derived from the *parsed body* in `shapeStatement`, not via lookahead. Body is always parsed as one expression, optionally followed by `= expr`. If the body is a `ref`, it's an assignment target; if it's a `concat` starting with a `ref`, the first part is the match subject and the rest is the pattern; if it's a `subscript`, it's a subscript assignment.
- **Pattern engine** (`src/pattern.ts`) is a generator-based backtracking matcher. Each `matchAt` yields `{ pos, pending }` states; `.`-captures append to `pending` (applied on overall success via `MatchEnv.setVar`); `$`-captures fire immediately as a side effect and persist across backtracking. `FENCE` and `ABORT` use exception-based cut — `FenceCut` is caught per-start-position, `AbortMatch` at the outermost scan.
- **Interpreter** is tree-walking. `runStatements` is shared between top-level execution and function bodies — the `fn` parameter switches on function-call mode (where `:(RETURN)` and `:(FRETURN)` short-circuit). Expression eval returns `EvalResult = OK(value) | FAIL`; failure propagates through the statement and drives the `:F()` branch.

## SNOBOL4 quirks the parser embodies

- **Binary operators require WS on both sides.** `X + Y` is addition; `X +Y` is concat of `X` and unary-plus-Y; `X+Y` is lexed but won't parse as anything useful. This is encoded in `peekWsOpWs` (binary) vs `isAdjacentAtomStart` (unary prefix next to an atom). Same rule for `+ - * / | . $` at their respective precedence levels.
- **Precedence, low → high:** `|` (alt), concat (adjacency), `.`/`$` (capture), `+`/`-`, `*`/`/`, unary `+ - $ *`, primary. Subscript is a postfix on primary with no WS allowed between the primary and `<`.
- **Labels are col-1 identifiers.** A bare name at col 1 is a label, not a variable reference. Labels and variables live in different namespaces; `FAIL` as a label coexists with the predefined `FAIL` pattern variable.
- **`END` is a sentinel label.** Parser emits a distinct `end` Stmt; `runStatements` returns when `pc` lands on one.
- **Goto target resolution:** `:(LABEL)` is a direct compile-time constant (`GotoTarget.kind = 'direct'`). `:($VAR)` is a special single-indirection form. `:(EXPR)` is the general evaluate-then-use-as-label form. These are recognized by peeking inside the parens.
- **`$` is overloaded.** As a unary prefix: indirect reference (two lookups). As a binary operator (with surrounding WS): immediate-capture pattern op. Inside goto parens: different again (see above).
- **`*` is also overloaded.** Binary `*` with WS on both sides: multiplication. Unary prefix `*`: unevaluated (deferred) pattern reference. Starting a line: continuation marker (handled before tokenization). In col 1 of a statement body: multiplication operator (but col-1 `*` is comment only at line start, which `mergeContinuations` already handled).

## Gotchas when extending

- **Numeric vs string predicates.** `NE`/`EQ`/`LT`/`GT` coerce args via `toNumber`; if either side isn't numeric they *fail* (which is the failure branch, not an error). For string comparison use `LEQ`/`LNE`/`LLT`/`LGT`/`LLE`/`LGE` or `IDENT`/`DIFFER`. I hit this writing the sieve: `NE(C, '.')` was always failing because both strings return `null` from `toNumber`.
- **ARBNO no-progress guard.** If the inner pattern matches empty, ARBNO collapses to a single zero-progress yield instead of recursing forever. Preserve this when modifying `case 'arbno'`.
- **Arrays and tables are reference types.** `SnoArray.data` and `SnoTable.entries` are JS mutables shared by aliases. `COPY(v)` is the only way to break aliasing.
- **`DEFINE` is late-bound.** The function body must be reachable (the entry label resolved in `program.labels`) at the time `DEFINE` is called. Typical idiom: `DEFINE(...) :(PAST)` with labeled body followed by the `PAST` label. Don't assume functions are declared ahead of time.
- **Continuation lines lose column accuracy.** Tokens on continuation lines carry the primary line's line number but cols are offset. Fine for most errors; worth knowing before relying on position info.
- **`OUTPUT` is a magic variable, not a keyword.** Assigning to it writes to stdout with a newline. `INPUT` is similarly magic — reading the variable consumes one line or fails at EOF. Don't shadow either; in particular, don't use `OUTPUT` as a label name (the sieve example had to rename a label for this).
- **Predefined pattern vars live in `vars`.** `ARB`, `REM`, `FENCE`, `FAIL`, `SUCCEED`, `ABORT` are set in the constructor. User code can shadow them by assignment — that's SNOBOL4 semantics, not a bug.

## Testing conventions

- Tests live in `tests/*.test.ts`, using `bun:test`.
- The typical helper is `function run(src) { interp.run(parse(tokenize(src)), collector); return collected }`. Patterns with success/failure branches use a `runMatch(setup, body)` helper that appends `:S(OK)F(BAD)` to the body so the match's outcome is what picks the branch — see `tests/pattern.test.ts`.
- Write programs with `[...].join('\n')` so indentation stays honest (SNOBOL4 cares which column things are in).
- When a test fails, *don't* assume the test expectation was right. Several times the implementation was correct and my test was wrong — e.g., the CSV-split test assumed greedy ARBNO, but ARBNO yields shortest-first. Trace through generator yields before "fixing" the code.

## Things not to touch without thinking

- The `readonly` annotations on `SnoValue` variants. `data` and `entries` on arrays/tables are intentionally non-readonly at the contained-array level so subscript assignment can mutate.
- The `matchEnv` closure in `Interpreter` — it's captured once in the constructor so `setVar` goes through a single path that stringifies the pattern-captured value.
- The `runStatements(startPc, fn)` signature. `fn: null` means top-level; `fn: FunctionDef` means body of that call, which changes `:(RETURN)` / `:(FRETURN)` / end-of-program semantics.

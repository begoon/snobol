# SNOBOL$

[![build](https://github.com/begoon/snobol/actions/workflows/build.yaml/badge.svg)](https://github.com/begoon/snobol/actions/workflows/build.yaml)

A SNOBOL4 interpreter written in TypeScript, running on [Bun](https://bun.sh).

SNOBOL4 is Griswold, Polonsky & Farber's 1967 string-processing language, best known for its backtracking pattern-matching engine. This implementation reconstructs the core language — values, patterns, control flow, user-defined functions, arrays and tables — in roughly 1400 lines of TypeScript, with a test suite that exercises every feature end-to-end.

## Quick start

```sh
bun install
bun src/cli.ts examples/hello.sno
```

```
HELLO, WORLD
```

Programs read from stdin when something is piped:

```sh
echo "one
two" | bun src/cli.ts examples/echo.sno
```

Run the test suite and typecheck together:

```sh
just ci
```

## Example programs

All live under `examples/`.

| File | What it shows |
|---|---|
| `hello.sno` | Canonical hello world. |
| `echo.sno` | Line-at-a-time `INPUT` loop, EOF via failure goto. |
| `countdown.sno` | Integer arithmetic, labels, success-goto. |
| `factorial.sno` | Recursive user function via `DEFINE` and `:(RETURN)`. |
| `fib.sno` | Arrays, 1-indexed subscripting, arithmetic on indices. |
| `fizzbuzz.sno` | Integer modulo via `I - K * (I / K)`, labeled dispatch. |
| `kv.sno` | `BREAK` + conditional capture to parse `key=value;…` pairs in a loop. |
| `replace.sno` | Match-replace with `ANY` pattern. |
| `balanced.sno` | Recursive `*BAL` pattern for balanced parentheses. |
| `sieve.sno` | Sieve of Eratosthenes on a mutable string via `POS(i) LEN(1) = 'x'`. |
| `rule110.sno` | Wolfram Rule 110 cellular automaton, rule lookup via pattern match. |

## Language reference

### Source layout

SNOBOL4 is line-oriented and column-sensitive.

```
* this is a comment           <- '*' in column 1
LABEL   STATEMENT :(GOTO)     <- label starts in column 1
        STATEMENT             <- body starts after whitespace
+           continuation      <- '+' in column 1 continues previous line
.           continuation      <- '.' works identically
```

- **Column 1 `*`**: whole-line comment.
- **Column 1 `+` or `.`**: continuation of the previous non-comment logical line. Comments between a statement and its continuation are passed through unchanged.
- **Column 1 letter**: label for the statement.
- **Column 1 whitespace**: unlabeled statement.

Statements end at end-of-line. Identifiers match `&?[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*` — they may contain embedded dots (`X.Y.Z` is one identifier) and may start with `&` for keywords like `&ANCHOR`.

### Statement forms

| Shape | Meaning |
|---|---|
| `NAME = EXPR` | Assignment. |
| `A<i> = EXPR` | Subscript assignment (array cell or table entry). |
| `SUBJ PAT` | Pattern match. Succeeds if `PAT` matches somewhere in `SUBJ`. |
| `SUBJ PAT = REPL` | Match-replace. On success, the matched span is replaced. |
| `EXPR` | Evaluate for effect / success. |
| `[LABEL]` (empty body) | No-op, useful as a goto target. |
| `END` | Terminates the program. Also available as a goto target. |

A statement optionally ends with `:GOTO-LIST`:

| Goto | Meaning |
|---|---|
| `:(LABEL)` | Unconditional jump. |
| `:S(LABEL)` | Jump on statement success. |
| `:F(LABEL)` | Jump on statement failure. |
| `:S(L1)F(L2)` | Combined. |
| `:($VAR)` | Indirect via variable — jump to the label named by `VAR`'s value. |
| `:(EXPR)` | General indirect — any expression evaluated to a label name. |

### Expressions and precedence

From lowest to highest:

1. `|` — pattern alternation.
2. Concatenation — adjacency with surrounding whitespace.
3. `.` (conditional capture), `$` (immediate capture).
4. `+`, `-` — binary.
5. `*`, `/` — binary.
6. `+ - $ *` — unary prefixes (adjacent to operand, no WS between).
7. Primaries: literals, variable refs, function calls, parenthesized expressions. Postfix `<i,…>` subscript.

All binary operators except concatenation require whitespace on both sides. `X + Y` is addition; `X +Y` is the concatenation of `X` with `+Y` (unary `+`, which is the identity).

### Values

| Kind | Example | Notes |
|---|---|---|
| string | `'hello'` | Single or double quotes; no escape sequences. |
| integer | `42` | Fixed-size `number`. |
| real | `3.14` | IEEE 754 double. |
| pattern | `LEN(3)`, `ARB`, ... | First-class. `toStr` displays as `<PATTERN>`. |
| array | `ARRAY(10)` | Fixed-size, 1-indexed, reference semantics. |
| table | `TABLE()` | Hash map keyed by stringified index. |
| null | unset variable | Coerces to `''` (strings) or `0` (numbers). |

Numeric coercion treats empty string as 0; integer-shaped strings parse cleanly; `3.14`-shaped strings become reals. Arithmetic fails (not throws) if an operand can't be coerced.

### Patterns

Patterns are first-class values. Any expression that evaluates to a pattern can participate in a match.

**Primitive patterns (variables, zero arity):**

| Name | Matches |
|---|---|
| `ARB` | Any substring; shortest-first. |
| `REM` | Rest of the subject from the current cursor. |
| `FENCE` | Empty; cuts backtracking at this point within the current scan position. |
| `FAIL` | Never matches; useful in alternation to force the other branch. |
| `SUCCEED` | Empty; always matches. |
| `ABORT` | Aborts the entire match — overrides the unanchored scan. |

**Primitive pattern functions:**

| Call | Matches |
|---|---|
| `LEN(n)` | Exactly `n` characters. |
| `POS(n)` | Empty, only when cursor is at absolute position `n`. |
| `RPOS(n)` | Empty, only when cursor is `n` chars before end. |
| `TAB(n)` | Advances cursor to absolute position `n`. |
| `RTAB(n)` | Advances cursor to `n` chars before end. |
| `ANY(chars)` | One char from `chars`. |
| `NOTANY(chars)` | One char not in `chars`. |
| `BREAK(chars)` | Zero or more chars not in `chars`, stopping just before one in `chars`. Fails if none ever appears. |
| `SPAN(chars)` | One or more chars in `chars`, greedy. |
| `ARBNO(p)` | Zero or more repetitions of `p`. No-progress guard prevents infinite loops. |

**Pattern combinators:**

| Form | Meaning |
|---|---|
| `P1 P2` | Concatenation — match `P1` then `P2`. |
| `P1 \| P2` | Alternation — try `P1`, fall back to `P2`. |
| `P . NAME` | Conditional capture: on overall match success, `NAME` receives the substring matched by `P`. |
| `P $ NAME` | Immediate capture: `NAME` is assigned as soon as `P` matches, persisting across later backtracking. |
| `*EXPR` | Unevaluated: `EXPR` is resolved to a pattern *at match time*, enabling recursive / self-referential patterns. |

**Scan direction:** by default unanchored — the pattern is slid across the subject from left to right until it matches. Assign `&ANCHOR = 1` for anchored match (only starting position 0). `&FULLSCAN` is accepted but not semantically differentiated from default.

**Example — balanced parens:**

```snobol
        BAL = '(' *BAL ')' *BAL | ''
        &ANCHOR = 1
        S = '((()()))'
        S BAL RPOS(0)                    :S(OK)F(BAD)
```

### User functions

Define via the runtime `DEFINE` built-in:

```snobol
        DEFINE('FACT(N)')               :(PAST)
FACT    LT(N, 2)                        :F(RECUR)
        FACT = 1                        :(RETURN)
RECUR   FACT = N * FACT(N - 1)          :(RETURN)
PAST    OUTPUT = FACT(5)
END
```

- Prototype: `'NAME(A,B,...) LOCAL1,LOCAL2,...'`. Args and locals are space-scoped to the call — the caller's values are saved on entry and restored on return.
- A function returns the value of the variable named after it (`FACT = ...`).
- `:(RETURN)` returns normally; `:(FRETURN)` returns failure, which the caller sees as an expression failure.
- `DEFINE('NAME(A)', 'ENTRY_LABEL')` overrides the entry label.
- Functions are regular SNOBOL4 labels — you typically write `DEFINE(...) :(PAST)` to skip the body during main-program flow.
- Indirect and recursive calls are supported. `APPLY(name, ...args)` dispatches by name at runtime.

### Arrays and tables

```snobol
        A = ARRAY(5, 'x')   ; size 5, initial value 'x'
        A<3> = 'middle'
        OUTPUT = A<3>       ; → middle

        T = TABLE()
        T<'k'> = 42
        T<'missing'>        ; → null string
```

- Arrays are fixed-size 1-indexed. Out-of-bounds access **fails** (not throws); `:F()` can catch it.
- Tables are hash-keyed. Keys are stringified — `T<1>` and `T<'1'>` refer to the same slot.
- Both are reference types. `B = A` aliases the storage; use `COPY(v)` to detach.

### I/O

- `OUTPUT = expr` writes `toStr(expr) + '\n'` to stdout.
- `INPUT` is read-once-per-access: each read yields the next line, or fails at EOF.
- The CLI reads stdin synchronously when stdin is piped (not a TTY).

### Built-in functions

**Pattern constructors:** `LEN POS RPOS TAB RTAB ANY NOTANY BREAK SPAN ARBNO`.

**Numeric predicates** (succeed or fail; return `null` on success):
`LT LE EQ NE GT GE`.

**String predicates** (lexical, always well-defined on strings):
`LLT LLE LEQ LNE LGE LGT IDENT DIFFER`.

**String functions:**
`SIZE` (length), `DUPL(s, n)` (repeat), `REVERSE`, `TRIM` (right-trim), `REPLACE(s, from, to)` (char-wise translation, requires `|from| = |to|`), `CHAR(n)` (code point → char).

**Type functions:**
`DATATYPE(v)` (returns `STRING`/`INTEGER`/`REAL`/`PATTERN`/`ARRAY`/`TABLE`), `CONVERT(v, 'INTEGER'|'STRING'|'REAL'|'PATTERN')`, `INTEGER(v)` (predicate).

**Collections:**
`ARRAY(size[, init])`, `TABLE()`, `COPY(v)`.

**Meta:**
`DEFINE(proto[, entry])`, `APPLY(name, ...args)`.

### Reserved / predefined names

- **Keywords:** `&ANCHOR`, `&FULLSCAN` (also settable as ordinary variables).
- **Predefined pattern vars:** `ARB`, `REM`, `FENCE`, `FAIL`, `SUCCEED`, `ABORT`.
- **Magic variables:** `OUTPUT` (write), `INPUT` (read).
- **Labels with special meaning inside function bodies:** `RETURN`, `FRETURN`. They are not real labels — they are recognized by name in the goto handling of `callUserFunc`.

## Project layout

```
src/
  lexer.ts        line-oriented tokenizer, continuation-line pre-pass
  parser.ts       recursive-descent with explicit WS token handling
  pattern.ts      generator-based backtracking matcher with FenceCut / AbortMatch
  value.ts        SnoValue tagged union + coercions
  interpreter.ts  tree-walking evaluator, user-function calls, builtins
  cli.ts          entrypoint, stdin plumbing, error formatting

tests/            bun:test, 9 files covering every language feature
examples/         10 runnable .sno programs
Justfile          ci / test / typecheck targets
.github/workflows/build.yaml   runs `just ci` on push + PR
```

## Development

- [Bun](https://bun.sh) ≥ 1.3 runs `.ts` directly; no build step.
- `just ci` runs `tsc --noEmit` then `bun test`.
- Tests use the standard `bun:test` runner (`import { test, expect } from 'bun:test'`).
- Source is strict TypeScript (`"strict": true`) with `verbatimModuleSyntax` and `allowImportingTsExtensions`.

## Status

### Implemented

Values, arithmetic, patterns (primitives, combinators, captures, cut, recursion), statement forms (assign, subscript-assign, match, match-replace), control flow (labels, direct and indirect gotos, success/failure), user functions with locals and recursion, arrays and tables with reference semantics, line-at-a-time `INPUT`, continuation lines, comments, a useful built-in library.

### Not (yet) implemented

- `DATA()` user-defined record types (use `TABLE()` for now).
- `EVAL` / `OPSYN` reflective features.
- `NRETURN` (name-return from functions).
- Multi-dimensional arrays (1D is supported; 2D+ prototypes like `ARRAY('3,4')` are not parsed).
- The `BAL` primitive pattern (write it yourself with `*BAL` recursion, as in the example).
- Some number-formatting edge cases around `&MAXLNGTH`.

## References

- Griswold, Poage, Polonsky, *The SNOBOL4 Programming Language* (2nd ed., 1971) — the canonical reference.
- [GNU SNOBOL4 (csnobol4) docs](http://www.snobol4.org/csnobol4/) — closest actively maintained implementation, good for cross-checking semantics.
- [Rosetta Code SNOBOL4 tasks](https://rosettacode.org/wiki/Category:SNOBOL4) — real programs for comparison.

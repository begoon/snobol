import type { Expr, GotoTarget, Program, Stmt } from './parser.ts';
import { executeMatch, type MatchEnv, type PNode } from './pattern.ts';
import { int, NULL, pat, str, toNumber, toPattern, toStr, type SnoValue } from './value.ts';

export type OutputFn = (s: string) => void;

export type EvalResult =
  | { readonly ok: true; readonly value: SnoValue }
  | { readonly ok: false };

const OK = (value: SnoValue): EvalResult => ({ ok: true, value });
const FAIL: EvalResult = { ok: false };

export type Builtin = (args: SnoValue[]) => EvalResult;

interface FunctionDef {
  readonly name: string;
  readonly params: readonly string[];
  readonly locals: readonly string[];
  readonly entryPc: number;
}

export class Interpreter {
  readonly vars = new Map<string, SnoValue>();
  readonly builtins: Record<string, Builtin> = { ...DEFAULT_BUILTINS };
  private readonly functions = new Map<string, FunctionDef>();

  private program: Program | null = null;
  private out: OutputFn = () => {};
  private inputLines: string[] = [];
  private inputPos = 0;

  private readonly matchEnv: MatchEnv = {
    setVar: (name, value) => {
      this.vars.set(name, str(value));
    },
  };

  constructor() {
    this.vars.set('ARB', pat({ kind: 'arb' }));
    this.vars.set('REM', pat({ kind: 'rem' }));
    this.vars.set('FENCE', pat({ kind: 'fence' }));
    this.vars.set('FAIL', pat({ kind: 'fail' }));
    this.vars.set('SUCCEED', pat({ kind: 'succeed' }));
    this.vars.set('ABORT', pat({ kind: 'abort' }));
    this.vars.set('&ANCHOR', int(0));
    this.vars.set('&FULLSCAN', int(0));
  }

  run(program: Program, out: OutputFn): void {
    this.program = program;
    this.out = out;
    this.runStatements(0, null);
  }

  /** Provides lines to be delivered by successive reads of the INPUT variable.
   *  Accepts either a pre-split array or a single blob of text (which is split on
   *  newlines). Returns `this` so callers can chain before calling `run`. */
  setInput(lines: readonly string[] | string): this {
    if (typeof lines === 'string') {
      this.inputLines = lines === '' ? [] : lines.replace(/\n$/, '').split(/\r?\n/);
    } else {
      this.inputLines = [...lines];
    }
    this.inputPos = 0;
    return this;
  }

  private readInputLine(): string | null {
    if (this.inputPos >= this.inputLines.length) return null;
    return this.inputLines[this.inputPos++]!;
  }

  /** Steps through statements starting at `startPc`. If `fn` is non-null the loop is the
   *  body of a function call — a `:(RETURN)` goto short-circuits back to the caller with
   *  the current value of the function's return slot, and `:(FRETURN)` returns failure. */
  private runStatements(startPc: number, fn: FunctionDef | null): EvalResult {
    const program = this.program!;
    let pc = startPc;
    while (pc < program.stmts.length) {
      const stmt = program.stmts[pc]!;
      if (stmt.kind === 'end') {
        return fn ? OK(this.vars.get(fn.name) ?? NULL) : OK(NULL);
      }
      const success = this.execute(stmt);
      const g = stmt.goto;
      if (g) {
        const raw = g.unconditional ?? (success ? g.success : g.failure);
        if (raw) {
          if (fn && raw.kind === 'direct') {
            if (raw.name === 'RETURN') return OK(this.vars.get(fn.name) ?? NULL);
            if (raw.name === 'FRETURN') return FAIL;
          }
          const name = this.resolveGotoTarget(raw, stmt.line);
          const idx = program.labels.get(name);
          if (idx === undefined) {
            throw new Error(`line ${stmt.line}: undefined label '${name}'`);
          }
          pc = idx;
          continue;
        }
      }
      pc++;
    }
    return fn ? OK(this.vars.get(fn.name) ?? NULL) : OK(NULL);
  }

  private resolveGotoTarget(t: GotoTarget, line: number): string {
    if (t.kind === 'direct') return t.name;
    const r = this.evalExpr(t.expr);
    if (!r.ok) {
      throw new Error(`line ${line}: indirect goto target failed to evaluate`);
    }
    const name = toStr(r.value);
    if (name.length === 0) {
      throw new Error(`line ${line}: indirect goto resolved to empty label`);
    }
    return name;
  }

  private execute(stmt: Stmt): boolean {
    switch (stmt.kind) {
      case 'assign': {
        const r = this.evalExpr(stmt.value);
        if (!r.ok) return false;
        this.assignTo(stmt.target, r.value);
        return true;
      }
      case 'match': {
        const subj = toStr(this.vars.get(stmt.subject) ?? NULL);
        const patR = this.evalExpr(stmt.pattern);
        if (!patR.ok) return false;
        const hit = executeMatch(toPattern(patR.value), subj, this.isAnchored(), this.matchEnv);
        return hit !== null;
      }
      case 'matchReplace': {
        const subj = toStr(this.vars.get(stmt.subject) ?? NULL);
        const patR = this.evalExpr(stmt.pattern);
        if (!patR.ok) return false;
        const hit = executeMatch(toPattern(patR.value), subj, this.isAnchored(), this.matchEnv);
        if (!hit) return false;
        const replR = this.evalExpr(stmt.replacement);
        if (!replR.ok) return false;
        const replaced = subj.slice(0, hit.start) + toStr(replR.value) + subj.slice(hit.end);
        this.assignTo(stmt.subject, str(replaced));
        return true;
      }
      case 'subscriptAssign': {
        const tgt = this.evalExpr(stmt.target);
        if (!tgt.ok) return false;
        const indices: SnoValue[] = [];
        for (const ix of stmt.indices) {
          const r = this.evalExpr(ix);
          if (!r.ok) return false;
          indices.push(r.value);
        }
        const val = this.evalExpr(stmt.value);
        if (!val.ok) return false;
        return writeSubscript(tgt.value, indices, val.value);
      }
      case 'eval': {
        const r = this.evalExpr(stmt.expr);
        return r.ok;
      }
      case 'end':
        return true;
    }
  }

  private assignTo(target: string, value: SnoValue): void {
    if (target === 'OUTPUT') {
      this.out(toStr(value) + '\n');
      return;
    }
    this.vars.set(target, value);
  }

  private isAnchored(): boolean {
    const v = this.vars.get('&ANCHOR') ?? NULL;
    const n = toNumber(v);
    return n !== null && n !== 0;
  }

  private evalExpr(e: Expr): EvalResult {
    switch (e.kind) {
      case 'str':
        return OK(str(e.value));
      case 'int':
        return OK(int(e.value));
      case 'real':
        return OK({ kind: 'real', value: e.value });
      case 'ref': {
        if (e.name === 'INPUT') {
          const line = this.readInputLine();
          return line === null ? FAIL : OK(str(line));
        }
        return OK(this.vars.get(e.name) ?? NULL);
      }
      case 'indirect': {
        const r = this.evalExpr(e.inner);
        if (!r.ok) return FAIL;
        const name = toStr(r.value);
        return OK(this.vars.get(name) ?? NULL);
      }
      case 'concat': {
        const vals: SnoValue[] = [];
        let hasPattern = false;
        for (const p of e.parts) {
          const r = this.evalExpr(p);
          if (!r.ok) return FAIL;
          if (r.value.kind === 'pattern') hasPattern = true;
          vals.push(r.value);
        }
        if (hasPattern) return OK(pat(concatPatterns(vals.map(toPattern))));
        return OK(str(vals.map(toStr).join('')));
      }
      case 'alt': {
        const l = this.evalExpr(e.left);
        if (!l.ok) return FAIL;
        const r = this.evalExpr(e.right);
        if (!r.ok) return FAIL;
        return OK(pat({ kind: 'alt', left: toPattern(l.value), right: toPattern(r.value) }));
      }
      case 'capture': {
        const inner = this.evalExpr(e.inner);
        if (!inner.ok) return FAIL;
        return OK(
          pat({ kind: 'capture', mode: e.mode, target: e.target, inner: toPattern(inner.value) }),
        );
      }
      case 'unevaluated': {
        // Freeze the sub-expression and resolve it lazily at match time. This is what
        // makes self-referential patterns like `BAL = '(' *BAL ')' | ''` work, since
        // BAL on the RHS isn't bound to a pattern yet when the assignment is evaluated.
        const captured = e.inner;
        return OK(
          pat({
            kind: 'deferred',
            evaluate: () => {
              const r = this.evalExpr(captured);
              if (!r.ok) return null;
              return toPattern(r.value);
            },
          }),
        );
      }
      case 'unary': {
        const r = this.evalExpr(e.operand);
        if (!r.ok) return FAIL;
        const n = toNumber(r.value);
        if (n === null) return FAIL;
        const val = e.op === '-' ? -n : n;
        return OK(Number.isInteger(val) ? int(val) : { kind: 'real', value: val });
      }
      case 'binop': {
        const l = this.evalExpr(e.left);
        if (!l.ok) return FAIL;
        const r = this.evalExpr(e.right);
        if (!r.ok) return FAIL;
        const ln = toNumber(l.value);
        const rn = toNumber(r.value);
        if (ln === null || rn === null) return FAIL;
        const intPair = isIntegralValue(l.value) && isIntegralValue(r.value);
        let out: number;
        switch (e.op) {
          case '+':
            out = ln + rn;
            break;
          case '-':
            out = ln - rn;
            break;
          case '*':
            out = ln * rn;
            break;
          case '/':
            if (rn === 0) return FAIL;
            out = intPair ? Math.trunc(ln / rn) : ln / rn;
            break;
        }
        return OK(intPair ? int(out) : { kind: 'real', value: out });
      }
      case 'call':
        return this.callByName(e.name, e.args);
      case 'subscript': {
        const t = this.evalExpr(e.target);
        if (!t.ok) return FAIL;
        const indices: SnoValue[] = [];
        for (const ix of e.indices) {
          const r = this.evalExpr(ix);
          if (!r.ok) return FAIL;
          indices.push(r.value);
        }
        return readSubscript(t.value, indices);
      }
    }
  }

  private callByName(name: string, argExprs: readonly Expr[]): EvalResult {
    const args: SnoValue[] = [];
    for (const a of argExprs) {
      const r = this.evalExpr(a);
      if (!r.ok) return FAIL;
      args.push(r.value);
    }
    return this.callByValues(name, args);
  }

  private callByValues(name: string, args: SnoValue[]): EvalResult {
    if (name === 'DEFINE') return this.define(args);
    if (name === 'APPLY') {
      const target = toStr(args[0] ?? NULL);
      if (target === '') return FAIL;
      return this.callByValues(target, args.slice(1));
    }
    const userFn = this.functions.get(name);
    if (userFn) return this.callUserFunc(userFn, args);
    const builtin = this.builtins[name];
    if (builtin) return builtin(args);
    throw new Error(`unknown function '${name}'`);
  }

  private define(args: SnoValue[]): EvalResult {
    const proto = toStr(args[0] ?? NULL);
    const parsed = parsePrototype(proto);
    if (!parsed) return FAIL;
    const entryName =
      args[1] !== undefined && args[1].kind !== 'null' && toStr(args[1]) !== ''
        ? toStr(args[1])
        : parsed.name;
    const entryPc = this.program!.labels.get(entryName);
    if (entryPc === undefined) return FAIL;
    this.functions.set(parsed.name, {
      name: parsed.name,
      params: parsed.params,
      locals: parsed.locals,
      entryPc,
    });
    return OK(NULL);
  }

  private callUserFunc(fn: FunctionDef, args: SnoValue[]): EvalResult {
    const scoped = [...fn.params, ...fn.locals, fn.name];
    const saved = new Map<string, SnoValue | undefined>();
    for (const name of scoped) saved.set(name, this.vars.get(name));
    for (let i = 0; i < fn.params.length; i++) {
      this.vars.set(fn.params[i]!, args[i] ?? NULL);
    }
    for (const local of fn.locals) this.vars.set(local, NULL);
    this.vars.set(fn.name, NULL);
    try {
      return this.runStatements(fn.entryPc, fn);
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) this.vars.delete(k);
        else this.vars.set(k, v);
      }
    }
  }
}

function concatPatterns(nodes: PNode[]): PNode {
  let acc = nodes[0]!;
  for (let i = 1; i < nodes.length; i++) {
    acc = { kind: 'concat', left: acc, right: nodes[i]! };
  }
  return acc;
}

function arrayIndex(target: { size: number }, index: SnoValue): number | null {
  const i = toNumber(index);
  if (i === null || !Number.isInteger(i)) return null;
  if (i < 1 || i > target.size) return null;
  return i - 1;
}

function tableKey(indices: readonly SnoValue[]): string {
  return indices.map((v) => toStr(v)).join('\u0000');
}

function readSubscript(target: SnoValue, indices: readonly SnoValue[]): EvalResult {
  if (target.kind === 'array') {
    if (indices.length !== 1) return FAIL;
    const i = arrayIndex(target, indices[0]!);
    if (i === null) return FAIL;
    return OK(target.data[i]!);
  }
  if (target.kind === 'table') {
    return OK(target.entries.get(tableKey(indices)) ?? NULL);
  }
  return FAIL;
}

function writeSubscript(
  target: SnoValue,
  indices: readonly SnoValue[],
  value: SnoValue,
): boolean {
  if (target.kind === 'array') {
    if (indices.length !== 1) return false;
    const i = arrayIndex(target, indices[0]!);
    if (i === null) return false;
    target.data[i] = value;
    return true;
  }
  if (target.kind === 'table') {
    target.entries.set(tableKey(indices), value);
    return true;
  }
  return false;
}

function isIntegralValue(v: SnoValue): boolean {
  if (v.kind === 'integer') return true;
  if (v.kind === 'null') return true;
  if (v.kind === 'string') {
    if (v.value === '') return true;
    return /^-?[0-9]+$/.test(v.value);
  }
  return false;
}

const PROTO_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/;

/** Parses a SNOBOL4 prototype string of the form `NAME(A,B,C)L1,L2`.
 *  Whitespace around names is allowed. Returns null if malformed so DEFINE can fail. */
function parsePrototype(
  s: string,
): { name: string; params: string[]; locals: string[] } | null {
  const trimmed = s.trim();
  const nm = PROTO_NAME.exec(trimmed);
  if (!nm) return null;
  const name = nm[0];
  let rest = trimmed.slice(name.length).trimStart();
  const params: string[] = [];
  if (rest.startsWith('(')) {
    const end = rest.indexOf(')');
    if (end < 0) return null;
    const inside = rest.slice(1, end).trim();
    if (inside.length > 0) {
      for (const raw of inside.split(',')) {
        const p = raw.trim();
        if (!PROTO_NAME.test(p) || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(p)) return null;
        params.push(p);
      }
    }
    rest = rest.slice(end + 1).trimStart();
  }
  const locals: string[] = [];
  if (rest.length > 0) {
    for (const raw of rest.split(',')) {
      const l = raw.trim();
      if (l.length === 0) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(l)) return null;
      locals.push(l);
    }
  }
  return { name, params, locals };
}

function intArg(v: SnoValue): number | null {
  const n = toNumber(v);
  if (n === null || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

const PATTERN_FUNCS: Record<string, (args: SnoValue[]) => EvalResult> = {
  LEN(args) {
    const n = intArg(args[0] ?? NULL);
    if (n === null) return FAIL;
    return OK(pat({ kind: 'len', n }));
  },
  POS(args) {
    const n = intArg(args[0] ?? NULL);
    if (n === null) return FAIL;
    return OK(pat({ kind: 'pos', n }));
  },
  RPOS(args) {
    const n = intArg(args[0] ?? NULL);
    if (n === null) return FAIL;
    return OK(pat({ kind: 'rpos', n }));
  },
  TAB(args) {
    const n = intArg(args[0] ?? NULL);
    if (n === null) return FAIL;
    return OK(pat({ kind: 'tab', n }));
  },
  RTAB(args) {
    const n = intArg(args[0] ?? NULL);
    if (n === null) return FAIL;
    return OK(pat({ kind: 'rtab', n }));
  },
  ANY(args) {
    const s = toStr(args[0] ?? NULL);
    if (s.length === 0) return FAIL;
    return OK(pat({ kind: 'any', chars: s }));
  },
  NOTANY(args) {
    const s = toStr(args[0] ?? NULL);
    if (s.length === 0) return FAIL;
    return OK(pat({ kind: 'notany', chars: s }));
  },
  BREAK(args) {
    const s = toStr(args[0] ?? NULL);
    if (s.length === 0) return FAIL;
    return OK(pat({ kind: 'break', chars: s }));
  },
  SPAN(args) {
    const s = toStr(args[0] ?? NULL);
    if (s.length === 0) return FAIL;
    return OK(pat({ kind: 'span', chars: s }));
  },
  ARBNO(args) {
    return OK(pat({ kind: 'arbno', inner: toPattern(args[0] ?? NULL) }));
  },
};

function cmp(pred: (a: number, b: number) => boolean): Builtin {
  return (args) => {
    const a = toNumber(args[0] ?? NULL);
    const b = toNumber(args[1] ?? NULL);
    if (a === null || b === null) return FAIL;
    return pred(a, b) ? OK(NULL) : FAIL;
  };
}

function strCmp(pred: (a: string, b: string) => boolean): Builtin {
  return (args) => {
    const a = toStr(args[0] ?? NULL);
    const b = toStr(args[1] ?? NULL);
    return pred(a, b) ? OK(NULL) : FAIL;
  };
}

const DEFAULT_BUILTINS: Record<string, Builtin> = {
  ...PATTERN_FUNCS,
  LT: cmp((a, b) => a < b),
  LE: cmp((a, b) => a <= b),
  EQ: cmp((a, b) => a === b),
  NE: cmp((a, b) => a !== b),
  GT: cmp((a, b) => a > b),
  GE: cmp((a, b) => a >= b),
  LLT: strCmp((a, b) => a < b),
  LLE: strCmp((a, b) => a <= b),
  LEQ: strCmp((a, b) => a === b),
  LNE: strCmp((a, b) => a !== b),
  LGE: strCmp((a, b) => a >= b),
  LGT: strCmp((a, b) => a > b),
  IDENT(args) {
    // Succeeds iff the two values are the "same" — SNOBOL4 uses this for identity tests.
    return toStr(args[0] ?? NULL) === toStr(args[1] ?? NULL) ? OK(NULL) : FAIL;
  },
  DIFFER(args) {
    return toStr(args[0] ?? NULL) !== toStr(args[1] ?? NULL) ? OK(NULL) : FAIL;
  },
  SIZE(args) {
    return OK(int(toStr(args[0] ?? NULL).length));
  },
  DUPL(args) {
    const s = toStr(args[0] ?? NULL);
    const n = toNumber(args[1] ?? NULL);
    if (n === null || n < 0 || !Number.isInteger(n)) return FAIL;
    return OK(str(s.repeat(n)));
  },
  REVERSE(args) {
    return OK(str(toStr(args[0] ?? NULL).split('').reverse().join('')));
  },
  TRIM(args) {
    return OK(str(toStr(args[0] ?? NULL).replace(/[ \t]+$/, '')));
  },
  ARRAY(args) {
    const n = toNumber(args[0] ?? NULL);
    if (n === null || !Number.isInteger(n) || n < 0) return FAIL;
    const init = args[1] ?? NULL;
    const data: SnoValue[] = new Array(n);
    for (let i = 0; i < n; i++) data[i] = init;
    return OK({ kind: 'array', size: n, data });
  },
  TABLE() {
    return OK({ kind: 'table', entries: new Map<string, SnoValue>() });
  },
  REPLACE(args) {
    // REPLACE(s, from, to) — character-wise translation. from[i] in s is replaced
    // with to[i]. Requires |from| == |to|; otherwise fails.
    const s = toStr(args[0] ?? NULL);
    const from = toStr(args[1] ?? NULL);
    const to = toStr(args[2] ?? NULL);
    if (from.length !== to.length) return FAIL;
    if (from.length === 0) return OK(str(s));
    const map = new Map<string, string>();
    for (let i = 0; i < from.length; i++) map.set(from[i]!, to[i]!);
    let result = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      result += map.get(c) ?? c;
    }
    return OK(str(result));
  },
  DATATYPE(args) {
    const v = args[0] ?? NULL;
    const name = datatypeName(v);
    return OK(str(name));
  },
  CONVERT(args) {
    const v = args[0] ?? NULL;
    const target = toStr(args[1] ?? NULL).toUpperCase();
    return convertValue(v, target);
  },
  COPY(args) {
    // Shallow clone of arrays and tables; scalars pass through (they are immutable).
    const v = args[0] ?? NULL;
    if (v.kind === 'array') return OK({ kind: 'array', size: v.size, data: [...v.data] });
    if (v.kind === 'table') return OK({ kind: 'table', entries: new Map(v.entries) });
    return OK(v);
  },
  CHAR(args) {
    const n = toNumber(args[0] ?? NULL);
    if (n === null || !Number.isInteger(n) || n < 0 || n > 0x10ffff) return FAIL;
    return OK(str(String.fromCodePoint(n)));
  },
  INTEGER(args) {
    // Unary predicate: succeeds iff the arg has an integer representation.
    const v = args[0] ?? NULL;
    if (v.kind === 'integer') return OK(NULL);
    if (v.kind === 'null') return OK(NULL);
    if (v.kind === 'string' && /^-?[0-9]+$/.test(v.value)) return OK(NULL);
    return FAIL;
  },
};

function datatypeName(v: SnoValue): string {
  switch (v.kind) {
    case 'string':
      return 'STRING';
    case 'integer':
      return 'INTEGER';
    case 'real':
      return 'REAL';
    case 'pattern':
      return 'PATTERN';
    case 'array':
      return 'ARRAY';
    case 'table':
      return 'TABLE';
    case 'null':
      return 'STRING';
  }
}

function convertValue(v: SnoValue, target: string): EvalResult {
  switch (target) {
    case 'STRING':
      return OK(str(toStr(v)));
    case 'INTEGER': {
      const n = toNumber(v);
      if (n === null) return FAIL;
      return OK(int(Math.trunc(n)));
    }
    case 'REAL': {
      const n = toNumber(v);
      if (n === null) return FAIL;
      return OK({ kind: 'real', value: n });
    }
    case 'PATTERN':
      return OK(pat(toPattern(v)));
    default:
      return FAIL;
  }
}

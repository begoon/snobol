import type { PositionedToken, Token } from './lexer.ts';

export type BinaryOp = '+' | '-' | '*' | '/';
export type UnaryOp = '+' | '-';

export type Expr =
  | { kind: 'str'; value: string }
  | { kind: 'int'; value: number }
  | { kind: 'real'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'indirect'; inner: Expr }
  | { kind: 'concat'; parts: Expr[] }
  | { kind: 'alt'; left: Expr; right: Expr }
  | { kind: 'capture'; mode: 'conditional' | 'immediate'; inner: Expr; target: string }
  | { kind: 'binop'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'unary'; op: UnaryOp; operand: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'subscript'; target: Expr; indices: Expr[] }
  | { kind: 'unevaluated'; inner: Expr };

export type GotoTarget =
  | { kind: 'direct'; name: string }
  | { kind: 'indirect'; expr: Expr };

export interface Goto {
  unconditional?: GotoTarget;
  success?: GotoTarget;
  failure?: GotoTarget;
}

export interface StmtCommon {
  label?: string;
  goto?: Goto;
  line: number;
}

export type Stmt =
  | ({ kind: 'assign'; target: string; value: Expr } & StmtCommon)
  | ({
      kind: 'subscriptAssign';
      target: Expr;
      indices: Expr[];
      value: Expr;
    } & StmtCommon)
  | ({ kind: 'match'; subject: string; pattern: Expr } & StmtCommon)
  | ({ kind: 'matchReplace'; subject: string; pattern: Expr; replacement: Expr } & StmtCommon)
  | ({ kind: 'eval'; expr: Expr } & StmtCommon)
  | { kind: 'end'; label: 'END'; line: number };

export interface Program {
  stmts: Stmt[];
  labels: Map<string, number>;
}

export function parse(tokens: PositionedToken[]): Program {
  return new Parser(tokens).parseProgram();
}

type Kind = Token['kind'];

class Parser {
  private pos = 0;

  constructor(private readonly tokens: PositionedToken[]) {}

  parseProgram(): Program {
    const stmts: Stmt[] = [];
    const labels = new Map<string, number>();
    while (this.pos < this.tokens.length) {
      if (this.peekKind() === 'EOL') {
        this.pos++;
        continue;
      }
      const stmt = this.parseStmt();
      if (stmt.kind !== 'end' && stmt.label) {
        if (labels.has(stmt.label)) {
          throw new SyntaxError(`line ${stmt.line}: duplicate label '${stmt.label}'`);
        }
        labels.set(stmt.label, stmts.length);
      } else if (stmt.kind === 'end') {
        labels.set('END', stmts.length);
      }
      stmts.push(stmt);
      if (stmt.kind === 'end') break;
    }
    return { stmts, labels };
  }

  private parseStmt(): Stmt {
    const first = this.tokens[this.pos]!;
    let label: string | undefined;
    if (first.tok.kind === 'LABEL') {
      label = first.tok.name;
      this.pos++;
    }
    if (label === 'END') {
      while (this.peekKind() && this.peekKind() !== 'EOL') this.pos++;
      if (this.peekKind() === 'EOL') this.pos++;
      return { kind: 'end', label: 'END', line: first.line };
    }
    this.skipWs();
    if (!this.peekKind() || this.peekKind() === 'EOL') {
      if (this.peekKind() === 'EOL') this.pos++;
      return { kind: 'eval', expr: { kind: 'str', value: '' }, label, line: first.line };
    }

    let body: Expr = { kind: 'str', value: '' };
    if (this.peekKind() !== 'COLON') {
      body = this.parseExpr();
      this.skipWs();
    }

    let replacement: Expr | undefined;
    if (this.peekKind() === 'EQ') {
      this.pos++;
      this.skipWs();
      if (this.peekKind() && this.peekKind() !== 'EOL' && this.peekKind() !== 'COLON') {
        replacement = this.parseExpr();
        this.skipWs();
      } else {
        replacement = { kind: 'str', value: '' };
      }
    }

    let gotoPart: Goto | undefined;
    if (this.peekKind() === 'COLON') {
      this.pos++;
      gotoPart = this.parseGoto();
    }
    this.skipWs();
    if (this.peekKind() === 'EOL') this.pos++;

    return shapeStatement(body, replacement, label, gotoPart, first.line);
  }

  // --- expression grammar -------------------------------------------------
  //
  // Precedence (low → high):
  //   alt       : ' | '             (pattern alternation)
  //   concat    : WS between atoms  (string/pattern concatenation)
  //   capture   : ' . '  | ' $ '    (pattern binds to name; RHS must be IDENT)
  //   add/sub   : ' + '  | ' - '
  //   mul/div   : ' * '  | ' / '
  //   unary     : +X | -X
  //   primary   : literal | ref | call | '(' expr ')'
  //
  // All binary operators except concat require WS on both sides — the SNOBOL4
  // rule that distinguishes binary ops from adjacent-token concatenation.

  private parseExpr(): Expr {
    return this.parseAlt();
  }

  private parseAlt(): Expr {
    let lhs = this.parseConcat();
    while (this.peekWsOpWs(['PIPE'])) {
      this.pos += 3;
      const rhs = this.parseConcat();
      lhs = { kind: 'alt', left: lhs, right: rhs };
    }
    return lhs;
  }

  private parseConcat(): Expr {
    const parts: Expr[] = [this.parseCapture()];
    while (this.isAdjacentAtomStart()) {
      this.pos++;
      parts.push(this.parseCapture());
    }
    return parts.length === 1 ? parts[0]! : { kind: 'concat', parts };
  }

  private parseCapture(): Expr {
    let lhs = this.parseAddSub();
    while (true) {
      const op = this.peekWsOpWs(['DOT', 'DOLLAR']);
      if (!op) break;
      this.pos += 3;
      const target = this.expectIdent();
      lhs = {
        kind: 'capture',
        mode: op === 'DOT' ? 'conditional' : 'immediate',
        inner: lhs,
        target,
      };
    }
    return lhs;
  }

  private parseAddSub(): Expr {
    let lhs = this.parseMulDiv();
    while (true) {
      const op = this.peekWsOpWs(['PLUS', 'MINUS']);
      if (!op) break;
      this.pos += 3;
      const rhs = this.parseMulDiv();
      lhs = { kind: 'binop', op: op === 'PLUS' ? '+' : '-', left: lhs, right: rhs };
    }
    return lhs;
  }

  private parseMulDiv(): Expr {
    let lhs = this.parseUnary();
    while (true) {
      const op = this.peekWsOpWs(['STAR', 'SLASH']);
      if (!op) break;
      this.pos += 3;
      const rhs = this.parseUnary();
      lhs = { kind: 'binop', op: op === 'STAR' ? '*' : '/', left: lhs, right: rhs };
    }
    return lhs;
  }

  private parseUnary(): Expr {
    const k = this.peekKind();
    if (k === 'PLUS') {
      this.pos++;
      return this.parseUnary();
    }
    if (k === 'MINUS') {
      this.pos++;
      return { kind: 'unary', op: '-', operand: this.parseUnary() };
    }
    if (k === 'DOLLAR') {
      this.pos++;
      return { kind: 'indirect', inner: this.parseUnary() };
    }
    if (k === 'STAR') {
      this.pos++;
      return { kind: 'unevaluated', inner: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    let expr = this.parseAtom();
    // Postfix subscript chain: A<i>, A<i><j>, F(x)<k>. Adjacency matters — a space
    // before '<' means it's not a subscript, so the parser defers to concat.
    while (this.peekKind() === 'ANGLE_LEFT') {
      expr = this.parseSubscript(expr);
    }
    return expr;
  }

  private parseAtom(): Expr {
    const t = this.tokens[this.pos];
    if (!t) throw new SyntaxError('unexpected end of input');
    switch (t.tok.kind) {
      case 'STRING':
        this.pos++;
        return { kind: 'str', value: t.tok.value };
      case 'INTEGER':
        this.pos++;
        return { kind: 'int', value: t.tok.value };
      case 'REAL':
        this.pos++;
        return { kind: 'real', value: t.tok.value };
      case 'LPAREN': {
        this.pos++;
        this.skipWs();
        const inner = this.parseExpr();
        this.skipWs();
        this.expect('RPAREN');
        return inner;
      }
      case 'IDENT': {
        const name = t.tok.name;
        this.pos++;
        if (this.peekKind() === 'LPAREN') {
          return this.parseCallArgs(name);
        }
        return { kind: 'ref', name };
      }
      default:
        throw new SyntaxError(`line ${t.line}:${t.col}: expected expression, got ${t.tok.kind}`);
    }
  }

  private parseSubscript(target: Expr): Expr {
    this.expect('ANGLE_LEFT');
    this.skipWs();
    const indices: Expr[] = [];
    if (this.peekKind() !== 'ANGLE_RIGHT') {
      indices.push(this.parseExpr());
      this.skipWs();
      while (this.peekKind() === 'COMMA') {
        this.pos++;
        this.skipWs();
        indices.push(this.parseExpr());
        this.skipWs();
      }
    }
    this.expect('ANGLE_RIGHT');
    return { kind: 'subscript', target, indices };
  }

  private parseCallArgs(name: string): Expr {
    this.expect('LPAREN');
    this.skipWs();
    const args: Expr[] = [];
    if (this.peekKind() !== 'RPAREN') {
      args.push(this.parseExpr());
      this.skipWs();
      while (this.peekKind() === 'COMMA') {
        this.pos++;
        this.skipWs();
        args.push(this.parseExpr());
        this.skipWs();
      }
    }
    this.expect('RPAREN');
    return { kind: 'call', name, args };
  }

  private isAdjacentAtomStart(): boolean {
    if (this.peekKind() !== 'WS') return false;
    const after = this.tokens[this.pos + 1]?.tok.kind;
    if (!after) return false;
    if (isAtomLead(after)) return true;
    // Unary-prefix operators (+ - $ *) attach to the adjacent atom with NO whitespace
    // between op and operand. Surrounding whitespace on both sides would make them
    // binary operators instead, so rule out the binary form here.
    if (after === 'PLUS' || after === 'MINUS' || after === 'DOLLAR' || after === 'STAR') {
      const next = this.tokens[this.pos + 2]?.tok.kind;
      return next !== 'WS' && next !== undefined && isAtomLead(next);
    }
    return false;
  }

  private peekWsOpWs(kinds: Kind[]): Kind | null {
    if (this.peekKind() !== 'WS') return null;
    const op = this.tokens[this.pos + 1]?.tok.kind;
    if (!op || !kinds.includes(op)) return null;
    if (this.tokens[this.pos + 2]?.tok.kind !== 'WS') return null;
    return op;
  }

  private peekKind(): Kind | undefined {
    return this.tokens[this.pos]?.tok.kind;
  }

  private skipWs(): void {
    while (this.peekKind() === 'WS') this.pos++;
  }

  private expect(kind: Kind): PositionedToken {
    const t = this.tokens[this.pos];
    if (!t || t.tok.kind !== kind) {
      const at = t ? `line ${t.line}:${t.col}` : 'eof';
      throw new SyntaxError(`${at}: expected ${kind}, got ${t?.tok.kind ?? 'eof'}`);
    }
    this.pos++;
    return t;
  }

  private expectIdent(): string {
    const t = this.expect('IDENT');
    return (t.tok as Extract<Token, { kind: 'IDENT' }>).name;
  }

  private parseGoto(): Goto {
    this.skipWs();
    const g: Goto = {};
    if (this.peekKind() === 'LPAREN') {
      g.unconditional = this.parseGotoTarget();
      return g;
    }
    while (this.peekKind() === 'IDENT') {
      const flagTok = this.tokens[this.pos]!;
      const flag = (flagTok.tok as Extract<Token, { kind: 'IDENT' }>).name;
      this.pos++;
      const target = this.parseGotoTarget();
      if (flag === 'S') g.success = target;
      else if (flag === 'F') g.failure = target;
      else {
        throw new SyntaxError(`line ${flagTok.line}: unknown goto flag '${flag}'`);
      }
      this.skipWs();
    }
    return g;
  }

  /** Parses the target inside a goto's parens.
   *
   *  - `(LABEL)`  — direct jump to label LABEL (the common case; no runtime lookup).
   *  - `($VAR)`   — indirect: jump to the label whose name is the value of variable VAR.
   *                 This is the goto-specific reading of `$VAR`: only one level of
   *                 indirection, unlike the general `$` expression operator which does
   *                 a full indirect-name-reference (two levels).
   *  - `(EXPR)`   — any other expression; evaluate it and use its string value as label.
   */
  private parseGotoTarget(): GotoTarget {
    this.expect('LPAREN');
    this.skipWs();
    if (this.peekKind() === 'IDENT') {
      const identTok = this.tokens[this.pos]!;
      let k = this.pos + 1;
      while (this.tokens[k]?.tok.kind === 'WS') k++;
      if (this.tokens[k]?.tok.kind === 'RPAREN') {
        const name = (identTok.tok as Extract<Token, { kind: 'IDENT' }>).name;
        this.pos = k + 1;
        return { kind: 'direct', name };
      }
    }
    if (this.peekKind() === 'DOLLAR' && this.tokens[this.pos + 1]?.tok.kind === 'IDENT') {
      const identTok = this.tokens[this.pos + 1]!;
      let k = this.pos + 2;
      while (this.tokens[k]?.tok.kind === 'WS') k++;
      if (this.tokens[k]?.tok.kind === 'RPAREN') {
        const name = (identTok.tok as Extract<Token, { kind: 'IDENT' }>).name;
        this.pos = k + 1;
        return { kind: 'indirect', expr: { kind: 'ref', name } };
      }
    }
    const expr = this.parseExpr();
    this.skipWs();
    this.expect('RPAREN');
    return { kind: 'indirect', expr };
  }
}

function isAtomLead(k: Kind): boolean {
  return k === 'STRING' || k === 'INTEGER' || k === 'REAL' || k === 'IDENT' || k === 'LPAREN';
}

/** Derives the statement kind from its parsed body and optional replacement. The rule:
 *  - body is a bare name           → assignment (value = replacement) or eval (no replacement)
 *  - body is concat(name, rest…)   → match-replace or match, subject = name, pattern = rest
 *  - anything else                 → eval, possibly assigning if replacement is given but
 *                                     the body is not an lvalue, which is an error. */
function shapeStatement(
  body: Expr,
  replacement: Expr | undefined,
  label: string | undefined,
  goto: Goto | undefined,
  line: number,
): Stmt {
  if (replacement !== undefined) {
    if (body.kind === 'ref') {
      return { kind: 'assign', target: body.name, value: replacement, label, goto, line };
    }
    if (body.kind === 'subscript') {
      return {
        kind: 'subscriptAssign',
        target: body.target,
        indices: body.indices,
        value: replacement,
        label,
        goto,
        line,
      };
    }
    if (body.kind === 'concat' && body.parts[0]?.kind === 'ref') {
      const [subjectExpr, ...rest] = body.parts;
      const pattern = rest.length === 1 ? rest[0]! : { kind: 'concat' as const, parts: rest };
      return {
        kind: 'matchReplace',
        subject: (subjectExpr as { kind: 'ref'; name: string }).name,
        pattern,
        replacement,
        label,
        goto,
        line,
      };
    }
    throw new SyntaxError(`line ${line}: left side of '=' is not an lvalue`);
  }
  if (body.kind === 'concat' && body.parts[0]?.kind === 'ref') {
    const [subjectExpr, ...rest] = body.parts;
    const pattern = rest.length === 1 ? rest[0]! : { kind: 'concat' as const, parts: rest };
    return {
      kind: 'match',
      subject: (subjectExpr as { kind: 'ref'; name: string }).name,
      pattern,
      label,
      goto,
      line,
    };
  }
  return { kind: 'eval', expr: body, label, goto, line };
}

export type Token =
  | { kind: 'LABEL'; name: string }
  | { kind: 'IDENT'; name: string }
  | { kind: 'STRING'; value: string }
  | { kind: 'INTEGER'; value: number }
  | { kind: 'REAL'; value: number }
  | { kind: 'EQ' }
  | { kind: 'COLON' }
  | { kind: 'LPAREN' }
  | { kind: 'RPAREN' }
  | { kind: 'COMMA' }
  | { kind: 'PLUS' }
  | { kind: 'MINUS' }
  | { kind: 'STAR' }
  | { kind: 'SLASH' }
  | { kind: 'PIPE' }
  | { kind: 'DOT' }
  | { kind: 'DOLLAR' }
  | { kind: 'ANGLE_LEFT' }
  | { kind: 'ANGLE_RIGHT' }
  | { kind: 'WS' }
  | { kind: 'EOL' };

export interface PositionedToken {
  tok: Token;
  line: number;
  col: number;
}

const LABEL_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/;
const IDENT_RE = /^&?[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/;
const INT_RE = /^[0-9]+/;

export function tokenize(src: string): PositionedToken[] {
  const out: PositionedToken[] = [];
  const merged = mergeContinuations(src.split(/\r?\n/));
  for (const { text, line } of merged) {
    tokenizeLine(text, line, out);
  }
  return out;
}

interface LogicalLine {
  text: string;
  line: number;
}

/** SNOBOL4 continuation: a line starting with '+' or '.' in column 1 is a continuation
 *  of the previous statement. Intervening '*' comment lines don't break the chain —
 *  the continuation attaches to the last non-comment line. If no prior line exists,
 *  the orphan is passed through verbatim and will be rejected by the tokenizer. */
function mergeContinuations(raw: string[]): LogicalLine[] {
  const out: LogicalLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    if (line.length > 0 && (line[0] === '+' || line[0] === '.')) {
      let target = out.length - 1;
      while (target >= 0 && out[target]!.text.startsWith('*')) target--;
      if (target >= 0) {
        out[target]!.text += ' ' + line.substring(1);
        continue;
      }
    }
    out.push({ text: line, line: i + 1 });
  }
  return out;
}

function tokenizeLine(line: string, lineNo: number, out: PositionedToken[]): void {
  if (line.length === 0) {
    out.push({ tok: { kind: 'EOL' }, line: lineNo, col: 1 });
    return;
  }
  const first = line[0]!;
  if (first === '*') {
    out.push({ tok: { kind: 'EOL' }, line: lineNo, col: 1 });
    return;
  }
  let i = 0;
  if (first !== ' ' && first !== '\t') {
    const m = LABEL_RE.exec(line);
    if (!m) throw new SyntaxError(`line ${lineNo}: invalid label starting with '${first}'`);
    out.push({ tok: { kind: 'LABEL', name: m[0] }, line: lineNo, col: 1 });
    i = m[0].length;
  }
  while (i < line.length) {
    const c = line[i]!;
    if (c === ' ' || c === '\t') {
      let j = i;
      while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
      out.push({ tok: { kind: 'WS' }, line: lineNo, col: i + 1 });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j++;
      if (j >= line.length) {
        throw new SyntaxError(`line ${lineNo}:${i + 1}: unterminated string`);
      }
      out.push({ tok: { kind: 'STRING', value: line.slice(i + 1, j) }, line: lineNo, col: i + 1 });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z&]/.test(c)) {
      const m = IDENT_RE.exec(line.slice(i));
      if (!m) throw new SyntaxError(`line ${lineNo}:${i + 1}: invalid identifier`);
      out.push({ tok: { kind: 'IDENT', name: m[0] }, line: lineNo, col: i + 1 });
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = INT_RE.exec(line.slice(i))!;
      let end = i + m[0].length;
      let isReal = false;
      if (line[end] === '.' && end + 1 < line.length && /[0-9]/.test(line[end + 1]!)) {
        isReal = true;
        end++;
        while (end < line.length && /[0-9]/.test(line[end]!)) end++;
      }
      const text = line.slice(i, end);
      if (isReal) {
        out.push({ tok: { kind: 'REAL', value: parseFloat(text) }, line: lineNo, col: i + 1 });
      } else {
        out.push({ tok: { kind: 'INTEGER', value: parseInt(text, 10) }, line: lineNo, col: i + 1 });
      }
      i = end;
      continue;
    }
    switch (c) {
      case '=':
        out.push({ tok: { kind: 'EQ' }, line: lineNo, col: i + 1 });
        break;
      case ':':
        out.push({ tok: { kind: 'COLON' }, line: lineNo, col: i + 1 });
        break;
      case '(':
        out.push({ tok: { kind: 'LPAREN' }, line: lineNo, col: i + 1 });
        break;
      case ')':
        out.push({ tok: { kind: 'RPAREN' }, line: lineNo, col: i + 1 });
        break;
      case ',':
        out.push({ tok: { kind: 'COMMA' }, line: lineNo, col: i + 1 });
        break;
      case '+':
        out.push({ tok: { kind: 'PLUS' }, line: lineNo, col: i + 1 });
        break;
      case '-':
        out.push({ tok: { kind: 'MINUS' }, line: lineNo, col: i + 1 });
        break;
      case '*':
        out.push({ tok: { kind: 'STAR' }, line: lineNo, col: i + 1 });
        break;
      case '/':
        out.push({ tok: { kind: 'SLASH' }, line: lineNo, col: i + 1 });
        break;
      case '|':
        out.push({ tok: { kind: 'PIPE' }, line: lineNo, col: i + 1 });
        break;
      case '.':
        out.push({ tok: { kind: 'DOT' }, line: lineNo, col: i + 1 });
        break;
      case '$':
        out.push({ tok: { kind: 'DOLLAR' }, line: lineNo, col: i + 1 });
        break;
      case '<':
        out.push({ tok: { kind: 'ANGLE_LEFT' }, line: lineNo, col: i + 1 });
        break;
      case '>':
        out.push({ tok: { kind: 'ANGLE_RIGHT' }, line: lineNo, col: i + 1 });
        break;
      default:
        throw new SyntaxError(`line ${lineNo}:${i + 1}: unexpected character '${c}'`);
    }
    i++;
  }
  out.push({ tok: { kind: 'EOL' }, line: lineNo, col: line.length + 1 });
}

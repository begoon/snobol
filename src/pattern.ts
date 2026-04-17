export type PNode =
  | { kind: 'literal'; value: string }
  | { kind: 'len'; n: number }
  | { kind: 'pos'; n: number }
  | { kind: 'rpos'; n: number }
  | { kind: 'tab'; n: number }
  | { kind: 'rtab'; n: number }
  | { kind: 'any'; chars: string }
  | { kind: 'notany'; chars: string }
  | { kind: 'break'; chars: string }
  | { kind: 'span'; chars: string }
  | { kind: 'rem' }
  | { kind: 'arb' }
  | { kind: 'arbno'; inner: PNode }
  | { kind: 'fence' }
  | { kind: 'fail' }
  | { kind: 'succeed' }
  | { kind: 'abort' }
  | { kind: 'concat'; left: PNode; right: PNode }
  | { kind: 'alt'; left: PNode; right: PNode }
  | { kind: 'capture'; mode: 'conditional' | 'immediate'; target: string; inner: PNode }
  | { kind: 'deferred'; evaluate: () => PNode | null };

export interface MatchResult {
  readonly start: number;
  readonly end: number;
}

export interface MatchEnv {
  /** Receives assignments triggered by `$` (immediate) during the scan and, on overall
   *  success, by `.` (conditional) captures that had been pending. */
  setVar(name: string, value: string): void;
}

interface Pending {
  readonly name: string;
  readonly value: string;
}

interface State {
  readonly pos: number;
  readonly pending: readonly Pending[];
}

class AbortMatch {}
class FenceCut {}

export function executeMatch(
  pattern: PNode,
  subject: string,
  anchored: boolean,
  env: MatchEnv,
): MatchResult | null {
  try {
    const maxStart = anchored ? 0 : subject.length;
    for (let start = 0; start <= maxStart; start++) {
      try {
        for (const state of matchAt(pattern, subject, start, [], env)) {
          for (const p of state.pending) env.setVar(p.name, p.value);
          return { start, end: state.pos };
        }
      } catch (e) {
        // FENCE blocks backtracking within the current start position but leaves
        // the outer unanchored scan free to try the next start.
        if (e instanceof FenceCut) continue;
        throw e;
      }
    }
    return null;
  } catch (e) {
    // ABORT aborts the entire scan, not just the current start position.
    if (e instanceof AbortMatch) return null;
    throw e;
  }
}

/** Yields every state (end position + deferred `.` captures) at which `node` matches
 *  starting at `pos`. Immediate `$` captures are applied as a side effect via `env`
 *  the moment their sub-pattern succeeds, even if later backtracking undoes the
 *  surrounding match — SNOBOL4 semantics. */
function* matchAt(
  node: PNode,
  subj: string,
  pos: number,
  pending: readonly Pending[],
  env: MatchEnv,
): Generator<State> {
  switch (node.kind) {
    case 'literal':
      if (subj.startsWith(node.value, pos)) yield { pos: pos + node.value.length, pending };
      return;

    case 'len':
      if (node.n >= 0 && pos + node.n <= subj.length) yield { pos: pos + node.n, pending };
      return;

    case 'pos':
      if (pos === node.n) yield { pos, pending };
      return;

    case 'rpos':
      if (subj.length - pos === node.n) yield { pos, pending };
      return;

    case 'tab':
      if (node.n >= pos && node.n <= subj.length) yield { pos: node.n, pending };
      return;

    case 'rtab': {
      const target = subj.length - node.n;
      if (target >= pos && target <= subj.length) yield { pos: target, pending };
      return;
    }

    case 'any':
      if (pos < subj.length && node.chars.includes(subj[pos]!)) yield { pos: pos + 1, pending };
      return;

    case 'notany':
      if (pos < subj.length && !node.chars.includes(subj[pos]!)) yield { pos: pos + 1, pending };
      return;

    case 'break': {
      let i = pos;
      while (i < subj.length && !node.chars.includes(subj[i]!)) i++;
      if (i < subj.length) yield { pos: i, pending };
      return;
    }

    case 'span': {
      let i = pos;
      while (i < subj.length && node.chars.includes(subj[i]!)) i++;
      if (i > pos) yield { pos: i, pending };
      return;
    }

    case 'rem':
      yield { pos: subj.length, pending };
      return;

    case 'arb':
      for (let i = pos; i <= subj.length; i++) yield { pos: i, pending };
      return;

    case 'arbno': {
      // Zero repetitions is always a candidate; the outer consumer can still ask for more.
      yield { pos, pending };
      for (const one of matchAt(node.inner, subj, pos, pending, env)) {
        if (one.pos === pos) {
          // Inner matched empty — don't recurse; collapse to a single zero-progress match.
          yield one;
          return;
        }
        yield* matchAt(node, subj, one.pos, one.pending, env);
      }
      return;
    }

    case 'fence':
      // Yield the empty match once. When backtracking asks the generator to resume,
      // the code after the yield runs — throwing FenceCut, which unwinds to the
      // per-start-position try/catch in executeMatch.
      yield { pos, pending };
      throw new FenceCut();

    case 'fail':
      return;

    case 'succeed':
      yield { pos, pending };
      return;

    case 'abort':
      throw new AbortMatch();

    case 'concat':
      for (const mid of matchAt(node.left, subj, pos, pending, env)) {
        yield* matchAt(node.right, subj, mid.pos, mid.pending, env);
      }
      return;

    case 'alt':
      yield* matchAt(node.left, subj, pos, pending, env);
      yield* matchAt(node.right, subj, pos, pending, env);
      return;

    case 'capture':
      for (const inner of matchAt(node.inner, subj, pos, pending, env)) {
        const matched = subj.slice(pos, inner.pos);
        if (node.mode === 'immediate') {
          env.setVar(node.target, matched);
          yield inner;
        } else {
          yield {
            pos: inner.pos,
            pending: [...inner.pending, { name: node.target, value: matched }],
          };
        }
      }
      return;

    case 'deferred': {
      // Resolve the pattern lazily — this is what `*EXPR` relies on, since the
      // underlying variable may be updated between pattern construction and match
      // time (and, for recursive patterns, the outer pattern may not even exist yet
      // when the inner deferred was built).
      const inner = node.evaluate();
      if (inner === null) return;
      yield* matchAt(inner, subj, pos, pending, env);
      return;
    }
  }
}

import { expect, test } from 'bun:test';
import { Interpreter } from '../src/interpreter.ts';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';

function run(src: string): string {
  let captured = '';
  new Interpreter().run(parse(tokenize(src)), (s) => {
    captured += s;
  });
  return captured;
}

/** Evaluates `body` as a statement and returns 'ok' / 'fail' based on its success.
 *  `setup` provides any preceding statements (e.g. subject assignment). The goto
 *  is appended to the same physical line as `body` so the match's success/failure
 *  is what drives the branch. */
function runMatch(setup: string, body: string): 'ok' | 'fail' {
  const src = [
    setup,
    `        ${body}                 :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'fail'`,
    'END',
    '',
  ].join('\n');
  const out = run(src).trim();
  if (out !== 'ok' && out !== 'fail') {
    throw new Error(`unexpected output: ${JSON.stringify(out)}`);
  }
  return out;
}

test('literal pattern matches a substring', () => {
  expect(runMatch(`        LINE = 'the quick brown fox'`, `LINE 'quick'`)).toBe('ok');
  expect(runMatch(`        LINE = 'the quick brown fox'`, `LINE 'zebra'`)).toBe('fail');
});

test('LEN matches fixed length', () => {
  expect(runMatch(`        S = 'abcdef'`, `S LEN(3)`)).toBe('ok');
  expect(runMatch(`        S = 'ab'`, `S LEN(5)`)).toBe('fail');
});

test('SPAN matches runs of characters', () => {
  expect(runMatch(`        S = '   hello'`, `S SPAN(' ')`)).toBe('ok');
  expect(runMatch(`        S = 'hello'`, `S SPAN(' ')`)).toBe('fail');
});

test('BREAK scans forward to a delimiter', () => {
  expect(runMatch(`        S = 'foo,bar'`, `S BREAK(',')`)).toBe('ok');
  expect(runMatch(`        S = 'nothing-to-break'`, `S BREAK(',')`)).toBe('fail');
});

test('ANY and NOTANY match a single character', () => {
  expect(runMatch(`        S = 'a'`, `S ANY('abc')`)).toBe('ok');
  expect(runMatch(`        S = 'x'`, `S ANY('abc')`)).toBe('fail');
  expect(runMatch(`        S = 'x'`, `S NOTANY('abc')`)).toBe('ok');
  expect(runMatch(`        S = 'b'`, `S NOTANY('abc')`)).toBe('fail');
});

test('pattern alternation picks either branch', () => {
  expect(runMatch(`        S = 'cat'`, `S ('dog' | 'cat')`)).toBe('ok');
  expect(runMatch(`        S = 'fish'`, `S ('dog' | 'cat')`)).toBe('fail');
});

test('pattern concatenation requires both halves in order', () => {
  expect(runMatch(`        S = 'aaa---bbb'`, `S SPAN('a') '---' SPAN('b')`)).toBe('ok');
  expect(runMatch(`        S = 'aaa+++bbb'`, `S SPAN('a') '---' SPAN('b')`)).toBe('fail');
});

test('ARB enables backtracking to find a later literal', () => {
  expect(runMatch(`        S = 'abcXYZdef'`, `S ARB 'XYZ'`)).toBe('ok');
});

test('POS anchors cursor to an exact position', () => {
  // POS(0) before 'ab' works at position 0.
  expect(runMatch(`        S = 'abcd'`, `S POS(0) 'ab'`)).toBe('ok');
  // POS(1) requires cursor at position 1; from pos 1 'abcd' shows 'bcd', so 'ab' can't match.
  expect(runMatch(`        S = 'abcd'`, `S POS(1) 'ab'`)).toBe('fail');
});

test('RPOS anchors cursor relative to the right edge', () => {
  expect(runMatch(`        S = 'abcd'`, `S 'cd' RPOS(0)`)).toBe('ok');
  expect(runMatch(`        S = 'abcd'`, `S 'cd' RPOS(1)`)).toBe('fail');
});

test('match-replace splices replacement into subject', () => {
  const src = [
    `        LINE = 'the quick brown fox'`,
    `        LINE 'quick' = 'slow'`,
    `        OUTPUT = LINE`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('the slow brown fox\n');
});

test('match-replace with empty replacement deletes the matched region', () => {
  const src = [
    `        LINE = 'hello, world'`,
    `        LINE BREAK(',') =`,
    `        OUTPUT = LINE`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe(', world\n');
});

test('failing match leaves subject unchanged and triggers :F', () => {
  const src = [
    `        LINE = 'abc'`,
    `        LINE 'zzz' = 'X'              :F(ELSE)`,
    `        OUTPUT = 'matched'`,
    `        :(END)`,
    `ELSE    OUTPUT = LINE`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('abc\n');
});

test('&ANCHOR forces the scan to start at position 0', () => {
  const anchored = [
    `        &ANCHOR = 1`,
    `        S = 'abcXYZ'`,
    `        S 'XYZ'                    :S(HIT)F(MISS)`,
    `HIT     OUTPUT = 'hit'`,
    `        :(END)`,
    `MISS    OUTPUT = 'miss'`,
    'END',
    '',
  ].join('\n');
  expect(run(anchored).trim()).toBe('miss');
  const unanchored = [
    `        S = 'abcXYZ'`,
    `        S 'XYZ'                    :S(HIT)F(MISS)`,
    `HIT     OUTPUT = 'hit'`,
    `        :(END)`,
    `MISS    OUTPUT = 'miss'`,
    'END',
    '',
  ].join('\n');
  expect(run(unanchored).trim()).toBe('hit');
});

test('FAIL pattern never matches; SUCCEED always matches empty', () => {
  expect(runMatch(`        S = 'anything'`, `S FAIL`)).toBe('fail');
  expect(runMatch(`        S = 'anything'`, `S SUCCEED`)).toBe('ok');
});

test('ABORT aborts the entire scan, bypassing remaining alternatives', () => {
  // With FAIL instead of ABORT the 'def' alternative would succeed at position 3.
  // ABORT prevents any such fallback — once reached, the overall match fails.
  expect(
    runMatch(`        S = 'abcdef'`, `S ('abc' ABORT | 'def')`),
  ).toBe('fail');
  // Sanity check the contrast — FAIL in the same shape permits the right branch.
  expect(
    runMatch(`        S = 'abcdef'`, `S ('abc' FAIL | 'def')`),
  ).toBe('ok');
});

test('FENCE cuts intra-position backtracking; the unanchored scan still advances', () => {
  // Without FENCE, ARB 'b' anchored succeeds by backtracking ARB until 'b' fits.
  const anchoredSetup = [`        &ANCHOR = 1`, `        S = 'aaab'`].join('\n');
  expect(runMatch(anchoredSetup, `S ARB 'b'`)).toBe('ok');
  expect(runMatch(anchoredSetup, `S ARB FENCE 'b'`)).toBe('fail');

  // Unanchored: FENCE still cuts each attempt, but the scan retries at the next
  // start position, so the pattern ultimately finds 'b' at the end.
  const unanchoredSetup = `        S = 'aaab'`;
  expect(runMatch(unanchoredSetup, `S ARB FENCE 'b'`)).toBe('ok');
});

test('leading-whitespace trim using SPAN and match-replace', () => {
  const src = [
    `        &ANCHOR = 1`,
    `        L = '   hello'`,
    `        L SPAN(' ') =`,
    `        OUTPUT = '[' L ']'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('[hello]\n');
});

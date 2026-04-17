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

test('. captures a field on overall success', () => {
  const src = [
    `        LINE = 'key=value'`,
    `        LINE BREAK('=') . K '=' REM . V`,
    `        OUTPUT = K`,
    `        OUTPUT = V`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('key\nvalue\n');
});

test('. captures multiple fields in a single match', () => {
  const src = [
    `        S = 'one,two,three'`,
    `        S BREAK(',') . A ',' BREAK(',') . B ',' REM . C`,
    `        OUTPUT = A`,
    `        OUTPUT = B`,
    `        OUTPUT = C`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('one\ntwo\nthree\n');
});

test('. conditional captures do not persist when the overall match fails', () => {
  const src = [
    `        X = 'initial'`,
    `        &ANCHOR = 1`,
    `        S = 'abc'`,
    `        S BREAK('z') . X 'unreachable'       :S(HIT)F(MISS)`,
    `HIT     OUTPUT = 'unexpected'`,
    `        :(END)`,
    `MISS    OUTPUT = X`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('initial\n');
});

test('$ immediate capture persists even when the overall match fails', () => {
  // Pattern here is: BREAK('b') $ X 'z' — BREAK succeeds, $ assigns X, then 'z' fails.
  // With &ANCHOR = 1 there is only one scan start, so the $ fires exactly once.
  const src = [
    `        &ANCHOR = 1`,
    `        X = 'initial'`,
    `        S = 'aaab'`,
    `        S BREAK('b') $ X 'z'     :S(HIT)F(MISS)`,
    `HIT     OUTPUT = 'unexpected'`,
    `        :(END)`,
    `MISS    OUTPUT = X`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('aaa\n');
});

test('captures in match-replace expose the matched parts', () => {
  const src = [
    `        LINE = 'NAME=Alice;AGE=30'`,
    `        LINE 'NAME=' BREAK(';') . WHO = 'NAME=Bob'`,
    `        OUTPUT = WHO`,
    `        OUTPUT = LINE`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('Alice\nNAME=Bob;AGE=30\n');
});

test('ARBNO matches zero or more repetitions', () => {
  const yes1 = [
    `        S = ''`,
    `        S ARBNO('a') RPOS(0)     :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'bad'`,
    'END',
    '',
  ].join('\n');
  expect(run(yes1).trim()).toBe('ok');

  const yes2 = [
    `        S = 'aaaa'`,
    `        S ARBNO('a') RPOS(0)     :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'bad'`,
    'END',
    '',
  ].join('\n');
  expect(run(yes2).trim()).toBe('ok');

  const no = [
    `        S = 'aaab'`,
    `        &ANCHOR = 1`,
    `        S ARBNO('a') RPOS(0)     :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'bad'`,
    'END',
    '',
  ].join('\n');
  expect(run(no).trim()).toBe('bad');
});

test('ARBNO chained with other patterns consumes fixed-char runs', () => {
  // ARBNO is tried shortest-first, so the matcher must backtrack to find a total that
  // reaches the end-of-string anchor. All three ARBNOs together must consume all 9 chars.
  const src = [
    `        &ANCHOR = 1`,
    `        S = 'aaabbbccc'`,
    `        S ARBNO('a') ARBNO('b') ARBNO('c') RPOS(0)        :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'bad'`,
    'END',
    '',
  ].join('\n');
  expect(run(src).trim()).toBe('ok');
});

test('ARBNO with immediate capture fires on each iteration', () => {
  const src = [
    `        &ANCHOR = 1`,
    `        S = 'xyz'`,
    `        S ARBNO(LEN(1) $ LAST) RPOS(0)`,
    `        OUTPUT = LAST`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('z\n');
});

test('ARBNO of a null-matching pattern does not spin forever', () => {
  // SUCCEED matches empty; ARBNO(SUCCEED) must collapse to a zero-progress match.
  const src = [
    `        &ANCHOR = 1`,
    `        S = 'abc'`,
    `        S ARBNO(SUCCEED) RPOS(3)     :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'bad'`,
    'END',
    '',
  ].join('\n');
  expect(run(src).trim()).toBe('ok');
});

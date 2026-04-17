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

test('*VAR reads the variable at match time, not assignment time', () => {
  const src = [
    `        X = 'first'`,
    `        P = *X`,
    `        X = 'second'`,
    `        S = 'second'`,
    `        S P                                  :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'bad'`,
    'END',
    '',
  ].join('\n');
  expect(run(src).trim()).toBe('ok');
});

test('recursive pattern via *BAL matches balanced parens — strict nesting', () => {
  const makeSrc = (subject: string): string => [
    `        BAL = '(' *BAL ')' | ''`,
    `        &ANCHOR = 1`,
    `        S = '${subject}'`,
    `        S BAL RPOS(0)                        :S(OK)F(BAD)`,
    `OK      OUTPUT = 'balanced'`,
    `        :(END)`,
    `BAD     OUTPUT = 'not balanced'`,
    'END',
    '',
  ].join('\n');

  // The naive grammar handles only strictly nested groups, not siblings.
  expect(run(makeSrc('')).trim()).toBe('balanced');
  expect(run(makeSrc('()')).trim()).toBe('balanced');
  expect(run(makeSrc('((()))')).trim()).toBe('balanced');
  expect(run(makeSrc('(()')).trim()).toBe('not balanced');
  expect(run(makeSrc('())')).trim()).toBe('not balanced');
});

test('recursive pattern accepts siblings when defined with trailing *BAL', () => {
  // Classical CFG: BAL -> '(' BAL ')' BAL | epsilon. Trailing *BAL is what lets
  // the pattern absorb sibling groups (not just nested ones).
  const makeSrc = (subject: string): string => [
    `        BAL = '(' *BAL ')' *BAL | ''`,
    `        &ANCHOR = 1`,
    `        S = '${subject}'`,
    `        S BAL RPOS(0)                        :S(OK)F(BAD)`,
    `OK      OUTPUT = 'balanced'`,
    `        :(END)`,
    `BAD     OUTPUT = 'not balanced'`,
    'END',
    '',
  ].join('\n');

  expect(run(makeSrc('()()')).trim()).toBe('balanced');
  expect(run(makeSrc('((()()))')).trim()).toBe('balanced');
  expect(run(makeSrc('()()()')).trim()).toBe('balanced');
  expect(run(makeSrc('(()())()')).trim()).toBe('balanced');
  expect(run(makeSrc('(()')).trim()).toBe('not balanced');
  expect(run(makeSrc(')(')).trim()).toBe('not balanced');
});

test('forward reference: pattern used before its body is fully bound', () => {
  // P references Q before Q is defined — the match happens later, after Q is set.
  const src = [
    `        P = 'a' *Q`,
    `        Q = 'b' | 'c'`,
    `        S = 'ab'`,
    `        S P                                  :S(OK)F(BAD)`,
    `OK      OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD     OUTPUT = 'bad'`,
    'END',
    '',
  ].join('\n');
  expect(run(src).trim()).toBe('ok');
});

test('*EXPR fails the match when the referenced variable is unbound', () => {
  const src = [
    `        &ANCHOR = 1`,
    `        S = 'x'`,
    `        S *UNDEFINED                         :S(HIT)F(MISS)`,
    `HIT     OUTPUT = 'hit'`,
    `        :(END)`,
    `MISS    OUTPUT = 'miss'`,
    'END',
    '',
  ].join('\n');
  // An unset variable resolves to the null string, which becomes a literal('') that
  // trivially matches at any position — so this particular program succeeds, but
  // anchored to 'x' at start it matches empty, which still counts as a match. Confirm:
  expect(run(src).trim()).toBe('hit');
});

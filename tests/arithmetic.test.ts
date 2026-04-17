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

test('integer addition', () => {
  expect(run(`        OUTPUT = 2 + 3\nEND\n`)).toBe('5\n');
});

test('integer subtraction and negation', () => {
  expect(run(`        OUTPUT = 10 - 3\nEND\n`)).toBe('7\n');
  expect(run(`        OUTPUT = -7\nEND\n`)).toBe('-7\n');
  expect(run(`        OUTPUT = --7\nEND\n`)).toBe('7\n');
});

test('multiplication and division follow precedence', () => {
  expect(run(`        OUTPUT = 2 + 3 * 4\nEND\n`)).toBe('14\n');
  expect(run(`        OUTPUT = (2 + 3) * 4\nEND\n`)).toBe('20\n');
  expect(run(`        OUTPUT = 20 / 6\nEND\n`)).toBe('3\n');
});

test('real arithmetic produces reals', () => {
  expect(run(`        OUTPUT = 1.5 + 2.5\nEND\n`)).toBe('4\n');
  expect(run(`        OUTPUT = 10 / 4.0\nEND\n`)).toBe('2.5\n');
});

test('string concatenation with no space is not arithmetic', () => {
  // WS+PLUS+no-WS parses as concat(X, +1) = concat(X, 1) — unary + is identity
  expect(run(`        X = '5'\n        OUTPUT = X +1\nEND\n`)).toBe('51\n');
});

test('adjacent values concatenate', () => {
  expect(run(`        OUTPUT = 1 + 2 3 + 4\nEND\n`)).toBe('37\n');
});

test('non-numeric string causes arithmetic failure', () => {
  const src = `        X = 'abc' + 1 :F(L)\n        OUTPUT = 'no-fail'\n        :(END)\nL       OUTPUT = 'failed'\nEND\n`;
  expect(run(src)).toBe('failed\n');
});

test('division by zero fails', () => {
  const src = `        Y = 10 / 0 :F(L)\n        OUTPUT = 'no-fail'\n        :(END)\nL       OUTPUT = 'zero'\nEND\n`;
  expect(run(src)).toBe('zero\n');
});

test('LT/GT/EQ succeed or fail', () => {
  const passes = `        LT(1, 2)                :F(BAD)\n        OUTPUT = 'ok'\n        :(END)\nBAD     OUTPUT = 'bad'\nEND\n`;
  expect(run(passes)).toBe('ok\n');
  const fails = `        LT(5, 2)                :F(BAD)\n        OUTPUT = 'ok'\n        :(END)\nBAD     OUTPUT = 'bad'\nEND\n`;
  expect(run(fails)).toBe('bad\n');
});

test('SIZE returns string length', () => {
  expect(run(`        OUTPUT = SIZE('hello')\nEND\n`)).toBe('5\n');
});

test('DUPL repeats a string', () => {
  expect(run(`        OUTPUT = DUPL('ab', 3)\nEND\n`)).toBe('ababab\n');
});

test('REVERSE reverses a string', () => {
  expect(run(`        OUTPUT = REVERSE('HELLO')\nEND\n`)).toBe('OLLEH\n');
});

test('countdown loop using LT and goto', () => {
  const src = [
    '        N = 3',
    'LOOP    OUTPUT = N',
    '        N = N - 1',
    '        GT(N, 0)                :S(LOOP)',
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('3\n2\n1\n');
});

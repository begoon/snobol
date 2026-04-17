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

test('DEFINE registers a callable function and RETURN delivers its value', () => {
  const src = [
    `        DEFINE('DOUBLE(X)')            :(PAST)`,
    `DOUBLE  DOUBLE = X + X                 :(RETURN)`,
    `PAST    OUTPUT = DOUBLE(21)`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('42\n');
});

test('function with a local variable scopes it from the caller', () => {
  const src = [
    `        MSG = 'outer'`,
    `        DEFINE('GREET(WHO) MSG')        :(PAST)`,
    `GREET   MSG = 'hello, ' WHO`,
    `        GREET = MSG                     :(RETURN)`,
    `PAST    OUTPUT = GREET('world')`,
    `        OUTPUT = MSG`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('hello, world\n' + 'outer\n');
});

test('FRETURN reports failure back to the caller', () => {
  const src = [
    `        DEFINE('SAFEDIV(A,B)')          :(PAST)`,
    `SAFEDIV EQ(B, 0)                        :S(NODIV)`,
    `        SAFEDIV = A / B                 :(RETURN)`,
    `NODIV   :(FRETURN)`,
    `PAST    X = SAFEDIV(10, 0)              :F(DIVBY0)`,
    `        OUTPUT = X`,
    `        :(END)`,
    `DIVBY0  OUTPUT = 'division by zero'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('division by zero\n');
});

test('recursive factorial', () => {
  const src = [
    `        DEFINE('FACT(N)')               :(PAST)`,
    `FACT    LT(N, 2)                        :F(RECUR)`,
    `        FACT = 1                        :(RETURN)`,
    `RECUR   FACT = N * FACT(N - 1)          :(RETURN)`,
    `PAST    OUTPUT = FACT(5)`,
    `        OUTPUT = FACT(7)`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('120\n5040\n');
});

test('indirect goto uses the variable value as the label name', () => {
  const src = [
    `        L = 'B'`,
    `        :($L)`,
    `A       OUTPUT = 'wrong'`,
    `        :(END)`,
    `B       OUTPUT = 'right'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('right\n');
});

test('indirect variable reference reads the named variable', () => {
  const src = [
    `        NAME = 'COUNT'`,
    `        COUNT = 7`,
    `        OUTPUT = $NAME`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('7\n');
});

test('function argument values do not leak into callee scope', () => {
  // X is used in both outer and inner scopes; caller's X must be preserved.
  const src = [
    `        X = 'caller-X'`,
    `        DEFINE('INNER(X)')              :(PAST)`,
    `INNER   INNER = X                       :(RETURN)`,
    `PAST    R = INNER('inner-X')`,
    `        OUTPUT = R`,
    `        OUTPUT = X`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('inner-X\n' + 'caller-X\n');
});

test('DEFINE with an explicit entry label uses the second argument', () => {
  const src = [
    `        DEFINE('ABS(N)', 'ABSBODY')     :(PAST)`,
    `ABSBODY LT(N, 0)                        :F(KEEP)`,
    `        ABS = 0 - N                     :(RETURN)`,
    `KEEP    ABS = N                         :(RETURN)`,
    `PAST    OUTPUT = ABS(-5)`,
    `        OUTPUT = ABS(5)`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('5\n5\n');
});

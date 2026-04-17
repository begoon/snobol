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

test('ARRAY creates a 1-indexed subscriptable container', () => {
  const src = [
    `        A = ARRAY(3)`,
    `        A<1> = 'a'`,
    `        A<2> = 'b'`,
    `        A<3> = 'c'`,
    `        OUTPUT = A<1>`,
    `        OUTPUT = A<2>`,
    `        OUTPUT = A<3>`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('a\nb\nc\n');
});

test('ARRAY with an initial value fills every cell', () => {
  const src = [
    `        A = ARRAY(4, 'x')`,
    `        OUTPUT = A<1> A<2> A<3> A<4>`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('xxxx\n');
});

test('ARRAY out-of-bounds read fails the statement', () => {
  const src = [
    `        A = ARRAY(2)`,
    `        X = A<5>                :F(OUT)`,
    `        OUTPUT = 'unexpected'`,
    `        :(END)`,
    `OUT     OUTPUT = 'out of bounds'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('out of bounds\n');
});

test('ARRAY is a reference — aliasing sees mutations', () => {
  const src = [
    `        A = ARRAY(3)`,
    `        B = A`,
    `        A<1> = 'x'`,
    `        OUTPUT = B<1>`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('x\n');
});

test('TABLE stores and retrieves by string key', () => {
  const src = [
    `        T = TABLE()`,
    `        T<'name'> = 'Alice'`,
    `        T<'age'> = 30`,
    `        OUTPUT = T<'name'>`,
    `        OUTPUT = T<'age'>`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('Alice\n30\n');
});

test('TABLE missing key reads as empty string', () => {
  const src = [
    `        T = TABLE()`,
    `        T<'k'> = 'v'`,
    `        OUTPUT = '[' T<'nope'> ']'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('[]\n');
});

test('TABLE supports numeric and multi-valued keys via stringification', () => {
  const src = [
    `        T = TABLE()`,
    `        T<1> = 'one'`,
    `        T<'1'> = 'also one'`,
    `        OUTPUT = T<1>`,
    `        OUTPUT = T<'1'>`,
    'END',
    '',
  ].join('\n');
  // 1 and '1' both stringify to '1' — same slot, last write wins
  expect(run(src)).toBe('also one\nalso one\n');
});

test('arrays hold any value, including other arrays and patterns', () => {
  const src = [
    `        OUTER = ARRAY(2)`,
    `        INNER = ARRAY(2)`,
    `        INNER<1> = 'nested'`,
    `        OUTER<1> = INNER`,
    `        OUTPUT = OUTER<1><1>`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('nested\n');
});

test('subscript read failure propagates to the caller goto', () => {
  const src = [
    `        A = ARRAY(3)`,
    `        DEFINE('FIFTH(X)')            :(PAST)`,
    `FIFTH   FIFTH = X<5>                  :S(RETURN)F(FRETURN)`,
    `PAST    Y = FIFTH(A)                  :S(HIT)F(MISS)`,
    `HIT     OUTPUT = 'hit'`,
    `        :(END)`,
    `MISS    OUTPUT = 'miss'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('miss\n');
});

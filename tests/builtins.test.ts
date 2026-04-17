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

test('REPLACE performs character-wise substitution', () => {
  const src = [
    `        OUTPUT = REPLACE('hello', 'el', 'ip')`,
    `        OUTPUT = REPLACE('ABCDE', 'ABCDE', 'abcde')`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('hippo\nabcde\n');
});

test('REPLACE fails when from and to differ in length', () => {
  const src = [
    `        X = REPLACE('hi', 'hi', 'bye')         :F(FLAGGED)`,
    `        OUTPUT = 'unexpected'`,
    `        :(END)`,
    `FLAGGED OUTPUT = 'length mismatch'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('length mismatch\n');
});

test('DATATYPE names every built-in kind', () => {
  const src = [
    `        OUTPUT = DATATYPE('hi')`,
    `        OUTPUT = DATATYPE(42)`,
    `        OUTPUT = DATATYPE(3.14)`,
    `        OUTPUT = DATATYPE(ARB)`,
    `        OUTPUT = DATATYPE(ARRAY(3))`,
    `        OUTPUT = DATATYPE(TABLE())`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('STRING\nINTEGER\nREAL\nPATTERN\nARRAY\nTABLE\n');
});

test('CONVERT reshapes values between scalar types', () => {
  const src = [
    `        OUTPUT = CONVERT('42', 'INTEGER') + 1`,
    `        OUTPUT = CONVERT(3.7, 'INTEGER')`,
    `        OUTPUT = CONVERT(5, 'STRING') 'x'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('43\n3\n5x\n');
});

test('CONVERT fails when a numeric conversion has no interpretation', () => {
  const src = [
    `        X = CONVERT('abc', 'INTEGER')           :F(BAD)`,
    `        OUTPUT = 'unexpected'`,
    `        :(END)`,
    `BAD     OUTPUT = 'fail'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('fail\n');
});

test('COPY on an array detaches it from the source', () => {
  const src = [
    `        A = ARRAY(3, 'x')`,
    `        B = COPY(A)`,
    `        A<1> = 'mutated'`,
    `        OUTPUT = A<1>`,
    `        OUTPUT = B<1>`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('mutated\nx\n');
});

test('CHAR converts a code point to a character', () => {
  const src = [
    `        OUTPUT = CHAR(65) CHAR(66) CHAR(67)`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('ABC\n');
});

test('INTEGER predicate succeeds on integer-shaped values only', () => {
  const src = [
    `        INTEGER(42)                             :F(BAD1)`,
    `        INTEGER('123')                          :F(BAD2)`,
    `        INTEGER('3.14')                         :S(BAD3)`,
    `        INTEGER('abc')                          :S(BAD4)`,
    `        OUTPUT = 'ok'`,
    `        :(END)`,
    `BAD1    OUTPUT = 'int fail'`,
    `        :(END)`,
    `BAD2    OUTPUT = 'numeric str fail'`,
    `        :(END)`,
    `BAD3    OUTPUT = 'real slipped through'`,
    `        :(END)`,
    `BAD4    OUTPUT = 'text slipped through'`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('ok\n');
});

test('APPLY invokes a function looked up by name at runtime', () => {
  const src = [
    `        DEFINE('GREET(NAME)')                  :(PAST)`,
    `GREET   GREET = 'hi, ' NAME                    :(RETURN)`,
    `PAST    FN = 'GREET'`,
    `        OUTPUT = APPLY(FN, 'world')`,
    `        OUTPUT = APPLY('SIZE', 'hello')`,
    'END',
    '',
  ].join('\n');
  expect(run(src)).toBe('hi, world\n5\n');
});

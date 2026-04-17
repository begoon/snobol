import { expect, test } from 'bun:test';
import { Interpreter } from '../src/interpreter.ts';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';

function runWith(src: string, input: readonly string[] = []): string {
  let captured = '';
  const interp = new Interpreter();
  interp.setInput(input);
  interp.run(parse(tokenize(src)), (s) => {
    captured += s;
  });
  return captured;
}

test('INPUT yields lines in order and fails at EOF', () => {
  const src = [
    `LOOP    LINE = INPUT                 :F(DONE)`,
    `        OUTPUT = 'got: ' LINE`,
    `        :(LOOP)`,
    `DONE    OUTPUT = 'eof'`,
    'END',
    '',
  ].join('\n');
  expect(runWith(src, ['hello', 'world'])).toBe('got: hello\ngot: world\neof\n');
});

test('INPUT returns empty string for blank input lines without treating them as EOF', () => {
  const src = [
    `        A = INPUT                   :F(BAD)`,
    `        B = INPUT                   :F(BAD)`,
    `        OUTPUT = '[' A '] [' B ']'`,
    `        :(END)`,
    `BAD     OUTPUT = 'unexpected eof'`,
    'END',
    '',
  ].join('\n');
  expect(runWith(src, ['', 'x'])).toBe('[] [x]\n');
});

test('+ continuation merges a line into the previous statement', () => {
  const src = [
    `        OUTPUT = 'hello' ' '`,
    `+                 'world'`,
    'END',
    '',
  ].join('\n');
  expect(runWith(src)).toBe('hello world\n');
});

test('. continuation works the same as +', () => {
  const src = [
    `        X = 1 + 2`,
    `.                 + 3`,
    `        OUTPUT = X`,
    'END',
    '',
  ].join('\n');
  expect(runWith(src)).toBe('6\n');
});

test('continuation survives an intervening comment line', () => {
  const src = [
    `        OUTPUT = 'first'`,
    `        X = 'one'`,
    `*       a comment between the statement and its continuation`,
    `+                 ' ' 'two'`,
    `        OUTPUT = X`,
    'END',
    '',
  ].join('\n');
  expect(runWith(src)).toBe('first\none two\n');
});

test('continuation works inside a pattern match-replace', () => {
  const src = [
    `        LINE = 'the lazy dog'`,
    `        LINE 'lazy'`,
    `+                  = 'quick'`,
    `        OUTPUT = LINE`,
    'END',
    '',
  ].join('\n');
  expect(runWith(src)).toBe('the quick dog\n');
});

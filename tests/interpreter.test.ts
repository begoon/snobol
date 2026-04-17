import { expect, test } from 'bun:test';
import { Interpreter } from '../src/interpreter.ts';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';

function run(src: string): string {
  let captured = '';
  const program = parse(tokenize(src));
  new Interpreter().run(program, (s) => {
    captured += s;
  });
  return captured;
}

test('hello, world', () => {
  const src = `        OUTPUT = 'HELLO, WORLD'\nEND\n`;
  expect(run(src)).toBe('HELLO, WORLD\n');
});

test('comments are ignored', () => {
  const src = `*   greeting\n        OUTPUT = 'HI'\nEND\n`;
  expect(run(src)).toBe('HI\n');
});

test('concatenation via adjacency', () => {
  const src = `        OUTPUT = 'HELLO,' ' ' 'WORLD'\nEND\n`;
  expect(run(src)).toBe('HELLO, WORLD\n');
});

test('variable reference', () => {
  const src = `        X = 'WORLD'\n        OUTPUT = 'HELLO, ' X\nEND\n`;
  expect(run(src)).toBe('HELLO, WORLD\n');
});

test('unconditional goto skips past a line', () => {
  const src = `        :(L2)\nL1      OUTPUT = 'ONE'\n        :(DONE)\nL2      OUTPUT = 'TWO'\n        :(L1)\nDONE    :(END)\nEND\n`;
  expect(run(src)).toBe('TWO\nONE\n');
});

test('success goto fires on assignment', () => {
  const src = `        X = 'Y' :S(L)\n        OUTPUT = 'SKIPPED'\nL       OUTPUT = X\nEND\n`;
  expect(run(src)).toBe('Y\n');
});

test('unset variable reads as empty string', () => {
  const src = `        OUTPUT = 'A' NOPE 'B'\nEND\n`;
  expect(run(src)).toBe('AB\n');
});

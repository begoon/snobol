#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { Interpreter } from './interpreter.ts';
import { tokenize } from './lexer.ts';
import { parse } from './parser.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: snobol4 <file.sno>');
  process.exit(1);
}

try {
  const src = readFileSync(file, 'utf8');
  const program = parse(tokenize(src));
  const interp = new Interpreter();

  // Only read stdin if something is piped in; reading fd 0 on a TTY would block forever.
  if (!process.stdin.isTTY) {
    interp.setInput(readFileSync(0, 'utf8'));
  }

  interp.run(program, (s) => process.stdout.write(s));
} catch (err) {
  if (err instanceof SyntaxError) {
    console.error(`${file}: syntax error: ${err.message}`);
  } else if (err instanceof Error) {
    console.error(`${file}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

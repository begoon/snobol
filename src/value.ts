import type { PNode } from './pattern.ts';

export interface SnoArray {
  readonly kind: 'array';
  readonly size: number;
  readonly data: SnoValue[];
}

export interface SnoTable {
  readonly kind: 'table';
  readonly entries: Map<string, SnoValue>;
}

export type SnoValue =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'integer'; readonly value: number }
  | { readonly kind: 'real'; readonly value: number }
  | { readonly kind: 'pattern'; readonly node: PNode }
  | SnoArray
  | SnoTable
  | { readonly kind: 'null' };

export const NULL: SnoValue = { kind: 'null' };
export const str = (value: string): SnoValue => ({ kind: 'string', value });
export const int = (value: number): SnoValue => ({ kind: 'integer', value });
export const pat = (node: PNode): SnoValue => ({ kind: 'pattern', node });

export function toStr(v: SnoValue): string {
  switch (v.kind) {
    case 'string':
      return v.value;
    case 'integer':
      return String(v.value);
    case 'real':
      return String(v.value);
    case 'pattern':
      return '<PATTERN>';
    case 'array':
      return `<ARRAY(${v.size})>`;
    case 'table':
      return `<TABLE(${v.entries.size})>`;
    case 'null':
      return '';
  }
}

export function toPattern(v: SnoValue): PNode {
  if (v.kind === 'pattern') return v.node;
  return { kind: 'literal', value: toStr(v) };
}

const INT_LIT = /^-?[0-9]+$/;
const REAL_LIT = /^-?(?:[0-9]+\.[0-9]*|\.[0-9]+)$/;

export function toNumber(v: SnoValue): number | null {
  switch (v.kind) {
    case 'integer':
    case 'real':
      return v.value;
    case 'null':
      return 0;
    case 'string':
      if (v.value === '') return 0;
      if (INT_LIT.test(v.value)) return parseInt(v.value, 10);
      if (REAL_LIT.test(v.value)) return parseFloat(v.value);
      return null;
    case 'pattern':
    case 'array':
    case 'table':
      return null;
  }
}

export function toInt(v: SnoValue): number | null {
  const n = toNumber(v);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EXIT } from './cli/types.js';
import { ERROR_CODES } from './errors.js';

const readme: string = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The body of the `## <heading>` section, up to the next `## `. */
const section = (heading: string): string => {
  const start: number = readme.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`README has no "## ${heading}" section`);
  const rest: string = readme.slice(start + heading.length + 5);
  const end: number = rest.search(/\n## /);

  return end === -1 ? rest : rest.slice(0, end);
};

/** Table rows as cells, header and separator rows dropped. */
const rows = (body: string): string[][] =>
  body
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

const codesIn = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);

// The README is the public reference the docs page links to: these keep it in step with the code.
describe('README', () => {
  it('has every section the plan names', () => {
    for (const heading of ['Install', 'Quick start', 'Caching', 'Typed keys', 'Using with React', 'API', 'Errors', 'Exit codes', 'Why no t()', 'Licence']) {
      expect(() => section(heading), heading).not.toThrow();
    }
  });

  it('Errors lists every TranslifyErrorCode exactly once', () => {
    const documented = rows(section('Errors')).flatMap(([code]) => codesIn(code as string));
    expect(documented.toSorted()).toEqual([...ERROR_CODES].toSorted());
  });

  it('Exit codes lists every EXIT value exactly once', () => {
    const documented = rows(section('Exit codes')).map(([exit]) => Number(exit));
    expect(documented.toSorted()).toEqual(Object.values(EXIT).toSorted());
  });

  it('never documents a default baseUrl', () => {
    expect(readme).not.toMatch(/baseUrl[^\n]*(defaults? to|default:|default `)/i);
  });

  it('Quick start passes baseUrl and uses a pk_ key', () => {
    expect(section('Quick start')).toContain('baseUrl:');
    expect(section('Quick start')).toContain("key: 'pk_");
  });

  it('Using with React builds on useSyncExternalStore', () => {
    expect(section('Using with React')).toContain('useSyncExternalStore');
  });
});

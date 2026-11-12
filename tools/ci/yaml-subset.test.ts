/**
 * yaml-subset line-break differential (TASK-007; PR #10 code review m1). The splitter breaks lines on `\r?\n` only, so a
 * character that another YAML parser treats as a line break (lone CR, NEL, LS, PS) inside a comment would hide the rest
 * of that physical line from the checkers while GitHub's parser runs it. The parser must fail closed instead.
 * The broader subset tests live in check-workflow-policy.test.ts.
 */
import { describe, expect, it } from '@jest/globals';

import { YamlSubsetError, parseYamlSubset } from './yaml-subset.mjs';

/** A workflow whose first step's comment hides a second step behind `separator`. */
const hidden = (separator: string): string =>
  [
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    `      - run: echo ok # note${separator}      - run: npx evil --ignore-scripts false`,
    '',
  ].join('\n');

function lineOf(text: string): number {
  try {
    parseYamlSubset(text);
  } catch (error) {
    if (error instanceof YamlSubsetError) return error.line;
    throw error;
  }
  throw new Error('parseYamlSubset did not throw');
}

describe('yaml-subset: forbidden characters fail closed (code review m1)', () => {
  it.each([
    ['a lone carriage return', '\r'],
    ['NEXT LINE U+0085', '\u0085'],
    ['LINE SEPARATOR U+2028', '\u2028'],
    ['PARAGRAPH SEPARATOR U+2029', '\u2029'],
    ['vertical tab U+000B', '\u000b'],
    ['form feed U+000C', '\u000c'],
    ['NUL U+0000', '\u0000'],
    ['ESC U+001B', '\u001b'],
    ['a byte-order mark after the first character', '\uFEFF'],
  ])('%s inside a comment hiding a following `- run: npx evil` step throws and reports line 5', (_name, separator) => {
    const text = hidden(separator);
    expect(() => parseYamlSubset(text)).toThrow(YamlSubsetError);
    expect(lineOf(text)).toBe(5);
  });

  it('reports the 1-based line of the offending character in a CRLF file', () => {
    expect(lineOf('a: 1\r\nb: 2\r\n# x\u2028y\r\n')).toBe(3);
    expect(() => parseYamlSubset('a: 1\r\nb: 2\r\n# x\u2028y\r\n')).toThrow(/LINE SEPARATOR \(U\+2028\) is not allowed \(line 3\)/);
  });

  it('names a generic C0 control by code point', () => {
    expect(() => parseYamlSubset('a: 1\nb: x\u0007\n')).toThrow(/control character U\+0007 is not allowed \(line 2\)/);
  });

  it('a lone CR at the very end of the file still fails (it is not part of CRLF)', () => {
    expect(lineOf('a: 1\nb: 2\r')).toBe(2);
  });

  it('a normal CRLF file still parses, with a leading byte-order mark and TAB inside a scalar', () => {
    const text = '\uFEFFjobs:\r\n  build:\r\n    steps:\r\n      - run: "echo\\ta" # comment\r\n      - run: echo\tb\r\n';
    expect(parseYamlSubset(text).value).toEqual({ jobs: { build: { steps: [{ run: 'echo\ta' }, { run: 'echo\tb' }] } } });
  });

  it('an LF file with the same steps and no hidden character parses both steps', () => {
    expect(parseYamlSubset(hidden('\n')).value).toEqual({
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'echo ok' }, { run: 'npx evil --ignore-scripts false' }],
        },
      },
    });
  });
});

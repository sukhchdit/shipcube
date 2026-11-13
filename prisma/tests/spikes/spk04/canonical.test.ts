import { describe, expect, it } from '@jest/globals';

import { CanonicalJsonError, canonicalize } from './canonical.js';

describe('SPK-04 canonicalize (RFC 8785 JCS)', () => {
  it('RFC 8785 §3.2.3: sorts keys by UTF-16 code units', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      דּ: 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      ö: 'Latin Small Letter O With Diaeresis',
    };
    const keys = Object.keys(JSON.parse(canonicalize(input)) as Record<string, string>);
    // JSON.parse re-orders integer-like keys first; compare the serialised order instead.
    expect(keys).toContain('1');
    expect(canonicalize(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis",' +
        '"€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it('RFC 8785 §3.2.2: the numbers / string / literals example', () => {
    const input = {
      numbers: [Number('333333333.33333329'), 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      // RFC 8785 §3.2.2 input string: euro, '$', U+000F, LF, "A'B", quote, two backslashes, quote, slash
      string: `${String.fromCharCode(0x20ac)}$${String.fromCharCode(0x0f, 0x0a)}A'B"${String.fromCharCode(92, 92)}"/`,
      literals: [null, true, false],
    };
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('RFC 8785 Appendix B number serialisation samples', () => {
    expect(canonicalize([0, -0, 1e21, 1e-7, 0.000001, 9007199254740991, -1.5, 5e-324])).toBe(
      '[0,0,1e+21,1e-7,0.000001,9007199254740991,-1.5,5e-324]',
    );
  });

  it('nests and keeps array order; no whitespace', () => {
    expect(canonicalize({ b: [3, { z: 1, a: null }], a: 'x' })).toBe('{"a":"x","b":[3,{"a":null,"z":1}]}');
    expect(canonicalize(Object.create(null) as object)).toBe('{}');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
    ['undefined member', { a: undefined }],
    ['undefined element', [undefined]],
    ['bigint', 1n],
    ['Date', new Date(0)],
    ['function', () => 1],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalJsonError);
  });
});

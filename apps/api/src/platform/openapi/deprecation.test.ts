// Deprecation header values (US-035, REQ-API-015; RFC 9745 / RFC 8594): formats and refusal of bad metadata.
import { describe, expect, it } from '@jest/globals';

import { DeprecationConfigError, deprecationHeaderValues } from './deprecation.js';

describe('deprecationHeaderValues', () => {
  it('formats Deprecation as @unix-seconds, Sunset as an HTTP-date and Link with rel="deprecation"', () => {
    expect(
      deprecationHeaderValues({ since: '2026-11-12', sunset: '2027-06-30', link: 'https://docs.platform.invalid/migrations/v2' }),
    ).toEqual({
      Deprecation: `@${Date.UTC(2026, 10, 12) / 1000}`,
      Sunset: 'Wed, 30 Jun 2027 00:00:00 GMT',
      Link: '<https://docs.platform.invalid/migrations/v2>; rel="deprecation"',
    });
  });

  it('accepts RFC 3339 date-times with offsets', () => {
    const values = deprecationHeaderValues({
      since: '2026-11-12T10:00:00+01:00',
      sunset: '2027-06-30T00:00:00Z',
      link: 'https://docs.platform.invalid/x',
    });
    expect(values.Deprecation).toBe(`@${Date.UTC(2026, 10, 12, 9) / 1000}`);
  });

  it.each([
    [{ since: '12/11/2026', sunset: '2027-06-30', link: 'https://docs.platform.invalid/x' }, /since/],
    [{ since: '2026-11-12', sunset: 'soon', link: 'https://docs.platform.invalid/x' }, /sunset/],
    [{ since: '2026-11-12', sunset: '2026-02-30', link: 'https://docs.platform.invalid/x' }, /sunset/],
    [{ since: '2027-06-30', sunset: '2026-11-12', link: 'https://docs.platform.invalid/x' }, /after/],
    [{ since: '2026-11-12', sunset: '2027-06-30', link: '/relative' }, /absolute/],
    [{ since: '2026-11-12', sunset: '2027-06-30', link: 'http://docs.platform.invalid/x' }, /https/],
  ])('refuses invalid metadata %#', (info, message) => {
    expect(() => deprecationHeaderValues(info)).toThrow(DeprecationConfigError);
    expect(() => deprecationHeaderValues(info)).toThrow(message);
  });
});

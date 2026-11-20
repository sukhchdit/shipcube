/**
 * Lane zones of the Mock carrier: a pure function of the two country codes. Zone 1 is domestic, 2 the same region,
 * 3 adjacent regions along a west-to-east axis, 4 everything farther (and any country the table does not know).
 */
import type { MockZone } from './constants.js';

/** Regions in axis order; the index distance decides the zone. */
const REGIONS: readonly (readonly string[])[] = [
  ['US', 'CA', 'MX'],
  ['BR', 'AR', 'CL', 'CO', 'PE'],
  ['GB', 'IE', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'PT'],
  ['AE', 'SA', 'IL', 'TR', 'EG', 'ZA', 'NG', 'KE'],
  ['IN', 'PK', 'BD', 'LK', 'NP'],
  ['CN', 'JP', 'KR', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'HK', 'TW'],
  ['AU', 'NZ'],
];

const REGION_OF: ReadonlyMap<string, number> = new Map(
  REGIONS.flatMap((countries, index) => countries.map((code): [string, number] => [code, index])),
);

/** The zone of a lane between two upper-case ISO 3166-1 alpha-2 codes; symmetric, so imports price like exports. */
export function laneZone(originCountry: string, destinationCountry: string): MockZone {
  if (originCountry === destinationCountry) return 1;
  const origin = REGION_OF.get(originCountry);
  const destination = REGION_OF.get(destinationCountry);
  if (origin === undefined || destination === undefined) return 4;
  const distance = Math.abs(origin - destination);
  if (distance === 0) return 2;
  return distance === 1 ? 3 : 4;
}

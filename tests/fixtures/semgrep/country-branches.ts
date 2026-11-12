// Semgrep test fixture for .semgrep/country-branches.yml (REQ-COMP-005). Never executed.
interface Shipment {
  destinationCountry: string;
  originCountry: string;
  unit: string;
}

export function branches(shipment: Shipment, countryCode: string, rates: Record<string, number>): number {
  let rate = 0;
  // ruleid: platform.country-branches.hard-coded-country
  if (countryCode === 'IN') rate = 18;
  // ruleid: platform.country-branches.hard-coded-country
  if ('US' === shipment.originCountry) rate = 0;
  // ruleid: platform.country-branches.hard-coded-country
  if (shipment.destinationCountry !== 'GB') rate += 1;
  // ruleid: platform.country-branches.hard-coded-country
  if (['DE', 'FR'].includes(shipment.destinationCountry)) rate += 2;
  // ruleid: platform.country-branches.hard-coded-country
  switch (countryCode) {
    case 'IN':
      rate = 18;
      break;
    default:
      rate = 0;
  }
  // ok: platform.country-branches.hard-coded-country
  if (shipment.unit === 'KG') rate += 0;
  // ok: platform.country-branches.hard-coded-country
  if (countryCode === shipment.destinationCountry) rate += 0;
  // ok: platform.country-branches.hard-coded-country
  rate += rates[countryCode] ?? 0;
  return rate;
}

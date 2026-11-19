// Child process of AT-US-138-01 (engine.test.ts): prices the JSON input on stdin and prints the serialised result.
import { readFileSync } from 'node:fs';

import { price } from '../engine.js';
import type { PricingInput } from '../types.js';

const input = JSON.parse(readFileSync(0, 'utf8')) as PricingInput;
process.stdout.write(JSON.stringify(price(input)));

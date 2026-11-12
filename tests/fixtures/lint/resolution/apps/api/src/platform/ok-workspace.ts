import * as shared from '@platform/shared';

import { local } from './local.js';

export const wiring = (): unknown => [shared, local];

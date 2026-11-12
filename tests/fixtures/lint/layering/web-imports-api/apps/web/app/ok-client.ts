import { greeting } from '@platform/shared';
import { SkipLink } from '@platform/ui';

export const boot = (): unknown => [greeting, SkipLink];

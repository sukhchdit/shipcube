import { isAppError } from '@platform/shared';

export const probe = (): unknown => isAppError;

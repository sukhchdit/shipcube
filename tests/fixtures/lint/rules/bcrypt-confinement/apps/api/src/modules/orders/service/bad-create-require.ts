import { createRequire } from 'node:module';

export const loadHasher = (): unknown => createRequire(import.meta.url)('bcrypt');

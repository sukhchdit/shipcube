import { hashSync } from 'bcryptjs/umd';

export const hash = (secret: string): string => hashSync(secret, 12);

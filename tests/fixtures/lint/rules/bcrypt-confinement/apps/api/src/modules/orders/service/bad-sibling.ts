import { hash } from 'bcrypt-ts';

export const digest = (secret: string): Promise<string> => hash(secret, 12);

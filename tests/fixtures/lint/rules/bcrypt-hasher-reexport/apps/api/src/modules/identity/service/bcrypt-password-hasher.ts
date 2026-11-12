import bcrypt from 'bcrypt';

export { compare } from 'bcrypt';

export const hash = (secret: string): Promise<string> => bcrypt.hash(secret, 12);

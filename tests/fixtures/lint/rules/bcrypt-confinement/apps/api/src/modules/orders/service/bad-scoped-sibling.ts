import { hash } from '@node-rs/bcrypt';

export const digest = (secret: string): Promise<string> => hash(secret, 12);

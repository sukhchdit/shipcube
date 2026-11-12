export const hash = async (secret: string): Promise<string> => (await import('bcrypt')).default.hash(secret, 12);

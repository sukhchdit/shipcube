// D-ARCH-103 (3): the tx slot gets the runner from the runtime, never the generated client module: refused.
import { PrismaClient } from '../db/generated.js';

export const client = PrismaClient;

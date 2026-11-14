// D-ARCH-114: the worker's platform/db imports the generated client as a VALUE: refused (the worker takes the runner
// from createRuntimeServices and its types from @platform/api/runtime; it has no composition of its own).
import { Prisma } from '../../../../../prisma/generated/prisma/client.js';

export const fragment = Prisma.sql;

import type { Request } from 'express';

export const requestPath = (request: Request): string => request.path;

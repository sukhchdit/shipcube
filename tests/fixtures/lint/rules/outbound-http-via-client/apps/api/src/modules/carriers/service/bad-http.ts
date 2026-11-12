import { request } from 'node:http';

export const call = (): unknown => request('http://localhost');

import request from 'supertest';

// A spec that bypasses the contract helper: its responses would never be validated against openapi.yaml.
export const probe = (app: Parameters<typeof request>[0]): unknown => request(app).get('/health/live');

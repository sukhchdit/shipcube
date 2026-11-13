import request from 'supertest';

// The contract helper folder is the one place that wraps supertest(app).
export const agent = (app: Parameters<typeof request>[0]): unknown => request(app);

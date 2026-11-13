/** Local ports of the e2e static servers: below the Windows dynamic port range (49152+). Shared by config and specs. */
export const WEB_PORT = 4173;
export const ADMIN_PORT = 4174;

export const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const ADMIN_BASE_URL = `http://127.0.0.1:${ADMIN_PORT}`;

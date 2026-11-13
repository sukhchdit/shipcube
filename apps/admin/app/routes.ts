import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

/** Pure SPA (ADR-0026 §1): no prerendered page; Nginx serves `index.html` for every path. */
export default [layout('routes/shell.tsx', [index('routes/home.tsx')]), route('*', 'routes/not-found.tsx')] satisfies RouteConfig;

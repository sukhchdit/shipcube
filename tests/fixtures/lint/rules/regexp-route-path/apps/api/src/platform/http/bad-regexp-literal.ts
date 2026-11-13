interface Router {
  use(path: unknown, ...handlers: unknown[]): void;
  get(path: unknown, ...handlers: unknown[]): void;
}

declare const app: Router;
declare const router: Router;

// PR #32 m5 (PR32-SEC-11): RegExp literal paths the drift walker cannot list (non-capturing group, alternation).
app.use(/^\/api\/(?:v1|v2)/u, router);
router.get(/^\/things|^\/hidden/u, () => undefined);

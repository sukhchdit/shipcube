interface Router {
  use(path: unknown, ...handlers: unknown[]): void;
  post(path: unknown, ...handlers: unknown[]): void;
  all(path: unknown, ...handlers: unknown[]): void;
}

declare const app: Router;
declare const router: Router;

// PR #32 m5 (PR32-SEC-11): new RegExp(...), RegExp(...) and a RegExp inside an array of paths.
app.use(new RegExp('^/api/v[12]', 'u'), router);
router.post(RegExp('^/things', 'u'), () => undefined);
router.all(['/things', /^\/hidden/u], () => undefined);

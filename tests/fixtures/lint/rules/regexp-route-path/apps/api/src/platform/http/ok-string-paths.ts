interface Router {
  use(path: unknown, ...handlers: unknown[]): void;
  get(path: unknown, ...handlers: unknown[]): void;
}

declare const app: Router;
declare const router: Router;

// PR #32 m5 positive control: string paths (and a RegExp used for something other than a path argument).
const ID = /^[0-9a-f-]{36}$/u;
app.use('/api/v1', router);
router.get('/things/:id', (id: string) => ID.test(id));

/**
 * Zero-dependency static server for the Playwright smoke suite (TASK-004). It mirrors the routing of
 * infra/nginx/{web,admin}.conf.template so the suite exercises the built apps the way Nginx serves them:
 *   web:   `/` -> 302 /{lng}/ (cookie `lng`, then the first en|es|fr in Accept-Language, then en; DR-A18),
 *          then `$uri`, `$uri/index.html`, `/index.html` (SPA fallback); missing `/assets/*` -> 404.
 *   admin: `$uri`, then `/index.html`; missing `/assets/*` -> 404.
 * Both: GET/HEAD only (405), dotfiles denied (403), malformed percent-escapes and traversal attempts -> 400.
 * The Accept-Language regex is read from the web template itself, so the two cannot drift. The Nginx image (headers,
 * compression, cache policy) is exercised by the header/response suite of TASK-022.
 *
 * Usage: node tests/e2e/support/static-server.ts <web|admin> <port>   (Node 24 strips the types natively, which is why
 * tests/e2e/tsconfig.json sets erasableSyntaxOnly; this file imports Node built-ins only).
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

type Mode = 'web' | 'admin';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const LOCALE_COOKIE = /(?:^|;\s*)lng=(en|es|fr)(?:;|$)/;

function fail(message: string, code: number): never {
  process.stderr.write(`static-server: ${message}\n`);
  process.exit(code);
}

/**
 * The `map $http_accept_language $web_accept_language_raw` regex of infra/nginx/web.conf.template. Nginx `~*` is a
 * case-insensitive PCRE match; the pattern only uses syntax JavaScript shares (named group `web_al`).
 */
function acceptLanguagePattern(template: string): RegExp {
  const block = /map \$http_accept_language \$web_accept_language_raw \{(?<body>[^}]*)\}/.exec(template)?.groups?.['body'];
  const pattern = block === undefined ? undefined : /"~\*(?<regex>[^"]+)"\s+\$web_al;/.exec(block)?.groups?.['regex'];
  if (pattern === undefined) throw new Error('Accept-Language map not found in infra/nginx/web.conf.template');
  return new RegExp(pattern, 'i');
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function decodedPathname(url: string | undefined): string | undefined {
  try {
    return decodeURIComponent(new URL(url ?? '/', 'http://localhost').pathname);
  } catch {
    // Malformed percent-escape (PR4-SEC-07): a client error, never a crash of the server.
    return undefined;
  }
}

function startServer(mode: Mode, port: number): void {
  const root = join(REPO_ROOT, 'apps', mode, 'build', 'client');
  if (!isFile(join(root, 'index.html'))) fail(`${root}${sep}index.html not found: run \`npm run build\` first`, 1);
  const acceptLanguage = acceptLanguagePattern(readFileSync(join(REPO_ROOT, 'infra', 'nginx', 'web.conf.template'), 'utf8'));

  const localeFor = (request: IncomingMessage): string => {
    const fromCookie = LOCALE_COOKIE.exec(request.headers.cookie ?? '')?.[1];
    if (fromCookie !== undefined) return fromCookie;
    return acceptLanguage.exec(request.headers['accept-language'] ?? '')?.groups?.['web_al']?.toLowerCase() ?? 'en';
  };

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodedPathname(request.url);
    if (pathname === undefined) {
      response.writeHead(400).end();
      return;
    }
    if (mode === 'web' && pathname === '/') {
      response.writeHead(302, { Location: `/${localeFor(request)}/`, 'Cache-Control': 'no-store', Vary: 'Cookie, Accept-Language' }).end();
      return;
    }
    const requested = normalize(join(root, pathname));
    if (!requested.startsWith(root + sep) && requested !== root) {
      response.writeHead(400).end();
      return;
    }
    if (/[/\\]\./.test(requested.slice(root.length))) {
      response.writeHead(403).end();
      return;
    }
    const candidates = pathname.startsWith('/assets/')
      ? [requested]
      : mode === 'web'
        ? [requested, join(requested, 'index.html'), join(root, 'index.html')]
        : [requested, join(root, 'index.html')];
    const file = candidates.find(isFile);
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file)
      .on('error', () => response.destroy())
      .pipe(response);
  };

  createServer((request, response) => {
    try {
      handle(request, response);
    } catch (error) {
      // Never let one request take the suite's server down; the test sees the 500.
      process.stderr.write(`static-server: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`${mode} static server on http://127.0.0.1:${port}\n`);
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [modeArg, portArg] = process.argv.slice(2);
  const port = Number(portArg);
  if ((modeArg !== 'web' && modeArg !== 'admin') || !Number.isInteger(port) || port <= 0) {
    fail('usage: static-server.ts <web|admin> <port>', 2);
  }
  startServer(modeArg, port);
}

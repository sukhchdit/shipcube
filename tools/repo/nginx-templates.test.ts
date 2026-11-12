/**
 * TASK-004: static checks of the Nginx templates for apps/web and apps/admin (platform.md §3.3, ADR-0026 am. 4/5).
 * The response behaviour itself (302 targets, cache headers, 404/405) is asserted against a running image by the
 * header/response suite of TASK-022; these checks keep the templates from drifting before that suite exists, and
 * exercise the DR-A18 Accept-Language regex of the web template with the JavaScript engine (same PCRE subset).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';

const repoRoot = findRepoRoot();
const read = (app: string) => readFileSync(join(repoRoot, 'infra', 'nginx', `${app}.conf.template`), 'utf8');
const web = read('web');
const admin = read('admin');

/** Placeholders the image's envsubst step fills: `${NAME}` (nginx runtime variables are written `$name`). */
const placeholders = (template: string) => [...new Set([...template.matchAll(/\$\{([A-Z_]+)\}/g)].map(([, name]) => name))];

/** Applies the web template's Accept-Language map the way nginx does (case-insensitive `~*`, named capture). */
function acceptLanguageLocale(header: string): string {
  const source = /"~\*(\(\?:\^\|,\)[^"]+)"\s+\$web_al;/.exec(web)?.[1];
  if (source === undefined) throw new Error('Accept-Language map entry not found in web.conf.template');
  const match = new RegExp(source, 'i').exec(header);
  return match?.groups?.['web_al']?.toLowerCase() ?? 'en';
}

describe('Nginx templates (TASK-004, platform.md §3.3)', () => {
  it.each([
    ['web', web],
    ['admin', admin],
  ])('%s: only ${NGINX_PORT} is substituted and the document root is the static build', (_app, template) => {
    expect(placeholders(template)).toEqual(['NGINX_PORT']);
    // default_server: a stock conf.d/default.conf left in the image cannot take over the requests (PR4-SEC-02).
    expect(template).toContain('listen ${NGINX_PORT} default_server;');
    expect(template).toContain('root /usr/share/nginx/html;');
    expect(template).toContain('server_tokens off;');
    expect(template).toMatch(/if \(\$request_method !~ \^\(\?:GET\|HEAD\)\$\) \{\s+return 405;/);
    expect(template).toMatch(/location \/assets\/ \{\s+try_files \$uri =404;/);
    expect(template).toMatch(/"~\^200:\/assets\/"\s+"public, max-age=31536000, immutable";/);
    expect(template).toMatch(/default\s+"no-cache";/);
    // Every add_header sits at server level (4-space indent): a location-level add_header drops the inherited ones.
    expect(template).not.toMatch(/^ {8,}add_header/m);
    // Owner pointers (PR4-SEC-06): headers/CSP TASK-022, image TASK-014, header/response suite TASK-111.
    expect(template).toMatch(/TASK-022/);
    expect(template).toMatch(/Dockerfile is TASK-014/);
    expect(template).toMatch(/test suite is TASK-111/);
  });

  it.each([
    ['web', web],
    ['admin', admin],
  ])('%s: dynamic gzip for text assets next to the pre-built *.gz files (NFR-WEB-005)', (_app, template) => {
    // At server level (4-space indent), where every location inherits it.
    expect(template).toMatch(/^ {4}gzip_static on;$/m);
    expect(template).toMatch(/^ {4}gzip on;$/m);
    expect(template).toMatch(/^ {4}gzip_vary on;$/m);
    const types = /^ {4}gzip_types (.+);$/m.exec(template)?.[1]?.split(' ') ?? [];
    expect(types).toEqual(
      expect.arrayContaining(['text/css', 'application/javascript', 'text/javascript', 'application/json', 'image/svg+xml', 'text/plain']),
    );
  });

  it('web: / redirects (302) to the DR-A18 locale and every other path falls back to index.html', () => {
    expect(web).toMatch(/location = \/ \{\s+return 302 \/\$web_lng\/;/);
    expect(web).toMatch(/"302:\/"\s+"no-store";/);
    expect(web).toMatch(/"\/"\s+"Cookie, Accept-Language";/);
    expect(web).toMatch(/map \$cookie_lng \$web_lng \{\s+default\s+\$web_accept_language;\s+en\s+en;\s+es\s+es;\s+fr\s+fr;/);
    expect(web).toContain('try_files $uri $uri/index.html /index.html;');
  });

  it.each([
    ['', 'en'],
    ['es', 'es'],
    ['FR-ca', 'fr'],
    ['de-DE,es-MX;q=0.8,fr;q=0.5', 'es'],
    ['fr;q=0.9, en', 'fr'],
    ['de, espanol', 'en'],
    ['de-CH, it', 'en'],
    ['eses, fr', 'fr'],
  ])('web: Accept-Language %j selects %s', (header, locale) => {
    expect(acceptLanguageLocale(header)).toBe(locale);
  });

  it('admin: SPA fallback for every route, never indexed', () => {
    expect(admin).toContain('try_files $uri /index.html;');
    expect(admin).toContain('add_header X-Robots-Tag "noindex, nofollow" always;');
    expect(admin).toContain('return 200 "User-agent: *\\nDisallow: /\\n";');
    expect(admin).not.toContain('return 302');
  });
});

import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { renderToReadableStream } from 'react-dom/server';

/**
 * Committed server entry (ADR-0026 am. 10, SPK-01 F-SEC-1, PR1-SEC-03). Without this file `@react-router/dev` adds
 * `isbot` to package.json and runs `npm install` during `react-router build`/`typegen`. With `ssr: false` this
 * module runs only at build time, to render the SPA fallback `index.html`, so there are no requests to classify and
 * bot detection is deliberately absent. Every render waits for all content (static generation).
 */
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      responseStatusCode = 500;
      console.error(error);
    },
  });
  await body.allReady;

  responseHeaders.set('Content-Type', 'text/html');
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}

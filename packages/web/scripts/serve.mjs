#!/usr/bin/env node
/**
 * Static preview server for the built inbox.
 *
 * Binds to loopback by default. The node's own API is expected to be elsewhere
 * and is selected in the page (`?api=…`), so this server never proxies and
 * never has to be trusted with anything: it only reads files from dist/.
 *
 * Usage: node scripts/serve.mjs [--port 4173] [--host 127.0.0.1]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(join(here, '..', 'dist'));

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(flag('port', '4173'));
const host = flag('host', '127.0.0.1');

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

/** Resolve a request path inside dist/, refusing anything that escapes it. */
function resolveTarget(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = resolve(join(dist, normalize(decoded)));
  if (candidate !== dist && !candidate.startsWith(dist + sep)) return null;
  return candidate;
}

const server = createServer(async (request, response) => {
  const target = resolveTarget(request.url ?? '/');
  if (target === null) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': TYPES.get(extname(filePath)) ?? 'application/octet-stream',
      // The preview is a build artifact; never let a stale copy linger.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Linko inbox preview: http://${host}:${port}/`);
  console.log(`Point it at a node with    http://${host}:${port}/?api=http://127.0.0.1:8477`);
  console.log('Serving', dist);
});

// Local dev server: serves public/ and dispatches /api/* to the same three
// catch-all handlers production uses.
//
//   TURSO_DATABASE_URL=file:local.db node scripts/devserver.js
//
// Why this exists alongside `vercel dev`: `vercel dev` requires an interactive
// Vercel login, which blocks a fresh clone (and any agent or CI runner) from
// bringing the app up at all. This needs no account and boots in a second.
//
// What it does NOT do, so don't treat a green run here as equivalent:
//   - It reimplements vercel.json's rewrites below. Change vercel.json and you
//     must change them here too; this file will not pick it up.
//   - It does not enforce the three-serverless-function limit. Only a real
//     `vercel build` does, which is what smoke.js test 20 asserts.
// Use `vercel dev` before deploying anything routing-related.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import publicHandler from '../api/public/[...route].js';
import adminHandler from '../api/admin/[...route].js';
import ownerHandler from '../api/owner/[...route].js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const HANDLERS = {
  '/api/public': publicHandler,
  '/api/admin': adminHandler,
  '/api/owner': ownerHandler,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

// The res helpers every route module assumes Vercel provides.
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => { res.end(body); return res; };
  return res;
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return ok(undefined);
      try { ok(JSON.parse(raw)); } catch { ok(raw); }
    });
    req.on('error', fail);
  });
}

async function serveStatic(res, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
    // Never cache in dev — an edited stylesheet must show up on reload.
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(filePath));
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  decorate(res);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Vercel populates req.query from the URL.
  req.query = Object.fromEntries(url.searchParams.entries());

  const prefix = Object.keys(HANDLERS).find((p) => path === p || path.startsWith(p + '/'));
  if (prefix) {
    try {
      req.body = await readBody(req);
      // Production sees a real client IP; the rate limiter keys off it.
      req.headers['x-forwarded-for'] = req.headers['x-forwarded-for'] || '127.0.0.1';
      await HANDLERS[prefix](req, res);
    } catch (err) {
      console.error(`[api] ${req.method} ${path}`, err);
      if (!res.headersSent) res.status(500).json({ error: 'server_error', detail: String(err) });
    }
    if (!res.writableEnded) res.end();
    return;
  }

  // Real files win before the rewrite below, so /b/page.js is served as the
  // script it is rather than being swallowed by the /b/:slug rule.
  for (const candidate of [join(PUBLIC, path), join(PUBLIC, path, 'index.html'), join(PUBLIC, `${path}.html`)]) {
    if (!resolve(candidate).startsWith(PUBLIC)) continue;
    if (await serveStatic(res, candidate)) return;
  }

  // vercel.json rewrite: /b/:slug -> /b/index.html
  if (/^\/b\/[^/]+\/?$/.test(path) && await serveStatic(res, join(PUBLIC, 'b/index.html'))) return;

  res.status(404).send('Not found');
});

server.listen(PORT, () => {
  console.log(`dev server on http://localhost:${PORT}`);
  if (!process.env.TURSO_DATABASE_URL) {
    console.warn('warning: TURSO_DATABASE_URL is unset — expected file:local.db for local dev');
  }
});

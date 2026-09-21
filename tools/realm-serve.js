#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const portArg = process.argv.indexOf('--port');
const port = Number(portArg >= 0 ? process.argv[portArg + 1] : process.env.PORT || 58150);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.bin': 'application/octet-stream'
};

function safePath(url) {
  const clean = decodeURIComponent((url || '/').split('?')[0].split('#')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  let full = safePath(req.url);
  if (!full) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  try {
    const stat = fs.existsSync(full) ? fs.statSync(full) : null;
    if (stat && stat.isDirectory()) full = path.join(full, 'index.html');
    if (!fs.existsSync(full)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': types[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err && err.message || err));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('serving http://localhost:' + port + '/local/realm/');
});

function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

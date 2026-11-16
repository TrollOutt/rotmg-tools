'use strict';
// The review server (tools/review-server.js) serves only the site and the review page,
// and accepts a write only from its own page. Nothing here writes a verdict.
const assert = require('assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { createServer, staticFile } = require('../tools/review-server.js');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

function request(port, method, rawPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath, headers }, res => {
      const parts = [];
      res.on('data', chunk => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function testStaticFile() {
  const page = path.join(ROOT, 'tools', 'review');
  assert.strictEqual(staticFile('/review/'), path.join(page, 'index.html'));
  assert.strictEqual(staticFile('/review'), path.join(page, 'index.html'));
  assert.strictEqual(staticFile('/review/review.js'), path.join(page, 'review.js'));
  assert.strictEqual(staticFile('/web/index.html'), path.join(ROOT, 'web', 'index.html'));
  assert.strictEqual(staticFile('/review/../validation-review.json'), null);
  assert.strictEqual(staticFile('/review/%2e%2e/validation-review.json'), null);
  assert.strictEqual(staticFile('/web/../tools/validation-review.json'), null);
  assert.strictEqual(staticFile('/web/%2e%2e/tools/validation-review.json'), null);
  assert.strictEqual(staticFile('/web/..%2ftools/validation-review.json'), null);
  assert.strictEqual(staticFile('/local/validation/report.json'), null);
  assert.strictEqual(staticFile('/tools/validation-review.json'), null);
  assert.strictEqual(staticFile('/.git/config'), null);
  assert.strictEqual(staticFile('/data/.hidden/x.json'), null);
  assert.strictEqual(staticFile('/data/Index/.secret'), null);
  assert.strictEqual(staticFile('/web/%'), null);                 // a bad escape is refused, not thrown
  assert.strictEqual(staticFile('/'), null);
}

async function testServer() {
  const port = await freePort();
  const server = createServer({ port });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const own = 'http://127.0.0.1:' + port;
  const json = { 'Content-Type': 'application/json' };
  try {
    let res = await request(port, 'GET', '/review/');
    assert.strictEqual(res.status, 200);
    assert.match(res.type, /^text\/html/);
    res = await request(port, 'GET', '/review/review.js');
    assert.strictEqual(res.status, 200);
    assert.match(res.type, /^text\/javascript/);
    res = await request(port, 'GET', '/web/index.html');
    assert.strictEqual(res.status, 200);
    res = await request(port, 'GET', '/');
    assert.strictEqual(res.status, 302);

    for (const refused of ['/web/../tools/validation-review.json', '/web/%2e%2e/tools/validation-review.json',
      '/review/../validation-review.json', '/local/validation/report.json', '/tools/validation-review.json',
      '/.git/config', '/data/.hidden/x.json', '/data/Index/.secret', '/web/nothing-here.html']) {
      res = await request(port, 'GET', refused);
      assert.strictEqual(res.status, 404, 'GET ' + refused + ' -> ' + res.status);
    }

    res = await request(port, 'POST', '/review/api/verdict', { ...json, Origin: 'http://evil.example' }, '{}');
    assert.strictEqual(res.status, 403);
    res = await request(port, 'POST', '/review/api/verdict', { 'Content-Type': 'text/plain', Origin: own }, '{}');
    assert.strictEqual(res.status, 403);
    res = await request(port, 'POST', '/review/api/verdict', { Origin: own }, '{}');
    assert.strictEqual(res.status, 403);
    res = await request(port, 'POST', '/review/api/rerun', { ...json, Origin: 'http://localhost:1' }, '{}');
    assert.strictEqual(res.status, 403);
    res = await request(port, 'GET', '/review/api/nothing');
    assert.strictEqual(res.status, 405);
    res = await request(port, 'GET', '/review/api/verdict');
    assert.strictEqual(res.status, 405);
    res = await request(port, 'PUT', '/web/index.html', json, '{}');
    assert.strictEqual(res.status, 405);
    res = await request(port, 'DELETE', '/review/');
    assert.strictEqual(res.status, 405);
    res = await request(port, 'POST', '/review/api/unknown', { ...json, Origin: own }, '{}');
    assert.strictEqual(res.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  testStaticFile();
  await testServer();
  console.log('review-server.test.js: ok');
})().catch(error => { console.error(error); process.exit(1); });

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createVoiceServer } = require('../src/server');
const { createMiniMaxAdapter } = require('../src/adapters/minimax');

const PLAYER_DIR = path.join(__dirname, '..', 'public', 'player');

function request(baseUrl, requestPath, method = 'GET') {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: requestPath,
      method
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function startServer() {
  const calls = { provider: 0 };
  const adapter = createMiniMaxAdapter({
    apiKey: 'test-api-key',
    groupId: 'test-group-id',
    voiceId: 'test-voice-id',
    model: 'test-model',
    fetchImpl: async () => {
      calls.provider += 1;
      throw new Error('provider must not be called by static routes');
    }
  });
  const server = createVoiceServer({ adapter });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    calls
  };
}

async function stopServer(server) {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
}

function expectedFile(name) {
  return fs.readFileSync(path.join(PLAYER_DIR, name));
}

test('GET /player/preview.html serves the locked preview with HTML MIME', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/preview.html');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(response.body, expectedFile('preview.html'));
  } finally {
    await stopServer(server);
  }
});

test('GET /player/cat-ear-player.js serves the locked component with JavaScript MIME', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/cat-ear-player.js');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.deepEqual(response.body, expectedFile('cat-ear-player.js'));
  } finally {
    await stopServer(server);
  }
});

test('GET /player/visual-master.svg serves the locked visual with SVG MIME', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/visual-master.svg');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'image/svg+xml; charset=utf-8');
    assert.deepEqual(response.body, expectedFile('visual-master.svg'));
  } finally {
    await stopServer(server);
  }
});

test('unknown player files are not served', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/README.md');
    assert.equal(response.status, 404);
    assert.equal(response.body.toString('utf8'), JSON.stringify({
      error: { code: 'NOT_FOUND', message: 'Route was not found.' }
    }));
  } finally {
    await stopServer(server);
  }
});

test('path traversal is rejected', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/%2e%2e%2fserver.js');
    assert.equal(response.status, 404);
    assert.equal(JSON.parse(response.body.toString('utf8')).error.code, 'NOT_FOUND');
  } finally {
    await stopServer(server);
  }
});

test('directory listing is rejected', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/');
    assert.equal(response.status, 404);
    assert.equal(JSON.parse(response.body.toString('utf8')).error.code, 'NOT_FOUND');
  } finally {
    await stopServer(server);
  }
});

test('non-GET player requests are rejected', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/preview.html', 'POST');
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET');
    assert.equal(JSON.parse(response.body.toString('utf8')).error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    await stopServer(server);
  }
});

test('GET /player/smoke.html serves the one-click smoke page with HTML MIME', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await request(baseUrl, '/player/smoke.html');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.deepEqual(response.body, expectedFile('smoke.html'));
  } finally {
    await stopServer(server);
  }
});

test('sensitive project paths are not served', async () => {
  const { server, baseUrl } = await startServer();
  try {
    for (const requestPath of ['/.env', '/src/server.js']) {
      const response = await request(baseUrl, requestPath);
      assert.equal(response.status, 404, requestPath);
      assert.equal(JSON.parse(response.body.toString('utf8')).error.code, 'NOT_FOUND');
    }
  } finally {
    await stopServer(server);
  }
});

test('GET /api/tts is rejected without calling the provider', async () => {
  const { server, baseUrl, calls } = await startServer();
  try {
    const response = await request(baseUrl, '/api/tts', 'GET');
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'POST');
    assert.equal(JSON.parse(response.body.toString('utf8')).error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(calls.provider, 0);
  } finally {
    await stopServer(server);
  }
});

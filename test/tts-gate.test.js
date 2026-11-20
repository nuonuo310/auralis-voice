'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  DEFAULT_MAX_CONCURRENT_TTS,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_WINDOW_MS,
  TtsGateError,
  createTtsGate
} = require('../src/tts-gate');
const { loadConfig, isLoopbackHost } = require('../src/config');
const { createConfiguredServer, createVoiceServer } = require('../src/server');
const { AdapterError } = require('../src/adapters/minimax');
const { createBreezeAdapter } = require('../src/adapters/breeze');

const TOKEN = 't'.repeat(32);
const WRONG_TOKEN = 'w'.repeat(32);
const BASE_ENV = Object.freeze({
  MINIMAX_API_KEY: 'test-api-key',
  MINIMAX_GROUP_ID: 'test-group-id',
  MINIMAX_VOICE_ID: 'test-voice-id',
  MINIMAX_MODEL: 'test-model'
});

function request(baseUrl, requestPath, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: requestPath,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function postTts(baseUrl, { token, authorization, duplicate = false, text = 'hello' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (duplicate) {
    headers.Authorization = [`Bearer ${token}`, `Bearer ${token}`];
  } else if (authorization !== undefined) {
    headers.Authorization = authorization;
  } else if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  return request(baseUrl, '/api/tts', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text })
  });
}

function jsonError(response) {
  return JSON.parse(response.body.toString('utf8')).error;
}

async function startServer({ accessToken = null, gate = null, synthesize } = {}) {
  let providerCalls = 0;
  const adapter = {
    provider: 'test',
    async synthesize(text) {
      providerCalls += 1;
      if (synthesize) {
        return synthesize(text, providerCalls);
      }
      return { audio: Buffer.from('ID3'), mimeType: 'audio/mpeg' };
    }
  };
  const server = createVoiceServer({ adapter, accessToken, gate });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    providerCalls: () => providerCalls
  };
}

async function stopServer(server) {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
}

test('loopback hosts allow an omitted access token for local development', () => {
  for (const host of [undefined, '', '   ', '127.0.0.1', '127.42.0.1', 'localhost', '::1', '::ffff:127.0.0.1']) {
    const env = { ...BASE_ENV };
    if (host !== undefined) {
      env.HOST = host;
    }
    const config = loadConfig(env);
    assert.equal(config.accessToken, null);
    assert.equal(isLoopbackHost(config.host), true, String(host));
  }
});

test('non-loopback startup fails closed for missing, blank, or short tokens', () => {
  for (const value of [undefined, '', '   ', 'short-token']) {
    const env = { ...BASE_ENV, HOST: '0.0.0.0' };
    if (value !== undefined) {
      env.PUBLIC_V1_ACCESS_TOKEN = value;
    }
    assert.throws(
      () => createConfiguredServer({ env, fetchImpl: async () => { throw new Error('unused'); } }),
      (error) => error.code === 'CONFIG_INVALID' && !error.message.includes('short-token')
    );
  }
});

test('non-loopback startup accepts a trimmed 32-character token', () => {
  const config = loadConfig({
    ...BASE_ENV,
    HOST: '0.0.0.0',
    PUBLIC_V1_ACCESS_TOKEN: `  ${TOKEN}  `
  });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.accessToken, TOKEN);
});

test('configured tokens reject internal whitespace without exposing the value', () => {
  const invalid = [
    `${'a'.repeat(16)} ${'b'.repeat(16)}`,
    `${'a'.repeat(16)}\t${'b'.repeat(16)}`,
    `${'a'.repeat(16)}\r${'b'.repeat(16)}`,
    `${'a'.repeat(16)}\n${'b'.repeat(16)}`
  ];
  for (const host of ['0.0.0.0', '127.0.0.1']) {
    for (const token of invalid) {
      assert.throws(
        () => loadConfig({ ...BASE_ENV, HOST: host, PUBLIC_V1_ACCESS_TOKEN: token }),
        (error) => error.code === 'CONFIG_INVALID' && !error.message.includes(token)
      );
    }
  }
});

test('configured authentication rejects missing, malformed, duplicate, and wrong headers', async () => {
  const { server, baseUrl, providerCalls } = await startServer({ accessToken: TOKEN });
  try {
    const responses = [
      await postTts(baseUrl),
      await postTts(baseUrl, { authorization: 'Basic value' }),
      await postTts(baseUrl, { token: TOKEN, duplicate: true }),
      await postTts(baseUrl, { token: WRONG_TOKEN })
    ];
    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.equal(jsonError(response).code, 'UNAUTHORIZED');
      assert.equal(response.body.toString('utf8').includes(TOKEN), false);
    }
    assert.equal(providerCalls(), 0);
  } finally {
    await stopServer(server);
  }
});

test('a correct bearer token reaches the provider exactly once', async () => {
  const { server, baseUrl, providerCalls } = await startServer({ accessToken: TOKEN });
  try {
    const response = await postTts(baseUrl, { token: TOKEN });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'audio/mpeg');
    assert.deepEqual(response.body, Buffer.from('ID3'));
    assert.equal(providerCalls(), 1);
  } finally {
    await stopServer(server);
  }
});

test('GET /api/tts remains 405 before authentication and never calls the provider', async () => {
  const { server, baseUrl, providerCalls } = await startServer({ accessToken: TOKEN });
  try {
    const response = await request(baseUrl, '/api/tts');
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'POST');
    assert.equal(jsonError(response).code, 'METHOD_NOT_ALLOWED');
    assert.equal(providerCalls(), 0);
  } finally {
    await stopServer(server);
  }
});

test('loopback without a configured token preserves the existing POST behavior', async () => {
  const { server, baseUrl, providerCalls } = await startServer();
  try {
    const response = await postTts(baseUrl);
    assert.equal(response.status, 200);
    assert.equal(providerCalls(), 1);
  } finally {
    await stopServer(server);
  }
});

test('the seventh request in a fixed window is rate limited without a provider call', async () => {
  const gate = createTtsGate({ accessToken: TOKEN, now: () => 1_000 });
  const { server, baseUrl, providerCalls } = await startServer({ gate });
  try {
    for (let index = 0; index < 6; index += 1) {
      const response = await postTts(baseUrl, { token: TOKEN });
      assert.equal(response.status, 200);
    }
    const rejected = await postTts(baseUrl, { token: TOKEN });
    assert.equal(rejected.status, 429);
    assert.equal(jsonError(rejected).code, 'RATE_LIMITED');
    assert.equal(providerCalls(), 6);
  } finally {
    await stopServer(server);
  }
});

test('a second concurrent synthesis is rejected as TTS_BUSY', async () => {
  let markStarted;
  let releaseProvider;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const released = new Promise((resolve) => { releaseProvider = resolve; });
  const gate = createTtsGate({ accessToken: TOKEN, now: () => 1_000 });
  const { server, baseUrl, providerCalls } = await startServer({
    gate,
    synthesize: async () => {
      markStarted();
      await released;
      return { audio: Buffer.from('ID3'), mimeType: 'audio/mpeg' };
    }
  });
  try {
    const firstRequest = postTts(baseUrl, { token: TOKEN });
    await started;
    const second = await postTts(baseUrl, { token: TOKEN });
    assert.equal(second.status, 429);
    assert.equal(jsonError(second).code, 'TTS_BUSY');
    assert.equal(providerCalls(), 1);
    releaseProvider();
    assert.equal((await firstRequest).status, 200);
  } finally {
    releaseProvider();
    await stopServer(server);
  }
});

test('provider failure releases concurrency while retaining the rate-limit record', async () => {
  let shouldFail = true;
  const gate = createTtsGate({ accessToken: TOKEN, now: () => 1_000 });
  const { server, baseUrl, providerCalls } = await startServer({
    gate,
    synthesize: async () => {
      if (shouldFail) {
        throw new AdapterError('PROVIDER_NETWORK_ERROR', 'mock failure');
      }
      return { audio: Buffer.from('ID3'), mimeType: 'audio/mpeg' };
    }
  });
  try {
    const failed = await postTts(baseUrl, { token: TOKEN });
    assert.equal(failed.status, 502);
    shouldFail = false;
    const recovered = await postTts(baseUrl, { token: TOKEN });
    assert.equal(recovered.status, 200);
    assert.equal(providerCalls(), 2);
  } finally {
    await stopServer(server);
  }
});

test('a forged ordinary error code cannot select a controlled 429 response', async () => {
  const forged = Object.assign(new Error('forged'), { code: 'RATE_LIMITED' });
  const { server, baseUrl, providerCalls } = await startServer({
    accessToken: TOKEN,
    synthesize: async () => { throw forged; }
  });
  try {
    const response = await postTts(baseUrl, { token: TOKEN });
    assert.equal(response.status, 500);
    assert.equal(jsonError(response).code, 'INTERNAL_ERROR');
    assert.equal(providerCalls(), 1);
  } finally {
    await stopServer(server);
  }
});

test('the existing Breeze placeholder error remains a controlled 501 response', async () => {
  const server = createVoiceServer({ adapter: createBreezeAdapter() });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await postTts(baseUrl);
    assert.equal(response.status, 501);
    assert.equal(jsonError(response).code, 'ADAPTER_NOT_IMPLEMENTED');
  } finally {
    await stopServer(server);
  }
});

test('an unknown TtsGateError code is converted to a generic internal error', async () => {
  const gate = {
    isAuthorized: () => true,
    run: async () => { throw new TtsGateError('UNAUTHORIZED'); }
  };
  const { server, baseUrl, providerCalls } = await startServer({ gate });
  try {
    const response = await postTts(baseUrl);
    assert.equal(response.status, 500);
    assert.equal(jsonError(response).code, 'INTERNAL_ERROR');
    assert.equal(providerCalls(), 0);
  } finally {
    await stopServer(server);
  }
});

test('errors, health responses, and static files never expose the access token', async () => {
  const { server, baseUrl, providerCalls } = await startServer({
    accessToken: TOKEN,
    synthesize: async () => {
      throw new AdapterError('PROVIDER_NETWORK_ERROR', `mock failure ${TOKEN}`);
    }
  });
  try {
    const failed = await postTts(baseUrl, { token: TOKEN });
    const health = await request(baseUrl, '/health');
    const preview = await request(baseUrl, '/player/preview.html');
    for (const response of [failed, health, preview]) {
      assert.equal(response.body.toString('utf8').includes(TOKEN), false);
      assert.equal(JSON.stringify(response.headers).includes(TOKEN), false);
    }
    assert.equal(failed.status, 502);
    assert.equal(health.status, 200);
    assert.equal(preview.status, 200);
    assert.equal(providerCalls(), 1);
  } finally {
    await stopServer(server);
  }
});

test('gate production defaults are fixed at six requests, sixty seconds, and one concurrent task', async () => {
  assert.equal(DEFAULT_MAX_REQUESTS, 6);
  assert.equal(DEFAULT_WINDOW_MS, 60_000);
  assert.equal(DEFAULT_MAX_CONCURRENT_TTS, 1);

  const clock = { now: 0 };
  const gate = createTtsGate({
    accessToken: TOKEN,
    maxRequests: 1,
    windowMs: 1_000,
    now: () => clock.now
  });
  await gate.run(async () => 'first');
  await assert.rejects(() => gate.run(async () => 'blocked'), (error) => error.code === 'RATE_LIMITED');
  clock.now = 1_001;
  assert.equal(await gate.run(async () => 'after-window'), 'after-window');
});

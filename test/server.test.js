'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createConfiguredServer, resolveListenHost } = require('../src/server');
const { loadConfig, REQUIRED_KEYS } = require('../src/config');

const VALID_ENV = {
  MINIMAX_API_KEY: 'test-api-key',
  MINIMAX_GROUP_ID: 'test-group-id',
  MINIMAX_VOICE_ID: 'test-voice-id',
  MINIMAX_MODEL: 'test-model'
};

function successResponse(audio = '494433') {
  return new Response(JSON.stringify({
    base_resp: { status_code: 0 },
    data: { audio }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function startServer(fetchImpl, env = VALID_ENV) {
  const server = createConfiguredServer({ env, fetchImpl });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(server) {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
}

async function postTts(baseUrl, body, headers = { 'Content-Type': 'application/json' }) {
  return fetch(`${baseUrl}/api/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function assertErrorResponse(response, status, code) {
  assert.equal(response.status, status);
  const payload = await response.json();
  assert.equal(payload.error.code, code);
  assert.equal(typeof payload.error.message, 'string');
  return payload;
}

test('POST /api/tts returns MP3 audio and calls the provider exactly once', async () => {
  let callCount = 0;
  let providerPayload;
  const { server, baseUrl } = await startServer(async (url, init) => {
    callCount += 1;
    providerPayload = JSON.parse(init.body);
    return successResponse('494433');
  });

  try {
    const response = await postTts(baseUrl, { text: ' 你好 ' });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from('ID3'));
    assert.equal(callCount, 1);
    assert.equal(providerPayload.text, '你好');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/tts rejects invalid text and unknown fields before calling the provider', async (t) => {
  let callCount = 0;
  const { server, baseUrl } = await startServer(async () => {
    callCount += 1;
    return successResponse();
  });

  try {
    const invalidTextCases = [
      ['empty text', { text: '' }],
      ['whitespace-only text', { text: '   ' }],
      ['overlong text', { text: 'a'.repeat(1001) }],
      ['non-string text', { text: 123 }],
      ['missing text', {}]
    ];

    for (const [name, body] of invalidTextCases) {
      await t.test(name, async () => {
        const response = await postTts(baseUrl, body);
        await assertErrorResponse(response, 400, 'INVALID_TEXT');
      });
    }

    const unknownFieldCases = [
      ['voice_id', { text: 'hello', voice_id: 'client-voice' }],
      ['model', { text: 'hello', model: 'client-model' }],
      ['GroupId', { text: 'hello', GroupId: 'client-group' }],
      ['api_key', { text: 'hello', api_key: 'client-secret' }],
      ['endpoint', { text: 'hello', endpoint: 'https://example.invalid' }],
      ['other field', { text: 'hello', extra: true }]
    ];

    for (const [name, body] of unknownFieldCases) {
      await t.test(name, async () => {
        const response = await postTts(baseUrl, body);
        await assertErrorResponse(response, 400, 'UNKNOWN_FIELD');
      });
    }

    assert.equal(callCount, 0);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/tts requires JSON content type', async () => {
  let callCount = 0;
  const { server, baseUrl } = await startServer(async () => {
    callCount += 1;
    return successResponse();
  });

  try {
    const response = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ text: 'hello' })
    });
    await assertErrorResponse(response, 415, 'INVALID_CONTENT_TYPE');
    assert.equal(callCount, 0);
  } finally {
    await stopServer(server);
  }
});

test('GroupId is optional and blank values select new-platform mode', async (t) => {
  const cases = [
    ['missing', (env) => {
      const copy = { ...env };
      delete copy.MINIMAX_GROUP_ID;
      return copy;
    }],
    ['empty', (env) => ({ ...env, MINIMAX_GROUP_ID: '' })],
    ['whitespace', (env) => ({ ...env, MINIMAX_GROUP_ID: '   ' })]
  ];

  for (const [name, buildEnv] of cases) {
    await t.test(name, () => {
      const config = loadConfig(buildEnv(VALID_ENV));
      assert.equal(config.groupId, null);
      assert.equal(config.apiKey, VALID_ENV.MINIMAX_API_KEY);
      assert.equal(config.voiceId, VALID_ENV.MINIMAX_VOICE_ID);
      assert.equal(config.model, VALID_ENV.MINIMAX_MODEL);
    });
  }
});

test('startup fails when any one of the three required configurations is missing', () => {
  const secrets = ['test-api-key', 'test-group-id', 'test-voice-id', 'test-model'];
  const fetchImpl = async () => successResponse();

  for (const key of REQUIRED_KEYS) {
    const env = { ...VALID_ENV };
    delete env[key];
    assert.throws(
      () => createConfiguredServer({ env, fetchImpl }),
      (error) => {
        assert.equal(error.code, 'CONFIG_INVALID');
        assert.match(error.message, new RegExp(key));
        for (const secret of secrets) {
          assert.equal(error.message.includes(secret), false);
        }
        return true;
      }
    );
  }
});

test('provider errors and logs do not expose API key or GroupId', async () => {
  const fakeKey = VALID_ENV.MINIMAX_API_KEY;
  const fakeGroupId = VALID_ENV.MINIMAX_GROUP_ID;
  const capturedLogs = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args) => capturedLogs.push(args.join(' '));
  console.error = (...args) => capturedLogs.push(args.join(' '));
  console.warn = (...args) => capturedLogs.push(args.join(' '));

  let providerCalls = 0;
  try {
    const { server, baseUrl } = await startServer(async () => {
      providerCalls += 1;
      throw new Error(`mock provider failure ${fakeKey} ${fakeGroupId}`);
    });

    try {
      const response = await postTts(baseUrl, { text: 'hello' });
      const responseText = await response.text();
      assert.equal(response.status, 502);
      assert.equal(responseText.includes(fakeKey), false);
      assert.equal(responseText.includes(fakeGroupId), false);
      assert.equal(capturedLogs.some((line) => line.includes(fakeKey) || line.includes(fakeGroupId)), false);
      assert.equal(providerCalls, 1);
    } finally {
      await stopServer(server);
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
});
test('GET /health exposes only status and provider', async () => {
  const { server, baseUrl } = await startServer(async () => {
    throw new Error('provider must not be called');
  });

  try {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { status: 'ok', provider: 'minimax' });
    assert.doesNotMatch(text, /test-api-key|test-group-id|test-voice-id|test-model/);
  } finally {
    await stopServer(server);
  }
});

test('Breeze is not loaded by the server runtime path', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.doesNotMatch(serverSource, /adapters[\\/]breeze/);
});

test('resolveListenHost defaults to loopback and preserves explicit hosts', () => {
  assert.equal(resolveListenHost({}), '127.0.0.1');
  assert.equal(resolveListenHost({ HOST: '' }), '127.0.0.1');
  assert.equal(resolveListenHost({ HOST: '   ' }), '127.0.0.1');
  assert.equal(resolveListenHost({ HOST: '127.0.0.1' }), '127.0.0.1');
  assert.equal(resolveListenHost({ HOST: '0.0.0.0' }), '0.0.0.0');
});

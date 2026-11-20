'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { loadConfig, ConfigError } = require('../src/config');
const { CALLBACK_URL, OAUTH_SCOPE } = require('../src/oauth');
const { createVoiceServer } = require('../src/server');
const { makePcmWav } = require('../test-support/wav');

const ORIGIN = 'https://auralis.example.com';
const CLIENT_ID = 'auralis-chatgpt-desktop';
const CLIENT_SECRET = 's'.repeat(48);

function validEnv(extra = {}) {
  return {
    MINIMAX_API_KEY: 'api-key',
    MINIMAX_VOICE_ID: 'voice-id',
    MINIMAX_MODEL: 'model',
    ...extra
  };
}

async function startServer() {
  const calls = { provider: 0 };
  const adapter = {
    async synthesize() {
      calls.provider += 1;
      return { audio: makePcmWav(), mimeType: 'audio/wav', durationSeconds: 0.25 };
    }
  };
  const server = createVoiceServer({
    adapter,
    oauthConfig: { origin: ORIGIN, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, calls, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
  server.close();
  await once(server, 'close');
}

async function authorize(baseUrl) {
  const verifier = 'v'.repeat(64);
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const authorizeUrl = new URL('/oauth/authorize', baseUrl);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', CALLBACK_URL);
  authorizeUrl.searchParams.set('scope', OAUTH_SCOPE);
  authorizeUrl.searchParams.set('resource', `${ORIGIN}/mcp`);
  authorizeUrl.searchParams.set('state', 'state-123');
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  const authorization = await fetch(authorizeUrl, { redirect: 'manual' });
  assert.equal(authorization.status, 302);
  const location = new URL(authorization.headers.get('location'));
  assert.equal(location.origin + location.pathname, CALLBACK_URL);
  assert.equal(location.searchParams.get('state'), 'state-123');
  const code = location.searchParams.get('code');
  assert.ok(code);

  const token = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CALLBACK_URL,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: verifier
    })
  });
  assert.equal(token.status, 200);
  return token.json();
}

test('OAuth MCP config is all-or-none and keeps existing local config compatible', () => {
  assert.equal(loadConfig(validEnv()).oauth, null);
  assert.throws(
    () => loadConfig(validEnv({ AURALIS_PUBLIC_ORIGIN: ORIGIN })),
    (error) => error instanceof ConfigError && /AURALIS_OAUTH_CLIENT_ID/.test(error.message)
  );
  assert.throws(
    () => loadConfig(validEnv({
      AURALIS_PUBLIC_ORIGIN: `${ORIGIN}/path`,
      AURALIS_OAUTH_CLIENT_ID: CLIENT_ID,
      AURALIS_OAUTH_CLIENT_SECRET: CLIENT_SECRET
    })),
    (error) => error instanceof ConfigError && /exact HTTPS origin/.test(error.message)
  );
  const config = loadConfig(validEnv({
    AURALIS_PUBLIC_ORIGIN: ORIGIN,
    AURALIS_OAUTH_CLIENT_ID: CLIENT_ID,
    AURALIS_OAUTH_CLIENT_SECRET: CLIENT_SECRET
  }));
  assert.deepEqual(config.oauth, {
    origin: ORIGIN,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: CALLBACK_URL
  });
  const connectorRedirect = 'https://chatgpt.com/connector/oauth/SK8T0Ua2Ei2y';
  assert.equal(loadConfig(validEnv({
    AURALIS_PUBLIC_ORIGIN: ORIGIN,
    AURALIS_OAUTH_CLIENT_ID: CLIENT_ID,
    AURALIS_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    AURALIS_OAUTH_REDIRECT_URI: connectorRedirect
  })).oauth.redirectUri, connectorRedirect);
  assert.throws(
    () => loadConfig(validEnv({
      AURALIS_PUBLIC_ORIGIN: ORIGIN,
      AURALIS_OAUTH_CLIENT_ID: CLIENT_ID,
      AURALIS_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
      AURALIS_OAUTH_REDIRECT_URI: 'https://example.com/callback'
    })),
    (error) => error instanceof ConfigError && /exact ChatGPT OAuth redirect URI/.test(error.message)
  );
});

test('OAuth discovery and unauthenticated MCP challenge expose no secret and call no provider', async () => {
  const { server, baseUrl, calls } = await startServer();
  try {
    const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), {
      resource: `${ORIGIN}/mcp`,
      authorization_servers: [ORIGIN],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ['header']
    });
    const authorization = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    assert.equal(authorization.status, 200);
    const discovered = await authorization.json();
    assert.equal(discovered.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
    assert.equal(discovered.token_endpoint, `${ORIGIN}/oauth/token`);
    assert.deepEqual(discovered.code_challenge_methods_supported, ['S256']);
    assert.ok(!JSON.stringify(discovered).includes(CLIENT_SECRET));

    const mcp = await fetch(`${baseUrl}/mcp`);
    assert.equal(mcp.status, 401);
    assert.match(mcp.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
    assert.equal(calls.provider, 0);
  } finally {
    await stopServer(server);
  }
});

test('authorization code with PKCE issues and rotates bounded bearer tokens', async () => {
  const { server, baseUrl, calls } = await startServer();
  try {
    const first = await authorize(baseUrl);
    assert.equal(first.token_type, 'Bearer');
    assert.equal(first.scope, OAUTH_SCOPE);
    assert.ok(first.access_token);
    assert.ok(first.refresh_token);
    assert.ok(!JSON.stringify(first).includes(CLIENT_SECRET));

    const accepted = await fetch(`${baseUrl}/mcp`, {
      headers: { Authorization: `Bearer ${first.access_token}` }
    });
    assert.notEqual(accepted.status, 401);

    const refresh = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      })
    });
    assert.equal(refresh.status, 200);
    const second = await refresh.json();
    assert.notEqual(second.access_token, first.access_token);
    assert.notEqual(second.refresh_token, first.refresh_token);

    const replay = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      })
    });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, 'invalid_grant');
    assert.equal(calls.provider, 0);
  } finally {
    await stopServer(server);
  }
});

test('authorized MCP initializes, lists the single voice tool, and does not synthesize during discovery', async () => {
  const { server, baseUrl, calls } = await startServer();
  try {
    const tokens = await authorize(baseUrl);
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18'
    };
    const initialize = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'offline-test', version: '1.0.0' }
        }
      })
    });
    assert.equal(initialize.status, 200);
    const initialized = await initialize.json();
    assert.equal(initialized.result.serverInfo.name, 'auralis-voice');

    const listed = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    });
    assert.equal(listed.status, 200);
    const listResult = await listed.json();
    assert.deepEqual(listResult.result.tools.map((tool) => tool.name), ['speak_with_auralis']);
    assert.equal(listResult.result.tools[0]._meta.ui.resourceUri, 'ui://auralis-voice/cat-ear-player-v5-chat-v4.html');
    assert.equal(calls.provider, 0);
  } finally {
    await stopServer(server);
  }
});

test('authorized MCP generates exactly once and delivers validated WAV only to the locked cat-ear widget metadata', async () => {
  const { server, baseUrl, calls } = await startServer();
  try {
    const tokens = await authorize(baseUrl);
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18'
    };
    const called = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'speak_with_auralis', arguments: { text: '这是一次公开测试语音。' } }
      })
    });
    assert.equal(called.status, 200);
    const callResult = (await called.json()).result;
    assert.equal(callResult.structuredContent.status, 'audio_ready');
    assert.equal(callResult.structuredContent.record, undefined);
    assert.equal(callResult._meta.auralisPrivateAudio.record.audioMimeType, 'audio/wav');
    assert.equal(callResult._meta.auralisPrivateAudio.record.source, 'minimax');
    assert.equal(callResult._meta.auralisPrivateAudio.record.generated, true);
    assert.equal(callResult._meta.auralisPrivateAudio.record.durationSeconds, 0.25);
    assert.ok(callResult._meta.auralisPrivateAudio.record.audioBase64.length > 100);
    assert.equal(calls.provider, 1);

    const resource = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'ui://auralis-voice/cat-ear-player-v5-chat-v4.html' }
      })
    });
    assert.equal(resource.status, 200);
    const html = (await resource.json()).result.contents[0].text;
    assert.match(html, /<cat-ear-player id="auralis-player"/);
    assert.match(html, /M26 10 H318 C322 6 326 1 330 0/);
    assert.match(html, /ui\/notifications\/tool-result/);
    assert.match(html, /width: min\(276px, 100%\)/);
    assert.match(html, /height: 69px/);
    assert.match(html, /transform: scale\(\.80232558\)/);
    assert.match(html, /justify-items: start/);
    assert.match(html, /padding: 2px 0 4px/);
    assert.doesNotMatch(html, /body \{[^}]*place-items: center/s);
    assert.match(html, /<p id="auralis-subtitle"><\/p>/);
    assert.match(html, /subtitle\.textContent = typeof record\.text === 'string'/);
    assert.match(html, /#auralis-subtitle:empty/);
    assert.match(html, /context\.decodeAudioData\(copy\.buffer\)/);
    assert.match(html, /source\.start\(\)/);
    assert.match(html, /setControlDisabled\(true\)/);
    assert.match(html, /音频播放失败，未播放/);
    assert.doesNotMatch(html, /正在验证音频播放/);
    assert.ok(!html.includes(CLIENT_SECRET));

    const legacyResource = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/read',
        params: { uri: 'ui://auralis-voice/cat-ear-player-v5.html' }
      })
    });
    assert.equal(legacyResource.status, 200);
    const legacyHtml = (await legacyResource.json()).result.contents[0].text;
    assert.equal(legacyHtml, html);

    const previousResource = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'resources/read',
        params: { uri: 'ui://auralis-voice/cat-ear-player-v5-chat-v2.html' }
      })
    });
    assert.equal(previousResource.status, 200);
    assert.equal((await previousResource.json()).result.contents[0].text, html);
    assert.equal(calls.provider, 1);
  } finally {
    await stopServer(server);
  }
});

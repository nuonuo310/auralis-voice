'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MCP_PATH = '/mcp';
const RESOURCE_URI = 'ui://auralis-voice/cat-ear-player-v5.html';
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PLAYER_SOURCE_PATH = path.join(__dirname, '..', 'public', 'player', 'cat-ear-player.js');

let modulesPromise;

function loadModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
      import('@modelcontextprotocol/ext-apps/server'),
      import('zod')
    ]).then(([mcp, transport, apps, zod]) => ({
      McpServer: mcp.McpServer,
      StreamableHTTPServerTransport: transport.StreamableHTTPServerTransport,
      registerAppResource: apps.registerAppResource,
      registerAppTool: apps.registerAppTool,
      RESOURCE_MIME_TYPE: apps.RESOURCE_MIME_TYPE,
      z: zod.z
    }));
  }
  return modulesPromise;
}

function buildWidgetHtml(playerSource) {
  if (typeof playerSource !== 'string' || playerSource.length < 1000 || playerSource.includes('</script')) {
    throw new Error('Locked player source is unavailable.');
  }

  const bridge = String.raw`
const player = document.querySelector('#auralis-player');
const status = document.querySelector('#auralis-status');
let rpcId = 0;
const pending = new Map();

function notify(method, params) {
  window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('HOST_TIMEOUT'));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  });
}

function decodeAudio(record) {
  if (!record || record.audioMimeType !== 'audio/mpeg'
    || typeof record.audioBase64 !== 'string'
    || record.audioBase64.length < 100
    || record.audioBase64.length > 12000000
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.audioBase64)) {
    throw new Error('INVALID_AUDIO');
  }
  const raw = atob(record.audioBase64);
  if (raw.length < 64 || raw.length > 8388608) throw new Error('INVALID_AUDIO');
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return new Blob([bytes], { type: 'audio/mpeg' });
}

function applyToolResult(result) {
  if (result?.structuredContent?.status !== 'audio_ready') return;
  const record = result?._meta?.auralisPrivateAudio?.record;
  try {
    player.setAudioBlob(decodeAudio(record));
    status.textContent = '语音准备好了，点播放键听。';
  } catch {
    player.previewState('idle');
    status.textContent = '音频没有安全送达，请不要重复生成。';
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  if (typeof message.id === 'number') {
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    clearTimeout(callback.timer);
    if (message.error) callback.reject(message.error);
    else callback.resolve(message.result);
    return;
  }
  if (message.method === 'ui/notifications/tool-result') applyToolResult(message.params);
}, { passive: true });

player.previewState('loading');
request('ui/initialize', {
  appInfo: { name: 'auralis-voice-player', version: '1.0.0' },
  appCapabilities: {},
  protocolVersion: '2026-01-26'
}).then(() => notify('ui/notifications/initialized', {})).catch(() => {
  player.previewState('idle');
  status.textContent = '播放器连接失败，没有重新生成语音。';
});
`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 126px; background: transparent; }
    body {
      padding: 18px 10px 16px;
      display: grid;
      place-items: center;
      font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
    }
    main { width: min(344px, 100%); display: grid; gap: 7px; justify-items: center; }
    #auralis-status { margin: 0; color: #8e87a2; font-size: 12px; letter-spacing: .04em; }
  </style>
</head>
<body>
  <main>
    <p id="auralis-status">正在准备语音…</p>
    <cat-ear-player id="auralis-player" color="#D8CEF2"></cat-ear-player>
  </main>
  <script type="module">
${playerSource}
${bridge}
  </script>
</body>
</html>`;
}

function controlledToolError(error) {
  const allowed = new Set([
    'RATE_LIMITED',
    'TTS_BUSY',
    'PROVIDER_HTTP_ERROR',
    'PROVIDER_BUSINESS_ERROR',
    'PROVIDER_INVALID_RESPONSE',
    'PROVIDER_INVALID_AUDIO',
    'PROVIDER_NETWORK_ERROR',
    'PROVIDER_TIMEOUT',
    'REQUEST_ABORTED'
  ]);
  return error && allowed.has(error.code) ? error.code : 'TTS_REQUEST_FAILED';
}

function createAuralisMcpRuntime({ adapter, gate, oauth } = {}) {
  if (!adapter || typeof adapter.synthesize !== 'function') throw new TypeError('A TTS adapter is required.');
  if (!gate || typeof gate.run !== 'function') throw new TypeError('A TTS gate is required.');
  if (!oauth || typeof oauth.isAuthorized !== 'function' || typeof oauth.challenge !== 'function') {
    throw new TypeError('An OAuth runtime is required.');
  }

  const playerSource = fs.readFileSync(PLAYER_SOURCE_PATH, 'utf8');
  const widgetHtml = buildWidgetHtml(playerSource);

  async function createServer() {
    const {
      McpServer,
      registerAppResource,
      registerAppTool,
      RESOURCE_MIME_TYPE,
      z
    } = await loadModules();
    const server = new McpServer({ name: 'auralis-voice', version: '1.0.0' });
    const oauthSecurity = [{ type: 'oauth2', scopes: ['voice:speak'] }];

    registerAppResource(
      server,
      'auralis-cat-ear-player',
      RESOURCE_URI,
      {},
      async () => ({
        contents: [{
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] }
            }
          }
        }]
      })
    );

    registerAppTool(
      server,
      'speak_with_auralis',
      {
        title: 'Speak with Auralis Voice',
        description: 'Generate one short Auralis voice message and render it in the locked cat-ear audio player. Call only when the user explicitly asks to hear speech.',
        inputSchema: { text: z.string().min(1).max(1000) },
        securitySchemes: oauthSecurity,
        _meta: {
          securitySchemes: oauthSecurity,
          ui: { resourceUri: RESOURCE_URI }
        }
      },
      async ({ text }) => {
        const normalizedText = text.trim();
        if (normalizedText.length < 1 || Array.from(normalizedText).length > 1000) {
          return {
            isError: true,
            content: [{ type: 'text', text: '语音文字长度不符合要求，没有生成。' }],
            structuredContent: { status: 'failed', code: 'INVALID_TEXT' }
          };
        }
        try {
          const result = await gate.run(() => adapter.synthesize(normalizedText));
          if (!result || !Buffer.isBuffer(result.audio) || result.audio.length < 64
            || result.audio.length > MAX_AUDIO_BYTES || result.mimeType !== 'audio/mpeg') {
            throw Object.assign(new Error('invalid_audio'), { code: 'PROVIDER_INVALID_AUDIO' });
          }
          return {
            content: [{ type: 'text', text: '语音已生成一次，猫耳气泡已装入音频；请点播放键试听。' }],
            structuredContent: { status: 'audio_ready' },
            _meta: {
              auralisPrivateAudio: {
                version: 1,
                record: {
                  text: normalizedText,
                  audioMimeType: 'audio/mpeg',
                  audioBase64: result.audio.toString('base64')
                }
              }
            }
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text', text: '这次语音没有生成；不会自动重试。' }],
            structuredContent: { status: 'failed', code: controlledToolError(error) }
          };
        }
      }
    );

    return server;
  }

  async function handle(req, res, url) {
    if (url.pathname !== MCP_PATH) return false;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'https://chatgpt.com',
        'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        Vary: 'Origin'
      });
      res.end();
      return true;
    }

    if (!['POST', 'GET', 'DELETE'].includes(req.method)) {
      res.writeHead(405, { Allow: 'POST, GET, DELETE', 'Cache-Control': 'no-store' });
      res.end('method_not_allowed');
      return true;
    }

    if (!oauth.isAuthorized(req)) {
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'WWW-Authenticate': oauth.challenge(),
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return true;
    }

    const { StreamableHTTPServerTransport } = await loadModules();
    const server = await createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.setHeader('Access-Control-Allow-Origin', 'https://chatgpt.com');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    res.setHeader('Vary', 'Origin');
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    }
    return true;
  }

  return Object.freeze({ handle, resourceUri: RESOURCE_URI, widgetHtml });
}

module.exports = {
  MAX_AUDIO_BYTES,
  MCP_PATH,
  RESOURCE_URI,
  buildWidgetHtml,
  controlledToolError,
  createAuralisMcpRuntime,
  loadModules
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validatePcmWav } = require('./wav');

const MCP_PATH = '/mcp';
const LEGACY_RESOURCE_URI = 'ui://auralis-voice/cat-ear-player-v5.html';
const PREVIOUS_RESOURCE_URI = 'ui://auralis-voice/cat-ear-player-v5-chat-v2.html';
const LAST_RESOURCE_URI = 'ui://auralis-voice/cat-ear-player-v5-chat-v3.html';
const RESOURCE_URI = 'ui://auralis-voice/cat-ear-player-v5-chat-v4.html';
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
const subtitle = document.querySelector('#auralis-subtitle');
const control = player.shadowRoot.querySelector('.control');
const time = player.shadowRoot.querySelector('.time');
let rpcId = 0;
const pending = new Map();
let media = null;
let playback = null;
let playbackToken = 0;

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

function wavAscii(bytes, start, end) {
  let value = '';
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
}

function wavU16(bytes, position) {
  return bytes[position] | (bytes[position + 1] << 8);
}

function wavU32(bytes, position) {
  return (bytes[position] | (bytes[position + 1] << 8)
    | (bytes[position + 2] << 16) | (bytes[position + 3] << 24)) >>> 0;
}

function decodeAudio(record) {
  if (!record || record.source !== 'minimax' || record.generated !== true
    || record.audioUrl !== undefined || record.audioMimeType !== 'audio/wav'
    || typeof record.durationSeconds !== 'number'
    || !Number.isFinite(record.durationSeconds)
    || typeof record.audioBase64 !== 'string'
    || record.audioBase64.length < 100 || record.audioBase64.length > 3000000
    || record.audioBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.audioBase64)) {
    throw new Error('INVALID_AUDIO');
  }
  let raw;
  try {
    raw = atob(record.audioBase64);
  } catch {
    throw new Error('INVALID_AUDIO');
  }
  if (raw.length < 44 || raw.length > 2097152 || btoa(raw) !== record.audioBase64) {
    throw new Error('INVALID_AUDIO');
  }
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  if (wavAscii(bytes, 0, 4) !== 'RIFF' || wavAscii(bytes, 8, 12) !== 'WAVE'
    || wavU32(bytes, 4) + 8 !== bytes.length) throw new Error('INVALID_AUDIO');

  let position = 12;
  let formatSeen = false;
  let dataLength = null;
  while (position + 8 <= bytes.length) {
    const kind = wavAscii(bytes, position, position + 4);
    const size = wavU32(bytes, position + 4);
    const dataStart = position + 8;
    if (dataStart + size > bytes.length) throw new Error('INVALID_AUDIO');
    if (kind === 'fmt ') {
      if (formatSeen || size < 16 || wavU16(bytes, dataStart) !== 1
        || wavU16(bytes, dataStart + 2) !== 1 || wavU32(bytes, dataStart + 4) !== 16000
        || wavU32(bytes, dataStart + 8) !== 32000 || wavU16(bytes, dataStart + 12) !== 2
        || wavU16(bytes, dataStart + 14) !== 16) throw new Error('INVALID_AUDIO');
      formatSeen = true;
    }
    if (kind === 'data') {
      if (dataLength !== null) throw new Error('INVALID_AUDIO');
      dataLength = size;
    }
    position = dataStart + size + (size % 2);
  }
  if (!formatSeen || dataLength === null || dataLength % 2 !== 0 || position !== bytes.length) {
    throw new Error('INVALID_AUDIO');
  }
  const durationSeconds = dataLength / 32000;
  if (durationSeconds < 0.2 || durationSeconds > 60
    || Math.abs(durationSeconds - record.durationSeconds) > 0.001) {
    throw new Error('INVALID_AUDIO');
  }
  return { bytes, durationSeconds };
}

function formatTime(value) {
  const seconds = Math.max(0, Math.round(value));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':'
    + String(seconds % 60).padStart(2, '0');
}

function paintDuration() {
  time.textContent = media ? formatTime(media.durationSeconds) : '00:00';
}

function setControlDisabled(disabled) {
  control.disabled = disabled;
  control.style.opacity = disabled ? '.42' : '';
  control.style.cursor = disabled ? 'not-allowed' : '';
}

function disposePlayback() {
  const active = playback;
  playback = null;
  playbackToken += 1;
  if (!active) return;
  if (active.source) {
    active.source.onended = null;
    try { active.source.stop(); } catch {}
    try { active.source.disconnect(); } catch {}
  }
  if (active.context) {
    try {
      const closing = active.context.close();
      if (closing?.catch) closing.catch(() => {});
    } catch {}
  }
}

function setUnavailable(message, clearSubtitle = false) {
  disposePlayback();
  media = null;
  player.previewState('idle');
  setControlDisabled(true);
  paintDuration();
  if (clearSubtitle) subtitle.textContent = '';
  status.textContent = message;
}

async function startPlayback() {
  if (!media || control.disabled) return;
  const selected = media;
  const token = ++playbackToken;
  let context = null;
  try {
    setControlDisabled(true);
    const Context = window.AudioContext || window.webkitAudioContext;
    if (typeof Context !== 'function') throw new Error('AUDIO_CONTEXT_UNAVAILABLE');
    context = new Context();
    playback = { token, context, source: null, state: 'starting' };
    await context.resume();
    if (context.state !== 'running' || token !== playbackToken || media !== selected) {
      throw new Error('STALE_AUDIO');
    }
    const copy = new Uint8Array(selected.bytes.length);
    copy.set(selected.bytes);
    const decoded = await context.decodeAudioData(copy.buffer);
    if (token !== playbackToken || media !== selected || !decoded
      || !Number.isFinite(decoded.duration) || decoded.duration < 0.2 || decoded.duration > 60
      || Math.abs(decoded.duration - selected.durationSeconds) > 0.1) {
      throw new Error('AUDIO_DECODE_FAILED');
    }
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    const active = { token, context, source, state: 'playing' };
    playback = active;
    source.onended = () => {
      if (playback !== active) return;
      playback = null;
      playbackToken += 1;
      try { source.disconnect(); } catch {}
      try {
        const closing = context.close();
        if (closing?.catch) closing.catch(() => {});
      } catch {}
      player.previewState('ended');
      setControlDisabled(false);
      paintDuration();
      status.textContent = '';
    };
    source.start();
    player.previewState('playing');
    setControlDisabled(false);
    paintDuration();
    status.textContent = '';
  } catch {
    if (token !== playbackToken) return;
    if (playback) disposePlayback();
    else if (context) {
      try { await context.close(); } catch {}
    }
    setUnavailable('音频播放失败，未播放；不会自动重新生成。');
  }
}

async function togglePlayback() {
  if (!media || control.disabled) return;
  if (playback?.state === 'playing') {
    try {
      await playback.context.suspend();
      playback.state = 'paused';
      player.previewState('paused');
      setControlDisabled(false);
      paintDuration();
      return;
    } catch {
      setUnavailable('音频暂停失败，已停止播放。');
      return;
    }
  }
  if (playback?.state === 'paused') {
    try {
      await playback.context.resume();
      if (playback.context.state !== 'running') throw new Error('AUDIO_CONTEXT_NOT_RUNNING');
      playback.state = 'playing';
      player.previewState('playing');
      setControlDisabled(false);
      paintDuration();
      return;
    } catch {
      setUnavailable('音频继续播放失败，已停止播放。');
      return;
    }
  }
  await startPlayback();
}

function applyToolResult(result) {
  if (result?.structuredContent?.status !== 'audio_ready') return;
  const record = result?._meta?.auralisPrivateAudio?.record;
  try {
    disposePlayback();
    media = decodeAudio(record);
    player.previewState('idle');
    setControlDisabled(false);
    paintDuration();
    subtitle.textContent = typeof record.text === 'string' ? record.text : '';
    status.textContent = '';
  } catch {
    setUnavailable('音频没有安全送达，请不要重复生成。', true);
  }
}

control.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  void togglePlayback();
}, true);

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
setControlDisabled(true);
request('ui/initialize', {
  appInfo: { name: 'auralis-voice-player', version: '1.0.3' },
  appCapabilities: {},
  protocolVersion: '2026-01-26'
}).then(() => notify('ui/notifications/initialized', {})).catch(() => {
  setUnavailable('播放器连接失败，没有重新生成语音。');
});
`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 0; background: transparent; }
    body {
      padding: 2px 0 4px;
      font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
    }
    main { width: min(276px, 100%); display: grid; gap: 4px; justify-items: start; margin: 0; }
    #auralis-player-frame { width: 276px; height: 69px; max-width: 100%; overflow: visible; }
    cat-ear-player {
      width: 344px;
      transform: scale(.80232558);
      transform-origin: top left;
    }
    #auralis-subtitle,
    #auralis-status { width: 100%; margin: 0; text-align: left; }
    #auralis-subtitle { color: #5f596d; font-size: 14px; line-height: 1.55; }
    #auralis-status { color: #8e87a2; font-size: 11px; letter-spacing: .02em; }
    #auralis-subtitle:empty,
    #auralis-status:empty { display: none; }
  </style>
</head>
<body>
  <main>
    <div id="auralis-player-frame">
      <cat-ear-player id="auralis-player" color="#D8CEF2"></cat-ear-player>
    </div>
    <p id="auralis-subtitle"></p>
    <p id="auralis-status">正在准备语音…</p>
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
    const server = new McpServer({ name: 'auralis-voice', version: '1.0.3' });
    const oauthSecurity = [{ type: 'oauth2', scopes: ['voice:speak'] }];

    function widgetResource(uri) {
      return async () => ({
        contents: [{
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] }
            }
          }
        }]
      });
    }

    registerAppResource(
      server,
      'auralis-cat-ear-player',
      RESOURCE_URI,
      {},
      widgetResource(RESOURCE_URI)
    );
    registerAppResource(
      server,
      'auralis-cat-ear-player-legacy',
      LEGACY_RESOURCE_URI,
      {},
      widgetResource(LEGACY_RESOURCE_URI)
    );
    registerAppResource(
      server,
      'auralis-cat-ear-player-previous',
      PREVIOUS_RESOURCE_URI,
      {},
      widgetResource(PREVIOUS_RESOURCE_URI)
    );
    registerAppResource(
      server,
      'auralis-cat-ear-player-last',
      LAST_RESOURCE_URI,
      {},
      widgetResource(LAST_RESOURCE_URI)
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
          let metadata;
          try {
            metadata = validatePcmWav(result?.audio);
          } catch {
            metadata = null;
          }
          if (!result || !Buffer.isBuffer(result.audio) || result.audio.length < 44
            || result.audio.length > MAX_AUDIO_BYTES || result.mimeType !== 'audio/wav'
            || !metadata || !Number.isFinite(result.durationSeconds)
            || Math.abs(result.durationSeconds - metadata.durationSeconds) > 0.001) {
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
                  source: 'minimax',
                  generated: true,
                  audioMimeType: 'audio/wav',
                  durationSeconds: metadata.durationSeconds,
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
  LEGACY_RESOURCE_URI,
  MAX_AUDIO_BYTES,
  MCP_PATH,
  PREVIOUS_RESOURCE_URI,
  RESOURCE_URI,
  buildWidgetHtml,
  controlledToolError,
  createAuralisMcpRuntime,
  loadModules
};

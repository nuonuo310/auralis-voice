'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadConfig, resolveListenHost } = require('./config');
const { createMiniMaxAdapter } = require('./adapters/minimax');
const { TtsGateError, createTtsGate } = require('./tts-gate');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 1000;
const PLAYER_DIR = path.join(__dirname, '..', 'public', 'player');
const STATIC_PLAYER_FILES = Object.freeze({
  '/player/preview.html': {
    fileName: 'preview.html',
    contentType: 'text/html; charset=utf-8'
  },
  '/player/smoke.html': {
    fileName: 'smoke.html',
    contentType: 'text/html; charset=utf-8'
  },
  '/player/cat-ear-player.js': {
    fileName: 'cat-ear-player.js',
    contentType: 'text/javascript; charset=utf-8'
  },
  '/player/visual-master.svg': {
    fileName: 'visual-master.svg',
    contentType: 'image/svg+xml; charset=utf-8'
  }
});

class HttpError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HttpError';
    this.code = code;
  }
}

const ERROR_RESPONSES = Object.freeze({
  INVALID_REQUEST: { status: 400, message: 'Request is invalid.' },
  INVALID_CONTENT_TYPE: { status: 415, message: 'Content-Type must be application/json.' },
  INVALID_JSON: { status: 400, message: 'Request body must be valid JSON.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Request body is too large.' },
  INVALID_BODY: { status: 400, message: 'Request body is invalid.' },
  UNKNOWN_FIELD: { status: 400, message: 'Request contains unsupported fields.' },
  INVALID_TEXT: { status: 400, message: 'Text must be a non-empty string of 1 to 1000 characters.' },
  UNAUTHORIZED: { status: 401, message: 'Bearer token is required or invalid.' },
  RATE_LIMITED: { status: 429, message: 'Too many synthesis requests.' },
  TTS_BUSY: { status: 429, message: 'Another synthesis request is already in progress.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Method is not allowed.' },
  NOT_FOUND: { status: 404, message: 'Route was not found.' },
  REQUEST_ABORTED: { status: 408, message: 'Request was aborted.' },
  ADAPTER_NOT_IMPLEMENTED: { status: 501, message: 'Adapter is not implemented.' },
  PROVIDER_HTTP_ERROR: { status: 502, message: 'Voice provider returned an HTTP error.' },
  PROVIDER_BUSINESS_ERROR: { status: 502, message: 'Voice provider rejected the synthesis request.' },
  PROVIDER_INVALID_RESPONSE: { status: 502, message: 'Voice provider returned an invalid response.' },
  PROVIDER_INVALID_AUDIO: { status: 502, message: 'Voice provider returned invalid audio.' },
  PROVIDER_NETWORK_ERROR: { status: 502, message: 'Voice provider is unreachable.' },
  PROVIDER_TIMEOUT: { status: 504, message: 'Voice provider request timed out.' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error.' }
});

const TRUSTED_ADAPTER_ERROR_CODES = new Set([
  'ADAPTER_NOT_IMPLEMENTED',
  'PROVIDER_HTTP_ERROR',
  'PROVIDER_BUSINESS_ERROR',
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_INVALID_AUDIO',
  'PROVIDER_NETWORK_ERROR',
  'PROVIDER_TIMEOUT',
  'REQUEST_ABORTED'
]);

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

async function sendStaticPlayerFile(res, staticFile) {
  let content;
  try {
    content = await fs.readFile(path.join(PLAYER_DIR, staticFile.fileName));
  } catch (error) {
    throw new HttpError('INTERNAL_ERROR');
  }

  res.writeHead(200, {
    'Content-Type': staticFile.contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(content);
}

function toHttpError(error) {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof TtsGateError) {
    if (error.code === 'RATE_LIMITED' || error.code === 'TTS_BUSY') {
      return new HttpError(error.code);
    }
    return new HttpError('INTERNAL_ERROR');
  }
  if (error && typeof error.code === 'string' && TRUSTED_ADAPTER_ERROR_CODES.has(error.code)) {
    return new HttpError(error.code);
  }
  return new HttpError('INTERNAL_ERROR');
}

function sendError(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }

  const httpError = toHttpError(error);
  const code = Object.prototype.hasOwnProperty.call(ERROR_RESPONSES, httpError.code)
    ? httpError.code
    : 'INTERNAL_ERROR';
  const response = ERROR_RESPONSES[code];
  sendJson(res, response.status, {
    error: {
      code,
      message: response.message
    }
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (rejected) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(new HttpError('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', () => {
      if (!rejected) {
        rejected = true;
        reject(new HttpError('INVALID_BODY'));
      }
    });
  });
}

function parseJsonBody(body) {
  if (body.length === 0) {
    throw new HttpError('INVALID_JSON');
  }

  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw new HttpError('INVALID_JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError('INVALID_BODY');
  }

  return parsed;
}

function isJsonContentType(contentType) {
  return typeof contentType === 'string'
    && contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

async function handleTts(req, res, adapter, gate) {
  if (!isJsonContentType(req.headers['content-type'])) {
    throw new HttpError('INVALID_CONTENT_TYPE');
  }

  const body = parseJsonBody(await readBody(req));
  if (Object.keys(body).some((key) => key !== 'text')) {
    throw new HttpError('UNKNOWN_FIELD');
  }

  if (typeof body.text !== 'string') {
    throw new HttpError('INVALID_TEXT');
  }

  const text = body.text.trim();
  const textLength = Array.from(text).length;
  if (textLength < 1 || textLength > MAX_TEXT_LENGTH) {
    throw new HttpError('INVALID_TEXT');
  }

  const result = await gate.run(() => adapter.synthesize(text));
  if (!result || !Buffer.isBuffer(result.audio) || result.audio.length === 0 || result.mimeType !== 'audio/mpeg') {
    throw new HttpError('INTERNAL_ERROR');
  }

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': result.audio.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(result.audio);
}

function createRequestHandler({ adapter, gate = createTtsGate() }) {
  if (!adapter || typeof adapter.synthesize !== 'function') {
    throw new TypeError('A TTS adapter is required.');
  }
  if (!gate || typeof gate.isAuthorized !== 'function' || typeof gate.run !== 'function') {
    throw new TypeError('A TTS gate is required.');
  }

  return async function requestHandler(req, res) {
    try {
      let url;
      try {
        url = new URL(req.url || '/', 'http://localhost');
      } catch (error) {
        throw new HttpError('INVALID_REQUEST');
      }

      const staticFile = STATIC_PLAYER_FILES[url.pathname];
      if (staticFile) {
        if (req.method !== 'GET') {
          sendJson(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: ERROR_RESPONSES.METHOD_NOT_ALLOWED.message }
          }, { Allow: 'GET' });
          return;
        }
        await sendStaticPlayerFile(res, staticFile);
        return;
      }

      if (url.pathname === '/health') {
        if (req.method !== 'GET') {
          sendJson(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: ERROR_RESPONSES.METHOD_NOT_ALLOWED.message }
          }, { Allow: 'GET' });
          return;
        }
        sendJson(res, 200, { status: 'ok', provider: 'minimax' });
        return;
      }

      if (url.pathname === '/api/tts') {
        if (req.method !== 'POST') {
          sendJson(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: ERROR_RESPONSES.METHOD_NOT_ALLOWED.message }
          }, { Allow: 'POST' });
          return;
        }
        if (!gate.isAuthorized(req)) {
          throw new HttpError('UNAUTHORIZED');
        }
        await handleTts(req, res, adapter, gate);
        return;
      }

      throw new HttpError('NOT_FOUND');
    } catch (error) {
      sendError(res, error);
    }
  };
}

function createVoiceServer({ adapter, accessToken = null, gate = null }) {
  const ttsGate = gate || createTtsGate({ accessToken });
  return http.createServer(createRequestHandler({ adapter, gate: ttsGate }));
}

function createConfiguredServer({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = loadConfig(env);
  const adapter = createMiniMaxAdapter({
    apiKey: config.apiKey,
    groupId: config.groupId,
    voiceId: config.voiceId,
    model: config.model,
    fetchImpl
  });
  return createVoiceServer({ adapter, accessToken: config.accessToken });
}

function startFromEnv(env = process.env) {
  const config = loadConfig(env);
  const adapter = createMiniMaxAdapter({
    apiKey: config.apiKey,
    groupId: config.groupId,
    voiceId: config.voiceId,
    model: config.model
  });
  const server = createVoiceServer({ adapter, accessToken: config.accessToken });
  server.listen(config.port, config.host, () => {
    console.log(`Voice service listening on port ${config.port}.`);
  });
  return server;
}

if (require.main === module) {
  try {
    startFromEnv();
  } catch (error) {
    console.error(error && error.message ? error.message : 'Server failed to start.');
    process.exitCode = 1;
  }
}

module.exports = {
  ERROR_RESPONSES,
  HttpError,
  MAX_BODY_BYTES,
  MAX_TEXT_LENGTH,
  createConfiguredServer,
  createRequestHandler,
  createVoiceServer,
  handleTts,
  resolveListenHost,
  startFromEnv
};

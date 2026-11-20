'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { getAuthorizationHeaders } = require('./tts-gate');

const CALLBACK_URL = 'https://chatgpt.com/connector_platform_oauth_redirect';
const OAUTH_SCOPE = 'voice:speak';
const MAX_FORM_BYTES = 16 * 1024;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING_CODES = 256;

function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function normalizeOrigin(origin) {
  if (typeof origin !== 'string' || origin.length > 2048) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== origin) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function safeEqual(left, right) {
  const leftDigest = createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = createHash('sha256').update(String(right), 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function tokenValue(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_FORM_BYTES) {
        settled = true;
        reject(new Error('form_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', () => {
      if (settled) return;
      settled = true;
      reject(new Error('form_unavailable'));
    });
  });
}

function parseBasicAuthorization(req) {
  const headers = getAuthorizationHeaders(req);
  if (headers.length !== 1 || !headers[0].startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(headers[0].slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1))
    };
  } catch {
    return null;
  }
}

function createOAuthRuntime({ origin, clientId, clientSecret, now = Date.now } = {}) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) throw new TypeError('A valid HTTPS OAuth origin is required.');
  if (typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 128 || /\s/u.test(clientId)) {
    throw new TypeError('A valid OAuth client ID is required.');
  }
  if (typeof clientSecret !== 'string' || clientSecret.length < 32 || /\s/u.test(clientSecret)) {
    throw new TypeError('A valid OAuth client secret is required.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  const resource = `${normalizedOrigin}/mcp`;
  const resourceMetadataUrl = `${normalizedOrigin}/.well-known/oauth-protected-resource/mcp`;
  const codes = new Map();
  const accessTokens = new Map();
  const refreshTokens = new Map();

  function prune(store, currentTime) {
    for (const [key, value] of store) {
      if (value.expiresAt <= currentTime) store.delete(key);
    }
  }

  function issueTokens() {
    const currentTime = now();
    prune(accessTokens, currentTime);
    prune(refreshTokens, currentTime);
    const accessToken = tokenValue(32);
    const refreshToken = tokenValue(48);
    accessTokens.set(accessToken, { expiresAt: currentTime + ACCESS_TOKEN_TTL_MS });
    refreshTokens.set(refreshToken, { expiresAt: currentTime + REFRESH_TOKEN_TTL_MS });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: OAUTH_SCOPE
    };
  }

  function clientCredentials(req, form) {
    const basic = parseBasicAuthorization(req);
    return basic || {
      clientId: form.get('client_id'),
      clientSecret: form.get('client_secret')
    };
  }

  function challenge() {
    return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${OAUTH_SCOPE}"`;
  }

  function isAuthorized(req) {
    const headers = getAuthorizationHeaders(req);
    if (headers.length !== 1) return false;
    const match = /^Bearer ([^\s]+)$/i.exec(headers[0]);
    if (!match) return false;
    const record = accessTokens.get(match[1]);
    if (!record || record.expiresAt <= now()) {
      accessTokens.delete(match[1]);
      return false;
    }
    return true;
  }

  async function handleToken(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      return;
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      sendJson(res, 415, { error: 'invalid_request' });
      return;
    }

    let form;
    try {
      form = await readForm(req);
    } catch {
      sendJson(res, 400, { error: 'invalid_request' });
      return;
    }
    const suppliedClient = clientCredentials(req, form);
    if (!safeEqual(suppliedClient.clientId || '', clientId)
      || !safeEqual(suppliedClient.clientSecret || '', clientSecret)) {
      sendJson(res, 401, { error: 'invalid_client' });
      return;
    }

    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = form.get('code') || '';
      const record = codes.get(code);
      codes.delete(code);
      if (!record || record.expiresAt <= now()
        || form.get('redirect_uri') !== CALLBACK_URL
        || suppliedClient.clientId !== clientId) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      const verifier = form.get('code_verifier') || '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      const challengeValue = createHash('sha256').update(verifier, 'ascii').digest('base64url');
      if (!safeEqual(challengeValue, record.challenge)) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      sendJson(res, 200, issueTokens());
      return;
    }

    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') || '';
      const record = refreshTokens.get(refreshToken);
      refreshTokens.delete(refreshToken);
      if (!record || record.expiresAt <= now()) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      sendJson(res, 200, issueTokens());
      return;
    }

    sendJson(res, 400, { error: 'unsupported_grant_type' });
  }

  async function handle(req, res, url) {
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
        return true;
      }
      const payload = {
        resource,
        authorization_servers: [normalizedOrigin],
        scopes_supported: [OAUTH_SCOPE],
        bearer_methods_supported: ['header']
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end();
      } else {
        sendJson(res, 200, payload);
      }
      return true;
    }

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
        return true;
      }
      const payload = {
        issuer: normalizedOrigin,
        authorization_endpoint: `${normalizedOrigin}/oauth/authorize`,
        token_endpoint: `${normalizedOrigin}/oauth/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        scopes_supported: [OAUTH_SCOPE]
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end();
      } else {
        sendJson(res, 200, payload);
      }
      return true;
    }

    if (url.pathname === '/oauth/authorize') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
        return true;
      }
      const scope = url.searchParams.get('scope') || '';
      const resourceParam = url.searchParams.get('resource');
      const state = url.searchParams.get('state') || '';
      const challengeValue = url.searchParams.get('code_challenge') || '';
      const valid = url.searchParams.get('response_type') === 'code'
        && url.searchParams.get('client_id') === clientId
        && url.searchParams.get('redirect_uri') === CALLBACK_URL
        && url.searchParams.get('code_challenge_method') === 'S256'
        && /^[A-Za-z0-9_-]{43,128}$/.test(challengeValue)
        && scope.split(/\s+/u).includes(OAUTH_SCOPE)
        && state.length >= 1 && state.length <= 2048
        && (resourceParam === null || resourceParam === resource);
      if (!valid) {
        sendJson(res, 400, { error: 'invalid_request' });
        return true;
      }

      prune(codes, now());
      if (codes.size >= MAX_PENDING_CODES) {
        sendJson(res, 429, { error: 'temporarily_unavailable' });
        return true;
      }
      const code = tokenValue(32);
      codes.set(code, { challenge: challengeValue, expiresAt: now() + AUTHORIZATION_CODE_TTL_MS });
      const redirect = new URL(CALLBACK_URL);
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', state);
      res.writeHead(302, {
        Location: redirect.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end();
      return true;
    }

    if (url.pathname === '/oauth/token') {
      await handleToken(req, res);
      return true;
    }

    return false;
  }

  return Object.freeze({
    callbackUrl: CALLBACK_URL,
    challenge,
    clientId,
    handle,
    isAuthorized,
    origin: normalizedOrigin,
    resource,
    resourceMetadataUrl
  });
}

module.exports = {
  ACCESS_TOKEN_TTL_MS,
  AUTHORIZATION_CODE_TTL_MS,
  CALLBACK_URL,
  OAUTH_SCOPE,
  REFRESH_TOKEN_TTL_MS,
  MAX_PENDING_CODES,
  createOAuthRuntime,
  normalizeOrigin,
  safeEqual
};

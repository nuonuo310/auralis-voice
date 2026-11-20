'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');

const DEFAULT_MAX_CONCURRENT_TTS = 1;
const DEFAULT_MAX_REQUESTS = 6;
const DEFAULT_WINDOW_MS = 60_000;
const BEARER_PATTERN = /^Bearer ([^\s]+)$/i;

class TtsGateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TtsGateError';
    this.code = code;
  }
}

function digestToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function getAuthorizationHeaders(req) {
  if (req && Array.isArray(req.rawHeaders)) {
    const values = [];
    for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
      if (String(req.rawHeaders[index]).toLowerCase() === 'authorization') {
        values.push(String(req.rawHeaders[index + 1]));
      }
    }
    return values;
  }

  const distinct = req && req.headersDistinct ? req.headersDistinct.authorization : undefined;
  if (Array.isArray(distinct)) {
    return distinct.map(String);
  }
  if (typeof distinct === 'string') {
    return [distinct];
  }

  const fallback = req && req.headers ? req.headers.authorization : undefined;
  if (Array.isArray(fallback)) {
    return fallback.map(String);
  }
  return typeof fallback === 'string' ? [fallback] : [];
}

function createAuthorizationVerifier(accessToken) {
  if (accessToken === null || accessToken === undefined || accessToken === '') {
    return () => true;
  }
  if (typeof accessToken !== 'string' || /\s/u.test(accessToken)) {
    throw new TypeError('accessToken must be a non-whitespace string.');
  }

  const expectedDigest = digestToken(accessToken);
  return function isAuthorized(req) {
    const headers = getAuthorizationHeaders(req);
    if (headers.length !== 1) {
      return false;
    }
    const match = BEARER_PATTERN.exec(headers[0]);
    if (match === null) {
      return false;
    }
    return timingSafeEqual(digestToken(match[1]), expectedDigest);
  };
}

function createTtsGate({
  accessToken = null,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now
} = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new TypeError('maxRequests must be a positive integer.');
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new TypeError('windowMs must be a positive integer.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.');
  }

  const isAuthorized = createAuthorizationVerifier(accessToken);
  const requestTimes = [];
  let inFlight = false;

  async function run(task) {
    if (typeof task !== 'function') {
      throw new TypeError('A synthesis task is required.');
    }
    if (inFlight) {
      throw new TtsGateError('TTS_BUSY');
    }

    const currentTime = now();
    const cutoff = currentTime - windowMs;
    while (requestTimes.length > 0 && requestTimes[0] <= cutoff) {
      requestTimes.shift();
    }
    if (requestTimes.length >= maxRequests) {
      throw new TtsGateError('RATE_LIMITED');
    }

    requestTimes.push(currentTime);
    inFlight = true;
    try {
      return await task();
    } finally {
      inFlight = false;
    }
  }

  return Object.freeze({ isAuthorized, run });
}

module.exports = {
  BEARER_PATTERN,
  DEFAULT_MAX_CONCURRENT_TTS,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_WINDOW_MS,
  TtsGateError,
  createAuthorizationVerifier,
  createTtsGate,
  digestToken,
  getAuthorizationHeaders
};

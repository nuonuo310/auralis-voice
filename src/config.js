'use strict';

const net = require('node:net');

const MINIMAX_TTS_URL = 'https://api.minimaxi.com/v1/t2a_v2';
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const MIN_PUBLIC_TOKEN_LENGTH = 32;
const REQUIRED_KEYS = Object.freeze([
  'MINIMAX_API_KEY',
  'MINIMAX_VOICE_ID',
  'MINIMAX_MODEL'
]);
const OPTIONAL_KEYS = Object.freeze([
  'MINIMAX_GROUP_ID',
  'PUBLIC_V1_ACCESS_TOKEN'
]);

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.code = 'CONFIG_INVALID';
  }
}

function parsePort(rawPort) {
  if (rawPort === undefined || rawPort === null || rawPort === '') {
    return DEFAULT_PORT;
  }

  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort.trim())) {
    throw new ConfigError('PORT must be an integer between 1 and 65535.');
  }

  const port = Number(rawPort.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT must be an integer between 1 and 65535.');
  }

  return port;
}

function resolveListenHost(env = {}) {
  return typeof env.HOST === 'string' && env.HOST.trim() !== ''
    ? env.HOST.trim()
    : DEFAULT_HOST;
}

function isLoopbackHost(host) {
  if (typeof host !== 'string') {
    return false;
  }

  let normalized = host.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }
  if (net.isIP(normalized) !== 4) {
    return false;
  }
  return Number(normalized.split('.')[0]) === 127;
}

function parseAccessToken(rawToken) {
  if (rawToken === undefined || rawToken === null || rawToken === '') {
    return null;
  }
  if (typeof rawToken !== 'string') {
    throw new ConfigError('PUBLIC_V1_ACCESS_TOKEN must be a string.');
  }

  const token = rawToken.trim();
  if (token === '') {
    return null;
  }
  if (/\s/u.test(token)) {
    throw new ConfigError('PUBLIC_V1_ACCESS_TOKEN must not contain whitespace.');
  }
  return token;
}

function loadConfig(env = process.env) {
  if (!env || typeof env !== 'object') {
    throw new ConfigError('Server configuration is unavailable.');
  }

  const values = {};
  const fieldByKey = {
    MINIMAX_API_KEY: 'apiKey',
    MINIMAX_VOICE_ID: 'voiceId',
    MINIMAX_MODEL: 'model'
  };
  const missing = [];

  for (const key of REQUIRED_KEYS) {
    const rawValue = env[key];
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      missing.push(key);
      continue;
    }
    values[fieldByKey[key]] = rawValue.trim();
  }

  if (missing.length > 0) {
    throw new ConfigError(`Missing required server configuration: ${missing.join(', ')}.`);
  }

  const rawGroupId = env.MINIMAX_GROUP_ID;
  values.groupId = typeof rawGroupId === 'string' && rawGroupId.trim() !== ''
    ? rawGroupId.trim()
    : null;
  values.host = resolveListenHost(env);
  values.accessToken = parseAccessToken(env.PUBLIC_V1_ACCESS_TOKEN);
  if (!isLoopbackHost(values.host)
    && (values.accessToken === null || Array.from(values.accessToken).length < MIN_PUBLIC_TOKEN_LENGTH)) {
    throw new ConfigError(
      `PUBLIC_V1_ACCESS_TOKEN must be at least ${MIN_PUBLIC_TOKEN_LENGTH} characters when HOST is not loopback.`
    );
  }
  values.port = parsePort(env.PORT);
  return values;
}

module.exports = {
  ConfigError,
  DEFAULT_HOST,
  DEFAULT_PORT,
  MINIMAX_TTS_URL,
  MIN_PUBLIC_TOKEN_LENGTH,
  OPTIONAL_KEYS,
  REQUIRED_KEYS,
  isLoopbackHost,
  loadConfig,
  parseAccessToken,
  parsePort,
  resolveListenHost
};

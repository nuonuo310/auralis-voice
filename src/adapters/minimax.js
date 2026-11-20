'use strict';

const { MINIMAX_TTS_URL } = require('../config');
const { canonicalizeNonseekableWav, validatePcmWav } = require('../wav');

const MINIMAX_TIMEOUT_MS = 120000;

class AdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

function isStrictHex(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length % 2 === 0
    && /^[0-9a-fA-F]+$/.test(value);
}

function createMiniMaxAdapter({
  apiKey,
  groupId,
  voiceId,
  model,
  fetchImpl = globalThis.fetch,
  timeoutMs = MINIMAX_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive integer.');
  }

  async function synthesize(text, signal) {
    const normalizedGroupId = typeof groupId === 'string' ? groupId.trim() : '';
    const requestUrl = new URL(MINIMAX_TTS_URL);
    if (normalizedGroupId !== '') {
      requestUrl.searchParams.set('GroupId', normalizedGroupId);
    }
    const endpoint = requestUrl.search ? requestUrl.toString() : MINIMAX_TTS_URL;

    const requestBody = JSON.stringify({
      model,
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: voiceId,
        speed: 1,
        vol: 1,
        pitch: 0
      },
      audio_setting: {
        format: 'wav',
        sample_rate: 16000,
        channel: 1
      },
      language_boost: 'auto'
    });

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: requestBody,
          signal: controller.signal
        });
      } catch (error) {
        if (timedOut) {
          throw new AdapterError('PROVIDER_TIMEOUT', 'Voice provider request timed out.');
        }
        if (signal && signal.aborted) {
          throw new AdapterError('REQUEST_ABORTED', 'Request was aborted.');
        }
        throw new AdapterError('PROVIDER_NETWORK_ERROR', 'Voice provider is unreachable.');
      }

      if (!response || typeof response.ok !== 'boolean') {
        throw new AdapterError('PROVIDER_INVALID_RESPONSE', 'Voice provider returned an invalid response.');
      }
      if (!response.ok) {
        throw new AdapterError('PROVIDER_HTTP_ERROR', 'Voice provider returned an HTTP error.');
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (timedOut) {
          throw new AdapterError('PROVIDER_TIMEOUT', 'Voice provider request timed out.');
        }
        if (signal && signal.aborted) {
          throw new AdapterError('REQUEST_ABORTED', 'Request was aborted.');
        }
        throw new AdapterError('PROVIDER_INVALID_RESPONSE', 'Voice provider returned an invalid response.');
      }

      const businessStatus = payload && payload.base_resp
        ? payload.base_resp.status_code
        : undefined;
      if (!(businessStatus === 0 || businessStatus === '0')) {
        throw new AdapterError('PROVIDER_BUSINESS_ERROR', 'Voice provider rejected the synthesis request.');
      }

      const audioHex = payload && payload.data ? payload.data.audio : undefined;
      if (!isStrictHex(audioHex)) {
        throw new AdapterError('PROVIDER_INVALID_AUDIO', 'Voice provider returned invalid audio.');
      }

      let audio = Buffer.from(audioHex, 'hex');
      audio = canonicalizeNonseekableWav(audio);
      let metadata;
      try {
        metadata = validatePcmWav(audio);
      } catch {
        throw new AdapterError('PROVIDER_INVALID_AUDIO', 'Voice provider returned invalid audio.');
      }

      return {
        audio,
        mimeType: metadata.mimeType,
        durationSeconds: metadata.durationSeconds
      };
    } finally {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  return {
    provider: 'minimax',
    synthesize
  };
}

module.exports = {
  AdapterError,
  MINIMAX_TIMEOUT_MS,
  createMiniMaxAdapter,
  isStrictHex
};

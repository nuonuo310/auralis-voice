'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MINIMAX_TIMEOUT_MS,
  createMiniMaxAdapter,
  isStrictHex
} = require('../src/adapters/minimax');
const { createBreezeAdapter } = require('../src/adapters/breeze');

const BASE_OPTIONS = {
  apiKey: 'test-api-key',
  groupId: 'group id/+&=',
  voiceId: 'test-voice-id',
  model: 'test-model'
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function successResponse(audio = '48656c6c6f') {
  return jsonResponse({
    base_resp: { status_code: 0 },
    data: { audio }
  });
}

async function expectCode(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('uses the fixed China endpoint, encodes GroupId, and sends fixed TTS parameters', async () => {
  let callCount = 0;
  let captured;
  const fetchImpl = async (url, init) => {
    callCount += 1;
    captured = { url, init };
    return successResponse('48656c6c6f');
  };
  const adapter = createMiniMaxAdapter({ ...BASE_OPTIONS, fetchImpl });

  const result = await adapter.synthesize('hello');

  assert.equal(callCount, 1);
  assert.equal(
    captured.url,
    'https://api.minimaxi.com/v1/t2a_v2?GroupId=group+id%2F%2B%26%3D'
  );
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Bearer test-api-key');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.init.body), {
    model: 'test-model',
    text: 'hello',
    stream: false,
    output_format: 'hex',
    voice_setting: {
      voice_id: 'test-voice-id',
      speed: 1,
      vol: 1,
      pitch: 0
    },
    audio_setting: {
      format: 'mp3',
      sample_rate: 32000,
      bitrate: 128000,
      channel: 1
    },
    language_boost: 'auto'
  });
  assert.deepEqual(result.audio, Buffer.from('Hello'));
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(MINIMAX_TIMEOUT_MS, 120000);
});

test('uses the exact queryless China URL when GroupId is missing or blank', async (t) => {
  const cases = [
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['null', null]
  ];

  for (const [name, groupId] of cases) {
    await t.test(name, async () => {
      let capturedUrl = null;
      const adapter = createMiniMaxAdapter({
        ...BASE_OPTIONS,
        groupId,
        fetchImpl: async (url) => {
          capturedUrl = url;
          return successResponse();
        }
      });

      await adapter.synthesize('hello');

      assert.equal(capturedUrl, 'https://api.minimaxi.com/v1/t2a_v2');
      assert.equal(new URL(capturedUrl).search, '');
      assert.doesNotMatch(capturedUrl, /GroupId=|\?$/);
    });
  }
});
test('strictly validates hexadecimal audio', () => {
  assert.equal(isStrictHex('00ffA1'), true);
  assert.equal(isStrictHex(''), false);
  assert.equal(isStrictHex('abc'), false);
  assert.equal(isStrictHex('zz'), false);
  assert.equal(isStrictHex(null), false);
});

test('rejects empty, odd-length, and non-hex audio safely', async (t) => {
  const cases = [
    ['empty audio', ''],
    ['odd-length hex', 'abc'],
    ['non-hex audio', 'zz'],
    ['non-string audio', null]
  ];

  for (const [name, audio] of cases) {
    await t.test(name, async () => {
      const adapter = createMiniMaxAdapter({
        ...BASE_OPTIONS,
        fetchImpl: async () => successResponse(audio)
      });
      await expectCode(adapter.synthesize('hello'), 'PROVIDER_INVALID_AUDIO');
    });
  }
});

test('maps HTTP errors without retrying', async () => {
  let callCount = 0;
  const adapter = createMiniMaxAdapter({
    ...BASE_OPTIONS,
    fetchImpl: async () => {
      callCount += 1;
      return new Response('upstream detail must not escape', { status: 503 });
    }
  });

  await expectCode(adapter.synthesize('hello'), 'PROVIDER_HTTP_ERROR');
  assert.equal(callCount, 1);
});

test('maps MiniMax business errors safely', async () => {
  const adapter = createMiniMaxAdapter({
    ...BASE_OPTIONS,
    fetchImpl: async () => jsonResponse({
      base_resp: { status_code: 1004, status_msg: 'private upstream detail' }
    })
  });

  await assert.rejects(adapter.synthesize('hello'), (error) => {
    assert.equal(error.code, 'PROVIDER_BUSINESS_ERROR');
    assert.doesNotMatch(error.message, /private upstream detail/);
    return true;
  });
});

test('maps malformed upstream JSON to a stable error', async () => {
  const adapter = createMiniMaxAdapter({
    ...BASE_OPTIONS,
    fetchImpl: async () => new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  });

  await expectCode(adapter.synthesize('hello'), 'PROVIDER_INVALID_RESPONSE');
});

test('maps timeout to a stable error', async () => {
  const adapter = createMiniMaxAdapter({
    ...BASE_OPTIONS,
    timeoutMs: 10,
    fetchImpl: async (url, init) => new Promise((resolve, reject) => {
      const onAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (init.signal.aborted) {
        onAbort();
      } else {
        init.signal.addEventListener('abort', onAbort, { once: true });
      }
    })
  });

  await expectCode(adapter.synthesize('hello'), 'PROVIDER_TIMEOUT');
});

test('maps network errors without exposing internal details', async () => {
  const adapter = createMiniMaxAdapter({
    ...BASE_OPTIONS,
    fetchImpl: async () => {
      throw new Error('socket and secret internal detail');
    }
  });

  await assert.rejects(adapter.synthesize('hello'), (error) => {
    assert.equal(error.code, 'PROVIDER_NETWORK_ERROR');
    assert.doesNotMatch(error.message, /socket and secret/);
    return true;
  });
});

test('Breeze placeholder returns ADAPTER_NOT_IMPLEMENTED', async () => {
  const adapter = createBreezeAdapter();
  assert.equal(adapter.provider, 'breeze');
  await expectCode(adapter.synthesize('hello'), 'ADAPTER_NOT_IMPLEMENTED');
});

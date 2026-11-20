'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_WAV_BYTES,
  canonicalizeNonseekableWav,
  validatePcmWav
} = require('../src/wav');
const { makePcmWav } = require('../test-support/wav');

test('validates the exact 16 kHz mono PCM16 playback contract', () => {
  const audio = makePcmWav({ durationSeconds: 0.5 });
  assert.deepEqual(validatePcmWav(audio), {
    mimeType: 'audio/wav',
    durationSeconds: 0.5
  });
  assert.equal(MAX_WAV_BYTES, 8 * 1024 * 1024);
});

test('canonicalizes only the bounded non-seekable WAV size placeholders', () => {
  const original = makePcmWav({ durationSeconds: 0.25, nonseekable: true });
  const canonical = canonicalizeNonseekableWav(original);
  assert.notEqual(canonical, original);
  assert.equal(original.readUInt32LE(4), 0xffffffff);
  assert.equal(canonical.readUInt32LE(4), canonical.length - 8);
  assert.equal(canonical.readUInt32LE(40), canonical.length - 44);
  assert.equal(validatePcmWav(canonical).durationSeconds, 0.25);
});

test('rejects malformed or incompatible WAV data', () => {
  const wrongRate = makePcmWav();
  wrongRate.writeUInt32LE(22050, 24);
  assert.throws(() => validatePcmWav(wrongRate), /invalid_wav/);
  assert.throws(() => validatePcmWav(Buffer.from('not audio')), /invalid_wav/);
});

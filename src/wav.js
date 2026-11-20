'use strict';

const MAX_WAV_BYTES = 8 * 1024 * 1024;

function canonicalizeNonseekableWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.length > MAX_WAV_BYTES
    || audio.toString('ascii', 0, 4) !== 'RIFF'
    || audio.toString('ascii', 8, 12) !== 'WAVE'
    || audio.readUInt32LE(4) !== 0xffffffff) {
    return audio;
  }

  let position = 12;
  let foundFormat = false;
  while (position + 8 <= audio.length) {
    const kind = audio.toString('ascii', position, position + 4);
    const size = audio.readUInt32LE(position + 4);
    const dataStart = position + 8;
    if (kind === 'fmt ') {
      if (foundFormat || size < 16 || dataStart + size > audio.length) return audio;
      foundFormat = true;
    }
    if (kind === 'data') {
      if (!foundFormat || size !== 0xffffffff) return audio;
      const actualDataBytes = audio.length - dataStart;
      if (actualDataBytes < 6400 || actualDataBytes % 2 !== 0) return audio;
      const canonical = Buffer.from(audio);
      canonical.writeUInt32LE(canonical.length - 8, 4);
      canonical.writeUInt32LE(actualDataBytes, position + 4);
      return canonical;
    }
    if (size === 0xffffffff) return audio;
    const next = dataStart + size + (size % 2);
    if (next > audio.length) return audio;
    position = next;
  }
  return audio;
}

function validatePcmWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.length > MAX_WAV_BYTES
    || audio.toString('ascii', 0, 4) !== 'RIFF'
    || audio.toString('ascii', 8, 12) !== 'WAVE'
    || audio.readUInt32LE(4) + 8 !== audio.length) {
    throw new Error('invalid_wav');
  }

  let position = 12;
  let formatSeen = false;
  let dataLength = null;
  while (position + 8 <= audio.length) {
    const kind = audio.toString('ascii', position, position + 4);
    const size = audio.readUInt32LE(position + 4);
    const dataStart = position + 8;
    if (dataStart + size > audio.length) throw new Error('invalid_wav');

    if (kind === 'fmt ') {
      if (formatSeen || size < 16
        || audio.readUInt16LE(dataStart) !== 1
        || audio.readUInt16LE(dataStart + 2) !== 1
        || audio.readUInt32LE(dataStart + 4) !== 16000
        || audio.readUInt32LE(dataStart + 8) !== 32000
        || audio.readUInt16LE(dataStart + 12) !== 2
        || audio.readUInt16LE(dataStart + 14) !== 16) {
        throw new Error('invalid_wav');
      }
      formatSeen = true;
    }

    if (kind === 'data') {
      if (dataLength !== null) throw new Error('invalid_wav');
      dataLength = size;
    }

    position = dataStart + size + (size % 2);
  }

  if (!formatSeen || dataLength === null || dataLength % 2 !== 0 || position !== audio.length) {
    throw new Error('invalid_wav');
  }

  const durationSeconds = dataLength / 32000;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.2 || durationSeconds > 60) {
    throw new Error('invalid_wav');
  }

  return Object.freeze({
    mimeType: 'audio/wav',
    durationSeconds
  });
}

module.exports = {
  MAX_WAV_BYTES,
  canonicalizeNonseekableWav,
  validatePcmWav
};

'use strict';

function makePcmWav({ durationSeconds = 0.25, nonseekable = false } = {}) {
  const dataLength = Math.round(durationSeconds * 32000);
  const audio = Buffer.alloc(44 + dataLength);
  audio.write('RIFF', 0, 'ascii');
  audio.writeUInt32LE(nonseekable ? 0xffffffff : audio.length - 8, 4);
  audio.write('WAVE', 8, 'ascii');
  audio.write('fmt ', 12, 'ascii');
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36, 'ascii');
  audio.writeUInt32LE(nonseekable ? 0xffffffff : dataLength, 40);
  return audio;
}

module.exports = { makePcmWav };

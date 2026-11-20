'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PLAYER_PATH = path.join(__dirname, '..', 'public', 'player', 'cat-ear-player.js');
const LOCKED_SHA256 = 'e31b5de45bb44ab92fadbc23240187f135e8abf2db4d84fd5a6e1b478ca59e3f';

test('locked cat-ear player matches the approved v5 hash', () => {
  const actualHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(PLAYER_PATH))
    .digest('hex');

  assert.equal(actualHash, LOCKED_SHA256);
});

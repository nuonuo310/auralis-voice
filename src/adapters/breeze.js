'use strict';

function createBreezeAdapter() {
  async function synthesize(text, signal) {
    const error = new Error('Breeze adapter is not implemented.');
    error.name = 'AdapterError';
    error.code = 'ADAPTER_NOT_IMPLEMENTED';
    throw error;
  }

  return {
    provider: 'breeze',
    synthesize
  };
}

module.exports = {
  createBreezeAdapter
};

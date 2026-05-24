const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/oauth-login.js');

test('direct ChatGPT login opens homepage with signup-page injection', async () => {
  const calls = {
    reuse: [],
    ensureReady: [],
    stable: [],
    complete: [],
    sent: [],
  };
  const injectFiles = ['content/utils.js', 'content/signup-page.js'];
  const executor = globalThis.MultiPageBackgroundStep7.createStep7Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        query: async () => [],
      },
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      calls.complete.push({ nodeId, payload });
    },
    ensureContentScriptReadyOnTab: async (source, tabId, options) => {
      calls.ensureReady.push({ source, tabId, options });
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getLoginAuthStateLabel: (snapshot) => snapshot?.state || 'unknown',
    getOAuthFlowStepTimeoutMs: async () => 30000,
    getState: async () => ({}),
    isStep6RecoverableResult: (result) => result?.step6Outcome === 'recoverable',
    isStep6SuccessResult: (result) => result?.step6Outcome === 'success',
    refreshOAuthUrlBeforeStep6: async () => {
      throw new Error('OAuth URL refresh should not run in direct ChatGPT login mode');
    },
    reuseOrCreateTab: async (source, url, options) => {
      calls.reuse.push({ source, url, options });
      return 123;
    },
    sendToContentScriptResilient: async (source, message) => {
      calls.sent.push({ source, message });
      return {
        step6Outcome: 'success',
        state: 'verification_page',
        loginVerificationRequestedAt: 12345,
      };
    },
    SIGNUP_PAGE_INJECT_FILES: injectFiles,
    STEP6_MAX_ATTEMPTS: 1,
    throwIfStopped: () => {},
    waitForTabStableComplete: async (tabId, options) => {
      calls.stable.push({ tabId, options });
    },
  });

  await executor.executeStep7({
    directChatGptLogin: true,
    email: 'alice@example.com',
    visibleStep: 2,
  });

  assert.equal(calls.reuse.length, 1);
  assert.equal(calls.reuse[0].source, 'signup-page');
  assert.equal(calls.reuse[0].url, 'https://chatgpt.com/');
  assert.deepEqual(calls.reuse[0].options, {
    forceNew: true,
    inject: injectFiles,
    injectSource: 'signup-page',
  });
  assert.equal(calls.stable[0].tabId, 123);
  assert.equal(calls.ensureReady[0].source, 'signup-page');
  assert.equal(calls.ensureReady[0].tabId, 123);
  assert.equal(calls.ensureReady[0].options.inject, injectFiles);
  assert.equal(calls.sent[0].message.payload.visibleStep, 2);
  assert.equal(calls.complete[0].nodeId, 'oauth-login');
});

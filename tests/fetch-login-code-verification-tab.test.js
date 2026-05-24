const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/fetch-login-code.js');

test('fetch-login-code recovers existing auth email verification tab when registered tab is stale', async () => {
  const calls = {
    complete: [],
    ensureReady: [],
    poll: [],
    register: [],
  };
  const executor = globalThis.MultiPageBackgroundStep8.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        query: async () => [
          { id: 888, url: 'https://auth.openai.com/email-verification' },
          { id: 123, url: 'https://chatgpt.com/' },
        ],
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      calls.complete.push({ nodeId, payload });
    },
    ensureContentScriptReadyOnTab: async (source, tabId, options) => {
      calls.ensureReady.push({ source, tabId, options });
    },
    ensureStep8VerificationPageReady: async () => {
      throw new Error('当前未进入登录验证码页面，请先重新完成步骤 2。当前状态：未知页面.');
    },
    getMailConfig: () => ({
      provider: 'hotmail',
      source: 'hotmail-api',
      label: 'Hotmail',
    }),
    getOAuthFlowStepTimeoutMs: async () => 1000,
    getTabId: async () => 123,
    HOTMAIL_PROVIDER: 'hotmail',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    registerTab: async (source, tabId) => {
      calls.register.push({ source, tabId });
    },
    resolveVerificationStep: async (step, state, mail, options) => {
      calls.poll.push({ step, state, mail, options });
    },
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    SIGNUP_PAGE_INJECT_FILES: ['content/utils.js', 'content/signup-page.js'],
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 0,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'alice@example.com',
    visibleStep: 3,
  });

  assert.deepEqual(calls.register[0], { source: 'signup-page', tabId: 888 });
  assert.equal(calls.ensureReady[0].tabId, 888);
  assert.equal(calls.poll.length, 1);
  assert.equal(calls.poll[0].step, 8);
  assert.equal(calls.complete.length, 0);
});

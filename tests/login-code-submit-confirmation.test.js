const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/verification-flow.js');

test('login code submit waits for post-submit auth state confirmation', async () => {
  const messages = [];
  const helpers = globalThis.MultiPageBackgroundVerificationFlow.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    getTabId: async () => 123,
    getState: async () => ({}),
    getHotmailVerificationPollConfig: () => ({}),
    sendToContentScript: async (_source, message) => {
      messages.push(message);
      if (message.type === 'FILL_CODE') {
        return {
          success: true,
          pendingPostSubmit: true,
          state: 'unknown',
          url: 'https://auth.openai.com/email-verification',
        };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    },
    sendToContentScriptResilient: async (_source, message) => {
      messages.push(message);
      assert.equal(message.type, 'GET_LOGIN_AUTH_STATE');
      return {
        state: 'verification_page',
        url: 'https://auth.openai.com/email-verification',
        verificationErrorText: '验证码无效',
      };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const result = await helpers.submitVerificationCode(8, '123456', {
    completionStep: 3,
    postSubmitWaitTimeoutMs: 1000,
  });

  assert.equal(result.invalidCode, true);
  assert.match(result.errorText, /验证码无效/);
  assert.deepEqual(messages.map((message) => message.type), [
    'FILL_CODE',
    'GET_LOGIN_AUTH_STATE',
  ]);
});

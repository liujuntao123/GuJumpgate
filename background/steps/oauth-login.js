(function attachBackgroundStep7(root, factory) {
  root.MultiPageBackgroundStep7 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep7Module() {
  function createStep7Executor(deps = {}) {
    const {
      addLog,
      completeNodeFromBackground,
      getErrorMessage,
      getLoginAuthStateLabel,
      getOAuthFlowStepTimeoutMs,
      getState,
      isAddPhoneAuthFailure = (error) => {
        const message = String(typeof error === 'string' ? error : error?.message || '');
        if (/\u624b\u673a\u53f7\u8f93\u5165\u6a21\u5f0f|phone\s+entry/i.test(message)) {
          return false;
        }
        return /https:\/\/auth\.openai\.com\/add-phone(?:[/?#]|$)|\badd-phone\b|\u6dfb\u52a0\u624b\u673a\u53f7|\u624b\u673a\u53f7\u7801|\u8fdb\u5165\u624b\u673a\u53f7\u9875\u9762|\u624b\u673a\u53f7\u9875|\u624b\u673a\u53f7\u9875\u9762|phone\s+number|telephone/i.test(message);
      },
      isStep6RecoverableResult,
      isStep6SuccessResult,
      chrome: chromeApi = globalThis.chrome,
      ensureContentScriptReadyOnTab,
      getTabId,
      refreshOAuthUrlBeforeStep6,
      registerTab,
      reuseOrCreateTab,
      sendToContentScriptResilient,
      startOAuthFlowTimeoutWindow,
      STEP6_MAX_ATTEMPTS,
      throwIfStopped,
      DIRECT_CHATGPT_LOGIN_URL = 'https://chatgpt.com/',
      SIGNUP_PAGE_INJECT_FILES = [],
      waitForTabStableComplete,
    } = deps;

    const DIRECT_CHATGPT_AUTH_HOSTS = new Set([
      'auth.openai.com',
      'auth0.openai.com',
      'accounts.openai.com',
    ]);
    const DIRECT_CHATGPT_ENTRY_HOSTS = new Set([
      'chatgpt.com',
      'www.chatgpt.com',
      'chat.openai.com',
    ]);

    function isManagementSecretConfigError(error) {
      const message = String(typeof error === 'string' ? error : error?.message || '').trim();
      if (!message) {
        return false;
      }

      const mentionsSecret = /管理密钥|Admin Secret|X-Admin-Key|CPA Key/i.test(message);
      if (!mentionsSecret) {
        return false;
      }

      return /缺少|未配置|请输入|无效|错误|失败|401|认证失败|未授权|unauthorized|invalid/i.test(message);
    }

    function normalizeStep7IdentifierType(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === 'phone' || normalized === 'email' ? normalized : '';
    }

    function normalizeStep7SignupMethod(value = '') {
      return String(value || '').trim().toLowerCase() === 'phone' ? 'phone' : 'email';
    }

    function shouldForceStep7EmailLogin(state = {}) {
      return normalizeStep7IdentifierType(state?.forceLoginIdentifierType) === 'email'
        || Boolean(state?.forceEmailLogin);
    }

    function canUseConfiguredPhoneSignup(state = {}) {
      return normalizeStep7SignupMethod(state?.signupMethod) === 'phone'
        && Boolean(state?.phoneVerificationEnabled)
        && !Boolean(state?.plusModeEnabled)
        && !Boolean(state?.contributionMode);
    }

    function hasStep7PhoneSignupIdentity(state = {}) {
      return Boolean(
        String(state?.signupPhoneNumber || '').trim()
        || String(state?.signupPhoneCompletedActivation?.phoneNumber || '').trim()
        || String(state?.signupPhoneActivation?.phoneNumber || '').trim()
        || (
          normalizeStep7IdentifierType(state?.accountIdentifierType) === 'phone'
          && String(state?.accountIdentifier || '').trim()
        )
      );
    }

    function shouldPreferStep7PhoneSignupIdentity(state = {}) {
      return canUseConfiguredPhoneSignup(state)
        && hasStep7PhoneSignupIdentity(state);
    }

    function resolveStep7LoginIdentifierType(state = {}, fallbackType = '') {
      if (shouldForceStep7EmailLogin(state)) {
        return 'email';
      }

      if (shouldPreferStep7PhoneSignupIdentity(state)) {
        return 'phone';
      }

      const explicitIdentifierType = normalizeStep7IdentifierType(state?.accountIdentifierType);
      if (explicitIdentifierType) {
        return explicitIdentifierType;
      }

      const frozenSignupMethod = normalizeStep7IdentifierType(state?.resolvedSignupMethod);
      if (frozenSignupMethod) {
        return frozenSignupMethod;
      }

      if (canUseConfiguredPhoneSignup(state)) {
        return 'phone';
      }

      return normalizeStep7IdentifierType(fallbackType) || 'email';
    }

    function resolveStep7FallbackEmail(state = {}) {
      const registrationEmail = String(state?.registrationEmailState?.current || '').trim();
      if (registrationEmail) {
        return registrationEmail;
      }

      const currentHotmailAccountId = String(state?.currentHotmailAccountId || '').trim();
      if (currentHotmailAccountId && Array.isArray(state?.hotmailAccounts)) {
        const matchedHotmailAccount = state.hotmailAccounts.find((account) => String(account?.id || '').trim() === currentHotmailAccountId);
        const hotmailEmail = String(matchedHotmailAccount?.email || '').trim();
        if (hotmailEmail) {
          return hotmailEmail;
        }
      }

      const currentMail2925AccountId = String(state?.currentMail2925AccountId || '').trim();
      if (currentMail2925AccountId && Array.isArray(state?.mail2925Accounts)) {
        const matchedMail2925Account = state.mail2925Accounts.find((account) => String(account?.id || '').trim() === currentMail2925AccountId);
        const mail2925Email = String(matchedMail2925Account?.email || '').trim();
        if (mail2925Email) {
          return mail2925Email;
        }
      }

      return '';
    }

    function extractAddPhoneUrl(error) {
      const message = String(typeof error === 'string' ? error : error?.message || '');
      const match = message.match(/https:\/\/auth\.openai\.com\/add-phone(?:[^\s]*)?/i);
      return match ? match[0] : 'https://auth.openai.com/add-phone';
    }

    function getStep7ResultState(result = {}) {
      return String(result?.state || '').trim();
    }

    function normalizeStep7ContentResult(result = {}) {
      if (!result || typeof result !== 'object') {
        return result;
      }
      if (result.step6Outcome || result.state || result.error) {
        return result;
      }
      if (result.payload && typeof result.payload === 'object') {
        return {
          ok: result.ok,
          ...result.payload,
        };
      }
      if (result.result && typeof result.result === 'object') {
        return {
          ok: result.ok,
          ...result.result,
        };
      }
      return result;
    }

    function isStep7OauthConsentResult(result = {}) {
      return Boolean(result?.directOAuthConsentPage)
        || getStep7ResultState(result) === 'oauth_consent_page';
    }

    function isStep7AddEmailResult(result = {}) {
      return Boolean(result?.addEmailPage) || getStep7ResultState(result) === 'add_email_page';
    }

    function isStep7AddPhoneResult(result = {}) {
      return Boolean(result?.addPhonePage) || getStep7ResultState(result) === 'add_phone_page';
    }

    function isStep7PhoneVerificationResult(result = {}) {
      return Boolean(result?.phoneVerificationPage) || getStep7ResultState(result) === 'phone_verification_page';
    }

    function isStep7PlainVerificationResult(result = {}) {
      return getStep7ResultState(result) === 'verification_page' && !isStep7PhoneVerificationResult(result);
    }

    function buildStep7CompletionPayload(result = {}, currentState = {}, currentIdentifierType = '', currentPhoneNumber = '') {
      const phoneSignupMode = currentIdentifierType === 'phone';
      const payload = {
        loginVerificationRequestedAt: result.loginVerificationRequestedAt || null,
      };

      if (currentIdentifierType === 'phone') {
        payload.accountIdentifierType = 'phone';
        payload.accountIdentifier = currentPhoneNumber;
        payload.signupPhoneNumber = currentPhoneNumber;
        payload.signupPhoneCompletedActivation = currentState?.signupPhoneCompletedActivation || null;
        payload.signupPhoneActivation = currentState?.signupPhoneActivation || null;
      }

      if (isStep7OauthConsentResult(result)) {
        payload.skipLoginVerificationStep = true;
        payload.directOAuthConsentPage = true;
        return payload;
      }

      if (phoneSignupMode) {
        if (isStep7AddPhoneResult(result)) {
          throw new Error(`步骤 ${completionStepForState(currentState)}：手机号注册模式 OAuth 登录不应进入添加手机号页。URL: ${result?.url || ''}`.trim());
        }
        if (isStep7AddEmailResult(result)) {
          payload.skipLoginVerificationStep = true;
          payload.addEmailPage = true;
          return payload;
        }
        if (isStep7PhoneVerificationResult(result)) {
          return payload;
        }
        if (isStep7PlainVerificationResult(result)) {
          throw new Error(`步骤 ${completionStepForState(currentState)}：手机号注册模式 OAuth 登录进入了普通邮箱登录验证码页，当前流程不会回落到邮箱验证码。URL: ${result?.url || ''}`.trim());
        }
        throw new Error(`步骤 ${completionStepForState(currentState)}：手机号注册模式 OAuth 登录进入了不允许的页面：${getLoginAuthStateLabel(result.state)}。URL: ${result?.url || ''}`.trim());
      }

      if (isStep7AddEmailResult(result)) {
        throw new Error(`步骤 ${completionStepForState(currentState)}：邮箱注册模式 OAuth 登录不应进入添加邮箱页。URL: ${result?.url || ''}`.trim());
      }
      if (isStep7AddPhoneResult(result) || isStep7PhoneVerificationResult(result)) {
        payload.skipLoginVerificationStep = true;
        payload.addPhonePage = isStep7AddPhoneResult(result);
        payload.phoneVerificationPage = isStep7PhoneVerificationResult(result);
        return payload;
      }
      if (isStep7PlainVerificationResult(result)) {
        return payload;
      }

      throw new Error(`步骤 ${completionStepForState(currentState)}：邮箱注册模式 OAuth 登录进入了不允许的页面：${getLoginAuthStateLabel(result.state)}。URL: ${result?.url || ''}`.trim());
    }

    function completionStepForState(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : 7;
    }

    function isDirectChatGptLoginStep(state = {}) {
      return Boolean(
        state?.directChatGptLogin
        || state?.stepDefinition?.ui?.directChatGptLogin
        || state?.nodeDefinition?.ui?.directChatGptLogin
        || state?.currentNodeDefinition?.ui?.directChatGptLogin
      );
    }

    function parseStep7Url(rawUrl = '') {
      try {
        return new URL(String(rawUrl || ''));
      } catch {
        return null;
      }
    }

    function isDirectChatGptAuthUrl(rawUrl = '') {
      const parsed = parseStep7Url(rawUrl);
      return Boolean(parsed && DIRECT_CHATGPT_AUTH_HOSTS.has(String(parsed.hostname || '').toLowerCase()));
    }

    function isDirectChatGptEntryUrl(rawUrl = '') {
      const parsed = parseStep7Url(rawUrl);
      return Boolean(parsed && DIRECT_CHATGPT_ENTRY_HOSTS.has(String(parsed.hostname || '').toLowerCase()));
    }

    async function ensureDirectChatGptLoginTabReady(tabId, completionStep, timeoutMs) {
      if (!Number.isInteger(tabId)) {
        return;
      }
      if (typeof waitForTabStableComplete === 'function') {
        await waitForTabStableComplete(tabId, {
          timeoutMs: Math.min(Math.max(15000, timeoutMs || 0), 45000),
          retryDelayMs: 300,
          stableMs: 1200,
          initialDelayMs: 300,
        });
      }
      if (typeof ensureContentScriptReadyOnTab === 'function' && Array.isArray(SIGNUP_PAGE_INJECT_FILES) && SIGNUP_PAGE_INJECT_FILES.length) {
        await ensureContentScriptReadyOnTab('signup-page', tabId, {
          inject: SIGNUP_PAGE_INJECT_FILES,
          injectSource: 'signup-page',
          timeoutMs: Math.min(Math.max(20000, timeoutMs || 0), 45000),
          retryDelayMs: 700,
          logMessage: '步骤 2：ChatGPT 官网仍在加载，正在重试连接登录脚本...',
          logStep: completionStep,
          logStepKey: 'oauth-login',
        });
      }
    }

    async function waitForDirectChatGptAuthTab(options = {}) {
      const {
        baselineTabId = null,
        timeoutMs = 15000,
        completionStep = 2,
      } = options;
      if (!chromeApi?.tabs?.query) {
        return null;
      }

      const startedAt = Date.now();
      let lastEntryTab = null;
      while (Date.now() - startedAt < timeoutMs) {
        throwIfStopped();
        const tabs = await chromeApi.tabs.query({}).catch(() => []);
        const candidates = (tabs || [])
          .filter((tab) => Number.isInteger(tab?.id))
          .filter((tab) => tab.id === baselineTabId || isDirectChatGptAuthUrl(tab.url) || isDirectChatGptEntryUrl(tab.url));

        const authTab = candidates.find((tab) => isDirectChatGptAuthUrl(tab.url));
        if (authTab) {
          if (typeof registerTab === 'function') {
            await registerTab('signup-page', authTab.id);
          }
          if (typeof ensureContentScriptReadyOnTab === 'function' && Array.isArray(SIGNUP_PAGE_INJECT_FILES) && SIGNUP_PAGE_INJECT_FILES.length) {
            await ensureContentScriptReadyOnTab('signup-page', authTab.id, {
              inject: SIGNUP_PAGE_INJECT_FILES,
              injectSource: 'signup-page',
              timeoutMs: 20000,
              retryDelayMs: 700,
              logMessage: '步骤 2：认证页已打开，正在等待登录脚本就绪...',
              logStep: completionStep,
              logStepKey: 'oauth-login',
            });
          }
          return authTab.id;
        }

        if (!lastEntryTab) {
          lastEntryTab = candidates.find((tab) => tab.id === baselineTabId && isDirectChatGptEntryUrl(tab.url)) || null;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      return lastEntryTab?.id || null;
    }

    async function inspectStep7LoginAuthState(completionStep, timeoutMs = 12000) {
      if (typeof sendToContentScriptResilient !== 'function') {
        return null;
      }
      const boundedTimeoutMs = Math.max(1000, Math.min(Number(timeoutMs) || 12000, 20000));
      const result = await sendToContentScriptResilient(
        'signup-page',
        {
          type: 'GET_LOGIN_AUTH_STATE',
          source: 'background',
          payload: {},
        },
        {
          timeoutMs: boundedTimeoutMs,
          responseTimeoutMs: boundedTimeoutMs,
          retryDelayMs: 600,
          logMessage: '步骤 2：登录页结果未直接识别，正在复核当前认证页状态...',
          logStep: completionStep,
          logStepKey: 'oauth-login',
        }
      );
      return normalizeStep7ContentResult(result || {});
    }

    function buildStep7SuccessResultFromAuthState(authState = {}, options = {}) {
      const state = getStep7ResultState(authState);
      if (!state) {
        return null;
      }
      if (
        state !== 'verification_page'
        && state !== 'phone_verification_page'
        && state !== 'oauth_consent_page'
        && state !== 'add_email_page'
        && state !== 'add_phone_page'
      ) {
        return null;
      }
      return {
        step6Outcome: 'success',
        ...authState,
        state,
        url: authState?.url || '',
        via: options.via || `auth_state_${state}`,
        loginVerificationRequestedAt: options.loginVerificationRequestedAt || authState?.loginVerificationRequestedAt || null,
        ...(state === 'phone_verification_page' ? { phoneVerificationPage: true } : {}),
        ...(state === 'oauth_consent_page' ? { skipLoginVerificationStep: true, directOAuthConsentPage: true } : {}),
        ...(state === 'add_email_page' ? { addEmailPage: true } : {}),
        ...(state === 'add_phone_page' ? { addPhonePage: true, skipLoginVerificationStep: true } : {}),
      };
    }

    async function completeStep7PostLoginPhoneHandoff(state = {}, err, completionStep) {
      if (normalizeStep7SignupMethod(state?.resolvedSignupMethod || state?.signupMethod) === 'phone') {
        throw new Error(
          `步骤 ${completionStep}：手机号注册模式 OAuth 登录进入了添加手机号页，当前流程不允许在手机号注册模式补手机号。URL: ${extractAddPhoneUrl(err)}`
        );
      }
      await completeNodeFromBackground(state?.nodeId || 'oauth-login', {
        loginVerificationRequestedAt: null,
        skipLoginVerificationStep: true,
        addPhonePage: true,
        directOAuthConsentPage: false,
      });
    }

    async function executeStep7(state) {
      const initialState = typeof getState === 'function'
        ? {
          ...(state || {}),
          ...(await getState().catch(() => ({}))),
        }
        : (state || {});
      const visibleStep = Math.floor(Number(initialState?.visibleStep) || 0);
      const completionStep = visibleStep > 0 ? visibleStep : 7;
      const resolvedIdentifierType = resolveStep7LoginIdentifierType(initialState);
      const phoneNumber = resolvedIdentifierType === 'phone'
        ? String(
          initialState?.signupPhoneNumber
          || (normalizeStep7IdentifierType(initialState?.accountIdentifierType) === 'phone' ? initialState?.accountIdentifier : '')
          || initialState?.signupPhoneCompletedActivation?.phoneNumber
          || initialState?.signupPhoneActivation?.phoneNumber
          || ''
        ).trim()
        : '';
      const email = resolvedIdentifierType === 'email'
        ? String(
          initialState?.email
          || (normalizeStep7IdentifierType(initialState?.accountIdentifierType) === 'email' ? initialState?.accountIdentifier : '')
          || resolveStep7FallbackEmail(initialState)
          || ''
        ).trim()
        : '';
      if (
        (resolvedIdentifierType === 'phone' && !phoneNumber)
        || (resolvedIdentifierType !== 'phone' && !email)
      ) {
        throw new Error('缺少登录账号：请先完成步骤 2，或在侧栏“注册邮箱/注册手机号”中手动填写账号后再执行当前步骤。');
      }

      let attempt = 0;
      let lastError = null;

      while (attempt < STEP6_MAX_ATTEMPTS) {
        throwIfStopped();
        attempt += 1;
        try {
          const rawCurrentState = attempt === 1 ? initialState : await getState();
          const currentState = shouldForceStep7EmailLogin(state)
            ? {
              ...rawCurrentState,
              forceLoginIdentifierType: 'email',
              forceEmailLogin: true,
              signupMethod: 'email',
              resolvedSignupMethod: 'email',
              accountIdentifierType: 'email',
              accountIdentifier: email,
              email,
            }
            : rawCurrentState;
          const password = currentState.password || currentState.customPassword || '';
          const currentIdentifierType = resolveStep7LoginIdentifierType(currentState, resolvedIdentifierType);
          const currentPhoneNumber = currentIdentifierType === 'phone'
            ? String(
              currentState?.signupPhoneNumber
              || (normalizeStep7IdentifierType(currentState?.accountIdentifierType) === 'phone' ? currentState?.accountIdentifier : '')
              || currentState?.signupPhoneCompletedActivation?.phoneNumber
              || currentState?.signupPhoneActivation?.phoneNumber
              || phoneNumber
            ).trim()
            : '';
          const currentEmail = currentIdentifierType === 'email'
            ? String(
              currentState?.email
              || (normalizeStep7IdentifierType(currentState?.accountIdentifierType) === 'email' ? currentState?.accountIdentifier : '')
              || resolveStep7FallbackEmail(currentState)
              || email
            ).trim()
            : '';
          const accountIdentifier = currentIdentifierType === 'phone'
            ? currentPhoneNumber
            : currentEmail;
          const directChatGptLogin = isDirectChatGptLoginStep(currentState);
          const oauthUrl = directChatGptLogin
            ? DIRECT_CHATGPT_LOGIN_URL
            : await refreshOAuthUrlBeforeStep6(currentState);
          if (!directChatGptLogin && typeof startOAuthFlowTimeoutWindow === 'function') {
            await startOAuthFlowTimeoutWindow({ step: completionStep, oauthUrl });
          }
          const loginTimeoutMs = typeof getOAuthFlowStepTimeoutMs === 'function'
            ? await getOAuthFlowStepTimeoutMs(180000, {
              step: completionStep,
              actionLabel: 'OAuth 登录并进入验证码页',
              oauthUrl,
            })
            : 180000;

          if (attempt === 1) {
            await addLog(directChatGptLogin ? '正在打开 ChatGPT 官网并登录...' : '正在打开最新 OAuth 链接并登录...', 'info', {
              step: completionStep,
              stepKey: 'oauth-login',
            });
          } else {
            await addLog(`上一轮失败后，正在进行第 ${attempt} 次尝试（最多 ${STEP6_MAX_ATTEMPTS} 次）...`, 'warn', {
              step: completionStep,
              stepKey: 'oauth-login',
            });
          }

          const loginTabId = await reuseOrCreateTab('signup-page', oauthUrl, directChatGptLogin
            ? {
              forceNew: true,
              inject: SIGNUP_PAGE_INJECT_FILES,
              injectSource: 'signup-page',
            }
            : { forceNew: true });

          if (directChatGptLogin) {
            await ensureDirectChatGptLoginTabReady(loginTabId, completionStep, loginTimeoutMs);
          }

          const loginMessage = {
            type: 'EXECUTE_NODE',
            nodeId: 'oauth-login',
            step: 7,
            source: 'background',
            payload: {
              email: currentEmail,
              phoneNumber: currentPhoneNumber,
              countryId: currentState?.signupPhoneCompletedActivation?.countryId
                ?? currentState?.signupPhoneActivation?.countryId
                ?? null,
              countryLabel: String(
                currentState?.signupPhoneCompletedActivation?.countryLabel
                || currentState?.signupPhoneActivation?.countryLabel
                || ''
              ).trim(),
              accountIdentifier,
              loginIdentifierType: currentIdentifierType,
              password,
              visibleStep: completionStep,
            },
          };

          let result = normalizeStep7ContentResult(await sendToContentScriptResilient(
            'signup-page',
            loginMessage,
            {
              timeoutMs: loginTimeoutMs,
              responseTimeoutMs: loginTimeoutMs,
              retryDelayMs: 700,
              logMessage: '认证页正在切换，等待页面重新就绪后继续登录...',
              logStep: completionStep,
              logStepKey: 'oauth-login',
            }
          ));

          if (directChatGptLogin && result?.step6Outcome === 'recoverable' && result?.reason === 'direct_chatgpt_auth_tab_pending') {
            const authTabId = await waitForDirectChatGptAuthTab({
              baselineTabId: loginTabId,
              timeoutMs: Math.min(20000, Math.max(5000, loginTimeoutMs)),
              completionStep,
            });
            if (authTabId) {
              result = normalizeStep7ContentResult(await sendToContentScriptResilient(
                'signup-page',
                loginMessage,
                {
                  timeoutMs: loginTimeoutMs,
                  responseTimeoutMs: loginTimeoutMs,
                  retryDelayMs: 700,
                  logMessage: '认证页正在切换，等待页面重新就绪后继续登录...',
                  logStep: completionStep,
                  logStepKey: 'oauth-login',
                }
              ));
            }
          }

          if (result?.error) {
            throw new Error(result.error);
          }

          if (isStep6SuccessResult(result)) {
            const completionPayload = buildStep7CompletionPayload(
              result,
              { ...(currentState || {}), visibleStep: completionStep },
              currentIdentifierType,
              currentPhoneNumber
            );

            await completeNodeFromBackground(state?.nodeId || 'oauth-login', completionPayload);
            return;
          }

          if (isStep6RecoverableResult(result)) {
            const reasonMessage = result.message
              || `当前停留在${getLoginAuthStateLabel(result.state)}，准备重新执行步骤 ${completionStep}。`;
            throw new Error(reasonMessage);
          }

          const inspectedAuthState = await inspectStep7LoginAuthState(completionStep, Math.min(12000, loginTimeoutMs));
          if (inspectedAuthState?.error) {
            throw new Error(inspectedAuthState.error);
          }
          const inspectedSuccessResult = buildStep7SuccessResultFromAuthState(inspectedAuthState, {
            via: 'post_unrecognized_result_auth_state',
          });
          if (inspectedSuccessResult && isStep6SuccessResult(inspectedSuccessResult)) {
            await addLog(
              `步骤 ${completionStep}：登录响应未直接识别，但复核当前页面已进入${getLoginAuthStateLabel(inspectedSuccessResult)}，按成功进入验证码/后续页面处理。`,
              'warn',
              { step: completionStep, stepKey: 'oauth-login' }
            );
            const completionPayload = buildStep7CompletionPayload(
              inspectedSuccessResult,
              { ...(currentState || {}), visibleStep: completionStep },
              currentIdentifierType,
              currentPhoneNumber
            );

            await completeNodeFromBackground(state?.nodeId || 'oauth-login', completionPayload);
            return;
          }

          throw new Error(`步骤 ${completionStep}：认证页未返回可识别的登录结果。`);
        } catch (err) {
          throwIfStopped(err);
          if (isAddPhoneAuthFailure(err)) {
            const latestAddPhoneState = typeof getState === 'function'
              ? await getState().catch(() => state)
              : state;
            await completeStep7PostLoginPhoneHandoff(
              { ...(state || {}), ...(latestAddPhoneState || {}) },
              err,
              completionStep
            );
            return;
          }
          if (isManagementSecretConfigError(err)) {
            await addLog(
              `检测到来源后台管理密钥缺失或错误，不再重试，当前流程停止。原因：${getErrorMessage(err)}`,
              'error',
              { step: completionStep, stepKey: 'oauth-login' }
            );
            throw err;
          }
          lastError = err;
          if (attempt >= STEP6_MAX_ATTEMPTS) {
            break;
          }

          await addLog(`第 ${attempt} 次尝试失败，原因：${getErrorMessage(err)}；准备重试...`, 'warn', {
            step: completionStep,
            stepKey: 'oauth-login',
          });
        }
      }

      throw new Error(`步骤 ${completionStep}：判断失败后已重试 ${STEP6_MAX_ATTEMPTS - 1} 次，仍未成功。最后原因：${getErrorMessage(lastError)}`);
    }

    return { executeStep7 };
  }

  return { createStep7Executor };
});

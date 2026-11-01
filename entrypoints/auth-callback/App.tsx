import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { t, type MessageKey } from '@/src/i18n';
import { MANAGE_USAGE_URL, type SignInFailure, type SignInResult } from '@/src/messaging/ai';
import type { Client } from '@/src/messaging/client';

const FAILURES: Readonly<Record<SignInFailure, MessageKey>> = {
  expired: 'callbackExpired',
  'state-mismatch': 'callbackStateMismatch',
  denied: 'callbackDenied',
  'no-client-id': 'callbackNoClientId',
  'client-mismatch': 'callbackClientMismatch',
  'account-mismatch': 'callbackAccountMismatch',
  'exchange-failed': 'callbackExchangeFailed',
  'invalid-token': 'callbackInvalidToken',
  network: 'callbackNetwork',
};

type View =
  | { state: 'working' }
  | { state: 'nothing' }
  | { state: 'done'; result: SignInResult }
  | { state: 'error'; message: string };

/** One exchange per page load, also when StrictMode runs effects twice. */
let started: Promise<SignInResult> | undefined;

function closeTab(): void {
  browser.tabs.getCurrent().then(
    (tab) => {
      if (tab?.id !== undefined) void browser.tabs.remove(tab.id);
      else window.close();
    },
    () => window.close(),
  );
}

function openSettings(): void {
  void browser.runtime.openOptionsPage().then(closeTab);
}

/**
 * Where OpenAI's loopback redirect lands (a DNR rule sends it here, ADR 0003): hands the query
 * to the service worker, which exchanges the code. On success, the one-time notice OpenAI's
 * UI/UX guidelines ask for: "You're using your ChatGPT plan".
 */
export function App({ client, search }: { client: Client; search: string }) {
  const hasCallback = new URLSearchParams(search).has('state');
  const [view, setView] = useState<View>(hasCallback ? { state: 'working' } : { state: 'nothing' });

  useEffect(() => {
    if (!hasCallback) return;
    started ??= client.request('account/callback', { search }, { timeoutMs: 60_000 });
    started.then(
      (result) => setView({ state: 'done', result }),
      (error: unknown) =>
        setView({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }, [client, search, hasCallback]);

  let body;
  if (view.state === 'working') {
    body = <p className="page__empty">{t('callbackWorking')}</p>;
  } else if (view.state === 'nothing') {
    body = (
      <>
        <p>{t('callbackNothing')}</p>
        <button type="button" className="phasa-button" onClick={openSettings}>
          {t('callbackOpenSettings')}
        </button>
      </>
    );
  } else if (view.state === 'error') {
    body = (
      <>
        <p className="page__error">{t('callbackFailed', view.message)}</p>
        <button type="button" className="phasa-button" onClick={openSettings}>
          {t('callbackOpenSettings')}
        </button>
      </>
    );
  } else if (view.result.ok && view.result.planUsage) {
    body = (
      <>
        <p className="callback__ok" data-testid="phasa-callback-ok">
          {view.result.email ? t('callbackConnectedAs', view.result.email) : t('callbackConnected')}
        </p>
        <div className="callback__notice" role="note">
          <h2>{t('callbackPlanTitle')}</h2>
          <p>{t('callbackPlanText')}</p>
          <div className="callback__actions">
            <button type="button" className="phasa-button phasa-button--primary" onClick={closeTab}>
              {t('callbackGotIt')}
            </button>
            <a href={MANAGE_USAGE_URL} target="_blank" rel="noreferrer">
              {t('aiManageUsage')}
            </a>
          </div>
        </div>
      </>
    );
  } else if (view.result.ok) {
    body = (
      <>
        <p className="callback__ok" data-testid="phasa-callback-ok">
          {view.result.email ? t('callbackConnectedAs', view.result.email) : t('callbackConnected')}
        </p>
        <p className="page__error" data-testid="phasa-callback-no-plan">
          {t('callbackNoPlan')}
        </p>
        <button type="button" className="phasa-button" onClick={openSettings}>
          {t('callbackOpenSettings')}
        </button>
      </>
    );
  } else {
    const { reason, detail } = view.result;
    body = (
      <>
        <p className="page__error" data-testid="phasa-callback-error" data-reason={reason}>
          {t(FAILURES[reason])}
        </p>
        {detail && <p className="callback__detail">{detail}</p>}
        <button type="button" className="phasa-button" onClick={openSettings}>
          {t('callbackOpenSettings')}
        </button>
      </>
    );
  }

  return (
    <main className="page page--callback" data-testid="phasa-callback" data-state={view.state}>
      <h1>{t('callbackHeading')}</h1>
      {body}
    </main>
  );
}

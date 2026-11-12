/**
 * Options → AI: Sign in with ChatGPT, the user's own API key, which one to use, and models
 * (docs/plan.md §8, §12 phase 5; ADR 0003, ADR 0014). Tokens and the key stay in the service
 * worker: this page sees the email and a key hint only.
 */
import { useEffect, useRef, useState } from 'react';
import { defaultPlanModel } from '@/src/ai/models';
import { t } from '@/src/i18n';
import type { AccountView, AiModel, AiProviderId } from '@/src/messaging/ai';
import type { Client } from '@/src/messaging/client';
import type { Settings } from '@/src/settings';
import { ManageUsageLink } from '@/src/ui/ai/AiAnswer';
import { ContinueWithChatGpt } from '@/src/ui/ai/ContinueWithChatGpt';
import { useAccount } from '@/src/ui/ai/useAccount';
import { useSettings } from '@/src/ui/useSettings';

type ModelList = { state: 'loading' } | { state: 'ready'; models: AiModel[] } | { state: 'error' };

function useModels(client: Client, provider: AiProviderId, enabled: boolean): ModelList {
  const [stored, setStored] = useState<{ provider: AiProviderId; list: ModelList } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    client.request('account/models', { provider }, { timeoutMs: 30_000 }).then(
      (result) => {
        if (!active) return;
        setStored({
          provider,
          list: 'models' in result ? { state: 'ready', models: result.models } : { state: 'error' },
        });
      },
      () => {
        if (active) setStored({ provider, list: { state: 'error' } });
      },
    );
    return () => {
      active = false;
    };
  }, [client, provider, enabled]);
  return stored?.provider === provider ? stored.list : { state: 'loading' };
}

function ModelPicker({
  list,
  value,
  onChange,
  defaultLabel,
  testId,
}: {
  list: ModelList;
  value: string;
  onChange: (slug: string) => void;
  /** The empty choice: the default model for the plan, "choose one" for the key. */
  defaultLabel: string;
  testId: string;
}) {
  if (list.state === 'error') {
    return (
      <label className="select">
        {t('accountModel')}
        <input
          type="text"
          className="search"
          value={value}
          placeholder={t('accountModelTyped')}
          onChange={(event) => onChange(event.target.value.trim())}
          data-testid={testId}
        />
        <span className="account__muted">{t('accountModelsFailed')}</span>
      </label>
    );
  }
  const models = list.state === 'ready' ? list.models : [];
  const known = value === '' || models.some((model) => model.slug === value);
  return (
    <label className="select">
      {t('accountModel')}
      <select
        value={value}
        disabled={list.state === 'loading'}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      >
        <option value="">{defaultLabel}</option>
        {!known && <option value={value}>{value}</option>}
        {models.map((model) => (
          <option key={model.slug} value={model.slug}>
            {model.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Forget account" behind a confirmation: the next sign-in registers Phasa again. */
function ForgetAccount({ busy, onForget }: { busy: boolean; onForget: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className="link-button"
        onClick={() => setConfirming(true)}
        data-testid="phasa-account-forget"
      >
        {t('accountForget')}
      </button>
    );
  }
  return (
    <>
      <span>{t('accountForgetConfirm')}</span>
      <button
        type="button"
        className="phasa-button"
        disabled={busy}
        onClick={() => {
          setConfirming(false);
          onForget();
        }}
      >
        {t('accountForget')}
      </button>
      <button type="button" className="link-button" onClick={() => setConfirming(false)}>
        {t('actionCancel')}
      </button>
    </>
  );
}

function ChatGptBlock({
  client,
  view,
  settings,
  update,
}: {
  client: Client;
  view: AccountView;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const chatgpt = view.chatgpt;
  const signedIn = chatgpt.state === 'signed-in';
  const models = useModels(client, 'chatgpt-plan', signedIn && chatgpt.planUsage);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const signIn = () => {
    setBusy(true);
    setNotice(null);
    client.request('account/sign-in', {}).then(
      () => setBusy(false),
      () => {
        setBusy(false);
        setNotice(t('accountSignInFailed'));
      },
    );
  };
  const signOut = (forget: boolean) => {
    setBusy(true);
    client.request(forget ? 'account/forget' : 'account/sign-out', {}, { timeoutMs: 30_000 }).then(
      ({ revoked }) => {
        setBusy(false);
        setNotice(revoked ? null : t('accountRevokeUnconfirmed'));
      },
      () => {
        setBusy(false);
        setNotice(t('accountSignOutFailed'));
      },
    );
  };
  const fallback = models.state === 'ready' ? defaultPlanModel(models.models) : undefined;

  return (
    <div className="account__block" data-testid="phasa-account-chatgpt" data-state={chatgpt.state}>
      <h3>{t('accountChatGptTitle')}</h3>
      {signedIn ? (
        <>
          <p data-testid="phasa-account-email">
            {chatgpt.email ? t('accountSignedInAs', chatgpt.email) : t('accountSignedIn')}
          </p>
          {chatgpt.planUsage ? (
            <>
              <p className="account__muted">
                {t('aiUsingPlan')} · <ManageUsageLink />
              </p>
              <div className="account__row">
                <ModelPicker
                  list={models}
                  value={settings.aiModelChatGpt}
                  onChange={(slug) => update({ aiModelChatGpt: slug })}
                  defaultLabel={
                    fallback
                      ? t('accountModelDefault', fallback.displayName)
                      : t('accountModelDefaultPlain')
                  }
                  testId="phasa-account-model-plan"
                />
              </div>
            </>
          ) : (
            <>
              <p className="page__error" data-testid="phasa-account-no-plan">
                {t('accountNoPlan')}
              </p>
              <div className="account__row">
                <ContinueWithChatGpt onClick={signIn} busy={busy} />
              </div>
            </>
          )}
          <div className="account__row">
            <button
              type="button"
              className="phasa-button"
              disabled={busy}
              onClick={() => signOut(false)}
              data-testid="phasa-account-sign-out"
            >
              {t('accountSignOut')}
            </button>
            <ForgetAccount busy={busy} onForget={() => signOut(true)} />
          </div>
          <p className="account__muted">{t('accountSignOutHint')}</p>
        </>
      ) : (
        <>
          {chatgpt.state === 'needs-sign-in' && (
            <p className="page__error" data-testid="phasa-account-needs-sign-in">
              {t('accountNeedsSignIn')}
            </p>
          )}
          <p>{chatgpt.registered ? t('accountReturning') : t('accountFirstSignIn')}</p>
          {!chatgpt.registered && <p className="account__muted">{t('accountUnverified')}</p>}
          <div className="account__row">
            <ContinueWithChatGpt onClick={signIn} busy={busy} />
          </div>
          {chatgpt.pending && (
            <p className="account__muted" role="status" data-testid="phasa-account-pending">
              {t('accountPending')}
            </p>
          )}
          {chatgpt.registered && (
            <div className="account__row account__secondary">
              <ForgetAccount busy={busy} onForget={() => signOut(true)} />
            </div>
          )}
        </>
      )}
      {notice && (
        <p className="account__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

const KEY_ERRORS = {
  'invalid-key': 'accountKeyInvalid',
  network: 'accountKeyNetwork',
  failed: 'accountKeyFailed',
} as const;

function ApiKeyBlock({
  client,
  view,
  settings,
  update,
}: {
  client: Client;
  view: AccountView;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const [key, setKey] = useState('');
  const [state, setState] = useState<
    { state: 'idle' } | { state: 'checking' } | { state: 'error'; error: keyof typeof KEY_ERRORS }
  >({ state: 'idle' });
  const models = useModels(client, 'openai-api-key', view.apiKey.set);

  const save = () => {
    setState({ state: 'checking' });
    client.request('account/set-api-key', { key }, { timeoutMs: 30_000 }).then(
      (result) => {
        if (result.ok) {
          setKey('');
          setState({ state: 'idle' });
        } else setState({ state: 'error', error: result.error });
      },
      () => setState({ state: 'error', error: 'failed' }),
    );
  };
  const remove = () => {
    client.request('account/set-api-key', { key: null }).catch(() => undefined);
    update({ aiModelApiKey: '' });
  };

  return (
    <div className="account__block" data-testid="phasa-account-key">
      <h3>{t('accountKeyTitle')}</h3>
      <p>{t('accountKeyIntro')}</p>
      {view.apiKey.set ? (
        <>
          <div className="account__row">
            <span data-testid="phasa-account-key-hint">
              {t('accountKeySaved', view.apiKey.hint ?? '')}
            </span>
            <button type="button" className="link-button" onClick={remove}>
              {t('accountKeyRemove')}
            </button>
          </div>
          <div className="account__row">
            <ModelPicker
              list={models}
              value={settings.aiModelApiKey}
              onChange={(slug) => update({ aiModelApiKey: slug })}
              defaultLabel={t('accountModelChoose')}
              testId="phasa-account-model-key"
            />
          </div>
          {!settings.aiModelApiKey && <p className="account__muted">{t('accountModelNeeded')}</p>}
        </>
      ) : (
        <form
          className="account__row"
          onSubmit={(event) => {
            event.preventDefault();
            if (key.trim()) save();
          }}
        >
          <input
            type="password"
            className="search account__key"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            aria-label={t('accountKeyTitle')}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            data-testid="phasa-account-key-input"
          />
          <button
            type="submit"
            className="phasa-button"
            disabled={state.state === 'checking' || !key.trim()}
          >
            {state.state === 'checking' ? t('accountKeyChecking') : t('accountKeySave')}
          </button>
        </form>
      )}
      {state.state === 'error' && <p className="page__error">{t(KEY_ERRORS[state.error])}</p>}
    </div>
  );
}

function ProviderBlock({
  view,
  settings,
  update,
}: {
  view: AccountView;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const keyUsable = view.apiKey.set && settings.aiModelApiKey !== '';
  return (
    <div className="account__block" data-testid="phasa-account-provider">
      <h3>{t('accountProviderTitle')}</h3>
      <div className="account__choices" role="radiogroup">
        <label className="toggle">
          <input
            type="radio"
            name="ai-provider"
            checked={settings.aiProvider === 'chatgpt-plan'}
            onChange={() => update({ aiProvider: 'chatgpt-plan' })}
          />
          {t('accountProviderPlan')}
        </label>
        <label className="toggle">
          <input
            type="radio"
            name="ai-provider"
            checked={settings.aiProvider === 'openai-api-key'}
            onChange={() => update({ aiProvider: 'openai-api-key' })}
          />
          {t('accountProviderKey')}
        </label>
      </div>
      {settings.aiProvider === 'chatgpt-plan' && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.aiFallbackToApiKey}
            disabled={!keyUsable && !settings.aiFallbackToApiKey}
            onChange={(event) => update({ aiFallbackToApiKey: event.target.checked })}
            data-testid="phasa-account-fallback"
          />
          {t('accountFallback')}
        </label>
      )}
      <p
        className="account__status"
        data-testid="phasa-account-status"
        data-ready={view.status.ready}
      >
        {view.status.ready
          ? t(view.status.provider === 'chatgpt-plan' ? 'accountReadyPlan' : 'accountReadyKey')
          : t('accountNotReady')}
      </p>
    </div>
  );
}

/** Development builds: try the token refresh without waiting an hour. */
function DevBlock({ client }: { client: Client }) {
  const [done, setDone] = useState(false);
  return (
    <div className="account__block">
      <h3>{t('accountDevTitle')}</h3>
      <button
        type="button"
        className="phasa-button"
        onClick={() => {
          void client.request('account/expire-token', {}).then(() => setDone(true));
        }}
      >
        {t('accountDevExpire')}
      </button>
      {done && <p className="account__muted">{t('accountDevExpired')}</p>}
    </div>
  );
}

export function Account({ client }: { client: Client }) {
  const { view } = useAccount(client);
  const { settings, update } = useSettings(client);
  const sectionRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);

  // Opened from a popup's "AI settings": the section is rendered only now, after the hash.
  useEffect(() => {
    if (!view || scrolled.current || location.hash !== '#ai') return;
    scrolled.current = true;
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [view]);

  return (
    <section
      ref={sectionRef}
      id="ai"
      className="page__section account"
      data-testid="phasa-options-account"
    >
      <h2>{t('optionsSectionAccount')}</h2>
      <p>{t('accountIntro')}</p>
      {view ? (
        <>
          <ChatGptBlock client={client} view={view} settings={settings} update={update} />
          <ApiKeyBlock client={client} view={view} settings={settings} update={update} />
          <ProviderBlock view={view} settings={settings} update={update} />
          {import.meta.env.DEV && <DevBlock client={client} />}
        </>
      ) : (
        <p className="page__empty">{t('statusConnecting')}</p>
      )}
    </section>
  );
}

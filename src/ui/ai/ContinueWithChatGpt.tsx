import { browser } from 'wxt/browser';
import { t } from '../../i18n';

/** "Continue with ChatGPT": OpenAI's approved button, label and logo (src/ui/ai.css). */
export function ContinueWithChatGpt({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      className="phasa-siwc"
      data-oai-siwc-button=""
      data-testid="phasa-siwc-button"
      disabled={busy}
      onClick={onClick}
    >
      <img
        className="phasa-siwc__logo phasa-siwc__logo--light"
        src={browser.runtime.getURL('/brand/chatgpt-logo-white.svg')}
        alt=""
        width={20}
        height={20}
      />
      <img
        className="phasa-siwc__logo phasa-siwc__logo--dark"
        src={browser.runtime.getURL('/brand/chatgpt-logo-black.svg')}
        alt=""
        width={20}
        height={20}
      />
      {t('accountContinueWithChatGpt')}
    </button>
  );
}

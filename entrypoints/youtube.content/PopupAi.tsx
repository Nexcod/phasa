import { t } from '@/src/i18n';
import type { AiLineContext, AiStatus } from '@/src/messaging/ai';
import type { Client } from '@/src/messaging/client';
import { AiAnswer, AiSection } from '@/src/ui/ai/AiAnswer';

/** What a popup needs for AI: answers come from the service worker, never credentials. */
export interface PopupAi {
  client: Client;
  status: AiStatus | null;
  /** The line the popup was opened from; none while captions aren't ready. */
  context: AiLineContext | undefined;
  openSettings: () => void;
}

/** "Explain in context (AI)" and "Translate the line (AI)" for a word or phrase (plan §2.1). */
export function PopupAiSection({ ai, word }: { ai: PopupAi; word: string }) {
  const context = ai.context;
  if (!context) return null;
  return (
    <div className="phasa-popup__section">
      <AiSection status={ai.status}>
        <AiAnswer
          client={ai.client}
          kind="explain"
          params={{ ...context, word }}
          questionKey={`${word}\n${context.line.text}`}
          label={t('aiExplain')}
          onOpenSettings={ai.openSettings}
        />
        <AiAnswer
          client={ai.client}
          kind="translate"
          params={context}
          questionKey={context.line.text}
          label={t('aiTranslateLine')}
          onOpenSettings={ai.openSettings}
        />
      </AiSection>
    </div>
  );
}

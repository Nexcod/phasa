/**
 * The ChatGPT plan's default model (ADR 0015): GPT-6-Luna when OpenAI lists it for the account,
 * otherwise the first model listed (ADR 0014). Shared by the service worker and the options page.
 */
import type { AiModel } from '../messaging/ai';

export const PREFERRED_PLAN_MODEL = 'GPT-6-Luna';

export function defaultPlanModel(models: readonly AiModel[]): AiModel | undefined {
  return models.find((model) => model.slug === PREFERRED_PLAN_MODEL) ?? models[0];
}

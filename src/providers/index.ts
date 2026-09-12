import { geminiProvider } from "./gemini";
import { modelOrDefault } from "./models";
import { openAIProvider } from "./openai";
import { ProviderError, type ImageProvider } from "./types";

export { providerIds } from "./models";

const PROVIDERS: Record<string, ImageProvider> = {
  [openAIProvider.id]: openAIProvider,
  [geminiProvider.id]: geminiProvider
};

export function getProvider(id: string): ImageProvider {
  const provider = PROVIDERS[id];

  if (!provider) {
    throw new ProviderError("invalid_request", `unknown image provider: ${id}`, {
      provider: id
    });
  }

  return provider;
}

/** Which provider owns a given model, so a job only needs to carry the model. */
export function providerForModel(modelId: string): ImageProvider {
  return getProvider(modelOrDefault(modelId).provider);
}

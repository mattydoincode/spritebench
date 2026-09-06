import { modelOrDefault } from "./models";
import { openAIProvider } from "./openai";
import { ProviderError, type ImageProvider } from "./types";

const PROVIDERS: Record<string, ImageProvider> = {
  [openAIProvider.id]: openAIProvider
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

export function providerIds(): string[] {
  return Object.keys(PROVIDERS);
}

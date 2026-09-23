// The reasoning effort levels OpenRouter accepts on a chat completion.
export const modelEfforts = ["minimal", "low", "medium", "high"] as const;
export type ModelEffort = (typeof modelEfforts)[number];

export const defaultModelEffort: ModelEffort = "medium";

export function isModelEffort(value: string): value is ModelEffort {
  return (modelEfforts as readonly string[]).includes(value);
}

// Where a model's requests are sent: OpenRouter's API, or the Codex backend
// using the signed-in ChatGPT subscription.
export const modelProviders = ["openrouter", "chatgpt"] as const;
export type ModelProvider = (typeof modelProviders)[number];

export const modelProviderNames: Record<ModelProvider, string> = {
  openrouter: "OpenRouter",
  chatgpt: "ChatGPT subscription",
};

export function isModelProvider(value: string): value is ModelProvider {
  return (modelProviders as readonly string[]).includes(value);
}

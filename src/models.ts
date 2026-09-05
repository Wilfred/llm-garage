export const modelCatalog = [
  {
    id: "openai/gpt-5.2",
    name: "GPT-5.2",
    provider: "OpenAI",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    provider: "Google",
  },
] as const;

export type ModelId = (typeof modelCatalog)[number]["id"];

export function isModelId(value: string): value is ModelId {
  return modelCatalog.some((model) => model.id === value);
}

export function getModel(modelId: ModelId): (typeof modelCatalog)[number] {
  return modelCatalog.find((model) => model.id === modelId)!;
}

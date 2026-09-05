export const modelCatalog = [
  {
    id: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    provider: "OpenAI",
  },
  {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    provider: "Anthropic",
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    provider: "MoonshotAI",
  },
  {
    id: "z-ai/glm-5.2",
    name: "GLM 5.2",
    provider: "Z.ai",
  },
] as const;

export type ModelId = (typeof modelCatalog)[number]["id"];

export function isModelId(value: string): value is ModelId {
  return modelCatalog.some((model) => model.id === value);
}

export function getModel(modelId: ModelId): (typeof modelCatalog)[number] {
  const model = modelCatalog.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return model;
}

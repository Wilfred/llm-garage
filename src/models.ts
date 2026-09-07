// The reasoning effort levels OpenRouter accepts on a chat completion.
export const modelEfforts = ["minimal", "low", "medium", "high"] as const;
export type ModelEffort = (typeof modelEfforts)[number];

export const defaultModelEffort: ModelEffort = "medium";

export function isModelEffort(value: string): value is ModelEffort {
  return (modelEfforts as readonly string[]).includes(value);
}

import type { Model, Repo } from "./types";

const starterRepos: Array<Omit<Repo, "createdAt"> & { ageMinutes: number }> = [
  {
    id: "repo-garage",
    owner: "Wilfred",
    name: "llm-garage",
    defaultBranch: "main",
    autoMerge: true,
    ageMinutes: 9_000,
  },
  {
    id: "repo-parser",
    owner: "Wilfred",
    name: "tree-sitter-elisp",
    defaultBranch: "master",
    autoMerge: false,
    ageMinutes: 8_000,
  },
  {
    id: "repo-notes",
    owner: "Wilfred",
    name: "digital-garden",
    defaultBranch: "main",
    autoMerge: false,
    ageMinutes: 7_000,
  },
];

const starterModels: Array<Omit<Model, "createdAt">> = [
  {
    id: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    provider: "OpenAI",
    effort: "medium",
  },
  {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    provider: "Anthropic",
    effort: "medium",
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    provider: "MoonshotAI",
    effort: "medium",
  },
  {
    id: "z-ai/glm-5.2",
    name: "GLM 5.2",
    provider: "Z.ai",
    effort: "medium",
  },
];

export function createStarterModels(now = Date.now()): Model[] {
  return starterModels.map((model, index) => ({
    ...model,
    createdAt: new Date(now - (starterModels.length - index) * 60_000),
  }));
}

export function createStarterRepos(now = Date.now()): Repo[] {
  return starterRepos.map(({ ageMinutes, ...repo }) => ({
    ...repo,
    createdAt: new Date(now - ageMinutes * 60_000),
  }));
}

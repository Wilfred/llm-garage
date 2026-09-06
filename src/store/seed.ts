import type { Repo } from "./types";

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

export function createStarterRepos(now = Date.now()): Repo[] {
  return starterRepos.map(({ ageMinutes, ...repo }) => ({
    ...repo,
    createdAt: new Date(now - ageMinutes * 60_000),
  }));
}

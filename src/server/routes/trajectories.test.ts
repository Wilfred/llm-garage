import assert from "node:assert/strict";
import test from "node:test";
import { createStarterRepos } from "../../store/seed";
import type { Trajectory } from "../../store/types";
import { filterTrajectoriesByRepo, titleFromTask } from "./trajectories";

const repos = createStarterRepos();
const trajectories = [
  trajectory("parser", "repo-parser"),
  trajectory("garage", "repo-garage"),
];

void test("filters trajectories by a known repository", () => {
  const filtered = filterTrajectoriesByRepo(repos, trajectories, "repo-parser");

  assert.equal(filtered.selectedRepo?.id, "repo-parser");
  assert.ok(filtered.visibleTrajectories.length > 0);
  assert.ok(
    filtered.visibleTrajectories.every(
      ({ repoId }) => repoId === "repo-parser",
    ),
  );
});

void test("ignores an unknown repository filter", () => {
  const filtered = filterTrajectoriesByRepo(repos, trajectories, "missing");

  assert.equal(filtered.selectedRepo, undefined);
  assert.deepEqual(filtered.visibleTrajectories, trajectories);
});

void test("derives a concise trajectory title from the task", () => {
  assert.equal(titleFromTask("Fix the form\nKeep it simple"), "Fix the form");
  assert.equal(titleFromTask("a".repeat(81)), `${"a".repeat(79)}…`);
});

function trajectory(id: string, repoId: string): Trajectory {
  const timestamp = new Date("2026-09-06T10:00:00Z");
  return {
    id,
    rootId: id,
    repoId,
    title: id,
    status: "succeeded",
    modelId: "openai/gpt-5.6-sol",
    taskPrompt: id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

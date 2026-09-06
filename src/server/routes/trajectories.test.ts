import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDataStore } from "../../store/memory";
import { filterTrajectoriesByRepo, titleFromTask } from "./trajectories";

void test("filters trajectories by a known repository", async () => {
  const store = new MemoryDataStore();
  const [repos, trajectories] = await Promise.all([
    store.listRepos(),
    store.listTrajectories(),
  ]);

  const filtered = filterTrajectoriesByRepo(repos, trajectories, "repo-parser");

  assert.equal(filtered.selectedRepo?.id, "repo-parser");
  assert.ok(filtered.visibleTrajectories.length > 0);
  assert.ok(
    filtered.visibleTrajectories.every(
      ({ repoId }) => repoId === "repo-parser",
    ),
  );
});

void test("ignores an unknown repository filter", async () => {
  const store = new MemoryDataStore();
  const [repos, trajectories] = await Promise.all([
    store.listRepos(),
    store.listTrajectories(),
  ]);

  const filtered = filterTrajectoriesByRepo(repos, trajectories, "missing");

  assert.equal(filtered.selectedRepo, undefined);
  assert.deepEqual(filtered.visibleTrajectories, trajectories);
});

void test("derives a concise trajectory title from the task", () => {
  assert.equal(titleFromTask("Fix the form\nKeep it simple"), "Fix the form");
  assert.equal(titleFromTask("a".repeat(81)), `${"a".repeat(79)}…`);
});

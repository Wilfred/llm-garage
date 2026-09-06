import assert from "node:assert/strict";
import test from "node:test";
import type { Trajectory, TrajectoryStatus, Turn } from "../../store/types";
import { createStarterRepos } from "../../store/seed";
import { renderPage } from "../render";
import { trajectoryDisplayStatus } from "../components";
import { DashboardPage } from "./dashboard";
import { NewRepoPage, RepoDetailPage, ReposPage } from "./repos";
import {
  NewTrajectoryPage,
  TrajectoryDetailPage,
  TrajectoriesPage,
} from "./trajectories";

const repos = createStarterRepos(new Date("2026-09-06T12:00:00Z").getTime());
const trajectories: Trajectory[] = [
  trajectory(
    "trajectory-active",
    "Prototype the trajectory UI",
    "repo-garage",
    "running",
    "openai/gpt-5.6-sol",
  ),
  trajectory(
    "trajectory-idle",
    "Tighten dashboard navigation",
    "repo-garage",
    "awaiting_feedback",
    "anthropic/claude-opus-5",
  ),
  trajectory(
    "trajectory-error",
    "Investigate bytecode parse failure",
    "repo-parser",
    "failed",
    "moonshotai/kimi-k3",
  ),
  trajectory(
    "trajectory-archive",
    "Refresh project notes",
    "repo-notes",
    "archived",
    "z-ai/glm-5.2",
  ),
];

void test("renders the primary navigation", () => {
  const html = renderPage(
    <DashboardPage repos={repos} trajectories={trajectories} />,
  );

  assert.match(html, /🛠️/u);
  assert.match(html, /href="\/repos"/);
  assert.match(html, /href="\/trajectories"/);
  assert.equal(html.match(/href="\/trajectories\/new"/g)?.length, 1);
});

void test("loads page styles from the shared stylesheet", () => {
  const html = renderPage(<DashboardPage repos={[]} trajectories={[]} />);

  assert.match(html, /<link rel="stylesheet" href="\/styles\.css"\/>/);
});

void test("renders repository links and trajectory counts", () => {
  const html = renderPage(
    <ReposPage repos={repos} trajectories={trajectories} />,
  );

  assert.match(html, /href="\/repos\/new"/);
  for (const repo of repos) {
    const repoTrajectories = trajectories.filter(
      (trajectory) => trajectory.repoId === repo.id,
    );
    assert.match(html, new RegExp(`href="/repos/${repo.id}"`));
    assert.match(
      html,
      new RegExp(
        `href="/trajectories\\?repoId=${repo.id}">${repoTrajectories.length.toString()}</a>`,
      ),
    );
  }
});

void test("renders repository creation on its own page", () => {
  const html = renderPage(<NewRepoPage />);

  assert.match(
    html,
    /<form class="card stack form-card" method="post" action="\/repos">/,
  );
  assert.match(html, /<h1>Add repository<\/h1>/);
});

void test("renders repository details and trajectory counts", () => {
  const repo = repos.find(({ id }) => id === "repo-garage");
  assert.ok(repo);
  const repoTrajectories = trajectories.filter(
    (trajectory) => trajectory.repoId === repo.id,
  );
  const html = renderPage(
    <RepoDetailPage repo={repo} trajectories={repoTrajectories} />,
  );

  assert.match(html, /Default branch/);
  assert.match(html, />main</);
  assert.match(
    html,
    /<h2>Active trajectories<\/h2><div class="stat-value">1<\/div>/,
  );
  assert.match(html, /href="\/trajectories\?repoId=repo-garage">2<\/a>/);
});

void test("lists every trajectory on the trajectories page", () => {
  const html = renderPage(
    <TrajectoriesPage repos={repos} trajectories={trajectories} />,
  );

  for (const trajectory of trajectories)
    assert.match(html, new RegExp(trajectory.title));
});

void test("labels a repository-filtered trajectories page", () => {
  const selectedRepo = repos[0];
  assert.ok(selectedRepo);
  const visibleTrajectories = trajectories.filter(
    (trajectory) => trajectory.repoId === selectedRepo.id,
  );
  const html = renderPage(
    <TrajectoriesPage
      repos={repos}
      trajectories={visibleTrajectories}
      selectedRepo={selectedRepo}
    />,
  );

  assert.match(
    html,
    new RegExp(`Showing trajectories for.*${selectedRepo.name}`, "s"),
  );
  assert.match(html, /href="\/trajectories">Clear filter<\/a>/);
  for (const trajectory of visibleTrajectories)
    assert.match(html, new RegExp(trajectory.title));
});

void test("renders the new-trajectory form", () => {
  const html = renderPage(<NewTrajectoryPage repos={repos} />);

  assert.match(html, /placeholder="Describe the outcome you want…"/);
  assert.match(html, /Talk to a model through OpenRouter\./);
  assert.match(html, />Start trajectory<\/button>/);
  assert.match(html, /value="openai\/gpt-5\.6-sol"/);
  assert.match(html, /value="anthropic\/claude-opus-5"/);
  assert.match(html, /value="moonshotai\/kimi-k3"/);
  assert.match(html, /value="z-ai\/glm-5\.2"/);
});

void test("renders trajectory actions", () => {
  const trajectory = trajectories.find(({ id }) => id === "trajectory-idle");
  assert.ok(trajectory);
  const turn = turnFor(trajectory);
  const html = renderPage(
    <TrajectoryDetailPage
      trajectory={trajectory}
      transcript={[{ turn, events: [] }]}
    />,
  );

  assert.match(html, /aria-label="Additional prompt"/);
  assert.match(html, /placeholder="Add another prompt…"/);
  assert.match(html, />Send<\/button>/);
  assert.match(html, /status-idle">idle<\/span>/);
});

void test("maps internal trajectory states to user-facing states", () => {
  assert.equal(trajectoryDisplayStatus("running"), "active");
  assert.equal(trajectoryDisplayStatus("failed"), "errored");
  assert.equal(trajectoryDisplayStatus("archived"), "archive");
  for (const status of [
    "queued",
    "awaiting_feedback",
    "succeeded",
    "cancelled",
  ] satisfies TrajectoryStatus[]) {
    assert.equal(trajectoryDisplayStatus(status), "idle");
  }
});

void test("identifies each trajectory's model and OpenRouter gateway", () => {
  const html = renderPage(
    <TrajectoriesPage repos={repos} trajectories={trajectories} />,
  );

  assert.match(html, /GPT-5\.6 Sol via OpenRouter/);
  assert.match(html, /Claude Opus 5 via OpenRouter/);
  assert.match(html, /Kimi K3 via OpenRouter/);
  assert.match(html, /GLM 5\.2 via OpenRouter/);
});

void test("shows model output outside the collapsed turn details", () => {
  const trajectory = trajectories.find(({ id }) => id === "trajectory-idle");
  assert.ok(trajectory);
  const turn = turnFor(trajectory);
  const ts = new Date("2026-01-01T09:30:00Z");
  const html = renderPage(
    <TrajectoryDetailPage
      trajectory={trajectory}
      transcript={[
        {
          turn,
          events: [
            {
              id: "event-status",
              trajectoryId: trajectory.id,
              turnId: turn.id,
              sequence: 1,
              kind: "status",
              data: "Trajectory finished",
              ts,
            },
            {
              id: "event-output",
              trajectoryId: trajectory.id,
              turnId: turn.id,
              sequence: 2,
              kind: "model_output",
              data: "The capital of France is Paris.",
              ts,
            },
          ],
        },
      ]}
    />,
  );

  const [beforeDetails] = html.split("<details");
  assert.ok(beforeDetails);
  assert.match(beforeDetails, /The capital of France is Paris\./);
  assert.doesNotMatch(beforeDetails, /Trajectory finished/);
  assert.match(html, /<summary>1 event<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

void test("renders model output as markdown without raw HTML", () => {
  const trajectory = trajectories.find(({ id }) => id === "trajectory-idle");
  assert.ok(trajectory);
  const turn = turnFor(trajectory);
  const html = renderPage(
    <TrajectoryDetailPage
      trajectory={trajectory}
      transcript={[
        {
          turn,
          events: [
            {
              id: "event-output",
              trajectoryId: trajectory.id,
              turnId: turn.id,
              sequence: 1,
              kind: "model_output",
              data: "Landmarks:\n\n- **Eiffel Tower**\n- `Louvre`\n\n<script>alert(1)</script>",
              ts: new Date("2026-01-01T09:30:00Z"),
            },
          ],
        },
      ]}
    />,
  );

  assert.match(html, /<li><strong>Eiffel Tower<\/strong><\/li>/);
  assert.match(html, /<code>Louvre<\/code>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

function trajectory(
  id: string,
  title: string,
  repoId: string,
  status: TrajectoryStatus,
  modelId: Trajectory["modelId"],
): Trajectory {
  const createdAt = new Date("2026-09-06T10:00:00Z");
  return {
    id,
    rootId: id,
    repoId,
    title,
    status,
    modelId,
    taskPrompt: title,
    createdAt,
    updatedAt: createdAt,
  };
}

function turnFor(trajectory: Trajectory): Turn {
  return {
    id: `turn-${trajectory.id}`,
    trajectoryId: trajectory.id,
    kind: "initial",
    prompt: trajectory.taskPrompt,
    status: "succeeded",
    createdAt: trajectory.createdAt,
    finishedAt: trajectory.updatedAt,
  };
}

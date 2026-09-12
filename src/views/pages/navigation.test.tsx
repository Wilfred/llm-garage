import assert from "node:assert/strict";
import test from "node:test";
import type { Trajectory, TrajectoryStatus, Turn } from "../../store/types";
import { createStarterModels, createStarterRepos } from "../../store/seed";
import { renderPage } from "../render";
import { trajectoryDisplayStatus } from "../components";
import { DashboardPage } from "./dashboard";
import { ModelDetailPage, ModelsPage, NewModelPage } from "./models";
import { NewRepoPage, RepoDetailPage, ReposPage } from "./repos";
import {
  NewTrajectoryPage,
  TrajectoryDetailPage,
  TrajectoriesPage,
} from "./trajectories";
import { ComparisonPage, type ComparisonColumn } from "./comparisons";
import { ContainersPage } from "./containers";
import { SpendPage } from "./spend";

const repos = createStarterRepos(new Date("2026-09-06T12:00:00Z").getTime());
const models = createStarterModels(new Date("2026-09-06T12:00:00Z").getTime());
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
    <DashboardPage repos={repos} trajectories={trajectories} models={models} />,
  );

  assert.match(html, /🛠️/u);
  assert.match(html, /href="\/repos"/);
  assert.match(html, /href="\/trajectories"/);
  assert.match(html, /href="\/containers"/);
  assert.match(html, /href="\/models"/);
  assert.match(html, /href="\/spend"/);
  assert.equal(html.match(/href="\/trajectories\/new"/g)?.length, 1);
});

void test("lists managed containers with bulk removal actions", () => {
  const html = renderPage(
    <ContainersPage
      containers={[
        {
          id: "container-active-123456789",
          name: "llm-garage-trajectory-trajectory-active",
          trajectoryId: "trajectory-active",
          image: "alpine:3.22.5",
          state: "running",
          status: "Up 2 minutes",
          createdAt: new Date("2026-09-06T12:00:00Z"),
        },
        {
          id: "container-idle-123456789",
          name: "llm-garage-trajectory-trajectory-idle",
          trajectoryId: "trajectory-idle",
          image: "alpine:3.22.5",
          state: "running",
          status: "Up 10 minutes",
          createdAt: new Date("2026-09-06T11:52:00Z"),
        },
      ]}
      trajectories={trajectories}
    />,
  );

  assert.match(html, /aria-current="page">Containers<\/a>/);
  assert.match(html, /action="\/containers\/remove-idle"/);
  assert.match(html, /action="\/containers\/remove-all"/);
  assert.match(html, /status-active">active<\/span>/);
  assert.match(html, /status-idle">idle<\/span>/);
  assert.match(html, /href="\/trajectories\/trajectory-active"/);
  assert.match(html, /alpine:3\.22\.5/);
});

void test("loads page styles from the shared stylesheet", () => {
  const html = renderPage(
    <DashboardPage repos={[]} trajectories={[]} models={[]} />,
  );

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

void test("lists each model with its provider and effort", () => {
  const html = renderPage(
    <ModelsPage models={models} trajectories={trajectories} />,
  );

  for (const model of models) {
    assert.match(
      html,
      new RegExp(`href="/models/${model.id.replace("/", "%2F")}"`),
    );
    assert.match(html, new RegExp(model.name));
    assert.match(html, new RegExp(model.provider));
  }
  assert.match(html, /<td>medium<\/td>/);
  assert.match(html, /href="\/models\/new"/);
});

void test("offers every OpenRouter effort level when adding a model", () => {
  const html = renderPage(<NewModelPage />);

  assert.match(
    html,
    /<form class="card stack form-card" method="post" action="\/models">/,
  );
  assert.match(html, /placeholder="anthropic\/claude-opus-5"/);
  for (const effort of ["minimal", "low", "medium", "high"])
    assert.match(html, new RegExp(`value="${effort}"`));
  assert.match(html, /value="medium" selected/);
});

void test("edits a model in place on its own page", () => {
  const model = models.find(({ id }) => id === "anthropic/claude-opus-5");
  assert.ok(model);
  const html = renderPage(
    <ModelDetailPage
      model={{ ...model, effort: "high" }}
      trajectories={trajectories.filter(({ modelId }) => modelId === model.id)}
    />,
  );

  assert.match(html, /action="\/models\/anthropic%2Fclaude-opus-5\/delete"/);
  assert.match(html, /value="high" selected/);
  assert.match(html, /<h2>Trajectories<\/h2><div class="stat-value">1<\/div>/);
});

void test("renders repository creation on its own page", () => {
  const html = renderPage(<NewRepoPage />);

  assert.match(
    html,
    /<form class="card stack form-card" method="post" action="\/repos">/,
  );
  assert.match(html, /<h1 class="page-intro">Add repository<\/h1>/);
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
    <TrajectoriesPage
      repos={repos}
      trajectories={trajectories}
      models={models}
    />,
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
      models={models}
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
  const html = renderPage(<NewTrajectoryPage repos={repos} models={models} />);

  assert.match(html, /placeholder="Describe the outcome you want…"/);
  assert.match(html, /Pick several to run the same task side by side\./);
  assert.match(html, />Start trajectory<\/button>/);
  assert.equal(html.match(/name="modelIds"/g)?.length, 4);
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

void test("totals the trajectory cost below its transcript", () => {
  const trajectory = trajectories.find(({ id }) => id === "trajectory-idle");
  assert.ok(trajectory);
  const turn = turnFor(trajectory);
  const html = renderPage(
    <TrajectoryDetailPage
      trajectory={trajectory}
      transcript={[
        {
          turn: {
            ...turn,
            usage: { inputTokens: 1200, outputTokens: 80, costUsd: 0.004 },
          },
          events: [],
        },
        {
          turn: {
            ...turn,
            id: "turn-second",
            usage: { inputTokens: 300, outputTokens: 20, costUsd: 0.001 },
          },
          events: [],
        },
      ]}
    />,
  );

  assert.match(html, /\$0\.005/);
  assert.match(html, /1,500 input · 100 output tokens/);
  assert.ok(html.indexOf("$0.005") > html.lastIndexOf("</article>"));
});

void test("says so when a trajectory has recorded no usage", () => {
  const trajectory = trajectories.find(({ id }) => id === "trajectory-idle");
  assert.ok(trajectory);
  const html = renderPage(
    <TrajectoryDetailPage
      trajectory={trajectory}
      transcript={[{ turn: turnFor(trajectory), events: [] }]}
    />,
  );

  assert.match(html, /No usage recorded yet\./);
});

void test("breaks spend down by model and repository", () => {
  const html = renderPage(
    <SpendPage
      spend={{
        trajectories: 3,
        usage: { inputTokens: 4000, outputTokens: 500, costUsd: 1.25 },
        byModel: [
          {
            id: "openai/gpt-5.6-sol",
            label: "GPT-5.6 Sol",
            trajectories: 2,
            usage: { inputTokens: 3000, outputTokens: 400, costUsd: 1.25 },
          },
          {
            id: "moonshotai/kimi-k3",
            label: "Kimi K3",
            trajectories: 1,
            usage: { inputTokens: 1000, outputTokens: 100 },
          },
        ],
        byRepo: [
          {
            id: "repo-garage",
            label: "Wilfred/llm-garage",
            trajectories: 3,
            usage: { inputTokens: 4000, outputTokens: 500, costUsd: 1.25 },
          },
        ],
        unpricedTurns: 1,
      }}
    />,
  );

  assert.match(html, /<h1>Spend<\/h1>/);
  assert.match(html, /\$1\.25/);
  assert.match(html, /4,500/);
  assert.match(html, /GPT-5\.6 Sol/);
  assert.match(html, /Kimi K3/);
  assert.match(html, /Wilfred\/llm-garage/);
  assert.match(html, /1 turn reported tokens without a cost/);
  assert.match(html, /—/);
});

void test("invites a first trajectory when nothing has been spent", () => {
  const html = renderPage(
    <SpendPage
      spend={{ trajectories: 0, byModel: [], byRepo: [], unpricedTurns: 0 }}
    />,
  );

  assert.match(html, /No trajectories yet\./);
  assert.match(html, /href="\/trajectories\/new"/);
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
    <TrajectoriesPage
      repos={repos}
      trajectories={trajectories}
      models={models}
    />,
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

void test("shows each compared model's output side by side", () => {
  const [repo] = repos;
  assert.ok(repo);
  const html = renderPage(
    <ComparisonPage
      repo={repo}
      models={models}
      columns={[
        comparisonColumn("compare-sol", "openai/gpt-5.6-sol", "Sol answered"),
        comparisonColumn(
          "compare-opus",
          "anthropic/claude-opus-5",
          "Opus answered",
        ),
      ]}
    />,
  );

  assert.match(html, /2 models on the same task/);
  assert.match(html, /GPT-5\.6 Sol/);
  assert.match(html, /Claude Opus 5/);
  assert.match(html, /Sol answered/);
  assert.match(html, /Opus answered/);
  assert.match(html, /href="\/trajectories\/compare-sol"/);
  assert.match(html, /href="\/trajectories\/compare-opus"/);
});

void test("links a compared trajectory back to its comparison", () => {
  const column = comparisonColumn(
    "compare-sol",
    "openai/gpt-5.6-sol",
    "Sol answered",
  );
  const html = renderPage(
    <TrajectoryDetailPage
      trajectory={column.trajectory}
      transcript={column.transcript}
    />,
  );

  assert.match(html, /href="\/comparisons\/comparison-1">Comparison<\/a>/);
});

function comparisonColumn(
  id: string,
  modelId: Trajectory["modelId"],
  output: string,
): ComparisonColumn {
  const compared: Trajectory = {
    ...trajectory(
      id,
      "Compare the models",
      "repo-garage",
      "succeeded",
      modelId,
    ),
    comparisonId: "comparison-1",
  };
  const turn = turnFor(compared);
  return {
    trajectory: compared,
    transcript: [
      {
        turn,
        events: [
          {
            id: `event-${id}`,
            trajectoryId: compared.id,
            turnId: turn.id,
            sequence: 1,
            kind: "model_output",
            data: output,
            ts: compared.updatedAt,
          },
        ],
      },
    ],
  };
}

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

import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDataStore } from "../../store/memory";
import { renderPage } from "../render";
import { DashboardPage } from "./dashboard";
import { NewRepoPage, RepoDetailPage, ReposPage } from "./repos";
import {
  NewTrajectoryPage,
  TrajectoryDetailPage,
  TrajectoriesPage,
} from "./trajectories";

void test("keeps the primary navigation focused", async () => {
  const store = new MemoryDataStore();
  const [repos, trajectories] = await Promise.all([
    store.listRepos(),
    store.listTrajectories(),
  ]);
  const html = renderPage(
    <DashboardPage repos={repos} trajectories={trajectories} />,
  );

  assert.match(html, /🛠️/u);
  assert.match(html, /href="\/trajectories"/);
  assert.doesNotMatch(html, /href="\/prompts"/);
  assert.doesNotMatch(
    html,
    /<nav[^>]*>(?:(?!<\/nav>).)*>(?:Dashboard|About)</s,
  );
  assert.doesNotMatch(html, /Workshop overview/);
  assert.doesNotMatch(html, /Start a trajectory/);
  assert.equal(html.match(/href="\/trajectories\/new"/g)?.length, 1);
});

void test("loads page styles from the shared stylesheet", () => {
  const html = renderPage(<DashboardPage repos={[]} trajectories={[]} />);

  assert.match(html, /<link rel="stylesheet" href="\/styles\.css"\/>/);
  assert.doesNotMatch(html, /<style>/);
});

void test("renders the repository listing without branch or delete controls", async () => {
  const store = new MemoryDataStore();
  const [repos, trajectories] = await Promise.all([
    store.listRepos(),
    store.listTrajectories(),
  ]);
  const html = renderPage(
    <ReposPage repos={repos} trajectories={trajectories} />,
  );

  assert.doesNotMatch(html, /Sources/);
  assert.doesNotMatch(html, />master</);
  assert.doesNotMatch(html, /\/delete"/);
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

void test("renders repository details and trajectory counts", async () => {
  const store = new MemoryDataStore();
  const repo = (await store.listRepos()).find(({ id }) => id === "repo-garage");
  assert.ok(repo);
  const trajectories = (await store.listTrajectories()).filter(
    (trajectory) => trajectory.repoId === repo.id,
  );
  const html = renderPage(
    <RepoDetailPage repo={repo} trajectories={trajectories} />,
  );

  assert.match(html, /Default branch/);
  assert.match(html, />main</);
  assert.match(
    html,
    /<h2>Active trajectories<\/h2><div class="stat-value">2<\/div>/,
  );
  assert.match(html, /href="\/trajectories\?repoId=repo-garage">4<\/a>/);
});

void test("lists every trajectory on the trajectories page", async () => {
  const store = new MemoryDataStore();
  const [repos, trajectories] = await Promise.all([
    store.listRepos(),
    store.listTrajectories(),
  ]);
  const html = renderPage(
    <TrajectoriesPage repos={repos} trajectories={trajectories} />,
  );

  for (const trajectory of trajectories)
    assert.match(html, new RegExp(trajectory.title));
});

void test("labels a repository-filtered trajectories page", async () => {
  const store = new MemoryDataStore();
  const repos = await store.listRepos();
  const selectedRepo = repos[0];
  assert.ok(selectedRepo);
  const trajectories = (await store.listTrajectories()).filter(
    (trajectory) => trajectory.repoId === selectedRepo.id,
  );
  const html = renderPage(
    <TrajectoriesPage
      repos={repos}
      trajectories={trajectories}
      selectedRepo={selectedRepo}
    />,
  );

  assert.match(
    html,
    new RegExp(`Showing trajectories for.*${selectedRepo.name}`, "s"),
  );
  assert.match(html, /href="\/trajectories">Clear filter<\/a>/);
  for (const trajectory of trajectories)
    assert.match(html, new RegExp(trajectory.title));
  for (const trajectory of await store.listTrajectories()) {
    if (trajectory.repoId !== selectedRepo.id) {
      assert.doesNotMatch(html, new RegExp(trajectory.title));
    }
  }
});

void test("new-trajectory form has no prompt-library controls", async () => {
  const store = new MemoryDataStore();
  const html = renderPage(
    <NewTrajectoryPage repos={await store.listRepos()} />,
  );

  assert.doesNotMatch(html, /system prompt/i);
  assert.doesNotMatch(html, /composed prompt/i);
  assert.doesNotMatch(html, /systemPromptExtra/);
  assert.doesNotMatch(html, />Runner</);
  assert.doesNotMatch(html, /Codex/);
  assert.doesNotMatch(html, /<label/);
  assert.doesNotMatch(html, /name="(?:title|parentId|createPr|autoMerge)"/);
  assert.doesNotMatch(html, /After the run/);
  assert.match(html, /placeholder="Describe the outcome you want…"/);
  assert.match(html, /Talk to a model through OpenRouter\./);
  assert.match(html, />Start trajectory<\/button>/);
  assert.doesNotMatch(html, /scripted local worker|dummy trajectory/);
  assert.match(html, /value="openai\/gpt-5\.6-sol"/);
  assert.match(html, /value="anthropic\/claude-opus-5"/);
  assert.match(html, /value="moonshotai\/kimi-k3"/);
  assert.match(html, /value="z-ai\/glm-5\.2"/);
});

void test("keeps trajectory detail focused", async () => {
  const store = new MemoryDataStore();
  const trajectory = await store.getTrajectory("trajectory-navigation");
  assert.ok(trajectory);
  const turns = await store.listTurns(trajectory.id);
  const transcript = await Promise.all(
    turns.map(async (turn) => ({
      turn,
      events: await store.listRunEvents(turn.id),
    })),
  );
  const html = renderPage(
    <TrajectoryDetailPage trajectory={trajectory} transcript={transcript} />,
  );

  assert.doesNotMatch(html, /Trajectory tree/);
  assert.doesNotMatch(html, /trajectory-m3/);
  assert.doesNotMatch(html, /<h1>Tighten dashboard navigation<\/h1>/);
  assert.doesNotMatch(html, /started/);
  assert.doesNotMatch(html, /via OpenRouter/);
  assert.doesNotMatch(html, /Wilfred\/llm-garage/);
  assert.doesNotMatch(html, /Pull request/);
  assert.doesNotMatch(html, />succeeded</);
  assert.doesNotMatch(html, /feedback/i);
  assert.doesNotMatch(html, />Transcript</);
  assert.doesNotMatch(html, />Turn \d/);
  assert.doesNotMatch(html, /<label/);
  assert.match(html, /aria-label="Additional prompt"/);
  assert.match(html, /placeholder="Add another prompt…"/);
  assert.match(html, />Send<\/button>/);
  assert.match(html, /status-idle">idle<\/span>/);
});

void test("uses only the four user-facing trajectory states", async () => {
  const store = new MemoryDataStore();
  const html = renderPage(
    <TrajectoriesPage
      repos={await store.listRepos()}
      trajectories={await store.listTrajectories()}
    />,
  );

  assert.match(html, /status-active">active<\/span>/);
  assert.match(html, /status-idle">idle<\/span>/);
  assert.match(html, /status-archive">archive<\/span>/);
  assert.match(html, /status-errored">errored<\/span>/);
  assert.doesNotMatch(
    html,
    /status-(?:queued|running|awaiting_feedback|succeeded|failed|cancelled|archived)/,
  );
});

void test("identifies each trajectory's model and OpenRouter gateway", async () => {
  const store = new MemoryDataStore();
  const repos = await store.listRepos();
  const trajectories = await store.listTrajectories();
  const html = renderPage(
    <TrajectoriesPage repos={repos} trajectories={trajectories} />,
  );

  assert.match(html, /GPT-5\.6 Sol via OpenRouter/);
  assert.match(html, /Claude Opus 5 via OpenRouter/);
  assert.match(html, /Kimi K3 via OpenRouter/);
  assert.match(html, /GLM 5\.2 via OpenRouter/);
  assert.doesNotMatch(html, /codex runner/i);
});

void test("shows model output outside the collapsed turn details", async () => {
  const store = new MemoryDataStore();
  const trajectory = await store.getTrajectory("trajectory-navigation");
  assert.ok(trajectory);
  const [turn] = await store.listTurns(trajectory.id);
  assert.ok(turn);
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

void test("renders model output as markdown without raw HTML", async () => {
  const store = new MemoryDataStore();
  const trajectory = await store.getTrajectory("trajectory-navigation");
  assert.ok(trajectory);
  const [turn] = await store.listTurns(trajectory.id);
  assert.ok(turn);
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

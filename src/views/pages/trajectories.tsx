import type { Repo, RunEvent, Trajectory, Turn } from "../../store/types";
import { getModel, modelCatalog } from "../../models";
import { formatDate, TrajectoryCards, StatusBadge } from "../components";
import { Layout } from "../layout";

export function NewTrajectoryPage({
  repos,
  selectedRepoId,
  error,
}: {
  repos: Repo[];
  selectedRepoId?: string;
  error?: string;
}) {
  return (
    <Layout title="New trajectory" section="trajectories">
      <div class="page-header">
        <div>
          <h1>New trajectory</h1>
          <p>
            Runs a scripted local worker. No model calls or repository changes
            are made yet.
          </p>
        </div>
      </div>
      {error && <div class="notice">{error}</div>}
      {repos.length === 0 ? (
        <div class="empty">
          Add a repository before starting a trajectory.{" "}
          <a href="/repos">Go to repositories</a>.
        </div>
      ) : (
        <form class="card stack form-card" method="post" action="/trajectories">
          <div class="field-row">
            <select name="repoId" required aria-label="Repository">
              {repos.map((repo) => (
                <option value={repo.id} selected={repo.id === selectedRepoId}>
                  {repo.owner}/{repo.name}
                </option>
              ))}
            </select>
            <select name="modelId" required aria-label="Model">
              {modelCatalog.map((model) => (
                <option value={model.id}>
                  {model.name} · {model.provider}
                </option>
              ))}
            </select>
          </div>
          <textarea
            name="taskPrompt"
            required
            aria-label="Task for the agent"
            placeholder="Describe the outcome you want…"
          />
          <button class="button button-primary" type="submit">
            Start dummy trajectory
          </button>
        </form>
      )}
    </Layout>
  );
}

export type TurnTranscript = { turn: Turn; events: RunEvent[] };

export function TrajectoryDetailPage({
  trajectory,
  repo,
  transcript,
}: {
  trajectory: Trajectory;
  repo?: Repo;
  transcript: TurnTranscript[];
}) {
  const model = getModel(trajectory.modelId);
  const canFeedback =
    trajectory.status !== "running" &&
    trajectory.status !== "queued" &&
    trajectory.status !== "archived";
  const canCancel =
    trajectory.status === "running" || trajectory.status === "queued";
  return (
    <Layout
      title={trajectory.title}
      section="trajectories"
      {...(canCancel ? { refreshSeconds: 1 } : {})}
    >
      <div class="breadcrumb">
        <a href="/trajectories">Trajectories</a>
        <span>/</span>
        <strong>{trajectory.title}</strong>
      </div>
      <div class="page-header">
        <div>
          <StatusBadge status={trajectory.status} />
          <p>
            {repo ? `${repo.owner}/${repo.name}` : "Unknown repository"} ·{" "}
            {model.name} via OpenRouter · {formatDate(trajectory.createdAt)}
          </p>
        </div>
        <div class="actions">
          {canCancel && (
            <form
              method="post"
              action={`/trajectories/${trajectory.id}/cancel`}
            >
              <button class="button button-danger" type="submit">
                Cancel run
              </button>
            </form>
          )}
          {trajectory.status !== "archived" && (
            <form
              method="post"
              action={`/trajectories/${trajectory.id}/archive`}
            >
              <button class="button" type="submit">
                Archive
              </button>
            </form>
          )}
        </div>
      </div>
      <div class={trajectory.prUrl ? "split" : undefined}>
        <section class="transcript">
          <div class="section-heading">
            <h2>Transcript</h2>
            <span class="count">Dummy worker events appear as it runs</span>
          </div>
          {transcript.map(({ turn, events }, index) => (
            <article class="card">
              <div class="turn-header">
                <div>
                  <strong>Turn {index + 1}</strong>{" "}
                  <span class="muted small">· {turn.kind}</span>
                </div>
              </div>
              <p class="turn-prompt">{turn.prompt}</p>
              <pre class="log">
                {events
                  .map(
                    (event) =>
                      `${event.ts.toLocaleTimeString("en-GB")}  [${event.kind}] ${event.data}`,
                  )
                  .join("\n") || "No output yet."}
              </pre>
            </article>
          ))}
          {canFeedback && (
            <section class="card">
              <h2>Send feedback</h2>
              <form
                class="stack"
                method="post"
                action={`/trajectories/${trajectory.id}/feedback`}
              >
                <label>
                  Continue this trajectory
                  <textarea
                    name="feedback"
                    required
                    placeholder="Ask for a revision or the next step…"
                  />
                </label>
                <button class="button button-primary" type="submit">
                  Start feedback turn
                </button>
              </form>
            </section>
          )}
        </section>
        {trajectory.prUrl && (
          <aside class="stack sticky">
            <section class="card">
              <h2>Pull request</h2>
              <a href={trajectory.prUrl}>Open pull request</a>
              {trajectory.autoMerge && (
                <p class="muted small">Auto-merge is enabled.</p>
              )}
            </section>
          </aside>
        )}
      </div>
    </Layout>
  );
}

export function TrajectoriesPage({
  repos,
  trajectories,
  selectedRepo,
}: {
  repos: Repo[];
  trajectories: Trajectory[];
  selectedRepo?: Repo;
}) {
  return (
    <Layout title="Trajectories" section="trajectories">
      <div class="page-header">
        <div>
          <h1>Trajectories</h1>
          {selectedRepo && (
            <p>
              Showing trajectories for{" "}
              <a href={`/repos/${selectedRepo.id}`}>
                {selectedRepo.owner}/{selectedRepo.name}
              </a>
              . <a href="/trajectories">Clear filter</a>
            </p>
          )}
        </div>
      </div>
      <TrajectoryCards trajectories={trajectories} repos={repos} />
    </Layout>
  );
}

export function NotFoundPage({
  message = "That page does not exist.",
}: {
  message?: string;
}) {
  return (
    <Layout title="Not found">
      <div class="page-header">
        <div>
          <div class="eyebrow">404</div>
          <h1>Not found</h1>
          <p>{message}</p>
        </div>
      </div>
      <a class="button" href="/">
        Back to dashboard
      </a>
    </Layout>
  );
}

import type { Repo, RunEvent, Trajectory, Turn } from "../../store/types";
import { modelCatalog } from "../../models";
import { TrajectoryCards, StatusBadge } from "../components";
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
  transcript,
}: {
  trajectory: Trajectory;
  transcript: TurnTranscript[];
}) {
  const canContinue =
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
      <div class="detail-toolbar">
        <StatusBadge status={trajectory.status} />
        <div class="actions">
          {canCancel && (
            <form
              method="post"
              action={`/trajectories/${trajectory.id}/cancel`}
            >
              <button class="button button-danger" type="submit">
                Cancel
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
          {transcript.map(({ turn, events }) => (
            <article class="card">
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
          {canContinue && (
            <form
              class="continue-form"
              method="post"
              action={`/trajectories/${trajectory.id}/prompts`}
            >
              <textarea
                name="prompt"
                required
                aria-label="Additional prompt"
                placeholder="Add another prompt…"
              />
              <button class="button button-primary" type="submit">
                Send
              </button>
            </form>
          )}
        </section>
        {trajectory.prUrl && (
          <aside class="stack sticky">
            <section class="card">
              <h2>Pull request</h2>
              <a href={trajectory.prUrl}>Open pull request</a>
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

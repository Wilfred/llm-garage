import type {
  Model,
  Repo,
  RunEvent,
  Trajectory,
  Turn,
} from "../../store/types";
import { sumUsage } from "../../usage";
import { TrajectoryCards, StatusBadge, UsageSummary } from "../components";
import { Layout } from "../layout";
import { renderMarkdown } from "../markdown";

export function NewTrajectoryPage({
  repos,
  models,
  selectedRepoId,
  selectedModelIds,
  error,
}: {
  repos: Repo[];
  models: Model[];
  selectedRepoId?: string;
  selectedModelIds?: string[];
  error?: string;
}) {
  const firstModel = models[0];
  const checkedModelIds =
    selectedModelIds ?? (firstModel ? [firstModel.id] : []);
  return (
    <Layout title="New trajectory" section="trajectories">
      <div class="page-intro">
        <h1>New trajectory</h1>
        <p>
          Talk to models through OpenRouter. Pick several to run the same task
          side by side.
        </p>
      </div>
      {error && <div class="notice">{error}</div>}
      {repos.length === 0 || models.length === 0 ? (
        <div class="empty">
          {repos.length === 0 ? (
            <>
              Add a repository before starting a trajectory.{" "}
              <a href="/repos">Go to repositories</a>.
            </>
          ) : (
            <>
              Add a model before starting a trajectory.{" "}
              <a href="/models">Go to models</a>.
            </>
          )}
        </div>
      ) : (
        <form class="card stack form-card" method="post" action="/trajectories">
          <select name="repoId" required aria-label="Repository">
            {repos.map((repo) => (
              <option value={repo.id} selected={repo.id === selectedRepoId}>
                {repo.owner}/{repo.name}
              </option>
            ))}
          </select>
          <div class="check-row" role="group" aria-label="Models">
            {models.map((model) => (
              <label class="check">
                <input
                  type="checkbox"
                  name="modelIds"
                  value={model.id}
                  checked={checkedModelIds.includes(model.id)}
                />
                {model.name} · {model.provider} · {model.effort} effort
              </label>
            ))}
          </div>
          <textarea
            name="taskPrompt"
            required
            aria-label="Task for the agent"
            placeholder="Describe the outcome you want…"
          />
          <button class="button button-primary" type="submit">
            Start trajectory
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
  const usage = sumUsage(transcript.map(({ turn }) => turn.usage));
  return (
    <Layout
      title={trajectory.title}
      section="trajectories"
      {...(canCancel ? { refreshSeconds: 1 } : {})}
    >
      <div class="breadcrumb">
        <a href="/trajectories">Trajectories</a>
        <span>/</span>
        {trajectory.comparisonId && (
          <>
            <a href={`/comparisons/${trajectory.comparisonId}`}>Comparison</a>
            <span>/</span>
          </>
        )}
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
            <TurnCard turn={turn} events={events} />
          ))}
          <UsageSummary usage={usage} />
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

function TurnCard({ turn, events }: TurnTranscript) {
  const output = events
    .filter((event) => event.kind === "model_output")
    .map((event) => event.data)
    .join("\n\n");
  const details = events.filter((event) => event.kind !== "model_output");
  return (
    <article class="card">
      <p class="turn-prompt">{turn.prompt}</p>
      {output ? (
        <div
          class="model-output"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
        />
      ) : (
        <p class="model-output empty-output">No output yet.</p>
      )}
      {details.length > 0 && (
        <details class="turn-details">
          <summary>
            {details.length} {details.length === 1 ? "event" : "events"}
          </summary>
          <pre class="log">
            {details
              .map(
                (event) =>
                  `${event.ts.toLocaleTimeString("en-GB")}  [${event.kind}] ${event.data}`,
              )
              .join("\n")}
          </pre>
        </details>
      )}
    </article>
  );
}

export function TrajectoriesPage({
  repos,
  trajectories,
  models,
  selectedRepo,
}: {
  repos: Repo[];
  trajectories: Trajectory[];
  models: Model[];
  selectedRepo?: Repo;
}) {
  return (
    <Layout title="Trajectories" section="trajectories">
      <div class="page-intro">
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
      <TrajectoryCards
        trajectories={trajectories}
        repos={repos}
        models={models}
      />
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
      <div class="page-intro">
        <div class="eyebrow">404</div>
        <h1>Not found</h1>
        <p>{message}</p>
      </div>
      <a class="button" href="/">
        Back to dashboard
      </a>
    </Layout>
  );
}

import type { Repo, RunEvent, Session, Turn } from "../../store/types";
import { getModel, modelCatalog } from "../../models";
import { formatDate, SessionCards, StatusBadge } from "../components";
import { Layout } from "../layout";

export function NewSessionPage({
  repos,
  selectedRepoId,
  error,
}: {
  repos: Repo[];
  selectedRepoId?: string;
  error?: string;
}) {
  return (
    <Layout title="New session" section="sessions">
      <div class="page-header">
        <div>
          <h1>New session</h1>
          <p>
            Runs a scripted local worker. No model calls or repository changes
            are made yet.
          </p>
        </div>
      </div>
      {error && <div class="notice">{error}</div>}
      {repos.length === 0 ? (
        <div class="empty">
          Add a repository before starting a session.{" "}
          <a href="/repos">Go to repositories</a>.
        </div>
      ) : (
        <form class="card stack form-card" method="post" action="/sessions">
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
            Start dummy session
          </button>
        </form>
      )}
    </Layout>
  );
}

export type TurnTranscript = { turn: Turn; events: RunEvent[] };

export function SessionDetailPage({
  session,
  repo,
  transcript,
}: {
  session: Session;
  repo?: Repo;
  transcript: TurnTranscript[];
}) {
  const model = getModel(session.modelId);
  const canFeedback =
    session.status !== "running" &&
    session.status !== "queued" &&
    session.status !== "archived";
  const canCancel = session.status === "running" || session.status === "queued";
  return (
    <Layout
      title={session.title}
      section="sessions"
      {...(canCancel ? { refreshSeconds: 1 } : {})}
    >
      <div class="breadcrumb">
        <a href="/sessions">Sessions</a>
        <span>/</span>
        <strong>{session.title}</strong>
      </div>
      <div class="page-header">
        <div>
          <StatusBadge status={session.status} />
          <p>
            {repo ? `${repo.owner}/${repo.name}` : "Unknown repository"} ·{" "}
            {model.name} via OpenRouter · {formatDate(session.createdAt)}
          </p>
        </div>
        <div class="actions">
          {canCancel && (
            <form method="post" action={`/sessions/${session.id}/cancel`}>
              <button class="button button-danger" type="submit">
                Cancel run
              </button>
            </form>
          )}
          {session.status !== "archived" && (
            <form method="post" action={`/sessions/${session.id}/archive`}>
              <button class="button" type="submit">
                Archive
              </button>
            </form>
          )}
        </div>
      </div>
      <div class={session.prUrl ? "split" : undefined}>
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
                action={`/sessions/${session.id}/feedback`}
              >
                <label>
                  Continue this session
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
        {session.prUrl && (
          <aside class="stack sticky">
            <section class="card">
              <h2>Pull request</h2>
              <a href={session.prUrl}>Open pull request</a>
              {session.autoMerge && (
                <p class="muted small">Auto-merge is enabled.</p>
              )}
            </section>
          </aside>
        )}
      </div>
    </Layout>
  );
}

export function SessionsPage({
  repos,
  sessions,
  selectedRepo,
}: {
  repos: Repo[];
  sessions: Session[];
  selectedRepo?: Repo;
}) {
  return (
    <Layout title="Sessions" section="sessions">
      <div class="page-header">
        <div>
          <h1>Sessions</h1>
          {selectedRepo && (
            <p>
              Showing sessions for{" "}
              <a href={`/repos/${selectedRepo.id}`}>
                {selectedRepo.owner}/{selectedRepo.name}
              </a>
              . <a href="/sessions">Clear filter</a>
            </p>
          )}
        </div>
      </div>
      <SessionCards sessions={sessions} repos={repos} />
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

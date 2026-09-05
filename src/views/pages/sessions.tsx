import type { Repo, RunEvent, Session, Turn } from "../../store/types";
import { getModel, modelCatalog } from "../../models";
import { formatDate, SessionCards, StatusBadge } from "../components";
import { Layout } from "../layout";

export function NewSessionPage({
  repos,
  sessions,
  selectedRepoId,
  error,
}: {
  repos: Repo[];
  sessions: Session[];
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
            <label>
              Repository
              <select name="repoId" required>
                {repos.map((repo) => (
                  <option value={repo.id} selected={repo.id === selectedRepoId}>
                    {repo.owner}/{repo.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <span class="help">Run through OpenRouter</span>
              <select name="modelId" required>
                {modelCatalog.map((model) => (
                  <option value={model.id}>
                    {model.name} · {model.provider}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Session title
            <input
              name="title"
              required
              placeholder="Improve the settings workflow"
            />
          </label>
          <label>
            Task for the agent
            <textarea
              name="taskPrompt"
              required
              placeholder="Describe the outcome you want…"
            />
          </label>
          <label>
            Parent session{" "}
            <span class="help">
              Optional: make this session part of an existing work tree.
            </span>
            <select name="parentId">
              <option value="">No parent</option>
              {sessions
                .filter(({ status }) => status !== "archived")
                .map((session) => (
                  <option value={session.id}>{session.title}</option>
                ))}
            </select>
          </label>
          <fieldset>
            <legend>After the run</legend>
            <div class="check-row">
              <label class="check">
                <input
                  id="create-pr"
                  type="checkbox"
                  name="createPr"
                  value="yes"
                  checked
                />{" "}
                Create a pull request
              </label>
              <label class="check">
                <input
                  id="auto-merge"
                  type="checkbox"
                  name="autoMerge"
                  value="yes"
                />{" "}
                Auto-merge when CI passes
              </label>
            </div>
          </fieldset>
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
  breadcrumb,
  tree,
  transcript,
}: {
  session: Session;
  repo?: Repo;
  breadcrumb: Session[];
  tree: Session[];
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
      refreshSeconds={canCancel ? 1 : undefined}
    >
      <div class="breadcrumb">
        <a href="/sessions">Sessions</a>
        <span>/</span>
        {breadcrumb.map((item, index) => (
          <>
            {index > 0 && <span>/</span>}
            {item.id === session.id ? (
              <strong>{item.title}</strong>
            ) : (
              <a href={`/sessions/${item.id}`}>{item.title}</a>
            )}
          </>
        ))}
      </div>
      <div class="page-header">
        <div>
          <StatusBadge status={session.status} />
          <h1>{session.title}</h1>
          <p>
            {repo ? `${repo.owner}/${repo.name}` : "Unknown repository"} ·{" "}
            {model.name} via OpenRouter · started{" "}
            {formatDate(session.createdAt)}
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
      <div class="split">
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
                <span class="muted small">{turn.status}</span>
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
        <aside class="stack sticky">
          <section class="card">
            <h2>Session tree</h2>
            <SessionTree sessions={tree} currentId={session.id} />
          </section>
          <section class="card">
            <h2>Pull request</h2>
            {session.prUrl ? (
              <a href={session.prUrl}>Open pull request</a>
            ) : (
              <p class="muted small">
                {session.createPr
                  ? "A pull request will appear here after a real agent completes."
                  : "Pull-request creation is off for this session."}
              </p>
            )}
            {session.autoMerge && (
              <p class="muted small">Auto-merge is enabled.</p>
            )}
          </section>
        </aside>
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

function SessionTree({
  sessions,
  currentId,
}: {
  sessions: Session[];
  currentId: string;
}) {
  const roots = sessions.filter(
    ({ parentId }) => !parentId || !sessions.some(({ id }) => id === parentId),
  );
  const renderNodes = (nodes: Session[]) => (
    <ul class="tree">
      {nodes.map((node) => {
        const children = sessions.filter(
          ({ parentId }) => parentId === node.id,
        );
        return (
          <li>
            <a href={`/sessions/${node.id}`}>
              <span>
                {node.id === currentId ? "› " : ""}
                {node.title}
              </span>
              <span class="muted">{node.status.replaceAll("_", " ")}</span>
            </a>
            {children.length > 0 && renderNodes(children)}
          </li>
        );
      })}
    </ul>
  );
  return renderNodes(roots);
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

import type { ChatGptStatus } from "../../chatgpt/auth";
import { formatDate } from "../components";
import { Layout } from "../layout";

export function ChatGptPage({
  status,
  notice,
}: {
  status: ChatGptStatus;
  notice?: string;
}) {
  return (
    <Layout
      title="ChatGPT"
      section="settings"
      {...(status.state === "pending" ? { refreshSeconds: 2 } : {})}
    >
      <div class="page-header">
        <h1>ChatGPT</h1>
        {status.state === "signed_in" ? (
          <form method="post" action="/chatgpt/sign-out">
            <button class="button button-danger" type="submit">
              Sign out
            </button>
          </form>
        ) : status.state === "pending" ? (
          <form method="post" action="/chatgpt/cancel">
            <button class="button" type="submit">
              Cancel
            </button>
          </form>
        ) : (
          <form method="post" action="/chatgpt/sign-in">
            <button class="button button-primary" type="submit">
              Sign in
            </button>
          </form>
        )}
      </div>
      {notice && <div class="notice">{notice}</div>}
      {status.state === "signed_out" && status.error && (
        <div class="notice">{status.error}</div>
      )}
      {status.state === "signed_in" ? (
        <section class="card stack">
          <p>
            Signed in
            {status.email && (
              <>
                {" "}
                as <strong>{status.email}</strong>
              </>
            )}
            {status.plan && <> on the {status.plan} plan</>}.
          </p>
          <p class="muted small">
            Models added with the ChatGPT subscription provider run on this
            account. <a href="/models/new">Add a model</a>
          </p>
        </section>
      ) : status.state === "pending" ? (
        <section class="card stack">
          <p>
            Open{" "}
            <a href={status.verificationUrl} target="_blank" rel="noreferrer">
              {status.verificationUrl}
            </a>{" "}
            and enter this code:
          </p>
          <div class="stat-value">{status.userCode}</div>
          <p class="muted small">
            The code expires at{" "}
            <time dateTime={status.expiresAt.toISOString()}>
              {formatDate(status.expiresAt)}
            </time>
            . If it is rejected, turn on device code sign-in for Codex in
            ChatGPT's security settings.
          </p>
        </section>
      ) : (
        <p class="muted">
          Sign in with a ChatGPT subscription to run OpenAI models on it instead
          of OpenRouter.
        </p>
      )}
    </Layout>
  );
}

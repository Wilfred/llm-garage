import type { Repo, Session } from "../../store/types";
import { SessionCards } from "../components";
import { Layout } from "../layout";

export function DashboardPage({
  repos,
  sessions,
}: {
  repos: Repo[];
  sessions: Session[];
}) {
  const active = sessions.filter(
    ({ status }) => status === "running" || status === "queued",
  );
  const awaiting = sessions.filter(({ status }) => status === "awaiting_feedback");
  const recent = sessions
    .filter(({ status }) => !["running", "queued", "awaiting_feedback"].includes(status))
    .slice(0, 6);

  return (
    <Layout title="Dashboard" section="dashboard">
      <div class="page-header">
        <div>
          <div class="eyebrow">Workshop overview</div>
          <h1>Your agent sessions</h1>
          <p>
            Keep several pieces of work moving, then pick up the ones waiting for a
            decision.
          </p>
        </div>
        <a class="button button-primary" href="/sessions/new">
          Start a session
        </a>
      </div>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Active</h2>
          <span class="count">{active.length} in progress</span>
        </div>
        <SessionCards sessions={active} repos={repos} />
      </section>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Awaiting your feedback</h2>
          <span class="count">{awaiting.length} ready to review</span>
        </div>
        <SessionCards sessions={awaiting} repos={repos} />
      </section>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Recent</h2>
          <span class="count">Completed and archived work</span>
        </div>
        <SessionCards sessions={recent} repos={repos} />
      </section>
    </Layout>
  );
}

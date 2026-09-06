import type { Repo, Trajectory } from "../../store/types";
import { TrajectoryCards } from "../components";
import { Layout } from "../layout";

export function DashboardPage({
  repos,
  trajectories,
}: {
  repos: Repo[];
  trajectories: Trajectory[];
}) {
  const active = trajectories.filter(
    ({ status }) => status === "running" || status === "queued",
  );
  const awaiting = trajectories.filter(
    ({ status }) => status === "awaiting_feedback",
  );
  const recent = trajectories
    .filter(
      ({ status }) =>
        !["running", "queued", "awaiting_feedback"].includes(status),
    )
    .slice(0, 6);

  return (
    <Layout title="Dashboard">
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
        </div>
      </div>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Active</h2>
          <span class="count">{active.length} in progress</span>
        </div>
        <TrajectoryCards trajectories={active} repos={repos} />
      </section>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Awaiting your feedback</h2>
          <span class="count">{awaiting.length} ready to review</span>
        </div>
        <TrajectoryCards trajectories={awaiting} repos={repos} />
      </section>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Recent</h2>
          <span class="count">Completed and archived work</span>
        </div>
        <TrajectoryCards trajectories={recent} repos={repos} />
      </section>
    </Layout>
  );
}

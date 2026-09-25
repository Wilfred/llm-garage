import type { Model, Repo, Trajectory } from "../../store/types";
import { TrajectoryCards } from "../components";
import { Layout } from "../layout";

export function DashboardPage({
  repos,
  trajectories,
  models,
}: {
  repos: Repo[];
  trajectories: Trajectory[];
  models: Model[];
}) {
  const active = trajectories.filter(
    ({ status }) => status === "running" || status === "queued",
  );
  const recent = trajectories
    .filter(({ status }) => !["running", "queued"].includes(status))
    .slice(0, 6);

  return (
    <Layout title="Dashboard">
      <h1 class="page-intro">Dashboard</h1>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Active</h2>
          <span class="count">{active.length} in progress</span>
        </div>
        <TrajectoryCards trajectories={active} repos={repos} models={models} />
      </section>
      <section class="dashboard-section">
        <div class="section-heading">
          <h2>Recent</h2>
          <span class="count">Completed and archived work</span>
        </div>
        <TrajectoryCards trajectories={recent} repos={repos} models={models} />
      </section>
    </Layout>
  );
}

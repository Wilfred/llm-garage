import type { ManagedContainer } from "../../sandbox/types";
import type { Trajectory } from "../../store/types";
import { EmptyState, formatDate } from "../components";
import { Layout } from "../layout";

export function ContainersPage({
  containers,
  trajectories,
  notice,
}: {
  containers: ManagedContainer[];
  trajectories: Trajectory[];
  notice?: string;
}) {
  const idleCount = containers.filter((container) =>
    isIdleContainer(container, trajectories),
  ).length;

  return (
    <Layout title="Containers" section="containers">
      <div class="page-header">
        <div class="page-heading">
          <h1>Containers</h1>
          <p class="muted">
            Docker workspaces started by LLM Garage. Removing an active
            container interrupts its trajectory.
          </p>
        </div>
        <div class="actions">
          <form method="post" action="/containers/remove-idle">
            <button
              class="button button-danger"
              type="submit"
              disabled={idleCount === 0}
            >
              Remove idle
            </button>
          </form>
          <form method="post" action="/containers/remove-all">
            <button
              class="button button-danger"
              type="submit"
              disabled={containers.length === 0}
            >
              Remove all
            </button>
          </form>
        </div>
      </div>
      {notice && <div class="notice notice-success">{notice}</div>}
      {containers.length === 0 ? (
        <EmptyState>No containers have been started.</EmptyState>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Container</th>
                <th>Trajectory</th>
                <th>Activity</th>
                <th>Docker state</th>
                <th>Image</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((container) => {
                const trajectory = trajectories.find(
                  ({ id }) => id === container.trajectoryId,
                );
                const idle = isIdleContainer(container, trajectories);
                return (
                  <tr>
                    <td class="container-identity">
                      <div class="repo-name">{container.name}</div>
                      <code class="small">{container.id.slice(0, 12)}</code>
                    </td>
                    <td>
                      {trajectory ? (
                        <a href={`/trajectories/${trajectory.id}`}>
                          {trajectory.title}
                        </a>
                      ) : (
                        <span class="muted">
                          {container.trajectoryId ?? "Unknown"}
                        </span>
                      )}
                    </td>
                    <td>
                      <span class={`status status-${idle ? "idle" : "active"}`}>
                        {idle ? "idle" : "active"}
                      </span>
                    </td>
                    <td>
                      <div class="container-state">{container.state}</div>
                      <div class="muted small">{container.status}</div>
                    </td>
                    <td>{container.image}</td>
                    <td>
                      <time dateTime={container.createdAt.toISOString()}>
                        {formatDate(container.createdAt)}
                      </time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {containers.length > 0 && (
        <p class="muted small container-help">
          Idle containers belong to trajectories that are not running or queued.
        </p>
      )}
    </Layout>
  );
}

export function isIdleContainer(
  container: ManagedContainer,
  trajectories: Trajectory[],
): boolean {
  const trajectory = trajectories.find(
    ({ id }) => id === container.trajectoryId,
  );
  return trajectory?.status !== "running" && trajectory?.status !== "queued";
}

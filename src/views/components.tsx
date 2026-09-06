import type { ComponentChildren } from "preact";
import type { Repo, Trajectory, TrajectoryStatus } from "../store/types";
import { getModel } from "../models";

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function StatusBadge({ status }: { status: TrajectoryStatus }) {
  const displayStatus = trajectoryDisplayStatus(status);
  return <span class={`status status-${displayStatus}`}>{displayStatus}</span>;
}

export function trajectoryDisplayStatus(
  status: TrajectoryStatus,
): "active" | "archive" | "errored" | "idle" {
  if (status === "running") return "active";
  if (status === "failed") return "errored";
  if (status === "archived") return "archive";
  return "idle";
}

export function EmptyState({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>;
}

export function TrajectoryCards({
  trajectories,
  repos,
}: {
  trajectories: Trajectory[];
  repos: Repo[];
}) {
  if (trajectories.length === 0)
    return <EmptyState>No trajectories here.</EmptyState>;
  return (
    <div class="grid grid-3">
      {trajectories.map((trajectory) => {
        const repo = repos.find(
          (candidate) => candidate.id === trajectory.repoId,
        );
        const model = getModel(trajectory.modelId);
        return (
          <a class="card card-link" href={`/trajectories/${trajectory.id}`}>
            <StatusBadge status={trajectory.status} />
            <div class="card-title">{trajectory.title}</div>
            <div class="card-meta">
              <span>
                {repo ? `${repo.owner}/${repo.name}` : "Unknown repository"}
              </span>
              <span>{model.name} via OpenRouter</span>
              <time dateTime={trajectory.updatedAt.toISOString()}>
                {formatDate(trajectory.updatedAt)}
              </time>
            </div>
          </a>
        );
      })}
    </div>
  );
}

import type {
  DataStore,
  Model,
  Repo,
  RunEvent,
  Trajectory,
  Turn,
} from "./store/types";
import { formatUsage, sumUsage } from "./usage";

export type TurnTranscript = { turn: Turn; events: RunEvent[] };

export async function loadTurnTranscripts(
  store: DataStore,
  trajectoryId: string,
): Promise<TurnTranscript[]> {
  const turns = await store.listTurns(trajectoryId);
  return Promise.all(
    turns.map(async (turn) => ({
      turn,
      events: await store.listRunEvents(turn.id),
    })),
  );
}

// The whole trajectory as plain text: every prompt, model output, tool call
// and tool result, so it can be handed to another model to review.
export async function loadTrajectoryTranscript(
  store: DataStore,
  trajectoryId: string,
): Promise<string | undefined> {
  const trajectory = await store.getTrajectory(trajectoryId);
  if (!trajectory) return undefined;
  const [turns, repo, model] = await Promise.all([
    loadTurnTranscripts(store, trajectoryId),
    store.getRepo(trajectory.repoId),
    store.getModel(trajectory.modelId),
  ]);
  return formatTrajectoryTranscript({
    trajectory,
    turns,
    ...(repo === undefined ? {} : { repo }),
    ...(model === undefined ? {} : { model }),
  });
}

export function formatTrajectoryTranscript({
  trajectory,
  turns,
  repo,
  model,
}: {
  trajectory: Trajectory;
  turns: TurnTranscript[];
  repo?: Repo;
  model?: Model;
}): string {
  const usage = sumUsage(turns.map(({ turn }) => turn.usage));
  const header = [
    `# ${trajectory.title}`,
    "",
    `Trajectory: ${trajectory.id}`,
    `Repository: ${repo ? `${repo.owner}/${repo.name}` : trajectory.repoId}`,
    `Model: ${model ? `${model.name} (${model.id}, ${model.effort} effort)` : trajectory.modelId}`,
    `Status: ${trajectory.status}`,
    ...(trajectory.prUrl ? [`Pull request: ${trajectory.prUrl}`] : []),
    ...(usage ? [`Usage: ${formatUsage(usage)}`] : []),
  ];
  const sections = turns.map(({ turn, events }, index) =>
    [
      `## Turn ${(index + 1).toString()} (${turn.kind}, ${turn.status})`,
      "",
      "### Prompt",
      "",
      turn.prompt,
      ...events.flatMap((event) => [
        "",
        `### ${event.ts.toISOString()} ${event.kind}`,
        "",
        event.data,
      ]),
    ].join("\n"),
  );
  return [header.join("\n"), ...sections].join("\n\n") + "\n";
}

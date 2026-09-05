import { Layout } from "../layout";

const repositoryUrl = "https://github.com/Wilfred/llm-garage";

export interface AboutPageProps {
  gitCommit: string | null;
  imageBuildTime: string | null;
  processUptimeSeconds: number;
  machineUptimeSeconds: number;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const units = [
    { label: "day", seconds: 86_400 },
    { label: "hour", seconds: 3_600 },
    { label: "minute", seconds: 60 },
    { label: "second", seconds: 1 },
  ];
  const parts: string[] = [];
  let remaining = seconds;

  for (const unit of units) {
    const value = Math.floor(remaining / unit.seconds);
    if (value > 0 || (unit.seconds === 1 && parts.length === 0)) {
      parts.push(`${value} ${unit.label}${value === 1 ? "" : "s"}`);
      remaining %= unit.seconds;
    }
    if (parts.length === 2) break;
  }

  return parts.join(", ");
}

export function AboutPage({
  gitCommit,
  imageBuildTime,
  processUptimeSeconds,
  machineUptimeSeconds,
}: AboutPageProps) {
  const commitUrl = gitCommit
    ? `${repositoryUrl}/commit/${encodeURIComponent(gitCommit)}`
    : null;
  const shortCommit = gitCommit?.slice(0, 12);

  return (
    <Layout title="About">
      <h1>About</h1>
      <p>Build and runtime information for this LLM Garage instance.</p>
      <dl class="system-info">
        <dt>Git commit</dt>
        <dd>
          {commitUrl && shortCommit ? (
            <a href={commitUrl}>
              <code>{shortCommit}</code>
            </a>
          ) : (
            "Unavailable"
          )}
        </dd>

        <dt>Docker image built</dt>
        <dd>
          {imageBuildTime ? (
            <time dateTime={imageBuildTime}>{imageBuildTime}</time>
          ) : (
            "Unavailable outside a Docker image"
          )}
        </dd>

        <dt>Process uptime</dt>
        <dd>{formatDuration(processUptimeSeconds)}</dd>

        <dt>Machine uptime</dt>
        <dd>{formatDuration(machineUptimeSeconds)}</dd>
      </dl>
      <p>
        <a href="/">Back to the homepage</a>
      </p>
    </Layout>
  );
}

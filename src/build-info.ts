import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface BuildInfo {
  gitCommit: string | null;
  imageBuildTime: string | null;
}

const buildInfoPath = resolve(process.cwd(), "build-info.json");

export function loadBuildInfo(): BuildInfo {
  try {
    const contents = readFileSync(buildInfoPath, "utf8");
    const parsed: unknown = JSON.parse(contents);

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("build-info.json must contain an object");
    }

    const candidate = parsed as Record<string, unknown>;

    return {
      gitCommit:
        typeof candidate.gitCommit === "string" ? candidate.gitCommit : null,
      imageBuildTime:
        typeof candidate.imageBuildTime === "string"
          ? candidate.imageBuildTime
          : null,
    };
  } catch {
    return {
      gitCommit: process.env.GIT_COMMIT ?? null,
      imageBuildTime: process.env.IMAGE_BUILD_TIME ?? null,
    };
  }
}

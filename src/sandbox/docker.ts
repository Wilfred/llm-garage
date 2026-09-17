import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import Docker from "dockerode";
import type {
  CommandResult,
  ContainerManager,
  ManagedContainer,
  RemoveContainersOptions,
  Sandbox,
  SandboxRepository,
} from "./types";

const managedLabel = "com.llm-garage.managed";
const trajectoryLabel = "com.llm-garage.trajectory-id";
const repositoryLabel = "com.llm-garage.repository";
const branchLabel = "com.llm-garage.default-branch";
const defaultOutputLimit = 16 * 1024;
const truncationMarker = Buffer.from("\n... output truncated ...\n");
const defaultWorkerImage = "ghcr.io/wilfred/llm-garage:worker";
const workerUser = "agent";
const workerUid = 10001;
const workerHome = "/home/agent";
const repositoryPath = `${workerHome}/repo`;

export type DockerSandboxOptions = {
  docker?: Docker;
  image?: string;
  githubToken?: string | undefined;
  memoryBytes?: number;
  nanoCpus?: number;
  pidsLimit?: number;
  outputLimitBytes?: number;
};

export class DockerSandbox implements Sandbox, ContainerManager {
  private readonly docker: Docker;
  private readonly image: string;
  private readonly githubToken: string | undefined;
  private readonly memoryBytes: number;
  private readonly nanoCpus: number;
  private readonly pidsLimit: number;
  private readonly outputLimitBytes: number;
  private imagePromise: Promise<void> | undefined;
  private readonly creates = new Map<string, Promise<void>>();

  constructor({
    docker = new Docker(),
    image = defaultWorkerImage,
    githubToken,
    memoryBytes = 4 * 1024 * 1024 * 1024,
    nanoCpus = 1_000_000_000,
    pidsLimit = 128,
    outputLimitBytes = defaultOutputLimit,
  }: DockerSandboxOptions = {}) {
    this.docker = docker;
    this.image = image;
    this.githubToken = githubToken;
    this.memoryBytes = memoryBytes;
    this.nanoCpus = nanoCpus;
    this.pidsLimit = pidsLimit;
    this.outputLimitBytes = outputLimitBytes;
  }

  async create(
    trajectoryId: string,
    repository: SandboxRepository,
  ): Promise<void> {
    validateTrajectoryId(trajectoryId);
    const pending = this.creates.get(trajectoryId);
    if (pending) {
      await pending;
      return;
    }

    const creation = this.createContainer(trajectoryId, repository);
    this.creates.set(trajectoryId, creation);
    try {
      await creation;
    } finally {
      if (this.creates.get(trajectoryId) === creation) {
        this.creates.delete(trajectoryId);
      }
    }
  }

  private async createContainer(
    trajectoryId: string,
    repository: SandboxRepository,
  ): Promise<void> {
    const existing = this.docker.getContainer(containerName(trajectoryId));
    let details: Docker.ContainerInspectInfo | undefined;
    try {
      details = await existing.inspect();
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    // A deploy that changes the worker image must not discard the checkout of a
    // trajectory that is resuming into this container, so the image it was
    // built from is deliberately not compared here.
    if (
      details?.State.Running &&
      matchesRepository(details.Config.Labels, repository) &&
      matchesGithubToken(details.Config.Env, this.githubToken) &&
      allowsExec(details.HostConfig.Tmpfs)
    ) {
      if (!details.NetworkSettings.Networks["bridge"]) {
        await this.docker.getNetwork("bridge").connect({
          Container: containerName(trajectoryId),
        });
      }
      return;
    }
    if (details) await existing.remove({ force: true, v: true });

    await this.ensureImage();
    const container = await this.docker.createContainer({
      name: containerName(trajectoryId),
      Image: this.image,
      Cmd: [
        "/bin/sh",
        "-c",
        "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done",
      ],
      User: workerUser,
      WorkingDir: workerHome,
      Env: [
        `HOME=${workerHome}`,
        "GH_PROMPT_DISABLED=1",
        ...(this.githubToken ? [`GITHUB_TOKEN=${this.githubToken}`] : []),
      ],
      Labels: {
        [managedLabel]: "true",
        [trajectoryLabel]: trajectoryId,
        [repositoryLabel]: `${repository.owner}/${repository.name}`,
        [branchLabel]: repository.defaultBranch,
      },
      HostConfig: {
        AutoRemove: false,
        CapDrop: ["ALL"],
        Memory: this.memoryBytes,
        NanoCpus: this.nanoCpus,
        NetworkMode: "bridge",
        PidsLimit: this.pidsLimit,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        Tmpfs: {
          [workerHome]: `rw,nosuid,nodev,exec,size=10g,uid=${workerUid.toString()},gid=${workerUid.toString()},mode=0700`,
          "/tmp": "rw,nosuid,nodev,exec,size=2g,mode=1777",
        },
      },
    });
    try {
      await container.start();
      await this.cloneRepository(container, repository);
    } catch (error) {
      await container.remove({ force: true, v: true }).catch(() => undefined);
      throw error;
    }
  }

  private async cloneRepository(
    container: Docker.Container,
    repository: SandboxRepository,
  ): Promise<void> {
    const execution = await container.exec({
      Cmd: [
        "git",
        "clone",
        "--branch",
        repository.defaultBranch,
        "--single-branch",
        "--",
        `https://github.com/${repository.owner}/${repository.name}.git`,
        repositoryPath,
      ],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: workerUser,
      WorkingDir: workerHome,
    });
    const stream = await execution.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutCapture = capture(stdout, this.outputLimitBytes);
    const stderrCapture = capture(stderr, this.outputLimitBytes);
    this.docker.modem.demuxStream(stream, stdout, stderr);
    await finished(stream);
    stdout.end();
    stderr.end();
    const [inspection, out, err] = await Promise.all([
      execution.inspect(),
      stdoutCapture,
      stderrCapture,
    ]);
    if (inspection.ExitCode !== 0) {
      const detail = err.text.trim() || out.text.trim();
      throw new Error(
        `Failed to clone ${repository.owner}/${repository.name}${detail ? `: ${detail}` : ""}`,
      );
    }
  }

  async runCommand(
    trajectoryId: string,
    command: string,
    signal: AbortSignal,
  ): Promise<CommandResult> {
    validateTrajectoryId(trajectoryId);
    if (!command.trim()) throw new Error("Command cannot be empty");
    if (command.length > 4096) throw new Error("Command is too long");
    if (signal.aborted) throw abortError();

    const container = this.docker.getContainer(containerName(trajectoryId));
    const details = await container.inspect();
    if (!details.State.Running) await container.start();

    const execution = await container.exec({
      Cmd: ["/bin/sh", "-lc", command],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: workerUser,
      WorkingDir: repositoryPath,
    });
    const stream = await execution.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutCapture = capture(stdout, this.outputLimitBytes);
    const stderrCapture = capture(stderr, this.outputLimitBytes);
    this.docker.modem.demuxStream(stream, stdout, stderr);

    const onAbort = (): void => {
      stream.destroy(abortError());
      void container.kill().catch((error: unknown) => {
        if (!isNotRunning(error))
          console.error("Failed to stop sandbox", error);
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await finished(stream);
      stdout.end();
      stderr.end();
      const [inspection, out, err] = await Promise.all([
        execution.inspect(),
        stdoutCapture,
        stderrCapture,
      ]);
      return {
        exitCode: inspection.ExitCode ?? 1,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
      stdout.end();
      stderr.end();
    }
  }

  async archive(trajectoryId: string): Promise<void> {
    validateTrajectoryId(trajectoryId);
    await this.creates.get(trajectoryId)?.catch(() => undefined);
    const container = this.docker.getContainer(containerName(trajectoryId));
    try {
      await container.remove({ force: true, v: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async listContainers(): Promise<ManagedContainer[]> {
    const containers = await this.listManagedContainers();
    return containers.map((container) => {
      const trajectoryId = container.Labels[trajectoryLabel];
      const name = container.Names[0]?.replace(/^\/+/, "") ?? container.Id;
      return {
        id: container.Id,
        name,
        ...(trajectoryId === undefined ? {} : { trajectoryId }),
        image: container.Image,
        state: container.State,
        status: container.Status,
        createdAt: new Date(container.Created * 1000),
      };
    });
  }

  async removeContainers({
    keepTrajectoryIds = new Set<string>(),
  }: RemoveContainersOptions = {}): Promise<number> {
    await Promise.allSettled(this.creates.values());
    const containers = await this.listManagedContainers();
    const candidates = containers.filter((container) => {
      const trajectoryId = container.Labels[trajectoryLabel];
      return trajectoryId === undefined || !keepTrajectoryIds.has(trajectoryId);
    });
    const removed = await Promise.all(
      candidates.map(async (container) => {
        try {
          await this.docker
            .getContainer(container.Id)
            .remove({ force: true, v: true });
          return 1;
        } catch (error) {
          if (isNotFound(error)) return 0;
          throw error;
        }
      }),
    );
    return removed.reduce<number>((total, count) => total + count, 0);
  }

  private listManagedContainers(): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({
      all: true,
      filters: { label: [`${managedLabel}=true`] },
    });
  }

  private async ensureImage(): Promise<void> {
    this.imagePromise ??= this.inspectOrPullImage().catch((error: unknown) => {
      this.imagePromise = undefined;
      throw error;
    });
    await this.imagePromise;
  }

  private async inspectOrPullImage(): Promise<void> {
    try {
      await this.docker.getImage(this.image).inspect();
      return;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    const stream = await this.docker.pull(this.image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (error: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

export function containerName(trajectoryId: string): string {
  return `llm-garage-trajectory-${trajectoryId}`;
}

function matchesRepository(
  labels: Record<string, string> | undefined,
  repository: SandboxRepository,
): boolean {
  return (
    labels?.[repositoryLabel] === `${repository.owner}/${repository.name}` &&
    labels[branchLabel] === repository.defaultBranch
  );
}

function allowsExec(tmpfs: Record<string, string> | undefined): boolean {
  return Object.values(tmpfs ?? {}).every((options) =>
    options.split(",").includes("exec"),
  );
}

function matchesGithubToken(
  environment: string[] | undefined,
  githubToken: string | undefined,
): boolean {
  const configuredValue = githubToken
    ? `GITHUB_TOKEN=${githubToken}`
    : undefined;
  return (
    environment?.find((value) => value.startsWith("GITHUB_TOKEN=")) ===
    configuredValue
  );
}

function validateTrajectoryId(trajectoryId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(trajectoryId)) {
    throw new Error("Invalid trajectory ID for Docker container");
  }
}

function capture(
  stream: PassThrough,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const headChunks: Buffer[] = [];
    const headLimit = Math.floor(
      Math.max(0, limit - truncationMarker.length) / 2,
    );
    let headBytes = 0;
    let tail = Buffer.alloc(0);
    let bytes = 0;
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      const headRemaining = Math.max(0, headLimit - headBytes);
      if (headRemaining > 0) {
        const captured = chunk.subarray(0, headRemaining);
        headChunks.push(captured);
        headBytes += captured.length;
        chunk = chunk.subarray(captured.length);
      }
      if (chunk.length === 0) return;
      tail = Buffer.concat([tail, chunk]);
      const tailLimit = Math.max(0, limit - headBytes);
      if (tail.length > tailLimit)
        tail = tail.subarray(tail.length - tailLimit);
    });
    stream.on("end", () => {
      const head = Buffer.concat(headChunks);
      if (bytes <= limit) {
        resolve({
          text: Buffer.concat([head, tail]).toString("utf8"),
          truncated: false,
        });
        return;
      }
      const marker = truncationMarker.subarray(
        0,
        Math.max(0, limit - head.length),
      );
      const tailLimit = Math.max(0, limit - head.length - marker.length);
      resolve({
        text: Buffer.concat([
          head,
          marker,
          tail.subarray(Math.max(0, tail.length - tailLimit)),
        ]).toString("utf8"),
        truncated: true,
      });
    });
    stream.on("error", reject);
  });
}

function abortError(): Error {
  const error = new Error("Command aborted");
  error.name = "AbortError";
  return error;
}

function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404;
}

function isNotRunning(error: unknown): boolean {
  const status = statusCode(error);
  return status === 304 || status === 409;
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("statusCode" in error)) return undefined;
  return typeof error.statusCode === "number" ? error.statusCode : undefined;
}

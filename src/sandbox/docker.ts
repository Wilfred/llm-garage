import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import Docker from "dockerode";
import type { CommandResult, Sandbox } from "./types";

const managedLabel = "com.llm-garage.managed";
const trajectoryLabel = "com.llm-garage.trajectory-id";
const defaultOutputLimit = 64 * 1024;

export type DockerSandboxOptions = {
  docker?: Docker;
  image?: string;
  memoryBytes?: number;
  nanoCpus?: number;
  pidsLimit?: number;
  outputLimitBytes?: number;
};

export class DockerSandbox implements Sandbox {
  private readonly docker: Docker;
  private readonly image: string;
  private readonly memoryBytes: number;
  private readonly nanoCpus: number;
  private readonly pidsLimit: number;
  private readonly outputLimitBytes: number;
  private imagePromise: Promise<void> | undefined;
  private readonly creates = new Map<string, Promise<void>>();

  constructor({
    docker = new Docker(),
    image = "alpine:3.22.5",
    memoryBytes = 512 * 1024 * 1024,
    nanoCpus = 1_000_000_000,
    pidsLimit = 128,
    outputLimitBytes = defaultOutputLimit,
  }: DockerSandboxOptions = {}) {
    this.docker = docker;
    this.image = image;
    this.memoryBytes = memoryBytes;
    this.nanoCpus = nanoCpus;
    this.pidsLimit = pidsLimit;
    this.outputLimitBytes = outputLimitBytes;
  }

  async create(trajectoryId: string): Promise<void> {
    validateTrajectoryId(trajectoryId);
    const pending = this.creates.get(trajectoryId);
    if (pending) {
      await pending;
      return;
    }

    const creation = this.createContainer(trajectoryId);
    this.creates.set(trajectoryId, creation);
    try {
      await creation;
    } finally {
      if (this.creates.get(trajectoryId) === creation) {
        this.creates.delete(trajectoryId);
      }
    }
  }

  private async createContainer(trajectoryId: string): Promise<void> {
    const existing = this.docker.getContainer(containerName(trajectoryId));
    try {
      const details = await existing.inspect();
      if (!details.State.Running) await existing.start();
      return;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    await this.ensureImage();
    const container = await this.docker.createContainer({
      name: containerName(trajectoryId),
      Image: this.image,
      Cmd: [
        "/bin/sh",
        "-c",
        "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done",
      ],
      User: "65534:65534",
      WorkingDir: "/workspace",
      Labels: {
        [managedLabel]: "true",
        [trajectoryLabel]: trajectoryId,
      },
      HostConfig: {
        AutoRemove: false,
        CapDrop: ["ALL"],
        Memory: this.memoryBytes,
        NanoCpus: this.nanoCpus,
        NetworkMode: "none",
        PidsLimit: this.pidsLimit,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        Tmpfs: {
          "/tmp": "rw,nosuid,nodev,noexec,size=64m,mode=1777",
          "/workspace":
            "rw,nosuid,nodev,size=256m,uid=65534,gid=65534,mode=0750",
        },
      },
    });
    await container.start();
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
      User: "65534:65534",
      WorkingDir: "/workspace",
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
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    stream.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, limit - bytes);
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) truncated = true;
    });
    stream.on("end", () => {
      resolve({ text: Buffer.concat(chunks).toString("utf8"), truncated });
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

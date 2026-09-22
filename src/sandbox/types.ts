export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  // Set when the command outstayed its time limit and was stopped.
  timedOut: boolean;
};

// Whether the workspace a trajectory is about to use still holds what an
// earlier turn left there. A container that has to be rebuilt comes back with a
// fresh clone, because the checkout lives on a tmpfs that a stop discards.
export type WorkspaceState = "reused" | "created";

export type SandboxRepository = {
  owner: string;
  name: string;
  defaultBranch: string;
};

export type ManagedContainer = {
  id: string;
  name: string;
  trajectoryId?: string;
  image: string;
  state: string;
  status: string;
  createdAt: Date;
};

export type RemoveContainersOptions = {
  keepTrajectoryIds?: ReadonlySet<string>;
};

export interface ContainerManager {
  listContainers(): Promise<ManagedContainer[]>;
  removeContainers(options?: RemoveContainersOptions): Promise<number>;
}

export interface Sandbox {
  create(
    trajectoryId: string,
    repository: SandboxRepository,
  ): Promise<WorkspaceState>;
  runCommand(
    trajectoryId: string,
    command: string,
    signal: AbortSignal,
  ): Promise<CommandResult>;
  archive(trajectoryId: string): Promise<void>;
}

export class DisabledSandbox implements Sandbox {
  async create(
    _trajectoryId: string,
    _repository: SandboxRepository,
  ): Promise<WorkspaceState> {
    return "reused";
  }

  async runCommand(
    _trajectoryId: string,
    _command: string,
    _signal: AbortSignal,
  ): Promise<CommandResult> {
    throw new Error("Docker sandbox is not configured");
  }

  async archive(_trajectoryId: string): Promise<void> {}
}

export class DisabledContainerManager implements ContainerManager {
  async listContainers(): Promise<ManagedContainer[]> {
    return [];
  }

  async removeContainers(_options?: RemoveContainersOptions): Promise<number> {
    return 0;
  }
}

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
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
  create(trajectoryId: string): Promise<void>;
  runCommand(
    trajectoryId: string,
    command: string,
    signal: AbortSignal,
  ): Promise<CommandResult>;
  archive(trajectoryId: string): Promise<void>;
}

export class DisabledSandbox implements Sandbox {
  async create(_trajectoryId: string): Promise<void> {}

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

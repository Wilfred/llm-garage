export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

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

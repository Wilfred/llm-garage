import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import test from "node:test";
import Docker from "dockerode";
import { containerName, DockerSandbox } from "./docker";

const dockerIntegration = process.env["DOCKER_INTEGRATION_TEST"] === "1";

void test("configures, executes in, and archives one isolated container", async () => {
  const trajectoryId = "trajectory-contract-test";
  let createOptions: Docker.ContainerCreateOptions | undefined;
  let created = false;
  let removed = false;
  const executions: Docker.ExecCreateOptions[] = [];
  const setupEvents: string[] = [];
  const container = {
    inspect: async () => {
      if (!created)
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      return {
        State: { Running: true },
        Config: {
          Image: createOptions?.Image,
          Env: createOptions?.Env,
          Labels: {
            "com.llm-garage.repository": "example/project",
            "com.llm-garage.default-branch": "trunk",
          },
        },
        NetworkSettings: { Networks: { bridge: {} } },
      };
    },
    start: async () => {
      created = true;
      setupEvents.push("start");
    },
    exec: async (options: Docker.ExecCreateOptions) => {
      executions.push(options);
      return {
        start: async () => {
          if (options.Cmd?.[0] === "git") setupEvents.push("clone");
          const stream = new PassThrough();
          setImmediate(() => {
            const command = options.Cmd?.at(-1);
            stream.end(
              options.Cmd?.[0] === "git"
                ? ""
                : command === "verbose"
                  ? `start${".".repeat(100)}end`
                  : "bin\nworkspace\n",
            );
          });
          return stream;
        },
        inspect: async () => ({ ExitCode: 0 }),
      };
    },
    kill: async () => undefined,
    remove: async () => {
      removed = true;
      created = false;
    },
  };
  const docker = {
    getContainer: () => container,
    getImage: () => ({ inspect: async () => ({}) }),
    createContainer: async (options: Docker.ContainerCreateOptions) => {
      createOptions = options;
      return container;
    },
    pull: async () => new PassThrough(),
    modem: {
      demuxStream: (
        source: PassThrough,
        stdout: PassThrough,
        stderr: PassThrough,
      ) => {
        source.pipe(stdout);
        source.once("end", () => stderr.end());
      },
      followProgress: () => undefined,
    },
  } as unknown as Docker;
  const sandbox = new DockerSandbox({
    docker,
    image: "worker:test",
    githubToken: "github_pat_test",
  });
  const repository = {
    owner: "example",
    name: "project",
    defaultBranch: "trunk",
  };

  await sandbox.create(trajectoryId, repository);
  assert.ok(createOptions);
  assert.equal(createOptions.name, containerName(trajectoryId));
  assert.equal(createOptions.Image, "worker:test");
  assert.equal(createOptions.User, "agent");
  assert.equal(createOptions.WorkingDir, "/home/agent");
  assert.deepEqual(createOptions.Env, [
    "HOME=/home/agent",
    "GH_PROMPT_DISABLED=1",
    "GITHUB_TOKEN=github_pat_test",
  ]);
  assert.equal(
    createOptions.Labels?.["com.llm-garage.trajectory-id"],
    trajectoryId,
  );
  const hostConfig = createOptions.HostConfig;
  assert.ok(hostConfig);
  assert.equal(hostConfig.NetworkMode, "bridge");
  assert.equal(hostConfig.ReadonlyRootfs, true);
  assert.deepEqual(hostConfig.CapDrop, ["ALL"]);
  assert.match(hostConfig.Tmpfs?.["/home/agent"] ?? "", /size=10g.*uid=10001/);
  assert.match(hostConfig.Tmpfs?.["/home/agent"] ?? "", /(^|,)exec(,|$)/);
  assert.match(hostConfig.Tmpfs?.["/tmp"] ?? "", /(^|,)exec(,|$)/);
  assert.match(hostConfig.Tmpfs?.["/tmp"] ?? "", /size=2g/);
  assert.equal(hostConfig.Tmpfs?.["/workspace"], undefined);
  assert.deepEqual(setupEvents, ["start", "clone"]);
  assert.deepEqual(executions[0]?.Cmd, [
    "git",
    "clone",
    "--branch",
    "trunk",
    "--single-branch",
    "--",
    "https://github.com/example/project.git",
    "/home/agent/repo",
  ]);
  assert.equal(executions[0].WorkingDir, "/home/agent");

  const result = await sandbox.runCommand(
    trajectoryId,
    "ls /",
    new AbortController().signal,
  );
  assert.deepEqual(result, {
    exitCode: 0,
    stdout: "bin\nworkspace\n",
    stderr: "",
    truncated: false,
    timedOut: false,
  });
  assert.equal(executions[1]?.WorkingDir, "/home/agent/repo");

  const limitedSandbox = new DockerSandbox({
    docker,
    image: "worker:test",
    githubToken: "github_pat_test",
    outputLimitBytes: 64,
  });
  const limitedResult = await limitedSandbox.runCommand(
    trajectoryId,
    "verbose",
    new AbortController().signal,
  );
  assert.equal(Buffer.byteLength(limitedResult.stdout), 64);
  assert.match(limitedResult.stdout, /^start/);
  assert.match(limitedResult.stdout, /\.\.\. output truncated \.\.\./);
  assert.match(limitedResult.stdout, /end$/);
  assert.equal(limitedResult.truncated, true);

  const credentialedOptions = createOptions;
  const uncredentialedSandbox = new DockerSandbox({
    docker,
    image: "worker:test",
  });
  await uncredentialedSandbox.create(trajectoryId, repository);
  assert.ok(createOptions);
  assert.notEqual(createOptions, credentialedOptions);
  assert.deepEqual(createOptions.Env, [
    "HOME=/home/agent",
    "GH_PROMPT_DISABLED=1",
  ]);

  await sandbox.archive(trajectoryId);
  assert.equal(removed, true);
});

void test("reconnects an existing worker container to the bridge", async () => {
  let connectedContainer: string | undefined;
  const container = {
    inspect: async () => ({
      State: { Running: true },
      Config: {
        Image: "ghcr.io/wilfred/llm-garage:worker",
        Labels: {
          "com.llm-garage.repository": "example/project",
          "com.llm-garage.default-branch": "main",
        },
      },
      HostConfig: {
        Tmpfs: {
          "/home/agent": "exec,nosuid,nodev",
          "/tmp": "exec,nosuid,nodev,size=2g",
        },
      },
      NetworkSettings: { Networks: {} },
    }),
  };
  const docker = {
    getContainer: () => container,
    getNetwork: () => ({
      connect: async ({ Container }: { Container: string }) => {
        connectedContainer = Container;
      },
    }),
  } as unknown as Docker;
  const sandbox = new DockerSandbox({ docker });

  await sandbox.create("existing", {
    owner: "example",
    name: "project",
    defaultBranch: "main",
  });

  assert.equal(connectedContainer, containerName("existing"));
});

void test("keeps a worker container built from a superseded image", async () => {
  let connected = false;
  let removed = false;
  const container = {
    inspect: async () => ({
      State: { Running: true },
      Config: {
        Image: "ghcr.io/wilfred/llm-garage:worker@sha256:previous",
        Labels: {
          "com.llm-garage.repository": "example/project",
          "com.llm-garage.default-branch": "main",
        },
      },
      HostConfig: {
        Tmpfs: {
          "/home/agent": "exec,nosuid,nodev",
          "/tmp": "exec,nosuid,nodev,size=2g",
        },
      },
      NetworkSettings: { Networks: {} },
    }),
    remove: async () => {
      removed = true;
    },
  };
  const docker = {
    getContainer: () => container,
    getNetwork: () => ({
      connect: async () => {
        connected = true;
      },
    }),
  } as unknown as Docker;
  const sandbox = new DockerSandbox({ docker, image: "worker:redeployed" });

  await sandbox.create("existing", {
    owner: "example",
    name: "project",
    defaultBranch: "main",
  });

  // Recreating would re-clone over the work a resuming trajectory left behind.
  assert.equal(removed, false);
  assert.equal(connected, true);
});

const stopWorkloadCommand = [
  "/bin/sh",
  "-c",
  "trap '' TERM; kill -TERM -1 2>/dev/null; sleep 2; kill -KILL -1 2>/dev/null; exit 0",
];

// The checkout lives on a tmpfs, so stopping the container would throw away
// work the trajectory can still be resumed onto.
void test("stops the workload rather than the container when cancelled", async () => {
  const commands: string[][] = [];
  let killed = false;
  let removed = false;
  const commandStream = new PassThrough();
  const container = {
    inspect: async () => ({ State: { Running: true } }),
    exec: async (options: Docker.ExecCreateOptions) => {
      const cmd = options.Cmd ?? [];
      commands.push(cmd);
      return {
        // The command itself never finishes on its own.
        start: async () =>
          cmd[1] === "-lc" ? commandStream : new PassThrough(),
        inspect: async () => ({ ExitCode: 0 }),
      };
    },
    kill: async () => {
      killed = true;
    },
    remove: async () => {
      removed = true;
    },
  };
  const docker = {
    getContainer: () => container,
    modem: { demuxStream: demux },
  } as unknown as Docker;
  const sandbox = new DockerSandbox({ docker });

  const controller = new AbortController();
  const pending = sandbox.runCommand(
    "cancelled",
    "sleep 600",
    controller.signal,
  );
  await settle();
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  await settle();
  assert.equal(killed, false);
  assert.equal(removed, false);
  assert.deepEqual(commands[1], stopWorkloadCommand);
});

void test("stops a command that outstays its time limit", async () => {
  const commands: string[][] = [];
  let killed = false;
  const commandStream = new PassThrough();
  const container = {
    inspect: async () => ({ State: { Running: true } }),
    exec: async (options: Docker.ExecCreateOptions) => {
      const cmd = options.Cmd ?? [];
      commands.push(cmd);
      return {
        start: async () => {
          if (cmd[1] === "-lc") {
            setImmediate(() => commandStream.write("working"));
            return commandStream;
          }
          // The workload dies once it is signalled.
          commandStream.end();
          return new PassThrough();
        },
        inspect: async () => ({ ExitCode: 137 }),
      };
    },
    kill: async () => {
      killed = true;
    },
  };
  const docker = {
    getContainer: () => container,
    modem: { demuxStream: demux },
  } as unknown as Docker;
  const sandbox = new DockerSandbox({ docker, commandTimeoutMs: 20 });

  const result = await sandbox.runCommand(
    "slow",
    "sleep 600",
    new AbortController().signal,
  );

  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 137);
  assert.equal(result.stdout, "working");
  assert.equal(killed, false);
  assert.deepEqual(commands[1], stopWorkloadCommand);
});

void test("lists and removes only managed containers that are not kept", async () => {
  const removed: string[] = [];
  let listOptions: Docker.ContainerListOptions | undefined;
  const managedContainers = [
    {
      Id: "active-container-id",
      Names: ["/llm-garage-trajectory-active"],
      Image: "worker:test",
      ImageID: "image-id",
      Command: "/bin/sh",
      Created: 1_788_777_600,
      Ports: [],
      Labels: {
        "com.llm-garage.managed": "true",
        "com.llm-garage.trajectory-id": "active",
      },
      State: "running",
      Status: "Up 2 minutes",
      HostConfig: { NetworkMode: "none" },
      NetworkSettings: { Networks: {} },
      Mounts: [],
    },
    {
      Id: "idle-container-id",
      Names: ["/llm-garage-trajectory-idle"],
      Image: "worker:test",
      ImageID: "image-id",
      Command: "/bin/sh",
      Created: 1_788_777_000,
      Ports: [],
      Labels: {
        "com.llm-garage.managed": "true",
        "com.llm-garage.trajectory-id": "idle",
      },
      State: "exited",
      Status: "Exited (0) 10 minutes ago",
      HostConfig: { NetworkMode: "none" },
      NetworkSettings: { Networks: {} },
      Mounts: [],
    },
  ] satisfies Docker.ContainerInfo[];
  const docker = {
    listContainers: async (options: Docker.ContainerListOptions) => {
      listOptions = options;
      return managedContainers;
    },
    getContainer: (id: string) => ({
      remove: async () => {
        removed.push(id);
      },
    }),
  } as unknown as Docker;
  const sandbox = new DockerSandbox({ docker });

  const listed = await sandbox.listContainers();

  assert.deepEqual(listOptions, {
    all: true,
    filters: { label: ["com.llm-garage.managed=true"] },
  });
  assert.deepEqual(listed, [
    {
      id: "active-container-id",
      name: "llm-garage-trajectory-active",
      trajectoryId: "active",
      image: "worker:test",
      state: "running",
      status: "Up 2 minutes",
      createdAt: new Date("2026-09-07T10:40:00.000Z"),
    },
    {
      id: "idle-container-id",
      name: "llm-garage-trajectory-idle",
      trajectoryId: "idle",
      image: "worker:test",
      state: "exited",
      status: "Exited (0) 10 minutes ago",
      createdAt: new Date("2026-09-07T10:30:00.000Z"),
    },
  ]);

  const count = await sandbox.removeContainers({
    keepTrajectoryIds: new Set(["active"]),
  });

  assert.equal(count, 1);
  assert.deepEqual(removed, ["idle-container-id"]);
});

void test(
  "creates an isolated container, runs a command, and removes it",
  { skip: !dockerIntegration },
  async (t) => {
    const docker = new Docker();
    const trajectoryId = randomUUID();
    const sandbox = new DockerSandbox({ docker });
    t.after(() => sandbox.archive(trajectoryId));

    await sandbox.create(trajectoryId, {
      owner: "octocat",
      name: "Hello-World",
      defaultBranch: "master",
    });
    const details = await docker
      .getContainer(containerName(trajectoryId))
      .inspect();
    assert.equal(
      details.Config.Labels["com.llm-garage.trajectory-id"],
      trajectoryId,
    );
    assert.ok(details.NetworkSettings.Networks["bridge"]);
    assert.equal(details.HostConfig.Privileged, false);

    const result = await sandbox.runCommand(
      trajectoryId,
      "pwd && git remote get-url origin && git branch --show-current && node --version",
      new AbortController().signal,
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^\/home\/agent\/repo$/m);
    assert.match(
      result.stdout,
      /^https:\/\/github\.com\/octocat\/Hello-World\.git/m,
    );
    assert.match(result.stdout, /^master$/m);
    assert.match(result.stdout, /^v22\./m);
    assert.equal(result.stderr, "");

    await sandbox.archive(trajectoryId);
    await assert.rejects(
      docker.getContainer(containerName(trajectoryId)).inspect(),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 404,
    );
  },
);

function demux(
  source: PassThrough,
  stdout: PassThrough,
  stderr: PassThrough,
): void {
  source.pipe(stdout);
  source.once("end", () => stderr.end());
}

// Lets the exec calls made behind an abort or a deadline reach the fake.
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

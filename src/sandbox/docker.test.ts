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
  let disconnected = false;
  const executions: Docker.ExecCreateOptions[] = [];
  const setupEvents: string[] = [];
  const container = {
    inspect: async () => {
      if (!created)
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      return {
        State: { Running: true },
        Config: {
          Env: createOptions?.Env,
          Labels: {
            "com.llm-garage.repository": "example/project",
            "com.llm-garage.default-branch": "trunk",
          },
        },
        NetworkSettings: { Networks: {} },
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
          setImmediate(() =>
            stream.end(options.Cmd?.[0] === "git" ? "" : "bin\nworkspace\n"),
          );
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
    getNetwork: () => ({
      disconnect: async () => {
        disconnected = true;
        setupEvents.push("disconnect");
      },
    }),
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
  assert.equal(createOptions.User, "65534:65534");
  assert.deepEqual(createOptions.Env, ["GITHUB_TOKEN=github_pat_test"]);
  assert.equal(
    createOptions.Labels?.["com.llm-garage.trajectory-id"],
    trajectoryId,
  );
  const hostConfig = createOptions.HostConfig;
  assert.ok(hostConfig);
  assert.equal(hostConfig.NetworkMode, "bridge");
  assert.equal(hostConfig.ReadonlyRootfs, true);
  assert.deepEqual(hostConfig.CapDrop, ["ALL"]);
  assert.equal(disconnected, true);
  assert.deepEqual(setupEvents, ["start", "clone", "disconnect"]);
  assert.deepEqual(executions[0]?.Cmd, [
    "git",
    "clone",
    "--branch",
    "trunk",
    "--single-branch",
    "--",
    "https://github.com/example/project.git",
    "/workspace",
  ]);

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
  });

  const credentialedOptions = createOptions;
  const uncredentialedSandbox = new DockerSandbox({
    docker,
    image: "worker:test",
  });
  await uncredentialedSandbox.create(trajectoryId, repository);
  assert.ok(createOptions);
  assert.notEqual(createOptions, credentialedOptions);
  assert.equal(createOptions.Env, undefined);

  await sandbox.archive(trajectoryId);
  assert.equal(removed, true);
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
    assert.deepEqual(details.NetworkSettings.Networks, {});
    assert.equal(details.HostConfig.Privileged, false);

    const result = await sandbox.runCommand(
      trajectoryId,
      "git remote get-url origin && git branch --show-current && node --version",
      new AbortController().signal,
    );
    assert.equal(result.exitCode, 0);
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

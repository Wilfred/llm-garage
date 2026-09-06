# LLM Garage plan

This plan turns the product described in the README into incremental, testable
milestones. The README is the source of truth for product direction; this file
records the implementation sequence and the technical decisions needed to get
there.

## Product direction

LLM Garage runs agentic coding trajectories against different models on the current
host using Docker. It serves two related jobs:

1. Complete real coding work and open a pull request.
2. Compare models on the same task and build evidence about which models work
   best for a particular user and repository.

The target feature set is:

1. Start a trajectory for a GitHub repository, task prompt, and model, and create a
   pull request from the result.
2. Record the complete trajectory: prompt, model output, tool usage, tokens, elapsed
   time, cost and its source, status, and delivery result. A trajectory can be shared
   publicly by its owner.
3. Let the user choose the best result from a comparison and summarize model
   performance over time.
4. Run linked trajectories from the same prompt and source revision for side-by-side
   A/B testing.
5. Optionally auto-merge a trajectory's pull request when its required CI checks
   pass.
6. Let an agent spawn a durable child trajectory for related work without relying
   on short-lived subagents.

## Scope and principles

- A `Trajectory` is the durable unit from the beginning. There is no temporary
  `Run` abstraction to rename later.
- A trajectory represents one top-level agent execution. Retrying, following up,
  or splitting work creates another linked trajectory and preserves the original.
- Model identity and runner implementation are separate. A model is what the
  user selects and evaluates; a runner is the adapter that invokes an agent.
- A/B comparison membership and spawned-trajectory provenance are separate
  relationships. A parent link records where a child came from; it is not a
  user-curated hierarchy, and the product does not need a general trajectory-tree
  UI. Direct parent or child links can be added later if they prove useful.
- Execution state and pull-request delivery state are separate state machines.
  A coding trajectory can succeed even if pushing a branch or merging a PR fails.
- Every trajectory is reproducible from its stored repository, exact base commit,
  prompt, model configuration, agent protocol version, and tool definitions.
- Secrets are provided only to the process that needs them and never persisted
  in event payloads, logs, or public views.
- The UI remains server-rendered with Preact and progressively enhanced where
  live updates are valuable. A single-page application is not required.
- There is no prompt-library feature. The task prompt belongs to its trajectory;
  runner-generated instructions may be stored as a trajectory snapshot for audit.
- The first real agent uses OpenRouter's Agent SDK. LLM Garage owns the coding
  tools, limits, and durable event history; the SDK owns the model conversation
  and tool-calling loop. Tools execute in the trajectory's Docker workspace. The
  agent contract must remain replaceable without changing stored history.
- The first deployment remains a single trusted operator on one host. Public
  trajectory links are in scope; a general multi-user account and permissions
  system is not.

## Current state

Milestones M1-M3 are complete. The repository currently provides:

- an Express 5 application rendered with Preact and JSX;
- dashboard, repository, trajectory, about, and new-trajectory screens;
- repository and trajectory catalogues persisted in SQLite;
- durable turns and ordered trajectory events used by the clickable prototype;
- linting, unit and route tests, a production build, and a web-app Docker image.

It does not yet run coding agents, manage Docker sandbox containers, interact
with GitHub, calculate model costs, or execute comparisons.

## Architecture

The web process owns the product database, scheduling decisions, and GitHub API
operations. Each running trajectory gets a separate Docker container and workspace.

```text
Browser
   |
Express + Preact SSR
   |-- SQLite: repositories, trajectories, events, comparisons
   |-- scheduler: bounded local queue and recovery
   |-- GitHub: repository metadata, pull requests, checks, merge
   |
Docker engine
   |-- trajectory container + isolated workspace volume
   |     `-- coding tools: read, search, patch, and command execution
   `-- trajectory container + isolated workspace volume

OpenRouter API
   `-- selected model <-> OpenRouter Agent SDK in the web process
```

The process can remain monolithic while the product is single-host. Boundaries
between storage, scheduling, runner adapters, Docker, and GitHub should be kept
explicit so a worker process can be separated later without changing the domain
model.

### Core contracts

`DataStore` owns durable product records and transaction boundaries. Route
handlers use it instead of accessing SQLite or prototype fixtures directly.

`Runner` turns a trajectory specification into normalized events and workspace
changes. Initial implementations are:

- `EchoRunner`, a deterministic test runner with no external credentials;
- `OpenRouterRunner`, which adapts OpenRouter's Agent SDK to normalized trajectory
  events and exposes approved coding tools backed by the trajectory's `Sandbox`.

`ModelSpec` is configuration rather than a database-owned model. It contains a
stable ID, display name, OpenRouter model slug, required capabilities, inference
limits, provider-routing policy, and optional fallback prices for estimation. The
selected spec and request configuration are snapshotted onto a trajectory so history
does not change when configuration changes. Cross-model fallback is disabled for
evaluated trajectories: a trajectory must run the model the user selected. Provider
fallback for that same model is allowed when configured and is recorded in trajectory
metadata.

`TrajectoryScheduler` starts queued work up to a configurable concurrency limit,
records every state transition, supports cancellation, and recovers interrupted
work after process restart.

`Sandbox` creates, executes in, stops, and archives a Docker workspace. Runner
code depends on this interface rather than directly on Dockerode.

`GitHubDelivery` creates branches and pull requests, observes checks, and merges
when requested. It has its own durable state transitions and retry policy.

## Domain model

The TypeORM entities in `src/entities` are the authoritative database schema;
field lists are not duplicated here. Externally referenced records use UUIDs and
timestamps are stored in UTC. Structured provider data is retained as redacted
JSON only when it is useful for debugging or future presentation.

### Repository

The repository catalogue identifies the GitHub project selected for a trajectory.
GitHub metadata needed for checkout will be added to its entity when repository
resolution is implemented.

### Trajectory

Trajectories own durable turns and an append-only event ledger. Derived trajectory
fields keep list pages efficient, while status changes and their events are
committed together. Unknown usage or cost stays explicitly unknown rather than
being represented as zero; estimates are labelled and use snapshotted pricing.

### Trajectory event

Events have a stable, trajectory-wide order so they can later back resumable live
updates. Provider and tool payloads must be redacted before they reach this
ledger.

### Comparison

A comparison groups two to four trajectories created from the same repository,
prompt, and base commit. Its entity will be added with the comparison milestone;
membership remains distinct from parent/child lineage.

### Setting

Settings contain only non-secret operator preferences. Encrypted or
environment-provided credentials remain outside ordinary product records.

## Principal flows

### Single trajectory

1. The user selects a repository, task, model, and delivery mode.
2. The app resolves and stores the repository's exact base commit and snapshots
   the model configuration.
3. A transaction creates the queued trajectory and its first event.
4. The scheduler assigns an isolated Docker workspace and invokes the runner.
5. Runner output is normalized into events and summarized on the trajectory.
6. On success, the user can inspect the diff and create a pull request, unless
   pull-request or auto-merge delivery was selected at creation time.

### Side-by-side comparison

1. The user selects one repository, one prompt, and two to four models.
2. The app resolves one base SHA and creates the comparison and member trajectories
   atomically.
3. Members execute independently under the normal concurrency limit.
4. The comparison page shows status, output, diff, tool activity, tokens, time,
   and cost in aligned columns, including whether cost is reported or estimated.
5. The user selects a winner and can deliver that trajectory as a pull request.
6. Aggregate reporting updates model starts, completions, wins, win rate, elapsed
   time, and cost, with repository filtering.

### Public trajectory

Publishing is an explicit owner action with a warning that code and prompts may
contain sensitive information. Public rendering uses an allowlist of fields and
events rather than reusing an unrestricted private-trajectory response. Private
trajectory IDs return not found on the public route. Secrets and environment values
are redacted before persistence, not merely hidden at render time.

### Spawned child trajectory

An authorized running agent can create a child trajectory for related work. The
child records its source trajectory for provenance, uses a fresh independent
workspace, and starts from the parent's recorded base SHA by default. It does not
implicitly inherit uncommitted filesystem state. A later version may explicitly
accept a pushed commit as its base, but that must be visible in the child record.

## Security and operations

- Run sandboxes as a non-root user with CPU, memory, process, disk, and time
  limits. Apply identifying Docker labels and deny privileged mode.
- Give each trajectory a named workspace volume and branch. Never share a writable
  checkout between trajectories.
- Inject the GitHub credential only into narrowly scoped clone/push operations,
  using an askpass helper or equivalent. Do not expose it to the agent process.
- Keep the OpenRouter credential in the web process that performs inference. It
  must never enter a sandbox container or tool result. Scrub credential values
  and known token patterns before storing or broadcasting events.
- Validate repository URLs, branch names, model IDs, callback payloads, and all
  trajectory/comparison ownership relationships at service boundaries.
- Use parameterized database access, protected state-transition helpers, and
  idempotency keys for enqueue, delivery, and merge operations.
- On startup, reconcile `running` trajectories and in-progress delivery records with
  Docker and GitHub. A restart must not silently duplicate an agent or PR.
- Keep completed workspaces until explicitly archived or an operator retention
  policy expires. Archival removes the Docker resources only after the final diff
  and metadata are durable.
- Emit structured application logs with trajectory IDs but without prompt bodies,
  source code, credentials, or raw provider requests.

## Milestones

### M1-M3 — Application foundation and clickable prototype (complete)

These milestones established the TypeScript application, server-rendered UI,
tests, health checks, Docker packaging, and prototype screens. The prototype data
is deliberately temporary and will be replaced in M4.

### M4 — Persistent trajectory catalogue

Build:

- Add SQLite migrations and database implementations for repositories, trajectories,
  trajectory events, and comparisons.
- Replace production fixture data with `DataStore` calls while retaining explicit
  test factories.
- Make repository creation, the trajectory form, trajectory lists, and trajectory detail
  operate on persistent records.
- Store a forward-compatible trajectory snapshot: prompt, selected model, resolved
  base SHA, execution/delivery states, visibility, metrics, and relationships.
- Add transactional helpers for creating a trajectory and appending state events.

Definition of done:

- A repository and a placeholder trajectory survive an application restart.
- Invalid model, repository, status, and relationship values are rejected.
- Trajectory events retain stable ordering and status/event writes cannot diverge.
- The application no longer depends on seeded prototype records in production.
- Unit, route, migration, build, lint, and container smoke tests pass.

### M5 — Execution core with EchoRunner

Build:

- Define `Runner`, `ModelSpec`, `TrajectoryScheduler`, and normalized event contracts.
- Add a bounded in-process queue with configurable concurrency, cancellation,
  timeouts, and durable state transitions.
- Implement deterministic `EchoRunner` success, failure, tool-event, and usage
  scenarios without external services.
- Stream runner events into the ledger and maintain derived summary and metric
  fields.
- Reconcile queued and interrupted trajectories safely on startup.

Definition of done:

- Three Echo trajectories execute with a configured concurrency of two.
- Success, failure, cancellation, timeout, and restart recovery are covered by
  integration tests.
- Each status change and runner event is durable and ordered.
- Duplicate enqueue requests do not execute a trajectory twice.

### M6 — Docker workspaces and repository checkout

Build:

- Create a pinned sandbox image containing Git, the runner entrypoint, and the
  minimum required tools.
- Implement the `Sandbox` contract with Dockerode: create, execute, stream, stop,
  inspect, archive, and clean up.
- Allocate one labelled container and named volume per trajectory and check out the
  exact stored base SHA onto a unique branch.
- Apply runtime resource limits and an execution deadline.
- Capture the final Git status, diff, and diff statistics before cleanup.
- Run EchoRunner inside the sandbox and make it perform a deterministic file
  change.

Definition of done:

- A queued trajectory checks out the expected commit in an isolated container and
  its resulting diff is visible after completion.
- Concurrent trajectories cannot see or alter one another's files.
- Cancellation stops the container, while archival removes only that trajectory's
  labelled resources.
- Clone authentication is not visible to the runner or recorded events.
- Docker integration tests cover success, timeout, cancellation, and cleanup.

### M7 — OpenRouter coding agent, models, and telemetry

Build:

- Record a compatibility spike against the current `@openrouter/agent` release:
  prove streaming, tool execution, stop conditions, cancellation, error details,
  and access to per-request usage. Pin the SDK and its expected event shapes in
  fixtures.
- Implement `OpenRouterRunner` on the Agent SDK's model-call abstraction. Adapt
  SDK model and tool lifecycle events into LLM Garage events, while keeping SDK
  state behind the `Runner` boundary.
- Start with a small, auditable coding tool set: read files, list files, search,
  apply a patch, and run a command. Constrain tools to the workspace, validate
  arguments, cap output, and record every request and result as redacted events.
- Execute tool calls sequentially initially so mutations and event ordering are
  deterministic. Parallel read-only tools can be added after the contract is
  proven.
- Add an operator-configured model catalogue with at least two selectable
  OpenRouter model slugs that support tool calling. Send provider settings that
  require tool parameters and do not allow fallback to a different model.
- Snapshot the selected model, agent protocol/tool versions, inference limits,
  and provider-routing settings on every trajectory.
- Populate the final summary, tool activity, OpenRouter request/generation IDs,
  upstream model/provider metadata when available, token categories, elapsed
  time, and provider-reported cost. Preserve unknown values honestly when the
  API omits them.
- Enforce maximum agent steps, wall time, tool output, context growth, and
  per-trajectory spend. A limit produces a clear terminal event rather than an
  unbounded loop.
- Present model selection and recorded telemetry on trajectory screens.

Definition of done:

- A real trajectory can run against each of two configured model choices and modify
  its checked-out repository.
- The same runner and tool definitions work for both models without
  provider-specific branches in the agent loop.
- Structured model, tool, and usage events survive restart; the OpenRouter key is
  absent from the sandbox, database, logs, and streamed payloads.
- The sum of per-request usage agrees with stored trajectory token counts and
  provider-reported cost.
- Invalid tool arguments, path escape attempts, malformed responses, missing
  credentials, rate limits, agent limits, and provider interruption end in clear
  states with actionable errors.

### M8 — Pull-request delivery

Build:

- Generate collision-resistant branch names and commit successful trajectory
  changes with an explicit fallback message.
- Push through a credential-isolated Git operation and open a pull request through
  the GitHub API.
- Support delivery selected at trajectory creation and a manual `Create pull
request` action after reviewing a completed trajectory.
- Persist branch, commit, PR, and delivery-state metadata independently from
  execution state.
- Make delivery jobs idempotent and restart-safe; retries reuse the same branch
  and pull request.

Definition of done:

- A successful trajectory opens a correctly based pull request containing its diff.
- A trajectory with `none` delivery can be reviewed and delivered later.
- Empty diffs, push rejection, duplicate requests, API failure, and restart during
  delivery are handled without duplicate PRs.
- GitHub credentials never appear in the runner environment, database, logs, or
  rendered pages.

### M9 — Complete trajectory history and public sharing

Build:

- Add resumable server-sent events with sequence IDs for live trajectory updates.
- Expand private trajectory detail to show prompt, model metadata, timeline, output,
  tool usage, diff, tokens, elapsed time, cost and its source, and delivery outcome.
- Add explicit publish/unpublish actions and a read-only public trajectory route.
- Define and test a public-field allowlist, event redaction policy, and safe error
  presentation.
- Make completed trajectories searchable/filterable by repository, model, state, and
  visibility.

Definition of done:

- Two browser tabs receive ordered live updates and reconnect without gaps or
  duplicate presentation.
- A completed trajectory exposes all metadata listed in the README to its owner.
- A public link works without private access and contains only allowlisted data;
  an unpublished trajectory returns not found from the public route.
- Publishing and unpublishing are audited and covered by route tests.

### M10 — Side-by-side comparisons and feedback

Build:

- Add a comparison form that accepts one repository, one prompt, and two to four
  distinct model choices.
- Resolve one base SHA and transactionally create the comparison and all member
  trajectories with matching inputs.
- Build an aligned comparison view for status, output, diff, tool activity,
  tokens, elapsed time, and cost.
- Let the user select or change a winning trajectory and record an optional note.
- Add model reporting for starts, completions, wins, win rate, elapsed time, and
  cost, overall and filtered by repository.
- Allow the winning result to enter normal pull-request delivery.

Definition of done:

- Two or more models run independently against the exact same prompt and base
  SHA, and configuration differences are visible.
- Partial failures do not hide successful comparison members.
- Selecting a winner immediately and correctly updates aggregate reporting.
- Refreshes and restarts preserve comparison membership and feedback.

### M11 — Drive-by trajectories and auto-merge

Build:

- Implement the `auto_merge` delivery mode on top of the existing PR state
  machine.
- Observe required checks and combined commit status with bounded polling,
  jitter, retry/backoff, and a terminal timeout.
- Persist check observations and resume monitoring after application restart.
- Merge with an operator-configured method only when the expected head SHA is
  still current and all required policy conditions pass.
- Surface pending, blocked, failed, and merged outcomes on trajectory pages.

Definition of done:

- A green pull request is merged once and its merge SHA is stored.
- Failing checks, a changed head SHA, merge conflicts, API throttling, zero-check
  policy, timeout, and restart are covered without accidental merges.
- Manual and automatic delivery share the same audited state transitions.

### M12 — Spawned trajectories and agent control API

Build:

- Add a narrow HTTP API and `garage-ctl` command that let an active sandbox create
  a child trajectory and inspect the trajectories it spawned.
- Issue short-lived, trajectory-scoped bearer credentials to the runner and enforce
  child-count, concurrency, and total-budget limits.
- Give every child an independent durable record, queue slot, workspace, event
  ledger, metrics, and delivery state.
- Keep parent links as provenance. Do not add a general hierarchy browser;
  direct links between a parent and its spawned children are optional.

Definition of done:

- An authorized agent can create a child trajectory, and its source-trajectory link is
  correct after restart.
- The child starts from the recorded base SHA in a fresh workspace and does not
  silently inherit parent filesystem changes.
- Cross-trajectory access, expired credentials, and configured limits are rejected
  and tested.
- Parent cancellation does not corrupt completed children; active-child behavior
  follows an explicit, tested policy.

## Feature-to-milestone map

| README target                                             | Delivery milestones |
| --------------------------------------------------------- | ------------------- |
| Create a pull request for a repository, prompt, and model | M4-M8               |
| Track complete trajectories and allow public sharing      | M4, M5, M7, M9      |
| Record preferred results and summarize model performance  | M10                 |
| Run linked trajectories side by side                      | M10                 |
| Auto-merge when CI is green                               | M11                 |
| Spawn durable child trajectories from an active agent     | M12                 |

## Cross-cutting quality gates

Every milestone must preserve these checks:

- `npm run lint`
- `npm test`
- `npm run build`
- migration tests against both an empty database and the previous schema
- Docker image build and `/health` smoke test when container behavior changes
- negative tests for authorization, validation, secret redaction, and invalid
  state transitions in the affected feature

Changes to OpenRouter request/response handling, agent tool schemas, GitHub
behavior, or cost accounting must use pinned fixtures and documented API
assumptions. Live external-service tests should be a separate opt-in suite so the
normal CI path remains deterministic.

## Deferred decisions

The following should be resolved with short spikes near the milestone that needs
them rather than prematurely expanding the product:

- whether long-running scheduling needs a separate worker process after measuring
  the single-process implementation;
- whether additional inference gateways or packaged coding agents are valuable
  after the OpenRouter agent contract is proven;
- whether public comparisons are useful beyond sharing individual trajectories;
- how to import a parent's committed work as a child base without making
  uncommitted workspace state implicit;
- whether model reports need task tags or richer statistical treatment after
  enough real comparisons exist.

They are not prerequisites for the README's target feature set.

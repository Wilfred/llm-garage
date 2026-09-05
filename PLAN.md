# Plan: llm-garage — Self-hosted LLM Coding Harness

> **This document is the source of truth for the remaining llm-garage work.** It is
> written to be self-contained: any engineer or coding agent should be able to pick up
> the next milestone and execute it using only this file and the existing code. Work in
> milestone order. Verify each milestone's "Definition of done" before starting the
> next. Commit and push at every milestone boundary.

## Context

Wilfred wants a personal, self-hosted web app he can hand a prompt + a GitHub repo; it
runs a coding agent in an isolated Docker sandbox that iterates on the code, then
optionally opens a PR and optionally auto-merges it when CI is green. Core goals:

1. A tool he can **tailor to his own workflows over time**, especially via an editable,
   versioned library of system prompts.
2. **Sessions as first-class objects, running concurrently**: agent runs form a tree,
   and multiple sessions are active at once (not a one-at-a-time queue). An agent can
   spawn subagent sessions and end itself, leaving individual sessions awaiting human
   feedback so the human can iterate on each independently — and several can be making
   progress in parallel while the human reviews others.
3. **Incremental delivery**: every milestone is independently deployable and verified
   end-to-end before the next begins.

**Decisions already made (do not relitigate):**

- Agent engine: **pluggable `Runner` interface; v1 = OpenAI Codex CLI** (`codex exec`
  inside the sandbox container). Additional runners can be added later.
- Sandbox: **Docker containers** via `dockerode` — fresh container per agent turn.
- Frontend: **server-rendered Preact JSX** from Express (`preact-render-to-string`), minimal client JS,
  SSE for live logs. No SPA.
- DB: **SQLite via TypeORM** (`better-sqlite3`); GitHub via **PAT** in env + `octokit`.
- The harness website itself is **packaged in Docker** for deployment.

## Execution notes for future sessions

- Milestones that use containers must be verified on a host with Docker. If Docker is
  unavailable, verify everything Docker-independent and provide the exact remaining
  verification commands.
- Never commit `node_modules/`, `data/`, `dist/`, or `.env`.
- Keep this file focused on remaining work: remove completed milestone sections and
  update any cross-references or assumptions they leave behind.

## Architecture overview

```
Browser ── HTTP/SSE ──> Express app (this repo, runs in Docker)
                           │
                           ├── TypeORM/SQLite (data/app.db on a mounted volume)
                           ├── octokit ──> GitHub API (PRs, checks, merge)
                           ├── dockerode ──> Docker daemon (mounted /var/run/docker.sock)
                           │      └── per-turn sandbox container (git + selected runner)
                           │             └── agent calls back: garage-ctl ──> Agent API
                           └── in-process job queue (p-queue)
```

When the harness itself runs in Docker (production), it needs
`-v /var/run/docker.sock:/var/run/docker.sock` to spawn **sibling** sandbox containers
(not docker-in-docker), and `-v llm-garage-data:/app/data` for the SQLite file.

## Technology choices

| Concern           | Choice                               | Notes                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSX               | Preact + `preact-render-to-string`   | Renders JSX to HTML strings with dynamic text and attributes escaped by default. No client runtime or hydration; raw HTML requires the explicit `dangerouslySetInnerHTML` escape hatch.                                           |
| Server            | Express 5                            | SSE via raw `res.write`.                                                                                                                                                                                                          |
| DB                | TypeORM + `better-sqlite3`, WAL mode | M2 uses `synchronize: true` only for its initial single-table bootstrap. M4 adopts that schema without losing rows, introduces checked-in migrations and permanently switches production and development to `synchronize: false`. |
| Docker            | `dockerode`                          | Per-`exec` env vars are the linchpin of token isolation (see sandbox section).                                                                                                                                                    |
| GitHub            | `octokit` (umbrella pkg)             | PRs, checks, merge.                                                                                                                                                                                                               |
| Queue             | `p-queue`                            | In-process; no Redis. **Concurrency > 1 by default** — env `MAX_CONCURRENT_TURNS` (default 3) governs how many turns run at once; effective ceiling is host RAM ÷ per-container memory. See "Concurrency & resource budgeting".   |
| Config/validation | `zod` + `dotenv`                     | Parsed once in `src/config.ts`.                                                                                                                                                                                                   |
| Dev runner        | `tsx watch`                          | **Gotcha:** esbuild doesn't emit decorator metadata → every TypeORM column declares an explicit type (`@Column("text")`). Never rely on `emitDecoratorMetadata`.                                                                  |
| Lint              | typescript-eslint (flat) + prettier  |                                                                                                                                                                                                                                   |
| IDs               | `nanoid`                             | Session/turn IDs, branch slugs, agent API tokens.                                                                                                                                                                                 |

tsconfig: `jsx: "react-jsx"`, `jsxImportSource: "preact"`,
`experimentalDecorators: true`, `module`/`moduleResolution` `nodenext`, `strict: true`,
`outDir: "dist"`. Pick one module strategy that works for both `tsx` (dev) and
`node dist/` (prod) and verify both actually run.

## Directory layout (final shape — grows milestone by milestone)

```
Dockerfile                    # multi-stage TypeScript harness app image
.dockerignore
sandbox/Dockerfile            # common agent sandbox: git + node + git-askpass + garage-ctl
data/                         # sqlite file (gitignored)
src/
  config.ts                   # zod-parsed env
  db/data-source.ts
  db/migrations/              # ordered, reversible schema changes (M4+)
  entities/                   # Setting, Repo, SystemPrompt, PromptVersion, Session, Turn, TurnEvent
  store/types.ts              # RepoStore, PromptStore, SessionStore and aggregate Stores
  store/memory/               # in-memory fixture stores (M3; replaced one slice at a time)
  store/db/                   # TypeORM-backed stores (M4+)
  server/index.ts             # bootstrap: init DB, mount routes, listen
  server/routes/              # health.ts, pages.tsx, repos.ts, prompts.ts, sessions.ts, sse.ts, agent-api.ts
  views/                      # layout.tsx + pages/*.tsx (Preact SSR)
  prompts/compose.ts          # deterministic composition + versioned snapshots
  runner/types.ts             # Runner interface
  runner/echo.ts              # trivial test runner (no LLM)
  runner/codex.ts             # CodexRunner (v1)
  sandbox/docker.ts           # container/volume create/exec/stream/kill/cleanup
  sandbox/garage-ctl.mjs      # CLI copied into the sandbox image (agent session tool)
  github/client.ts pr.ts checks.ts
  sessions/queue.ts manager.ts events.ts
```

## Data model

There is one durable model from the first orchestration milestone (M6). A session may
initially contain only one turn, but it is never represented as a temporary flat
`Run`; feedback and trees extend the same rows without a later remodel.

- **Setting** — KV rows (`key` primary text, `value` text). E.g. `basePromptId`,
  `defaultMergeMethod`. Values that reference another entity are validated in the
  service transaction that writes them.
- **Repo** — `id`, canonical `owner`, canonical `name`, `defaultBranch`, `archivedAt?`,
  `createdAt`, `updatedAt`. Store owner/name without surrounding whitespace and compare
  them case-insensitively; a unique index prevents duplicate `(owner, name)` entries.
  Validate GitHub owner/name and non-empty branch syntax at the HTTP boundary and again
  in the store. The clone URL is derived (`https://github.com/{owner}/{name}.git`) and
  is never stored with a token. "Delete" archives a repo once prompts or sessions
  reference it, preserving their foreign keys and history.
- **SystemPrompt** — `id`, `name`, `scope: "global" | "repo"`, `repoId?`, `position`,
  `currentVersionId`, `archivedAt?`, timestamps. A check constraint requires `repoId`
  exactly when scope is `repo`; repo and current-version FKs are `RESTRICT`. Partial
  unique indexes make active names unique case-insensitively within the global scope or
  within one repo. `position` plus `id` gives an explicit stable composition order.
- **PromptVersion** — append-only: `id`, `promptId`, monotonically increasing `version`,
  `content`, `note?`, `createdAt`; unique `(promptId, version)`. Editing creates the next
  version and advances `SystemPrompt.currentVersionId` in one transaction. Versions are
  never updated or deleted while referenced by a turn. Archiving a prompt only removes
  it from future composition.
- **Session** — `id`, `parentId?` (self-FK), `rootId`, `repoId`, `title`, `runnerName`,
  `runnerConfigSnapshot`, `status`, `branchName`, `workspaceVolume?`,
  `runnerStateVolume?`, PR policy/result fields including a separate `deliveryStatus`,
  `baseCommitSha?`, `resultCommitSha?`, timestamps. `repoId` is `RESTRICT` and the
  runner selection/config are frozen when the session is created. Session statuses
  cover `queued | running | awaiting_feedback | succeeded | failed | cancelled |
archived`. Delivery is orthogonal: `none | pending | pr_created | awaiting_checks |
merging | merged | merge_failed`, so a session can remain reviewable while a PR is
  open and execution transitions never overwrite delivery state.
- **Turn** — one runner invocation: `id`, `sessionId`, `sequence`, `kind: "initial" |
"feedback" | "spawn"`, `prompt`, `promptSnapshot` (versioned JSON),
  `composedSystemPrompt`, `runnerStateRef?`, `status`, `containerId?`, `summary?`,
  `diffPatch?`, `diffStat?`, `startCommitSha?`, `resultCommitSha?`, `error?`, timestamps.
  Unique `(sessionId, sequence)` orders turns without relying on timestamps. Turn
  statuses are `queued | running | succeeded | failed | cancelled`. The exact prompt
  components and runner inputs are frozen before the turn is queued; the captured diff
  makes the review promised by the session UI durable after its container exits.
- **TurnEvent** — autoincrement `id` (also the SSE `Last-Event-ID`), `turnId`, `kind:
"log" | "status" | "system"`, `data`, `ts`. Every emitted log chunk and transition
  lands here. Index `(turnId, id)` for replay; deleting a session cascades to turns and
  events only through an explicit administrative purge, never through the normal
  archive flow. Index session `rootId`, repo, status/delivery status and queued Turn
  lookups used by recovery and dashboards.

Every schema change from M4 onward is a checked-in TypeORM migration. Application
startup runs pending migrations before serving traffic and aborts on migration failure.
M4 includes an adoption migration for existing M2 databases: it detects/verifies the
existing `Setting` table, preserves its rows, creates migration metadata and adds the
repo schema. Before applying a migration in production, copy `app.db` plus its WAL/SHM
files while the app is stopped (or use SQLite's online backup API). CI verifies both a
fresh database and upgrade fixtures from every previously released schema. No milestone
plans data loss or an ad-hoc one-off conversion.

## Session orchestration

- `sessions/queue.ts`: p-queue with `concurrency = MAX_CONCURRENT_TURNS` (default 3) —
  up to N turns execute simultaneously. Creation transactionally persists a Session,
  its first queued Turn and its prompt snapshot before enqueueing work. On startup,
  re-enqueue queued turns, reconcile running turns against labeled containers, and
  sweep only resources that cannot be matched to a durable nonterminal turn.
- `sessions/manager.ts` — `executeTurn(turnId)`: compare-and-set `queued → running` →
  create/reuse the session workspace → create a fresh container → clone/checkout on
  the first turn → invoke the runner → capture diff/commit metadata → update turn
  and session state. Later PR/CI milestones operate on the Session. A transaction
  records each state change with its TurnEvent; external side effects are reconciled
  idempotently after restart.
- `sessions/events.ts`: per-turn EventEmitter; each event is (a) redacted and inserted
  as a TurnEvent, then (b) broadcast to subscribers. Redaction covers all configured
  runner credentials and the GitHub token, not only provider-specific variable names.
- SSE `GET /sessions/:sessionId/turns/:turnId/events`: replay TurnEvents past
  `Last-Event-ID`, then live; heartbeat every 25s; close on terminal turn status.
- Cancellation: `POST /sessions/:id/cancel` aborts the active turn, force-removes its
  container and records `cancelled`. Timeout uses `TURN_TIMEOUT_MINUTES` (default 30).

### Concurrency & resource budgeting

Multiple active sessions is a first-class requirement, so the queue runs several turns
at once. The consequences to design for:

- **Host memory is the real limit.** Each turn is a container capped at `Memory: 2GB`
  (env `SANDBOX_MEMORY_MB`). So `MAX_CONCURRENT_TURNS × SANDBOX_MEMORY_MB` must fit in
  host RAM with headroom for the harness itself. Document this; on startup, log the
  computed budget and warn if it exceeds a configured `HOST_MEMORY_MB`. The queue — not
  the number of sessions — is the throttle: you can have 50 sessions and only N running.
- **SQLite is not the bottleneck.** The app is a single process with a single
  better-sqlite3 connection, which serializes queries in-process — concurrent turns
  never produce `SQLITE_BUSY` against each other (WAL + `busy_timeout` still set for
  safety). Because writes are synchronous and block the event loop, batch high-frequency
  TurnEvent log inserts (coalesce a container's stdout into ~250ms flushes) so N chatty
  turns don't stall the server. This batching is the one concurrency-specific code
  change; everything else (per-turn EventEmitter, SSE, CI pollers, containers, branches,
  workspaces) is already per-session or per-turn and parallel-safe by construction.
- **GitHub API pressure**: N concurrent CI pollers share the PAT's rate limit; keep the
  45s interval and jitter poll start times so they don't align.
- **Fairness**: p-queue is FIFO. Spawned child turns enqueue behind existing work
  rather than preempting it, so a fan-out can't starve the human's manual runs. Adjust
  later if a priority lane is wanted.

## Docker sandbox & token isolation

`sandbox/Dockerfile` provides the common runtime (Node, git, git-askpass, `garage-ctl`
from M12 and a non-root `agent` user). Runner-specific images layer their CLI and pinned
version on top; the v1 Codex image installs `@openai/codex`. Containers mount the
session's repository workspace at `/work` and a separate persistent, runner-private
state directory at `/runner-state`.

The sandbox container is created with **no secrets in its env**. Docker `exec` supports
per-exec env, so:

- **Clone/push execs:** `GIT_ASKPASS=/usr/local/bin/git-askpass`, `GIT_TOKEN=<pat>`,
  `GIT_TERMINAL_PROMPT=0`. The remote URL is plain `https://github.com/o/r.git` — the
  token never touches `.git/config`, history, or the agent's environment.
- **Runner exec:** only the credentials declared by the selected Runner adapter (plus
  `GARAGE_SESSION_TOKEN`/`GARAGE_API_URL` from M12). The process cannot read the GitHub
  token. Credential names and redaction values come from the adapter/config registry;
  orchestration does not special-case a provider.

HostConfig limits: `Memory: 2GB`, `NanoCpus: 2e9`, `PidsLimit: 512`. Network: default
bridge in v1 (codex and git need egress); egress filtering is a future hardening item.
All containers and volumes labeled `llm-garage=1` for reaping.

## Runner interface (pluggable)

```ts
interface Runner {
  descriptor: {
    name: string;
    version: string;
    capabilities: {
      continuation: "native" | "context" | "none";
      structuredEvents: boolean;
    };
  };
  run(ctx: {
    // Bound to the turn's container.
    exec: (cmd: string[], env: Record<string, string>) => ExecStream;
    workdir: string;
    stateDir: string; // persistent, opaque to the harness
    taskPrompt: string;
    systemPrompt: string;
    continuation?: {
      previousTurnId: string;
      priorSummaries: string[];
      opaqueStateRef?: string;
    };
    onEvent: (e: RunnerEvent) => void; // logs / normalized progress
    signal: AbortSignal; // cancellation/timeout
  }): Promise<{
    status: "succeeded" | "failed";
    summary?: string;
    opaqueStateRef?: string;
  }>;
}
```

The harness owns workspace lifecycle, prompt snapshots, events, cancellation and
credentials. Each adapter owns its CLI invocation and everything under `/runner-state`;
the harness persists only the adapter's optional opaque reference and never assumes a
provider's on-disk convention. The selected runner name, adapter version, non-secret
config and advertised capabilities are recorded with the session/turn. A native-resume
adapter consumes its opaque state; a context-resume adapter receives prior summaries;
an adapter with neither capability still gets the persistent repository workspace.

- **EchoRunner** (M6): ignores the LLM, writes a marker file, echoes the prompt, and
  advertises context continuation. It verifies the pipeline without provider keys.
- **CodexRunner** (M7) is one adapter implementation. It pins and verifies the Codex CLI,
  maps its structured output to RunnerEvents and keeps any native continuation metadata
  under `/runner-state`. It passes the composed system prompt through an adapter-owned
  invocation/config mechanism outside `/work`; it must never replace or delete a
  repository's own instruction files. Exact flags and state handling are established by
  a throwaway-container spike against the pinned version, not encoded into the generic
  session contract.

## GitHub flow

- Fine-grained PAT scoped to the target repos: Contents RW, Pull requests RW,
  Checks/Statuses R.
- Branch naming: `llm-garage/session-{id}-{slug(initialPrompt, 30)}`.
- PR: `octokit.rest.pulls.create({ base: defaultBranch, head, title, body })`; body
  includes the task prompt + a link back to the local session page.
- **CI watching: polling, not webhooks** (self-hosted, possibly behind NAT). For each
  session whose `deliveryStatus` is `awaiting_checks`, poll every 45s:
  `checks.listForRef` + combined status for the head SHA. All green →
  `pulls.merge({ merge_method })` → `merged`. Any failure/conflict → `merge_failed`
  with the reason as a TurnEvent. Deadline 2h → `merge_failed(timeout)`.
  Expected checks come from repo policy. Missing checks remain pending/fail at the
  deadline unless that repo explicitly allows no CI. Pollers are rebuilt from DB state
  on server restart.

## Prompt composition & tailoring

Prompt composition is a pure, versioned function. In the transaction that creates a
turn, resolve and lock these components in order:

1. the current version of the configured global base prompt, if any;
2. active repo prompts ordered by `(position, id)`;
3. optional turn-specific system-prompt additions;
4. generated harness-tool instructions, when that capability is enabled.

The composer emits both `composedSystemPrompt` and a canonically serialized
`promptSnapshot` JSON document with a schema version, composer version, the separate
task/feedback prompt, and each ordered system component's kind/label, prompt ID,
PromptVersion ID/version, SHA-256 content hash and exact content. Include a SHA-256 of
the final rendered system prompt too. Prompt selection, snapshot insertion and queued
Turn creation are one transaction, so an edit racing with enqueue can produce either
complete version but never a mixture. Preview calls the same composer with an explicit set of version IDs;
the submit endpoint recomputes and displays any changed result rather than trusting
hidden browser content. The session page shows the immutable snapshot ("what the runner
actually saw"). `/prompts` offers append-only edit/history; later polish adds version
diffs and "clone prompt from turn".

## Sessions & the agent session-control tool

The end state the user wants: an agent can **decompose work into subagent sessions and
get out of the way** — spawn children, end itself, and let the human iterate on each
child session individually.

### Session semantics (M6 onward)

- The schema supports a tree (`parentId`); M12 enables child creation and its tree UI.
  From M6, the dashboard shows an **"active" list** (sessions whose current turn is
  `running` or `queued`) and an **"awaiting feedback" inbox**. Multiple sessions are
  active at once, bounded by `MAX_CONCURRENT_TURNS`.
- A session's workspace is a named docker volume that persists across turns; each turn
  runs in a fresh container with that volume mounted at `/work`. Because every session
  has its own volume, branch, and container, concurrent sessions are fully isolated —
  no extra locking needed.
- **Per-session turn serialization:** a single session runs at most one turn at a time
  (a feedback turn can't start until the prior turn ends), but _different_ sessions run
  concurrently. The queue enforces both: one in-flight turn per session, ≤ N in-flight
  turns overall.
- **Human feedback loop:** a session that finishes a turn goes to `awaiting_feedback`
  (unless archived/failed). The human opens it, reads the transcript/diff, and either
  (a) sends feedback → new `feedback` Turn in the same workspace, (b) completes it,
  triggering configured PR delivery, or (c) archives it.
- **Archive:** terminal. Sets status `archived`, force-removes any container, deletes
  workspace and runner-state volumes, and keeps transcript rows for history.

### Agent API + `garage-ctl` (M12)

The agent controls sessions through a tiny CLI (`garage-ctl`, a single-file Node script
baked into the sandbox image) that talks HTTP to the harness. CLI-over-HTTP is
engine-agnostic — any runner that can shell out can use it.

- **Reachability:** the harness listens on the docker bridge; sandbox containers get
  `--add-host=garage.host:host-gateway` (Linux: requires the daemon's
  `host-gateway` support; fallback is the bridge gateway IP). `GARAGE_API_URL`
  env points at it.
- **Auth:** per-turn bearer token (`GARAGE_SESSION_TOKEN`, nanoid) injected only into
  the agent exec's env; scoped to that session's tree; revoked when the turn ends.
- **Endpoints** (`src/server/routes/agent-api.ts`, all JSON):
  - `GET  /api/agent/sessions` — list sessions in the caller's tree: id, title, status,
    parentId, last-turn summary.
  - `GET  /api/agent/sessions/:id` — one session: metadata + recent transcript events.
  - `POST /api/agent/sessions` — spawn a child: `{title, taskPrompt, systemPromptExtra?}`.
    While the request blocks, create a filesystem-consistent repository checkpoint of
    the caller's current workspace (including tracked and untracked changes, excluding
    runner-private state), record its commit/hash as the child's provenance, seed a new
    workspace volume from that immutable checkpoint, and create the child's branch.
    Then persist the child Session + initial Turn as `queued`. Returns the child id.
  - `POST /api/agent/sessions/:id/archive` — archive a session in the caller's tree.
  - `POST /api/agent/self/finish` — end the caller's own turn:
    `{status: "awaiting_feedback" | "succeeded", messageForHuman}`. This is how a parent
    "closes itself" after spawning children.
- **`garage-ctl` subcommands** map 1:1: `list`, `show <id>`, `spawn --title … --prompt …`,
  `archive <id>`, `finish --status … --message …`. Output is compact JSON for the agent
  to read.
- **Prompt wiring:** when creating a tool-enabled turn, the harness appends a generated
  "Harness tools" component before freezing the prompt snapshot, so every engine learns
  the tool the same way and the exact generated instructions remain auditable.
- **Safety rails:** spawn depth ≤ 3, ≤ 8 live children per session, children inherit
  the queue (no fan-out past `MAX_CONCURRENT_TURNS`), tokens are tree-scoped so an agent
  can never see or archive unrelated sessions.

## Security

- Secrets only in process env + per-exec docker env; never in DB rows or views;
  redaction pass on log lines before persistence.
- Dynamic JSX text and attributes escaped by default; raw HTML requires an explicit
  `dangerouslySetInnerHTML` use and must never receive unsanitized input.
- Non-root container user, resource limits, fresh container per turn, label-based
  reaping of containers and volumes.
- App binds `127.0.0.1` by default (env `HOST`); the agent API binds the docker bridge
  and requires a bearer token; optional basic-auth middleware via env if the UI is ever
  exposed beyond localhost.

---

## Milestones

Each milestone lists **Build** and **Definition of done** (verification). Do not start
milestone N+1 until N's definition of done has been demonstrated. Commit + push at each
boundary, then remove the completed milestone from this document.

### M4 — Durable persistence foundation + repos

> Replaces only the repos slice of the M3 stores; prompt and session fixtures remain
> explicitly in memory until M5 and M6.

**Build:** add migration commands and an M2 adoption migration, switch
`synchronize: false`, and run migrations before listening. Add the constrained `Repo`
schema described above and a TypeORM `RepoStore`; wire it into the mixed `Stores`
aggregate. `/repos` supports list/add/edit/archive. Normalize and validate owner/name,
reject case-insensitive duplicates, and derive clone URLs without credentials. Do not
hard-delete rows: archive hides them from new-session choices while preserving durable
references added by later milestones.

**Definition of done:** a fresh database and a copy of an M2 database both migrate
without losing `Setting` rows; migration up/down tests pass; duplicate/case-variant
repos are rejected; edit/archive through the browser survives restart; `synchronize`
is false in every non-test configuration; lint and tests are clean.

### M5 — Durable prompt library + deterministic composition

**Build:** migrations for constrained `SystemPrompt` and append-only `PromptVersion`;
a transactional TypeORM `PromptStore`; `/prompts` list/create/archive, append-version
edit and immutable history; and a validated global-base setting. Implement the pure,
versioned composer and prompt-snapshot schema described above. A prompt creation/edit
transaction assigns the next per-prompt version and advances `currentVersionId`;
normal UI operations never mutate or delete PromptVersion rows. Replace only the
prompt slice in `Stores`.

**Definition of done:** create a prompt and edit it twice → versions 1/2/3 remain
readable with stable IDs and timestamps; invalid scope/repo combinations and duplicate
names fail cleanly; set a global base, order two repo prompts, and prove repeated
composition yields byte-identical output/snapshot; an old explicit-version snapshot is
unchanged after further edits; all data survives restart and fresh/upgrade migration
tests pass.

### M6 — Durable session/turn pipeline with EchoRunner

**Build:** migrations for `Session`, `Turn` and `TurnEvent` exactly as the durable core
model—there is no intermediate `Run` entity. Add the common sandbox image and
`sandbox/docker.ts` (create/exec-with-env/stream/kill, labels, persistent workspace and
runner-state volumes); `sessions/queue.ts`, `manager.ts`, and `events.ts`; transactional
state transitions; log redaction; and EchoRunner. Creating a session transactionally
freezes runner config and prompt versions and inserts its initial queued Turn. Each turn
uses a fresh container but the same session volumes. Wire the real `SessionStore`, the
session detail/transcript/diff page, feedback (append a Turn), complete, cancel and
archive actions. Enforce one active turn per session, the global concurrency bound,
timeout, startup reconciliation and idempotent cleanup. Clone uses git-askpass with
read-only PAT access; completing a session stops at `succeeded` with no GitHub writes.

**Definition of done (Docker host):** create a session against a scratch repo → its
first turn walks `queued → running → succeeded` and the Session becomes
`awaiting_feedback`; refresh still shows prompt snapshot, events and captured diff;
send feedback → sequence 2 runs in the same workspace and sees sequence 1's file;
complete → Session `succeeded`; archive → both volumes disappear while rows and
transcript remain. Cancel leaves no container. Restart re-enqueues queued work and
reconciles an interrupted turn without duplicating it. The PAT appears in no TurnEvent.
With `MAX_CONCURRENT_TURNS=2`, three independent sessions run exactly two at once, and
two turns of one session never overlap.

### M7 — First production runner adapter (Codex)

**Build:** keep orchestration provider-agnostic and implement Codex only as the first
registered Runner. Spike the pinned CLI in a throwaway container to establish its
non-interactive invocation, structured output, credentials and continuation behavior.
Implement `runner/codex.ts`, a runner-specific image layer and config validation; map
output to RunnerEvents, keep private state outside `/work`, and never alter repository
instruction files. Advertise the observed continuation capability honestly: native
opaque state if reliable, otherwise context continuation using durable summaries.

**Definition of done (Docker host):** run "add a haiku to README.md" with Codex → the
turn succeeds and its persisted diff shows the edit; send feedback → the adapter
continues according to its advertised capability and sees prior workspace changes;
the session manager contains no Codex/OpenAI path, flags or state conventions; selecting
Echo requires no Codex credentials and still passes M6's checks.

### M8 — Live turn logs via SSE

**Build:** `sse.ts` route (TurnEvent replay from `Last-Event-ID`, live subscribe, 25s
heartbeat, close on terminal turn status); the single `EventSource` snippet in the
session page; live turn/session status badges.

**Definition of done:** open a session page, then enqueue feedback from another tab →
logs stream without refresh; reload mid-turn → no lost/duplicate rendered events;
two tabs and two concurrent sessions stream independently.

### M9 — Push + PR creation

**Build:** when a session is completed with `createPr`, create an idempotent checkpoint
commit if needed, push using askpass, and create/reconcile one PR via `github/client.ts`
and `pr.ts`. Track delivery separately from execution (`pending → pr_created`) and show
the PR link on the session page. A retry searches by recorded head branch/PR number
before issuing another external write. With `createPr` off, completion remains local.

**Definition of done (Docker host):** complete a Codex session with `createPr` on → one
PR appears with prompt-derived title/body and the session's final diff; restart at each
push/PR boundary → reconciliation creates neither a duplicate branch action nor a
second PR; `git log`/`git config -l` expose no token; toggle off pushes nothing.

### M10 — CI polling + auto-merge

**Build:** `github/checks.ts` poller (45s interval, per session, rebuilt from DB on
startup); delivery states `awaiting_checks/merging/merged/merge_failed`; `autoMerge`
and merge-method settings; explicit per-repo policy for whether no CI is acceptable;
2h deadline. Compare-and-set transitions and GitHub reconciliation make retries safe.

**Definition of done (Docker host):** an expected always-green GitHub Action causes an
auto-merge; a failing/missing expected check records `merge_failed` with the reason in
a TurnEvent; a repo without expected checks merges only when its explicit no-CI policy
allows it; restart during polling or merge converges on the real GitHub state.

### M11 — Tailoring and review polish

**Build:** composed-prompt preview on the new-session form using the production
composer; immutable per-turn component/version details on the session page; "new
session from this turn" with explicit version choices; durable per-turn diff display;
prompt-version diff view; recent-sessions dashboard; optional basic auth via env.

**Definition of done:** edit and reorder repo prompts, preview composition, run,
inspect the exact version IDs/content hashes and diff, then create a new session pinned
to the old versions; later prompt edits do not change either historical Turn.

### M12 — Agent-controlled session trees (`garage-ctl` + Agent API)

**Build:** add `parentId`/`rootId` tree behavior to the already-durable Session model;
tree UI, active list and awaiting-feedback inbox; `agent-api.ts` with per-turn,
tree-scoped bearer tokens; `sandbox/garage-ctl.mjs` (`list/show/spawn/archive/finish`);
sandbox-to-harness networking; generated harness-tools prompt component; depth/live
child limits. Implement the immutable parent-workspace checkpoint protocol described
above before queueing a child. `finish` records intent, requests runner cancellation,
and lets the manager own the single terminal transition after the process exits.

**Definition of done (Docker host):** a parent instructed to split work spawns two
children from an exact recorded parent checkpoint and finishes; the parent and children
render as a tree and each child accepts independent feedback; child changes cannot race
with later parent changes; forged/expired tokens get 401 and a child cannot affect an
unrelated tree; restart preserves the tree, provenance, prompts and all transcripts.

---

## Risk register

1. **Runner CLI/auth churn** — the first Codex adapter is spiked and pinned in M7;
   adapter-specific flags, credentials and private state stay out of orchestration, and
   EchoRunner keeps the durable pipeline independently verifiable.
2. **Continuation capability varies by runner** — advertise `native`, `context` or
   `none` based on integration tests. Persist adapter state opaquely and always preserve
   the repository workspace; never silently claim native continuation.
3. **Linux `host-gateway` support** (M12) — needs Docker ≥ 20.10; fallback to the
   bridge gateway IP from `dockerode`'s network inspect.
4. **Migration/SQLite upgrade failure** — mitigated by stopping before listen, documented
   backups, checked-in migrations, and CI upgrade fixtures from every released schema.
5. **Repository rename/transfer** — owner/name is the v1 identity. Add a stable provider
   repository ID before automatic rename discovery; meanwhile edits are explicit and
   historical sessions keep their recorded repo/base-commit provenance.
6. **Zero-CI repos in auto-merge** — never infer green merely from delayed/missing
   checks; require expected checks or an explicit per-repo no-CI policy.
7. **Open container egress in v1** — documented hardening item.
8. **Host resource exhaustion from concurrency** — N concurrent 2GB containers can
   OOM the host. Mitigated by the `MAX_CONCURRENT_TURNS × SANDBOX_MEMORY_MB` budget
   check on startup and hard per-container limits; the queue caps in-flight turns
   regardless of how many sessions exist.
9. **Event-loop stalls under many chatty concurrent turns** — synchronous SQLite
   writes × N high-log turns; mitigated by batching TurnEvent inserts (~250ms flush).
10. **Child checkpoint consistency and disk growth** — M12 blocks spawn until an
    immutable checkpoint is complete and records its provenance; cap live children and
    workspace bytes, and clean both workspace and runner-state volumes on archive.

## Critical files

- `src/sessions/manager.ts` — turn lifecycle; docker/runner/github/events meet here
- `src/sandbox/docker.ts` — container + volume lifecycle, per-exec-env token isolation
- `src/db/migrations/` — durable schema history and upgrade path
- `src/prompts/compose.ts` — deterministic prompt composition + snapshots
- `src/runner/codex.ts` — first Runner adapter; no provider assumptions outside it
- `src/server/routes/agent-api.ts` — the agent's session-control surface (M12)
- `src/entities/` — Session/Turn/TurnEvent state; the schema everything hangs off
- `src/server/index.ts` — Express bootstrap

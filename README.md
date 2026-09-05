# llm-garage

A self-hosted harness for LLM coding agents. Give it a prompt and a GitHub
repository, and it runs a coding agent in an isolated Docker sandbox that
iterates on the code, then (optionally) opens a pull request and (optionally)
auto-merges it once CI is green.

It's built to be **tailored to your own workflow over time** — especially through
a versioned, composable library of system prompts — and to treat **agent sessions
as a concurrent tree**: an agent can spawn subagent sessions and hand each back
for independent human feedback, with several sessions making progress in parallel
while you review others.

**Status: early.** See [PLAN.md](PLAN.md) for the full design and milestone roadmap.

## Stack

Express 5 · server-rendered JSX (Preact) · TypeORM + SQLite · dockerode ·
octokit · `p-queue`. TypeScript throughout, packaged in Docker. The agent engine
sits behind a pluggable `Runner` interface (v1: OpenAI Codex CLI); Claude-based
runners can be added later.

## Development

```sh
npm install
cp .env.example .env   # defaults are fine for local dev
npm run dev            # tsx watch, http://127.0.0.1:3000
```

- `npm run build && npm start` — compiled production run
- `npm run lint` — eslint
- `npm test` — unit tests, including default HTML-escaping coverage
- `npm run format` — prettier

Application data is stored in `DATA_DIR/app.db` (`data/app.db` by default). The
SQLite database uses WAL mode and is created automatically on first startup.

## Docker

```sh
docker build -t llm-garage .
docker run --rm -p 3000:3000 -v llm-garage-data:/app/data llm-garage
```

From M6 onward the container also needs the Docker socket to spawn sandbox
containers: `-v /var/run/docker.sock:/var/run/docker.sock`.

## Influences & similar projects

llm-garage is a personal take on ideas explored by a wave of agentic coding
tools. These shaped the design or serve as useful points of comparison:

- **[Claude Code](https://github.com/anthropics/claude-code)** (Anthropic) — the
  agent-in-a-loop CLI, and the closest reference for how a coding agent drives a
  repo. Its [web/cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web)
  are the model for running agents in ephemeral cloud sandboxes with PR automation.
- **[Cursor](https://cursor.com)** — its Background / Cloud Agents run tasks in
  cloud VMs and open PRs; a reference for fire-and-forget, parallel agent runs.
- **[OpenHands](https://github.com/All-Hands-AI/OpenHands)** (All Hands AI,
  formerly OpenDevin) — the closest open-source analog: a sandboxed runtime, a
  model-agnostic agent, microagents for per-repo tailoring, and a GitHub issue
  resolver. A candidate to wrap behind the `Runner` interface rather than
  reimplement its agent + sandbox.
- **[OpenAI Codex CLI](https://github.com/openai/codex)** — the v1 agent engine
  driven behind llm-garage's pluggable `Runner`.
- **[Aider](https://aider.chat)** — terminal pair-programmer with git-native,
  commit-shaped edits; an influence on keeping agent changes reviewable.
- **[SWE-agent](https://github.com/SWE-agent/SWE-agent)** (Princeton NLP) —
  research on the agent–computer interface and automated issue fixing (SWE-bench).
- **[Devin](https://devin.ai)** (Cognition) — the original "autonomous AI
  software engineer" framing.
- **[GitHub Copilot coding agent](https://github.com/features/copilot)** —
  issue → PR automation from the incumbent.

What llm-garage does that most of these don't: treat **sessions as a tree the
agent itself manages** (spawn subagents, finish yourself, let a human iterate on
each leaf), keep a **versioned system-prompt library** composed per run, make
**auto-merge on green CI** a first-class toggle, and swap the whole **agent engine**
(not just the model) behind one `Runner` interface.

import type {
  CreatePromptInput,
  CreateRepoInput,
  CreateSessionInput,
  DataStore,
  DeleteRepoResult,
  PromptVersion,
  Repo,
  RunEvent,
  Session,
  SystemPrompt,
  Turn,
} from "./types";

type MemoryStoreOptions = {
  seed?: boolean;
  simulationStepMs?: number;
};

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

export class MemoryDataStore implements DataStore {
  private readonly repos = new Map<string, Repo>();
  private readonly prompts = new Map<string, SystemPrompt>();
  private readonly versions = new Map<string, PromptVersion>();
  private readonly sessions = new Map<string, Session>();
  private readonly turns = new Map<string, Turn>();
  private readonly events = new Map<string, RunEvent>();
  private readonly timers = new Map<string, NodeJS.Timeout[]>();
  private readonly simulationStepMs: number;
  private basePromptId?: string;
  private sequence = 100;
  private lastTimestamp = 0;

  constructor({ seed = true, simulationStepMs = 500 }: MemoryStoreOptions = {}) {
    this.simulationStepMs = simulationStepMs;
    if (seed) this.seed();
  }

  async listRepos(): Promise<Repo[]> {
    return this.byNewest(this.repos.values());
  }

  async getRepo(id: string): Promise<Repo | undefined> {
    return this.repos.get(id);
  }

  async createRepo(input: CreateRepoInput): Promise<Repo> {
    const repo: Repo = { id: this.id("repo"), ...input, createdAt: this.now() };
    this.repos.set(repo.id, repo);
    return repo;
  }

  async deleteRepo(id: string): Promise<DeleteRepoResult> {
    if (!this.repos.has(id)) return "not_found";
    const inUse =
      [...this.prompts.values()].some((prompt) => prompt.repoId === id) ||
      [...this.sessions.values()].some((session) => session.repoId === id);
    if (inUse) return "in_use";
    this.repos.delete(id);
    return "deleted";
  }

  async listPrompts(): Promise<SystemPrompt[]> {
    return this.byNewest(this.prompts.values());
  }

  async getPrompt(id: string): Promise<SystemPrompt | undefined> {
    return this.prompts.get(id);
  }

  async createPrompt(input: CreatePromptInput): Promise<SystemPrompt> {
    if (input.scope === "repo" && !input.repoId) {
      throw new Error("A repository prompt must name a repository");
    }
    const prompt: SystemPrompt = {
      id: this.id("prompt"),
      name: input.name,
      scope: input.scope,
      repoId: input.scope === "repo" ? input.repoId : undefined,
      createdAt: this.now(),
    };
    this.prompts.set(prompt.id, prompt);
    await this.addPromptVersion(prompt.id, input.content, input.note);
    return prompt;
  }

  async listPromptVersions(promptId: string): Promise<PromptVersion[]> {
    return this.byNewest(
      [...this.versions.values()].filter((version) => version.promptId === promptId),
    );
  }

  async addPromptVersion(
    promptId: string,
    content: string,
    note?: string,
  ): Promise<PromptVersion> {
    if (!this.prompts.has(promptId)) throw new Error("Prompt not found");
    const version: PromptVersion = {
      id: this.id("version"),
      promptId,
      content,
      note,
      createdAt: this.now(),
    };
    this.versions.set(version.id, version);
    return version;
  }

  async getBasePromptId(): Promise<string | undefined> {
    return this.basePromptId;
  }

  async setBasePrompt(promptId: string | undefined): Promise<void> {
    if (promptId) {
      const prompt = this.prompts.get(promptId);
      if (!prompt || prompt.scope !== "global") {
        throw new Error("Base prompt must be a global prompt");
      }
    }
    this.basePromptId = promptId;
  }

  async composeSystemPrompt(repoId: string, extra: string): Promise<string> {
    const sections: string[] = [];
    if (this.basePromptId) {
      const base = this.prompts.get(this.basePromptId);
      const version = base && this.latestVersion(base.id);
      if (base && version) sections.push(`## ${base.name}\n\n${version.content}`);
    }

    const repoPrompts = [...this.prompts.values()]
      .filter((prompt) => prompt.scope === "repo" && prompt.repoId === repoId)
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const prompt of repoPrompts) {
      const version = this.latestVersion(prompt.id);
      if (version) sections.push(`## ${prompt.name}\n\n${version.content}`);
    }
    if (extra.trim()) sections.push(`## Session instructions\n\n${extra.trim()}`);
    return sections.join("\n\n");
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    if (!this.repos.has(input.repoId)) throw new Error("Repository not found");
    const parent = input.parentId ? this.sessions.get(input.parentId) : undefined;
    if (input.parentId && !parent) throw new Error("Parent session not found");
    const now = this.now();
    const id = this.id("session");
    const session: Session = {
      id,
      parentId: parent?.id,
      rootId: parent?.rootId ?? id,
      repoId: input.repoId,
      title: input.title,
      status: "running",
      runner: input.runner,
      taskPrompt: input.taskPrompt,
      systemPromptExtra: input.systemPromptExtra,
      composedSystemPrompt: await this.composeSystemPrompt(
        input.repoId,
        input.systemPromptExtra,
      ),
      createPr: input.createPr,
      autoMerge: input.autoMerge,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);

    const turn: Turn = {
      id: this.id("turn"),
      sessionId: session.id,
      kind: parent ? "spawn" : "initial",
      prompt: input.taskPrompt,
      composedSystemPrompt: session.composedSystemPrompt,
      status: "running",
      createdAt: now,
    };
    this.turns.set(turn.id, turn);
    this.simulateTurn(session.id, turn.id);
    return session;
  }

  async listTurns(sessionId: string): Promise<Turn[]> {
    return [...this.turns.values()]
      .filter((turn) => turn.sessionId === sessionId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async listRunEvents(turnId: string): Promise<RunEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.turnId === turnId)
      .sort((left, right) => left.ts.getTime() - right.ts.getTime());
  }

  async addFeedback(sessionId: string, feedback: string): Promise<Turn> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status === "archived" || session.status === "running") {
      throw new Error("This session cannot accept feedback right now");
    }
    const now = this.now();
    const turn: Turn = {
      id: this.id("turn"),
      sessionId,
      kind: "feedback",
      prompt: feedback,
      composedSystemPrompt: session.composedSystemPrompt,
      status: "running",
      createdAt: now,
    };
    this.turns.set(turn.id, turn);
    session.status = "running";
    session.updatedAt = now;
    this.simulateTurn(session.id, turn.id);
    return turn;
  }

  async cancelSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || (session.status !== "running" && session.status !== "queued"))
      return false;
    this.clearTimers(session.id);
    session.status = "cancelled";
    session.updatedAt = this.now();
    const turn = this.activeTurn(session.id);
    if (turn) {
      turn.status = "cancelled";
      turn.finishedAt = this.now();
      this.addEvent(turn.id, "status", "Session cancelled by user");
    }
    return true;
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "archived") return false;
    this.clearTimers(session.id);
    const turn = this.activeTurn(session.id);
    if (turn) {
      turn.status = "cancelled";
      turn.finishedAt = this.now();
      this.addEvent(turn.id, "status", "Turn stopped because the session was archived");
    }
    session.status = "archived";
    session.updatedAt = this.now();
    return true;
  }

  private simulateTurn(sessionId: string, turnId: string): void {
    this.addEvent(turnId, "status", "Prototype runner started");
    const lines = [
      "Preparing an isolated workspace…",
      "Reading the repository and composed system prompt…",
      "Prototype work complete; waiting for your review.",
    ];
    const handles = lines.map((line, index) =>
      setTimeout(
        () => {
          const session = this.sessions.get(sessionId);
          const turn = this.turns.get(turnId);
          if (session?.status === "running" && turn?.status === "running") {
            this.addEvent(turnId, "log", line);
            session.updatedAt = this.now();
          }
        },
        this.simulationStepMs * (index + 1),
      ),
    );
    handles.push(
      setTimeout(() => {
        const session = this.sessions.get(sessionId);
        const turn = this.turns.get(turnId);
        if (session?.status === "running" && turn?.status === "running") {
          turn.status = "succeeded";
          turn.finishedAt = this.now();
          session.status = "awaiting_feedback";
          session.updatedAt = this.now();
          this.addEvent(turnId, "status", "Awaiting feedback");
        }
        this.timers.delete(sessionId);
      }, this.simulationStepMs * 4),
    );
    for (const handle of handles) handle.unref();
    this.timers.set(sessionId, handles);
  }

  private clearTimers(sessionId: string): void {
    for (const handle of this.timers.get(sessionId) ?? []) clearTimeout(handle);
    this.timers.delete(sessionId);
  }

  private activeTurn(sessionId: string): Turn | undefined {
    return [...this.turns.values()].find(
      (turn) =>
        turn.sessionId === sessionId &&
        (turn.status === "running" || turn.status === "queued"),
    );
  }

  private addEvent(
    turnId: string,
    kind: RunEvent["kind"],
    data: string,
    ts?: Date,
  ): void {
    const event: RunEvent = {
      id: this.id("event"),
      turnId,
      kind,
      data,
      ts: ts ?? this.now(),
    };
    this.events.set(event.id, event);
  }

  private latestVersion(promptId: string): PromptVersion | undefined {
    return [...this.versions.values()]
      .filter((version) => version.promptId === promptId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  }

  private byNewest<T extends { createdAt: Date }>(items: Iterable<T>): T[] {
    return [...items].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  }

  private id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence.toString(36)}`;
  }

  private now(): Date {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return new Date(this.lastTimestamp);
  }

  private seed(): void {
    const repos: Repo[] = [
      {
        id: "repo-garage",
        owner: "Wilfred",
        name: "llm-garage",
        defaultBranch: "main",
        createdAt: minutesAgo(9_000),
      },
      {
        id: "repo-parser",
        owner: "Wilfred",
        name: "tree-sitter-elisp",
        defaultBranch: "master",
        createdAt: minutesAgo(8_000),
      },
      {
        id: "repo-notes",
        owner: "Wilfred",
        name: "digital-garden",
        defaultBranch: "main",
        createdAt: minutesAgo(7_000),
      },
    ];
    for (const repo of repos) this.repos.set(repo.id, repo);

    const prompts: SystemPrompt[] = [
      {
        id: "prompt-base",
        name: "Careful coding agent",
        scope: "global",
        createdAt: minutesAgo(6_000),
      },
      {
        id: "prompt-tests",
        name: "llm-garage conventions",
        scope: "repo",
        repoId: "repo-garage",
        createdAt: minutesAgo(5_000),
      },
      {
        id: "prompt-parser",
        name: "Parser maintenance",
        scope: "repo",
        repoId: "repo-parser",
        createdAt: minutesAgo(4_000),
      },
    ];
    for (const prompt of prompts) this.prompts.set(prompt.id, prompt);
    this.basePromptId = "prompt-base";

    const versions: PromptVersion[] = [
      {
        id: "version-base-1",
        promptId: "prompt-base",
        content: "Make small, reviewable changes and explain important tradeoffs.",
        note: "Initial",
        createdAt: minutesAgo(5_900),
      },
      {
        id: "version-base-2",
        promptId: "prompt-base",
        content:
          "Make small, reviewable changes. Run focused tests, preserve user work, and explain important tradeoffs.",
        note: "Add verification",
        createdAt: minutesAgo(3_900),
      },
      {
        id: "version-base-3",
        promptId: "prompt-base",
        content:
          "Make small, reviewable changes. Run focused tests, preserve user work, and leave the repository in a state another engineer can continue from.",
        note: "Clarify handoff",
        createdAt: minutesAgo(900),
      },
      {
        id: "version-tests-1",
        promptId: "prompt-tests",
        content: "Use strict TypeScript and Node's built-in test runner.",
        note: "Initial",
        createdAt: minutesAgo(4_900),
      },
      {
        id: "version-tests-2",
        promptId: "prompt-tests",
        content:
          "Use strict TypeScript and Node's built-in test runner. Render dynamic HTML through Preact JSX.",
        note: "Record rendering choice",
        createdAt: minutesAgo(800),
      },
      {
        id: "version-parser-1",
        promptId: "prompt-parser",
        content:
          "Keep grammar changes narrow and add a corpus test for every changed parse.",
        note: "Initial",
        createdAt: minutesAgo(3_900),
      },
      {
        id: "version-parser-2",
        promptId: "prompt-parser",
        content:
          "Keep grammar changes narrow, add corpus tests, and inspect generated conflicts before committing.",
        note: "Conflict checks",
        createdAt: minutesAgo(700),
      },
    ];
    for (const version of versions) this.versions.set(version.id, version);

    const sessions: Session[] = [
      this.fixtureSession(
        "session-m3",
        "Prototype the session UI",
        "repo-garage",
        "running",
        32,
      ),
      this.fixtureSession(
        "session-navigation",
        "Tighten dashboard navigation",
        "repo-garage",
        "awaiting_feedback",
        24,
        "session-m3",
      ),
      this.fixtureSession(
        "session-tests",
        "Add rendering safety tests",
        "repo-garage",
        "succeeded",
        18,
        "session-m3",
      ),
      this.fixtureSession(
        "session-parser",
        "Investigate bytecode parse failure",
        "repo-parser",
        "failed",
        140,
      ),
      this.fixtureSession(
        "session-docs",
        "Refresh project notes",
        "repo-notes",
        "archived",
        1_400,
      ),
      this.fixtureSession(
        "session-queued",
        "Audit mobile spacing",
        "repo-garage",
        "queued",
        8,
        "session-m3",
      ),
    ];
    for (const session of sessions) this.sessions.set(session.id, session);

    for (const session of sessions) {
      const status =
        session.status === "running" || session.status === "queued"
          ? session.status
          : session.status === "failed"
            ? "failed"
            : "succeeded";
      const turn: Turn = {
        id: `turn-${session.id}`,
        sessionId: session.id,
        kind: session.parentId ? "spawn" : "initial",
        prompt: session.taskPrompt,
        composedSystemPrompt: session.composedSystemPrompt,
        status,
        createdAt: session.createdAt,
        finishedAt:
          status === "running" || status === "queued" ? undefined : session.updatedAt,
      };
      this.turns.set(turn.id, turn);
      this.addEvent(
        turn.id,
        "status",
        status === "running" ? "Runner is working" : `Turn ${status}`,
        session.createdAt,
      );
      this.addEvent(
        turn.id,
        "log",
        `Loaded ${session.repoId} on a prototype workspace`,
        minutesAgo(Math.max(1, 30)),
      );
      this.addEvent(
        turn.id,
        "log",
        session.status === "failed"
          ? "Command exited with status 1 (fixture)"
          : "Reviewed the requested files (fixture)",
        session.updatedAt,
      );
    }
  }

  private fixtureSession(
    id: string,
    title: string,
    repoId: string,
    status: Session["status"],
    minutes: number,
    parentId?: string,
  ): Session {
    return {
      id,
      parentId,
      rootId: parentId ? "session-m3" : id,
      repoId,
      title,
      status,
      runner: id === "session-docs" ? "echo" : "codex",
      taskPrompt: title,
      systemPromptExtra: "Keep the result focused and easy to review.",
      composedSystemPrompt:
        "## Careful coding agent\n\nMake small, reviewable changes.\n\n## Session instructions\n\nKeep the result focused and easy to review.",
      createPr: id !== "session-parser",
      autoMerge: id === "session-tests",
      createdAt: minutesAgo(minutes + 15),
      updatedAt: minutesAgo(minutes),
    };
  }
}

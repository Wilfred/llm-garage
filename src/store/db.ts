import { randomUUID } from "node:crypto";
import type { DataSource, Repository } from "typeorm";
import { RepoEntity } from "../entities/repo";
import { RepoAlreadyExistsError } from "./errors";
import { MemoryDataStore, type MemoryStoreOptions } from "./memory";
import type { CreateRepoInput, DeleteRepoResult, Repo } from "./types";

/**
 * Transitional store used while the prototype moves to SQLite one slice at a time.
 * Repository operations are persistent; session operations still use the in-memory
 * implementation until the rest of M4 replaces them.
 */
export class DatabaseDataStore extends MemoryDataStore {
  private readonly repoRepository: Repository<RepoEntity>;

  constructor(dataSource: DataSource, options: MemoryStoreOptions = {}) {
    super(options);
    this.repoRepository = dataSource.getRepository(RepoEntity);
  }

  async initialize(): Promise<void> {
    if ((await this.repoRepository.count()) === 0) {
      await this.repoRepository.save(await super.listRepos());
    }
  }

  override async listRepos(): Promise<Repo[]> {
    return this.repoRepository.find({ order: { createdAt: "DESC" } });
  }

  override async getRepo(id: string): Promise<Repo | undefined> {
    return (await this.repoRepository.findOneBy({ id })) ?? undefined;
  }

  override async createRepo(input: CreateRepoInput): Promise<Repo> {
    const existing = await this.repoRepository.findOneBy({
      owner: input.owner,
      name: input.name,
    });
    if (existing) throw new RepoAlreadyExistsError(input.owner, input.name);

    return this.repoRepository.save(
      this.repoRepository.create({
        id: randomUUID(),
        ...input,
        createdAt: new Date(),
      }),
    );
  }

  override async deleteRepo(id: string): Promise<DeleteRepoResult> {
    if (!(await this.repoRepository.findOneBy({ id }))) return "not_found";
    if (this.repoIsInUse(id)) return "in_use";
    await this.repoRepository.delete({ id });
    return "deleted";
  }
}

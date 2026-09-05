export class RepoAlreadyExistsError extends Error {
  constructor(owner: string, name: string) {
    super(`${owner}/${name} is already configured`);
    this.name = "RepoAlreadyExistsError";
  }
}

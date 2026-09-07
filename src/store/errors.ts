export class RepoAlreadyExistsError extends Error {
  constructor(owner: string, name: string) {
    super(`${owner}/${name} is already configured`);
    this.name = "RepoAlreadyExistsError";
  }
}

export class ModelAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`${id} is already configured`);
    this.name = "ModelAlreadyExistsError";
  }
}

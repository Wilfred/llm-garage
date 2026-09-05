export function formField(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export function noticeUrl(path: string, notice: string): string {
  const query = new URLSearchParams({ notice });
  return `${path}?${query.toString()}`;
}

export function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

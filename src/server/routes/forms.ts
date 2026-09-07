export function formField(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export function formFields(body: unknown, key: string): string[] {
  if (!body || typeof body !== "object") return [];
  const value = (body as Record<string, unknown>)[key];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function noticeUrl(path: string, notice: string): string {
  const query = new URLSearchParams({ notice });
  return `${path}?${query.toString()}`;
}

export function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

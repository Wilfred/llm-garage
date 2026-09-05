import type { VNode } from "preact";
import { renderToString } from "preact-render-to-string";

export function renderPage(page: VNode): string {
  return `<!doctype html>${renderToString(page)}`;
}

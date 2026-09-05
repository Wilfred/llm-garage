import type { VNode } from "preact";
import { renderToString } from "preact-render-to-string";

export function renderPage<Props>(page: VNode<Props>): string {
  return `<!doctype html>${renderToString(page)}`;
}

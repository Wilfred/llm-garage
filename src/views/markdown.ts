import MarkdownIt from "markdown-it";

// html: false escapes any raw HTML in model output, so the rendered
// markdown needs no separate sanitiser.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}

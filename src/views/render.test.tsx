import assert from "node:assert/strict";
import test from "node:test";
import { renderPage } from "./render";

const payload = `"><script>alert("xss")</script>`;

function UntrustedContent({ value }: { value: string }) {
  return <div title={value}>{value}</div>;
}

test("escapes dynamic text and attribute values by default", () => {
  const html = renderPage(<UntrustedContent value={payload} />);

  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script>alert\(&quot;xss&quot;\)&lt;\/script>/);
  assert.match(html, /title="&quot;>&lt;script>/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { renderPage } from "../render";
import { AboutPage, formatDuration } from "./about";
import { DashboardPage } from "./dashboard";

void test("formats uptime as a concise duration", () => {
  assert.equal(formatDuration(0), "0 seconds");
  assert.equal(formatDuration(61), "1 minute, 1 second");
  assert.equal(formatDuration(183_845), "2 days, 3 hours");
});

void test("renders build and runtime information", () => {
  const html = renderPage(
    <AboutPage
      gitCommit="0123456789abcdef"
      imageBuildTime="2026-09-05T12:34:56Z"
      processUptimeSeconds={3_661}
      machineUptimeSeconds={183_845}
    />,
  );

  assert.match(
    html,
    /href="https:\/\/github\.com\/Wilfred\/llm-garage\/commit\/0123456789abcdef"/,
  );
  assert.match(html, />0123456789ab<\/code>/);
  assert.match(html, /datetime="2026-09-05T12:34:56Z"/);
  assert.match(html, /1 hour, 1 minute/);
  assert.match(html, /2 days, 3 hours/);
});

void test("links to the about page from the footer", () => {
  const html = renderPage(<DashboardPage repos={[]} sessions={[]} />);

  assert.match(html, /<footer><a href="\/about">About<\/a>/);
});

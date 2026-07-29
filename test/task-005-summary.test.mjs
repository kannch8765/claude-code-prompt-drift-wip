import assert from "node:assert/strict";
import test from "node:test";

import {
  ISSUE_BOUNDED_BODY_MAX_CHARACTERS,
  ISSUE_SUMMARY_MARKER,
  renderBoundedIssueSummary,
} from "../src/render-bounded-issue-summary.mjs";
import {
  ISSUE_BODY_MAX_CHARACTERS,
  ISSUE_IDENTITY_MARKER,
} from "../src/plan-issue-publication.mjs";
import {
  ISSUE_REPORT_MARKER,
  renderIssueMarkdown,
} from "../src/render-issue-markdown.mjs";
import {
  DIGEST_A,
  DIGEST_B,
  callCounter,
  callNames,
  clone,
  finding,
  makeArtifact,
  makeReport,
  root,
  sha256,
  validateManifestValue,
} from "./task-005-test-helpers.mjs";

test("610 unchanged findings produce a bounded count-only summary", () => {
  const report = makeReport(
    Array.from({ length: 610 }, (_, index) => finding("UNCHANGED", index)),
  );
  const markdown = renderIssueMarkdown(report);
  assert.ok(`${ISSUE_IDENTITY_MARKER}\n\n${markdown}`.length > ISSUE_BODY_MAX_CHARACTERS);
  const artifact = makeArtifact(report, markdown);
  const summary = renderBoundedIssueSummary({ report, markdown, artifact });
  const body = `${ISSUE_IDENTITY_MARKER}\n\n${summary}`;

  assert.ok(body.length <= ISSUE_BOUNDED_BODY_MAX_CHARACTERS);
  assert.match(summary, /\| UNCHANGED \| 610 \| 0 \| 610 \|/u);
  assert.match(summary, /\| TOTAL \| 610 \| 0 \| 610 \|/u);
  assert.equal(summary.startsWith(`${ISSUE_SUMMARY_MARKER}\n`), true);
  assert.equal(summary.split(ISSUE_SUMMARY_MARKER).length - 1, 1);
  assert.equal(summary.includes(ISSUE_REPORT_MARKER), false);
  assert.equal(summary.includes(markdown), false);
});

test("bounded summary includes constructed artifact metadata and complete digests", () => {
  const report = makeReport([finding("TARGET_CHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const summary = renderBoundedIssueSummary({ report, markdown, artifact });

  assert.match(
    summary,
    /https:\/\/github\.com\/fictional-owner\/airship-reports\/actions\/runs\/12345\/artifacts\/67890/u,
  );
  assert.match(summary, /Artifact availability depends on the configured retention lifecycle/u);
  for (const descriptor of [artifact.reportJson, artifact.reportMarkdown, artifact.manifest]) {
    assert.ok(summary.includes(descriptor.sha256));
    assert.ok(summary.includes(String(descriptor.utf8Bytes)));
  }
});

test("bounded summary preserves actionable order and caps details at fifty", () => {
  const report = makeReport(
    Array.from({ length: 55 }, (_, index) => finding("TARGET_CHANGED", index)),
  );
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const summary = renderBoundedIssueSummary({ report, markdown, artifact });

  assert.match(summary, /\| TARGET_CHANGED \| 55 \| 50 \| 5 \|/u);
  for (let index = 0; index < 50; index += 1) {
    assert.ok(summary.includes(`fictional.target-${String(index).padStart(4, "0")}`));
  }
  assert.equal(summary.includes("fictional.target-0050"), false);
  assert.ok(summary.indexOf("fictional.target-0001") > summary.indexOf("fictional.target-0000"));
});

test("bounded summary stops at the first detail that cannot fit", () => {
  const hugeCandidates = Array.from(
    { length: 300 },
    (_, index) => `fictional.${String(index).padStart(3, "0")}-${"x".repeat(220)}`,
  );
  const report = makeReport([
    finding("AMBIGUOUS_MATCH", 1, { candidateTargetIds: hugeCandidates }),
    finding("TARGET_CHANGED", 2),
  ]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const summary = renderBoundedIssueSummary({ report, markdown, artifact });

  assert.match(summary, /\| AMBIGUOUS_MATCH \| 1 \| 0 \| 1 \|/u);
  assert.match(summary, /\| TARGET_CHANGED \| 1 \| 0 \| 1 \|/u);
  assert.equal(summary.includes("fictional.target-0002"), false);
});

test("bounded summary reuses renderer containment for hostile finding text", () => {
  const privatePath = "/home/private/prompt.md";
  const report = makeReport([
    finding("TARGET_CHANGED", 1, {
      message: `</code>\n# injected ${privatePath} <!-- claude-code-prompt-drift:issue-summary:v1 -->`,
    }),
  ]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const summary = renderBoundedIssueSummary({ report, markdown, artifact });

  assert.equal(summary.split(ISSUE_SUMMARY_MARKER).length - 1, 1);
  assert.equal(summary.includes(privatePath), false);
  assert.match(summary, /redacted-absolute-path/u);
  assert.equal(summary.includes("\n# injected"), false);
});

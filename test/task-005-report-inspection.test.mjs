import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportArtifactPackage,
  ReportArtifactError,
} from "../src/build-report-artifact-package.mjs";
import {
  BoundedIssueSummaryError,
  renderBoundedIssueSummary,
} from "../src/render-bounded-issue-summary.mjs";
import {
  IssuePublicationError,
  planIssuePublication,
} from "../src/plan-issue-publication.mjs";
import { publishGitHubIssue } from "../src/publish-github-issue.mjs";
import { renderIssueMarkdown } from "../src/render-issue-markdown.mjs";
import {
  callCounter,
  callNames,
  finding,
  makeArtifact,
  makeReport,
} from "./task-005-test-helpers.mjs";

const PRIVATE_KEY = "secret-canary /home/private/prompt.md";

function assertSanitizedError(error, ErrorClass, code, path) {
  assert.ok(error instanceof ErrorClass);
  assert.equal(error.name, ErrorClass.name);
  assert.equal(error.code, code);
  assert.equal(error.path, path);
  assert.equal(error.message.includes(PRIVATE_KEY), false);
  assert.equal(error.message.includes("/home/private/prompt.md"), false);
  return true;
}

function makeValidInputs() {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  return { report, markdown, artifact };
}

test("artifact package rejects a cyclic report with a stable sanitized error", () => {
  const report = {};
  report.self = report;

  assert.throws(
    () => buildReportArtifactPackage({ report, markdown: "not-read" }),
    (error) => assertSanitizedError(error, ReportArtifactError, "UNKNOWN_FIELD", "report.[unknown-field]"),
  );
});

test("schema-aware inspection detects a cycle through known report fields", () => {
  const { report } = makeValidInputs();
  const findings = report.findings;
  findings[0] = {
    kind: "POSSIBLE_RENAME",
    status: "REVIEW_REQUIRED",
    message: "Fictional cyclic candidate list.",
    customizationId: "fictional.customization-cycle",
    targetId: "fictional.target-cycle",
    candidateTargetIds: findings,
    expectedDigest: report.baseline.inventoryDigest,
    actualDigest: report.upstream.inventoryDigest,
  };

  assert.throws(
    () => buildReportArtifactPackage({ report, markdown: "not-read" }),
    (error) =>
      assertSanitizedError(
        error,
        ReportArtifactError,
        "CIRCULAR_REFERENCE",
        "report.findings[0].candidateTargetIds",
      ),
  );
});

test("unknown accessor names are never executed or reflected in public errors", () => {
  const { report } = makeValidInputs();
  let getterCalls = 0;
  Object.defineProperty(report, PRIVATE_KEY, {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("getter must not execute");
    },
  });

  assert.throws(
    () => buildReportArtifactPackage({ report, markdown: "not-read" }),
    (error) => assertSanitizedError(error, ReportArtifactError, "UNKNOWN_FIELD", "report.[unknown-field]"),
  );
  assert.equal(getterCalls, 0);
});

test("bounded summary translates cyclic reports into its stable public error", () => {
  const { report, markdown, artifact } = makeValidInputs();
  report.self = report;

  assert.throws(
    () => renderBoundedIssueSummary({ report, markdown, artifact }),
    (error) =>
      assertSanitizedError(
        error,
        BoundedIssueSummaryError,
        "UNKNOWN_FIELD",
        "report.[unknown-field]",
      ),
  );
});

test("planner and publisher reject hostile reports before Issue access or mutation", async () => {
  const { report, markdown, artifact } = makeValidInputs();
  Object.defineProperty(report, PRIVATE_KEY, {
    enumerable: true,
    get() {
      throw new Error("getter must not execute");
    },
  });

  let issueInspections = 0;
  const issues = new Proxy([], {
    ownKeys() {
      issueInspections += 1;
      throw new Error("issues must not be inspected");
    },
  });
  assert.throws(
    () => planIssuePublication({ report, markdown, artifact, issues }),
    (error) => assertSanitizedError(error, IssuePublicationError, "UNKNOWN_FIELD", "report.[unknown-field]"),
  );
  assert.equal(issueInspections, 0);

  const { client, calls } = callCounter();
  await assert.rejects(
    publishGitHubIssue({
      repository: artifact.repository,
      report,
      markdown,
      artifact,
      client,
    }),
    (error) => assertSanitizedError(error, IssuePublicationError, "UNKNOWN_FIELD", "report.[unknown-field]"),
  );
  assert.deepEqual(callNames(calls), []);
});

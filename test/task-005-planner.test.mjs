import assert from "node:assert/strict";
import test from "node:test";

import {
  ISSUE_BOUNDED_BODY_MAX_CHARACTERS,
  ISSUE_BODY_MAX_CHARACTERS,
  ISSUE_IDENTITY_MARKER,
  IssuePublicationError,
  planIssuePublication,
} from "../src/plan-issue-publication.mjs";
import { renderIssueMarkdown } from "../src/render-issue-markdown.mjs";
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

test("legacy planner behavior remains CREATE, UPDATE, NOOP and oversized fail-closed", () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const create = planIssuePublication({ report, markdown, issues: [] });
  const update = planIssuePublication({
    report,
    markdown,
    issues: [{ number: 4, state: "open", title: "old", body: `${ISSUE_IDENTITY_MARKER}\n\nold` }],
  });
  const noop = planIssuePublication({
    report,
    markdown,
    issues: [{ number: 4, state: "open", title: create.title, body: create.body }],
  });
  assert.equal(create.action, "CREATE");
  assert.equal(update.action, "UPDATE");
  assert.equal(noop.action, "NOOP");

  const largeReport = makeReport(
    Array.from({ length: 610 }, (_, index) => finding("UNCHANGED", index)),
  );
  const largeMarkdown = renderIssueMarkdown(largeReport);
  assert.throws(
    () => planIssuePublication({
      report: largeReport,
      markdown: largeMarkdown,
      issues: new Proxy([], {
        getOwnPropertyDescriptor() {
          throw new Error("must not inspect Issues");
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, "PUBLICATION_BODY_TOO_LARGE");
      assert.equal(error.path, "body");
      return true;
    },
  );
});

test("artifact planner supports bounded CREATE, full-body UPDATE, and bounded NOOP", () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const boundedCreate = planIssuePublication({ report, markdown, artifact, issues: [] });
  const update = planIssuePublication({
    report,
    markdown,
    artifact,
    issues: [{
      number: 7,
      state: "open",
      title: boundedCreate.title,
      body: `${ISSUE_IDENTITY_MARKER}\n\n${markdown}`,
    }],
  });
  const noop = planIssuePublication({
    report,
    markdown,
    artifact,
    issues: [{ number: 7, state: "open", title: boundedCreate.title, body: boundedCreate.body }],
  });
  assert.equal(boundedCreate.action, "CREATE");
  assert.equal(update.action, "UPDATE");
  assert.equal(noop.action, "NOOP");
  assert.ok(boundedCreate.body.length <= ISSUE_BOUNDED_BODY_MAX_CHARACTERS);
});

test("artifact descriptor mismatch fails before Issue inspection", () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const original = makeArtifact(report, markdown);
  const artifact = {
    ...original,
    reportJson: { ...original.reportJson, sha256: DIGEST_B },
  };
  assert.throws(
    () => planIssuePublication({
      report,
      markdown,
      artifact,
      issues: new Proxy([], {
        getOwnPropertyDescriptor() {
          throw new Error("must not inspect Issues");
        },
      }),
    }),
    (error) => {
      assert.ok(error instanceof IssuePublicationError);
      assert.equal(error.code, "ARTIFACT_DESCRIPTOR_MISMATCH");
      assert.equal(error.path, "artifact.reportJson.sha256");
      return true;
    },
  );
});

test("artifact descriptor rejects invalid identifiers, unknown fields, and accessors", () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const base = makeArtifact(report, markdown);

  for (const [field, value, code] of [
    ["repository", "invalid repository", "INVALID_ARTIFACT_DESCRIPTOR"],
    ["runId", 0, "INVALID_ARTIFACT_RUN_ID"],
    ["artifactId", -1, "INVALID_ARTIFACT_ID"],
    ["retentionDays", 0, "INVALID_RETENTION_DAYS"],
  ]) {
    assert.throws(
      () => planIssuePublication({ report, markdown, artifact: { ...base, [field]: value }, issues: [] }),
      (error) => {
        assert.equal(error.code, code);
        return true;
      },
    );
  }
  assert.throws(
    () => planIssuePublication({ report, markdown, artifact: { ...base, extra: true }, issues: [] }),
    (error) => {
      assert.equal(error.code, "INVALID_ARTIFACT_DESCRIPTOR");
      return true;
    },
  );

  let getterReads = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "runId", {
    enumerable: true,
    get() {
      getterReads += 1;
      return 1;
    },
  });
  assert.throws(
    () => planIssuePublication({ report, markdown, artifact: accessor, issues: [] }),
    (error) => {
      assert.equal(error.code, "ACCESSOR_PROPERTY_NOT_ALLOWED");
      return true;
    },
  );
  assert.equal(getterReads, 0);
});

test("artifact planner does not modify report, artifact, or Issue inputs", () => {
  const report = makeReport([finding("TARGET_CHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const issues = [{
    number: 31,
    state: "closed",
    title: "Fictional closed Issue",
    body: "ordinary body",
  }];
  const before = clone({ report, artifact, issues });

  planIssuePublication({ report, markdown, artifact, issues });

  assert.deepEqual({ report, artifact, issues }, before);
});

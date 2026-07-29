import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildIssueReport, IssueReportInputError } from "../src/build-issue-report.mjs";
import { renderIssueMarkdown } from "../src/render-issue-markdown.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (character) => "sha256:" + character.repeat(64);
const findingCounts = Object.freeze({
  UNCHANGED: 0,
  TARGET_CHANGED: 1,
  TARGET_MISSING: 0,
  POSSIBLE_RENAME: 0,
  AMBIGUOUS_MATCH: 0,
  NEW_UPSTREAM_PROMPT: 0,
  UPSTREAM_NOT_READY: 0,
});

function classification(message = "Exact target ID exists, but its digest changed.") {
  return {
    status: "REVIEW_REQUIRED",
    findings: [
      {
        kind: "TARGET_CHANGED",
        status: "REVIEW_REQUIRED",
        message,
        customizationId: "fictional.weathered-compass.extra-caution",
        targetId: "fictional.weathered-compass",
        expectedDigest: digest("a"),
        actualDigest: digest("b"),
      },
    ],
    summary: {
      frozenTargets: 1,
      upstreamTargets: 1,
      findingCounts: { ...findingCounts },
    },
  };
}

function build(overrides = {}) {
  return buildIssueReport({
    classification: classification(),
    reportId: "fictional.run-0003",
    generatedAt: "2026-07-29T03:17:00.000Z",
    contractVersion: "1",
    baseline: {
      source: "fictional.baseline",
      version: "1.0.0-fictional",
      inventoryDigest: digest("c"),
    },
    upstream: {
      ready: true,
      source: "fictional.upstream",
      version: "1.0.1-fictional",
      inventoryDigest: digest("d"),
    },
    ...overrides,
  });
}

function assertInputError(fn, path) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof IssueReportInputError);
    assert.equal(error.code, "INVALID_VALUE");
    assert.equal(error.path, path);
    return true;
  });
}

test("runtime and schema reject Windows drive-relative metadata prefixes", async () => {
  assertInputError(() => build({ reportId: "C:private" }), "report.reportId");

  const withIdentity = classification();
  withIdentity.findings[0].targetId = "D:secret";
  assertInputError(
    () => build({ classification: withIdentity }),
    "report.findings[0].targetId",
  );

  assertInputError(
    () =>
      build({
        baseline: {
          source: "E:inventory",
          version: "1.0.0-fictional",
          inventoryDigest: digest("c"),
        },
      }),
    "report.baseline.source",
  );

  const schema = JSON.parse(
    await readFile(join(root, "schemas", "issue-report.schema.json"), "utf8"),
  );
  assert.doesNotMatch("C:private", new RegExp(schema.$defs.reportId.pattern));
  assert.doesNotMatch("D:secret", new RegExp(schema.$defs.identity.pattern));
  assert.doesNotMatch("E:inventory", new RegExp(schema.$defs.sourceIdentifier.pattern));
  assert.match("run:id-0003", new RegExp(schema.$defs.reportId.pattern));
  assert.equal(build({ reportId: "run:id-0003" }).reportId, "run:id-0003");
});

test("renderer redacts key-prefixed and HTTPS-adjacent absolute paths", () => {
  const message = [
    "artifact=/home/user/private/prompt.md",
    "artifact=C:\\private\\prompt.md",
    "artifact=\\\\server\\share\\secret",
    "artifact=//server/share/secret",
    "source=https://airship.example.invalid/public",
    "source=https://airship.example.invalid/public;C:\\private\\prompt.md",
    "source=https://airship.example.invalid/public\\\\server\\share\\secret",
  ].join(" ");
  const markdown = renderIssueMarkdown(
    build({ classification: classification(message) }),
  );

  for (const leaked of [
    "/home/user/private/prompt.md",
    "C:\\private\\prompt.md",
    "\\\\server\\share\\secret",
    "//server/share/secret",
  ]) {
    assert.equal(markdown.includes(leaked), false, leaked);
  }
  assert.equal(
    markdown.match(/&#91;redacted-absolute-path&#93;/gu)?.length,
    6,
  );
  assert.equal(
    markdown.match(/https:\/\/airship\.example\.invalid\/public/gu)?.length,
    3,
  );
});

test("renderer leaves adjacent drive letters outside canonical HTTPS protection", () => {
  const message = [
    "source=https://airship.example.invalid/publicC:\\private\\prompt.md",
    "source=https://airship.example.invalid/C:\\private\\prompt.md",
  ].join(" ");
  const markdown = renderIssueMarkdown(
    build({ classification: classification(message) }),
  );

  assert.equal(markdown.includes("C:\\private\\prompt.md"), false);
  assert.equal(markdown.includes(":\\private\\prompt.md"), false);
  assert.ok(
    (markdown.match(/&#91;redacted-absolute-path&#93;/gu)?.length ?? 0) >= 2,
  );
  assert.match(markdown, /https:\/\/airship\.example\.invalid\/public/u);
  assert.match(markdown, /https:\/\/airship\.example\.invalid/u);
});

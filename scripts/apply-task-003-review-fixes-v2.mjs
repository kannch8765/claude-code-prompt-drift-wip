import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";

const contractPath = "src/issue-report-contract.mjs";
const rendererPath = "src/render-issue-markdown.mjs";
const schemaPath = "schemas/issue-report.schema.json";
const testPath = "test/report-safety-regressions.test.mjs";
const workflowPath = ".github/workflows/task-003-review-fix.yml";
const oldScriptPath = "scripts/apply-task-003-review-fixes.mjs";
const scriptPath = "scripts/apply-task-003-review-fixes-v2.mjs";

function replaceOnce(content, before, after, path) {
  const first = content.indexOf(before);
  assert.notEqual(first, -1, `${path}: expected source text was not found`);
  assert.equal(
    content.indexOf(before, first + before.length),
    -1,
    `${path}: expected source text was not unique`,
  );
  return `${content.slice(0, first)}${after}${content.slice(first + before.length)}`;
}

let contract = await readFile(contractPath, "utf8");
contract = replaceOnce(
  contract,
  "const REPORT_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$/;",
  "const REPORT_ID_PATTERN = /^(?![A-Za-z]:)[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$/;",
  contractPath,
);
contract = replaceOnce(
  contract,
  "const IDENTITY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,254}[A-Za-z0-9])?$/;",
  "const IDENTITY_PATTERN = /^(?![A-Za-z]:)[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,254}[A-Za-z0-9])?$/;",
  contractPath,
);
contract = replaceOnce(
  contract,
  "const SOURCE_TOKEN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$/;",
  "const SOURCE_TOKEN_PATTERN = /^(?![A-Za-z]:)[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$/;",
  contractPath,
);
await writeFile(contractPath, contract);

const newRedactor = `const HTTP_URL_PATTERN = /(https?:\\/\\/[^\\s<>()\\[\\]{}]*)/giu;

function redactNonUrlPaths(value) {
  return value
    .replace(/file:\\/\\/[^\\s<>()\\[\\]{}]*/giu, "[redacted-file-url]")
    .replace(
      /(?<![A-Za-z0-9._~%+-])[A-Za-z]:[\\\\/][^\\s<>()\\[\\]{}]*/gu,
      "[redacted-absolute-path]",
    )
    .replace(
      /\\\\\\\\[^\\\\/\\s<>()\\[\\]{}]+[\\\\/][^\\s<>()\\[\\]{}]*/gu,
      "[redacted-absolute-path]",
    )
    .replace(
      /\\/\\/[^/\\s<>()\\[\\]{}]+\\/[^\\s<>()\\[\\]{}]*/gu,
      "[redacted-absolute-path]",
    )
    .replace(
      /(?<![A-Za-z0-9._~%+\\/-])\\/(?!\\/)[^\\s<>()\\[\\]{}]*/gu,
      "[redacted-absolute-path]",
    );
}

function redactAbsolutePaths(value) {
  return value
    .split(HTTP_URL_PATTERN)
    .map((segment, index) => (index % 2 === 1 ? segment : redactNonUrlPaths(segment)))
    .join("");
}`;

let renderer = await readFile(rendererPath, "utf8");
const redactorStart = renderer.indexOf("function redactAbsolutePaths(value) {");
const redactorEnd = renderer.indexOf("\n\nfunction safeText", redactorStart);
assert.notEqual(redactorStart, -1, `${rendererPath}: redactor start was not found`);
assert.notEqual(redactorEnd, -1, `${rendererPath}: redactor end was not found`);
renderer = `${renderer.slice(0, redactorStart)}${newRedactor}${renderer.slice(redactorEnd)}`;
await writeFile(rendererPath, renderer);

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
schema.$defs.reportId.pattern =
  "^(?![A-Za-z]:)[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$";
schema.$defs.identity.pattern =
  "^(?![A-Za-z]:)[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,254}[A-Za-z0-9])?$";
schema.$defs.sourceIdentifier.pattern =
  "^(?:(?![A-Za-z]:)[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?|https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/(?!\\.{1,2}(?:/|$))[A-Za-z0-9._~-]+)*)$";
schema.$defs.reportId.description =
  "Portable report identifier; Windows drive-prefixed values are forbidden.";
schema.$defs.identity.description =
  "Portable identity without path separators, controls, or a Windows drive prefix.";
schema.$defs.sourceIdentifier.description =
  "Portable token without a Windows drive prefix, or a canonical HTTPS source identifier.";
await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

const regressionTest = `import assert from "node:assert/strict";
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

test("renderer redacts key-prefixed absolute and UNC paths without damaging HTTPS", () => {
  const message = [
    "artifact=/home/user/private/prompt.md",
    "artifact=C:\\\\private\\\\prompt.md",
    "artifact=\\\\\\\\server\\\\share\\\\secret",
    "artifact=//server/share/secret",
    "source=https://airship.example.invalid/public",
  ].join(" ");
  const markdown = renderIssueMarkdown(
    build({ classification: classification(message) }),
  );

  for (const leaked of [
    "/home/user/private/prompt.md",
    "C:\\\\private\\\\prompt.md",
    "\\\\\\\\server\\\\share\\\\secret",
    "//server/share/secret",
  ]) {
    assert.equal(markdown.includes(leaked), false, leaked);
  }
  assert.equal(
    markdown.match(/&#91;redacted-absolute-path&#93;/gu)?.length,
    4,
  );
  assert.match(markdown, /https:\\/\\/airship\\.example\\.invalid\\/public/u);
});
`;
await writeFile(testPath, regressionTest);

await rm(workflowPath);
await rm(oldScriptPath);
await rm(scriptPath);

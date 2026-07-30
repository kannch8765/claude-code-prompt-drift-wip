import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildReportArtifactPackage,
  ReportArtifactError,
} from "../src/build-report-artifact-package.mjs";
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

test("artifact package is deterministic, complete, and byte-accounted", () => {
  const report = makeReport([finding("TARGET_CHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const beforeReport = clone(report);
  const first = buildReportArtifactPackage({ report, markdown });
  const second = buildReportArtifactPackage({ report, markdown });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(report, beforeReport);
  assert.deepEqual(
    first.files.map(({ name }) => name),
    ["issue-report.json", "issue-report.md", "manifest.json"],
  );
  for (const file of first.files) {
    assert.deepEqual(Object.keys(file), [
      "name",
      "mediaType",
      "content",
      "utf8Bytes",
      "utf16CodeUnits",
      "sha256",
    ]);
  }
  assert.equal(first.files[0].content, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(first.files[1].content, markdown);
  assert.equal(first.files[2].content.endsWith("\n"), true);
  assert.equal(first.files[2].content.endsWith("\n\n"), false);

  for (const file of first.files) {
    assert.equal(file.utf8Bytes, Buffer.byteLength(file.content, "utf8"));
    assert.equal(file.utf16CodeUnits, file.content.length);
    assert.equal(file.sha256, sha256(file.content));
  }

  const reportHex = first.files[0].sha256.slice("sha256:".length);
  assert.equal(
    first.artifactName,
    `claude-code-prompt-drift-report-${reportHex}`,
  );
  const manifest = JSON.parse(first.files[2].content);
  validateManifestValue(manifest);
  assert.deepEqual(manifest.files, [
    first.descriptor.reportJson,
    first.descriptor.reportMarkdown,
  ]);
  assert.equal(Object.hasOwn(manifest, "manifest"), false);
  assert.equal(JSON.stringify(first.descriptor).includes("content"), false);
});

test("artifact package separates UTF-8 bytes from UTF-16 code units", () => {
  const report = makeReport([
    finding("TARGET_CHANGED", 2, { message: "Fictional airship signal: 🛩️" }),
  ]);
  const markdown = renderIssueMarkdown(report);
  const artifactPackage = buildReportArtifactPackage({ report, markdown });
  assert.ok(artifactPackage.files[0].utf8Bytes > artifactPackage.files[0].utf16CodeUnits);
  assert.ok(artifactPackage.files[1].utf8Bytes > artifactPackage.files[1].utf16CodeUnits);
});

test("artifact package fails closed for mismatched Markdown", () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  assert.throws(
    () => buildReportArtifactPackage({ report, markdown: "not canonical\n" }),
    (error) => {
      assert.ok(error instanceof ReportArtifactError);
      assert.equal(error.code, "MARKDOWN_MISMATCH");
      assert.equal(error.path, "markdown");
      return true;
    },
  );
});

test("artifact package rejects accessors without invoking getters", () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  let getterReads = 0;
  Object.defineProperty(report.findings[0], "message", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "secret-canary";
    },
  });

  assert.throws(
    () => buildReportArtifactPackage({ report, markdown: "unused" }),
    (error) => {
      assert.equal(error.code, "ACCESSOR_PROPERTY_NOT_ALLOWED");
      assert.equal(error.path, "report.findings[0].message");
      assert.equal(error.message.includes("secret-canary"), false);
      return true;
    },
  );
  assert.equal(getterReads, 0);
});

test("artifact package sanitizes hostile Proxy inspection failures", () => {
  const report = new Proxy({}, {
    ownKeys() {
      throw new Error("secret-canary /private/prompt.md");
    },
  });
  assert.throws(
    () => buildReportArtifactPackage({ report, markdown: "unused" }),
    (error) => {
      assert.equal(error.code, "UNSAFE_PROPERTY_ACCESS");
      assert.equal(error.path, "report");
      assert.equal(error.message.includes("secret-canary"), false);
      assert.equal(error.message.includes("/private/prompt.md"), false);
      return true;
    },
  );
});

test("artifact manifest schema and synthetic example lock the fixed contract", async () => {
  const schema = JSON.parse(
    await readFile(join(root, "schemas/report-artifact-manifest.schema.json"), "utf8"),
  );
  const example = JSON.parse(
    await readFile(join(root, "examples/report-artifact-manifest.json"), "utf8"),
  );

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.contractVersion.const, "1");
  assert.equal(schema.properties.files.minItems, 2);
  assert.equal(schema.properties.files.maxItems, 2);
  assert.equal(schema.properties.files.items, false);
  assert.equal(schema.$defs.nonNegativeSafeInteger.maximum, Number.MAX_SAFE_INTEGER);
  validateManifestValue(example);
});

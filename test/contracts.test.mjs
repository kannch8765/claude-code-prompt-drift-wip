import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  COMPATIBILITY_STATUSES,
  FINDING_KINDS,
  STATUS_PRECEDENCE,
} from "../src/contracts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function listFiles(directory) {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function collectStrings(value, strings = []) {
  if (typeof value === "string") {
    strings.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, strings));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectStrings(entry, strings));
  }

  return strings;
}

test("compatibility status contract is exact and ordered", () => {
  assert.deepEqual(COMPATIBILITY_STATUSES, [
    "SAFE_TO_REAPPLY",
    "REVIEW_REQUIRED",
    "BLOCKED",
    "UPSTREAM_NOT_READY",
  ]);
  assert.deepEqual(STATUS_PRECEDENCE, COMPATIBILITY_STATUSES);
});

test("finding kind contract covers every fixture outcome", () => {
  assert.deepEqual(FINDING_KINDS, [
    "UNCHANGED",
    "TARGET_CHANGED",
    "TARGET_MISSING",
    "POSSIBLE_RENAME",
    "AMBIGUOUS_MATCH",
    "NEW_UPSTREAM_PROMPT",
    "UPSTREAM_NOT_READY",
  ]);
});

test("JSON schemas publish the same status and finding enums", async () => {
  const manifestSchema = await readJson("schemas/frozen-manifest.schema.json");
  const issueSchema = await readJson("schemas/issue-report.schema.json");

  assert.equal(manifestSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(issueSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(issueSchema.$defs.status.enum, COMPATIBILITY_STATUSES);
  assert.deepEqual(issueSchema.$defs.findingKind.enum, FINDING_KINDS);
  assert.equal(issueSchema.properties.mutationsPerformed.const, false);
});

test("example manifest paths and digests are internally consistent", async () => {
  const manifest = await readJson("examples/frozen-customization.manifest.json");

  assert.equal(manifest.schemaVersion, "1");
  assert.equal(manifest.synthetic, true);
  assert.match(manifest.manifestId, /^fictional\./);
  assert.match(manifest.upstreamSnapshot.source, /\.invalid\//);

  for (const entry of manifest.customizations) {
    assert.match(entry.customizationId, /^fictional\./);
    assert.match(entry.target.targetId, /^fictional\./);

    const base = await readFile(
      join(root, "examples", entry.artifacts.basePath),
    );
    const customized = await readFile(
      join(root, "examples", entry.artifacts.customizedPath),
    );

    assert.equal(sha256(base), entry.target.expectedDigest);
    assert.equal(sha256(customized), entry.artifacts.customizedDigest);
  }
});

test("required synthetic fixture matrix is complete", async () => {
  const fixtureFiles = (await listFiles("fixtures"))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const required = [
    "fixtures/ambiguous-match.json",
    "fixtures/new-upstream-prompt.json",
    "fixtures/possible-rename.json",
    "fixtures/target-missing.json",
    "fixtures/unchanged.json",
    "fixtures/upstream-changed.json",
  ];

  for (const file of required) {
    assert.ok(fixtureFiles.includes(file), `missing required fixture ${file}`);
  }

  assert.ok(
    fixtureFiles.includes("fixtures/upstream-not-ready.json"),
    "the fourth overall status needs an acceptance fixture",
  );
});

test("every fixture has deterministic synthetic identities and valid outcomes", async () => {
  const fixtureFiles = (await listFiles("fixtures")).filter((file) =>
    file.endsWith(".json"),
  );

  for (const file of fixtureFiles) {
    const fixture = await readJson(file);
    assert.equal(fixture.fixtureVersion, "1", file);
    assert.equal(fixture.synthetic, true, file);
    assert.ok(COMPATIBILITY_STATUSES.includes(fixture.expected.status), file);

    for (const finding of fixture.expected.findings) {
      assert.ok(FINDING_KINDS.includes(finding.kind), `${file}: ${finding.kind}`);
    }

    for (const frozen of fixture.frozen) {
      assert.match(frozen.customizationId, /^fictional\./, file);
      assert.match(frozen.targetId, /^fictional\./, file);
      assert.match(frozen.expectedDigest, /^sha256:[0-9a-f]{64}$/, file);
    }

    for (const upstream of fixture.upstream) {
      assert.match(upstream.targetId, /^fictional\./, file);
      assert.match(upstream.digest, /^sha256:[0-9a-f]{64}$/, file);
    }
  }
});

test("examples and fixtures contain no genuine or private prompt material", async () => {
  const files = [
    ...(await listFiles("examples")),
    ...(await listFiles("fixtures")),
  ];
  const forbidden = [
    "anthropic",
    "claude code",
    "cc-prompts",
    "tweakcc",
    "system-prompt",
    "kohaku",
    "haru",
    "tmux",
    "kannch",
  ];

  for (const file of files) {
    const content = await readFile(join(root, file), "utf8");
    const lower = content.toLowerCase();

    for (const token of forbidden) {
      assert.equal(
        lower.includes(token),
        false,
        `${file} contains forbidden public-fixture token: ${token}`,
      );
    }
  }

  const promptFiles = files.filter((file) => file.endsWith(".txt"));
  assert.ok(promptFiles.length > 0);

  for (const file of promptFiles) {
    const content = await readFile(join(root, file), "utf8");
    assert.ok(
      content.startsWith("SYNTHETIC PLACEHOLDER — NOT AN UPSTREAM PROMPT\n"),
      `${file} lacks the required synthetic marker`,
    );
  }
});

test("all structured example strings stay within fictional namespaces", async () => {
  const manifest = await readJson("examples/frozen-customization.manifest.json");
  const report = await readJson("examples/issue-report.json");
  const strings = [...collectStrings(manifest), ...collectStrings(report)];

  assert.ok(strings.some((value) => value.startsWith("fictional.")));
  assert.ok(strings.some((value) => value.includes(".invalid")));
  assert.equal(report.mutationsPerformed, false);
  assert.ok(COMPATIBILITY_STATUSES.includes(report.status));
});

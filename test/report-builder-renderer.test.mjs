import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildIssueReport, IssueReportInputError } from "../src/build-issue-report.mjs";
import { classifyInventory } from "../src/classify-inventory.mjs";
import {
  ISSUE_REPORT_MARKER,
  renderIssueMarkdown,
} from "../src/render-issue-markdown.mjs";
import { FINDING_KINDS } from "../src/contracts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (character) => `sha256:${character.repeat(64)}`;
const frozen = (overrides = {}) => ({
  customizationId: "fictional.weathered-compass.extra-caution",
  targetId: "fictional.weathered-compass",
  displayName: "Weathered Compass",
  expectedDigest: digest("a"),
  aliases: ["Old Brass Compass"],
  ...overrides,
});
const upstream = (overrides = {}) => ({
  targetId: "fictional.weathered-compass",
  displayName: "Weathered Compass",
  digest: digest("a"),
  aliases: [],
  ...overrides,
});
const baselineMetadata = Object.freeze({
  source: "https://airship.example.invalid/baselines",
  version: "0.0.1-fictional",
  inventoryDigest: digest("b"),
});
const readyUpstreamMetadata = Object.freeze({
  ready: true,
  source: "https://airship.example.invalid/prompts",
  version: "0.0.2-fictional",
  inventoryDigest: digest("c"),
});
const notReadyUpstreamMetadata = Object.freeze({
  ready: false,
  source: "fictional.unavailable-upstream",
  version: null,
  inventoryDigest: null,
  readinessReason: "Synthetic upstream snapshot is incomplete.",
});

function classify(frozenEntries, upstreamEntries, upstreamReady = true) {
  return classifyInventory({ upstreamReady, frozenEntries, upstreamEntries });
}

function build(classification, overrides = {}) {
  return buildIssueReport({
    classification,
    reportId: "fictional.run-0003",
    generatedAt: "2026-07-29T03:17:00.000Z",
    contractVersion: "1",
    baseline: baselineMetadata,
    upstream:
      classification.status === "UPSTREAM_NOT_READY"
        ? notReadyUpstreamMetadata
        : readyUpstreamMetadata,
    ...overrides,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function assertInputError(fn, code, path) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof IssueReportInputError);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    return true;
  });
}

function assertPublishedSchemaShape(report, schema) {
  for (const required of schema.required) {
    assert.ok(Object.hasOwn(report, required), `missing schema field ${required}`);
  }
  assert.deepEqual(
    Object.keys(report).sort(),
    schema.required.toSorted(),
    "builder emits exactly the required public report fields",
  );
  assert.equal(report.contractVersion, schema.properties.contractVersion.const);
  assert.equal(report.mutationsPerformed, schema.properties.mutationsPerformed.const);
  assert.match(report.reportId, new RegExp(schema.$defs.reportId.pattern));
  assert.match(report.generatedAt, new RegExp(schema.$defs.canonicalUtcDateTime.pattern));
  assert.ok(schema.$defs.status.enum.includes(report.status));
  assert.match(report.baseline.source, new RegExp(schema.$defs.sourceIdentifier.pattern));
  assert.match(report.baseline.version, new RegExp(schema.$defs.version.pattern));
  assert.match(report.baseline.inventoryDigest, new RegExp(schema.$defs.digest.pattern));
  assert.deepEqual(
    Object.keys(report.summary.findingCounts),
    schema.properties.summary.properties.findingCounts.required,
  );
  for (const finding of report.findings) {
    assert.ok(schema.$defs.findingKind.enum.includes(finding.kind));
    assert.ok(schema.$defs.status.enum.includes(finding.status));
  }
}

const outcomeCases = [
  {
    name: "SAFE_TO_REAPPLY complete report",
    expectedStatus: "SAFE_TO_REAPPLY",
    expectedKinds: ["UNCHANGED"],
    create: () => classify([frozen()], [upstream()]),
  },
  {
    name: "TARGET_CHANGED",
    expectedStatus: "REVIEW_REQUIRED",
    expectedKinds: ["TARGET_CHANGED"],
    create: () => classify([frozen()], [upstream({ digest: digest("d") })]),
  },
  {
    name: "TARGET_MISSING",
    expectedStatus: "BLOCKED",
    expectedKinds: ["TARGET_MISSING"],
    create: () => classify([frozen()], []),
  },
  {
    name: "POSSIBLE_RENAME",
    expectedStatus: "REVIEW_REQUIRED",
    expectedKinds: ["POSSIBLE_RENAME"],
    create: () =>
      classify(
        [frozen()],
        [upstream({ targetId: "fictional.renamed-compass" })],
      ),
  },
  {
    name: "AMBIGUOUS_MATCH",
    expectedStatus: "BLOCKED",
    expectedKinds: [
      "AMBIGUOUS_MATCH",
      "NEW_UPSTREAM_PROMPT",
      "NEW_UPSTREAM_PROMPT",
    ],
    create: () =>
      classify(
        [frozen()],
        [
          upstream({ targetId: "fictional.north-compass" }),
          upstream({ targetId: "fictional.south-compass", digest: digest("e") }),
        ],
      ),
  },
  {
    name: "NEW_UPSTREAM_PROMPT",
    expectedStatus: "REVIEW_REQUIRED",
    expectedKinds: ["UNCHANGED", "NEW_UPSTREAM_PROMPT"],
    create: () =>
      classify(
        [frozen()],
        [
          upstream(),
          upstream({
            targetId: "fictional.moon-sail",
            displayName: "Moon Sail",
            digest: digest("f"),
          }),
        ],
      ),
  },
  {
    name: "UPSTREAM_NOT_READY",
    expectedStatus: "UPSTREAM_NOT_READY",
    expectedKinds: ["UPSTREAM_NOT_READY"],
    create: () => classify([frozen()], [], false),
  },
];

for (const outcome of outcomeCases) {
  test(`builder and renderer cover ${outcome.name}`, () => {
    const classification = outcome.create();
    const report = build(classification);
    const markdown = renderIssueMarkdown(report);

    assert.equal(report.status, outcome.expectedStatus);
    assert.deepEqual(
      report.findings.map(({ kind }) => kind),
      outcome.expectedKinds,
    );
    assert.equal(report.mutationsPerformed, false);
    assert.match(markdown, new RegExp(`Compatibility status: \\*\\*${outcome.expectedStatus}\\*\\*`));
    assert.match(markdown, /No automatic apply or remote mutation was performed\./u);
  });
}

test("builder preserves classifier findings, summary, and order without mutation", () => {
  const classifierInput = deepFreeze({
    upstreamReady: true,
    frozenEntries: [
      frozen({
        customizationId: "fictional.first.customization",
        targetId: "fictional.first",
        displayName: "First Compass",
      }),
      frozen({
        customizationId: "fictional.second.customization",
        targetId: "fictional.second",
        displayName: "Second Compass",
        expectedDigest: digest("b"),
      }),
    ],
    upstreamEntries: [
      upstream({
        targetId: "fictional.first",
        displayName: "First Compass",
        digest: digest("c"),
      }),
      upstream({
        targetId: "fictional.second",
        displayName: "Second Compass",
        digest: digest("d"),
      }),
    ],
  });
  const before = JSON.stringify(classifierInput);
  const classification = classifyInventory(classifierInput);
  const classificationBefore = structuredClone(classification);
  const report = build(classification);

  assert.equal(JSON.stringify(classifierInput), before);
  assert.deepEqual(classification, classificationBefore);
  assert.deepEqual(report.findings, classification.findings);
  assert.deepEqual(report.summary, classification.summary);
  assert.deepEqual(
    report.findings.map(({ targetId }) => targetId),
    ["fictional.first", "fictional.second"],
  );
});

test("summary counts are closed and match every finding kind", () => {
  const report = build(
    classify(
      [frozen()],
      [upstream(), upstream({ targetId: "fictional.moon-sail", displayName: "Moon Sail" })],
    ),
  );
  assert.deepEqual(Object.keys(report.summary.findingCounts), FINDING_KINDS);
  assert.equal(
    Object.values(report.summary.findingCounts).reduce((total, count) => total + count, 0),
    report.findings.length,
  );

  const invalid = structuredClone(report);
  invalid.summary.findingCounts.UNCHANGED += 1;
  assertInputError(
    () => renderIssueMarkdown(invalid),
    "INCONSISTENT_SUMMARY",
    "report.summary.findingCounts.UNCHANGED",
  );
});

test("builder returns a full deep copy", () => {
  const classification = classify([frozen()], [upstream()]);
  const baseline = structuredClone(baselineMetadata);
  const upstreamMetadata = structuredClone(readyUpstreamMetadata);
  const report = build(classification, { baseline, upstream: upstreamMetadata });

  assert.notEqual(report.findings, classification.findings);
  assert.notEqual(report.findings[0], classification.findings[0]);
  assert.notEqual(report.summary, classification.summary);
  assert.notEqual(report.summary.findingCounts, classification.summary.findingCounts);
  assert.notEqual(report.baseline, baseline);
  assert.notEqual(report.upstream, upstreamMetadata);

  report.findings[0].message = "Changed only in the returned report.";
  report.summary.findingCounts.UNCHANGED = 99;
  report.baseline.version = "9.9.9-fictional";
  assert.notEqual(report.findings[0].message, classification.findings[0].message);
  assert.notEqual(report.summary.findingCounts.UNCHANGED, classification.summary.findingCounts.UNCHANGED);
  assert.notEqual(report.baseline.version, baseline.version);
});

test("generatedAt must be canonical UTC ISO-8601 with milliseconds", () => {
  const classification = classify([frozen()], [upstream()]);
  for (const generatedAt of [
    "2026-07-29T03:17:00Z",
    "2026-07-29T12:17:00.000+09:00",
    "2026-02-30T03:17:00.000Z",
    "2026-7-29T03:17:00.000Z",
  ]) {
    assertInputError(
      () => build(classification, { generatedAt }),
      "INVALID_TIMESTAMP",
      "report.generatedAt",
    );
  }
});

test("report and metadata identifiers reject controls and path-like values", () => {
  const classification = classify([frozen()], [upstream()]);
  assertInputError(
    () => build(classification, { reportId: "fictional.run\n<!-- forged -->" }),
    "INVALID_VALUE",
    "report.reportId",
  );
  assertInputError(
    () =>
      build(classification, {
        baseline: { ...baselineMetadata, source: "C:\\private\\inventory" },
      }),
    "INVALID_VALUE",
    "report.baseline.source",
  );
  assertInputError(
    () =>
      build(classification, {
        baseline: { ...baselineMetadata, version: "../private" },
      }),
    "INVALID_VALUE",
    "report.baseline.version",
  );
  const notReady = classify([frozen()], [], false);
  assertInputError(
    () =>
      build(notReady, {
        upstream: { ...notReadyUpstreamMetadata, readinessReason: "No snapshot\n## forged" },
      }),
    "INVALID_VALUE",
    "report.upstream.readinessReason",
  );
});

test("renderer neutralizes Markdown, HTML, comments, headings, tables, links, paths, and backticks", () => {
  const classification = classify([frozen()], [upstream({ digest: digest("d") })]);
  classification.findings[0].message =
    "[click](https://evil.invalid) | forged | <details><!-- forged -->\n" +
    `## forged heading \`tick\` /home/fictional/private.txt ${ISSUE_REPORT_MARKER}`;
  const markdown = renderIssueMarkdown(build(classification));

  assert.equal(markdown.split(ISSUE_REPORT_MARKER).length - 1, 1);
  assert.equal(markdown.includes("<details>"), false);
  assert.equal(markdown.includes("<!-- forged -->"), false);
  assert.equal(markdown.includes("\n## forged heading"), false);
  assert.equal(markdown.includes("](https://evil.invalid)"), false);
  assert.equal(markdown.includes("/home/fictional/private.txt"), false);
  assert.match(markdown, /&lt;details&gt;/u);
  assert.match(markdown, /\\n&#35;&#35; forged heading/u);
  assert.match(markdown, /&#91;redacted-absolute-path&#93;/u);
  assert.match(markdown, /`tick`/u);
  assert.match(markdown, /``/u);
});

test("renderer rejects prompt bodies and artifact paths instead of reading or exposing them", () => {
  const report = build(classify([frozen()], [upstream()]));
  const withPromptBody = { ...report, promptBody: "SYNTHETIC SECRET BODY" };
  assertInputError(
    () => renderIssueMarkdown(withPromptBody),
    "UNKNOWN_FIELD",
    "report.promptBody",
  );

  const withArtifactPath = structuredClone(report);
  withArtifactPath.findings[0].artifactPath = "/home/fictional/prompt.txt";
  assertInputError(
    () => renderIssueMarkdown(withArtifactPath),
    "UNKNOWN_FIELD",
    "report.findings[0].artifactPath",
  );
});

test("equal explicit inputs produce byte-for-byte equal JSON and Markdown", () => {
  const classification = classify([frozen()], [upstream()]);
  const first = build(structuredClone(classification));
  const second = build(structuredClone(classification));

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(renderIssueMarkdown(first), renderIssueMarkdown(second));
});

test("builder output satisfies the published issue report schema boundaries", async () => {
  const schema = JSON.parse(
    await readFile(join(root, "schemas", "issue-report.schema.json"), "utf8"),
  );
  const report = build(classify([frozen()], [upstream()]));
  assertPublishedSchemaShape(report, schema);
  assert.ok(schema.required.includes("baseline"));
  assert.deepEqual(schema.properties.summary.properties.findingCounts.required, FINDING_KINDS);
});

test("all committed fixtures execute classify → build → render", async (t) => {
  const files = (await readdir(join(root, "fixtures")))
    .filter((file) => file.endsWith(".json"))
    .sort();

  for (const file of files) {
    await t.test(file, async () => {
      const fixture = JSON.parse(
        await readFile(join(root, "fixtures", file), "utf8"),
      );
      const classification = classifyInventory({
        upstreamReady: fixture.upstreamReady,
        frozenEntries: fixture.frozen,
        upstreamEntries: fixture.upstream,
      });
      const report = build(classification, {
        reportId: `fictional.fixture-${fixture.name}`,
      });
      const markdown = renderIssueMarkdown(report);

      assert.equal(report.status, fixture.expected.status);
      assert.equal(markdown.split(ISSUE_REPORT_MARKER).length - 1, 1);
      assert.ok(markdown.endsWith("\n"));
    });
  }
});

test("builder and renderer contain no hidden I/O or ambient input sources", async () => {
  for (const file of [
    "src/build-issue-report.mjs",
    "src/issue-report-contract.mjs",
    "src/render-issue-markdown.mjs",
  ]) {
    const content = await readFile(join(root, file), "utf8");
    for (const forbidden of [
      "node:fs",
      "node:http",
      "node:https",
      "process.env",
      "Date.now",
      "Math.random",
      "fetch(",
    ]) {
      assert.equal(content.includes(forbidden), false, `${file} contains ${forbidden}`);
    }
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildReportArtifactPackage } from "../src/build-report-artifact-package.mjs";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const DIGEST_A = `sha256:${"a".repeat(64)}`;
export const DIGEST_B = `sha256:${"b".repeat(64)}`;
const STATUS_BY_KIND = Object.freeze({
  UNCHANGED: "SAFE_TO_REAPPLY",
  TARGET_CHANGED: "REVIEW_REQUIRED",
  TARGET_MISSING: "BLOCKED",
  POSSIBLE_RENAME: "REVIEW_REQUIRED",
  AMBIGUOUS_MATCH: "BLOCKED",
  NEW_UPSTREAM_PROMPT: "REVIEW_REQUIRED",
  UPSTREAM_NOT_READY: "UPSTREAM_NOT_READY",
});
const KIND_ORDER = [
  "UNCHANGED",
  "TARGET_CHANGED",
  "TARGET_MISSING",
  "POSSIBLE_RENAME",
  "AMBIGUOUS_MATCH",
  "NEW_UPSTREAM_PROMPT",
  "UPSTREAM_NOT_READY",
];

export function finding(kind, index, overrides = {}) {
  const suffix = String(index).padStart(4, "0");
  const base = {
    kind,
    status: STATUS_BY_KIND[kind],
    message: `Fictional airship finding ${suffix}.`,
  };
  switch (kind) {
    case "UNCHANGED":
    case "TARGET_CHANGED":
      Object.assign(base, {
        customizationId: `fictional.customization-${suffix}`,
        targetId: `fictional.target-${suffix}`,
        expectedDigest: DIGEST_A,
        actualDigest: kind === "UNCHANGED" ? DIGEST_A : DIGEST_B,
      });
      break;
    case "TARGET_MISSING":
      Object.assign(base, {
        customizationId: `fictional.customization-${suffix}`,
        targetId: `fictional.target-${suffix}`,
        expectedDigest: DIGEST_A,
      });
      break;
    case "POSSIBLE_RENAME":
      Object.assign(base, {
        customizationId: `fictional.customization-${suffix}`,
        targetId: `fictional.target-${suffix}`,
        candidateTargetIds: [`fictional.candidate-${suffix}`],
        expectedDigest: DIGEST_A,
        actualDigest: DIGEST_B,
      });
      break;
    case "AMBIGUOUS_MATCH":
      Object.assign(base, {
        customizationId: `fictional.customization-${suffix}`,
        targetId: `fictional.target-${suffix}`,
        candidateTargetIds: [
          `fictional.candidate-a-${suffix}`,
          `fictional.candidate-b-${suffix}`,
        ],
        expectedDigest: DIGEST_A,
      });
      break;
    case "NEW_UPSTREAM_PROMPT":
      Object.assign(base, {
        targetId: `fictional.upstream-${suffix}`,
        actualDigest: DIGEST_B,
      });
      break;
    case "UPSTREAM_NOT_READY":
      break;
    default:
      throw new Error(`Unsupported test finding kind: ${kind}`);
  }
  return Object.assign(base, overrides);
}

function statusForFindings(findings) {
  if (findings.some(({ kind }) => kind === "UPSTREAM_NOT_READY")) {
    return "UPSTREAM_NOT_READY";
  }
  if (findings.some(({ status }) => status === "BLOCKED")) {
    return "BLOCKED";
  }
  if (findings.some(({ status }) => status === "REVIEW_REQUIRED")) {
    return "REVIEW_REQUIRED";
  }
  return "SAFE_TO_REAPPLY";
}

export function makeReport(findings, overrides = {}) {
  const counts = Object.fromEntries(KIND_ORDER.map((kind) => [kind, 0]));
  for (const item of findings) {
    counts[item.kind] += 1;
  }
  const status = statusForFindings(findings);
  const upstreamReady = status !== "UPSTREAM_NOT_READY";
  return {
    contractVersion: "1",
    reportId: "fictional.airship-run-0005",
    generatedAt: "2026-07-30T00:00:00.000Z",
    status,
    mutationsPerformed: false,
    baseline: {
      source: "https://airship.example.invalid/baselines",
      version: "0.0.1-fictional",
      inventoryDigest: DIGEST_A,
    },
    upstream: upstreamReady
      ? {
          ready: true,
          source: "https://airship.example.invalid/prompts",
          version: "0.0.2-fictional",
          inventoryDigest: DIGEST_B,
        }
      : {
          ready: false,
          source: "https://airship.example.invalid/prompts",
          version: null,
          inventoryDigest: null,
          readinessReason: "Fictional airship inventory is incomplete.",
        },
    summary: {
      frozenTargets: findings.filter(({ kind }) => kind !== "NEW_UPSTREAM_PROMPT").length,
      upstreamTargets: findings.filter(({ kind }) => kind !== "TARGET_MISSING").length,
      findingCounts: counts,
    },
    findings,
    ...overrides,
  };
}

export function makeArtifact(report, markdown, overrides = {}) {
  const packageValue = buildReportArtifactPackage({ report, markdown });
  return {
    contractVersion: "1",
    repository: "fictional-owner/airship-reports",
    runId: 12345,
    artifactId: 67890,
    retentionDays: 7,
    artifactName: packageValue.descriptor.artifactName,
    reportId: packageValue.descriptor.reportId,
    reportJson: packageValue.descriptor.reportJson,
    reportMarkdown: packageValue.descriptor.reportMarkdown,
    manifest: packageValue.descriptor.manifest,
    ...overrides,
  };
}

export function sha256(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

export function clone(value) {
  return structuredClone(value);
}

export function callCounter(pages = [[]]) {
  const calls = [];
  return {
    calls,
    client: {
      async listIssuesPage(request) {
        calls.push(["listIssuesPage", request]);
        return pages[request.page - 1] ?? [];
      },
      async createIssue(request) {
        calls.push(["createIssue", request]);
        return { number: 80 };
      },
      async updateIssue(request) {
        calls.push(["updateIssue", request]);
        return { number: request.issueNumber };
      },
    },
  };
}

export function callNames(calls) {
  return calls.map(([name]) => name);
}

export function validateManifestValue(value) {
  assert.deepEqual(Object.keys(value), ["contractVersion", "artifactName", "reportId", "files"]);
  assert.equal(value.contractVersion, "1");
  assert.match(value.artifactName, /^claude-code-prompt-drift-report-[0-9a-f]{64}$/u);
  assert.match(value.reportId, /^fictional\./u);
  assert.equal(value.files.length, 2);
  assert.deepEqual(
    value.files.map(({ name, mediaType }) => [name, mediaType]),
    [
      ["issue-report.json", "application/json"],
      ["issue-report.md", "text/markdown"],
    ],
  );
  for (const descriptor of value.files) {
    assert.deepEqual(Object.keys(descriptor), [
      "name",
      "mediaType",
      "utf8Bytes",
      "utf16CodeUnits",
      "sha256",
    ]);
    assert.ok(Number.isSafeInteger(descriptor.utf8Bytes) && descriptor.utf8Bytes >= 0);
    assert.ok(
      Number.isSafeInteger(descriptor.utf16CodeUnits) &&
        descriptor.utf16CodeUnits >= 0,
    );
    assert.match(descriptor.sha256, /^sha256:[0-9a-f]{64}$/u);
  }
}

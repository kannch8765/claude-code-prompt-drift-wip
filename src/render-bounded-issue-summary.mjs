import { FINDING_KINDS } from "./contracts.mjs";
import { cloneAndValidateIssueReport } from "./issue-report-contract.mjs";
import { inlineCode, renderFindingMarkdown } from "./markdown-safety.mjs";
import {
  buildReportArtifactPackage,
  ReportArtifactError,
} from "./build-report-artifact-package.mjs";

export const ISSUE_SUMMARY_MARKER =
  "<!-- claude-code-prompt-drift:issue-summary:v1 -->";
export const ISSUE_BOUNDED_BODY_MAX_CHARACTERS = 60_000;

const ISSUE_IDENTITY_PREFIX =
  "<!-- claude-code-prompt-drift:rolling-issue:v1 -->\n\n";
const MAX_ACTIONABLE_FINDINGS = 50;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;
const ARTIFACT_NAME_PATTERN =
  /^claude-code-prompt-drift-report-[0-9a-f]{64}$/u;
const REPORT_ID_PATTERN =
  /^(?![A-Za-z]:)[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export class BoundedIssueSummaryError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "BoundedIssueSummaryError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new BoundedIssueSummaryError(code, path, detail);
}

function inspectPlainObject(
  value,
  path,
  typeCode = "INVALID_TYPE",
  inspectionCode = "UNSAFE_PROPERTY_ACCESS",
) {
  let isArray = false;
  if (value !== null && typeof value === "object") {
    try {
      isArray = Array.isArray(value);
    } catch {
      fail(inspectionCode, path, "object properties could not be inspected safely");
    }
  }
  if (value === null || typeof value !== "object" || isArray) {
    fail(typeCode, path, "expected a plain object");
  }

  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail(inspectionCode, path, "object properties could not be inspected safely");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(typeCode, path, "expected a plain object");
  }

  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(inspectionCode, path, "object properties could not be inspected safely");
  }
}

function readStrictDataRecord(
  value,
  path,
  expectedKeys,
  requiredKeys = expectedKeys,
  contractCode = null,
) {
  const descriptors = inspectPlainObject(
    value,
    path,
    contractCode ?? "INVALID_TYPE",
    "UNSAFE_PROPERTY_ACCESS",
  );
  const expected = new Set(expectedKeys);

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !expected.has(key)) {
      fail(
        contractCode ?? "UNKNOWN_FIELD",
        path,
        "field is not part of the public contract",
      );
    }
    if (!("value" in descriptors[key])) {
      fail(
        "ACCESSOR_PROPERTY_NOT_ALLOWED",
        `${path}.${String(key)}`,
        "accessor properties are not part of the public contract",
      );
    }
  }

  for (const key of requiredKeys) {
    if (descriptors[key] === undefined) {
      fail(
        contractCode ?? "MISSING_FIELD",
        `${path}.${key}`,
        "required field is missing",
      );
    }
  }

  const clone = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor !== undefined) {
      clone[key] = descriptor.value;
    }
  }
  return clone;
}

function inspectDataObject(value, path) {
  let isArray = false;
  if (value !== null && typeof value === "object") {
    try {
      isArray = Array.isArray(value);
    } catch {
      fail("UNSAFE_PROPERTY_ACCESS", path, "value could not be inspected safely");
    }
  }
  if (value === null || typeof value !== "object") {
    fail("INVALID_TYPE", path, "expected plain data");
  }

  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "value could not be inspected safely");
  }
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    fail("INVALID_TYPE", path, "expected plain data");
  }

  try {
    return { isArray, descriptors: Object.getOwnPropertyDescriptors(value) };
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "value could not be inspected safely");
  }
}

function cloneStrictData(value, path) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const { isArray, descriptors } = inspectDataObject(value, path);
  if (isArray) {
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      fail("UNSAFE_PROPERTY_ACCESS", path, "array length could not be inspected safely");
    }
    const allowed = new Set(["length"]);
    const clone = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const key = String(index);
      allowed.add(key);
      const descriptor = descriptors[key];
      if (descriptor === undefined) {
        clone.push(undefined);
      } else if (!("value" in descriptor)) {
        fail(
          "ACCESSOR_PROPERTY_NOT_ALLOWED",
          `${path}[${index}]`,
          "accessor properties are not part of the public contract",
        );
      } else {
        clone.push(cloneStrictData(descriptor.value, `${path}[${index}]`));
      }
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !allowed.has(key)) {
        fail("UNKNOWN_FIELD", path, "array contains a non-contract property");
      }
    }
    return clone;
  }

  const clone = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      fail("UNKNOWN_FIELD", path, "symbol properties are not part of the public contract");
    }
    const descriptor = descriptors[key];
    if (!("value" in descriptor)) {
      fail(
        "ACCESSOR_PROPERTY_NOT_ALLOWED",
        `${path}.${key}`,
        "accessor properties are not part of the public contract",
      );
    }
    clone[key] = cloneStrictData(descriptor.value, `${path}.${key}`);
  }
  return clone;
}

function parseRepository(value, path) {
  if (
    typeof value !== "string" ||
    value.includes("%") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", path, "expected owner/repository");
  }
  const segments = value.split("/");
  if (segments.length !== 2) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", path, "expected owner/repository");
  }
  const [owner, repository] = segments;
  if (
    owner === "." ||
    owner === ".." ||
    repository === "." ||
    repository === ".." ||
    !OWNER_PATTERN.test(owner) ||
    !REPOSITORY_PATTERN.test(repository)
  ) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", path, "expected owner/repository");
  }
  return value;
}

function requirePositiveSafeInteger(value, path, code) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(code, path, "expected a positive safe integer");
  }
  return value;
}

function requireNonNegativeSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", path, "expected a non-negative safe integer");
  }
  return value;
}

function cloneFileDescriptor(value, path) {
  const record = readStrictDataRecord(
    value,
    path,
    ["name", "mediaType", "utf8Bytes", "utf16CodeUnits", "sha256"],
    undefined,
    "INVALID_ARTIFACT_DESCRIPTOR",
  );
  if (typeof record.name !== "string" || record.name.length === 0) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", `${path}.name`, "expected a file name");
  }
  if (typeof record.mediaType !== "string" || record.mediaType.length === 0) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", `${path}.mediaType`, "expected a media type");
  }
  if (typeof record.sha256 !== "string" || !DIGEST_PATTERN.test(record.sha256)) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", `${path}.sha256`, "expected a SHA-256 digest");
  }
  return {
    name: record.name,
    mediaType: record.mediaType,
    utf8Bytes: requireNonNegativeSafeInteger(record.utf8Bytes, `${path}.utf8Bytes`),
    utf16CodeUnits: requireNonNegativeSafeInteger(
      record.utf16CodeUnits,
      `${path}.utf16CodeUnits`,
    ),
    sha256: record.sha256,
  };
}

function cloneArtifact(value) {
  const record = readStrictDataRecord(
    value,
    "artifact",
    [
      "contractVersion",
      "repository",
      "runId",
      "artifactId",
      "retentionDays",
      "artifactName",
      "reportId",
      "reportJson",
      "reportMarkdown",
      "manifest",
    ],
    undefined,
    "INVALID_ARTIFACT_DESCRIPTOR",
  );

  if (record.contractVersion !== "1") {
    fail("INVALID_ARTIFACT_DESCRIPTOR", "artifact.contractVersion", "expected version 1");
  }
  if (
    typeof record.artifactName !== "string" ||
    !ARTIFACT_NAME_PATTERN.test(record.artifactName)
  ) {
    fail(
      "INVALID_ARTIFACT_DESCRIPTOR",
      "artifact.artifactName",
      "expected the deterministic report artifact name",
    );
  }
  if (typeof record.reportId !== "string" || !REPORT_ID_PATTERN.test(record.reportId)) {
    fail("INVALID_ARTIFACT_DESCRIPTOR", "artifact.reportId", "expected a report identifier");
  }

  return {
    contractVersion: "1",
    repository: parseRepository(record.repository, "artifact.repository"),
    runId: requirePositiveSafeInteger(
      record.runId,
      "artifact.runId",
      "INVALID_ARTIFACT_RUN_ID",
    ),
    artifactId: requirePositiveSafeInteger(
      record.artifactId,
      "artifact.artifactId",
      "INVALID_ARTIFACT_ID",
    ),
    retentionDays: requirePositiveSafeInteger(
      record.retentionDays,
      "artifact.retentionDays",
      "INVALID_RETENTION_DAYS",
    ),
    artifactName: record.artifactName,
    reportId: record.reportId,
    reportJson: cloneFileDescriptor(record.reportJson, "artifact.reportJson"),
    reportMarkdown: cloneFileDescriptor(
      record.reportMarkdown,
      "artifact.reportMarkdown",
    ),
    manifest: cloneFileDescriptor(record.manifest, "artifact.manifest"),
  };
}

function compareField(actual, expected, path) {
  if (actual !== expected) {
    fail(
      "ARTIFACT_DESCRIPTOR_MISMATCH",
      path,
      "artifact metadata does not match the deterministic package",
    );
  }
}

function compareFileDescriptor(actual, expected, path) {
  for (const field of ["name", "mediaType", "utf8Bytes", "utf16CodeUnits", "sha256"]) {
    compareField(actual[field], expected[field], `${path}.${field}`);
  }
}

function validateArtifactMatchesPackage(artifact, descriptor) {
  compareField(artifact.contractVersion, descriptor.contractVersion, "artifact.contractVersion");
  compareField(artifact.artifactName, descriptor.artifactName, "artifact.artifactName");
  compareField(artifact.reportId, descriptor.reportId, "artifact.reportId");
  compareFileDescriptor(artifact.reportJson, descriptor.reportJson, "artifact.reportJson");
  compareFileDescriptor(
    artifact.reportMarkdown,
    descriptor.reportMarkdown,
    "artifact.reportMarkdown",
  );
  compareFileDescriptor(artifact.manifest, descriptor.manifest, "artifact.manifest");
}

function countShownByKind(findings) {
  const counts = Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]));
  for (const finding of findings) {
    counts[finding.kind] += 1;
  }
  return counts;
}

function renderSummary(report, artifact, packageDescriptor, shownFindings) {
  const shownCounts = countShownByKind(shownFindings);
  const artifactUrl = `https://github.com/${artifact.repository}/actions/runs/${artifact.runId}/artifacts/${artifact.artifactId}`;
  const readiness = report.upstream.ready ? "ready" : "not ready";
  const actionableTotal = report.findings.filter(
    (finding) => finding.kind !== "UNCHANGED",
  ).length;
  const lines = [
    ISSUE_SUMMARY_MARKER,
    "",
    "# Claude Code Prompt Drift Summary",
    "",
    `- Compatibility status: **${report.status}**`,
    `- Report ID: ${inlineCode(report.reportId)}`,
    `- Generated at: ${inlineCode(report.generatedAt)}`,
    `- Baseline source: ${inlineCode(report.baseline.source)}`,
    `- Baseline version: ${inlineCode(report.baseline.version)}`,
    `- Baseline inventory digest: ${inlineCode(report.baseline.inventoryDigest)}`,
    `- Upstream readiness: **${readiness}**`,
    `- Upstream source: ${inlineCode(report.upstream.source)}`,
    `- Upstream version: ${inlineCode(report.upstream.version ?? "not-ready")}`,
    `- Upstream inventory digest: ${inlineCode(report.upstream.inventoryDigest ?? "not-ready")}`,
    `- Frozen targets: ${report.summary.frozenTargets}`,
    `- Upstream targets: ${report.summary.upstreamTargets}`,
    `- Findings total: ${report.findings.length}`,
    "",
    "## Finding detail counts",
    "",
    "| Kind | Total | Shown | Omitted |",
    "| --- | ---: | ---: | ---: |",
  ];

  for (const kind of FINDING_KINDS) {
    const total = report.summary.findingCounts[kind];
    const shown = shownCounts[kind];
    lines.push(`| ${kind} | ${total} | ${shown} | ${total - shown} |`);
  }
  lines.push(
    `| TOTAL | ${report.findings.length} | ${shownFindings.length} | ${report.findings.length - shownFindings.length} |`,
    "",
    "`UNCHANGED` findings are count-only and are never enumerated in this Issue summary.",
    "",
    "## Complete artifact package",
    "",
    `- Artifact repository: ${inlineCode(artifact.repository)}`,
    `- Artifact name: ${inlineCode(artifact.artifactName)}`,
    `- Artifact URL: ${inlineCode(artifactUrl)}`,
    `- Retention days: ${artifact.retentionDays}`,
    `- Actionable details shown: ${shownFindings.length}`,
    `- Actionable details omitted: ${actionableTotal - shownFindings.length}`,
    "",
    "| File | SHA-256 | UTF-8 bytes | UTF-16 code units |",
    "| --- | --- | ---: | ---: |",
  );

  for (const descriptor of [
    packageDescriptor.reportJson,
    packageDescriptor.reportMarkdown,
    packageDescriptor.manifest,
  ]) {
    lines.push(
      `| ${descriptor.name} | ${inlineCode(descriptor.sha256)} | ${descriptor.utf8Bytes} | ${descriptor.utf16CodeUnits} |`,
    );
  }

  lines.push(
    "",
    "Complete JSON, Markdown, and manifest results are stored in the artifact package.",
    "Artifact availability depends on the configured retention lifecycle and is not permanent storage.",
    "",
    "## Actionable finding details",
    "",
  );

  if (shownFindings.length === 0) {
    lines.push("_No actionable finding details are shown._", "");
  } else {
    shownFindings.forEach((finding, index) =>
      lines.push(renderFindingMarkdown(finding, index)),
    );
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function finalBodyLength(summary) {
  return ISSUE_IDENTITY_PREFIX.length + summary.length;
}

function translatePackageError(error) {
  if (error instanceof ReportArtifactError) {
    fail(error.code, error.path, "artifact package validation failed");
  }
  fail("INVALID_ARTIFACT_DESCRIPTOR", "artifact", "artifact package validation failed");
}

export function prepareBoundedIssueSummary(input) {
  const record = readStrictDataRecord(input, "input", ["report", "markdown", "artifact"]);
  const safeReport = cloneStrictData(record.report, "report");

  let report;
  try {
    report = cloneAndValidateIssueReport(safeReport);
  } catch {
    fail("INVALID_REPORT", "report", "report does not satisfy the Task 003 contract");
  }
  if (typeof record.markdown !== "string") {
    fail("INVALID_TYPE", "markdown", "expected a string");
  }

  const artifact = cloneArtifact(record.artifact);
  let artifactPackage;
  try {
    artifactPackage = buildReportArtifactPackage({
      report,
      markdown: record.markdown,
    });
  } catch (error) {
    translatePackageError(error);
  }
  validateArtifactMatchesPackage(artifact, artifactPackage.descriptor);

  const actionable = report.findings.filter((finding) => finding.kind !== "UNCHANGED");
  let shownFindings = [];
  let summary = renderSummary(report, artifact, artifactPackage.descriptor, shownFindings);
  if (finalBodyLength(summary) > ISSUE_BOUNDED_BODY_MAX_CHARACTERS) {
    fail(
      "PUBLICATION_SUMMARY_TOO_LARGE",
      "body",
      `bounded publication body exceeds the ${ISSUE_BOUNDED_BODY_MAX_CHARACTERS}-character contract`,
    );
  }

  for (const finding of actionable.slice(0, MAX_ACTIONABLE_FINDINGS)) {
    const candidateFindings = [...shownFindings, finding];
    const candidateSummary = renderSummary(
      report,
      artifact,
      artifactPackage.descriptor,
      candidateFindings,
    );
    if (finalBodyLength(candidateSummary) > ISSUE_BOUNDED_BODY_MAX_CHARACTERS) {
      break;
    }
    shownFindings = candidateFindings;
    summary = candidateSummary;
  }

  if (!summary.startsWith(`${ISSUE_SUMMARY_MARKER}\n`)) {
    fail("INVALID_PUBLICATION_BODY", "summary", "summary marker invariant was not satisfied");
  }
  if (summary.split(ISSUE_SUMMARY_MARKER).length - 1 !== 1) {
    fail("INVALID_PUBLICATION_BODY", "summary", "summary marker must occur exactly once");
  }

  return {
    summary,
    status: report.status,
    artifactRepository: artifact.repository,
  };
}

export function renderBoundedIssueSummary(input) {
  return prepareBoundedIssueSummary(input).summary;
}

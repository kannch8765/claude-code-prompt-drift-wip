import {
  COMPATIBILITY_STATUSES,
  FINDING_KINDS,
  STATUS_PRECEDENCE,
} from "./contracts.mjs";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REPORT_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$/;
const IDENTITY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,254}[A-Za-z0-9])?$/;
const VERSION_PATTERN = /^[0-9A-Za-z](?:[0-9A-Za-z._+-]{0,62}[0-9A-Za-z])?$/;
const SOURCE_TOKEN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@+-]{0,126}[A-Za-z0-9])?$/;
const HTTPS_SOURCE_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~%-]+)*$/;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE_METADATA_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/u;

const STATUS_BY_FINDING = Object.freeze({
  UNCHANGED: "SAFE_TO_REAPPLY",
  TARGET_CHANGED: "REVIEW_REQUIRED",
  TARGET_MISSING: "BLOCKED",
  POSSIBLE_RENAME: "REVIEW_REQUIRED",
  AMBIGUOUS_MATCH: "BLOCKED",
  NEW_UPSTREAM_PROMPT: "REVIEW_REQUIRED",
  UPSTREAM_NOT_READY: "UPSTREAM_NOT_READY",
});

const FINDING_FIELDS = Object.freeze({
  UNCHANGED: [
    "kind",
    "status",
    "message",
    "customizationId",
    "targetId",
    "expectedDigest",
    "actualDigest",
  ],
  TARGET_CHANGED: [
    "kind",
    "status",
    "message",
    "customizationId",
    "targetId",
    "expectedDigest",
    "actualDigest",
  ],
  TARGET_MISSING: [
    "kind",
    "status",
    "message",
    "customizationId",
    "targetId",
    "expectedDigest",
  ],
  POSSIBLE_RENAME: [
    "kind",
    "status",
    "message",
    "customizationId",
    "targetId",
    "candidateTargetIds",
    "expectedDigest",
    "actualDigest",
  ],
  AMBIGUOUS_MATCH: [
    "kind",
    "status",
    "message",
    "customizationId",
    "targetId",
    "candidateTargetIds",
    "expectedDigest",
  ],
  NEW_UPSTREAM_PROMPT: [
    "kind",
    "status",
    "message",
    "targetId",
    "actualDigest",
  ],
  UPSTREAM_NOT_READY: ["kind", "status", "message"],
});

const STATUS_RANK = new Map(
  STATUS_PRECEDENCE.map((status, index) => [status, index]),
);

export class IssueReportInputError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "IssueReportInputError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new IssueReportInputError(code, path, detail);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_TYPE", path, "expected a plain object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_TYPE", path, "expected a plain object");
  }

  return value;
}

function requireExactKeys(value, expectedKeys, path) {
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      fail("UNKNOWN_FIELD", `${path}.${key}`, "field is not part of the public contract");
    }
  }

  for (const key of expectedKeys) {
    if (!hasOwn(value, key)) {
      fail("MISSING_FIELD", `${path}.${key}`, "required field is missing");
    }
  }
}

function requireString(value, path, minimum, maximum) {
  if (typeof value !== "string") {
    fail("INVALID_TYPE", path, "expected a string");
  }
  if (value.length < minimum || value.length > maximum) {
    fail("INVALID_LENGTH", path, `expected ${minimum}..${maximum} characters`);
  }
  return value;
}

function requirePattern(value, path, pattern, detail, minimum, maximum) {
  requireString(value, path, minimum, maximum);
  if (!pattern.test(value)) {
    fail("INVALID_VALUE", path, detail);
  }
  return value;
}

function requireReportId(value, path) {
  return requirePattern(
    value,
    path,
    REPORT_ID_PATTERN,
    "expected a portable report identifier",
    1,
    128,
  );
}

function requireIdentity(value, path) {
  return requirePattern(
    value,
    path,
    IDENTITY_PATTERN,
    "expected a portable identity without path separators or controls",
    1,
    256,
  );
}

function requireVersion(value, path) {
  return requirePattern(
    value,
    path,
    VERSION_PATTERN,
    "expected a bounded version token",
    1,
    64,
  );
}

function requireSource(value, path) {
  requireString(value, path, 1, 256);
  if (!SOURCE_TOKEN_PATTERN.test(value) && !HTTPS_SOURCE_PATTERN.test(value)) {
    fail(
      "INVALID_VALUE",
      path,
      "expected a portable source token or canonical https source identifier",
    );
  }
  return value;
}

function requireMetadataText(value, path) {
  requireString(value, path, 1, 256);
  if (value.trim().length === 0 || UNSAFE_METADATA_PATTERN.test(value)) {
    fail("INVALID_VALUE", path, "metadata must not contain controls or line separators");
  }
  return value;
}

function requireRenderableText(value, path) {
  requireString(value, path, 1, 512);
  if (value.trim().length === 0) {
    fail("INVALID_VALUE", path, "text must not be empty or whitespace-only");
  }
  return value;
}

function requireDigest(value, path) {
  return requirePattern(
    value,
    path,
    DIGEST_PATTERN,
    "expected sha256 followed by 64 lowercase hex characters",
    71,
    71,
  );
}

function requireInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_VALUE", path, "expected a non-negative safe integer");
  }
  return value;
}

function requireCanonicalUtc(value, path) {
  if (typeof value !== "string") {
    fail("INVALID_TYPE", path, "expected a string");
  }
  if (!CANONICAL_UTC_PATTERN.test(value)) {
    fail("INVALID_TIMESTAMP", path, "expected canonical UTC ISO-8601 with milliseconds");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    fail("INVALID_TIMESTAMP", path, "timestamp is not a real canonical UTC instant");
  }
  return value;
}

function requireEnum(value, allowed, path) {
  if (!allowed.includes(value)) {
    fail("INVALID_VALUE", path, `expected one of ${allowed.join(", ")}`);
  }
  return value;
}

function cloneBaseline(value, path) {
  requireRecord(value, path);
  requireExactKeys(value, ["source", "version", "inventoryDigest"], path);
  return {
    source: requireSource(value.source, `${path}.source`),
    version: requireVersion(value.version, `${path}.version`),
    inventoryDigest: requireDigest(value.inventoryDigest, `${path}.inventoryDigest`),
  };
}

function cloneUpstream(value, path) {
  requireRecord(value, path);
  const allowed = ["ready", "source", "version", "inventoryDigest"];
  if (hasOwn(value, "readinessReason")) {
    allowed.push("readinessReason");
  }
  requireExactKeys(value, allowed, path);

  if (typeof value.ready !== "boolean") {
    fail("INVALID_TYPE", `${path}.ready`, "expected a boolean");
  }

  const clone = {
    ready: value.ready,
    source: requireSource(value.source, `${path}.source`),
    version: null,
    inventoryDigest: null,
  };

  if (value.ready) {
    clone.version = requireVersion(value.version, `${path}.version`);
    clone.inventoryDigest = requireDigest(
      value.inventoryDigest,
      `${path}.inventoryDigest`,
    );
    if (hasOwn(value, "readinessReason")) {
      fail(
        "INVALID_VALUE",
        `${path}.readinessReason`,
        "ready upstream metadata must not include a readiness reason",
      );
    }
  } else {
    if (value.version !== null) {
      fail("INVALID_VALUE", `${path}.version`, "non-ready upstream version must be null");
    }
    if (value.inventoryDigest !== null) {
      fail(
        "INVALID_VALUE",
        `${path}.inventoryDigest`,
        "non-ready upstream inventory digest must be null",
      );
    }
    if (!hasOwn(value, "readinessReason")) {
      fail(
        "MISSING_FIELD",
        `${path}.readinessReason`,
        "non-ready upstream metadata requires a reason",
      );
    }
    clone.readinessReason = requireMetadataText(
      value.readinessReason,
      `${path}.readinessReason`,
    );
  }

  return clone;
}

function cloneSummary(value, path) {
  requireRecord(value, path);
  requireExactKeys(value, ["frozenTargets", "upstreamTargets", "findingCounts"], path);
  requireRecord(value.findingCounts, `${path}.findingCounts`);
  requireExactKeys(value.findingCounts, FINDING_KINDS, `${path}.findingCounts`);

  const findingCounts = {};
  for (const kind of FINDING_KINDS) {
    findingCounts[kind] = requireInteger(
      value.findingCounts[kind],
      `${path}.findingCounts.${kind}`,
    );
  }

  return {
    frozenTargets: requireInteger(value.frozenTargets, `${path}.frozenTargets`),
    upstreamTargets: requireInteger(value.upstreamTargets, `${path}.upstreamTargets`),
    findingCounts,
  };
}

function cloneCandidateIds(value, path, minimum) {
  if (!Array.isArray(value)) {
    fail("INVALID_TYPE", path, "expected an array");
  }
  if (value.length < minimum) {
    fail("INVALID_LENGTH", path, `expected at least ${minimum} candidate IDs`);
  }

  const clone = value.map((candidate, index) =>
    requireIdentity(candidate, `${path}[${index}]`),
  );
  if (new Set(clone).size !== clone.length) {
    fail("DUPLICATE_VALUE", path, "candidate IDs must be unique");
  }
  return clone;
}

function cloneFinding(value, path) {
  requireRecord(value, path);
  const kind = requireEnum(value.kind, FINDING_KINDS, `${path}.kind`);
  const expectedFields = FINDING_FIELDS[kind];
  requireExactKeys(value, expectedFields, path);

  const status = requireEnum(
    value.status,
    COMPATIBILITY_STATUSES,
    `${path}.status`,
  );
  if (status !== STATUS_BY_FINDING[kind]) {
    fail("INCONSISTENT_STATUS", `${path}.status`, "finding status does not match its kind");
  }

  const clone = {
    kind,
    status,
    message: requireRenderableText(value.message, `${path}.message`),
  };

  if (hasOwn(value, "customizationId")) {
    clone.customizationId = requireIdentity(
      value.customizationId,
      `${path}.customizationId`,
    );
  }
  if (hasOwn(value, "targetId")) {
    clone.targetId = requireIdentity(value.targetId, `${path}.targetId`);
  }
  if (hasOwn(value, "candidateTargetIds")) {
    clone.candidateTargetIds = cloneCandidateIds(
      value.candidateTargetIds,
      `${path}.candidateTargetIds`,
      kind === "AMBIGUOUS_MATCH" ? 2 : 1,
    );
    if (kind === "POSSIBLE_RENAME" && clone.candidateTargetIds.length !== 1) {
      fail(
        "INVALID_LENGTH",
        `${path}.candidateTargetIds`,
        "possible rename requires exactly one candidate",
      );
    }
  }
  if (hasOwn(value, "expectedDigest")) {
    clone.expectedDigest = requireDigest(
      value.expectedDigest,
      `${path}.expectedDigest`,
    );
  }
  if (hasOwn(value, "actualDigest")) {
    clone.actualDigest = requireDigest(value.actualDigest, `${path}.actualDigest`);
  }

  return clone;
}

function foldStatus(findings) {
  let status = "SAFE_TO_REAPPLY";
  for (const finding of findings) {
    if (STATUS_RANK.get(finding.status) > STATUS_RANK.get(status)) {
      status = finding.status;
    }
  }
  return status;
}

function validateCounts(summary, findings, path) {
  const actualCounts = Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0]));
  for (const finding of findings) {
    actualCounts[finding.kind] += 1;
  }

  for (const kind of FINDING_KINDS) {
    if (summary.findingCounts[kind] !== actualCounts[kind]) {
      fail(
        "INCONSISTENT_SUMMARY",
        `${path}.findingCounts.${kind}`,
        "count does not match findings",
      );
    }
  }
}

export function cloneAndValidateIssueReport(value, path = "report") {
  requireRecord(value, path);
  const allowed = [
    "contractVersion",
    "reportId",
    "generatedAt",
    "status",
    "mutationsPerformed",
    "baseline",
    "upstream",
    "summary",
    "findings",
  ];
  if (hasOwn(value, "$schema")) {
    allowed.unshift("$schema");
  }
  requireExactKeys(value, allowed, path);

  if (value.contractVersion !== "1") {
    fail("UNSUPPORTED_CONTRACT_VERSION", `${path}.contractVersion`, "expected contract version 1");
  }
  if (value.mutationsPerformed !== false) {
    fail("INVALID_VALUE", `${path}.mutationsPerformed`, "must be false");
  }
  if (!Array.isArray(value.findings)) {
    fail("INVALID_TYPE", `${path}.findings`, "expected an array");
  }

  const status = requireEnum(value.status, COMPATIBILITY_STATUSES, `${path}.status`);
  const baseline = cloneBaseline(value.baseline, `${path}.baseline`);
  const upstream = cloneUpstream(value.upstream, `${path}.upstream`);
  const summary = cloneSummary(value.summary, `${path}.summary`);
  const findings = value.findings.map((finding, index) =>
    cloneFinding(finding, `${path}.findings[${index}]`),
  );

  validateCounts(summary, findings, `${path}.summary`);
  if (status !== foldStatus(findings)) {
    fail("INCONSISTENT_STATUS", `${path}.status`, "overall status does not match findings");
  }
  if (upstream.ready === (status === "UPSTREAM_NOT_READY")) {
    fail(
      "INCONSISTENT_READINESS",
      `${path}.upstream.ready`,
      "upstream readiness does not match the classification status",
    );
  }

  const clone = {};
  if (hasOwn(value, "$schema")) {
    clone.$schema = requireString(value.$schema, `${path}.$schema`, 1, 256);
  }
  clone.contractVersion = "1";
  clone.reportId = requireReportId(value.reportId, `${path}.reportId`);
  clone.generatedAt = requireCanonicalUtc(value.generatedAt, `${path}.generatedAt`);
  clone.status = status;
  clone.mutationsPerformed = false;
  clone.baseline = baseline;
  clone.upstream = upstream;
  clone.summary = summary;
  clone.findings = findings;
  return clone;
}

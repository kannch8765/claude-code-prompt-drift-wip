import { FINDING_KINDS, STATUS_PRECEDENCE } from "./contracts.mjs";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const STATUS_BY_FINDING = Object.freeze({
  UNCHANGED: "SAFE_TO_REAPPLY",
  TARGET_CHANGED: "REVIEW_REQUIRED",
  TARGET_MISSING: "BLOCKED",
  POSSIBLE_RENAME: "REVIEW_REQUIRED",
  AMBIGUOUS_MATCH: "BLOCKED",
  NEW_UPSTREAM_PROMPT: "REVIEW_REQUIRED",
  UPSTREAM_NOT_READY: "UPSTREAM_NOT_READY",
});
const STATUS_RANK = new Map(
  STATUS_PRECEDENCE.map((status, index) => [status, index]),
);

export class ClassificationInputError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "ClassificationInputError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new ClassificationInputError(code, path, detail);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_TYPE", path, "expected an object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_TYPE", path, "expected a plain object");
  }
}

function requireField(record, key, path) {
  if (!hasOwn(record, key)) {
    fail("MISSING_FIELD", `${path}.${key}`, "required field is missing");
  }

  return record[key];
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("INVALID_TYPE", path, "expected a boolean");
  }

  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    fail("INVALID_TYPE", path, "expected an array");
  }

  return value;
}

function requireNonEmptyString(value, path) {
  if (typeof value !== "string") {
    fail("INVALID_TYPE", path, "expected a string");
  }

  if (value.trim().length === 0) {
    fail("INVALID_VALUE", path, "must not be empty or whitespace-only");
  }

  return value;
}

function requireDigest(value, path) {
  requireNonEmptyString(value, path);
  if (!DIGEST_PATTERN.test(value)) {
    fail("INVALID_DIGEST", path, "expected sha256 followed by 64 lowercase hex characters");
  }

  return value;
}

function normalizeMatchText(value) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}

function validateAliases(value, path) {
  if (value === undefined) {
    return [];
  }

  requireArray(value, path);
  return value.map((alias, index) => {
    const aliasPath = `${path}[${index}]`;
    requireNonEmptyString(alias, aliasPath);
    if (normalizeMatchText(alias).length === 0) {
      fail("INVALID_VALUE", aliasPath, "normalizes to an empty string");
    }
    return alias;
  });
}

function buildMatchKeys(displayName, aliases) {
  return new Set([displayName, ...aliases].map(normalizeMatchText));
}

function validateFrozenEntries(entries) {
  const customizationIds = new Set();
  const targetIds = new Set();

  return entries.map((entry, index) => {
    const path = `frozenEntries[${index}]`;
    requireRecord(entry, path);

    const customizationId = requireNonEmptyString(
      requireField(entry, "customizationId", path),
      `${path}.customizationId`,
    );
    const targetId = requireNonEmptyString(
      requireField(entry, "targetId", path),
      `${path}.targetId`,
    );
    const displayName = requireNonEmptyString(
      requireField(entry, "displayName", path),
      `${path}.displayName`,
    );
    const expectedDigest = requireDigest(
      requireField(entry, "expectedDigest", path),
      `${path}.expectedDigest`,
    );
    const aliases = validateAliases(entry.aliases, `${path}.aliases`);

    if (customizationIds.has(customizationId)) {
      fail(
        "DUPLICATE_CUSTOMIZATION_ID",
        `${path}.customizationId`,
        `duplicate customizationId ${JSON.stringify(customizationId)}`,
      );
    }
    customizationIds.add(customizationId);

    if (targetIds.has(targetId)) {
      fail(
        "DUPLICATE_FROZEN_TARGET_ID",
        `${path}.targetId`,
        `duplicate frozen targetId ${JSON.stringify(targetId)}`,
      );
    }
    targetIds.add(targetId);

    return {
      customizationId,
      targetId,
      displayName,
      expectedDigest,
      aliases,
      matchKeys: buildMatchKeys(displayName, aliases),
    };
  });
}

function validateUpstreamEntries(entries) {
  const targetIds = new Set();

  return entries.map((entry, index) => {
    const path = `upstreamEntries[${index}]`;
    requireRecord(entry, path);

    const targetId = requireNonEmptyString(
      requireField(entry, "targetId", path),
      `${path}.targetId`,
    );
    const displayName = requireNonEmptyString(
      requireField(entry, "displayName", path),
      `${path}.displayName`,
    );
    const digest = requireDigest(
      requireField(entry, "digest", path),
      `${path}.digest`,
    );
    const aliases = validateAliases(entry.aliases, `${path}.aliases`);

    if (targetIds.has(targetId)) {
      fail(
        "DUPLICATE_UPSTREAM_TARGET_ID",
        `${path}.targetId`,
        `duplicate upstream targetId ${JSON.stringify(targetId)}`,
      );
    }
    targetIds.add(targetId);

    return {
      targetId,
      displayName,
      digest,
      aliases,
      matchKeys: buildMatchKeys(displayName, aliases),
    };
  });
}

function createFinding(kind, fields = {}) {
  return {
    kind,
    status: STATUS_BY_FINDING[kind],
    message: findingMessage(kind),
    ...fields,
  };
}

function findingMessage(kind) {
  switch (kind) {
    case "UNCHANGED":
      return "Exact target ID and digest match.";
    case "TARGET_CHANGED":
      return "Exact target ID exists, but its digest changed.";
    case "TARGET_MISSING":
      return "Exact target ID is absent and no explicit normalized name or alias candidate remains.";
    case "POSSIBLE_RENAME":
      return "Exact target ID is absent and exactly one explicit normalized name or alias candidate remains.";
    case "AMBIGUOUS_MATCH":
      return "Exact target ID is absent and multiple explicit normalized name or alias candidates remain.";
    case "NEW_UPSTREAM_PROMPT":
      return "Upstream entry was not consumed by an exact match or unique rename.";
    case "UPSTREAM_NOT_READY":
      return "Upstream inventory is not ready for classification.";
    default:
      throw new Error(`Unsupported finding kind: ${kind}`);
  }
}

function hasMatchKeyIntersection(left, right) {
  for (const key of left) {
    if (right.has(key)) {
      return true;
    }
  }
  return false;
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

function summarize(frozenTargets, upstreamTargets, findings) {
  const findingCounts = Object.fromEntries(
    FINDING_KINDS.map((kind) => [kind, 0]),
  );

  for (const finding of findings) {
    findingCounts[finding.kind] += 1;
  }

  return {
    frozenTargets,
    upstreamTargets,
    findingCounts,
  };
}

export function classifyInventory(input) {
  requireRecord(input, "input");

  const upstreamReady = requireBoolean(
    requireField(input, "upstreamReady", "input"),
    "input.upstreamReady",
  );
  const frozenEntriesInput = requireArray(
    requireField(input, "frozenEntries", "input"),
    "input.frozenEntries",
  );
  const upstreamEntriesInput = requireArray(
    requireField(input, "upstreamEntries", "input"),
    "input.upstreamEntries",
  );
  const frozenEntries = validateFrozenEntries(frozenEntriesInput);
  const upstreamEntries = validateUpstreamEntries(upstreamEntriesInput);

  if (upstreamReady !== true) {
    const findings = [createFinding("UPSTREAM_NOT_READY")];
    return {
      status: "UPSTREAM_NOT_READY",
      findings,
      summary: summarize(frozenEntries.length, upstreamEntries.length, findings),
    };
  }

  const upstreamByTargetId = new Map(
    upstreamEntries.map((entry) => [entry.targetId, entry]),
  );
  const reservedExactTargetIds = new Set(
    frozenEntries
      .filter((entry) => upstreamByTargetId.has(entry.targetId))
      .map((entry) => entry.targetId),
  );
  const consumedUpstreamTargetIds = new Set();
  const ambiguousCandidateTargetIds = new Set();
  const findings = [];

  for (const frozenEntry of frozenEntries) {
    const exact = upstreamByTargetId.get(frozenEntry.targetId);

    if (exact !== undefined) {
      consumedUpstreamTargetIds.add(exact.targetId);
      if (exact.digest === frozenEntry.expectedDigest) {
        findings.push(
          createFinding("UNCHANGED", {
            customizationId: frozenEntry.customizationId,
            targetId: frozenEntry.targetId,
            expectedDigest: frozenEntry.expectedDigest,
            actualDigest: exact.digest,
          }),
        );
      } else {
        findings.push(
          createFinding("TARGET_CHANGED", {
            customizationId: frozenEntry.customizationId,
            targetId: frozenEntry.targetId,
            expectedDigest: frozenEntry.expectedDigest,
            actualDigest: exact.digest,
          }),
        );
      }
      continue;
    }

    const candidates = upstreamEntries.filter(
      (entry) =>
        !reservedExactTargetIds.has(entry.targetId) &&
        !consumedUpstreamTargetIds.has(entry.targetId) &&
        !ambiguousCandidateTargetIds.has(entry.targetId) &&
        hasMatchKeyIntersection(frozenEntry.matchKeys, entry.matchKeys),
    );

    if (candidates.length === 1) {
      const [candidate] = candidates;
      consumedUpstreamTargetIds.add(candidate.targetId);
      findings.push(
        createFinding("POSSIBLE_RENAME", {
          customizationId: frozenEntry.customizationId,
          targetId: frozenEntry.targetId,
          candidateTargetIds: [candidate.targetId],
          expectedDigest: frozenEntry.expectedDigest,
          actualDigest: candidate.digest,
        }),
      );
    } else if (candidates.length > 1) {
      for (const candidate of candidates) {
        ambiguousCandidateTargetIds.add(candidate.targetId);
      }
      findings.push(
        createFinding("AMBIGUOUS_MATCH", {
          customizationId: frozenEntry.customizationId,
          targetId: frozenEntry.targetId,
          candidateTargetIds: candidates.map((candidate) => candidate.targetId),
          expectedDigest: frozenEntry.expectedDigest,
        }),
      );
    } else {
      findings.push(
        createFinding("TARGET_MISSING", {
          customizationId: frozenEntry.customizationId,
          targetId: frozenEntry.targetId,
          expectedDigest: frozenEntry.expectedDigest,
        }),
      );
    }
  }

  for (const upstreamEntry of upstreamEntries) {
    if (!consumedUpstreamTargetIds.has(upstreamEntry.targetId)) {
      findings.push(
        createFinding("NEW_UPSTREAM_PROMPT", {
          targetId: upstreamEntry.targetId,
          actualDigest: upstreamEntry.digest,
        }),
      );
    }
  }

  return {
    status: foldStatus(findings),
    findings,
    summary: summarize(frozenEntries.length, upstreamEntries.length, findings),
  };
}

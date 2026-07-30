import { FINDING_KINDS } from "./contracts.mjs";

const MAX_REPORT_INSPECTION_DEPTH = 16;
const UNKNOWN_FIELD_PATH = "[unknown-field]";

const REPORT_KEYS = Object.freeze([
  "$schema",
  "contractVersion",
  "reportId",
  "generatedAt",
  "status",
  "mutationsPerformed",
  "baseline",
  "upstream",
  "summary",
  "findings",
]);
const BASELINE_KEYS = Object.freeze(["source", "version", "inventoryDigest"]);
const UPSTREAM_KEYS = Object.freeze([
  "ready",
  "source",
  "version",
  "inventoryDigest",
  "readinessReason",
]);
const SUMMARY_KEYS = Object.freeze(["frozenTargets", "upstreamTargets", "findingCounts"]);
const FINDING_KEYS = Object.freeze([
  "kind",
  "status",
  "message",
  "customizationId",
  "targetId",
  "candidateTargetIds",
  "expectedDigest",
  "actualDigest",
]);

export class SafeIssueReportInspectionError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "SafeIssueReportInspectionError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new SafeIssueReportInspectionError(code, path, detail);
}

function unknownPath(path) {
  return `${path}.${UNKNOWN_FIELD_PATH}`;
}

function requireDepth(path, depth) {
  if (depth > MAX_REPORT_INSPECTION_DEPTH) {
    fail("REPORT_DEPTH_LIMIT", path, "report structure exceeds the inspection depth limit");
  }
}

function inspectPlainObject(value, path, depth) {
  requireDepth(path, depth);

  let isArray = false;
  if (value !== null && typeof value === "object") {
    try {
      isArray = Array.isArray(value);
    } catch {
      fail("UNSAFE_PROPERTY_ACCESS", path, "report properties could not be inspected safely");
    }
  }
  if (value === null || typeof value !== "object" || isArray) {
    fail("INVALID_TYPE", path, "expected a plain object");
  }

  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "report properties could not be inspected safely");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_TYPE", path, "expected a plain object");
  }

  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "report properties could not be inspected safely");
  }
}

function inspectArray(value, path, depth) {
  requireDepth(path, depth);

  let isArray;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "report array could not be inspected safely");
  }
  if (!isArray) {
    fail("INVALID_TYPE", path, "expected an array");
  }

  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "report array could not be inspected safely");
  }
  if (prototype !== Array.prototype) {
    fail("INVALID_TYPE", path, "expected a plain array");
  }

  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "report array could not be inspected safely");
  }

  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    fail("UNSAFE_PROPERTY_ACCESS", path, "report array length could not be inspected safely");
  }

  const allowed = new Set(["length"]);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    allowed.add(String(index));
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("UNKNOWN_FIELD", unknownPath(path), "field is not part of the report contract");
    }
  }

  return { descriptors, length: lengthDescriptor.value };
}

function enter(value, path, active) {
  if (active.has(value)) {
    fail("CIRCULAR_REFERENCE", path, "report structure must not contain cycles");
  }
  active.add(value);
}

function cloneRecord(value, path, allowedKeys, cloneKnownField, active, depth) {
  const descriptors = inspectPlainObject(value, path, depth);
  const allowed = new Set(allowedKeys);

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("UNKNOWN_FIELD", unknownPath(path), "field is not part of the report contract");
    }
  }

  enter(value, path, active);
  try {
    const clone = {};
    for (const key of allowedKeys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined) {
        continue;
      }
      if (!("value" in descriptor)) {
        fail(
          "ACCESSOR_PROPERTY_NOT_ALLOWED",
          `${path}.${key}`,
          "accessor properties are not part of the report contract",
        );
      }
      clone[key] = cloneKnownField(key, descriptor.value, active, depth + 1);
    }
    return clone;
  } finally {
    active.delete(value);
  }
}

function clonePrimitiveArray(value, path, active, depth) {
  const { descriptors, length } = inspectArray(value, path, depth);
  enter(value, path, active);
  try {
    const clone = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined) {
        clone.push(undefined);
      } else if (!("value" in descriptor)) {
        fail(
          "ACCESSOR_PROPERTY_NOT_ALLOWED",
          `${path}[${index}]`,
          "accessor array entries are not part of the report contract",
        );
      } else {
        clone.push(descriptor.value);
      }
    }
    return clone;
  } finally {
    active.delete(value);
  }
}

function cloneFinding(value, path, active, depth) {
  return cloneRecord(
    value,
    path,
    FINDING_KEYS,
    (key, fieldValue, nextActive, nextDepth) =>
      key === "candidateTargetIds"
        ? clonePrimitiveArray(fieldValue, `${path}.candidateTargetIds`, nextActive, nextDepth)
        : fieldValue,
    active,
    depth,
  );
}

function cloneFindings(value, path, active, depth) {
  const { descriptors, length } = inspectArray(value, path, depth);
  enter(value, path, active);
  try {
    const clone = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined) {
        clone.push(undefined);
      } else if (!("value" in descriptor)) {
        fail(
          "ACCESSOR_PROPERTY_NOT_ALLOWED",
          `${path}[${index}]`,
          "accessor array entries are not part of the report contract",
        );
      } else {
        clone.push(cloneFinding(descriptor.value, `${path}[${index}]`, active, depth + 1));
      }
    }
    return clone;
  } finally {
    active.delete(value);
  }
}

function cloneBaseline(value, path, active, depth) {
  return cloneRecord(value, path, BASELINE_KEYS, (_key, fieldValue) => fieldValue, active, depth);
}

function cloneUpstream(value, path, active, depth) {
  return cloneRecord(value, path, UPSTREAM_KEYS, (_key, fieldValue) => fieldValue, active, depth);
}

function cloneFindingCounts(value, path, active, depth) {
  return cloneRecord(value, path, FINDING_KINDS, (_key, fieldValue) => fieldValue, active, depth);
}

function cloneSummary(value, path, active, depth) {
  return cloneRecord(
    value,
    path,
    SUMMARY_KEYS,
    (key, fieldValue, nextActive, nextDepth) =>
      key === "findingCounts"
        ? cloneFindingCounts(fieldValue, `${path}.findingCounts`, nextActive, nextDepth)
        : fieldValue,
    active,
    depth,
  );
}

export function cloneSafeIssueReportInput(value, path = "report") {
  const active = new WeakSet();
  return cloneRecord(
    value,
    path,
    REPORT_KEYS,
    (key, fieldValue, nextActive, nextDepth) => {
      switch (key) {
        case "baseline":
          return cloneBaseline(fieldValue, `${path}.baseline`, nextActive, nextDepth);
        case "upstream":
          return cloneUpstream(fieldValue, `${path}.upstream`, nextActive, nextDepth);
        case "summary":
          return cloneSummary(fieldValue, `${path}.summary`, nextActive, nextDepth);
        case "findings":
          return cloneFindings(fieldValue, `${path}.findings`, nextActive, nextDepth);
        default:
          return fieldValue;
      }
    },
    active,
    0,
  );
}

import { cloneAndValidateIssueReport } from "./issue-report-contract.mjs";
import {
  ISSUE_REPORT_MARKER,
  renderIssueMarkdown,
} from "./render-issue-markdown.mjs";

export const ISSUE_IDENTITY_MARKER =
  "<!-- claude-code-prompt-drift:rolling-issue:v1 -->";
export const ISSUE_TITLE_MAX_CHARACTERS = 256;
export const ISSUE_BODY_MAX_CHARACTERS = 65_536;

const TITLE_BY_STATUS = Object.freeze({
  SAFE_TO_REAPPLY: "Claude Code Prompt Drift — SAFE_TO_REAPPLY",
  REVIEW_REQUIRED: "Claude Code Prompt Drift — REVIEW_REQUIRED",
  BLOCKED: "Claude Code Prompt Drift — BLOCKED",
  UPSTREAM_NOT_READY: "Claude Code Prompt Drift — UPSTREAM_NOT_READY",
});

const ISSUE_RECORD_KEYS = new Set([
  "number",
  "state",
  "title",
  "body",
  "pull_request",
]);

export class IssuePublicationError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "IssuePublicationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new IssuePublicationError(code, path, detail);
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

function rejectAccessorProperties(descriptors, path, code = "ACCESSOR_PROPERTY_NOT_ALLOWED") {
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor)) {
      const propertyPath =
        typeof key === "string" ? `${path}.${key}` : `${path}.[symbol]`;
      fail(code, propertyPath, "accessor properties are not part of the public contract");
    }
  }
}

function readStrictDataRecord(value, path, expectedKeys, requiredKeys = expectedKeys) {
  const descriptors = inspectPlainObject(value, path);
  const expected = new Set(expectedKeys);

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !expected.has(key)) {
      fail("UNKNOWN_FIELD", path, "field is not part of the public API");
    }
    if (!("value" in descriptors[key])) {
      fail(
        "ACCESSOR_PROPERTY_NOT_ALLOWED",
        `${path}.${key}`,
        "accessor properties are not part of the public contract",
      );
    }
  }

  for (const key of requiredKeys) {
    if (descriptors[key] === undefined) {
      fail("MISSING_FIELD", `${path}.${key}`, "required field is missing");
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

function readDataArray(value, path) {
  let isArray;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "array properties could not be inspected safely");
  }
  if (!isArray) {
    fail("INVALID_TYPE", path, "expected an array");
  }

  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail("UNSAFE_PROPERTY_ACCESS", path, "array properties could not be inspected safely");
  }

  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    fail("INVALID_TYPE", path, "expected a safely inspectable array");
  }

  const clone = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) {
      clone.push(undefined);
      continue;
    }
    if (!("value" in descriptor)) {
      fail(
        "ACCESSOR_PROPERTY_NOT_ALLOWED",
        `${path}[${index}]`,
        "accessor array entries are not part of the public contract",
      );
    }
    clone.push(descriptor.value);
  }
  return clone;
}

function requirePlannerInput(value) {
  return readStrictDataRecord(value, "input", ["report", "markdown", "issues"]);
}

function countOccurrences(value, marker) {
  let count = 0;
  let offset = 0;

  while (true) {
    const index = value.indexOf(marker, offset);
    if (index === -1) {
      return count;
    }
    count += 1;
    offset = index + marker.length;
  }
}

function validateReportAndMarkdown(report, markdown) {
  let validatedReport;
  try {
    validatedReport = cloneAndValidateIssueReport(report);
  } catch {
    fail("INVALID_REPORT", "report", "report does not satisfy the Task 003 contract");
  }

  if (typeof markdown !== "string") {
    fail("INVALID_TYPE", "markdown", "expected a string");
  }

  const expectedMarkdown = renderIssueMarkdown(validatedReport);
  if (markdown !== expectedMarkdown) {
    fail(
      "MARKDOWN_MISMATCH",
      "markdown",
      "markdown must exactly equal renderIssueMarkdown(report)",
    );
  }

  if (
    !markdown.startsWith(`${ISSUE_REPORT_MARKER}\n`) ||
    countOccurrences(markdown, ISSUE_REPORT_MARKER) !== 1
  ) {
    fail(
      "INVALID_RENDERED_MARKDOWN",
      "markdown",
      "Task 003 report marker must be the first line and occur exactly once",
    );
  }

  const title = TITLE_BY_STATUS[validatedReport.status];
  if (title === undefined) {
    fail("INVALID_REPORT", "report.status", "unsupported compatibility status");
  }
  if (title.length > ISSUE_TITLE_MAX_CHARACTERS) {
    fail(
      "PUBLICATION_TITLE_TOO_LARGE",
      "title",
      `publication title exceeds the ${ISSUE_TITLE_MAX_CHARACTERS}-character contract`,
    );
  }

  const body = `${ISSUE_IDENTITY_MARKER}\n\n${markdown}`;
  if (
    !body.startsWith(`${ISSUE_IDENTITY_MARKER}\n`) ||
    countOccurrences(body, ISSUE_IDENTITY_MARKER) !== 1
  ) {
    fail(
      "INVALID_PUBLICATION_BODY",
      "body",
      "publisher identity marker invariant was not satisfied",
    );
  }
  if (body.length > ISSUE_BODY_MAX_CHARACTERS) {
    fail(
      "PUBLICATION_BODY_TOO_LARGE",
      "body",
      `publication body exceeds the ${ISSUE_BODY_MAX_CHARACTERS}-character contract`,
    );
  }

  return { title, body };
}

function requireIssueRecord(value, path) {
  const record = readStrictDataRecord(
    value,
    path,
    [...ISSUE_RECORD_KEYS],
    ["number", "state", "title", "body"],
  );

  if (!Number.isSafeInteger(record.number) || record.number <= 0) {
    fail("INVALID_VALUE", `${path}.number`, "expected a positive safe integer");
  }
  if (record.state !== "open" && record.state !== "closed") {
    fail("INVALID_VALUE", `${path}.state`, "expected open or closed");
  }
  if (
    typeof record.title !== "string" ||
    record.title.length === 0 ||
    record.title.length > ISSUE_TITLE_MAX_CHARACTERS
  ) {
    fail(
      "INVALID_VALUE",
      `${path}.title`,
      `expected a non-empty title up to ${ISSUE_TITLE_MAX_CHARACTERS} characters`,
    );
  }
  if (
    typeof record.body !== "string" ||
    record.body.length > ISSUE_BODY_MAX_CHARACTERS
  ) {
    fail(
      "INVALID_VALUE",
      `${path}.body`,
      `expected a string up to ${ISSUE_BODY_MAX_CHARACTERS} characters`,
    );
  }

  const isPullRequest = Object.hasOwn(record, "pull_request");
  if (isPullRequest) {
    const descriptors = inspectPlainObject(record.pull_request, `${path}.pull_request`);
    rejectAccessorProperties(descriptors, `${path}.pull_request`);
  }

  return {
    number: record.number,
    state: record.state,
    title: record.title,
    body: record.body,
    isPullRequest,
  };
}

function hasCanonicalPrefix(body) {
  return (
    body === ISSUE_IDENTITY_MARKER ||
    body.startsWith(`${ISSUE_IDENTITY_MARKER}\n`) ||
    body.startsWith(`${ISSUE_IDENTITY_MARKER}\r\n`)
  );
}

function findCanonicalCandidate(issues) {
  const records = readDataArray(issues, "issues");
  const candidates = [];

  for (let index = 0; index < records.length; index += 1) {
    const path = `issues[${index}]`;
    const issue = requireIssueRecord(records[index], path);

    if (issue.state !== "open" || issue.isPullRequest) {
      continue;
    }

    if (!hasCanonicalPrefix(issue.body)) {
      continue;
    }

    const markerCount = countOccurrences(issue.body, ISSUE_IDENTITY_MARKER);
    if (markerCount !== 1) {
      fail(
        "DUPLICATE_ISSUE_MARKER",
        `${path}.body`,
        "canonical Issue body must contain exactly one publisher marker",
      );
    }

    candidates.push(issue);
  }

  if (candidates.length > 1) {
    fail(
      "AMBIGUOUS_ISSUE_IDENTITY",
      "issues",
      "more than one open canonical Issue identity was found",
    );
  }

  return candidates[0] ?? null;
}

export function planIssuePublication(input) {
  const validatedInput = requirePlannerInput(input);
  const { title, body } = validateReportAndMarkdown(
    validatedInput.report,
    validatedInput.markdown,
  );
  const candidate = findCanonicalCandidate(validatedInput.issues);

  if (candidate === null) {
    return {
      action: "CREATE",
      issueNumber: null,
      title,
      body,
    };
  }

  if (candidate.title === title && candidate.body === body) {
    return {
      action: "NOOP",
      issueNumber: candidate.number,
      title,
      body,
    };
  }

  return {
    action: "UPDATE",
    issueNumber: candidate.number,
    title,
    body,
  };
}

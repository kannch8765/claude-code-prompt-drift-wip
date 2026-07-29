import { cloneAndValidateIssueReport } from "./issue-report-contract.mjs";
import {
  ISSUE_REPORT_MARKER,
  renderIssueMarkdown,
} from "./render-issue-markdown.mjs";

export const ISSUE_IDENTITY_MARKER =
  "<!-- claude-code-prompt-drift:rolling-issue:v1 -->";

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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requirePlainObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_TYPE", path, "expected a plain object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_TYPE", path, "expected a plain object");
  }

  return value;
}

function requirePlannerInput(value) {
  requirePlainObject(value, "input");
  const expected = new Set(["report", "markdown", "issues"]);

  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      fail("UNKNOWN_FIELD", "input", "field is not part of the public API");
    }
  }

  for (const key of expected) {
    if (!hasOwn(value, key)) {
      fail("MISSING_FIELD", `input.${key}`, "required field is missing");
    }
  }
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
  } catch (error) {
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

  return { title, body };
}

function requireIssueRecord(value, path) {
  requirePlainObject(value, path);

  for (const key of Object.keys(value)) {
    if (!ISSUE_RECORD_KEYS.has(key)) {
      fail("UNKNOWN_FIELD", path, "field is not part of the client contract");
    }
  }

  for (const key of ["number", "state", "title", "body"]) {
    if (!hasOwn(value, key)) {
      fail("MISSING_FIELD", `${path}.${key}`, "required field is missing");
    }
  }

  if (!Number.isSafeInteger(value.number) || value.number <= 0) {
    fail("INVALID_VALUE", `${path}.number`, "expected a positive safe integer");
  }
  if (value.state !== "open" && value.state !== "closed") {
    fail("INVALID_VALUE", `${path}.state`, "expected open or closed");
  }
  if (
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    value.title.length > 256
  ) {
    fail("INVALID_VALUE", `${path}.title`, "expected a non-empty title up to 256 characters");
  }
  if (typeof value.body !== "string" || value.body.length > 65_536) {
    fail("INVALID_VALUE", `${path}.body`, "expected a string up to 65536 characters");
  }
  if (hasOwn(value, "pull_request")) {
    requirePlainObject(value.pull_request, `${path}.pull_request`);
  }

  return value;
}

function hasCanonicalPrefix(body) {
  return (
    body === ISSUE_IDENTITY_MARKER ||
    body.startsWith(`${ISSUE_IDENTITY_MARKER}\n`) ||
    body.startsWith(`${ISSUE_IDENTITY_MARKER}\r\n`)
  );
}

function findCanonicalCandidate(issues) {
  if (!Array.isArray(issues)) {
    fail("INVALID_TYPE", "issues", "expected an array");
  }

  const candidates = [];
  for (const [index, issue] of issues.entries()) {
    const path = `issues[${index}]`;
    requireIssueRecord(issue, path);

    if (issue.state !== "open" || hasOwn(issue, "pull_request")) {
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
  requirePlannerInput(input);
  const { title, body } = validateReportAndMarkdown(input.report, input.markdown);
  const candidate = findCanonicalCandidate(input.issues);

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

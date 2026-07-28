import { cloneAndValidateIssueReport, IssueReportInputError } from "./issue-report-contract.mjs";

export { IssueReportInputError };

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireInputRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new IssueReportInputError("INVALID_TYPE", "input", "expected a plain object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new IssueReportInputError("INVALID_TYPE", "input", "expected a plain object");
  }

  const expected = [
    "classification",
    "reportId",
    "generatedAt",
    "contractVersion",
    "baseline",
    "upstream",
  ];
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) {
      throw new IssueReportInputError(
        "UNKNOWN_FIELD",
        `input.${key}`,
        "field is not part of the public builder contract",
      );
    }
  }
  for (const key of expected) {
    if (!hasOwn(value, key)) {
      throw new IssueReportInputError(
        "MISSING_FIELD",
        `input.${key}`,
        "required field is missing",
      );
    }
  }
}

export function buildIssueReport(input) {
  requireInputRecord(input);

  const classification = input.classification;
  if (
    classification === null ||
    typeof classification !== "object" ||
    Array.isArray(classification)
  ) {
    throw new IssueReportInputError(
      "INVALID_TYPE",
      "input.classification",
      "expected a classifier result object",
    );
  }

  const classificationPrototype = Object.getPrototypeOf(classification);
  if (
    classificationPrototype !== Object.prototype &&
    classificationPrototype !== null
  ) {
    throw new IssueReportInputError(
      "INVALID_TYPE",
      "input.classification",
      "expected a classifier result object",
    );
  }

  const classificationKeys = ["status", "findings", "summary"];
  for (const key of Object.keys(classification)) {
    if (!classificationKeys.includes(key)) {
      throw new IssueReportInputError(
        "UNKNOWN_FIELD",
        `input.classification.${key}`,
        "field is not part of the classifier result contract",
      );
    }
  }
  for (const key of classificationKeys) {
    if (!hasOwn(classification, key)) {
      throw new IssueReportInputError(
        "MISSING_FIELD",
        `input.classification.${key}`,
        "required classifier result field is missing",
      );
    }
  }

  return cloneAndValidateIssueReport(
    {
      contractVersion: input.contractVersion,
      reportId: input.reportId,
      generatedAt: input.generatedAt,
      status: classification.status,
      mutationsPerformed: false,
      baseline: input.baseline,
      upstream: input.upstream,
      summary: classification.summary,
      findings: classification.findings,
    },
    "report",
  );
}

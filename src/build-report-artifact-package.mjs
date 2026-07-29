import { createHash } from "node:crypto";

import { cloneAndValidateIssueReport } from "./issue-report-contract.mjs";
import { renderIssueMarkdown } from "./render-issue-markdown.mjs";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ARTIFACT_NAME_PREFIX = "claude-code-prompt-drift-report-";

export class ReportArtifactError extends TypeError {
  constructor(code, path, detail) {
    super(`${code} at ${path}: ${detail}`);
    this.name = "ReportArtifactError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, detail) {
  throw new ReportArtifactError(code, path, detail);
}

function inspectObject(value, path) {
  let isArray = false;
  if (value !== null && typeof value === "object") {
    try {
      isArray = Array.isArray(value);
    } catch {
      fail("UNSAFE_PROPERTY_ACCESS", path, "value could not be inspected safely");
    }
  }
  if (value === null || typeof value !== "object") {
    fail("INVALID_TYPE", path, "expected an object or array");
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

  const { isArray, descriptors } = inspectObject(value, path);
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

function readInput(value) {
  const { isArray, descriptors } = inspectObject(value, "input");
  if (isArray) {
    fail("INVALID_TYPE", "input", "expected a plain object");
  }
  const expected = new Set(["report", "markdown"]);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !expected.has(key)) {
      fail("UNKNOWN_FIELD", "input", "field is not part of the public API");
    }
    if (!("value" in descriptors[key])) {
      fail(
        "ACCESSOR_PROPERTY_NOT_ALLOWED",
        `input.${String(key)}`,
        "accessor properties are not part of the public contract",
      );
    }
  }
  for (const key of expected) {
    if (descriptors[key] === undefined) {
      fail("MISSING_FIELD", `input.${key}`, "required field is missing");
    }
  }
  return {
    report: descriptors.report.value,
    markdown: descriptors.markdown.value,
  };
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
}

function describeFile(name, mediaType, content) {
  return {
    name,
    mediaType,
    utf8Bytes: Buffer.byteLength(content, "utf8"),
    utf16CodeUnits: content.length,
    sha256: sha256(content),
  };
}

function cloneDescriptor(value) {
  return {
    name: value.name,
    mediaType: value.mediaType,
    utf8Bytes: value.utf8Bytes,
    utf16CodeUnits: value.utf16CodeUnits,
    sha256: value.sha256,
  };
}

export function buildReportArtifactPackage(input) {
  const { report, markdown } = readInput(input);
  const safeReport = cloneStrictData(report, "report");

  let validatedReport;
  try {
    validatedReport = cloneAndValidateIssueReport(safeReport);
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

  const reportJsonContent = `${JSON.stringify(validatedReport, null, 2)}\n`;
  const reportMarkdownContent = markdown;
  const reportJson = describeFile(
    "issue-report.json",
    "application/json",
    reportJsonContent,
  );
  const reportMarkdown = describeFile(
    "issue-report.md",
    "text/markdown",
    reportMarkdownContent,
  );
  if (!DIGEST_PATTERN.test(reportJson.sha256) || !DIGEST_PATTERN.test(reportMarkdown.sha256)) {
    fail("INVALID_DIGEST", "files", "generated digest did not satisfy the SHA-256 contract");
  }

  const artifactName = `${ARTIFACT_NAME_PREFIX}${reportJson.sha256.slice("sha256:".length)}`;
  const manifestValue = {
    contractVersion: "1",
    artifactName,
    reportId: validatedReport.reportId,
    files: [cloneDescriptor(reportJson), cloneDescriptor(reportMarkdown)],
  };
  const manifestContent = `${JSON.stringify(manifestValue, null, 2)}\n`;
  const manifest = describeFile("manifest.json", "application/json", manifestContent);

  return {
    contractVersion: "1",
    artifactName,
    files: [
      {
        name: reportJson.name,
        mediaType: reportJson.mediaType,
        content: reportJsonContent,
        utf8Bytes: reportJson.utf8Bytes,
        utf16CodeUnits: reportJson.utf16CodeUnits,
        sha256: reportJson.sha256,
      },
      {
        name: reportMarkdown.name,
        mediaType: reportMarkdown.mediaType,
        content: reportMarkdownContent,
        utf8Bytes: reportMarkdown.utf8Bytes,
        utf16CodeUnits: reportMarkdown.utf16CodeUnits,
        sha256: reportMarkdown.sha256,
      },
      {
        name: manifest.name,
        mediaType: manifest.mediaType,
        content: manifestContent,
        utf8Bytes: manifest.utf8Bytes,
        utf16CodeUnits: manifest.utf16CodeUnits,
        sha256: manifest.sha256,
      },
    ],
    descriptor: {
      contractVersion: "1",
      artifactName,
      reportId: validatedReport.reportId,
      reportJson: cloneDescriptor(reportJson),
      reportMarkdown: cloneDescriptor(reportMarkdown),
      manifest: cloneDescriptor(manifest),
    },
  };
}

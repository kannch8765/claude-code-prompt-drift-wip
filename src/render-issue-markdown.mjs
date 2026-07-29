import { cloneAndValidateIssueReport } from "./issue-report-contract.mjs";

export const ISSUE_REPORT_MARKER = "<!-- claude-code-prompt-drift:issue-report:v1 -->";

const MARKDOWN_ENTITY = Object.freeze({
  "[": "&#91;",
  "]": "&#93;",
  "(": "&#40;",
  ")": "&#41;",
  "|": "&#124;",
  "#": "&#35;",
  "!": "&#33;",
  "*": "&#42;",
  "_": "&#95;",
});

const SECTION_RULES = Object.freeze([
  {
    title: "Blocked",
    kinds: new Set(["TARGET_MISSING", "AMBIGUOUS_MATCH"]),
  },
  {
    title: "Review required",
    kinds: new Set(["TARGET_CHANGED", "POSSIBLE_RENAME"]),
  },
  {
    title: "New upstream prompts",
    kinds: new Set(["NEW_UPSTREAM_PROMPT"]),
  },
  {
    title: "Safe to reapply",
    kinds: new Set(["UNCHANGED"]),
  },
  {
    title: "Upstream readiness",
    kinds: new Set(["UPSTREAM_NOT_READY"]),
  },
]);

const CANONICAL_HTTPS_SOURCE_PATTERN =
  /(https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~-]+)*)(?!:[\\/])/giu;

function redactNonUrlPaths(value) {
  return value
    .replace(/file:\/\/[^\s<>()\[\]{}]*/giu, "[redacted-file-url]")
    .replace(
      /(?<![A-Za-z0-9._~%+-])[A-Za-z]:[\\/][^\s<>()\[\]{}]*/gu,
      "[redacted-absolute-path]",
    )
    .replace(
      /\\\\[^\\/\s<>()\[\]{}]+[\\/][^\s<>()\[\]{}]*/gu,
      "[redacted-absolute-path]",
    )
    .replace(
      /\/\/[^/\s<>()\[\]{}]+\/[^\s<>()\[\]{}]*/gu,
      "[redacted-absolute-path]",
    )
    .replace(
      /(?<![A-Za-z0-9._~%+\/-])\/(?!\/)[^\s<>()\[\]{}]*/gu,
      "[redacted-absolute-path]",
    );
}

function redactAbsolutePaths(value) {
  return value
    .split(CANONICAL_HTTPS_SOURCE_PATTERN)
    .map((segment, index) => (index % 2 === 1 ? segment : redactNonUrlPaths(segment)))
    .join("");
}

function safeText(value) {
  return redactAbsolutePaths(value)
    .replace(/\r\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\n/gu, "\\n")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/[\[\]()|#!*_]/gu, (character) => MARKDOWN_ENTITY[character]);
}

function inlineCode(value) {
  const safe = safeText(value);
  const runs = safe.match(/`+/gu) ?? [];
  const longestRun = runs.reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const needsPadding = safe.startsWith("`") || safe.endsWith("`") || /^ .* $/u.test(safe);
  const body = needsPadding ? ` ${safe} ` : safe;
  return `${fence}${body}${fence}`;
}

function renderIdentityFields(finding) {
  const fields = [];
  if (finding.customizationId !== undefined) {
    fields.push(`customization ${inlineCode(finding.customizationId)}`);
  }
  if (finding.targetId !== undefined) {
    fields.push(`target ${inlineCode(finding.targetId)}`);
  }
  if (finding.candidateTargetIds !== undefined) {
    fields.push(
      `candidates ${finding.candidateTargetIds.map((candidate) => inlineCode(candidate)).join(", ")}`,
    );
  }
  if (finding.expectedDigest !== undefined) {
    fields.push(`expected ${inlineCode(finding.expectedDigest)}`);
  }
  if (finding.actualDigest !== undefined) {
    fields.push(`actual ${inlineCode(finding.actualDigest)}`);
  }
  return fields.join("; ");
}

function actionForFinding(finding) {
  switch (finding.kind) {
    case "UNCHANGED":
      return "Verified exact identity and digest";
    case "TARGET_CHANGED":
      return "Review the changed target before reapplying";
    case "POSSIBLE_RENAME":
      return "Confirm the possible rename before updating the frozen target";
    case "TARGET_MISSING":
      return "Restore or remap the missing target before any reapply";
    case "AMBIGUOUS_MATCH":
      return "Resolve the ambiguous identity before any reapply";
    case "NEW_UPSTREAM_PROMPT":
      return "Review whether the new upstream target needs a customization";
    case "UPSTREAM_NOT_READY":
      return "Acquire and verify a complete upstream inventory before comparing";
    default:
      throw new Error(`Unsupported finding kind: ${finding.kind}`);
  }
}

function renderFinding(finding, index) {
  const identity = renderIdentityFields(finding);
  const details = identity.length > 0 ? ` ${identity}.` : "";
  return `${index + 1}. **${finding.kind}** — ${actionForFinding(finding)}.${details} Message: ${inlineCode(finding.message)}`;
}

function renderSection(lines, title, findings) {
  lines.push(`## ${title}`, "");
  if (findings.length === 0) {
    lines.push("_None._", "");
    return;
  }

  findings.forEach((finding, index) => lines.push(renderFinding(finding, index)));
  lines.push("");
}

function statusExplanation(report) {
  switch (report.status) {
    case "SAFE_TO_REAPPLY":
      return "All classified targets are unchanged. This is a compatibility result, not permission to apply automatically.";
    case "REVIEW_REQUIRED":
      return "At least one non-blocking change requires human review before reapplication.";
    case "BLOCKED":
      return "At least one identity cannot be mapped safely; reapplication is blocked.";
    case "UPSTREAM_NOT_READY":
      return `The upstream inventory is not ready: ${inlineCode(report.upstream.readinessReason)}`;
    default:
      throw new Error(`Unsupported report status: ${report.status}`);
  }
}

export function renderIssueMarkdown(input) {
  const report = cloneAndValidateIssueReport(input);
  const lines = [
    ISSUE_REPORT_MARKER,
    "",
    "# Claude Code Prompt Drift Report",
    "",
    `- Baseline → upstream: ${inlineCode(report.baseline.version)} → ${inlineCode(report.upstream.version ?? "not-ready")}`,
    `- Baseline source: ${inlineCode(report.baseline.source)}`,
    `- Upstream source: ${inlineCode(report.upstream.source)}`,
    `- Baseline inventory digest: ${inlineCode(report.baseline.inventoryDigest)}`,
    `- Upstream inventory digest: ${inlineCode(report.upstream.inventoryDigest ?? "not-ready")}`,
    `- Compatibility status: **${report.status}**`,
    `- Frozen targets: ${report.summary.frozenTargets}`,
    `- Upstream targets: ${report.summary.upstreamTargets}`,
    `- Generated at: ${inlineCode(report.generatedAt)}`,
    `- Report ID: ${inlineCode(report.reportId)}`,
    `- Contract version: ${inlineCode(report.contractVersion)}`,
    "",
    statusExplanation(report),
    "",
    "## Finding counts",
    "",
  ];

  for (const [kind, count] of Object.entries(report.summary.findingCounts)) {
    lines.push(`- ${kind}: ${count}`);
  }
  lines.push("");

  for (const rule of SECTION_RULES) {
    renderSection(
      lines,
      rule.title,
      report.findings.filter((finding) => rule.kinds.has(finding.kind)),
    );
  }

  lines.push(
    "## Safety statement",
    "",
    "No automatic apply or remote mutation was performed.",
    "The renderer did not read prompt bodies or artifact files.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

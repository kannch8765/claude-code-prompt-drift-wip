import { cloneAndValidateIssueReport } from "./issue-report-contract.mjs";
import { inlineCode, renderFindingMarkdown } from "./markdown-safety.mjs";

export const ISSUE_REPORT_MARKER = "<!-- claude-code-prompt-drift:issue-report:v1 -->";

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

function renderSection(lines, title, findings) {
  lines.push(`## ${title}`, "");
  if (findings.length === 0) {
    lines.push("_None._", "");
    return;
  }

  findings.forEach((finding, index) => lines.push(renderFindingMarkdown(finding, index)));
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

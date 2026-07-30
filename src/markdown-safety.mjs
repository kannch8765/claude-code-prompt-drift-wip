const MARKDOWN_ENTITY = Object.freeze({
  "[": "&#91;",
  "]": "&#93;",
  "(": "&#40;",
  ")": "&#41;",
  "|": "&#124;",
  "#": "&#35;",
  "!": "&#33;",
  "*": "&#42;",
  _: "&#95;",
});

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

export function safeText(value) {
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

export function inlineCode(value) {
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

export function renderFindingMarkdown(finding, index) {
  const identity = renderIdentityFields(finding);
  const details = identity.length > 0 ? ` ${identity}.` : "";
  return `${index + 1}. **${finding.kind}** — ${actionForFinding(finding)}.${details} Message: ${inlineCode(finding.message)}`;
}

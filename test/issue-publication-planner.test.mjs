import assert from "node:assert/strict";
import test from "node:test";

import { buildIssueReport } from "../src/build-issue-report.mjs";
import { FINDING_KINDS } from "../src/contracts.mjs";
import {
  ISSUE_IDENTITY_MARKER,
  IssuePublicationError,
  planIssuePublication,
} from "../src/plan-issue-publication.mjs";
import {
  ISSUE_REPORT_MARKER,
  renderIssueMarkdown,
} from "../src/render-issue-markdown.mjs";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function findingCounts(kind) {
  return Object.fromEntries(
    FINDING_KINDS.map((candidate) => [candidate, candidate === kind ? 1 : 0]),
  );
}

function classificationFor(status) {
  if (status === "SAFE_TO_REAPPLY") {
    return {
      status,
      findings: [
        {
          kind: "UNCHANGED",
          status,
          message: "Exact target identity and digest are unchanged.",
          customizationId: "fictional.task004.customization",
          targetId: "fictional.task004.target",
          expectedDigest: DIGEST_A,
          actualDigest: DIGEST_A,
        },
      ],
      summary: {
        frozenTargets: 1,
        upstreamTargets: 1,
        findingCounts: findingCounts("UNCHANGED"),
      },
    };
  }

  if (status === "REVIEW_REQUIRED") {
    return {
      status,
      findings: [
        {
          kind: "TARGET_CHANGED",
          status,
          message: "Exact target identity exists, but its digest changed.",
          customizationId: "fictional.task004.customization",
          targetId: "fictional.task004.target",
          expectedDigest: DIGEST_A,
          actualDigest: DIGEST_B,
        },
      ],
      summary: {
        frozenTargets: 1,
        upstreamTargets: 1,
        findingCounts: findingCounts("TARGET_CHANGED"),
      },
    };
  }

  if (status === "BLOCKED") {
    return {
      status,
      findings: [
        {
          kind: "TARGET_MISSING",
          status,
          message: "No deterministic target identity is available.",
          customizationId: "fictional.task004.customization",
          targetId: "fictional.task004.target",
          expectedDigest: DIGEST_A,
        },
      ],
      summary: {
        frozenTargets: 1,
        upstreamTargets: 0,
        findingCounts: findingCounts("TARGET_MISSING"),
      },
    };
  }

  return {
    status: "UPSTREAM_NOT_READY",
    findings: [
      {
        kind: "UPSTREAM_NOT_READY",
        status: "UPSTREAM_NOT_READY",
        message: "The fictional upstream inventory is incomplete.",
      },
    ],
    summary: {
      frozenTargets: 1,
      upstreamTargets: 0,
      findingCounts: findingCounts("UPSTREAM_NOT_READY"),
    },
  };
}

function makeReport(status = "REVIEW_REQUIRED") {
  const upstreamReady = status !== "UPSTREAM_NOT_READY";
  return buildIssueReport({
    classification: classificationFor(status),
    reportId: `fictional.task004.${status.toLowerCase()}`,
    generatedAt: "2026-07-29T10:00:00.000Z",
    contractVersion: "1",
    baseline: {
      source: "https://airship.example.invalid/baseline",
      version: "0.0.1-fictional",
      inventoryDigest: DIGEST_A,
    },
    upstream: upstreamReady
      ? {
          ready: true,
          source: "https://airship.example.invalid/upstream",
          version: "0.0.2-fictional",
          inventoryDigest: DIGEST_B,
        }
      : {
          ready: false,
          source: "https://airship.example.invalid/upstream",
          version: null,
          inventoryDigest: null,
          readinessReason: "Synthetic upstream snapshot is incomplete.",
        },
  });
}

function canonicalIssue(number, title, body, extra = {}) {
  return {
    number,
    state: "open",
    title,
    body,
    ...extra,
  };
}

function markerCount(value, marker) {
  return value.split(marker).length - 1;
}

test("planner creates a deterministic canonical payload when no identity exists", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const plan = planIssuePublication({ report, markdown, issues: [] });

  assert.deepEqual(plan, {
    action: "CREATE",
    issueNumber: null,
    title: "Claude Code Prompt Drift — REVIEW_REQUIRED",
    body: `${ISSUE_IDENTITY_MARKER}\n\n${markdown}`,
  });
  assert.equal(plan.body.split("\n", 1)[0], ISSUE_IDENTITY_MARKER);
  assert.equal(markerCount(plan.body, ISSUE_IDENTITY_MARKER), 1);
  assert.equal(markerCount(plan.body, ISSUE_REPORT_MARKER), 1);
});

test("planner updates one canonical Issue whose title or body differs", () => {
  const report = makeReport("BLOCKED");
  const markdown = renderIssueMarkdown(report);
  const plan = planIssuePublication({
    report,
    markdown,
    issues: [canonicalIssue(41, "old title", `${ISSUE_IDENTITY_MARKER}\n\nold body\n`)],
  });

  assert.equal(plan.action, "UPDATE");
  assert.equal(plan.issueNumber, 41);
  assert.equal(plan.title, "Claude Code Prompt Drift — BLOCKED");
  assert.equal(plan.body, `${ISSUE_IDENTITY_MARKER}\n\n${markdown}`);
});

test("planner returns NOOP for byte-identical title and body", () => {
  const report = makeReport("SAFE_TO_REAPPLY");
  const markdown = renderIssueMarkdown(report);
  const createPlan = planIssuePublication({ report, markdown, issues: [] });
  const plan = planIssuePublication({
    report,
    markdown,
    issues: [canonicalIssue(7, createPlan.title, createPlan.body)],
  });

  assert.deepEqual(plan, {
    action: "NOOP",
    issueNumber: 7,
    title: createPlan.title,
    body: createPlan.body,
  });
});

test("two canonical identities fail closed", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const issues = [
    canonicalIssue(1, "one", `${ISSUE_IDENTITY_MARKER}\n\none\n`),
    canonicalIssue(2, "two", `${ISSUE_IDENTITY_MARKER}\n\ntwo\n`),
  ];

  assert.throws(
    () => planIssuePublication({ report, markdown, issues }),
    (error) => {
      assert.ok(error instanceof IssuePublicationError);
      assert.equal(error.code, "AMBIGUOUS_ISSUE_IDENTITY");
      assert.equal(error.path, "issues");
      return true;
    },
  );
});

test("a canonical-prefix Issue containing a repeated publisher marker fails closed", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const body = `${ISSUE_IDENTITY_MARKER}\n\ntext\n${ISSUE_IDENTITY_MARKER}\n`;

  assert.throws(
    () =>
      planIssuePublication({
        report,
        markdown,
        issues: [canonicalIssue(1, "duplicate", body)],
      }),
    (error) => {
      assert.equal(error.code, "DUPLICATE_ISSUE_MARKER");
      assert.equal(error.path, "issues[0].body");
      return true;
    },
  );
});

test("marker text outside the first line is not an identity candidate", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const plan = planIssuePublication({
    report,
    markdown,
    issues: [canonicalIssue(1, "ordinary", `ordinary text\n${ISSUE_IDENTITY_MARKER}\n`)],
  });

  assert.equal(plan.action, "CREATE");
});

test("pull requests and closed Issues are ignored for identity", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const body = `${ISSUE_IDENTITY_MARKER}\n\nforeign body\n`;
  const issues = [
    canonicalIssue(1, "pull request", body, { pull_request: {} }),
    { ...canonicalIssue(2, "closed", body), state: "closed" },
  ];

  assert.equal(planIssuePublication({ report, markdown, issues }).action, "CREATE");
});

test("malformed Issue records fail with stable code and path", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);

  assert.throws(
    () =>
      planIssuePublication({
        report,
        markdown,
        issues: [{ number: 0, state: "open", title: "bad", body: "" }],
      }),
    (error) => {
      assert.equal(error.code, "INVALID_VALUE");
      assert.equal(error.path, "issues[0].number");
      return true;
    },
  );
});

test("all compatibility statuses produce stable publisher-owned titles", () => {
  const expected = [
    "SAFE_TO_REAPPLY",
    "REVIEW_REQUIRED",
    "BLOCKED",
    "UPSTREAM_NOT_READY",
  ];

  for (const status of expected) {
    const report = makeReport(status);
    const markdown = renderIssueMarkdown(report);
    const first = planIssuePublication({ report, markdown, issues: [] });
    const second = planIssuePublication({ report, markdown, issues: [] });

    assert.equal(first.title, `Claude Code Prompt Drift — ${status}`);
    assert.deepEqual(second, first);
  }
});

test("planner does not modify caller report, markdown, or Issue records", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const issues = [canonicalIssue(8, "ordinary", "ordinary body")];
  const beforeReport = structuredClone(report);
  const beforeIssues = structuredClone(issues);

  planIssuePublication({ report, markdown, issues });

  assert.deepEqual(report, beforeReport);
  assert.deepEqual(issues, beforeIssues);
  assert.equal(markdown, renderIssueMarkdown(report));
});

test("invalid reports and Markdown mismatches fail without leaking supplied content", () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const privateValue = "PRIVATE_TASK004_CONTENT_DO_NOT_ECHO";
  const invalidReport = { ...report, privateValue };

  assert.throws(
    () => planIssuePublication({ report: invalidReport, markdown, issues: [] }),
    (error) => {
      assert.equal(error.code, "INVALID_REPORT");
      assert.equal(error.path, "report");
      assert.equal(error.message.includes(privateValue), false);
      assert.equal(error.message.includes(JSON.stringify(report)), false);
      return true;
    },
  );

  assert.throws(
    () => planIssuePublication({ report, markdown: privateValue, issues: [] }),
    (error) => {
      assert.equal(error.code, "MARKDOWN_MISMATCH");
      assert.equal(error.path, "markdown");
      assert.equal(error.message.includes(privateValue), false);
      assert.equal(error.message.includes(markdown), false);
      return true;
    },
  );
});

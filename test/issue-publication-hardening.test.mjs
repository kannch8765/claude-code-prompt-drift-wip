import assert from "node:assert/strict";
import test from "node:test";

import { buildIssueReport } from "../src/build-issue-report.mjs";
import { FINDING_KINDS } from "../src/contracts.mjs";
import {
  ISSUE_BODY_MAX_CHARACTERS,
  ISSUE_IDENTITY_MARKER,
  IssuePublicationError,
  planIssuePublication,
} from "../src/plan-issue-publication.mjs";
import { publishGitHubIssue } from "../src/publish-github-issue.mjs";
import { renderIssueMarkdown } from "../src/render-issue-markdown.mjs";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const SECRET = "PRIVATE_ACCESSOR_SECRET_DO_NOT_ECHO";

function findingCounts(kind, count = 1) {
  return Object.fromEntries(
    FINDING_KINDS.map((candidate) => [candidate, candidate === kind ? count : 0]),
  );
}

function makeReport() {
  return buildIssueReport({
    classification: {
      status: "REVIEW_REQUIRED",
      findings: [
        {
          kind: "TARGET_CHANGED",
          status: "REVIEW_REQUIRED",
          message: "Exact target identity exists, but its digest changed.",
          customizationId: "fictional.task004.accessor.customization",
          targetId: "fictional.task004.accessor.target",
          expectedDigest: DIGEST_A,
          actualDigest: DIGEST_B,
        },
      ],
      summary: {
        frozenTargets: 1,
        upstreamTargets: 1,
        findingCounts: findingCounts("TARGET_CHANGED"),
      },
    },
    reportId: "fictional.task004.accessor",
    generatedAt: "2026-07-29T12:00:00.000Z",
    contractVersion: "1",
    baseline: {
      source: "https://airship.example.invalid/baseline",
      version: "0.0.1-fictional",
      inventoryDigest: DIGEST_A,
    },
    upstream: {
      ready: true,
      source: "https://airship.example.invalid/upstream",
      version: "0.0.2-fictional",
      inventoryDigest: DIGEST_B,
    },
  });
}

function makeOversizedReport() {
  const count = 610;
  const findings = Array.from({ length: count }, (_, index) => ({
    kind: "UNCHANGED",
    status: "SAFE_TO_REAPPLY",
    message: "Exact target identity and digest are unchanged.",
    customizationId: `fictional.task004.bulk.customization-${index}`,
    targetId: `fictional.task004.bulk.target-${index}`,
    expectedDigest: DIGEST_A,
    actualDigest: DIGEST_A,
  }));

  return buildIssueReport({
    classification: {
      status: "SAFE_TO_REAPPLY",
      findings,
      summary: {
        frozenTargets: count,
        upstreamTargets: count,
        findingCounts: findingCounts("UNCHANGED", count),
      },
    },
    reportId: "fictional.task004.oversized",
    generatedAt: "2026-07-29T12:00:00.000Z",
    contractVersion: "1",
    baseline: {
      source: "https://airship.example.invalid/baseline",
      version: "0.0.1-fictional",
      inventoryDigest: DIGEST_A,
    },
    upstream: {
      ready: true,
      source: "https://airship.example.invalid/upstream",
      version: "0.0.2-fictional",
      inventoryDigest: DIGEST_A,
    },
  });
}

function makeClient({ page = [], createResponse = { number: 41 }, updateResponse } = {}) {
  const calls = [];
  const client = {
    async listIssuesPage(input) {
      calls.push({ method: "listIssuesPage", input: structuredClone(input) });
      return page;
    },
    async createIssue(input) {
      calls.push({ method: "createIssue", input: structuredClone(input) });
      return createResponse;
    },
    async updateIssue(input) {
      calls.push({ method: "updateIssue", input: structuredClone(input) });
      return updateResponse ?? { number: input.issueNumber };
    },
  };
  return { client, calls };
}

function callNames(calls) {
  return calls.map(({ method }) => method);
}

function throwingNumberResponse() {
  let getterReads = 0;
  const response = {};
  Object.defineProperty(response, "number", {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error(SECRET);
    },
  });
  return { response, getterReads: () => getterReads };
}

test("a valid 610-finding report fails the shared body limit before Issue lookup", async () => {
  const report = makeOversizedReport();
  const markdown = renderIssueMarkdown(report);
  const { client, calls } = makeClient();

  assert.ok(markdown.length < Number.MAX_SAFE_INTEGER);
  assert.ok(`${ISSUE_IDENTITY_MARKER}\n\n${markdown}`.length > ISSUE_BODY_MAX_CHARACTERS);
  assert.throws(
    () => planIssuePublication({ report, markdown, issues: [] }),
    (error) => {
      assert.ok(error instanceof IssuePublicationError);
      assert.equal(error.code, "PUBLICATION_BODY_TOO_LARGE");
      assert.equal(error.path, "body");
      assert.equal(error.message.includes(markdown), false);
      return true;
    },
  );

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => error.code === "PUBLICATION_BODY_TOO_LARGE" && error.path === "body",
  );
  assert.deepEqual(calls, []);
});

test("an accessor-backed client method is rejected without invoking its getter", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  let getterReads = 0;
  const client = {
    get listIssuesPage() {
      getterReads += 1;
      throw new Error(SECRET);
    },
    async createIssue() {},
    async updateIssue() {},
  };

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => {
      assert.equal(error.code, "INVALID_CLIENT");
      assert.equal(error.path, "client.listIssuesPage");
      assert.equal(error.message.includes(SECRET), false);
      return true;
    },
  );
  assert.equal(getterReads, 0);
});

test("an accessor-backed paginated Issue fails before mutation without secret leakage", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  let getterReads = 0;
  const issue = {
    number: 1,
    state: "open",
    title: "accessor Issue",
  };
  Object.defineProperty(issue, "body", {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error(SECRET);
    },
  });
  const { client, calls } = makeClient({ page: [issue] });

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => {
      assert.equal(error.code, "ACCESSOR_PROPERTY_NOT_ALLOWED");
      assert.equal(error.path, "issues[0].body");
      assert.equal(error.message.includes(SECRET), false);
      return true;
    },
  );
  assert.equal(getterReads, 0);
  assert.deepEqual(callNames(calls), ["listIssuesPage"]);
});

test("an accessor-backed create response is sanitized after one possible remote write", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const { response, getterReads } = throwingNumberResponse();
  const { client, calls } = makeClient({ createResponse: response });

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => {
      assert.equal(error.code, "INVALID_MUTATION_RESPONSE");
      assert.equal(error.path, "client.createIssue.result.number");
      assert.equal(error.message.includes(SECRET), false);
      assert.match(error.message, /remote mutation may already have completed/u);
      return true;
    },
  );
  assert.equal(getterReads(), 0);
  assert.deepEqual(callNames(calls), ["listIssuesPage", "createIssue"]);
});

test("an accessor-backed update response is sanitized after one possible remote write", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const issue = {
    number: 7,
    state: "open",
    title: "old title",
    body: `${ISSUE_IDENTITY_MARKER}\n\nold body\n`,
  };
  const { response, getterReads } = throwingNumberResponse();
  const { client, calls } = makeClient({
    page: [issue],
    updateResponse: response,
  });

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => {
      assert.equal(error.code, "INVALID_MUTATION_RESPONSE");
      assert.equal(error.path, "client.updateIssue.result.number");
      assert.equal(error.message.includes(SECRET), false);
      assert.match(error.message, /remote mutation may already have completed/u);
      return true;
    },
  );
  assert.equal(getterReads(), 0);
  assert.deepEqual(callNames(calls), ["listIssuesPage", "updateIssue"]);
});

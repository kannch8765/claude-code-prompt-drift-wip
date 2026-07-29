import assert from "node:assert/strict";
import test from "node:test";

import { buildIssueReport } from "../src/build-issue-report.mjs";
import { FINDING_KINDS } from "../src/contracts.mjs";
import {
  ISSUE_IDENTITY_MARKER,
  IssuePublicationError,
  planIssuePublication,
} from "../src/plan-issue-publication.mjs";
import { publishGitHubIssue } from "../src/publish-github-issue.mjs";
import { renderIssueMarkdown } from "../src/render-issue-markdown.mjs";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function findingCounts(kind) {
  return Object.fromEntries(
    FINDING_KINDS.map((candidate) => [candidate, candidate === kind ? 1 : 0]),
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
    },
    reportId: "fictional.task004.publisher",
    generatedAt: "2026-07-29T10:00:00.000Z",
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

function ordinaryIssue(number) {
  return {
    number,
    state: "open",
    title: `ordinary ${number}`,
    body: "ordinary body",
  };
}

function makeClient({
  pageFor = () => [],
  createResponse = { number: 101 },
  updateResponse = null,
  createError = null,
  updateError = null,
} = {}) {
  const calls = [];
  const responses = [];
  const client = {
    async listIssuesPage(input) {
      calls.push({ method: "listIssuesPage", input: structuredClone(input) });
      const response = pageFor(input.page);
      responses.push(response);
      return response;
    },
    async createIssue(input) {
      calls.push({ method: "createIssue", input: structuredClone(input) });
      if (createError !== null) {
        throw createError;
      }
      return createResponse;
    },
    async updateIssue(input) {
      calls.push({ method: "updateIssue", input: structuredClone(input) });
      if (updateError !== null) {
        throw updateError;
      }
      return updateResponse ?? { number: input.issueNumber };
    },
  };
  return { client, calls, responses };
}

function callNames(calls) {
  return calls.map(({ method }) => method);
}

test("publisher creates once after complete listing with exact payload and call order", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const expected = planIssuePublication({ report, markdown, issues: [] });
  const { client, calls } = makeClient({ createResponse: { number: 301 } });

  const result = await publishGitHubIssue({
    repository: "kannch8765/claude-code-prompt-drift-wip",
    report,
    markdown,
    client,
  });

  assert.deepEqual(result, {
    action: "CREATED",
    issueNumber: 301,
    mutationPerformed: true,
  });
  assert.deepEqual(callNames(calls), ["listIssuesPage", "createIssue"]);
  assert.deepEqual(calls[0].input, {
    owner: "kannch8765",
    repo: "claude-code-prompt-drift-wip",
    state: "open",
    page: 1,
    perPage: 100,
  });
  assert.deepEqual(calls[1].input, {
    owner: "kannch8765",
    repo: "claude-code-prompt-drift-wip",
    title: expected.title,
    body: expected.body,
  });
});

test("publisher updates exactly the canonical Issue number once", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const oldIssue = {
    number: 44,
    state: "open",
    title: "old title",
    body: `${ISSUE_IDENTITY_MARKER}\n\nold body\n`,
  };
  const expected = planIssuePublication({ report, markdown, issues: [oldIssue] });
  const { client, calls } = makeClient({ pageFor: () => [oldIssue] });

  const result = await publishGitHubIssue({
    repository: "owner/repository",
    report,
    markdown,
    client,
  });

  assert.deepEqual(result, {
    action: "UPDATED",
    issueNumber: 44,
    mutationPerformed: true,
  });
  assert.deepEqual(callNames(calls), ["listIssuesPage", "updateIssue"]);
  assert.deepEqual(calls[1].input, {
    owner: "owner",
    repo: "repository",
    issueNumber: 44,
    title: expected.title,
    body: expected.body,
  });
});

test("publisher performs zero mutations for a byte-identical canonical Issue", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const plan = planIssuePublication({ report, markdown, issues: [] });
  const issue = {
    number: 9,
    state: "open",
    title: plan.title,
    body: plan.body,
  };
  const { client, calls } = makeClient({ pageFor: () => [issue] });

  const result = await publishGitHubIssue({
    repository: "owner/repository",
    report,
    markdown,
    client,
  });

  assert.deepEqual(result, {
    action: "NOOP",
    issueNumber: 9,
    mutationPerformed: false,
  });
  assert.deepEqual(callNames(calls), ["listIssuesPage"]);
});

test("canonical identities split across pages fail before mutation", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const canonical = (number) => ({
    number,
    state: "open",
    title: `candidate ${number}`,
    body: `${ISSUE_IDENTITY_MARKER}\n\nold ${number}\n`,
  });
  const firstPage = [canonical(1), ...Array.from({ length: 99 }, (_, index) => ordinaryIssue(index + 2))];
  const secondPage = [canonical(201)];
  const { client, calls } = makeClient({
    pageFor: (page) => (page === 1 ? firstPage : secondPage),
  });

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => {
      assert.equal(error.code, "AMBIGUOUS_ISSUE_IDENTITY");
      assert.equal(error.path, "issues");
      return true;
    },
  );
  assert.deepEqual(callNames(calls), ["listIssuesPage", "listIssuesPage"]);
});

test("a duplicate marker in a canonical Issue fails before mutation", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const issue = {
    number: 1,
    state: "open",
    title: "duplicate",
    body: `${ISSUE_IDENTITY_MARKER}\n\n${ISSUE_IDENTITY_MARKER}\n`,
  };
  const { client, calls } = makeClient({ pageFor: () => [issue] });

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => error.code === "DUPLICATE_ISSUE_MARKER",
  );
  assert.deepEqual(callNames(calls), ["listIssuesPage"]);
});

test("malformed Issue records and page responses fail before mutation", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const malformedRecord = { number: 1, state: "open", title: "missing body" };
  const recordClient = makeClient({ pageFor: () => [malformedRecord] });

  await assert.rejects(
    publishGitHubIssue({
      repository: "owner/repository",
      report,
      markdown,
      client: recordClient.client,
    }),
    (error) => {
      assert.equal(error.code, "MISSING_FIELD");
      assert.equal(error.path, "issues[0].body");
      return true;
    },
  );
  assert.deepEqual(callNames(recordClient.calls), ["listIssuesPage"]);

  const pageClient = makeClient({ pageFor: () => ({ records: [] }) });
  await assert.rejects(
    publishGitHubIssue({
      repository: "owner/repository",
      report,
      markdown,
      client: pageClient.client,
    }),
    (error) => {
      assert.equal(error.code, "INVALID_PAGE_RESPONSE");
      assert.equal(error.path, "pages[1]");
      return true;
    },
  );
  assert.deepEqual(callNames(pageClient.calls), ["listIssuesPage"]);
});

test("pagination limit fails closed after the deterministic maximum", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const { client, calls } = makeClient({
    pageFor: (page) =>
      Array.from({ length: 100 }, (_, index) => ordinaryIssue((page - 1) * 100 + index + 1)),
  });

  await assert.rejects(
    publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
    (error) => {
      assert.equal(error.code, "PAGINATION_LIMIT_EXCEEDED");
      assert.equal(error.path, "client.listIssuesPage");
      return true;
    },
  );
  assert.equal(calls.length, 100);
  assert.ok(calls.every(({ method }) => method === "listIssuesPage"));
});

test("invalid report and Markdown mismatch fail before list or mutation", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const { client, calls } = makeClient();

  await assert.rejects(
    publishGitHubIssue({
      repository: "owner/repository",
      report: { ...report, extra: "private" },
      markdown,
      client,
    }),
    (error) => error.code === "INVALID_REPORT",
  );
  await assert.rejects(
    publishGitHubIssue({
      repository: "owner/repository",
      report,
      markdown: `${markdown}changed`,
      client,
    }),
    (error) => error.code === "MARKDOWN_MISMATCH",
  );
  assert.deepEqual(calls, []);
});

test("repository URLs, traversal, backslashes, query, fragment, and encoding are rejected", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const invalid = [
    "https://github.com/owner/repository",
    "owner/../repository",
    "owner/.",
    "owner\\repository",
    "owner/repository?x=1",
    "owner/repository#fragment",
    "owner/%2e%2e",
    "owner/%2Frepository",
    "/repository",
    "owner/",
  ];

  for (const repository of invalid) {
    const { client, calls } = makeClient();
    await assert.rejects(
      publishGitHubIssue({ repository, report, markdown, client }),
      (error) => {
        assert.ok(error instanceof IssuePublicationError);
        assert.equal(error.code, "INVALID_REPOSITORY");
        assert.equal(error.path, "repository");
        return true;
      },
    );
    assert.deepEqual(calls, []);
  }
});

test("non-plain clients and missing methods fail before listing", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);

  for (const client of [[], new (class Client {})(), { listIssuesPage() {} }]) {
    await assert.rejects(
      publishGitHubIssue({ repository: "owner/repository", report, markdown, client }),
      (error) => error.code === "INVALID_TYPE" || error.code === "INVALID_CLIENT",
    );
  }
});

test("create and update failures or malformed responses use stable sanitized errors", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const secret = "TOKEN_PRIVATE_TASK004";
  const createFailure = makeClient({ createError: new Error(secret) });

  await assert.rejects(
    publishGitHubIssue({
      repository: "owner/repository",
      report,
      markdown,
      client: createFailure.client,
    }),
    (error) => {
      assert.equal(error.code, "CREATE_ISSUE_FAILED");
      assert.equal(error.path, "client.createIssue");
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes(markdown), false);
      return true;
    },
  );
  assert.deepEqual(callNames(createFailure.calls), ["listIssuesPage", "createIssue"]);

  const invalidCreate = makeClient({ createResponse: { number: 0, secret } });
  await assert.rejects(
    publishGitHubIssue({
      repository: "owner/repository",
      report,
      markdown,
      client: invalidCreate.client,
    }),
    (error) => {
      assert.equal(error.code, "INVALID_MUTATION_RESPONSE");
      assert.equal(error.path, "client.createIssue.result.number");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );

  const issue = {
    number: 17,
    state: "open",
    title: "old",
    body: `${ISSUE_IDENTITY_MARKER}\n\nold\n`,
  };
  const updateFailure = makeClient({
    pageFor: () => [issue],
    updateError: new Error(secret),
  });
  await assert.rejects(
    publishGitHubIssue({
      repository: "owner/repository",
      report,
      markdown,
      client: updateFailure.client,
    }),
    (error) => {
      assert.equal(error.code, "UPDATE_ISSUE_FAILED");
      assert.equal(error.path, "client.updateIssue");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.deepEqual(callNames(updateFailure.calls), ["listIssuesPage", "updateIssue"]);
});

test("caller inputs and client responses remain unchanged", async () => {
  const report = makeReport();
  const markdown = renderIssueMarkdown(report);
  const page = Object.freeze([Object.freeze(ordinaryIssue(1))]);
  const createResponse = Object.freeze({ number: 88 });
  const beforeReport = structuredClone(report);
  const beforePage = structuredClone(page);
  const { client } = makeClient({ pageFor: () => page, createResponse });

  const result = await publishGitHubIssue({
    repository: "owner/repository",
    report,
    markdown,
    client,
  });

  assert.equal(result.action, "CREATED");
  assert.deepEqual(report, beforeReport);
  assert.deepEqual(page, beforePage);
  assert.deepEqual(createResponse, { number: 88 });
  assert.equal(report.mutationsPerformed, false);
});

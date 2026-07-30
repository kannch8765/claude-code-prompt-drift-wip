import assert from "node:assert/strict";
import test from "node:test";

import { ISSUE_IDENTITY_MARKER, planIssuePublication } from "../src/plan-issue-publication.mjs";
import { publishGitHubIssue } from "../src/publish-github-issue.mjs";
import {
  ISSUE_REPORT_MARKER,
  renderIssueMarkdown,
} from "../src/render-issue-markdown.mjs";
import {
  DIGEST_A,
  DIGEST_B,
  callCounter,
  callNames,
  clone,
  finding,
  makeArtifact,
  makeReport,
  root,
  sha256,
  validateManifestValue,
} from "./task-005-test-helpers.mjs";

test("artifact publisher performs CREATE, UPDATE, and NOOP with at most one mutation", async () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const createPlan = planIssuePublication({ report, markdown, artifact, issues: [] });

  const createCalls = callCounter();
  const created = await publishGitHubIssue({
    repository: artifact.repository,
    report,
    markdown,
    artifact,
    client: createCalls.client,
  });
  assert.deepEqual(created, { action: "CREATED", issueNumber: 80, mutationPerformed: true });
  assert.deepEqual(callNames(createCalls.calls), ["listIssuesPage", "createIssue"]);

  const updateCalls = callCounter([[
    { number: 9, state: "open", title: createPlan.title, body: `${ISSUE_IDENTITY_MARKER}\n\nold` },
  ]]);
  const updated = await publishGitHubIssue({
    repository: artifact.repository,
    report,
    markdown,
    artifact,
    client: updateCalls.client,
  });
  assert.equal(updated.action, "UPDATED");
  assert.deepEqual(callNames(updateCalls.calls), ["listIssuesPage", "updateIssue"]);

  const noopCalls = callCounter([[
    { number: 9, state: "open", title: createPlan.title, body: createPlan.body },
  ]]);
  const noop = await publishGitHubIssue({
    repository: artifact.repository,
    report,
    markdown,
    artifact,
    client: noopCalls.client,
  });
  assert.deepEqual(noop, { action: "NOOP", issueNumber: 9, mutationPerformed: false });
  assert.deepEqual(callNames(noopCalls.calls), ["listIssuesPage"]);
});

test("invalid artifact and repository mismatch make zero client calls", async () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);

  for (const [repository, candidate, code] of [
    [artifact.repository, { ...artifact, artifactId: 0 }, "INVALID_ARTIFACT_ID"],
    ["fictional-owner/other-reports", artifact, "ARTIFACT_REPOSITORY_MISMATCH"],
  ]) {
    const calls = callCounter();
    await assert.rejects(
      publishGitHubIssue({ repository, report, markdown, artifact: candidate, client: calls.client }),
      (error) => {
        assert.equal(error.code, code);
        return true;
      },
    );
    assert.deepEqual(callNames(calls.calls), []);
  }
});

test("artifact publisher keeps complete pagination and one-mutation identity behavior", async () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const plan = planIssuePublication({ report, markdown, artifact, issues: [] });
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    number: index + 1,
    state: "closed",
    title: "Fictional closed Issue",
    body: "ordinary body",
  }));
  const calls = callCounter([
    firstPage,
    [{ number: 200, state: "open", title: plan.title, body: `${ISSUE_IDENTITY_MARKER}\n\nold` }],
  ]);

  const result = await publishGitHubIssue({
    repository: artifact.repository,
    report,
    markdown,
    artifact,
    client: calls.client,
  });
  assert.equal(result.action, "UPDATED");
  assert.deepEqual(callNames(calls.calls), ["listIssuesPage", "listIssuesPage", "updateIssue"]);
});

test("legacy oversized publisher fails before client validation", async () => {
  const report = makeReport(
    Array.from({ length: 610 }, (_, index) => finding("UNCHANGED", index)),
  );
  const markdown = renderIssueMarkdown(report);
  const calls = [];
  await assert.rejects(
    publishGitHubIssue({
      repository: "fictional-owner/airship-reports",
      report,
      markdown,
      client: {
        get listIssuesPage() {
          calls.push("getter");
          return async () => [];
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "PUBLICATION_BODY_TOO_LARGE");
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

test("renderer refactor preserves the established Task 003 bytes", () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  assert.equal(
    markdown,
    `${ISSUE_REPORT_MARKER}\n\n# Claude Code Prompt Drift Report\n\n- Baseline → upstream: \`0.0.1-fictional\` → \`0.0.2-fictional\`\n- Baseline source: \`https://airship.example.invalid/baselines\`\n- Upstream source: \`https://airship.example.invalid/prompts\`\n- Baseline inventory digest: \`${DIGEST_A}\`\n- Upstream inventory digest: \`${DIGEST_B}\`\n- Compatibility status: **SAFE_TO_REAPPLY**\n- Frozen targets: 1\n- Upstream targets: 1\n- Generated at: \`2026-07-30T00:00:00.000Z\`\n- Report ID: \`fictional.airship-run-0005\`\n- Contract version: \`1\`\n\nAll classified targets are unchanged. This is a compatibility result, not permission to apply automatically.\n\n## Finding counts\n\n- UNCHANGED: 1\n- TARGET_CHANGED: 0\n- TARGET_MISSING: 0\n- POSSIBLE_RENAME: 0\n- AMBIGUOUS_MATCH: 0\n- NEW_UPSTREAM_PROMPT: 0\n- UPSTREAM_NOT_READY: 0\n\n## Blocked\n\n_None._\n\n## Review required\n\n_None._\n\n## New upstream prompts\n\n_None._\n\n## Safe to reapply\n\n1. **UNCHANGED** — Verified exact identity and digest. customization \`fictional.customization-0001\`; target \`fictional.target-0001\`; expected \`${DIGEST_A}\`; actual \`${DIGEST_A}\`. Message: \`Fictional airship finding 0001.\`\n\n## Upstream readiness\n\n_None._\n\n## Safety statement\n\nNo automatic apply or remote mutation was performed.\nThe renderer did not read prompt bodies or artifact files.\n\n`,
  );
});

test("hostile artifact inspection is sanitized before every client method", async () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const base = makeArtifact(report, markdown);
  const artifact = {
    ...base,
    reportJson: new Proxy({}, {
      getPrototypeOf() {
        throw new Error("secret-canary /home/private/prompt.md");
      },
    }),
  };
  const calls = callCounter();

  await assert.rejects(
    publishGitHubIssue({ repository: base.repository, report, markdown, artifact, client: calls.client }),
    (error) => {
      assert.equal(error.code, "UNSAFE_PROPERTY_ACCESS");
      assert.equal(error.message.includes("secret-canary"), false);
      assert.equal(error.message.includes("/home/private/prompt.md"), false);
      return true;
    },
  );
  assert.deepEqual(callNames(calls.calls), []);
});

test("artifact publisher preserves create and update response hardening", async () => {
  const report = makeReport([finding("UNCHANGED", 1)]);
  const markdown = renderIssueMarkdown(report);
  const artifact = makeArtifact(report, markdown);
  const plan = planIssuePublication({ report, markdown, artifact, issues: [] });

  const createCalls = [];
  await assert.rejects(
    publishGitHubIssue({
      repository: artifact.repository,
      report,
      markdown,
      artifact,
      client: {
        async listIssuesPage(request) {
          createCalls.push(["listIssuesPage", request]);
          return [];
        },
        async createIssue(request) {
          createCalls.push(["createIssue", request]);
          return new Proxy({}, {
            getOwnPropertyDescriptors() {
              throw new Error("secret-canary");
            },
          });
        },
        async updateIssue() {
          throw new Error("must not update");
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "INVALID_MUTATION_RESPONSE");
      assert.equal(error.message.includes("secret-canary"), false);
      return true;
    },
  );
  assert.deepEqual(callNames(createCalls), ["listIssuesPage", "createIssue"]);

  const updateCalls = [];
  await assert.rejects(
    publishGitHubIssue({
      repository: artifact.repository,
      report,
      markdown,
      artifact,
      client: {
        async listIssuesPage(request) {
          updateCalls.push(["listIssuesPage", request]);
          return [{ number: 44, state: "open", title: plan.title, body: `${ISSUE_IDENTITY_MARKER}\n\nold` }];
        },
        async createIssue() {
          throw new Error("must not create");
        },
        async updateIssue(request) {
          updateCalls.push(["updateIssue", request]);
          return { number: 45 };
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "INVALID_MUTATION_RESPONSE");
      return true;
    },
  );
  assert.deepEqual(callNames(updateCalls), ["listIssuesPage", "updateIssue"]);
});

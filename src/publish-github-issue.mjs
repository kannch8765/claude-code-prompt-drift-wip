import {
  IssuePublicationError,
  planIssuePublication,
} from "./plan-issue-publication.mjs";

const PER_PAGE = 100;
const MAX_ISSUE_PAGES = 100;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;

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

function requirePublisherInput(value) {
  requirePlainObject(value, "input");
  const expected = new Set(["repository", "report", "markdown", "client"]);

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

function parseRepository(value) {
  if (typeof value !== "string") {
    fail("INVALID_REPOSITORY", "repository", "expected owner/repository");
  }
  if (value.includes("%") || value.includes("\\") || value.includes("?") || value.includes("#")) {
    fail("INVALID_REPOSITORY", "repository", "expected owner/repository");
  }

  const segments = value.split("/");
  if (segments.length !== 2) {
    fail("INVALID_REPOSITORY", "repository", "expected owner/repository");
  }

  const [owner, repo] = segments;
  if (
    owner === "." ||
    owner === ".." ||
    repo === "." ||
    repo === ".." ||
    !OWNER_PATTERN.test(owner) ||
    !REPOSITORY_PATTERN.test(repo)
  ) {
    fail("INVALID_REPOSITORY", "repository", "expected owner/repository");
  }

  return { owner, repo };
}

function validateClient(client) {
  requirePlainObject(client, "client");
  for (const method of ["listIssuesPage", "createIssue", "updateIssue"]) {
    if (!hasOwn(client, method) || typeof client[method] !== "function") {
      fail("INVALID_CLIENT", `client.${method}`, "required client method is missing");
    }
  }
}

async function listAllOpenIssues({ owner, repo, client }) {
  const issues = [];

  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    let response;
    try {
      response = await client.listIssuesPage({
        owner,
        repo,
        state: "open",
        page,
        perPage: PER_PAGE,
      });
    } catch {
      fail("LIST_ISSUES_FAILED", "client.listIssuesPage", "GitHub Issue listing failed");
    }

    if (!Array.isArray(response) || response.length > PER_PAGE) {
      fail(
        "INVALID_PAGE_RESPONSE",
        `pages[${page}]`,
        `expected an array containing at most ${PER_PAGE} records`,
      );
    }

    issues.push(...response);
    if (response.length < PER_PAGE) {
      return issues;
    }
  }

  fail(
    "PAGINATION_LIMIT_EXCEEDED",
    "client.listIssuesPage",
    `listing exceeded the fixed ${MAX_ISSUE_PAGES}-page limit`,
  );
}

function validateMutationResponse(value, path, expectedIssueNumber = null) {
  requirePlainObject(value, path);
  if (!Number.isSafeInteger(value.number) || value.number <= 0) {
    fail("INVALID_MUTATION_RESPONSE", `${path}.number`, "expected a positive issue number");
  }
  if (expectedIssueNumber !== null && value.number !== expectedIssueNumber) {
    fail(
      "INVALID_MUTATION_RESPONSE",
      `${path}.number`,
      "updated Issue number did not match the requested target",
    );
  }
  return value.number;
}

export async function publishGitHubIssue(input) {
  requirePublisherInput(input);
  const { repository, report, markdown, client } = input;
  const { owner, repo } = parseRepository(repository);

  // Preflight the complete Task 003 content contract before any remote read.
  planIssuePublication({ report, markdown, issues: [] });
  validateClient(client);

  const issues = await listAllOpenIssues({ owner, repo, client });
  const plan = planIssuePublication({ report, markdown, issues });

  if (plan.action === "NOOP") {
    return {
      action: "NOOP",
      issueNumber: plan.issueNumber,
      mutationPerformed: false,
    };
  }

  if (plan.action === "CREATE") {
    let response;
    try {
      response = await client.createIssue({
        owner,
        repo,
        title: plan.title,
        body: plan.body,
      });
    } catch {
      fail("CREATE_ISSUE_FAILED", "client.createIssue", "GitHub Issue creation failed");
    }

    return {
      action: "CREATED",
      issueNumber: validateMutationResponse(response, "client.createIssue.result"),
      mutationPerformed: true,
    };
  }

  if (plan.action === "UPDATE") {
    let response;
    try {
      response = await client.updateIssue({
        owner,
        repo,
        issueNumber: plan.issueNumber,
        title: plan.title,
        body: plan.body,
      });
    } catch {
      fail("UPDATE_ISSUE_FAILED", "client.updateIssue", "GitHub Issue update failed");
    }

    return {
      action: "UPDATED",
      issueNumber: validateMutationResponse(
        response,
        "client.updateIssue.result",
        plan.issueNumber,
      ),
      mutationPerformed: true,
    };
  }

  fail("INVALID_PLAN", "plan.action", "unsupported publication action");
}

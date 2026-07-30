import {
  IssuePublicationError,
  planIssuePublication,
} from "./plan-issue-publication.mjs";
import {
  BoundedIssueSummaryError,
  prepareBoundedIssueSummary,
} from "./render-bounded-issue-summary.mjs";

const PER_PAGE = 100;
const MAX_ISSUE_PAGES = 100;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;

function fail(code, path, detail) {
  throw new IssuePublicationError(code, path, detail);
}

function inspectPlainObject(
  value,
  path,
  typeCode = "INVALID_TYPE",
  inspectionCode = "UNSAFE_PROPERTY_ACCESS",
) {
  let isArray = false;
  if (value !== null && typeof value === "object") {
    try {
      isArray = Array.isArray(value);
    } catch {
      fail(inspectionCode, path, "object properties could not be inspected safely");
    }
  }
  if (value === null || typeof value !== "object" || isArray) {
    fail(typeCode, path, "expected a plain object");
  }

  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail(inspectionCode, path, "object properties could not be inspected safely");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(typeCode, path, "expected a plain object");
  }

  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(inspectionCode, path, "object properties could not be inspected safely");
  }
}

function readStrictDataRecord(value, path, expectedKeys, requiredKeys = expectedKeys) {
  const descriptors = inspectPlainObject(value, path);
  const expected = new Set(expectedKeys);

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !expected.has(key)) {
      fail("UNKNOWN_FIELD", path, "field is not part of the public API");
    }
    if (!("value" in descriptors[key])) {
      fail(
        "ACCESSOR_PROPERTY_NOT_ALLOWED",
        `${path}.${String(key)}`,
        "accessor properties are not part of the public contract",
      );
    }
  }

  for (const key of requiredKeys) {
    if (descriptors[key] === undefined) {
      fail("MISSING_FIELD", `${path}.${key}`, "required field is missing");
    }
  }

  const clone = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor !== undefined) {
      clone[key] = descriptor.value;
    }
  }
  return { clone, descriptors };
}

function requirePublisherInput(value) {
  const { clone, descriptors } = readStrictDataRecord(
    value,
    "input",
    ["repository", "report", "markdown", "artifact", "client"],
    ["repository", "report", "markdown", "client"],
  );
  return {
    ...clone,
    hasArtifact: descriptors.artifact !== undefined,
  };
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
  const descriptors = inspectPlainObject(client, "client", "INVALID_CLIENT", "INVALID_CLIENT");
  const methods = {};

  for (const method of ["listIssuesPage", "createIssue", "updateIssue"]) {
    const descriptor = descriptors[method];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "function"
    ) {
      fail("INVALID_CLIENT", `client.${method}`, "required client method is missing");
    }
    methods[method] = descriptor.value;
  }

  return {
    receiver: client,
    ...methods,
  };
}

function clonePageResponse(value, page) {
  let isArray;
  try {
    isArray = Array.isArray(value);
  } catch {
    fail("INVALID_PAGE_RESPONSE", `pages[${page}]`, "page could not be inspected safely");
  }
  if (!isArray) {
    fail(
      "INVALID_PAGE_RESPONSE",
      `pages[${page}]`,
      `expected an array containing at most ${PER_PAGE} records`,
    );
  }

  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail("INVALID_PAGE_RESPONSE", `pages[${page}]`, "page could not be inspected safely");
  }

  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > PER_PAGE
  ) {
    fail(
      "INVALID_PAGE_RESPONSE",
      `pages[${page}]`,
      `expected an array containing at most ${PER_PAGE} records`,
    );
  }

  const clone = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) {
      clone.push(undefined);
      continue;
    }
    if (!("value" in descriptor)) {
      fail(
        "ACCESSOR_PROPERTY_NOT_ALLOWED",
        `pages[${page}][${index}]`,
        "accessor page entries are not part of the client contract",
      );
    }
    clone.push(descriptor.value);
  }
  return clone;
}

async function listAllOpenIssues({ owner, repo, client }) {
  const issues = [];

  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    let response;
    try {
      response = await Reflect.apply(client.listIssuesPage, client.receiver, [
        {
          owner,
          repo,
          state: "open",
          page,
          perPage: PER_PAGE,
        },
      ]);
    } catch {
      fail("LIST_ISSUES_FAILED", "client.listIssuesPage", "GitHub Issue listing failed");
    }

    const pageRecords = clonePageResponse(response, page);
    issues.push(...pageRecords);
    if (pageRecords.length < PER_PAGE) {
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
  const descriptors = inspectPlainObject(
    value,
    path,
    "INVALID_MUTATION_RESPONSE",
    "INVALID_MUTATION_RESPONSE",
  );
  const numberDescriptor = descriptors.number;
  if (
    numberDescriptor === undefined ||
    !("value" in numberDescriptor) ||
    !Number.isSafeInteger(numberDescriptor.value) ||
    numberDescriptor.value <= 0
  ) {
    fail(
      "INVALID_MUTATION_RESPONSE",
      `${path}.number`,
      "response did not provide a positive issue number; the remote mutation may already have completed",
    );
  }

  const issueNumber = numberDescriptor.value;
  if (expectedIssueNumber !== null && issueNumber !== expectedIssueNumber) {
    fail(
      "INVALID_MUTATION_RESPONSE",
      `${path}.number`,
      "updated Issue number did not match the requested target; the remote mutation may already have completed",
    );
  }
  return issueNumber;
}

function preflightArtifactRepository({ repository, report, markdown, artifact }) {
  let prepared;
  try {
    prepared = prepareBoundedIssueSummary({ report, markdown, artifact });
  } catch (error) {
    if (error instanceof BoundedIssueSummaryError) {
      fail(error.code, error.path, "artifact publication preflight failed");
    }
    fail("INVALID_ARTIFACT_DESCRIPTOR", "artifact", "artifact publication preflight failed");
  }
  if (prepared.artifactRepository !== repository) {
    fail(
      "ARTIFACT_REPOSITORY_MISMATCH",
      "artifact.repository",
      "artifact repository must exactly match the publication repository",
    );
  }
}

export async function publishGitHubIssue(input) {
  const validatedInput = requirePublisherInput(input);
  const { repository, report, markdown, artifact, client, hasArtifact } = validatedInput;
  const { owner, repo } = parseRepository(repository);

  if (hasArtifact) {
    preflightArtifactRepository({ repository, report, markdown, artifact });
    planIssuePublication({ report, markdown, artifact, issues: [] });
  } else {
    planIssuePublication({ report, markdown, issues: [] });
  }
  const validatedClient = validateClient(client);

  const issues = await listAllOpenIssues({ owner, repo, client: validatedClient });
  const plan = hasArtifact
    ? planIssuePublication({ report, markdown, artifact, issues })
    : planIssuePublication({ report, markdown, issues });

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
      response = await Reflect.apply(validatedClient.createIssue, validatedClient.receiver, [
        {
          owner,
          repo,
          title: plan.title,
          body: plan.body,
        },
      ]);
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
      response = await Reflect.apply(validatedClient.updateIssue, validatedClient.receiver, [
        {
          owner,
          repo,
          issueNumber: plan.issueNumber,
          title: plan.title,
          body: plan.body,
        },
      ]);
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

# Architecture

## Purpose

Claude Code Prompt Drift is a small, auditable pipeline that turns two
user-controlled inputs into a deterministic compatibility report and can publish
that already-validated result through a narrowly injected GitHub Issue boundary.

Task 001 established public contracts. Task 002 added deterministic local
classification. Task 003 added deterministic report construction and safe
Markdown rendering. Task 004 adds a pure publication planner and a separate,
effectful GitHub Issue publisher without adding acquisition, patching, version
monitoring, or customization application.

## Component boundaries

### 1. Upstream acquisition — future and separate

A collector will obtain an upstream inventory outside the report pipeline.
Acquisition remains untrusted until it has completed, been normalized, and
supplied a stable source identifier, version, and inventory digest. It must not
silently fall back to partial data.

### 2. Normalization — future and separate

A normalizer will convert collector-specific records into a common shape with
stable target IDs, display labels, digests, optional aliases, and deterministic
matching hints. It must not invent missing content or use a model to guess
identity.

### 3. Comparison and classification — Task 002

`classifyInventory()` validates shapes, digests, and unique IDs; reserves exact
target IDs; performs exact matching before declared name or alias matching;
consumes only exact matches and unique rename candidates; preserves input order;
and folds public finding severities into one compatibility status.

It performs no hidden I/O and never mutates caller data. No fuzzy threshold,
embedding, hosted model, edit distance, locale collation, or hidden heuristic is
part of classification.

### 4. Report builder — Task 003

`buildIssueReport()` is a pure boundary between classification and presentation.
It preserves status, findings, summary, counts, and order; requires all variable
metadata explicitly; fixes `mutationsPerformed` to `false`; validates readiness
and count closure; returns newly allocated data; and rejects unknown fields.

The `mutationsPerformed` field describes this report-construction stage only.
Task 004 never changes it.

### 5. Markdown renderer — Task 003

`renderIssueMarkdown(report)` validates and clones the report before rendering.
It emits one fixed report marker, deterministic headings and sections, and safe
representations of known public fields. It neutralizes raw HTML, Markdown
injection, line separators, and local absolute path-like text.

The renderer has no repository configuration, token, network access, or mutation
permission.

### 6. Publication planner — Task 004

`planIssuePublication({ report, markdown, issues })` is pure. It:

1. validates the Task 003 report contract;
2. recomputes `renderIssueMarkdown(report)` and requires byte identity;
3. generates a fixed title from the four compatibility statuses;
4. prefixes the body with the fixed rolling-Issue marker;
5. validates the generated title and body against shared 256-character and
   65,536-character publication limits;
6. validates normalized Issue records without modifying them;
7. ignores closed Issues and Pull Request records;
8. accepts an identity candidate only when the exact marker is its first line
   and occurs once;
9. fails closed for a repeated marker on a canonical-prefix Issue;
10. fails closed when more than one canonical identity exists;
11. returns deterministic `CREATE`, `UPDATE`, or `NOOP` data.

Neither marker nor title is caller-configurable. Marker text elsewhere in an
ordinary body does not establish identity. The planner never truncates Markdown.
A valid report whose complete rendered body exceeds the publication limit fails
with `PUBLICATION_BODY_TOO_LARGE` before Issue inspection. Large inventories
therefore require a future bounded-summary, artifact, or split-publication
contract rather than silent data loss.

### 7. Injected GitHub Issue publisher — Task 004

`publishGitHubIssue({ repository, report, markdown, client })` is the only new
effectful boundary. It accepts only a strict `owner/repository` identifier and a
plain-object client implementing:

```js
client.listIssuesPage({ owner, repo, state, page, perPage })
client.createIssue({ owner, repo, title, body })
client.updateIssue({ owner, repo, issueNumber, title, body })
```

The publisher reads no environment variable or token and has no direct Octokit
dependency. It fixes `state` to `open`, starts at page 1, fixes `perPage` to 100,
and applies a deterministic 100-page upper bound.

Client methods, paginated records, and mutation responses are inspected through
own property descriptors. Required values must be own data properties; accessors
are rejected without invoking their getters. Descriptor or Proxy inspection
failures are converted into stable, sanitized `IssuePublicationError` values.

Before its first possible create or update, it completes:

1. repository validation;
2. report validation;
3. Markdown byte-identity and publication-size validation;
4. client-interface validation;
5. all paginated reads;
6. page and Issue-record validation;
7. Pull Request and closed-Issue filtering;
8. marker identity parsing;
9. duplicate and ambiguity checks;
10. final publication planning.

A call performs zero or one remote mutation. It never creates and then updates,
or updates more than once. Its result reports `mutationPerformed` independently
from the immutable Task 003 report field.

If create or update resolves but its response cannot be safely inspected, the
publisher throws `INVALID_MUTATION_RESPONSE`. At that point the remote write may
already have completed, so a caller must reconcile the canonical Issue before
retrying instead of assuming zero mutation.

### 8. Customization application — future and separate

Applying a customization is outside the watcher. A compatibility report is not
permission to execute `tweakcc`, another patching tool, or modify an installed
binary. Acquisition and application integrations remain independent boundaries.

## Trust boundaries

The system treats these as separate trust zones:

- **Public local processing:** schemas, fixtures, classifier, builder, renderer,
  planner, and tests.
- **Injected remote adapter:** a caller-owned minimal GitHub client.
- **User-local material:** genuine frozen prompts and customization artifacts.
- **Acquired upstream material:** versioned input whose readiness must be proven.
- **Remote mutation:** at most one Issue write, isolated in the publisher.
- **Customization application:** a later integration outside publication.

Genuine prompt content remains in user-controlled storage. Public tests stay
synthetic and never require a private repository or real GitHub API.

## Permissions and concurrency

Task 004 adds no production workflow or trigger. A future workflow needs only:

```yaml
permissions:
  contents: read
  issues: write
```

No broader write permission is part of the publisher contract. All real
publisher runs must share one concurrency group. Serialization reduces the race
in which two runs both finish listing with zero canonical candidates and each
attempts a create.

## Determinism and auditability

For the same explicit normalized inputs, classifier result, report object,
Markdown, and publication plan are byte-for-byte or deep-equal stable. Titles,
markers, length limits, pagination parameters, and page bounds are fixed. No
current time, locale, random value, environment variable, or process-order source
affects the plan.

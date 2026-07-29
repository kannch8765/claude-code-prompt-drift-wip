# Compatibility Model

## Overall statuses

### `SAFE_TO_REAPPLY`

All frozen targets were found by exact identity, their upstream digests are
unchanged, no unmatched upstream records require inventory review, and the
upstream snapshot is ready. This is a compatibility judgment, not permission to
execute a patch automatically.

### `REVIEW_REQUIRED`

The inputs are usable, but a human should inspect at least one non-blocking
change, such as a changed target body, one unique possible rename, or a newly
introduced upstream prompt.

### `BLOCKED`

A safe target mapping cannot be established, such as when a target is missing or
multiple plausible candidates remain.

### `UPSTREAM_NOT_READY`

The upstream snapshot is missing, partial, unavailable, or not trusted enough to
compare. This state is about input readiness rather than compatibility.

Malformed classifier, report, renderer, planner, or publisher input throws a
stable typed error before it can be mistaken for a compatibility decision.

## Classifier contract

`classifyInventory()` accepts explicit normalized frozen and upstream entries.
Exact target identity wins over all name or alias candidates. Rename comparison
uses only declared strings normalized with Unicode NFKC, trimming,
locale-independent lowercase conversion, and whitespace collapse. It uses no
fuzzy matching, embeddings, model, or network service.

Every exact match is consumed. One unique declared rename candidate is consumed.
Ambiguous candidates remain unconsumed, and every remaining upstream entry is
reported in upstream order.

## Finding kinds and public sections

| Finding | Meaning | Minimum status | Markdown section |
| --- | --- | --- | --- |
| `UNCHANGED` | Exact target ID and digest match. | `SAFE_TO_REAPPLY` | Safe to reapply |
| `TARGET_CHANGED` | Exact target ID exists but its digest changed. | `REVIEW_REQUIRED` | Review required |
| `POSSIBLE_RENAME` | Exactly one declared identity candidate remains. | `REVIEW_REQUIRED` | Review required |
| `NEW_UPSTREAM_PROMPT` | An upstream record remains unconsumed. | `REVIEW_REQUIRED` | New upstream prompts |
| `TARGET_MISSING` | The target is absent and no candidate remains. | `BLOCKED` | Blocked |
| `AMBIGUOUS_MATCH` | Multiple candidates could represent the target. | `BLOCKED` | Blocked |
| `UPSTREAM_NOT_READY` | The upstream input cannot be compared safely. | `UPSTREAM_NOT_READY` | Upstream readiness |

Overall status precedence is:

```text
UPSTREAM_NOT_READY
  > BLOCKED
  > REVIEW_REQUIRED
  > SAFE_TO_REAPPLY
```

## Stable classifier output

The classifier returns `{ status, findings, summary }`. `findingCounts` contains
every public finding kind in contract order, including zero counts. Frozen-target
findings follow frozen input order; new-upstream findings follow afterward in
upstream input order.

## Report contract

`buildIssueReport()` accepts the classifier output plus explicit report ID,
canonical UTC timestamp, contract version, baseline metadata, and upstream
metadata. It rejects unknown fields, malformed finding shapes, status mismatch,
duplicate candidates, incomplete count maps, and count mismatches.

The machine-readable output contains:

```js
{
  contractVersion: "1",
  reportId,
  generatedAt,
  status,
  mutationsPerformed: false,
  baseline,
  upstream,
  summary,
  findings,
}
```

`mutationsPerformed: false` is immutable and means report construction performed
no mutation. A later Task 004 publisher result uses its own
`mutationPerformed: boolean` field to describe whether that invocation issued a
remote write.

## Markdown safety contract

`renderIssueMarkdown(report)` is a pure presentation step. It emits exactly one
renderer-owned marker and fixed public headings. It never creates or updates a
GitHub Issue.

All report strings are untrusted. The renderer flattens line separators,
contains values in dynamically fenced inline code, neutralizes raw HTML and
Markdown injection, prevents user data from reproducing the fixed marker,
renders only known public fields, rejects prompt-body and artifact-path fields,
and redacts local absolute path-like text.

## Issue publication identity

The publisher owns this fixed first-line marker:

```text
<!-- claude-code-prompt-drift:rolling-issue:v1 -->
```

The complete desired Issue body is exactly:

```text
<publisher marker>

<complete renderIssueMarkdown(report) output>
```

The Task 003 report marker remains present exactly once. The publisher marker
also occurs exactly once and cannot be supplied through a title, report field,
or Markdown argument because Markdown must match the renderer byte-for-byte.

Titles are fixed by status:

```text
Claude Code Prompt Drift — SAFE_TO_REAPPLY
Claude Code Prompt Drift — REVIEW_REQUIRED
Claude Code Prompt Drift — BLOCKED
Claude Code Prompt Drift — UPSTREAM_NOT_READY
```

No current time, locale, or random value appears in the title or body.

## Publication planner

`planIssuePublication({ report, markdown, issues })` validates and clones the
report, verifies the exact Markdown identity, and validates normalized Issue
records without modifying caller data.

Only open non-Pull-Request records participate in identity. A canonical candidate
must have the exact publisher marker on its first line and exactly once in its
body. Marker text later in an ordinary body is not an identity. A canonical
prefix with a repeated marker fails closed.

The deterministic rules are:

- zero candidates: `CREATE`;
- one candidate with different title or body: `UPDATE`;
- one byte-identical candidate: `NOOP`;
- more than one candidate: `AMBIGUOUS_ISSUE_IDENTITY`.

## Effectful publisher

`publishGitHubIssue({ repository, report, markdown, client })` accepts only a
strict `owner/repository` identifier. URLs, empty segments, dot segments,
backslashes, queries, fragments, and percent-encoded forms are rejected.

The injected client must be a plain object with `listIssuesPage()`,
`createIssue()`, and `updateIssue()`. The publisher does not read a token or
environment variable and has no direct GitHub library dependency.

Listing starts at page 1 with `perPage: 100`. A page shorter than 100 ends the
scan. Exactly 100 full pages without termination fails with
`PAGINATION_LIMIT_EXCEEDED`. Every page and record is validated, and identities
found on different pages are treated exactly like identities on one page.

The first create or update is allowed only after repository, report, Markdown,
client, all pages, all records, Pull Request filtering, identity parsing,
duplicate checks, and the final plan are complete. Each invocation performs at
most one mutation.

Successful publisher results are:

```js
{
  action: "CREATED" | "UPDATED" | "NOOP",
  issueNumber,
  mutationPerformed: boolean,
}
```

Failures use `IssuePublicationError` with stable `name`, `code`, `path`, and a
sanitized message. Messages do not include complete reports, Markdown, tokens,
client-response dumps, or prompt content.

## Future workflow boundary

Task 004 adds no schedule, manual dispatch, production token wiring, or real
Issue mutation. A future workflow needs only:

```yaml
permissions:
  contents: read
  issues: write
```

Real publisher runs must share one concurrency group so two runs do not both
observe zero candidates and race to create separate rolling Issues.

Upstream acquisition, real prompt adapters, version monitoring, customization
application, Claude Code execution, and `tweakcc` remain separate integrations.

# Compatibility Model

## Overall statuses

### `SAFE_TO_REAPPLY`

All frozen targets were found by exact identity, their upstream digests are
unchanged, no unmatched upstream records require inventory review, and the
upstream snapshot is ready.

This is a compatibility judgment, not permission to execute a patch
automatically.

### `REVIEW_REQUIRED`

The inputs are usable, but a human should inspect at least one non-blocking
change. Examples include a changed target body, one unique possible rename, or
a newly introduced upstream prompt.

### `BLOCKED`

A safe target mapping cannot be established. Examples include a missing target
with no candidate or multiple plausible candidates.

### `UPSTREAM_NOT_READY`

The upstream snapshot is missing, partial, unavailable, or not trusted enough
to compare. This state is about input readiness rather than compatibility.

Malformed classifier or report input throws a stable typed error before any
result can be mistaken for a compatibility decision.

## Public classifier input

`classifyInventory()` accepts one plain object:

```js
{
  upstreamReady: boolean,
  frozenEntries: [
    {
      customizationId: string,
      targetId: string,
      displayName: string,
      expectedDigest: "sha256:<64 lowercase hex characters>",
      aliases?: string[],
    },
  ],
  upstreamEntries: [
    {
      targetId: string,
      displayName: string,
      digest: "sha256:<64 lowercase hex characters>",
      aliases?: string[],
    },
  ],
}
```

Aliases are optional and behave as empty arrays when omitted. IDs are exact,
case-sensitive identifiers. Duplicate frozen customization IDs, duplicate
frozen target IDs, and duplicate upstream target IDs are rejected.

## Matching and consumption

Frozen entries are processed in caller-provided order, but every upstream ID
that is an exact target for any frozen entry is reserved before rename matching.

1. Exact target ID matching always wins.
2. An exact match produces `UNCHANGED` or `TARGET_CHANGED`.
3. One declared normalized name or alias candidate produces `POSSIBLE_RENAME`.
4. Multiple candidates produce `AMBIGUOUS_MATCH` and remain unconsumed.
5. No candidate produces `TARGET_MISSING`.
6. Every unconsumed upstream entry produces `NEW_UPSTREAM_PROMPT` in upstream
   input order.

Name and alias comparison uses Unicode NFKC normalization, trimming,
locale-independent lowercase conversion, and whitespace collapse. It does not
use fuzzy matching, embeddings, a model, or network services.

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

The classifier returns:

```js
{
  status,
  findings,
  summary: {
    frozenTargets,
    upstreamTargets,
    findingCounts,
  },
}
```

`findingCounts` contains every public finding kind in contract order, including
zero counts. Frozen-target findings follow frozen input order; new-upstream
findings follow afterward in upstream input order.

## Public report builder input

`buildIssueReport()` accepts the classifier output plus explicit metadata:

```js
{
  classification,
  reportId,
  generatedAt,
  contractVersion: "1",
  baseline: {
    source,
    version,
    inventoryDigest,
  },
  upstream: {
    ready,
    source,
    version,
    inventoryDigest,
    readinessReason?,
  },
}
```

`generatedAt` must be a real canonical UTC instant with milliseconds, such as
`2026-07-29T03:17:00.000Z`. The function never generates a timestamp or report
ID internally.

Report IDs, identities, versions, and source identifiers have explicit length
and character boundaries. They reject controls, line separators, backslashes,
local absolute paths, drive prefixes, and dot-segment path values. A source may
be a bounded portable token or a canonical `https` source identifier.

A ready upstream requires a version and inventory digest and forbids a readiness
reason. A non-ready upstream requires null version and digest plus a bounded
reason. Readiness must agree with the classifier status.

The builder rejects unknown fields, malformed finding shapes, status mismatch,
duplicate candidates, incomplete finding-count maps, and counts that do not
match the findings. It does not change classifier content or order and returns a
deep copy.

## Machine-readable report

The output conforms to `schemas/issue-report.schema.json` and contains:

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

The key order above is stable. Equal explicit input produces byte-for-byte equal
`JSON.stringify()` output.

## Markdown safety contract

`renderIssueMarkdown(report)` is a pure presentation step. It emits exactly one
renderer-owned marker and fixed public headings. It never creates or updates a
GitHub Issue.

All report strings are untrusted. The renderer:

- flattens CR, LF, and Unicode line separators before insertion;
- contains values in dynamically fenced inline code;
- neutralizes raw HTML, comments, and folding tags;
- prevents link, heading, table, and backtick injection;
- prevents user data from reproducing the fixed marker;
- emits no arbitrary clickable external links;
- renders only identity, digest, metadata, counts, and fixed messages;
- rejects prompt-body and artifact-path fields rather than reading them;
- redacts local absolute path-like text;
- preserves finding order within stable public sections.

The final body states that no automatic apply or remote mutation occurred.

## Task 004 handoff

Task 004 may implement an Issue publisher that consumes the validated report and
rendered Markdown. It owns GitHub authentication, repository configuration,
Issue lookup, marker identity, create/update behavior, and fail-before-mutation
checks.

The publisher must not reclassify prompts, regenerate report metadata silently,
read artifact files through the renderer, or add GitHub permissions to the
builder and renderer. Upstream acquisition and any `tweakcc` customization
application remain separate integrations.

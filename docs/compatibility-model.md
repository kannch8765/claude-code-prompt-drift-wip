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

Malformed classifier input does not produce a compatibility status. It throws a
stable `ClassificationInputError` before any result can be mistaken for
`SAFE_TO_REAPPLY`.

### `UPSTREAM_NOT_READY`

The upstream snapshot is missing, partial, unavailable, or not trusted enough
to compare. This state is about input readiness rather than compatibility.

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
case-sensitive identifiers. Duplicate frozen `customizationId`, duplicate
frozen `targetId`, and duplicate upstream `targetId` values are rejected.
Required fields, plain-object shapes, arrays, non-empty strings, and digests are
validated before classification.

Invalid input throws `ClassificationInputError`. Its stable public fields are:

```js
{
  name: "ClassificationInputError",
  code: string,
  path: string,
  message: string,
}
```

Input validation precedes readiness classification. A valid input with
`upstreamReady: false` then short-circuits to one `UPSTREAM_NOT_READY` finding
and produces no digest, rename, missing, or new-upstream findings.

## String normalization

Rename candidates use only declared display names and aliases. Every compared
string is transformed in this exact order:

1. Unicode `NFKC` normalization;
2. trim leading and trailing whitespace;
3. locale-independent JavaScript `toLowerCase()` case folding;
4. replace each run of Unicode whitespace with one ASCII space.

No locale-aware collation, fuzzy threshold, edit distance, embedding, model,
network service, tag inference, or hidden semantic heuristic is used.

## Matching and consumption

Frozen entries are processed in caller-provided order, but every upstream ID
that is an exact target for any frozen entry is reserved before rename matching.
This prevents an earlier rename from consuming a later frozen target's exact ID.

1. Exact `targetId` matching always wins over all name or alias candidates.
2. An exact match is consumed and produces `UNCHANGED` or `TARGET_CHANGED`.
3. Without an exact target, only upstream entries that are neither reserved for
   an exact match nor already consumed are considered as rename candidates.
4. One candidate produces `POSSIBLE_RENAME` and consumes that upstream entry.
5. Multiple candidates produce `AMBIGUOUS_MATCH`; none of those candidates are
   consumed.
6. No candidate produces `TARGET_MISSING`.
7. After all frozen entries, every still-unconsumed upstream entry produces
   `NEW_UPSTREAM_PROMPT` in upstream input order.

Because ambiguous candidates are not consumed, they are also emitted as
`NEW_UPSTREAM_PROMPT` after the frozen-target finding. This closes the Task 001
fixture ambiguity and ensures no unmatched upstream record disappears.

## Finding kinds

| Finding | Meaning | Minimum status |
| --- | --- | --- |
| `UNCHANGED` | Exact target ID and expected digest both match. | `SAFE_TO_REAPPLY` |
| `TARGET_CHANGED` | Exact target ID exists, but its digest changed. | `REVIEW_REQUIRED` |
| `POSSIBLE_RENAME` | The old ID is absent and exactly one explicit candidate remains. | `REVIEW_REQUIRED` |
| `NEW_UPSTREAM_PROMPT` | An upstream record is not consumed by any frozen target. | `REVIEW_REQUIRED` |
| `TARGET_MISSING` | The old target is absent and no candidate remains. | `BLOCKED` |
| `AMBIGUOUS_MATCH` | More than one candidate could represent the target. | `BLOCKED` |
| `UPSTREAM_NOT_READY` | The upstream input cannot be safely compared. | `UPSTREAM_NOT_READY` |

## Status precedence

The overall result uses this precedence:

```text
UPSTREAM_NOT_READY
  > BLOCKED
  > REVIEW_REQUIRED
  > SAFE_TO_REAPPLY
```

`UPSTREAM_NOT_READY` short-circuits classification after validation. Otherwise
the most severe finding sets the result status.

## Stable output

The result shape is:

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

Every finding has `kind`, its minimum `status`, and a stable `message`.
Applicable findings also include `customizationId`, `targetId`,
`candidateTargetIds`, `expectedDigest`, and `actualDigest`. Candidate IDs follow
upstream input order. Frozen-target findings follow frozen input order; all
`NEW_UPSTREAM_PROMPT` findings follow afterward in upstream input order.

`findingCounts` contains every public finding kind in contract order, including
zero counts. The classifier allocates a new result and does not mutate caller
arrays or objects. Equal valid inputs produce deep-equal results without using
the clock, filesystem, network, locale services, or process-global ordering.

## Task 003 handoff

Task 003 may add report metadata and render or map this stable result into
`schemas/issue-report.schema.json`. It should preserve finding order and fields,
add only report ID, timestamp, upstream source metadata, contract metadata, and
`mutationsPerformed: false`, and keep Issue mutation outside the renderer.

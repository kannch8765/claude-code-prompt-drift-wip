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
with no candidate, multiple plausible candidates, malformed frozen metadata, or
a digest contract violation.

No customization should be reapplied from a `BLOCKED` report.

### `UPSTREAM_NOT_READY`

The upstream snapshot is missing, partial, unavailable, or not trusted enough
to compare. This state is about input readiness rather than compatibility.

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

`UPSTREAM_NOT_READY` short-circuits classification because findings derived
from incomplete input would be misleading. Otherwise the most severe finding
sets the report status.

## Matching principles

- Exact stable identity is stronger than labels or aliases.
- Content equality is represented by a declared digest, not a text excerpt.
- A changed digest is never automatically accepted.
- A possible rename must have exactly one deterministic candidate.
- Ambiguity always fails closed.
- New upstream records are reported even when every frozen target is unchanged.
- No model-generated semantic guess may produce `SAFE_TO_REAPPLY`.

## Report invariants

A valid report:

- declares its contract version;
- records whether upstream input was ready;
- contains one of the four exact statuses;
- contains machine-readable findings and summary counts;
- declares that Task 001 performed no mutation;
- does not embed genuine prompt content.

# Architecture

## Purpose

Claude Code Prompt Drift is designed as a small, auditable pipeline that turns
two user-controlled inputs into a deterministic compatibility report:

- a frozen customization manifest plus local artifacts;
- a normalized snapshot of an upstream prompt inventory.

Task 001 establishes the contracts around that pipeline without implementing a
real collector, classifier, patcher, or publisher.

## Component boundaries

### 1. Upstream acquisition — future

A collector will obtain an upstream inventory outside this repository's
contract layer. Acquisition is explicitly untrusted until it has completed,
been normalized, and supplied a stable snapshot identifier and digest.

The collector must not silently fall back to partial data. Incomplete,
unavailable, or unverifiable input produces `UPSTREAM_NOT_READY`.

### 2. Normalization — future

A normalizer will convert collector-specific records into a small common shape:

- stable target ID when available;
- display label;
- content digest;
- optional aliases and deterministic matching hints;
- source ordinal or other non-secret inventory metadata.

Normalization must not invent missing content or use a model to guess identity.

### 3. Comparison and classification — Task 002

The comparison engine should be a pure function. It must accept normalized
frozen entries and upstream records and return findings plus one overall status.
It must not read GitHub, mutate files, call a model, or apply a customization.

Recommended entry point:

```js
classifyInventory({
  upstreamReady,
  frozenEntries,
  upstreamEntries,
})
```

Recommended deterministic order:

1. Short-circuit to `UPSTREAM_NOT_READY` when the upstream snapshot is not
   complete and trusted.
2. Match a frozen target by exact stable ID.
3. For an exact ID, compare the expected and current content digests.
4. When the ID is absent, evaluate only explicit aliases and normalized labels.
5. Emit `POSSIBLE_RENAME` only when exactly one candidate survives.
6. Emit `AMBIGUOUS_MATCH` when multiple candidates survive.
7. Emit `TARGET_MISSING` when no candidate survives.
8. Emit `NEW_UPSTREAM_PROMPT` for unmatched upstream records.
9. Fold finding severities into the overall compatibility status using the
   precedence documented in `compatibility-model.md`.

No fuzzy threshold, embedding, hosted model, or hidden heuristic belongs in the
Task 002 baseline. Any future heuristic must be separately versioned and must
never convert an ambiguous result into an automatic safe decision.

### 4. Report contract — Task 001

The classifier output is represented by
`schemas/issue-report.schema.json`. The report contains machine-readable run
metadata, summary counts, findings, and `mutationsPerformed: false`.

The report contract is intentionally independent of GitHub's Issue API. A
renderer can later turn the payload into Markdown without changing the
classification result.

### 5. Issue publisher — future

A publisher may create or update an Issue only after it receives a valid report
and explicit repository configuration. It should use least-privilege
permissions, preserve a stable marker, and fail before mutation when identity is
ambiguous.

No publisher or Issue mutation exists in Task 001.

### 6. Customization application — future and separate

Applying a customization is deliberately outside the watcher. A report may say
that reapplication appears safe, but the watcher does not execute a patching
tool or modify an installed binary.

## Trust boundaries

The system treats these as separate trust zones:

- **Public contract:** schemas, documentation, synthetic examples, fixtures.
- **User-local material:** genuine frozen prompts and customization artifacts.
- **Acquired upstream material:** versioned input whose readiness must be
  proven.
- **Remote mutation:** GitHub Issue writes, disabled until a later stage.

Genuine prompt content should remain in user-controlled storage. Public tests
must stay synthetic and must never require a private repository.

## Determinism and auditability

For the same normalized inputs and contract version, the engine should produce
byte-for-byte equivalent JSON after canonical serialization. Every finding must
identify the rule that produced it. Overall status is a severity fold, not an
opaque score.

## Task 002 handoff

Task 002 can begin directly from these artifacts:

- import status and finding constants from `src/contracts.mjs`;
- use every JSON file in `fixtures/` as executable acceptance input;
- implement the pure classifier described above;
- validate output against the Issue report shape;
- keep all tests local and synthetic;
- do not add upstream collection, model calls, patch application, or Issue
  mutation.

The fixture names are the required minimum behavior surface. The additional
`upstream-not-ready` fixture closes the fourth top-level status.

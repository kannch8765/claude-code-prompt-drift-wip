# Architecture

## Purpose

Claude Code Prompt Drift is designed as a small, auditable pipeline that turns
two user-controlled inputs into a deterministic compatibility report:

- a frozen customization manifest plus local artifacts;
- a normalized snapshot of an upstream prompt inventory.

Task 001 established the public contracts. Task 002 adds the local comparison
engine without adding acquisition, patching, publishing, or remote mutation.

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

`src/classify-inventory.mjs` exports the pure public entry point:

```js
classifyInventory({
  upstreamReady,
  frozenEntries,
  upstreamEntries,
})
```

The module validates its complete public input contract and throws
`ClassificationInputError` for malformed input. It performs no hidden I/O and
never mutates caller data.

Classification is deterministic:

1. validate required shapes, fields, digests, and unique IDs;
2. short-circuit a valid non-ready snapshot to `UPSTREAM_NOT_READY`;
3. reserve every upstream ID that exactly matches any frozen target before
   evaluating rename candidates;
4. match exact stable IDs before any display-name or alias candidate;
5. compare digests for exact targets;
6. evaluate only NFKC-normalized, trimmed, case-folded, whitespace-collapsed
   declared labels and aliases for absent IDs;
7. consume exact matches and unique rename candidates only;
8. leave ambiguous candidates unconsumed;
9. emit frozen-target findings in frozen input order;
10. emit every unconsumed upstream record in upstream input order;
11. fold finding severities using the public compatibility precedence.

No fuzzy threshold, embedding, hosted model, edit distance, locale collation, or
hidden heuristic belongs in the Task 002 engine.

### 4. Report contract — Task 001

The classifier returns `{ status, findings, summary }`. Its finding fields and
summary counts are directly mappable into
`schemas/issue-report.schema.json`, while report ID, timestamps, contract
metadata, and upstream source metadata remain the responsibility of a later
report builder.

The report contract is intentionally independent of GitHub's Issue API. A
renderer can later turn the payload into Markdown without changing the
classification result.

### 5. Issue publisher — future

A publisher may create or update an Issue only after it receives a valid report
and explicit repository configuration. It should use least-privilege
permissions, preserve a stable marker, and fail before mutation when identity is
ambiguous.

No publisher or Issue mutation exists in Task 002.

### 6. Customization application — future and separate

Applying a customization is deliberately outside the watcher. A report may say
that reapplication appears safe, but the watcher does not execute a patching
tool or modify an installed binary.

## Trust boundaries

The system treats these as separate trust zones:

- **Public contract and engine:** schemas, documentation, synthetic examples,
  fixtures, classifier, and tests.
- **User-local material:** genuine frozen prompts and customization artifacts.
- **Acquired upstream material:** versioned input whose readiness must be
  proven.
- **Remote mutation:** GitHub Issue writes, disabled until a later stage.

Genuine prompt content should remain in user-controlled storage. Public tests
must stay synthetic and must never require a private repository.

## Determinism and auditability

For the same normalized inputs and contract version, the engine produces a
deep-equal result with a fixed key and finding order. Every finding identifies
the rule through a stable kind, minimum status, and message. Overall status is a
severity fold, not an opaque score.

The engine imports no filesystem, network, clock, locale-service, GitHub, model,
or process-order source. All fixture acceptance tests execute locally.

## Task 003 handoff

Task 003 can consume the classifier result without reimplementing matching:

- preserve `status`, `findings`, `summary`, and their order;
- add report ID, generated timestamp, contract version, and upstream metadata;
- map the result into `schemas/issue-report.schema.json`;
- render Markdown or an Issue payload as a separate pure step;
- keep GitHub Issue mutation and permissions outside report generation.

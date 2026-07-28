# Architecture

## Purpose

Claude Code Prompt Drift is a small, auditable pipeline that turns two
user-controlled inputs into a deterministic compatibility report:

- a frozen customization manifest plus local artifacts;
- a normalized snapshot of an upstream prompt inventory.

Task 001 established public contracts. Task 002 added deterministic local
classification. Task 003 adds deterministic report construction and safe
Markdown rendering without acquisition, patching, publishing, or remote
mutation.

## Component boundaries

### 1. Upstream acquisition — future and separate

A collector will obtain an upstream inventory outside the report pipeline.
Acquisition remains untrusted until it has completed, been normalized, and
supplied a stable source identifier, version, and inventory digest.

The collector must not silently fall back to partial data. Incomplete,
unavailable, or unverifiable input produces `UPSTREAM_NOT_READY`.

### 2. Normalization — future and separate

A normalizer will convert collector-specific records into a common shape with
stable target IDs, display labels, digests, optional aliases, and deterministic
matching hints. It must not invent missing content or use a model to guess
identity.

### 3. Comparison and classification — Task 002

`src/classify-inventory.mjs` exports:

```js
classifyInventory({
  upstreamReady,
  frozenEntries,
  upstreamEntries,
})
```

The classifier validates shapes, digests, and unique IDs; reserves exact target
IDs; performs exact matching before declared name or alias matching; consumes
only exact matches and unique rename candidates; preserves frozen and upstream
input order; and folds public finding severities into one compatibility status.

It performs no hidden I/O and never mutates caller data. No fuzzy threshold,
embedding, hosted model, edit distance, locale collation, or hidden heuristic is
part of classification.

### 4. Report builder — Task 003

`src/build-issue-report.mjs` exports:

```js
buildIssueReport({
  classification,
  reportId,
  generatedAt,
  contractVersion,
  baseline,
  upstream,
})
```

The builder is a pure boundary between classification and presentation. It:

- preserves `classification.status` exactly;
- preserves finding content and order exactly;
- preserves summary and all finding counts exactly;
- requires caller-supplied report ID and canonical UTC timestamp;
- adds bounded baseline and upstream source, version, and digest metadata;
- fixes `mutationsPerformed` to `false`;
- validates readiness, count closure, finding shape, and status consistency;
- returns newly allocated nested objects and arrays;
- rejects unknown fields so prompt bodies and artifact paths cannot enter the
  public report accidentally.

It does not read the clock, randomness, environment, filesystem, network, model,
or GitHub API.

### 5. Markdown renderer — Task 003

`src/render-issue-markdown.mjs` exports:

```js
renderIssueMarkdown(report)
```

The renderer validates and clones the report before rendering. It emits one
fixed public marker, a deterministic summary, all finding counts, and stable
sections for blocked, review-required, new-upstream, safe, and not-ready
findings. Findings retain classifier order within each public section.

Every report string is untrusted. The renderer flattens line separators,
neutralizes raw HTML and comments, uses dynamically sized inline-code fences for
backticks, prevents Markdown links, headings, and tables from escaping their
field, and redacts local absolute path-like text. It renders only known report
fields and never reads an `artifactPath` or prompt body.

The output is compatible with a future GitHub Issue body, but this component has
no GitHub token, repository configuration, or mutation permission.

### 6. Issue publisher — Task 004

Task 004 may add a publisher that accepts a validated report and rendered body.
The publisher must remain a separate boundary with least-privilege Issue write
permissions, stable Issue identity, fail-before-mutation behavior, and explicit
handling for ambiguous or duplicate markers.

Task 004 must not move the clock, network, GitHub API, or mutation behavior into
`buildIssueReport()` or `renderIssueMarkdown()`.

### 7. Customization application — future and separate

Applying a customization is outside the watcher. A report may say that
reapplication appears safe, but neither the report builder nor renderer executes
`tweakcc`, another patching tool, or modifies an installed binary. Acquisition
and application integrations remain independent boundaries.

## Trust boundaries

The system treats these as separate trust zones:

- **Public local processing:** schemas, synthetic examples, fixtures,
  classifier, builder, renderer, and tests.
- **User-local material:** genuine frozen prompts and customization artifacts.
- **Acquired upstream material:** versioned input whose readiness must be
  proven.
- **Remote mutation:** GitHub Issue writes, reserved for Task 004.
- **Customization application:** a later integration outside report generation.

Genuine prompt content remains in user-controlled storage. Public tests stay
synthetic and never require a private repository.

## Determinism and auditability

For the same explicit normalized inputs, the classifier result, report object,
`JSON.stringify(report)`, and Markdown output are byte-for-byte stable. Key and
section order are fixed by public contract order rather than locale,
filesystem enumeration, process environment, or current time.

All report metadata that can vary is supplied explicitly by the caller. The
builder and renderer import no filesystem, network, clock, locale-service,
GitHub, model, or process-order source.

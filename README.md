# Claude Code Prompt Drift

> I wake up. There is another Claude Code update.

Claude Code Prompt Drift is a personal CI watcher for detecting changes in an
upstream prompt inventory and deciding whether frozen customizations are still
safe to reapply.

This repository contains deliberately public, synthetic contracts and pure,
deterministic local processing. It does not contain genuine Claude Code prompts,
copied prompt names, private customizations, or a working integration with any
patching tool.

## What this project is for

The intended workflow is:

1. A user supplies a frozen customization manifest and its local artifacts.
2. A future collector supplies a normalized upstream inventory.
3. `classifyInventory()` classifies every frozen target and unmatched upstream
   entry.
4. `buildIssueReport()` adds explicit report and inventory metadata without
   changing the classifier result.
5. `renderIssueMarkdown()` produces a safe, Issue-compatible Markdown body.
6. A future Task 004 publisher may create or update a GitHub Issue after a
   separate mutation boundary.

## Public local APIs

### Comparison

```js
import { classifyInventory } from "./src/classify-inventory.mjs";

const classification = classifyInventory({
  upstreamReady,
  frozenEntries,
  upstreamEntries,
});
```

The classifier performs no file, network, clock, locale-service, model, or
GitHub I/O. It returns `{ status, findings, summary }` and never mutates supplied
objects or arrays.

### Report builder

```js
import { buildIssueReport } from "./src/build-issue-report.mjs";

const report = buildIssueReport({
  classification,
  reportId: "fictional.run-0003",
  generatedAt: "2026-07-29T03:17:00.000Z",
  contractVersion: "1",
  baseline: {
    source: "https://airship.example.invalid/baselines",
    version: "0.0.1-fictional",
    inventoryDigest: "sha256:<64 lowercase hex characters>",
  },
  upstream: {
    ready: true,
    source: "https://airship.example.invalid/prompts",
    version: "0.0.2-fictional",
    inventoryDigest: "sha256:<64 lowercase hex characters>",
  },
});
```

The builder preserves classifier status, finding content and order, summary, and
finding counts. It adds only explicit metadata and
`mutationsPerformed: false`. It reads no clock, random source, environment,
filesystem, network, model, or GitHub API. Invalid input throws
`IssueReportInputError` with stable `code` and `path` fields.

### Safe Markdown renderer

```js
import { renderIssueMarkdown } from "./src/render-issue-markdown.mjs";

const markdown = renderIssueMarkdown(report);
```

The renderer emits deterministic GitHub Issue-compatible Markdown with one
fixed public marker. It treats every report string as untrusted, neutralizes
Markdown and HTML injection, prevents forged headings and markers, contains
untrusted values in safe inline-code spans, and redacts local absolute path-like
text. It does not create or update an Issue, follow links, read artifact paths,
or render prompt bodies.

See `docs/compatibility-model.md` for exact classifier and report contracts.

## Unofficial project

This is an independent, unofficial community project. It is not affiliated
with, sponsored by, or endorsed by Anthropic. Claude Code and Anthropic are
referenced only to describe the intended compatibility-monitoring use case.

## Safety and privacy boundary

The public repository must remain safe to inspect and fork:

- no genuine prompt bodies, excerpts, names, or inventory metadata;
- no private repository contents or private migration architecture;
- no model calls and no semantic matching through a hosted model;
- no installation or execution of Claude Code;
- no automatic patch application;
- no credentials, account data, workstation paths, or runtime session data;
- no GitHub Issue mutation in the classifier, builder, or renderer layers.

All examples and fixtures use fictional airship-navigation prompts, reserved
`.invalid` sources, and IDs beginning with `fictional.`. Tests enforce this
synthetic-only boundary.

## Repository map

- `docs/architecture.md` — components, trust boundaries, and staged delivery.
- `docs/compatibility-model.md` — deterministic classification and reporting.
- `schemas/frozen-manifest.schema.json` — public manifest contract.
- `schemas/issue-report.schema.json` — machine-readable report contract.
- `examples/` — fictional prompt artifacts, manifest, and report.
- `fixtures/` — executable deterministic comparison cases.
- `src/contracts.mjs` — shared status and finding constants.
- `src/classify-inventory.mjs` — pure comparison and classification engine.
- `src/build-issue-report.mjs` — pure report builder.
- `src/render-issue-markdown.mjs` — pure safe Markdown renderer.
- `test/` — contract, fixture, classifier, report, rendering, and safety tests.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run check
```

Individual commands:

```sh
npm run lint
npm run format
npm test
```

The project intentionally has no third-party runtime or development
dependencies. The lockfile is committed so CI and local execution use the same
install contract.

## Current scope

Task 003 implements deterministic report construction and safe Markdown
rendering. Upstream acquisition, real integrations, patch application, and
GitHub Issue mutation remain separate stages. Upstream acquisition and any
`tweakcc` integration remain independent of report generation. Task 004 may add
an Issue publisher, but it must consume the validated report and rendered body
without moving GitHub permissions into the builder or renderer.

## License

MIT

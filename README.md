# Claude Code Prompt Drift

> I wake up. There is another Claude Code update.

Claude Code Prompt Drift is a personal CI watcher for detecting changes in an
upstream prompt inventory and deciding whether frozen customizations are still
safe to reapply.

This repository contains deliberately public, synthetic contracts, deterministic
local processing, and an injected GitHub Issue publication boundary. It does not
contain genuine Claude Code prompts, copied prompt names, private customizations,
upstream acquisition, or a working integration with any patching tool.

## What this project is for

The intended workflow is:

1. A user supplies a frozen customization manifest and its local artifacts.
2. A future collector supplies a normalized upstream inventory.
3. `classifyInventory()` classifies every frozen target and unmatched upstream
   entry.
4. `buildIssueReport()` adds explicit report and inventory metadata without
   changing the classifier result.
5. `renderIssueMarkdown()` produces a safe, Issue-compatible Markdown body.
6. `planIssuePublication()` determines `CREATE`, `UPDATE`, or `NOOP` without I/O.
7. `publishGitHubIssue()` lists open Issues through an injected client and, only
   after complete validation and identity resolution, performs at most one
   create or update mutation.

## Public APIs

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
`mutationsPerformed: false`. That field means report construction itself did not
perform a mutation; it is not a statement about a later publisher call.

### Safe Markdown renderer

```js
import { renderIssueMarkdown } from "./src/render-issue-markdown.mjs";

const markdown = renderIssueMarkdown(report);
```

The renderer emits deterministic GitHub Issue-compatible Markdown with one
fixed public report marker. It treats every report string as untrusted,
neutralizes Markdown and HTML injection, contains untrusted values in safe
inline-code spans, and redacts local absolute path-like text. It does not create
or update an Issue, follow links, read artifact paths, or render prompt bodies.

### Publication planner

```js
import { planIssuePublication } from "./src/plan-issue-publication.mjs";

const plan = planIssuePublication({
  report,
  markdown,
  issues,
});
```

The planner is pure. It validates the Task 003 report, requires `markdown` to be
byte-for-byte equal to `renderIssueMarkdown(report)`, validates normalized Issue
records, resolves the fixed rolling-Issue marker, and returns a deterministic
`CREATE`, `UPDATE`, or `NOOP` plan. It never accepts a caller-supplied marker or
title.

### Injected GitHub Issue publisher

```js
import { publishGitHubIssue } from "./src/publish-github-issue.mjs";

const result = await publishGitHubIssue({
  repository: "owner/repository",
  report,
  markdown,
  client,
});
```

The publisher reads no environment variables or tokens and does not depend on
Octokit. The injected client supplies `listIssuesPage()`, `createIssue()`, and
`updateIssue()`. The publisher traverses every page itself with a fixed page size,
validates all records, ignores Pull Request records, resolves duplicate identity
markers, and builds the final plan before the first possible mutation. A
successful result reports `mutationPerformed` separately from the report's
unchanged `mutationsPerformed: false` field.

See `docs/compatibility-model.md` for exact classifier, report, rendering, and
publication contracts.

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
- no GitHub token or environment lookup in the publisher;
- no GitHub Issue mutation in the classifier, builder, renderer, or planner.

All examples and fixtures use fictional airship-navigation prompts, reserved
`.invalid` sources, and IDs beginning with `fictional.`. All publisher tests use
synthetic fake clients and perform no real network request or Issue mutation.

## Repository map

- `docs/architecture.md` — components, trust boundaries, and staged delivery.
- `docs/compatibility-model.md` — deterministic classification and publication.
- `schemas/frozen-manifest.schema.json` — public manifest contract.
- `schemas/issue-report.schema.json` — machine-readable report contract.
- `examples/` — fictional prompt artifacts, manifest, and report.
- `fixtures/` — executable deterministic comparison cases.
- `src/contracts.mjs` — shared status and finding constants.
- `src/classify-inventory.mjs` — pure comparison and classification engine.
- `src/build-issue-report.mjs` — pure report builder.
- `src/render-issue-markdown.mjs` — pure safe Markdown renderer.
- `src/plan-issue-publication.mjs` — pure Issue publication planner.
- `src/publish-github-issue.mjs` — injected, effectful Issue publisher.
- `test/` — synthetic contracts, classification, rendering, and publication tests.

## Future workflow permissions and concurrency

Task 004 adds no production workflow, schedule, dispatch trigger, or token wiring.
A future workflow that invokes the publisher needs only:

```yaml
permissions:
  contents: read
  issues: write
```

It must not request `contents: write`, `actions: write`, `pull-requests: write`,
or `id-token: write`. Real publisher runs must share one concurrency group so two
runs cannot both observe zero canonical Issues and create duplicates.

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

Task 004 implements only the validated report/Markdown to GitHub Issue
create-or-update boundary. Upstream acquisition, real prompt adapters, version
monitoring, customization application, Claude Code execution, and `tweakcc`
integration remain separate future work.

## License

MIT

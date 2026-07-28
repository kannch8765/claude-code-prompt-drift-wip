# Claude Code Prompt Drift

> I wake up. There is another Claude Code update.

Claude Code Prompt Drift is a personal CI watcher for detecting changes in an
upstream prompt inventory and deciding whether frozen customizations are still
safe to reapply.

This repository contains a deliberately public, synthetic contract and a pure,
deterministic comparison engine. It does not contain genuine Claude Code
prompts, copied prompt names, private customizations, or a working integration
with any patching tool.

## What this project is for

The intended workflow is:

1. A user supplies a frozen customization manifest and its local artifacts.
2. A future collector supplies a normalized upstream inventory.
3. `classifyInventory()` classifies every frozen target and any unmatched
   upstream entries.
4. A report is produced with one of four compatibility states:
   `SAFE_TO_REAPPLY`, `REVIEW_REQUIRED`, `BLOCKED`, or
   `UPSTREAM_NOT_READY`.
5. A future publisher may render that report into a GitHub Issue after an
   explicit review boundary.

## Comparison API

```js
import { classifyInventory } from "./src/classify-inventory.mjs";

const result = classifyInventory({
  upstreamReady,
  frozenEntries,
  upstreamEntries,
});
```

The function performs no file, network, clock, locale-service, model, or GitHub
I/O. It returns `{ status, findings, summary }` and never mutates the supplied
objects or arrays. Invalid input throws `ClassificationInputError` with stable
`code` and `path` fields.

See `docs/compatibility-model.md` for the exact input shape, normalization,
matching, consumption, ordering, and error contracts.

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
- no GitHub Issue mutation in the contract, fixture, or classifier layer.

All examples and fixtures use fictional airship-navigation prompts, reserved
`.invalid` sources, and IDs beginning with `fictional.`. Tests enforce this
synthetic-only boundary.

## Repository map

- `docs/architecture.md` — components, trust boundaries, and staged delivery.
- `docs/compatibility-model.md` — statuses and deterministic classification.
- `schemas/frozen-manifest.schema.json` — public manifest contract.
- `schemas/issue-report.schema.json` — future Issue report payload contract.
- `examples/` — fictional prompt artifacts, manifest, and report.
- `fixtures/` — executable deterministic comparison cases.
- `src/contracts.mjs` — shared status and finding constants.
- `src/classify-inventory.mjs` — pure comparison and classification engine.
- `test/` — contract, fixture, classifier, digest, and synthetic-content tests.

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

Task 002 implements deterministic local comparison and classification. Upstream
acquisition, real integrations, patch application, report metadata generation,
GitHub Issue rendering, and Issue mutation remain separate later stages.

## License

MIT

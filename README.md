# Claude Code Prompt Drift

> I wake up. There is another Claude Code update.

Claude Code Prompt Drift is a personal CI watcher for detecting changes in an
upstream prompt inventory and deciding whether frozen customizations are still
safe to reapply.

This repository starts with a deliberately public, synthetic contract. It does
not contain genuine Claude Code prompts, copied prompt names, private
customizations, or a working integration with any patching tool.

## What this project is for

The intended workflow is:

1. A user supplies a frozen customization manifest and its local artifacts.
2. A future collector supplies a normalized upstream inventory.
3. A deterministic comparison engine classifies every target and any new
   upstream entries.
4. A report is produced with one of four compatibility states:
   `SAFE_TO_REAPPLY`, `REVIEW_REQUIRED`, `BLOCKED`, or
   `UPSTREAM_NOT_READY`.
5. A future publisher may render that report into a GitHub Issue after an
   explicit review boundary.

Task 001 defines only the public data contracts, fixtures, documentation, and
test foundation. It does not acquire prompts, compare a real corpus, apply
customizations, or mutate Issues.

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
- no GitHub Issue mutation in the contract and fixture layer.

All examples and fixtures use fictional airship-navigation prompts, reserved
`.invalid` sources, and IDs beginning with `fictional.`. Tests enforce this
synthetic-only boundary.

## Repository map

- `docs/architecture.md` — components, trust boundaries, and staged delivery.
- `docs/compatibility-model.md` — statuses, findings, and precedence rules.
- `schemas/frozen-manifest.schema.json` — public manifest contract.
- `schemas/issue-report.schema.json` — future Issue report payload contract.
- `examples/` — fictional prompt artifacts, manifest, and report.
- `fixtures/` — deterministic synthetic comparison cases.
- `src/contracts.mjs` — shared status and finding constants.
- `test/` — contract, fixture, digest, and synthetic-content tests.

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
dependencies at this stage. The lockfile is still committed so CI and local
execution use the same install contract.

## Current scope

Task 001 is the public-contract foundation. The next task should implement a
pure, deterministic comparison/classification engine over the committed
fixtures. Upstream acquisition, real integrations, patch application, and Issue
mutation remain separate later stages.

## License

MIT

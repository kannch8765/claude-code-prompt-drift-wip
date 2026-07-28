import assert from "node:assert/strict";
import test from "node:test";

import { classifyInventory } from "../src/classify-inventory.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

function frozen(overrides) {
  return {
    customizationId: "fictional.default-customization",
    targetId: "fictional.default-target",
    displayName: "Default",
    expectedDigest: digest("a"),
    aliases: [],
    ...overrides,
  };
}

function upstream(overrides) {
  return {
    targetId: "fictional.default-upstream",
    displayName: "Default",
    digest: digest("b"),
    aliases: [],
    ...overrides,
  };
}

test("ambiguous candidates cannot be consumed by a later rename", () => {
  const result = classifyInventory({
    upstreamReady: true,
    frozenEntries: [
      frozen({
        customizationId: "fictional.first-customization",
        targetId: "fictional.first-old-target",
        displayName: "Shared",
      }),
      frozen({
        customizationId: "fictional.second-customization",
        targetId: "fictional.second-old-target",
        displayName: "Second",
      }),
    ],
    upstreamEntries: [
      upstream({
        targetId: "fictional.upstream-x",
        displayName: "Shared",
        aliases: ["Second"],
      }),
      upstream({
        targetId: "fictional.upstream-y",
        displayName: "Shared",
      }),
    ],
  });

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.findings.map(({ kind }) => kind), [
    "AMBIGUOUS_MATCH",
    "TARGET_MISSING",
    "NEW_UPSTREAM_PROMPT",
    "NEW_UPSTREAM_PROMPT",
  ]);
  assert.deepEqual(result.findings[0].candidateTargetIds, [
    "fictional.upstream-x",
    "fictional.upstream-y",
  ]);
  assert.equal(result.findings[1].targetId, "fictional.second-old-target");
  assert.deepEqual(result.findings.slice(2).map(({ targetId }) => targetId), [
    "fictional.upstream-x",
    "fictional.upstream-y",
  ]);
  assert.equal(result.summary.findingCounts.POSSIBLE_RENAME, 0);
});

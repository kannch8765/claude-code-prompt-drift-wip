import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ClassificationInputError,
  classifyInventory,
} from "../src/classify-inventory.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (character) => `sha256:${character.repeat(64)}`;
const frozen = (overrides = {}) => ({
  customizationId: "fictional.weathered-compass.extra-caution",
  targetId: "fictional.weathered-compass",
  displayName: "Weathered Compass",
  expectedDigest: digest("a"),
  aliases: ["Old Brass Compass"],
  ...overrides,
});
const upstream = (overrides = {}) => ({
  targetId: "fictional.weathered-compass",
  displayName: "Weathered Compass",
  digest: digest("a"),
  aliases: [],
  ...overrides,
});

function classify(frozenEntries, upstreamEntries, upstreamReady = true) {
  return classifyInventory({ upstreamReady, frozenEntries, upstreamEntries });
}

function projectExpected(actual, expected) {
  return Object.fromEntries(Object.keys(expected).map((key) => [key, actual[key]]));
}

function assertInputError(fn, code, path) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ClassificationInputError);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    return true;
  });
}

test("all committed fixtures are executable acceptance tests", async (t) => {
  const files = (await readdir(join(root, "fixtures")))
    .filter((file) => file.endsWith(".json"))
    .sort();

  for (const file of files) {
    await t.test(file, async () => {
      const fixture = JSON.parse(
        await readFile(join(root, "fixtures", file), "utf8"),
      );
      const result = classifyInventory({
        upstreamReady: fixture.upstreamReady,
        frozenEntries: fixture.frozen,
        upstreamEntries: fixture.upstream,
      });

      assert.equal(result.status, fixture.expected.status);
      assert.equal(result.findings.length, fixture.expected.findings.length);
      assert.deepEqual(
        result.findings.map(({ kind }) => kind),
        fixture.expected.findings.map(({ kind }) => kind),
      );

      for (let index = 0; index < fixture.expected.findings.length; index += 1) {
        assert.deepEqual(
          projectExpected(result.findings[index], fixture.expected.findings[index]),
          fixture.expected.findings[index],
        );
      }

      assert.equal(result.summary.frozenTargets, fixture.frozen.length);
      assert.equal(result.summary.upstreamTargets, fixture.upstream.length);
      assert.equal(
        Object.values(result.summary.findingCounts).reduce(
          (total, count) => total + count,
          0,
        ),
        result.findings.length,
      );
    });
  }
});

test("exact target ID wins over display name and alias candidates", () => {
  const result = classify(
    [frozen()],
    [
      upstream({ digest: digest("b") }),
      upstream({
        targetId: "fictional.rename-decoy",
        displayName: "Weathered Compass",
        digest: digest("c"),
      }),
    ],
  );

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.findings.map(({ kind }) => kind), [
    "TARGET_CHANGED",
    "NEW_UPSTREAM_PROMPT",
  ]);
  assert.equal(result.findings[0].actualDigest, digest("b"));
  assert.equal(result.findings[1].targetId, "fictional.rename-decoy");
});

test("changed exact target cannot be reclassified as a rename", () => {
  const result = classify(
    [frozen()],
    [
      upstream({ digest: digest("b") }),
      upstream({
        targetId: "fictional.alias-decoy",
        displayName: "Alias Decoy",
        digest: digest("c"),
        aliases: ["Old Brass Compass"],
      }),
    ],
  );

  assert.equal(result.findings[0].kind, "TARGET_CHANGED");
  assert.equal(result.findings[0].targetId, "fictional.weathered-compass");
});

test("a unique rename candidate is consumed and not reported as new", () => {
  const result = classify(
    [frozen()],
    [
      upstream({
        targetId: "fictional.larkspur-compass",
        displayName: "Larkspur Compass",
        digest: digest("b"),
        aliases: ["Weathered Compass"],
      }),
    ],
  );

  assert.deepEqual(result.findings.map(({ kind }) => kind), ["POSSIBLE_RENAME"]);
  assert.deepEqual(result.findings[0].candidateTargetIds, [
    "fictional.larkspur-compass",
  ]);
  assert.equal(result.summary.findingCounts.NEW_UPSTREAM_PROMPT, 0);
});

test("ambiguous candidates remain unconsumed and are reported as new", () => {
  const result = classify(
    [frozen()],
    [
      upstream({
        targetId: "fictional.north-compass",
        aliases: ["Weathered Compass"],
      }),
      upstream({
        targetId: "fictional.south-compass",
        aliases: ["Weathered Compass"],
      }),
    ],
  );

  assert.deepEqual(result.findings.map(({ kind }) => kind), [
    "AMBIGUOUS_MATCH",
    "NEW_UPSTREAM_PROMPT",
    "NEW_UPSTREAM_PROMPT",
  ]);
  assert.deepEqual(result.findings[0].candidateTargetIds, [
    "fictional.north-compass",
    "fictional.south-compass",
  ]);
  assert.deepEqual(result.findings.slice(1).map(({ targetId }) => targetId), [
    "fictional.north-compass",
    "fictional.south-compass",
  ]);
});

test("multiple frozen and upstream entries preserve input order", () => {
  const result = classify(
    [
      frozen(),
      frozen({
        customizationId: "fictional.cloud-bell.quiet",
        targetId: "fictional.cloud-bell",
        displayName: "Cloud Bell",
        aliases: [],
        expectedDigest: digest("c"),
      }),
    ],
    [
      upstream(),
      upstream({
        targetId: "fictional.cloud-bell",
        displayName: "Cloud Bell",
        digest: digest("d"),
      }),
      upstream({
        targetId: "fictional.moon-sail",
        displayName: "Moon Sail",
        digest: digest("e"),
      }),
    ],
  );

  assert.deepEqual(result.findings.map(({ kind }) => kind), [
    "UNCHANGED",
    "TARGET_CHANGED",
    "NEW_UPSTREAM_PROMPT",
  ]);
  assert.deepEqual(result.findings.map(({ targetId }) => targetId), [
    "fictional.weathered-compass",
    "fictional.cloud-bell",
    "fictional.moon-sail",
  ]);
});

test("matching uses NFKC, trim, case folding, and collapsed whitespace", () => {
  const result = classify(
    [
      frozen({
        targetId: "fictional.old-id",
        displayName: "  ＷＥＡＴＨＥＲＥＤ\t\n Compass  ",
        aliases: [],
      }),
    ],
    [
      upstream({
        targetId: "fictional.new-id",
        displayName: "weathered compass",
      }),
    ],
  );

  assert.equal(result.findings[0].kind, "POSSIBLE_RENAME");
});

test("classification leaves caller input deeply unchanged", () => {
  const input = {
    upstreamReady: true,
    frozenEntries: [frozen()],
    upstreamEntries: [upstream()],
  };
  const before = structuredClone(input);

  classifyInventory(input);

  assert.deepEqual(input, before);
});

test("duplicate customization IDs fail closed", () => {
  assertInputError(
    () => classify([frozen(), frozen({ targetId: "fictional.other" })], []),
    "DUPLICATE_CUSTOMIZATION_ID",
    "frozenEntries[1].customizationId",
  );
});

test("duplicate frozen target IDs fail closed", () => {
  assertInputError(
    () =>
      classify(
        [
          frozen(),
          frozen({ customizationId: "fictional.other-customization" }),
        ],
        [],
      ),
    "DUPLICATE_FROZEN_TARGET_ID",
    "frozenEntries[1].targetId",
  );
});

test("duplicate upstream target IDs fail closed", () => {
  assertInputError(
    () => classify([], [upstream(), upstream()]),
    "DUPLICATE_UPSTREAM_TARGET_ID",
    "upstreamEntries[1].targetId",
  );
});

test("malformed digests fail closed", async (t) => {
  await t.test("frozen digest", () => {
    assertInputError(
      () => classify([frozen({ expectedDigest: "sha256:ABC" })], []),
      "INVALID_DIGEST",
      "frozenEntries[0].expectedDigest",
    );
  });
  await t.test("upstream digest", () => {
    assertInputError(
      () => classify([], [upstream({ digest: "not-a-digest" })]),
      "INVALID_DIGEST",
      "upstreamEntries[0].digest",
    );
  });
});

test("malformed required fields and types cannot produce SAFE_TO_REAPPLY", async (t) => {
  await t.test("missing field", () => {
    const entry = frozen();
    delete entry.displayName;
    assertInputError(
      () => classify([entry], []),
      "MISSING_FIELD",
      "frozenEntries[0].displayName",
    );
  });
  await t.test("illegal array type", () => {
    assertInputError(
      () =>
        classifyInventory({
          upstreamReady: true,
          frozenEntries: {},
          upstreamEntries: [],
        }),
      "INVALID_TYPE",
      "input.frozenEntries",
    );
  });
});

test("upstream-not-ready short-circuits comparison findings", () => {
  const result = classify(
    [frozen()],
    [upstream({ digest: digest("b") })],
    false,
  );

  assert.equal(result.status, "UPSTREAM_NOT_READY");
  assert.deepEqual(result.findings.map(({ kind }) => kind), [
    "UPSTREAM_NOT_READY",
  ]);
});

test("repeated invocation returns deep-equal results", () => {
  const input = {
    upstreamReady: true,
    frozenEntries: [frozen()],
    upstreamEntries: [upstream()],
  };

  assert.deepEqual(classifyInventory(input), classifyInventory(input));
});

test("result ignores property insertion order and hidden locale or time state", () => {
  const first = {
    upstreamReady: true,
    frozenEntries: [frozen()],
    upstreamEntries: [upstream()],
  };
  const second = {
    upstreamEntries: [
      {
        aliases: [],
        digest: digest("a"),
        displayName: "Weathered Compass",
        targetId: "fictional.weathered-compass",
      },
    ],
    frozenEntries: [
      {
        aliases: ["Old Brass Compass"],
        expectedDigest: digest("a"),
        displayName: "Weathered Compass",
        targetId: "fictional.weathered-compass",
        customizationId: "fictional.weathered-compass.extra-caution",
      },
    ],
    upstreamReady: true,
  };
  const originalDateNow = Date.now;
  const originalLocaleLowerCase = String.prototype.toLocaleLowerCase;
  Date.now = () => {
    throw new Error("time access is forbidden");
  };
  String.prototype.toLocaleLowerCase = () => {
    throw new Error("locale access is forbidden");
  };

  try {
    assert.deepEqual(classifyInventory(first), classifyInventory(second));
  } finally {
    Date.now = originalDateNow;
    String.prototype.toLocaleLowerCase = originalLocaleLowerCase;
  }
});

test("a consumed rename candidate cannot satisfy a later frozen target", () => {
  const result = classify(
    [
      frozen({ targetId: "fictional.old-one", displayName: "Shared Name" }),
      frozen({
        customizationId: "fictional.second-customization",
        targetId: "fictional.old-two",
        displayName: "Shared Name",
      }),
    ],
    [
      upstream({
        targetId: "fictional.new-one",
        displayName: "Shared Name",
      }),
    ],
  );

  assert.deepEqual(result.findings.map(({ kind }) => kind), [
    "POSSIBLE_RENAME",
    "TARGET_MISSING",
  ]);
});

import { assert, describe, it } from "@effect/vitest";
import fixture from "./SymphonyTriage.fixture.json" with { type: "json" };
import { liveClaims, triageContext, classify, pathsOverlap } from "./SymphonyTriage.ts";

describe("frozen Symphony claim tenure and triage compatibility", () => {
  it.each(fixture.claimCases)("$name", (c) =>
    assert.deepEqual(liveClaims(c.events, c.now), c.expected),
  );
  it("builds the principal's complete context from claims and explicit graphs/aliases", () =>
    assert.deepEqual(triageContext(fixture.context.input), fixture.context.expected));
  it.each(fixture.classifications)("$name", (c) =>
    assert.deepEqual(classify(c.event, fixture.context.expected), c.expected),
  );
  it.each(fixture.paths)("path boundary $a / $b", (c) =>
    assert.equal(pathsOverlap(c.a, c.b), c.expected),
  );
  it("resolves principal metadata independently of an opaque participant address", () => {
    const context = triageContext({ ...fixture.context.input, target: "t3:fixture-participant" });
    assert.deepEqual(context.issues, fixture.context.expected.issues);
    assert.deepEqual(context.paths, fixture.context.expected.paths);
    assert.equal(context.principal, "alice");
  });
});

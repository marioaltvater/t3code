import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { CodexSettings } from "@t3tools/contracts";

import {
  applyPreferredCodexDefaultModel,
  checkCodexProviderStatus,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("ranks qualified Codex models while preserving their wire ids", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "openai.gpt-5.6-luna",
      name: "Luna",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "openai.gpt-5.6-sol", name: "Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["openai.gpt-5.6-sol"],
  );
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

const decodeCodexSettings = Schema.decodeEffect(CodexSettings);

it.live.each([
  { label: "external auth", account: null },
  { label: "omitted account", account: undefined },
  { label: "API key", account: { type: "apiKey" } },
  { label: "Bedrock", account: { type: "amazonBedrock" } },
  { label: "ChatGPT", account: { type: "chatgpt", email: "test@example.com", planType: "pro" } },
] as const)("probes subscription usage only for ChatGPT: $label", ({ account }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const binaryPath = `${directory}/codex.mjs`;
    const callsPath = `${directory}/calls.jsonl`;
    yield* fs.writeFileString(
      binaryPath,
      `#!/usr/bin/env node
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
createInterface({ input: process.stdin }).on("line", line => {
  const { id, method } = JSON.parse(line);
  appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(method) + "\\n");
  if (id === undefined) return;
  const result = method === "initialize"
    ? { userAgent: "test/0.164.0", codexHome: ${JSON.stringify(directory)}, platformFamily: "unix", platformOs: "linux" }
    : method === "account/read"
      ? { account: ${JSON.stringify(account)}, requiresOpenaiAuth: ${account != null} }
      : method === "model/list" ? { data: [], nextCursor: null }
      : method === "skills/list" ? { data: [] }
      : method === "config/read" ? { config: {} }
      : undefined;
  process.stdout.write(JSON.stringify(result === undefined
    ? { id, error: { code: -32600, message: "account authentication required to read rate limits" } }
    : { id, result }) + "\\n");
});
`,
    );
    yield* fs.writeFileString(
      `${directory}/models_cache.json`,
      JSON.stringify({ fetched_at: "9999-01-01T00:00:00.000Z" }),
    );
    yield* fs.chmod(binaryPath, 0o755);
    const settings = yield* decodeCodexSettings({ binaryPath, homePath: directory });
    const status = yield* checkCodexProviderStatus(settings);
    assert.strictEqual(status.status, "ready");
    const calls = (yield* fs.readFileString(callsPath))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.include(calls, "model/list");
    if (account?.type === "chatgpt") {
      assert.include(calls, "account/rateLimits/read");
      assert.deepStrictEqual(status.usageLimits?.unavailable, {
        reason: "probeFailed",
        message: "Codex could not read usage (JSON-RPC -32600).",
      });
    } else {
      assert.notInclude(calls, "account/rateLimits/read");
      assert.deepStrictEqual(status.usageLimits?.unavailable, { reason: "unsupported" });
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

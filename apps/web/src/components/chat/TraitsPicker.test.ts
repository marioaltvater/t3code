import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { buildTraitsTriggerDisplay } from "@t3tools/client-runtime/model-traits";
import { expect, it } from "vite-plus/test";
import { getReasoningTraitSnapshot, getReasoningTraitStep } from "./TraitsPicker";

it("changes the agent's declared reasoning control without changing its session mode", () => {
  const descriptors = [
    {
      id: "mode",
      label: "Session mode",
      type: "select" as const,
      currentValue: "code",
      options: [
        { id: "code", label: "Code" },
        { id: "plan", label: "Plan" },
      ],
    },
    {
      id: "thought_level",
      role: "reasoning" as const,
      label: "Thinking",
      type: "select" as const,
      currentValue: "medium",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
    },
  ];
  const input = {
    provider: ProviderDriverKind.make("acpRegistry"),
    instanceId: ProviderInstanceId.make("devin"),
    model: "fusion",
    models: [
      {
        slug: "fusion",
        name: "Fusion",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: descriptors }),
      },
    ],
    modelOptions: [
      { id: "mode", value: "code" },
      { id: "thought_level", value: "medium" },
    ],
    reportedModelSelection: null,
    prompt: "Explain the change",
    planModeEnabled: true,
  };
  expect(getReasoningTraitStep({ ...input, direction: 1 })).toEqual({
    prompt: input.prompt,
    modelOptions: [
      { id: "mode", value: "code" },
      { id: "thought_level", value: "high" },
    ],
  });
  expect(getReasoningTraitSnapshot(input)).toEqual({
    effortIndex: 1,
    effortCount: 3,
    canLowerEffort: true,
    canRaiseEffort: true,
  });
  expect(
    buildTraitsTriggerDisplay({
      provider: input.provider,
      descriptors,
      primarySelectDescriptorId: "mode",
      ultrathinkPromptControlled: false,
      modelSelection: null,
      reportedModelSelection: null,
    }).otherLabels,
  ).toEqual(["Code"]);
});

it("does not offer a prompt-only reasoning level through controller stepping", () => {
  const input = {
    provider: ProviderDriverKind.make("claudeAgentSdk"),
    instanceId: ProviderInstanceId.make("claude"),
    model: "claude-opus-5-5",
    models: [
      {
        slug: "claude-opus-5-5",
        name: "Opus",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "effort",
              label: "Effort",
              type: "select",
              currentValue: "high",
              options: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
                { id: "ultrathink", label: "Ultrathink" },
              ],
              promptInjectedValues: ["ultrathink"],
            },
          ],
        }),
      },
    ],
    modelOptions: [{ id: "effort", value: "high" }],
    reportedModelSelection: null,
    prompt: "Explain the change",
    planModeEnabled: true,
  };
  expect(getReasoningTraitStep({ ...input, direction: 1 })).toBeNull();
  expect(getReasoningTraitSnapshot(input)).toEqual({
    effortIndex: 1,
    effortCount: 2,
    canLowerEffort: true,
    canRaiseEffort: false,
  });
});

it.each([{ levels: ["low", "medium", "high", "xhigh", "max", "ultracode"] }, { levels: ["high"] }])(
  "lowers typed Ultrathink to the preceding selectable level: $levels",
  ({ levels }) => {
    const input = {
      provider: ProviderDriverKind.make("claudeAgentSdk"),
      instanceId: ProviderInstanceId.make("claude"),
      model: "claude-opus-5-5",
      models: [
        {
          slug: "claude-opus-5-5",
          name: "Opus",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select",
                currentValue: "high",
                options: [...levels, "ultrathink"].map((id) => ({ id, label: id })),
                promptInjectedValues: ["ultrathink"],
              },
            ],
          }),
        },
      ],
      modelOptions: [{ id: "effort", value: "high" }],
      reportedModelSelection: null,
      prompt: "Ultrathink:\nExplain the change",
      planModeEnabled: true,
    };
    expect(getReasoningTraitStep({ ...input, direction: -1 })).toEqual({
      prompt: "Explain the change",
      modelOptions: [{ id: "effort", value: levels.at(-1) }],
    });
    expect(getReasoningTraitSnapshot(input)).toEqual({
      effortIndex: levels.length,
      effortCount: levels.length + 1,
      canLowerEffort: true,
      canRaiseEffort: false,
    });
    expect(getReasoningTraitStep({ ...input, direction: 1 })).toBeNull();
  },
);

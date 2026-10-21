import { describe, expect, it } from "vite-plus/test";
import { appendDictationText, resolveDictationTarget } from "./ControllerCoordinator.logic";

describe("appendDictationText", () => {
  it("appends a transcript without replacing existing composer content", () => {
    expect(appendDictationText("existing **rich text**", "  new words  ")).toBe(
      "existing **rich text**\nnew words",
    );
  });

  it("returns null for an empty transcript", () => {
    expect(appendDictationText("keep this", "  ")).toBeNull();
  });

  it("appends into an existing thread whose composer has no stored draft", () => {
    expect(appendDictationText("", "spoken words")).toBe("spoken words");
  });
});

describe("resolveDictationTarget", () => {
  const originalRef = { environmentId: "env-a", threadId: "thread-a" };

  it("retains the press-time scoped target while transcription is in flight", () => {
    const pressedTarget = { draftId: "draft-a", originalRef };
    const routeAfterTranscriptionStarts = { environmentId: "env-b", threadId: "thread-b" };
    expect(
      resolveDictationTarget({
        ...pressedTarget,
        currentSession: { ...originalRef },
        canonicalThreadExists: false,
      }),
    ).toBe("draft-a");
    expect(routeAfterTranscriptionStarts).not.toEqual(originalRef);
  });

  it("rejects a draft session retargeted to another environment or thread", () => {
    expect(
      resolveDictationTarget({
        draftId: "draft-a",
        originalRef,
        currentSession: { environmentId: "env-b", threadId: "thread-b" },
        canonicalThreadExists: false,
      }),
    ).toBeNull();
  });

  it("delivers to the captured canonical thread after promotion removes the draft session", () => {
    expect(
      resolveDictationTarget({
        draftId: "draft-a",
        originalRef,
        currentSession: null,
        canonicalThreadExists: true,
      }),
    ).toEqual(originalRef);
  });

  it("rejects delivery after draft cleanup when no canonical thread exists", () => {
    expect(
      resolveDictationTarget({
        draftId: "draft-a",
        originalRef,
        currentSession: null,
        canonicalThreadExists: false,
      }),
    ).toBeNull();
  });
});

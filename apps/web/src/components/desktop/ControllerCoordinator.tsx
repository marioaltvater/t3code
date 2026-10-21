import { useEffect, useLayoutEffect, useRef } from "react";
import type { DesktopControllerEvent, ScopedThreadRef } from "@t3tools/contracts";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import {
  useComposerDraftStore,
  type ComposerThreadTarget,
  type DraftId,
} from "../../composerDraftStore";
import { readThreadShell } from "../../state/entities";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { appendDictationText, resolveDictationTarget } from "./ControllerCoordinator.logic";

type CaptureTarget =
  | { readonly draftId: DraftId; readonly originalRef: ScopedThreadRef }
  | ScopedThreadRef;
type ControllerBridge = {
  acknowledgeDictation: (captureId: string) => Promise<void>;
  setReady: (ready: boolean) => Promise<void>;
  acceptDictation: (captureId: string) => Promise<void>;
  cancelDictation: (captureId: string) => Promise<void>;
  onEvent: (listener: (event: DesktopControllerEvent) => void) => () => void;
};

const MAX_PENDING_CAPTURES = 16;

function isDraftCaptureTarget(
  target: CaptureTarget,
): target is Extract<CaptureTarget, { draftId: DraftId }> {
  return "draftId" in target;
}

function reportControllerError(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "Try again.",
    }),
  );
}

function existingTarget(target: CaptureTarget): CaptureTarget | null {
  const store = useComposerDraftStore.getState();
  if (!isDraftCaptureTarget(target)) {
    return store.getDraftSessionByRef(target) || readThreadShell(target)
      ? (target as ScopedThreadRef)
      : null;
  }
  const session = store.getDraftSession(target.draftId);
  const resolved = resolveDictationTarget({
    draftId: target.draftId,
    originalRef: target.originalRef,
    currentSession: session,
    canonicalThreadExists: readThreadShell(target.originalRef) !== null,
  });
  if (!resolved) return null;
  return resolved === target.draftId ? target : (resolved as ScopedThreadRef);
}

export function ControllerCoordinator() {
  const { routeDraftId, routeThreadRef } = useHandleNewThread();
  const routeRef = useRef({ routeDraftId, routeThreadRef });
  useLayoutEffect(() => {
    routeRef.current = { routeDraftId, routeThreadRef };
  }, [routeDraftId, routeThreadRef]);

  useEffect(() => {
    // The renderer may be paired with an older desktop build or run on the web.
    const controller = (
      window.desktopBridge as
        | (typeof window.desktopBridge & {
            controller?: ControllerBridge;
          })
        | undefined
    )?.controller;
    if (!controller) return;

    const captures = new Map<string, CaptureTarget>();
    const onEvent = (event: DesktopControllerEvent) => {
      if (event.type === "microphone") {
        if (!event.pressed) return;
        const threadTarget = routeRef.current.routeThreadRef;
        const draftId = routeRef.current.routeDraftId;
        const draftSession =
          !threadTarget && draftId
            ? useComposerDraftStore.getState().getDraftSession(draftId)
            : null;
        const pinnedTarget: CaptureTarget | null = threadTarget
          ? existingTarget(threadTarget)
          : draftId && draftSession
            ? {
                draftId,
                originalRef: {
                  environmentId: draftSession.environmentId,
                  threadId: draftSession.threadId,
                } as ScopedThreadRef,
              }
            : null;
        if (!pinnedTarget) {
          void controller.cancelDictation(event.captureId).catch(() => {});
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Dictation could not start",
              description: "Open a thread or draft before using the controller microphone.",
            }),
          );
          return;
        }
        if (captures.size >= MAX_PENDING_CAPTURES) {
          const oldestCapture = captures.keys().next().value;
          if (oldestCapture !== undefined) captures.delete(oldestCapture);
        }
        captures.set(event.captureId, pinnedTarget);
        void controller.acceptDictation(event.captureId).catch((error: unknown) => {
          if (captures.delete(event.captureId)) {
            reportControllerError("Dictation could not start", error);
          }
        });
        return;
      }

      const target = captures.get(event.captureId);
      captures.delete(event.captureId);
      if (event.type === "error") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Dictation failed",
            description: event.message,
          }),
        );
        return;
      }
      if (!target) return;
      const resolvedTarget = existingTarget(target);
      if (!resolvedTarget) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Dictation could not be delivered",
            description: "The original thread or draft is no longer available.",
          }),
        );
        return;
      }
      const destination: ComposerThreadTarget = isDraftCaptureTarget(resolvedTarget)
        ? resolvedTarget.draftId
        : resolvedTarget;
      const store = useComposerDraftStore.getState();
      const draft = store.getComposerDraft(destination);
      const nextPrompt = appendDictationText(draft?.prompt ?? "", event.text);
      if (nextPrompt === null) {
        reportControllerError(
          "Dictation could not be delivered",
          new Error("No speech was recognized. The recording is still available for recovery."),
        );
        return;
      }
      store.setPrompt(destination, nextPrompt);
      void controller.acknowledgeDictation(event.captureId).catch((error: unknown) => {
        reportControllerError("Dictation recording could not be removed", error);
      });
    };

    const unsubscribe = controller.onEvent(onEvent);
    void controller.setReady(true).catch((error: unknown) => {
      reportControllerError("Controller is unavailable", error);
    });
    return () => {
      unsubscribe();
      captures.clear();
      void controller.setReady(false).catch(() => {});
    };
  }, []);

  return null;
}

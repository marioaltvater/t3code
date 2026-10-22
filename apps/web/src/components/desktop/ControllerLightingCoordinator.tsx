import { useEffect, useState } from "react";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useEnvironments } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useUiStateStore } from "../../uiStateStore";
import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import {
  createControllerLightingFrame,
  controllerWorkingPulseIntensity,
  resolveControllerThreadLightState,
} from "./ControllerLightingCoordinator.logic";
import { useControllerUiSnapshot, type ControllerThreadRef } from "./controllerUiState";

export function ControllerLightingCoordinator({
  activeThreads,
}: {
  readonly activeThreads: readonly ControllerThreadRef[];
}) {
  const threads = useThreadShells();
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const { presentationById } = useEnvironments();
  const { routeThreadRef } = useHandleNewThread();
  const ui = useControllerUiSnapshot();
  const [pulseTime, setPulseTime] = useState(() => Date.now());
  const nowMs = new Date().getTime();
  const now = new Date(nowMs).toISOString();
  const pinStates = activeThreads.slice(0, 6).map((ref) => {
    const thread = threads.find(
      (candidate) => candidate.environmentId === ref.environmentId && candidate.id === ref.threadId,
    );
    if (!thread || thread.archivedAt !== null) return null;
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localVisits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
    );
    const wokeAt = threadWokeAt(thread, { now });
    const isWoke =
      wokeAt !== null &&
      Number.isFinite(Date.parse(wokeAt)) &&
      (lastVisitedAt === undefined ||
        !Number.isFinite(Date.parse(lastVisitedAt)) ||
        Date.parse(lastVisitedAt) < Date.parse(wokeAt)) &&
      thread.settledOverride !== "settled";
    return {
      state: resolveControllerThreadLightState(
        thread,
        presentationById.get(thread.environmentId)?.connection.phase === "connected",
        { isUnread: hasUnseenCompletion({ ...thread, lastVisitedAt }), isWoke },
      ),
      selected:
        routeThreadRef?.environmentId === thread.environmentId &&
        routeThreadRef.threadId === thread.id,
    };
  });
  const hasWorkingPin = pinStates.some((pin) => pin?.state === "working");
  useEffect(() => {
    if (!hasWorkingPin || !window.desktopBridge?.controller?.setLighting) return;
    const timer = window.setInterval(() => setPulseTime(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, [hasWorkingPin]);
  const frame = createControllerLightingFrame({
    pins: pinStates,
    workingPulseIntensity: controllerWorkingPulseIntensity(pulseTime),
    secondary: ui.secondary,
  });
  const frameKey = frame.join(",");

  useEffect(() => {
    const bridge = window.desktopBridge?.controller;
    if (!bridge?.setLighting) return;
    void bridge.setLighting(frameKey.split(",").map(Number)).catch(() => {});
  }, [frameKey]);

  return null;
}

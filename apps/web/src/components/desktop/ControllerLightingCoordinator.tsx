import { useEffect, useState } from "react";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useEnvironments } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useUiStateStore } from "../../uiStateStore";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import {
  filterSidebarV2VisibleThreads,
  hasUnseenCompletion,
  resolveThreadLastVisitedAt,
  resolveSidebarThreadSection,
  sortPinnedThreadsForSidebar,
} from "../Sidebar.logic";
import {
  createControllerLightingFrame,
  controllerWorkingPulseIntensity,
  controllerSnoozeWakeDelay,
  resolveControllerThreadLightState,
} from "./ControllerLightingCoordinator.logic";
import { useControllerUiSnapshot } from "./controllerUiState";

export function ControllerLightingCoordinator() {
  const threads = useThreadShells();
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const { presentationById } = useEnvironments();
  const { routeThreadRef } = useHandleNewThread();
  const ui = useControllerUiSnapshot();
  const [wakeTick, bumpWakeTick] = useState(0);
  const [pulseTime, setPulseTime] = useState(() => Date.now());
  const nowMs = new Date().getTime();
  const now = new Date(nowMs).toISOString();
  const wakeDelay = ui.pinnedThreads === null ? controllerSnoozeWakeDelay(threads, nowMs) : null;
  useEffect(() => {
    if (wakeDelay === null) return;
    const timer = window.setTimeout(() => bumpWakeTick(wakeTick + 1), wakeDelay);
    return () => window.clearTimeout(timer);
  }, [wakeDelay, wakeTick]);
  const fallbackPins = sortPinnedThreadsForSidebar(
    filterSidebarV2VisibleThreads(threads, null).filter((thread) => {
      const capabilities = presentationById.get(thread.environmentId)?.serverConfig?.environment
        ?.capabilities;
      return (
        resolveSidebarThreadSection({
          snoozed: capabilities?.threadSnooze === true && effectiveSnoozed(thread, { now }),
          settled: capabilities?.threadSettlement === true && thread.settledOverride === "settled",
          pinned: thread.pinnedAt != null,
        }) === "pinned"
      );
    }),
  );
  const pins =
    ui.pinnedThreads ??
    fallbackPins.slice(0, 6).map(({ environmentId, id }) => ({ environmentId, threadId: id }));
  const pinStates = pins.slice(0, 6).flatMap((ref) => {
    const thread = threads.find(
      (candidate) => candidate.environmentId === ref.environmentId && candidate.id === ref.threadId,
    );
    if (!thread) return [];
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
    return [
      {
        state: resolveControllerThreadLightState(
          thread,
          presentationById.get(thread.environmentId)?.connection.phase === "connected",
          { isUnread: hasUnseenCompletion({ ...thread, lastVisitedAt }), isWoke },
        ),
        selected:
          routeThreadRef?.environmentId === thread.environmentId &&
          routeThreadRef.threadId === thread.id,
      },
    ];
  });
  const hasWorkingPin = pinStates.some((pin) => pin.state === "working");
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

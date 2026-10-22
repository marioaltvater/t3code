import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isElectron } from "../../env";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { useClientSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { resolveShortcutCommand } from "../../keybindings";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { useThreadShells } from "../../state/entities";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { partitionSidebarThreads } from "../Sidebar.threadPartition";
import { ControllerLightingCoordinator } from "./ControllerLightingCoordinator";
import { controllerSnoozeWakeDelay } from "./ControllerLightingCoordinator.logic";
import { useControllerUiSnapshot } from "./controllerUiState";
import {
  controllerThreadSlotFromCommand,
  controllerThreadTargetFromCommand,
  resolveControllerThreadTargets,
} from "./controllerThreadTargets";

export function ControllerThreadCoordinator() {
  const threads = useThreadShells();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const workingShelfEnabled = useClientSettings((settings) => settings.sidebarWorkingShelfEnabled);
  const pinnedSections = useUiStateStore((state) => state.sidebarPinnedSections);
  const ui = useControllerUiSnapshot();
  const navigate = useNavigate();
  const [wakeTick, bumpWakeTick] = useState(0);
  const wakeDelay =
    ui.threadTargets === null ? controllerSnoozeWakeDelay(threads, new Date().getTime()) : null;
  useEffect(() => {
    if (wakeDelay === null) return;
    const timer = window.setTimeout(() => bumpWakeTick(wakeTick + 1), wakeDelay);
    return () => window.clearTimeout(timer);
  }, [wakeDelay, wakeTick]);
  const targets =
    ui.threadTargets ??
    resolveControllerThreadTargets({
      ...partitionSidebarThreads({
        threads,
        scopedProjectKeys: null,
        serverConfigs: configs,
        optimisticDrop: null,
        workingShelfEnabled,
      }),
      pinnedSections,
    });
  const onAction = useStableCallback((action: string) => {
    const target = controllerThreadTargetFromCommand(action, targets);
    if (!target) return;
    // A removed shell leaves a vacant slot until the sidebar publishes its next order.
    const thread = threads.find(
      (thread) =>
        thread.environmentId === target.environmentId &&
        thread.id === target.threadId &&
        thread.archivedAt === null,
    );
    if (!thread) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  });
  const onKeyDown = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen())
      return;
    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: {
        terminalFocus: isTerminalFocused(),
        terminalOpen: ui.secondary.terminalOpen,
        modelPickerOpen: false,
        isWeb: !isElectron,
        isDesktop: isElectron,
      },
    });
    if (!command || controllerThreadSlotFromCommand(command) === null) return;
    event.preventDefault();
    event.stopPropagation();
    onAction(command);
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    const unsubscribe = window.desktopBridge?.onMenuAction(onAction);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [onAction, onKeyDown]);
  return <ControllerLightingCoordinator activeThreads={targets.activeThreads} />;
}

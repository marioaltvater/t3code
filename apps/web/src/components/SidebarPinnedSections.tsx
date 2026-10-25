import { useEffect, useId, useState } from "react";
import { EllipsisIcon } from "lucide-react";
import { create } from "zustand";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  MAX_SIDEBAR_PINNED_SECTIONS,
  MAX_SIDEBAR_SECTION_NAME_LENGTH,
  useUiStateStore,
  type SidebarPinnedSection,
} from "../uiStateStore";
import { readLocalApi } from "../localApi";
import { readThreadShell } from "../state/entities";
import { useThreadActions } from "../hooks/useThreadActions";
import { getClientSettings } from "../hooks/useSettings";
import type { ThreadActionMenuId } from "./threadActionMenu.logic";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CollapsibleSectionHeader } from "./ui/collapsible-section-header";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";
import { toastManager } from "./ui/toast";

type SectionRequest = { sectionId: string | null; resolve: (id: string | null) => void };
const useSectionRequest = create<{ request: SectionRequest | null }>(() => ({ request: null }));

export function requestPinnedSection(sectionId: string | null = null): Promise<string | null> {
  useSectionRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useSectionRequest.setState({ request: { sectionId, resolve } }));
}
function finishSectionRequest(id: string | null) {
  const { request } = useSectionRequest.getState();
  useSectionRequest.setState({ request: null });
  request?.resolve(id);
}

export function pinnedSectionMenuItems(
  threadKeys: readonly string[],
): ContextMenuItem<ThreadActionMenuId>[] {
  if (getClientSettings().legacySidebarEnabled) return [];
  const sections = useUiStateStore.getState().sidebarPinnedSections;
  const current = sections.find((section) =>
    threadKeys.every((key) => section.threadKeys.includes(key)),
  );
  return [
    {
      id: "pinned-section",
      label: "Move to pinned section",
      children: [
        { id: "pinned-section:move:default", label: "Pinned", checked: current == null },
        ...sections.map((section) => ({
          id: `pinned-section:move:${section.id}` as const,
          label: section.name,
          checked: current?.id === section.id,
        })),
        {
          id: "pinned-section:new",
          label: "New section…",
          separatorBefore: true,
          disabled: sections.length >= MAX_SIDEBAR_PINNED_SECTIONS,
        },
      ],
    },
  ];
}

export function usePinnedSectionActions() {
  const { pinThread } = useThreadActions();
  return async (action: string, threadRefs: readonly ScopedThreadRef[]): Promise<boolean> => {
    if (!action.startsWith("pinned-section:")) return false;
    const sectionId =
      action === "pinned-section:new"
        ? await requestPinnedSection()
        : action.slice("pinned-section:move:".length);
    if (sectionId === null) return true;
    if (
      sectionId !== "default" &&
      !useUiStateStore.getState().sidebarPinnedSections.some((section) => section.id === sectionId)
    )
      return true;
    for (const ref of threadRefs) {
      const thread = readThreadShell(ref);
      if (!thread) continue;
      if (
        thread.pinnedAt == null ||
        thread.settledOverride === "settled" ||
        thread.snoozedUntil != null
      ) {
        const result = await pinThread(ref);
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result))
            toastManager.add({
              type: "error",
              title: "Could not move thread",
              description: String(squashAtomCommandFailure(result)),
            });
          continue;
        }
      }
      useUiStateStore
        .getState()
        .moveThreadsToPinnedSection(
          [scopedThreadKey(ref)],
          sectionId === "default" ? null : sectionId,
        );
    }
    return true;
  };
}

export function SidebarThreadSectionHeader({
  section = null,
  shelf = "pinned",
  tone = "muted",
  testId,
  count,
  expanded,
  onToggle,
}: {
  section?: SidebarPinnedSection | null;
  shelf?: "pinned" | "active" | "working" | "snoozed" | "settled";
  tone?: "muted" | "info";
  testId?: string;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const toggle = useUiStateStore((state) => state.toggleSidebarPinnedSection);
  const [menuOpen, setMenuOpen] = useState(false);
  const label = section?.name ?? shelf[0]!.toUpperCase() + shelf.slice(1);
  const sectionKey = section ? `pinned-section:${section.id}` : shelf;
  const compact = useUiStateStore((state) => state.sidebarCompactSections[sectionKey] === true);
  const isExpanded = section ? !section.collapsed : (expanded ?? true);
  const openMenu = async (position: { x: number; y: number }) => {
    if (menuOpen) return;
    const api = readLocalApi();
    if (!api) return;
    setMenuOpen(true);
    const state = useUiStateStore.getState();
    const index = state.sidebarPinnedSections.findIndex((entry) => entry.id === section?.id);
    const action = await api.contextMenu
      .show(
        [
          ...(shelf === "pinned"
            ? [
                {
                  id: "new",
                  label: "New section…",
                  disabled: state.sidebarPinnedSections.length >= MAX_SIDEBAR_PINNED_SECTIONS,
                },
              ]
            : []),
          ...(section
            ? [
                { id: "rename", label: "Rename section…" },
                { id: "up", label: "Move section up", disabled: index === 0 },
                {
                  id: "down",
                  label: "Move section down",
                  disabled: index === state.sidebarPinnedSections.length - 1,
                },
                { id: "delete", label: "Delete section", destructive: true },
              ]
            : []),
          {
            id: "display",
            label: "Display",
            separatorBefore: shelf === "pinned",
            children: [
              { id: "display:default", label: "Default", checked: !compact },
              { id: "display:compact", label: "Compact", checked: compact },
            ],
          },
        ],
        position,
      )
      .finally(() => setMenuOpen(false));
    if (action === "display:default" || action === "display:compact")
      useUiStateStore.getState().setSidebarSectionCompact(sectionKey, action === "display:compact");
    else if (action === "new") void requestPinnedSection();
    else if (action === "rename" && section) void requestPinnedSection(section.id);
    else if ((action === "up" || action === "down") && section)
      useUiStateStore.getState().moveSidebarPinnedSection(section.id, action);
    else if (action === "delete" && section)
      useUiStateStore.getState().deleteSidebarPinnedSection(section.id);
  };
  return (
    <div
      className="min-w-0"
      onContextMenu={(event) => {
        event.preventDefault();
        void openMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <CollapsibleSectionHeader
        variant="sidebar"
        expanded={section || onToggle ? isExpanded : menuOpen}
        aria-haspopup={section || onToggle || shelf === "active" ? undefined : "menu"}
        tone={tone}
        data-testid={testId}
        actionOpen={menuOpen}
        onClick={
          shelf === "active"
            ? undefined
            : (event) => {
                if (section) toggle(section.id);
                else if (onToggle) onToggle();
                else {
                  const rect = event.currentTarget.getBoundingClientRect();
                  void openMenu({ x: rect.left, y: rect.bottom });
                }
              }
        }
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Manage ${label}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              void openMenu({ x: rect.left, y: rect.bottom });
            }}
          >
            <EllipsisIcon aria-hidden className="size-4" />
          </Button>
        }
      >
        {label}
        {count === undefined ? null : ` (${count})`}
      </CollapsibleSectionHeader>
    </div>
  );
}

export function PinnedSectionDialogHost() {
  const request = useSectionRequest((state) => state.request);
  useEffect(() => () => finishSectionRequest(null), []);
  return request ? (
    <PinnedSectionDialog key={request.sectionId ?? "new"} sectionId={request.sectionId} />
  ) : null;
}
function PinnedSectionDialog({ sectionId }: { sectionId: string | null }) {
  const id = useId();
  const sections = useUiStateStore((state) => state.sidebarPinnedSections);
  const section = sections.find((entry) => entry.id === sectionId);
  const [name, setName] = useState(section?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finishSectionRequest(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const state = useUiStateStore.getState();
            const result =
              sectionId === null
                ? state.createSidebarPinnedSection(name)
                : state.renameSidebarPinnedSection(sectionId, name)
                  ? sectionId
                  : null;
            if (result === null) {
              setError("Choose a unique section name. You can create up to 20 sections.");
              return;
            }
            finishSectionRequest(result);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {sectionId === null ? "New pinned section" : "Rename section"}
            </DialogTitle>
            <DialogDescription>
              Keep related pinned threads together on this device.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-2">
              <Label htmlFor={id}>Section name</Label>
              <Input
                id={id}
                autoFocus
                value={name}
                maxLength={MAX_SIDEBAR_SECTION_NAME_LENGTH}
                placeholder="Enter a section name"
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                aria-invalid={error !== null}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              {error ? (
                <p id={`${id}-error`} role="alert" className="text-sm text-destructive-foreground">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => finishSectionRequest(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {sectionId === null ? "Create section" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

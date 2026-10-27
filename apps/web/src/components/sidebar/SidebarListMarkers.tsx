import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { SidebarThreadSectionHeader } from "../SidebarPinnedSections";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";

const SIDEBAR_SORTABLE_DRAG_DISABLED = { draggable: true } as const;

export function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-sidebar-marker={props.marker}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

export function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "settled-placeholder";
}) {
  return <SortableSidebarMarker marker={props.marker} className="h-0" />;
}

export function SidebarDragBoundary(props: { marker: "pinned-divider"; count: number }) {
  return (
    <SortableSidebarMarker marker={props.marker} data-testid={`sidebar-${props.marker}`}>
      <SidebarThreadSectionHeader shelf="active" count={props.count} />
    </SortableSidebarMarker>
  );
}

export function SidebarSectionHeader(props: {
  marker: "working-header" | "snoozed-header" | "settled-header";
  count: number;
  className?: string;
  toggle: { expanded: boolean; onToggle: () => void };
  /** The first shelf at the bottom of the list hosts the undo notice just above itself. */
  hostsUndoNotice?: boolean;
}) {
  const shelf =
    props.marker === "working-header"
      ? "working"
      : props.marker === "snoozed-header"
        ? "snoozed"
        : "settled";
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("relative h-8", props.className)}
    >
      {props.hostsUndoNotice ? (
        <SidebarThreadUndoNotice className="absolute inset-x-0 bottom-full bg-sidebar surface-grain" />
      ) : null}
      <SidebarThreadSectionHeader
        shelf={shelf}
        count={props.count}
        onToggle={props.toggle.onToggle}
        expanded={props.toggle.expanded}
        tone={shelf === "working" ? "info" : shelf === "snoozed" ? "plum" : "muted"}
        testId={`sidebar-${shelf}-shelf-toggle`}
      />
    </SortableSidebarMarker>
  );
}

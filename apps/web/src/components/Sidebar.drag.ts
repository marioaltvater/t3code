import {
  closestCenter,
  getClientRect,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";

export function sidebarDragExpansion({
  centerY,
  sourceBounds,
  sourceSection,
  pinnedAreaBottom,
  expanded,
  pinnedExpanded,
}: {
  centerY: number;
  sourceBounds: { top: number; bottom: number } | null;
  sourceSection: string;
  pinnedAreaBottom: number | undefined;
  expanded: boolean;
  pinnedExpanded: boolean;
}) {
  if (!sourceBounds) return { expanded, pinnedExpanded };
  const margin = expanded ? 6 : -6;
  // The retained pickup bounds can extend behind the current pinned targets.
  // Crossing their shared boundary must expand both layouts in the same frame.
  const top =
    sourceSection === "active"
      ? Math.max(sourceBounds.top, pinnedAreaBottom ?? -Infinity)
      : sourceBounds.top;
  const nextExpanded = centerY < top + margin || centerY > sourceBounds.bottom - margin;
  return {
    expanded: nextExpanded,
    pinnedExpanded:
      nextExpanded &&
      pinnedAreaBottom !== undefined &&
      centerY < pinnedAreaBottom + (pinnedExpanded ? 6 : -6),
  };
}

export function sidebarDragTranslation({
  pointerY,
  grabFraction,
  cardHeight,
  bounds,
  originTop,
}: {
  pointerY: number;
  grabFraction: number;
  cardHeight: number;
  bounds: { top: number; height: number };
  originTop: number;
}) {
  const top = Math.max(
    bounds.top,
    Math.min(pointerY - grabFraction * cardHeight, bounds.top + bounds.height - cardHeight),
  );
  // Collision geometry uses a delta; the fixed card retains its viewport origin.
  return top - originTop;
}

export function positionSidebarDragCard(
  node: HTMLElement,
  anchor: { pointerY: number; grabFraction: number; bounds: { top: number; height: number } },
) {
  const card = node.querySelector<HTMLElement>('[role="button"]');
  if (!card) return;
  // Fixed cards use viewport coordinates, independently of dnd-kit's ancestor
  // scroll compensation, which changes when the pointer enters another section.
  const top = sidebarDragTranslation({
    ...anchor,
    cardHeight: card.getBoundingClientRect().height,
    originTop: 0,
  });
  card.style.top = `${top}px`;
}

export function measureSidebarDropTarget(element: HTMLElement) {
  const rect = getClientRect(element, { ignoreTransform: true });
  const list = element.parentElement;
  if (!element.dataset.threadItem || !list || element.offsetParent !== list) return rect;
  const listRect = list.getBoundingClientRect();
  const scaleX = list.offsetWidth ? listRect.width / list.offsetWidth : 1;
  const scaleY = list.offsetHeight ? listRect.height / list.offsetHeight : 1;
  // The held row and sorted peers move visually. Their drop slots must stay
  // in normal flow, including while a CSS transition is between positions.
  const top = listRect.top + (element.offsetTop - list.scrollTop + list.clientTop) * scaleY;
  const left = listRect.left + (element.offsetLeft - list.scrollLeft + list.clientLeft) * scaleX;
  const height = element.offsetHeight * scaleY;
  const width = element.offsetWidth * scaleX;
  return { top, left, height, width, bottom: top + height, right: left + width };
}

export function sidebarSourceSortingStrategy(args: Parameters<SortingStrategy>[0]) {
  // Outside the source list, close the held row's slot. Returning to a row
  // resumes ordinary insertion at that row instead of restoring an empty gap.
  return verticalListSortingStrategy({
    ...args,
    overIndex: args.overIndex < 0 ? args.rects.length - 1 : args.overIndex,
  });
}

export function createSidebarDestinationCollisionDetection(
  isValidTarget: (id: string) => boolean,
  sourceKeys: ReadonlySet<string> = new Set(),
): CollisionDetection {
  return (args) => {
    if (!args.pointerCoordinates) return [];
    const destinations = args.droppableContainers.filter((container) =>
      String(container.id).startsWith("sidebar-destination:"),
    );
    const activeNode = args.droppableContainers.find((container) => container.id === args.active.id)
      ?.node.current;
    const card = activeNode?.querySelector<HTMLElement>('[role="button"]');
    // The compact held card can be shorter than dnd-kit's original row slot.
    const heldRect = card?.getBoundingClientRect() ?? args.collisionRect;
    const boxes = pointerWithin({
      ...args,
      pointerCoordinates: {
        x: args.pointerCoordinates.x,
        y: heldRect.top + heldRect.height / 2,
      },
      droppableContainers: destinations,
    });
    const listViewport = destinations[0]?.node.current
      ?.closest("[data-sidebar-drag-list]")
      ?.getBoundingClientRect();
    if (
      listViewport &&
      (args.pointerCoordinates.y < listViewport.top ||
        args.pointerCoordinates.y > listViewport.bottom)
    )
      return [];
    // Settled stays above overflowed sections at the bottom of short lists.
    const box = boxes.find(({ id }) => id === "sidebar-destination:settled") ?? boxes[0];
    if (box) return isValidTarget(String(box.id)) ? [box] : [];
    const source = args.droppableContainers.filter((container) =>
      sourceKeys.has(String(container.id)),
    );
    const rects = source.flatMap((container) => {
      const rect = args.droppableRects.get(container.id);
      return rect ? [rect] : [];
    });
    const pointer = args.pointerCoordinates;
    const viewport = source[0]?.node.current
      ?.closest("[data-sidebar-source-list]")
      ?.getBoundingClientRect();
    // Include trailing whitespace so releasing there commits the previewed
    // reorder. Explicit destination boxes above retain priority.
    if (
      !rects.length ||
      pointer.y <
        Math.max(viewport?.top ?? -Infinity, Math.min(...rects.map((rect) => rect.top))) ||
      (viewport !== undefined && pointer.y > viewport.bottom) ||
      pointer.x < Math.min(...rects.map((rect) => rect.left)) ||
      pointer.x > Math.max(...rects.map((rect) => rect.right))
    )
      return [];
    const target = closestCenter({ ...args, droppableContainers: source })[0];
    return target && isValidTarget(String(target.id)) ? [target] : [];
  };
}

import {
  closestCenter,
  getClientRect,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
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
    const boxes = pointerWithin({ ...args, droppableContainers: destinations });
    const box = boxes[0];
    if (box) return isValidTarget(String(box.id)) ? [box] : [];
    const source = args.droppableContainers.filter((container) =>
      sourceKeys.has(String(container.id)),
    );
    const rects = source.flatMap((container) => {
      const rect = args.droppableRects.get(container.id);
      return rect ? [rect] : [];
    });
    const pointer = args.pointerCoordinates;
    // Include trailing whitespace so releasing there commits the previewed
    // reorder. Explicit destination boxes above retain priority.
    if (
      !rects.length ||
      pointer.x < Math.min(...rects.map((rect) => rect.left)) ||
      pointer.x > Math.max(...rects.map((rect) => rect.right))
    )
      return [];
    const target = closestCenter({ ...args, droppableContainers: source })[0];
    return target && isValidTarget(String(target.id)) ? [target] : [];
  };
}

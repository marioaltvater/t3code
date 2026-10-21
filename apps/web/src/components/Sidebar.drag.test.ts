import { describe, expect, it } from "vite-plus/test";
import { type CollisionDetection } from "@dnd-kit/core";
import { type SortingStrategy } from "@dnd-kit/sortable";
import {
  createSidebarDestinationCollisionDetection,
  sidebarSourceSortingStrategy,
} from "./Sidebar.drag";
import {
  sidebarListItemId,
  resolveSidebarSourceTarget,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const thread = (key: string, section: SidebarSection): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const marker = (marker: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker });
const pinnedHeader = marker("pinned-header");
const divider = marker("pinned-divider");
const settledHeader = marker("settled-header");

function layout(
  items: readonly SidebarListItem[],
  active: string,
  over: string,
  scale = 1,
  cardHeight = 82,
) {
  let top = 100;
  const rects = items.map((item) => {
    const height =
      item.kind === "thread"
        ? (item.section === "pinned" || item.section === "active" ? cardHeight : 36) * scale
        : item.marker === "pinned-header" || item.marker === "pinned-divider"
          ? 0
          : (item.marker.endsWith("placeholder") ? 0 : 32) * scale;
    const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
    top += height + 1;
    return rect;
  });
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === active);
  return {
    activeIndex,
    overIndex: items.findIndex((item) => sidebarListItemId(item) === over),
    activeNodeRect: rects[activeIndex]!,
    rects,
    index: 0,
  } satisfies Parameters<SortingStrategy>[0];
}

describe("source list drag preview", () => {
  it.each([36, 82])("closes the held row's slot outside the list at height %s", (height) => {
    const items = [thread("held", "active"), thread("remaining", "active")];
    const args = layout(items, "held", "outside", 1, height);
    expect(sidebarSourceSortingStrategy({ ...args, index: 1 })?.y).toBe(-(height + 1));
  });

  it("packs several remaining rows without changing their order", () => {
    const items = ["a", "held", "b", "c"].map((id) => thread(id, "active"));
    const args = layout(items, "held", "outside");
    const tops = [0, 2, 3].map((index) => {
      const transform = sidebarSourceSortingStrategy({ ...args, index });
      return args.rects[index]!.top + (transform?.y ?? 0);
    });
    expect(tops).toEqual([100, 183, 266]);
  });

  it("restores an insertion slot when the held row returns", () => {
    const items = [thread("held", "active"), thread("remaining", "active")];
    const outside = layout(items, "held", "outside");
    expect(sidebarSourceSortingStrategy({ ...outside, index: 1 })?.y).toBe(-83);
    const inside = layout(items, "held", "held");
    expect(sidebarSourceSortingStrategy({ ...inside, index: 1 })?.y).toBe(0);
  });
});

describe("sidebar collision detection", () => {
  function collisionArgs(blockedAboveSource = false) {
    const rows = [thread("source", "active"), thread("blocked", "active")];
    const items = [
      pinnedHeader,
      divider,
      ...(blockedAboveSource ? rows.toReversed() : rows),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const { rects, activeIndex, overIndex } = layout(items, "source", "blocked");
    const collisionRect = rects[overIndex]!;
    return {
      active: {
        id: "source",
        data: { current: {} },
        rect: { current: { initial: rects[activeIndex]!, translated: collisionRect } },
      },
      collisionRect,
      droppableRects: new Map(items.map((item, index) => [sidebarListItemId(item), rects[index]!])),
      droppableContainers: items.map((item, index) => ({
        id: sidebarListItemId(item),
        key: sidebarListItemId(item),
        disabled: false,
        data: { current: {} },
        node: { current: null },
        rect: { current: rects[index]! },
      })),
      pointerCoordinates: null,
    } satisfies Parameters<CollisionDetection>[0];
  }

  it("only accepts destination boxes under the pointer, with no snapping across gaps", () => {
    const args = collisionArgs();
    const boxId = "sidebar-destination:pinned";
    const row = args.droppableContainers[0]!;
    const boxRect = { top: 300, bottom: 500, left: 0, right: 260, width: 260, height: 200 };
    const containers = [
      ...args.droppableContainers,
      { ...row, id: boxId, key: boxId, rect: { current: boxRect } },
    ];
    const boxArgs = {
      ...args,
      droppableContainers: containers,
      droppableRects: new Map([...args.droppableRects, [boxId, boxRect]]),
    };
    const detector = createSidebarDestinationCollisionDetection(() => true);
    expect(
      detector({ ...boxArgs, pointerCoordinates: { x: 100, y: 350 } }).map(({ id }) => id),
    ).toEqual([boxId]);
    expect(detector({ ...boxArgs, pointerCoordinates: { x: 100, y: 290 } })).toEqual([]);
    expect(detector({ ...boxArgs, pointerCoordinates: { x: 270, y: 350 } })).toEqual([]);
    expect(detector({ ...boxArgs, pointerCoordinates: { x: 100, y: 110 } })).toEqual([]);
    expect(
      createSidebarDestinationCollisionDetection(() => false)({
        ...boxArgs,
        pointerCoordinates: { x: 100, y: 350 },
      }),
    ).toEqual([]);
    expect(detector(boxArgs)).toEqual([]);
  });

  it("keeps source membership when dragging past unrelated rows", () => {
    const args = collisionArgs();
    const detector = createSidebarDestinationCollisionDetection(() => true, new Set(["source"]));
    expect(
      detector({ ...args, pointerCoordinates: { x: 100, y: 110 } }).map(({ id }) => id),
    ).toEqual(["source"]);
    expect(
      detector({ ...args, pointerCoordinates: { x: 100, y: 200 } }).map(({ id }) => id),
    ).toEqual(["source"]);
    expect(detector({ ...args, pointerCoordinates: { x: 270, y: 110 } })).toEqual([]);
    expect(
      createSidebarDestinationCollisionDetection(
        () => false,
        new Set(["source"]),
      )({
        ...args,
        pointerCoordinates: { x: 100, y: 110 },
      }),
    ).toEqual([]);
  });

  it.each([true, false])(
    "gives Settled priority over the source fallback when accepted=%s",
    (accepted) => {
      const args = collisionArgs();
      const boxId = "sidebar-destination:settled";
      const boxRect = { top: 800, bottom: 896, left: 0, right: 260, width: 260, height: 96 };
      const detector = createSidebarDestinationCollisionDetection(
        (id) => id !== boxId || accepted,
        new Set(["source", "blocked"]),
      );
      const result = detector({
        ...args,
        droppableContainers: [
          ...args.droppableContainers,
          { ...args.droppableContainers[0]!, id: boxId, key: boxId, rect: { current: boxRect } },
        ],
        droppableRects: new Map([...args.droppableRects, [boxId, boxRect]]),
        pointerCoordinates: { x: 100, y: 850 },
      });
      expect(result.map(({ id }) => id)).toEqual(accepted ? [boxId] : []);
    },
  );

  it("keeps the reorder target while the pointer crosses a gap in the source list", () => {
    const args = collisionArgs();
    const sourceRect = args.droppableRects.get("source")!;
    const nextRect = args.droppableRects.get("blocked")!;
    const detector = createSidebarDestinationCollisionDetection(
      () => true,
      new Set(["source", "blocked"]),
    );
    const pointerCoordinates = { x: 100, y: (sourceRect.bottom + nextRect.top) / 2 };
    const result = detector({ ...args, pointerCoordinates });
    expect(result.map(({ id }) => id)).toEqual(["blocked"]);
    expect(
      detector({ ...args, pointerCoordinates: { x: 100, y: nextRect.bottom + 10 } }).map(
        ({ id }) => id,
      ),
    ).toEqual(["blocked"]);
  });

  it("keeps the end-of-list reorder on release in empty space before Settled", () => {
    const args = collisionArgs();
    const sourceKeys = new Set(["source", "blocked"]);
    const detector = createSidebarDestinationCollisionDetection(() => true, sourceKeys);
    for (const y of [400, 600, 900]) {
      const collisionRect = { ...args.collisionRect, top: y - 41, bottom: y + 41 };
      const [collision] = detector({ ...args, collisionRect, pointerCoordinates: { x: 100, y } });
      expect(collision?.id).toBe("blocked");
      const target = resolveSidebarSourceTarget({
        activeKey: "source",
        overId: String(collision?.id),
        section: "active",
        pinnedSectionId: null,
        sourceKeys,
        pinnedOrder: [],
        activeOrder: ["source", "blocked"],
        pinnedSectionIdByThreadKey: new Map(),
      });
      expect(target?.activeOrder).toEqual(["blocked", "source"]);
    }
  });

  it("uses the held row center rather than the pointer grab offset for source reordering", () => {
    const args = collisionArgs();
    const detector = createSidebarDestinationCollisionDetection(
      () => true,
      new Set(["source", "blocked"]),
    );
    expect(
      detector({ ...args, pointerCoordinates: { x: 100, y: 110 } }).map(({ id }) => id),
    ).toEqual(["blocked"]);
  });
});

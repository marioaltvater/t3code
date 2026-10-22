import { describe, expect, it } from "vite-plus/test";
import { type CollisionDetection } from "@dnd-kit/core";
import { type SortingStrategy } from "@dnd-kit/sortable";
import {
  createSidebarDestinationCollisionDetection,
  sidebarSourceSortingStrategy,
  sidebarDragTranslation,
  sidebarDragExpansion,
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

describe("sidebar drag expansion", () => {
  const input = {
    sourceBounds: { top: 200, bottom: 700 },
    sourceSection: "active",
    pinnedAreaBottom: 240,
    expanded: false,
    pinnedExpanded: false,
  };

  it("expands the pinned targets and source layout together at their visible boundary", () => {
    expect(sidebarDragExpansion({ ...input, centerY: 230 })).toEqual({
      expanded: true,
      pinnedExpanded: true,
    });
    expect(sidebarDragExpansion({ ...input, centerY: 250 })).toEqual({
      expanded: false,
      pinnedExpanded: false,
    });
  });

  it("preserves source reordering inside a pinned section", () => {
    expect(sidebarDragExpansion({ ...input, sourceSection: "pinned", centerY: 230 })).toEqual({
      expanded: false,
      pinnedExpanded: false,
    });
  });

  it("collapses the pinned targets again on the way to Settled", () => {
    expect(
      sidebarDragExpansion({ ...input, centerY: 800, expanded: true, pinnedExpanded: true }),
    ).toEqual({
      expanded: true,
      pinnedExpanded: false,
    });
  });
});

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

  it.each([0, 310, 700])(
    "matches the held card to source slots at viewport origin %s",
    (originTop) => {
      const args = collisionArgs();
      const keys = ["source", "blocked"];
      const rects = keys.map((_, index) => ({
        top: originTop + index * 90,
        bottom: originTop + index * 90 + 82,
        left: 0,
        right: 260,
        width: 260,
        height: 82,
      }));
      const detector = createSidebarDestinationCollisionDetection(() => true, new Set(keys));
      for (const index of [0, 1, 0]) {
        const pointerY = rects[index]!.top + 41;
        const delta = sidebarDragTranslation({
          pointerY,
          grabFraction: 0.5,
          cardHeight: 82,
          bounds: { top: 0, height: 1000 },
          originTop,
        });
        const collisionRect = {
          ...rects[0]!,
          top: originTop + delta,
          bottom: originTop + delta + 82,
        };
        const [collision] = detector({
          ...args,
          collisionRect,
          pointerCoordinates: { x: 100, y: pointerY },
          droppableRects: new Map(keys.map((key, i) => [key, rects[i]!])),
          droppableContainers: args.droppableContainers.slice(0, 2).map((container, i) => ({
            ...container,
            id: keys[i]!,
            key: keys[i]!,
            rect: { current: rects[i]! },
          })),
        });
        expect(collision?.id).toBe(keys[index]);
      }
    },
  );

  it("accepts a destination when half the held card enters it, independently of the grab point", () => {
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
    const at = (centerY: number, pointerY: number, x = 100) => ({
      ...boxArgs,
      collisionRect: {
        ...boxArgs.collisionRect,
        top: centerY - 18,
        bottom: centerY + 18,
        height: 36,
      },
      pointerCoordinates: { x, y: pointerY },
    });
    expect(detector(at(301, 290)).map(({ id }) => id)).toEqual([boxId]);
    expect(detector(at(299, 310))).toEqual([]);
    expect(detector(at(350, 350, 270))).toEqual([]);
    expect(detector(at(110, 110))).toEqual([]);
    expect(createSidebarDestinationCollisionDetection(() => false)(at(350, 350))).toEqual([]);
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

  it("uses the visible compact card rather than its original full-height slot for destination hits", () => {
    const args = collisionArgs();
    const id = "sidebar-destination:active";
    const rect = { top: 300, bottom: 500, left: 0, right: 260, width: 260, height: 200 };
    let cardTop = 280;
    const node = {
      querySelector: () => ({ getBoundingClientRect: () => ({ top: cardTop, height: 36 }) }),
    } as unknown as HTMLElement;
    const detector = createSidebarDestinationCollisionDetection(() => true);
    const input = {
      ...args,
      pointerCoordinates: { x: 100, y: 290 },
      collisionRect: { ...args.collisionRect, top: 280, bottom: 362, height: 82 },
      droppableContainers: [
        { ...args.droppableContainers[0]!, id: "source", node: { current: node } },
        { ...args.droppableContainers[0]!, id, key: id, rect: { current: rect } },
      ],
      droppableRects: new Map([[id, rect]]),
    };
    expect(detector(input)).toEqual([]);
    cardTop = 284;
    expect(detector(input).map(({ id }) => id)).toEqual([id]);
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
        collisionRect: { ...args.collisionRect, top: 832, bottom: 868, height: 36 },
        pointerCoordinates: { x: 100, y: 850 },
      });
      expect(result.map(({ id }) => id)).toEqual(accepted ? [boxId] : []);
    },
  );

  it.each([true, false])(
    "keeps sticky Settled above an overlapping pin when accepted=%s",
    (accepted) => {
      const args = collisionArgs();
      const rect = { top: 300, bottom: 396, left: 0, right: 260, width: 260, height: 96 };
      const ids = ["sidebar-destination:pinned", "sidebar-destination:settled"];
      const detector = createSidebarDestinationCollisionDetection(
        (id) => id !== ids[1] || accepted,
      );
      const result = detector({
        ...args,
        pointerCoordinates: { x: 100, y: 350 },
        collisionRect: { ...args.collisionRect, top: 332, bottom: 368, height: 36 },
        droppableContainers: ids.map((id) => ({
          ...args.droppableContainers[0]!,
          id,
          key: id,
          rect: { current: rect },
        })),
        droppableRects: new Map(ids.map((id) => [id, rect])),
      });
      expect(result.map(({ id }) => id)).toEqual(accepted ? [ids[1]] : []);
    },
  );

  it("does not accept a scrolled destination through the clipped edge of its viewport", () => {
    const args = collisionArgs();
    const id = "sidebar-destination:pinned";
    const rect = { top: 60, bottom: 120, left: 0, right: 260, width: 260, height: 60 };
    const node = {
      closest: () => ({ getBoundingClientRect: () => ({ top: 100, bottom: 400 }) }),
    } as unknown as HTMLElement;
    const detector = createSidebarDestinationCollisionDetection(() => true);
    const targets = {
      ...args,
      droppableContainers: [
        {
          ...args.droppableContainers[0]!,
          id,
          key: id,
          node: { current: node },
          rect: { current: rect },
        },
      ],
      droppableRects: new Map([[id, rect]]),
    };
    const collisionRect = { ...args.collisionRect, top: 92, bottom: 128, height: 36 };
    expect(detector({ ...targets, collisionRect, pointerCoordinates: { x: 100, y: 90 } })).toEqual(
      [],
    );
    expect(
      detector({ ...targets, collisionRect, pointerCoordinates: { x: 100, y: 110 } }).map(
        ({ id }) => id,
      ),
    ).toEqual([id]);
  });

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

  it("does not reopen the source slot in gaps above its list", () => {
    const args = collisionArgs();
    const sourceTop = args.droppableRects.get("source")!.top;
    const detector = createSidebarDestinationCollisionDetection(
      () => true,
      new Set(["source", "blocked"]),
    );
    for (const y of [0, sourceTop - 20, sourceTop - 1]) {
      expect(detector({ ...args, pointerCoordinates: { x: 100, y } })).toEqual([]);
    }
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

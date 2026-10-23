import { describe, expect, it } from "vite-plus/test";
import {
  createTimelineTurnNavigationState,
  isTimelineTurnScrollInFlight,
  navigateTimelineTurn,
  resetTimelineTurnNavigation,
} from "./timelineTurnNavigation";

const items = ["turn-0", "turn-1", "turn-2", "turn-3"].map((id, index) => ({
  id,
  rowIndex: index * 10,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function navigate(
  state: ReturnType<typeof createTimelineTurnNavigationState>,
  input: {
    direction: -1 | 1;
    currentIndex: number | null;
    isAtEnd?: boolean;
    items?: typeof items;
    scrollToIndex: (rowIndex: number) => Promise<void>;
    beforeNavigate?: () => void;
  },
) {
  return navigateTimelineTurn({
    state,
    identity: state.identity,
    items: input.items ?? items,
    currentIndex: input.currentIndex,
    isAtEnd: input.isAtEnd ?? false,
    direction: input.direction,
    beforeNavigate: input.beforeNavigate ?? (() => {}),
    scrollToIndex: input.scrollToIndex,
  });
}

describe("timeline turn navigation", () => {
  it("advances on rapid ticks and waits for every overlapping list scroll", async () => {
    const state = createTimelineTurnNavigationState("thread-a");
    const pending = [deferred(), deferred(), deferred()];
    const scrollTargets: number[] = [];
    const beforeNavigate: number[] = [];
    let nextScroll = 0;
    const scrollToIndex = (rowIndex: number) => {
      scrollTargets.push(rowIndex);
      return pending[nextScroll++]!.promise;
    };
    const navigateOnce = (direction: -1 | 1) =>
      navigate(state, {
        direction,
        currentIndex: 2,
        scrollToIndex,
        beforeNavigate: () => beforeNavigate.push(1),
      });

    expect(navigateOnce(1)).toBe(true);
    expect(navigateOnce(-1)).toBe(true);
    expect(navigateOnce(-1)).toBe(true);
    expect(scrollTargets).toEqual([30, 20, 10]);
    expect(beforeNavigate).toHaveLength(3);

    pending[0]!.resolve();
    await Promise.resolve();
    expect(isTimelineTurnScrollInFlight(state, "thread-a")).toBe(true);
    pending[1]!.resolve();
    await Promise.resolve();
    expect(isTimelineTurnScrollInFlight(state, "thread-a")).toBe(true);
    pending[2]!.resolve();
    await Promise.resolve();
    expect(isTimelineTurnScrollInFlight(state, "thread-a")).toBe(false);
  });

  it("keeps navigation inside the first and last user messages", () => {
    const state = createTimelineTurnNavigationState("thread-a");
    const scrollTargets: number[] = [];
    let beforeNavigateCount = 0;
    const shared = {
      currentIndex: 0,
      scrollToIndex: async (rowIndex: number) => {
        scrollTargets.push(rowIndex);
      },
      beforeNavigate: () => {
        beforeNavigateCount += 1;
      },
    };

    expect(navigate(state, { ...shared, direction: -1 })).toBe(false);
    expect(state.cursorItemId).toBe("turn-0");
    expect(navigate(state, { ...shared, direction: 1 })).toBe(true);
    expect(scrollTargets).toEqual([10]);

    state.cursorItemId = "turn-3";
    expect(navigate(state, { ...shared, direction: 1 })).toBe(false);
    expect(state.cursorItemId).toBe("turn-3");
    expect(beforeNavigateCount).toBe(1);
  });

  it("does nothing when the timeline has no user message anchors", () => {
    const state = createTimelineTurnNavigationState("thread-a");
    let scrollCount = 0;
    let beforeNavigateCount = 0;
    expect(
      navigate(state, {
        direction: -1,
        currentIndex: null,
        isAtEnd: true,
        items: [],
        scrollToIndex: async () => {
          scrollCount += 1;
        },
        beforeNavigate: () => {
          beforeNavigateCount += 1;
        },
      }),
    ).toBe(false);

    expect(state.cursorItemId).toBeNull();
    expect(scrollCount).toBe(0);
    expect(beforeNavigateCount).toBe(0);
  });

  it("starts from the last user message at the end even if earlier turns remain visible", () => {
    const state = createTimelineTurnNavigationState("thread-a");
    const scrollTargets: number[] = [];
    expect(
      navigate(state, {
        direction: -1,
        currentIndex: 0,
        isAtEnd: true,
        scrollToIndex: async (rowIndex) => {
          scrollTargets.push(rowIndex);
        },
      }),
    ).toBe(true);
    expect(scrollTargets).toEqual([20]);
    expect(state.cursorItemId).toBe("turn-2");
  });

  it("keeps its cursor attached to the same user message when older history is prepended", () => {
    const state = createTimelineTurnNavigationState("thread-a");
    const scrollTargets: number[] = [];
    const scrollToIndex = async (rowIndex: number) => {
      scrollTargets.push(rowIndex);
    };
    expect(navigate(state, { direction: 1, currentIndex: 0, scrollToIndex })).toBe(true);

    const prependedItems = [
      { id: "older-turn", rowIndex: 0 },
      ...items.map((item) => ({ ...item, rowIndex: item.rowIndex + 10 })),
    ];
    expect(
      navigate(state, {
        direction: 1,
        currentIndex: 1,
        items: prependedItems,
        scrollToIndex,
      }),
    ).toBe(true);
    expect(scrollTargets).toEqual([10, 30]);
    expect(state.cursorItemId).toBe("turn-2");
  });

  it("resets on manual navigation and ignores the earlier list scroll's completion", async () => {
    const state = createTimelineTurnNavigationState("thread-a");
    const oldScroll = deferred();
    const currentScroll = deferred();
    let nextScroll = 0;
    const pending = [oldScroll, currentScroll];
    const scrollTargets: number[] = [];
    const scrollToIndex = (rowIndex: number) => {
      scrollTargets.push(rowIndex);
      return pending[nextScroll++]!.promise;
    };
    expect(navigate(state, { direction: 1, currentIndex: 0, scrollToIndex })).toBe(true);

    resetTimelineTurnNavigation(state);
    expect(navigate(state, { direction: 1, currentIndex: 2, scrollToIndex })).toBe(true);
    oldScroll.resolve();
    await Promise.resolve();

    expect(scrollTargets).toEqual([10, 30]);
    expect(isTimelineTurnScrollInFlight(state, "thread-a")).toBe(true);
    currentScroll.resolve();
    await Promise.resolve();
    expect(isTimelineTurnScrollInFlight(state, "thread-a")).toBe(false);
  });

  it("resets its cursor and pending scrolls when the thread identity changes", async () => {
    const state = createTimelineTurnNavigationState("thread-a");
    const oldScroll = deferred();
    const newScroll = deferred();
    expect(
      navigate(state, {
        direction: 1,
        currentIndex: 0,
        scrollToIndex: () => oldScroll.promise,
      }),
    ).toBe(true);

    expect(
      navigateTimelineTurn({
        state,
        identity: "thread-b",
        items,
        currentIndex: 2,
        isAtEnd: false,
        direction: 1,
        beforeNavigate: () => {},
        scrollToIndex: (rowIndex) => {
          expect(rowIndex).toBe(30);
          return newScroll.promise;
        },
      }),
    ).toBe(true);
    expect(state.identity).toBe("thread-b");
    expect(state.cursorItemId).toBe("turn-3");

    oldScroll.resolve();
    await Promise.resolve();
    expect(isTimelineTurnScrollInFlight(state, "thread-b")).toBe(true);
    newScroll.resolve();
    await Promise.resolve();
    expect(isTimelineTurnScrollInFlight(state, "thread-b")).toBe(false);
  });
});

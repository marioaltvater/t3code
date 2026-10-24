import { describe, expect, it, vi } from "vite-plus/test";
import { createSidebarDragDwell } from "./Sidebar.dragDwell";

function setup() {
  vi.useFakeTimers();
  const dwell = createSidebarDragDwell();
  const onDwell = vi.fn();
  return {
    dwell,
    onDwell,
    [Symbol.dispose]() {
      dwell.clear();
      vi.useRealTimers();
    },
  };
}

describe("sidebar destination dwell", () => {
  it("expands a stationary destination after 350 ms without another move", () => {
    using test = setup();
    test.dwell.update("pinned:a", test.onDwell);
    vi.advanceTimersByTime(349);
    expect(test.onDwell).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(test.onDwell).toHaveBeenCalledExactlyOnceWith("pinned:a");
    vi.advanceTimersByTime(1_000);
    expect(test.onDwell).toHaveBeenCalledTimes(1);
  });

  it("keeps continuous movement within one destination on the original deadline", () => {
    using test = setup();
    test.dwell.update("pinned:a", test.onDwell);
    vi.advanceTimersByTime(200);
    test.dwell.update("pinned:a", test.onDwell);
    vi.advanceTimersByTime(150);
    expect(test.onDwell).toHaveBeenCalledExactlyOnceWith("pinned:a");
  });

  it("requires a fresh full dwell after switching destinations", () => {
    using test = setup();
    test.dwell.update("pinned:a", test.onDwell);
    vi.advanceTimersByTime(300);
    test.dwell.update("pinned:b", test.onDwell);
    vi.advanceTimersByTime(349);
    expect(test.onDwell).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(test.onDwell).toHaveBeenCalledExactlyOnceWith("pinned:b");
  });

  it("discards elapsed time when the pointer leaves valid destinations", () => {
    using test = setup();
    test.dwell.update("pinned:a", test.onDwell);
    vi.advanceTimersByTime(300);
    test.dwell.update(null, test.onDwell);
    vi.advanceTimersByTime(1_000);
    expect(test.onDwell).not.toHaveBeenCalled();
    test.dwell.update("pinned:a", test.onDwell);
    vi.advanceTimersByTime(349);
    expect(test.onDwell).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(test.onDwell).toHaveBeenCalledExactlyOnceWith("pinned:a");
  });

  it("never expands after a quick drop clears the pending dwell", () => {
    using test = setup();
    test.dwell.update("settled", test.onDwell);
    vi.advanceTimersByTime(349);
    test.dwell.clear();
    test.dwell.clear();
    vi.advanceTimersByTime(1_000);
    expect(test.onDwell).not.toHaveBeenCalled();
  });

  it("allows a later drag to dwell on the same destination after cancellation", () => {
    using test = setup();
    test.dwell.update("active", test.onDwell);
    vi.advanceTimersByTime(300);
    test.dwell.clear();
    test.dwell.update("active", test.onDwell);
    vi.advanceTimersByTime(349);
    expect(test.onDwell).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(test.onDwell).toHaveBeenCalledExactlyOnceWith("active");
  });
});

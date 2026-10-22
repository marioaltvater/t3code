import { useDndContext } from "@dnd-kit/core";
import { useLayoutEffect, useRef } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";

export function SidebarDragLayout({
  layout,
  listRef,
}: {
  layout: { key: string; dragging: boolean };
  listRef: { readonly current: HTMLUListElement | null };
}) {
  const { measureDroppableContainers } = useDndContext();
  const previous = useRef(new Map<string, { top: number; height: number; box?: HTMLElement }>());
  const animations = useRef<
    Map<
      string,
      {
        animation: Animation;
        from: { top: number; height: number };
        to: { top: number; height: number };
      }
    >
  >(new Map());
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const completion = new AbortController();
    for (const entry of animations.current) {
      const [key, { animation, from, to }] = entry;
      const progress = animation.effect?.getComputedTiming().progress;
      // Reversing a transition must start at its current visible position.
      if (progress != null) {
        previous.current.set(key, {
          ...previous.current.get(key),
          top: from.top + (to.top - from.top) * progress,
          height: from.height + (to.height - from.height) * progress,
        });
      }
      animation.cancel();
    }
    animations.current.clear();
    const next = new Map<string, { top: number; height: number; box?: HTMLElement }>();
    for (const child of list.children) {
      if (!(child instanceof HTMLElement)) continue;
      const key = child.dataset.threadItem ?? child.dataset.sidebarMarker;
      if (!key) continue;
      const box = child.querySelector<HTMLElement>('[data-testid^="sidebar-destination:"]');
      const position = {
        top: child.offsetTop,
        height: child.offsetHeight,
        ...(box ? { box } : {}),
      };
      next.set(key, position);
      const before = previous.current.get(key);
      if (!layout.dragging || reducedMotion || child.dataset.threadItem) continue;
      if (
        before &&
        before.top === position.top &&
        before.height === position.height &&
        Boolean(before.box) === Boolean(box)
      )
        continue;
      const visual = child.querySelector<HTMLElement>('[role="button"]') ?? child.firstElementChild;
      if (!(visual instanceof HTMLElement) || position.height === 0) continue;
      const offset = before ? before.top - position.top : 0;
      const visualHeight = visual.offsetHeight;
      const padding = position.height - visualHeight;
      // Release motion belongs to Sidebar.motion, which restores headers and
      // rows together. During drag, keep sortable transforms and the held
      // card under pointer control by animating only section chrome.
      animations.current.set(key, {
        from: before ?? position,
        to: position,
        animation: visual.animate(
          [
            {
              transform: `translateY(${offset}px)`,
              height: `${Math.max(0, (before?.height ?? position.height) - padding)}px`,
              opacity: before ? 1 : 0,
            },
            { transform: "translateY(0px)", height: `${visualHeight}px`, opacity: 1 },
          ],
          { duration: 180, easing: "ease-out" },
        ),
      });
    }
    previous.current = next;
    if (layout.dragging) {
      measureDroppableContainers([]);
      [...animations.current.values()]
        .at(-1)
        ?.animation.addEventListener("finish", () => measureDroppableContainers([]), {
          once: true,
          signal: completion.signal,
        });
    }
    return () => completion.abort();
  }, [layout, listRef, reducedMotion, measureDroppableContainers]);
  useLayoutEffect(
    () => () => {
      for (const entry of animations.current.values()) {
        const { animation } = entry;
        animation.cancel();
      }
    },
    [],
  );
  return null;
}

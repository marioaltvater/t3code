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
  const wasDragging = useRef(false);
  const animations = useRef<
    Map<
      string,
      {
        animation: Animation;
        from: { top: number; height: number };
        to: { top: number; height: number };
        exit?: HTMLElement;
        entering?: Animation;
      }
    >
  >(new Map());
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const completion = new AbortController();
    const leaving = wasDragging.current && !layout.dragging;
    wasDragging.current = layout.dragging;
    for (const entry of animations.current) {
      const [key, { animation, from, to, exit, entering }] = entry;
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
      entering?.cancel();
      exit?.remove();
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
      // The source header follows its cards; a separate transform makes its
      // text shimmer while the cards use the sorter's own peer motion.
      if (
        (!layout.dragging && !leaving) ||
        reducedMotion ||
        child.dataset.threadItem ||
        child.hasAttribute("data-sidebar-source")
      )
        continue;
      const before = previous.current.get(key);
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
      const duration = leaving ? 150 : 180;
      // Keep only outgoing destination chrome alive while the normal header
      // returns. It is inert and never registers as a second drop target.
      const exit = leaving && before?.box ? (before.box.cloneNode(true) as HTMLElement) : undefined;
      if (exit) {
        exit.removeAttribute("data-testid");
        exit.removeAttribute("data-drop-accepted");
        exit.setAttribute("aria-hidden", "true");
        exit.inert = true;
        Object.assign(exit.style, {
          position: "absolute",
          top: `${position.top}px`,
          left: `${child.offsetLeft}px`,
          bottom: "auto",
          width: `${child.offsetWidth}px`,
          boxSizing: "border-box",
          pointerEvents: "none",
          overflow: "hidden",
        });
        list.append(exit);
      }
      // Animate the contents, leaving sortable transforms and the held card
      // under pointer control. No exiting thread clones participate in the drag.
      animations.current.set(key, {
        from: before ?? position,
        to: position,
        ...(exit
          ? {
              exit,
              entering: visual.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration,
                easing: "ease-out",
              }),
            }
          : {}),
        animation: (exit ?? visual).animate(
          [
            {
              transform: `translateY(${offset}px)`,
              height: `${Math.max(0, (before?.height ?? position.height) - padding)}px`,
              opacity: before ? 1 : 0,
            },
            { transform: "translateY(0px)", height: `${visualHeight}px`, opacity: exit ? 0 : 1 },
          ],
          { duration, easing: "ease-out" },
        ),
      });
      if (exit)
        animations.current.get(key)!.animation.addEventListener("finish", () => exit.remove(), {
          once: true,
          signal: completion.signal,
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
        const { animation, exit, entering } = entry;
        animation.cancel();
        entering?.cancel();
        exit?.remove();
      }
    },
    [],
  );
  return null;
}

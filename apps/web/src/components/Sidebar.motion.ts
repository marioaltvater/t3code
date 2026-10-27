const motionTiming = { duration: 150, easing: "ease-out" };
const dropTiming = { duration: 180, easing: "cubic-bezier(0.77, 0, 0.175, 1)" };
const revealTiming = { duration: 100, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
const rowTravel = (height: number) => Math.min(height, 40);
// Fades clone removed rows and animate clones and entries; intervening layout reads force reflows.
const MAX_FADED_ROWS_PER_UPDATE = 40;

type RowPosition = { top: number; left: number; width: number; height: number };

const rowKey = (node: HTMLElement) => node.dataset.threadItem ?? node.dataset.sidebarMarker ?? node;

function listRows(parent: HTMLUListElement) {
  return Array.from(parent.children).flatMap((node) =>
    node instanceof HTMLElement && node.dataset?.sidebarThreadGroup !== undefined
      ? Array.from(node.firstElementChild?.children ?? [])
      : [node],
  );
}

function progress(animation: Animation) {
  return animation.playState === "finished"
    ? 1
    : (animation.effect?.getComputedTiming().progress ?? 0);
}

function rowVisual(node: HTMLElement) {
  return node.dataset.threadItem
    ? (node.querySelector<HTMLElement>('[role="button"]') ?? node)
    : node.firstElementChild instanceof HTMLElement
      ? node.firstElementChild
      : node;
}

function inertCopy(node: HTMLElement) {
  const clone = node.cloneNode(true) as HTMLElement;
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        (attribute.name === "id" && element.namespaceURI !== "http://www.w3.org/2000/svg") ||
        attribute.name === "data-thread-item" ||
        attribute.name === "data-thread-selection-safe" ||
        attribute.name === "data-testid"
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  clone.setAttribute("aria-hidden", "true");
  clone.inert = true;
  return clone;
}

/** Position the list so all direct children's offsetTop share an origin. */
export function createSidebarListMotion(parent: HTMLUListElement) {
  let positions: Map<HTMLElement, RowPosition> | null = null;
  let disposed = false;
  const reducedMotion = parent.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const running = new Map<HTMLElement, { animation: Animation; offset: number }>();
  const entering = new Map<HTMLElement, { animation: Animation; travel: number }>();
  const exiting = new Map<HTMLElement, Animation>();
  let released: Map<HTMLElement | string, number> | null = null;
  let landing: {
    key: string;
    clone: HTMLElement;
    top: number;
    height: number;
    hidden: Map<HTMLElement, string>;
    target?: HTMLElement;
    animation?: Animation;
  } | null = null;

  const clearLanding = () => {
    const current = landing;
    landing = null;
    if (!current) return;
    for (const [node, visibility] of current.hidden) node.style.visibility = visibility;
    current.clone.remove();
    current.animation?.cancel();
  };
  const hideLandingRow = (node: HTMLElement) => {
    if (!landing || landing.hidden.has(node)) return;
    landing.hidden.set(node, node.style.visibility);
    node.style.visibility = "hidden";
  };

  const remainingOffset = (node: HTMLElement) => {
    const current = running.get(node);
    const run = current ? current.offset * (1 - progress(current.animation)) : 0;
    const entry = entering.get(node);
    const enter = entry ? entry.travel * (1 - progress(entry.animation)) : 0;
    return run + enter;
  };
  const clearFades = () => {
    for (const entry of entering.values()) entry.animation.cancel();
    for (const animation of exiting.values()) animation.cancel();
    for (const node of exiting.keys()) node.remove();
    entering.clear();
    exiting.clear();
  };
  const fadeOut = (node: HTMLElement, position: RowPosition, travel: number) => {
    if (position.height === 0) return;
    const clone = inertCopy(node);
    Object.assign(clone.style, {
      position: "absolute",
      top: `${position.top + remainingOffset(node)}px`,
      left: `${position.left}px`,
      width: `${position.width}px`,
      height: `${position.height}px`,
      margin: "0",
      boxSizing: "border-box",
      contentVisibility: "visible",
      transform: "none",
      transition: "none",
      pointerEvents: "none",
    });
    parent.append(clone);
    const entry = entering.get(node);
    const entryProgress = entry ? progress(entry.animation) : 1;
    const animation = clone.animate(
      [
        { opacity: entryProgress, transform: "translateY(0px)" },
        { opacity: 0, transform: `translateY(${travel}px)` },
      ],
      motionTiming,
    );
    exiting.set(clone, animation);
    animation.addEventListener(
      "finish",
      () => {
        clone.remove();
        exiting.delete(clone);
      },
      { once: true },
    );
  };

  const cancel = (node: HTMLElement) => {
    running.get(node)?.animation.cancel();
    running.delete(node);
  };
  const suspend = () => {
    clearLanding();
    for (const node of running.keys()) cancel(node);
    clearFades();
    positions = null;
    released = null;
  };
  const move = (node: HTMLElement, offset: number, timing = motionTiming) => {
    cancel(node);
    const entry = entering.get(node);
    if (entry) entry.travel = 0;
    if (offset === 0 && !entry) return;
    const animation = node.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
      timing,
    );
    running.set(node, { animation, offset });
    animation.addEventListener(
      "finish",
      () => {
        if (running.get(node)?.animation === animation) running.delete(node);
      },
      { once: true },
    );
    return animation;
  };
  const onMotionPreferenceChange = () => {
    if (reducedMotion?.matches) suspend();
  };
  reducedMotion?.addEventListener("change", onMotionPreferenceChange);

  return {
    update(animate: boolean) {
      if (disposed) return;
      const next = new Map(
        listRows(parent)
          .filter(
            (node): node is HTMLElement =>
              node instanceof HTMLElement &&
              !exiting.has(node) &&
              node !== landing?.clone &&
              // Sticky placement owns this header's position. A FLIP transform
              // would lift its scrim off the bottom and expose rows beneath it.
              node.dataset.sidebarMarker !== "settled-header",
          )
          .map((node) => [
            node,
            {
              top: node.offsetTop,
              left: node.offsetLeft,
              width: node.offsetWidth,
              height: node.offsetHeight,
            },
          ]),
      );
      if (landing?.animation) {
        // A rollback, collapsed destination or new layout ends the handoff;
        // ordinary shell updates must not restart its travel.
        const target = landing.target;
        if (
          !animate ||
          reducedMotion?.matches ||
          !target ||
          !next.has(target) ||
          target.offsetHeight === 0 ||
          next.get(target)?.top !== positions?.get(target)?.top
        )
          clearLanding();
      }
      let fadeCount = 0;
      if (positions !== null) {
        for (const [node, position] of positions) {
          if (!next.has(node) && position.height > 0) fadeCount++;
        }
        for (const [node, position] of next) {
          if (!positions.has(node) && position.height > 0) fadeCount++;
        }
      }
      const shouldAnimate =
        animate &&
        positions !== null &&
        !reducedMotion?.matches &&
        fadeCount <= MAX_FADED_ROWS_PER_UPDATE;
      const movedDelta = new Map<HTMLElement, number>();
      const nextOrder = [...next.keys()];
      const oldOrder = positions === null ? [] : [...positions.keys()];
      const ridingDelta = (
        order: readonly HTMLElement[],
        index: number,
        retained: (node: HTMLElement) => boolean,
      ) => {
        for (let cursor = index - 1; cursor >= 0; cursor--) {
          const node = order[cursor]!;
          const delta = movedDelta.get(node);
          if (delta !== undefined) return delta;
          if (retained(node)) return remainingOffset(node);
        }
        return undefined;
      };
      if (!shouldAnimate) clearFades();
      else {
        for (const [node, position] of next) {
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined || previousTop === position.top) continue;
          movedDelta.set(node, previousTop + remainingOffset(node) - position.top);
        }
        for (const [node, position] of positions!) {
          if (next.has(node)) continue;
          const delta = ridingDelta(oldOrder, oldOrder.indexOf(node), (n) => next.has(n));
          fadeOut(node, position, delta === undefined ? rowTravel(position.height) : -delta);
        }
      }
      for (const [node, entry] of entering) {
        if (!next.has(node)) {
          entry.animation.cancel();
          entering.delete(node);
        }
      }
      for (const node of running.keys()) {
        if (!shouldAnimate || !next.has(node)) cancel(node);
      }
      if (shouldAnimate) {
        for (const [index, node] of nextOrder.entries()) {
          const position = next.get(node)!;
          const previousTop = positions!.get(node)?.top;
          if (previousTop === undefined) {
            if (position.height > 0) {
              const delta = ridingDelta(nextOrder, index, (n) => positions!.has(n));
              const travel = delta === undefined ? -rowTravel(position.height) : delta;
              const animation = node.animate(
                [
                  { opacity: 0, transform: `translateY(${travel}px)` },
                  { opacity: 1, transform: "translateY(0px)" },
                ],
                motionTiming,
              );
              entering.set(node, { animation, travel });
              animation.addEventListener(
                "finish",
                () => {
                  if (entering.get(node)?.animation === animation) entering.delete(node);
                },
                { once: true },
              );
            }
            continue;
          }
          const delta = movedDelta.get(node);
          // Computed progress includes easing; carry forward only our translation, never dnd-kit's
          // transforms.
          if (delta !== undefined) move(node, delta);
        }
      }
      if (released !== null) {
        const current = landing;
        const target = current
          ? [...next.keys()].find((node) => node.dataset?.threadItem === current.key)
          : undefined;
        const visual = target ? rowVisual(target) : undefined;
        const rect = visual?.getBoundingClientRect();
        if (!reducedMotion?.matches) {
          const offsets = new Map<HTMLElement, number>();
          for (const [node, position] of next) {
            const top = released.get(rowKey(node));
            if ((landing && node.dataset?.threadItem === landing.key) || position.height === 0)
              continue;
            const destination = node.dataset?.threadItem ? node : rowVisual(node);
            if (top !== undefined) offsets.set(node, top - destination.getBoundingClientRect().top);
          }
          let restoring: Animation | undefined;
          for (const [node, offset] of offsets) {
            restoring = move(node, offset, dropTiming) ?? restoring;
          }
          // Rows hidden by destination boxes return after their boundaries
          // settle, so a moving source header never crosses visible content.
          for (const node of next.keys()) {
            if (
              !node.dataset.threadItem ||
              node.dataset.threadItem === current?.key ||
              released.has(rowKey(node)) ||
              node.offsetHeight === 0
            )
              continue;
            const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], revealTiming);
            entering.set(node, { animation, travel: 0 });
            if (restoring) {
              animation.pause();
              const reveal = () => {
                if (entering.get(node)?.animation === animation) animation.play();
              };
              restoring.addEventListener("finish", reveal, { once: true });
              restoring.addEventListener("cancel", reveal, { once: true });
            }
            animation.addEventListener(
              "finish",
              () => {
                if (entering.get(node)?.animation === animation) entering.delete(node);
              },
              { once: true },
            );
          }
        }
        released = null;
        if (current) {
          if (!target || !visual || !rect || rect.height === 0 || reducedMotion?.matches)
            clearLanding();
          else {
            hideLandingRow(target);
            current.target = target;
            const reveal = () => {
              if (landing !== current) return;
              const cropped = Math.max(0, rect.height - current.height);
              clearLanding();
              if (cropped > 1) {
                const animation = visual.animate(
                  [
                    { clipPath: `inset(0px 0px ${cropped}px 0px)`, opacity: 0.5 },
                    { clipPath: "inset(0px 0px 0px 0px)", opacity: 1 },
                  ],
                  revealTiming,
                );
                entering.set(target, { animation, travel: 0 });
                animation.addEventListener(
                  "finish",
                  () => {
                    if (entering.get(target)?.animation === animation) entering.delete(target);
                  },
                  { once: true },
                );
              }
            };
            // Tiny corrections should not hold a compact row still before
            // revealing its destination's full card.
            if (Math.abs(rect.top - current.top) <= 8) {
              reveal();
            } else {
              const distance = Math.abs(rect.top - current.top);
              current.animation = current.clone.animate(
                [
                  { transform: "translateY(0px)" },
                  { transform: `translateY(${rect.top - current.top}px)` },
                ],
                {
                  ...dropTiming,
                  duration: Math.min(dropTiming.duration, Math.max(60, distance * 2)),
                  fill: "forwards",
                },
              );
              current.animation.addEventListener("finish", reveal, { once: true });
              current.animation.addEventListener(
                "cancel",
                () => {
                  if (landing === current) clearLanding();
                },
                { once: true },
              );
            }
          }
        }
      }
      positions = next;
    },
    release() {
      if (disposed) return;
      suspend();
      const rows = listRows(parent)
        .filter((node): node is HTMLElement => node instanceof HTMLElement)
        .map((node) => {
          const visual = rowVisual(node);
          const rect = (
            node.dataset.threadItem && !node.dataset.threadDragging ? node : visual
          ).getBoundingClientRect();
          return { node, visual, rect };
        });
      released = new Map();
      for (const { node, visual, rect } of rows) {
        released.set(rowKey(node), rect.top);
        if (!node.dataset.threadDragging || !node.dataset.threadItem || reducedMotion?.matches)
          continue;
        const clone = inertCopy(visual);
        Object.assign(clone.style, {
          position: "fixed",
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: "0",
          boxSizing: "border-box",
          contentVisibility: "visible",
          transform: "none",
          transition: "none",
          pointerEvents: "none",
          zIndex: "40",
        });
        landing = {
          key: node.dataset.threadItem,
          clone,
          top: rect.top,
          height: rect.height,
          hidden: new Map(),
        };
        parent.append(clone);
        hideLandingRow(node);
      }
    },
    suspend,
    dispose() {
      suspend();
      reducedMotion?.removeEventListener("change", onMotionPreferenceChange);
      disposed = true;
    },
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createSidebarListMotion } from "./Sidebar.motion";

class TestAnimation {
  progress: number | null = 0;
  playState: AnimationPlayState = "running";
  effect = { getComputedTiming: () => ({ progress: this.progress }) };
  cancel = vi.fn(() => {
    this.playState = "idle";
    for (const listener of this.listeners.get("cancel") ?? []) listener();
  });
  pause = vi.fn(() => {
    this.playState = "paused";
  });
  play = vi.fn(() => {
    this.playState = "running";
  });
  private listeners = new Map<string, (() => void)[]>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  finish() {
    this.playState = "finished";
    for (const listener of this.listeners.get("finish") ?? []) listener();
  }
}

class TestRow {
  offsetTop = 0;
  offsetLeft = 4;
  offsetWidth = 260;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  dragTranslate = 0;
  style: Record<string, string> = { visibility: "" };
  inert = false;
  attributes: { name: string; value: string }[] = [];
  children: TestRow[] = [];
  dataset: Record<string, string> = {};
  get firstElementChild(): TestRow | null {
    return this.children[0] ?? null;
  }
  clones: TestRow[] = [];
  remove = vi.fn();
  animations: TestAnimation[] = [];
  origin = () => 0;
  constructor(
    readonly name: string,
    public offsetHeight = 82,
  ) {}
  getBoundingClientRect() {
    return {
      top: this.origin() + this.offsetTop + this.dragTranslate,
      left: this.offsetLeft,
      width: this.offsetWidth,
      height: this.offsetHeight,
    };
  }
  setAttribute(name: string, value: string) {
    this.removeAttribute(name);
    this.attributes.push({ name, value });
  }
  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }
  querySelectorAll(_selector: string): TestRow[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
  }
  querySelector(_selector: string): TestRow | null {
    return (
      this.querySelectorAll("*").find((child) =>
        child.attributes.some(({ name, value }) => name === "role" && value === "button"),
      ) ?? null
    );
  }
  cloneNode(_deep: boolean): TestRow {
    const clone = new TestRow(`${this.name} clone`, this.offsetHeight);
    clone.namespaceURI = this.namespaceURI;
    clone.style = { ...this.style };
    clone.attributes = this.attributes.map((attribute) => ({ ...attribute }));
    clone.children = this.children.map((child) => child.cloneNode(true));
    this.clones.push(clone);
    return clone;
  }
  animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation = new TestAnimation();
    this.animations.push(animation);
    return animation;
  });
}

function fixture(rows: TestRow[]) {
  const media = {
    matches: false,
    addEventListener: vi.fn<(type: string, listener: () => void) => void>(),
    removeEventListener: vi.fn<(type: string, listener: () => void) => void>(),
  };
  const parent = {
    children: rows,
    ownerDocument: { defaultView: { matchMedia: () => media } },
    getBoundingClientRect: () => ({ top: 0 }),
    append(node: TestRow) {
      parent.children.push(node);
      node.remove.mockImplementation(() => {
        parent.children = parent.children.filter((child) => child !== node);
      });
    },
  };
  function layout(next: TestRow[]) {
    let top = 8;
    for (const row of next) {
      row.offsetTop = top;
      for (const node of [row, ...row.querySelectorAll("*")]) {
        node.origin = () => parent.getBoundingClientRect().top;
        node.offsetTop = top;
      }
      top += row.offsetHeight + 1;
    }
    parent.children = [
      ...next,
      ...parent.children.filter((row) => ["absolute", "fixed"].includes(row.style.position!)),
    ];
  }
  layout(rows);
  const motion = createSidebarListMotion(parent as unknown as HTMLUListElement);
  return { motion, layout, media, parent };
}

function expectMove(row: TestRow, offset: number) {
  expect(row.animate).toHaveBeenLastCalledWith(
    [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
    { duration: 150, easing: "ease-out" },
  );
}

function expectDropMove(row: TestRow, offset: number) {
  expect(row.animate).toHaveBeenLastCalledWith(
    [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
    { duration: 180, easing: "cubic-bezier(0.77, 0, 0.175, 1)" },
  );
}

function heldRow() {
  const row = new TestRow("held slot");
  row.dataset.threadItem = "environment:thread-a";
  row.dataset.threadDragging = "true";
  const visual = new TestRow("held compact visual", 36);
  visual.setAttribute("role", "button");
  visual.setAttribute("data-testid", "sidebar-row-slim");
  visual.setAttribute("id", "held-control");
  row.children = [visual];
  return { row, visual };
}

function destinationRow(height = 82) {
  const row = new TestRow("final row", height);
  row.dataset.threadItem = "environment:thread-a";
  const visual = new TestRow("final visual", height);
  visual.setAttribute("role", "button");
  row.children = [visual];
  return row;
}

beforeEach(() => vi.stubGlobal("HTMLElement", TestRow));
afterEach(() => vi.unstubAllGlobals());

describe("sidebar list motion", () => {
  it("keeps the sticky Settled header anchored when Working expands and collapses", () => {
    const workingHeader = new TestRow("Working", 32);
    const working = new TestRow("working");
    const settledHeader = new TestRow("Settled", 44);
    settledHeader.dataset.sidebarMarker = "settled-header";
    const { motion, layout } = fixture([workingHeader, settledHeader]);
    motion.update(true);

    layout([workingHeader, working, settledHeader]);
    motion.update(true);
    expect(working.animate).toHaveBeenCalled();
    expect(settledHeader.animate).not.toHaveBeenCalled();

    layout([workingHeader, settledHeader]);
    motion.update(true);
    expect(settledHeader.animate).not.toHaveBeenCalled();
  });

  it("moves a retained Active row into Settled with its displaced peers", () => {
    const pinnedHeader = new TestRow("Pinned", 0);
    const pinned = new TestRow("pin");
    const divider = new TestRow("Active", 0);
    const a = new TestRow("a");
    const b = new TestRow("b");
    const settledHeader = new TestRow("Settled", 32);
    const settled = new TestRow("settled", 36);
    const rows = [pinnedHeader, pinned, divider, a, b, settledHeader, settled];
    const { motion, layout } = fixture(rows);
    motion.update(true);
    expect(rows.every((row) => row.animations.length === 0)).toBe(true);

    a.offsetHeight = 36;
    layout([pinnedHeader, pinned, divider, b, settledHeader, settled, a]);
    motion.update(true);
    expectMove(a, -153);
    expectMove(b, 83);
    expectMove(settledHeader, 83);
    expectMove(settled, 83);
    expect(pinned.animate).not.toHaveBeenCalled();
    expect(divider.animate).not.toHaveBeenCalled();
  });

  it("refreshes the drop baseline without replay and animates the next ordinary move", () => {
    const [a, b, c] = [new TestRow("a"), new TestRow("b"), new TestRow("c")];
    const { motion, layout } = fixture([a, b, c]);
    motion.update(true);
    motion.suspend();
    a.dragTranslate = 300;
    b.dragTranslate = -83;
    motion.update(false);
    motion.suspend();
    layout([b, a, c]);
    a.dragTranslate = b.dragTranslate = 0;
    motion.update(true);
    expect([a, b, c].every((row) => row.animations.length === 0)).toBe(true);

    layout([c, b, a]);
    motion.update(true);
    expectMove(c, 166);
    expectMove(b, -83);
    expectMove(a, -83);
  });

  it("glides every row from its released position into its committed slot", () => {
    const [a, b, c] = [new TestRow("a"), new TestRow("b"), new TestRow("c")];
    const { motion, layout } = fixture([a, b, c]);
    motion.update(true);
    motion.suspend();
    a.dragTranslate = 130;
    b.dragTranslate = -83;
    c.dragTranslate = 16;
    motion.update(false);
    motion.release();
    layout([b, a, c]);
    a.dragTranslate = b.dragTranslate = c.dragTranslate = 0;
    motion.update(true);
    expectDropMove(a, 47);
    expect(b.animations).toHaveLength(0);
    expectDropMove(c, 16);
  });

  it("keeps release motion in screen coordinates when the drag list leaves its fixed position", () => {
    const [a, b] = [new TestRow("a"), new TestRow("b")];
    const { motion, layout, parent } = fixture([a, b]);
    motion.update(false);
    a.dragTranslate = 200;
    motion.release();
    parent.getBoundingClientRect = () => ({ top: 50 });
    layout([b, a]);
    a.dragTranslate = 0;
    motion.update(true);
    expectDropMove(a, 67);
    expectDropMove(b, 33);
  });

  it("animates individual rows through their transparent section wrappers", () => {
    const [a, b] = [new TestRow("a"), new TestRow("b")];
    const { motion, layout, parent } = fixture([a, b]);
    const group = new TestRow("section", 0);
    const list = new TestRow("list", 0);
    group.dataset.sidebarThreadGroup = "true";
    group.children = [list];
    list.children = [a, b];
    parent.children = [group];
    motion.update(false);
    layout([b, a]);
    list.children = [b, a];
    parent.children = [group];
    motion.update(true);
    expectMove(a, -83);
    expectMove(b, 83);
    expect(group.animations).toHaveLength(0);
  });

  it("keeps the held thread's release position when it moves to a different section", () => {
    const a = new TestRow("a");
    a.dataset.threadItem = "thread-a";
    const { motion, layout } = fixture([a]);
    motion.update(false);
    a.dragTranslate = 200;
    motion.release();
    const moved = new TestRow("a in destination");
    moved.dataset.threadItem = "thread-a";
    layout([moved]);
    motion.update(true);
    expectDropMove(moved, 200);
  });

  it("does not glide on release when motion is reduced", () => {
    const [a, b] = [new TestRow("a"), new TestRow("b")];
    const { motion, layout, media } = fixture([a, b]);
    motion.update(true);
    media.matches = true;
    a.dragTranslate = 100;
    motion.release();
    layout([b, a]);
    a.dragTranslate = 0;
    motion.update(true);
    expect(a.animations).toHaveLength(0);
    expect(b.animations).toHaveLength(0);
  });

  it.each([36, 82])(
    "lands the held compact silhouette before revealing the final %spx row",
    (height) => {
      const { row, visual } = heldRow();
      const peer = new TestRow("peer");
      const header = new TestRow("destination header", 32);
      const { motion, layout, parent } = fixture([row, peer]);
      motion.update(false);
      visual.dragTranslate = 200;
      motion.release();
      const clone = visual.clones[0]!;
      expect(row.style.visibility).toBe("hidden");
      expect(clone.offsetHeight).toBe(36);
      expect(clone.inert).toBe(true);
      expect(clone.attributes).toEqual([
        { name: "role", value: "button" },
        { name: "aria-hidden", value: "true" },
      ]);
      expect(clone.style).toMatchObject({
        position: "fixed",
        top: "208px",
        left: "4px",
        width: "260px",
        height: "36px",
        transform: "none",
        pointerEvents: "none",
      });
      const moved = destinationRow(height);
      parent.getBoundingClientRect = () => ({ top: 50 });
      layout([peer, header, moved]);
      motion.update(true);
      expect(moved.style.visibility).toBe("hidden");
      expect(moved.animations).toHaveLength(0);
      expect(clone.animate).toHaveBeenCalledExactlyOnceWith(
        [{ transform: "translateY(0px)" }, { transform: "translateY(-34px)" }],
        { duration: 68, easing: "cubic-bezier(0.77, 0, 0.175, 1)", fill: "forwards" },
      );
      const animation = clone.animations[0]!;
      animation.progress = 0.5;
      motion.update(true);
      expect(clone.animate).toHaveBeenCalledOnce();
      expect(animation.cancel).not.toHaveBeenCalled();
      expect(moved.style.visibility).toBe("hidden");
      expect(parent.children.includes(clone)).toBe(true);
      animation.finish();
      expect(moved.style.visibility).toBe("");
      expect(row.style.visibility).toBe("");
      expect(parent.children.includes(clone)).toBe(false);
      motion.dispose();
    },
  );

  it("restores headers and peers on the landing clock without cloning destination chrome", () => {
    const { row, visual } = heldRow();
    const marker = new TestRow("destination", 96);
    const chrome = new TestRow("accepted blue destination", 96);
    marker.children = [chrome];
    const peer = new TestRow("peer");
    const { motion, layout } = fixture([marker, row, peer]);
    motion.update(false);
    // A destination expansion is still in flight at release.
    chrome.dragTranslate = 12;
    visual.dragTranslate = -20;
    motion.release();
    marker.offsetHeight = 32;
    marker.children = [new TestRow("updated title", 32)];
    const moved = destinationRow();
    layout([marker, peer, moved]);
    motion.update(true);
    expectDropMove(marker, 12);
    expectDropMove(peer, 147);
    expect(chrome.clones).toHaveLength(0);
    expect(marker.children).toHaveLength(1);
    expect(marker.children[0]!.animations).toHaveLength(0);
    motion.dispose();
  });

  it("returns a cancelled or rejected drop to its original row with one visible visual", () => {
    const { row, visual } = heldRow();
    const { motion, layout, parent } = fixture([row]);
    motion.update(false);
    visual.dragTranslate = 90;
    motion.release();
    const clone = visual.clones[0]!;
    delete row.dataset.threadDragging;
    visual.dragTranslate = 0;
    layout([row]);
    motion.update(true);
    expect(row.style.visibility).toBe("hidden");
    expect(clone.animate).toHaveBeenCalledWith(
      [{ transform: "translateY(0px)" }, { transform: "translateY(-90px)" }],
      { duration: 180, easing: "cubic-bezier(0.77, 0, 0.175, 1)", fill: "forwards" },
    );
    clone.animations[0]!.finish();
    expect(row.style.visibility).toBe("");
    expect(parent.children).toEqual([row]);
    motion.dispose();
  });

  it("keeps a remounted section header aligned with its returning source rows", () => {
    const header = new TestRow("drag source header", 32);
    header.dataset.sidebarMarker = "pinned-divider";
    const peer = new TestRow("source peer");
    peer.dataset.threadItem = "environment:peer";
    const { motion, layout } = fixture([header, peer]);
    header.dragTranslate = 120;
    peer.dragTranslate = 120;
    motion.release();
    const restored = new TestRow("restored source header", 32);
    restored.dataset.sidebarMarker = "pinned-divider";
    layout([restored, peer]);
    peer.dragTranslate = 0;
    motion.update(true);
    expectDropMove(restored, 120);
    expectDropMove(peer, 120);
    motion.dispose();
  });

  it("reveals a nearby full card without pausing a stationary compact visual", () => {
    const { row, visual } = heldRow();
    const { motion, layout, parent } = fixture([row]);
    visual.dragTranslate = 3;
    motion.release();
    const clone = visual.clones[0]!;
    const moved = destinationRow(82);
    layout([moved]);
    motion.update(true);
    expect(clone.animations).toHaveLength(0);
    expect(parent.children.includes(clone)).toBe(false);
    expect(moved.style.visibility).toBe("");
    const restored = moved.children[0]!;
    expect(restored.animate).toHaveBeenCalledExactlyOnceWith(
      [
        { clipPath: "inset(0px 0px 46px 0px)", opacity: 0.5 },
        { clipPath: "inset(0px 0px 0px 0px)", opacity: 1 },
      ],
      { duration: 100, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
    motion.suspend();
    expect(restored.animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(moved.style.visibility).toBe("");
    motion.dispose();
  });

  it("reveals returning section contents after the moving source boundary settles", () => {
    const header = new TestRow("source header", 32);
    header.dataset.sidebarMarker = "pinned-divider";
    const { motion, layout } = fixture([header]);
    motion.release();
    const restored = new TestRow("returning section row", 36);
    restored.dataset.threadItem = "environment:restored";
    layout([restored, header]);
    motion.update(true);
    const reveal = restored.animations[0]!;
    expect(reveal.playState).toBe("paused");
    header.animations[0]!.finish();
    expect(reveal.playState).toBe("running");
    motion.suspend();
    expect(reveal.playState).toBe("idle");
    motion.dispose();
  });

  it.each(["absent", "collapsed"])("cleans a release with an %s destination", (state) => {
    const { row, visual } = heldRow();
    const { motion, layout, parent } = fixture([row]);
    motion.release();
    const clone = visual.clones[0]!;
    const moved = destinationRow(0);
    layout(state === "absent" ? [] : [moved]);
    motion.update(true);
    expect(parent.children.includes(clone)).toBe(false);
    expect(clone.animations).toHaveLength(0);
    expect(row.style.visibility).toBe("");
    expect(moved.style.visibility).toBe("");
    motion.dispose();
  });

  it.each(["suspend", "dispose", "cancel", "rollback", "reduced"])(
    "cleans the landing visual and hidden styles on %s",
    (interruption) => {
      const { row, visual } = heldRow();
      const { motion, layout, parent, media } = fixture([row]);
      motion.update(false);
      visual.dragTranslate = 200;
      motion.release();
      const clone = visual.clones[0]!;
      const moved = destinationRow();
      moved.style.visibility = "inherit";
      layout([moved]);
      motion.update(true);
      const animation = clone.animations[0]!;
      if (interruption === "suspend") motion.suspend();
      if (interruption === "dispose") motion.dispose();
      if (interruption === "cancel") animation.cancel();
      if (interruption === "rollback") {
        layout([destinationRow()]);
        motion.update(true);
      }
      if (interruption === "reduced") {
        media.matches = true;
        const onChange = media.addEventListener.mock.calls[0]![1];
        onChange();
      }
      expect(animation.cancel).toHaveBeenCalled();
      expect(row.style.visibility).toBe("");
      expect(moved.style.visibility).toBe("inherit");
      expect(parent.children.includes(clone)).toBe(false);
      animation.finish();
      expect(moved.style.visibility).toBe("inherit");
      motion.dispose();
      expect(media.removeEventListener).toHaveBeenCalledWith(
        "change",
        media.addEventListener.mock.calls[0]![1],
      );
    },
  );

  it("discards a pending release before another pickup and ignores stale completion", () => {
    const { row, visual } = heldRow();
    const { motion, layout, parent } = fixture([row]);
    motion.release();
    const pending = visual.clones[0]!;
    motion.suspend();
    expect(parent.children).toEqual([row]);
    expect(row.style.visibility).toBe("");
    visual.dragTranslate = 100;
    motion.release();
    layout([destinationRow()]);
    motion.update(true);
    const old = visual.clones[1]!.animations[0]!;
    motion.suspend();
    layout([row]);
    motion.release();
    const current = visual.clones[2]!;
    old.finish();
    expect(parent.children.includes(pending)).toBe(false);
    expect(parent.children.includes(current)).toBe(true);
    expect(row.style.visibility).toBe("hidden");
    motion.dispose();
    expect(row.style.visibility).toBe("");
    expect(parent.children.includes(current)).toBe(false);
  });

  it("skips copying and hiding the held row with reduced motion", () => {
    const { row, visual } = heldRow();
    const { motion, layout, parent, media } = fixture([row]);
    media.matches = true;
    motion.release();
    const moved = destinationRow();
    layout([moved]);
    motion.update(true);
    expect(visual.clones).toHaveLength(0);
    expect(row.style.visibility).toBe("");
    expect(moved.style.visibility).toBe("");
    expect(moved.animations).toHaveLength(0);
    expect(parent.children).toEqual([moved]);
    motion.dispose();
  });

  it("does not carry a canceled drag's transformed position into the next move", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const { motion, layout } = fixture([a, b]);
    motion.update(true);
    motion.suspend();
    a.dragTranslate = 500;
    b.dragTranslate = -83;
    motion.update(false);
    motion.suspend();
    a.dragTranslate = b.dragTranslate = 0;
    motion.update(true);
    expect(a.animate).not.toHaveBeenCalled();
    expect(b.animate).not.toHaveBeenCalled();

    layout([b, a]);
    motion.update(true);
    expectMove(a, -83);
    expectMove(b, 83);
  });

  it("retargets rapid changes from the current visual position", () => {
    const [a, b, c] = [new TestRow("a", 99), new TestRow("b", 99), new TestRow("c", 99)];
    const { motion, layout } = fixture([a, b, c]);
    motion.update(true);
    layout([b, c, a]);
    motion.update(true);
    expectMove(a, -200);
    const first = a.animations[0]!;
    first.progress = 0.25;

    layout([b, a, c]);
    motion.update(true);
    expect(first.cancel).toHaveBeenCalledOnce();
    expectMove(a, -50);
    first.finish();
    motion.suspend();
    expect(a.animations[1]!.cancel).toHaveBeenCalledOnce();
  });

  it("keeps an uninterrupted movement when the layout position does not change", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const { motion, layout } = fixture([a, b]);
    motion.update(true);
    layout([b, a]);
    motion.update(true);
    a.animations[0]!.progress = 0.5;
    motion.update(true);
    expect(a.animate).toHaveBeenCalledOnce();
    expect(a.animations[0]!.cancel).not.toHaveBeenCalled();
  });

  it("cancels owned motion on suspension and never animates a disposed list", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const { motion, layout } = fixture([a, b]);
    motion.update(true);
    layout([b, a]);
    motion.update(true);
    motion.suspend();
    expect(a.animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(b.animations[0]!.cancel).toHaveBeenCalledOnce();
    motion.update(false);
    layout([a, b]);
    motion.update(true);
    motion.dispose();
    expect(a.animations[1]!.cancel).toHaveBeenCalledOnce();
    layout([b, a]);
    motion.update(true);
    expect(a.animate).toHaveBeenCalledTimes(2);
  });

  it("fades a collapsed-shelf exit at its current visual box and a new wake in", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const fresh = new TestRow("new");
    a.setAttribute("data-thread-item", "a");
    a.children = [new TestRow("button")];
    a.children[0]!.setAttribute("id", "thread-control");
    a.children[0]!.setAttribute("data-testid", "thread-control");
    a.children[0]!.setAttribute("data-state", "open");
    const icon = new TestRow("provider icon");
    icon.namespaceURI = "http://www.w3.org/2000/svg";
    icon.setAttribute("id", "provider-mask");
    icon.setAttribute("mask", "url(#provider-mask)");
    a.children.push(icon);
    const { motion, layout, parent } = fixture([a, b]);
    motion.update(true);
    layout([b, a]);
    motion.update(true);
    a.animations[0]!.progress = 0.5;
    layout([b, fresh]);
    motion.update(true);
    expect(a.animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(fresh.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(83px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      {
        duration: 150,
        easing: "ease-out",
      },
    );
    const clone = a.clones[0]!;
    expect(clone.style).toMatchObject({
      position: "absolute",
      top: "49.5px",
      left: "4px",
      width: "260px",
      height: "82px",
      transform: "none",
      pointerEvents: "none",
    });
    expect(clone.inert).toBe(true);
    expect(clone.attributes).toEqual([{ name: "aria-hidden", value: "true" }]);
    expect(clone.children[0]!.attributes).toEqual([{ name: "data-state", value: "open" }]);
    expect(clone.children[1]!.attributes).toEqual(icon.attributes);
    expect(clone.animate).toHaveBeenCalledWith(
      [
        { opacity: 1, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(-83px)" },
      ],
      {
        duration: 150,
        easing: "ease-out",
      },
    );
    expect(parent.children.includes(clone)).toBe(true);
    motion.update(true);
    expect(clone.animations).toHaveLength(1);
    expect(clone.clones).toHaveLength(0);
    clone.animations[0]!.finish();
    expect(parent.children.includes(clone)).toBe(false);
  });

  it("rides entering rows on the shelf displacement so an opened shelf moves as one block", () => {
    const a = new TestRow("a", 40);
    const header = new TestRow("header", 32);
    const x = new TestRow("x", 36);
    const y = new TestRow("y", 36);
    const z = new TestRow("z", 36);
    const { motion, layout } = fixture([a, header, x]);
    motion.update(true);
    layout([a, header, x, y, z]);
    for (const row of [header, x, y, z]) row.offsetTop -= 72;
    motion.update(true);
    expectMove(header, 72);
    expectMove(x, 72);
    expect(a.animate).not.toHaveBeenCalled();
    expect(y.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(72px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 150, easing: "ease-out" },
    );
    expect(z.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(72px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 150, easing: "ease-out" },
    );
  });

  it("rides new rows on a retained header's unfinished travel", () => {
    const header = new TestRow("header", 32);
    const above = new TestRow("above", 39);
    const incoming = new TestRow("incoming", 36);
    const { motion, layout } = fixture([header]);
    motion.update(true);
    layout([above, header]);
    motion.update(true);
    header.animations[0]!.progress = 0.25;
    layout([above, header, incoming]);
    motion.update(true);
    expect(incoming.animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translateY(-30px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: 150, easing: "ease-out" },
    );
  });

  it("cancels in-flight row travel when a bulk update skips animation", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const { motion, layout } = fixture([a, b]);
    motion.update(true);
    layout([b, a]);
    motion.update(true);
    const first = a.animations[0]!;
    first.progress = 0.4;
    const incoming = Array.from({ length: 41 }, (_, index) => new TestRow(`new-${index}`));
    layout(incoming);
    motion.update(true);
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(incoming.every((row) => row.animate.mock.calls.length === 0)).toBe(true);
  });

  it("keeps in-flight shelf entry travel when the shelf closes mid-animation", () => {
    const a = new TestRow("a", 40);
    const header = new TestRow("header", 32);
    const x = new TestRow("x", 36);
    const y = new TestRow("y", 36);
    const { motion, layout } = fixture([a, header, x]);
    motion.update(true);
    layout([a, header, x, y]);
    for (const row of [header, x, y]) row.offsetTop -= 36;
    motion.update(true);
    const entry = y.animations[0]!;
    header.animations[0]!.progress = 0.25;
    x.animations[0]!.progress = 0.25;
    entry.progress = 0.25;
    layout([a, header, x]);
    motion.update(true);
    expect(entry.cancel).toHaveBeenCalledOnce();
    const clone = y.clones[0]!;
    expect(clone.style.top).toBe("110px");
    expect(clone.animate).toHaveBeenCalledWith(
      [
        { opacity: 0.25, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(9px)" },
      ],
      { duration: 150, easing: "ease-out" },
    );
    expectMove(header, -9);
    expectMove(x, -9);
  });

  it("clears exit clones on pickup and does not fade the release commit", () => {
    const [a, b, c] = [new TestRow("a"), new TestRow("b"), new TestRow("c")];
    const { motion, layout, parent } = fixture([a, b]);
    motion.update(false);
    layout([b]);
    motion.update(true);
    const clone = a.clones[0]!;
    motion.suspend();
    expect(clone.animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(parent.children.includes(clone)).toBe(false);
    motion.update(false);
    motion.suspend();
    layout([c]);
    motion.update(true);
    expect(b.clones).toHaveLength(0);
    expect(c.animations).toHaveLength(0);
    layout([c, a]);
    motion.update(true);
    expect(a.animate).toHaveBeenCalledWith(
      [
        { opacity: 0, transform: "translateY(0px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      {
        duration: 150,
        easing: "ease-out",
      },
    );
    motion.dispose();
    expect(a.animations.at(-1)!.cancel).toHaveBeenCalledOnce();
  });

  it("carries entry opacity into a quick exit and removes artifacts on a silent update", () => {
    const a = new TestRow("a");
    const marker = new TestRow("boundary", 0);
    const { motion, layout, parent } = fixture([marker]);
    motion.update(false);
    layout([marker, a]);
    motion.update(true);
    a.animations[0]!.progress = 0.4;
    layout([]);
    motion.update(true);
    expect(marker.clones).toHaveLength(0);
    const clone = a.clones[0]!;
    expect(clone.animate).toHaveBeenCalledWith(
      [
        { opacity: 0.4, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(40px)" },
      ],
      {
        duration: 150,
        easing: "ease-out",
      },
    );
    motion.update(false);
    expect(parent.children).toEqual([]);
    expect(clone.animations[0]!.cancel).toHaveBeenCalledOnce();
  });

  it("retargets an in-flight entry when a later layout shift moves the row", () => {
    const a = new TestRow("a", 40);
    const header = new TestRow("header", 32);
    const x = new TestRow("x", 36);
    const y = new TestRow("y", 36);
    const { motion, layout } = fixture([a, header, x]);
    motion.update(true);
    layout([a, header, x, y]);
    for (const row of [header, x, y]) row.offsetTop -= 36;
    motion.update(true);
    const entry = y.animations[0]!;
    entry.progress = 0.25;
    for (const row of [header, x, y]) row.offsetTop += 40;
    motion.update(true);
    expect(entry.cancel).not.toHaveBeenCalled();
    expectMove(y, -13);
  });

  it("skips fades when a large list change would clone too many rows", () => {
    const rows = Array.from({ length: 41 }, (_, index) => new TestRow(`row-${index}`));
    const { motion, layout, parent } = fixture(rows);
    motion.update(true);
    layout([]);
    motion.update(true);
    expect(rows.every((row) => row.clones.length === 0)).toBe(true);
    expect(parent.children).toHaveLength(0);
    const entering = Array.from({ length: 41 }, (_, index) => new TestRow(`new-${index}`));
    layout(entering);
    motion.update(true);
    expect(entering.every((row) => row.animate.mock.calls.length === 0)).toBe(true);
  });

  it("still slides rows when one removal displaces a large list", () => {
    const rows = Array.from({ length: 60 }, (_, index) => new TestRow(`row-${index}`));
    const { motion, layout } = fixture(rows);
    motion.update(true);
    const [removed, ...rest] = rows;
    layout(rest);
    motion.update(true);
    expect(removed!.clones).toHaveLength(1);
    expect(rest.every((row) => row.animations.length === 1)).toBe(true);
  });

  it("respects reduced motion while keeping the next baseline fresh", () => {
    const a = new TestRow("a");
    const b = new TestRow("b");
    const { motion, layout, media } = fixture([a, b]);
    motion.update(true);
    media.matches = true;
    layout([b, a]);
    motion.update(true);
    expect(a.animate).not.toHaveBeenCalled();
    media.matches = false;
    layout([a, b]);
    motion.update(true);
    expectMove(a, 83);
    expectMove(b, -83);
  });
});

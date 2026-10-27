import type { AnyRouter } from "@tanstack/react-router";
import { expect, it, vi } from "vite-plus/test";

import { dispatchMenuAction } from "../shortcuts/dispatcher";
import { registerNavigationHistoryCommands } from "./AppSidebarLayout";

it("routes desktop history actions and releases them when the shell unmounts", () => {
  using back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  using forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
  using stack = new DisposableStack();
  const unregister = registerNavigationHistoryCommands({} as AnyRouter);
  stack.defer(unregister);

  dispatchMenuAction("navigation.back");
  dispatchMenuAction("navigation.forward");
  expect(back).toHaveBeenCalledOnce();
  expect(forward).toHaveBeenCalledOnce();

  unregister();
  dispatchMenuAction("navigation.back");
  dispatchMenuAction("navigation.forward");
  expect(back).toHaveBeenCalledOnce();
  expect(forward).toHaveBeenCalledOnce();
});

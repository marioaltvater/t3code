import * as Effect from "effect/Effect";
import * as SidebarSections from "../../../sidebar/SidebarSections.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { SectionsToolkit } from "./tools.ts";
export const layer = McpToolAccess.toLayer(SectionsToolkit, {
  t3_section_clients: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      return { clients: yield* (yield* SidebarSections.SidebarSections).clients };
    }),
  ),
  t3_sections_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      return yield* (yield* SidebarSections.SidebarSections).list(input);
    }),
  ),
  t3_thread_assign_section: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        return yield* (yield* SidebarSections.SidebarSections).assign(input);
      }),
  ),
});

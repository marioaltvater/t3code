import {
  SidebarAssignInput,
  SidebarAssignResult,
  SidebarClient,
  SidebarSectionError,
  SidebarSectionsSnapshot,
  SidebarTarget,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Crypto from "effect/Crypto";
import { Tool, Toolkit } from "effect/ai";
import * as SidebarSections from "../../../sidebar/SidebarSections.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
const shared = {
  failure: Schema.Union([SidebarSectionError, OrchestratorMcpFailure]),
  failureMode: "return" as const,
  dependencies: [
    SidebarSections.SidebarSections,
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
    Crypto.Crypto,
  ],
};
const Clients = Tool.make("t3_section_clients", {
  ...shared,
  description:
    "List connected clients supporting named sidebar sections in this environment. environmentId identifies the server, not a client. Use the exact clientId and connectionId; web and desktop have independent local state. Older/offline clients are absent. Never substitute a browser for a desktop.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({ clients: Schema.Array(SidebarClient) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const List = Tool.make("t3_sections_list", {
  ...shared,
  description:
    "Read named sections and ordered membership from the exact target client. Requires environmentId and clientId from t3_section_clients; provide connectionId to bind a particular live connection. Offline, wrong-environment and ambiguous clients fail without fallback. Thread membership is scoped to this environment.",
  parameters: SidebarTarget,
  success: SidebarSectionsSnapshot,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const Assign = Tool.make("t3_thread_assign_section", {
  ...shared,
  description:
    "Assign an exact thread to a named section ID on one exact client, persist and read it back. Default mode=assign preserves existing placement: use mode=move to change a different section. sectionId=null with mode=move removes named membership (keeps pin). Adds only this thread, preserves existing section/member order and existing pin keys, pins an unpinned active thread if needed. Does not wake, unsnooze or unarchive. verified=true requires same-client readback. outcomeUnknown requires readback before retry; no fallback to another client.",
  parameters: SidebarAssignInput,
  success: SidebarAssignResult,
}).annotate(Tool.Destructive, true);
export const SectionsToolkit = Toolkit.make(Clients, List, Assign);

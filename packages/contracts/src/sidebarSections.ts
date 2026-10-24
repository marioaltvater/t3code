import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId } from "./baseSchemas.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SidebarClient = Schema.Struct({
  environmentId: EnvironmentId,
  clientId: TrimmedNonEmptyString,
  connectionId: TrimmedNonEmptyString,
  surface: Schema.Literals(["web", "desktop"]),
});
export type SidebarClient = typeof SidebarClient.Type;
export const SidebarTarget = Schema.Struct({
  environmentId: EnvironmentId,
  clientId: TrimmedNonEmptyString,
  connectionId: Schema.optional(TrimmedNonEmptyString),
});
export type SidebarTarget = typeof SidebarTarget.Type;
export const SidebarSection = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  collapsed: Schema.Boolean,
  threadIds: Schema.Array(ThreadId),
});
export const SidebarSectionsSnapshot = Schema.Struct({
  ...SidebarClient.fields,
  sections: Schema.Array(SidebarSection),
});
export type SidebarSectionsSnapshot = typeof SidebarSectionsSnapshot.Type;
export const SidebarAssignInput = Schema.Struct({
  ...SidebarTarget.fields,
  threadId: ThreadId,
  sectionId: Schema.NullOr(TrimmedNonEmptyString),
  mode: Schema.optional(Schema.Literals(["assign", "move"])),
});
export type SidebarAssignInput = typeof SidebarAssignInput.Type;
export const SidebarSectionErrorReason = Schema.Literals([
  "wrong_environment",
  "client_unavailable",
  "client_ambiguous",
  "client_disconnected",
  "timeout",
  "invalid_response",
  "section_not_found",
  "membership_conflict",
  "persistence_failed",
  "stale_client_state",
  "readback_failed",
  "thread_unavailable",
]);
export class SidebarSectionError extends Schema.TaggedError<SidebarSectionError>()(
  "SidebarSectionError",
  {
    reason: SidebarSectionErrorReason,
    // A lost response can follow a successful write. Callers must read the exact client before retrying.
    outcomeUnknown: Schema.Boolean,
  },
) {
  override get message() {
    return `Sidebar section operation failed: ${this.reason}${this.outcomeUnknown ? "; read the exact client before retrying" : ""}.`;
  }
}
export const SidebarClientRegistration = Schema.Struct({
  environmentId: EnvironmentId,
  clientId: TrimmedNonEmptyString,
  surface: SidebarClient.fields.surface,
});
export type SidebarClientRegistration = typeof SidebarClientRegistration.Type;
export const SidebarSectionRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("list"), requestId: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("assign"),
    requestId: TrimmedNonEmptyString,
    threadId: ThreadId,
    sectionId: Schema.NullOr(TrimmedNonEmptyString),
    expectedSectionId: Schema.NullOr(TrimmedNonEmptyString),
  }),
]);
export type SidebarSectionRequest = typeof SidebarSectionRequest.Type;
export const SidebarSectionEvent = Schema.Struct({
  ...SidebarClient.fields,
  request: SidebarSectionRequest,
});
export type SidebarSectionEvent = typeof SidebarSectionEvent.Type;
export const SidebarSectionResponse = Schema.Struct({
  ...SidebarClient.fields,
  requestId: TrimmedNonEmptyString,
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), snapshot: SidebarSectionsSnapshot }),
    Schema.Struct({ ok: Schema.Literal(false), error: SidebarSectionError }),
  ]),
});
export type SidebarSectionResponse = typeof SidebarSectionResponse.Type;
export const SidebarAssignResult = Schema.Struct({
  ...SidebarSectionsSnapshot.fields,
  threadId: ThreadId,
  sectionId: Schema.NullOr(TrimmedNonEmptyString),
  verified: Schema.Literal(true),
});

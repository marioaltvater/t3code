import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SymphonyBusError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/http";
import { McpSchema } from "effect/ai";

interface Exchange {
  readonly endpoint: string;
  readonly identity: string;
  readonly principal: string;
  readonly role: string;
  readonly topics: ReadonlyArray<string>;
  readonly operation: "whoami" | "inbox" | "publish" | "claim_context";
  readonly args: Readonly<Record<string, unknown>>;
  readonly assertCurrent: Effect.Effect<void, SymphonyBusError>;
}
export class SymphonyBusTransport extends Context.Service<
  SymphonyBusTransport,
  {
    readonly exchange: (input: Exchange) => Effect.Effect<Schema.Json, SymphonyBusError>;
  }
>()("t3/symphony/SymphonyBusTransport") {}

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);
const decodeToolResult = Schema.decodeUnknownEffect(McpSchema.CallToolResult);
const decodeText = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));
const WhoAmI = Schema.Struct({
  identity: Schema.Struct({
    agent_id: Schema.String,
    principal: Schema.String,
    kind: Schema.String,
    declared: Schema.Boolean,
    declaration_error: Schema.NullOr(Schema.String),
    role: Schema.optional(Schema.String),
  }),
  bus: Schema.Struct({ subscriptions: Schema.Array(Schema.String) }),
});
const decodeWhoAmI = Schema.decodeUnknownEffect(WhoAmI);
const decodeInboxIdentity = Schema.decodeUnknownEffect(Schema.Struct({ agent_id: Schema.String }));
const Sequence = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const ClaimPage = Schema.Struct({
  events: Schema.Array(Schema.Json).check(Schema.isMaxLength(500)),
  next_seq: Sequence,
  head_seq: Sequence,
  oldest_seq: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  ),
  gap: Schema.Boolean,
  truncated: Schema.Boolean,
  generated_at: Schema.String,
});
const decodeClaimPage = Schema.decodeUnknownEffect(ClaimPage);
const ClaimDate = Schema.String.check(
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), {
    expected: "an authoritative claim timestamp",
  }),
);
const ClaimPrincipal = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/));
const ClaimAgent = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/));
// Match the frozen publisher's issue-reference grammar, including non-GitHub lanes.
const ClaimIssue = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      /^(?:#?\d{1,9}|github[-:]\d{1,9}|[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*-\d{1,9})$/i.test(
        value.trim(),
      ) ||
      /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\d{1,9}(?:[/#?].*)?$/i.test(
        value.trim(),
      ),
    { expected: "a publisher-supported issue reference" },
  ),
);
const decodeClaimEvent = Schema.decodeUnknownEffect(
  Schema.Struct({
    seq: Sequence,
    type: Schema.Literal("claim"),
    ts: ClaimDate,
    from: Schema.Struct({ principal: ClaimPrincipal, agent_id: ClaimAgent }),
    topics: Schema.Array(Schema.String),
    data: Schema.Struct({
      claim: Schema.Struct({
        issues: Schema.Array(ClaimIssue),
        paths: Schema.Array(Schema.String),
        expires_at: ClaimDate,
      }),
    }),
  }),
);
export const SymphonyClaimRead = Schema.Struct({
  events: Schema.Array(Schema.Json).check(Schema.isMaxLength(20_000)),
  next_seq: Sequence,
  head_seq: Sequence,
  generated_at: Schema.String,
});
const unavailable = (cause: unknown) =>
  new SymphonyBusError({
    code: "unavailable",
    message:
      "The Symphony bus did not complete this request. Retry a publication only with its original idempotency key.",
    cause,
  });

const make = Effect.gen(function* () {
  const fetch = yield* FetchHttpClient.Fetch;
  const exchange = Effect.fn("SymphonyBusTransport.exchange")(function* (input: Exchange) {
    yield* input.assertCurrent;
    const { client, transport } = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const client = new Client({ name: "t3-conversation-bus", version: "1" });
        const headers = {
          "X-Symphony-Agent-Id": input.identity,
          "X-Symphony-Principal": input.principal,
          "X-Symphony-Agent-Kind": "codex",
          "X-Symphony-Agent-Role": input.role,
        };
        const transport = new StreamableHTTPClientTransport(new URL(input.endpoint), {
          requestInit: { headers },
          // One bounded connection per operation. Never forward identity across a redirect or retry a publish.
          fetch: async (url, init) => {
            // This bounded client uses POST response streams, like the frozen bus client.
            // An idle notification GET can stall tool requests on the current sidecar.
            if (init?.method === "GET") return new Response(null, { status: 405 });
            return fetch(url, {
              ...init,
              redirect: "error",
              signal: AbortSignal.any([
                ...(init?.signal ? [init.signal] : []),
                AbortSignal.timeout(5000),
              ]),
            });
          },
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
          },
        });
        return { client, transport, headers };
      }),
      ({ client, transport, headers }) =>
        Effect.tryPromise({
          try: async () => {
            try {
              // Initialization can abort the SDK transport after a remote session was allocated.
              // Cleanup has its own bounded signal, identity and session, including after revocation.
              const session = transport.sessionId;
              if (session) {
                const version = transport.protocolVersion;
                await fetch(input.endpoint, {
                  method: "DELETE",
                  redirect: "error",
                  headers: {
                    ...headers,
                    "mcp-session-id": session,
                    ...(version ? { "mcp-protocol-version": version } : {}),
                  },
                  signal: AbortSignal.timeout(2000),
                });
              }
            } finally {
              await client.close();
            }
          },
          catch: unavailable,
        }).pipe(Effect.ignore),
    );
    // The SDK's sessionId getter returns undefined; hide that optional metadata in its strict TS transport view.
    const connection: Omit<StreamableHTTPClientTransport, "sessionId"> = transport;
    yield* Effect.tryPromise({
      try: (signal) => client.connect(connection, { signal, timeout: 5000 }),
      catch: unavailable,
    });
    const call = Effect.fn("SymphonyBusTransport.call")(function* (
      name: string,
      args: Record<string, unknown>,
    ) {
      yield* input.assertCurrent;
      const raw = yield* Effect.tryPromise({
        try: (signal) =>
          client.callTool({ name, arguments: args }, undefined, { signal, timeout: 5000 }),
        catch: unavailable,
      });
      const response = yield* decodeToolResult(raw).pipe(Effect.mapError(unavailable));
      if (response.isError) return yield* unavailable(response);
      const payload =
        response.structuredContent !== undefined
          ? yield* decodeJson(response.structuredContent).pipe(Effect.mapError(unavailable))
          : yield* decodeText(response.content.find((item) => item.type === "text")?.text).pipe(
              Effect.mapError(unavailable),
            );
      yield* input.assertCurrent;
      return payload;
    });
    const whoPayload = yield* call("symphony_whoami", {});
    const who = yield* decodeWhoAmI(whoPayload).pipe(Effect.mapError(unavailable));
    if (
      !who.identity.declared ||
      who.identity.declaration_error !== null ||
      who.identity.agent_id !== input.identity ||
      who.identity.principal !== input.principal ||
      who.identity.kind !== "codex" ||
      (who.identity.role !== undefined && who.identity.role !== input.role)
    ) {
      return yield* new SymphonyBusError({
        code: "identity_mismatch",
        message:
          "The bus did not confirm this conversation's identity. No inbox or publication was admitted.",
      });
    }
    const actual = new Set(who.bus.subscriptions);
    // Engine updates and direct self-addressing remain available; unrelated repository/history scope does not.
    const allowed = new Set([...input.topics, "agents", "broadcast", `agent:${input.identity}`]);
    if (
      input.topics.some((topic) => !actual.has(topic)) ||
      [...actual].some((topic) => !allowed.has(topic))
    ) {
      return yield* new SymphonyBusError({
        code: "scope_mismatch",
        message:
          "Bus subscriptions do not match this conversation's explicit scope. Delivery remains pending.",
      });
    }
    if (input.operation === "whoami") return whoPayload;
    if (input.operation === "claim_context") {
      const events: Array<Schema.Json> = [];
      let cursor = 0;
      let head = 0;
      for (let page = 0; page < 40; page++) {
        const result = yield* call("symphony_changes_since", {
          after_seq: cursor,
          types: ["claim"],
          limit: 500,
        });
        const read = yield* decodeClaimPage(result).pipe(Effect.mapError(unavailable));
        if (
          read.gap ||
          read.next_seq < cursor ||
          read.head_seq < read.next_seq ||
          read.head_seq < head ||
          // gap:false at after_seq:0 does not establish an unpruned journal.
          (read.oldest_seq === null
            ? read.head_seq !== 0 || read.events.length !== 0
            : read.oldest_seq > read.head_seq || read.oldest_seq - 1 > cursor) ||
          !Number.isFinite(Date.parse(read.generated_at))
        )
          return yield* unavailable(null);
        let previous = cursor;
        for (const raw of read.events) {
          const event = yield* decodeClaimEvent(raw).pipe(Effect.mapError(unavailable));
          if (event.seq <= previous || event.seq > read.next_seq) return yield* unavailable(null);
          previous = event.seq;
          if (read.oldest_seq === null || event.seq < read.oldest_seq)
            return yield* unavailable(null);
        }
        // Filtered reads may skip non-claim events, but never a returned claim.
        if (
          read.events.length > 0
            ? read.next_seq !== previous
            : read.truncated || read.next_seq !== Math.max(cursor, read.head_seq)
        )
          return yield* unavailable(null);
        events.push(...read.events);
        head = read.head_seq;
        if (!read.truncated)
          return {
            events,
            next_seq: read.next_seq,
            head_seq: head,
            generated_at: read.generated_at,
          };
        if (read.next_seq === cursor) return yield* unavailable(null);
        cursor = read.next_seq;
      }
      return yield* unavailable(null);
    }
    const payload = yield* call(`symphony_${input.operation}`, { ...input.args });
    if (input.operation === "inbox") {
      const inbox = yield* decodeInboxIdentity(payload).pipe(Effect.mapError(unavailable));
      if (inbox.agent_id !== input.identity)
        return yield* new SymphonyBusError({
          code: "identity_mismatch",
          message: "The inbox response belongs to another identity. No cursor was advanced.",
        });
    }
    return payload;
  }, Effect.scoped);
  return SymphonyBusTransport.of({ exchange });
});
export const layer = Layer.effect(SymphonyBusTransport, make);

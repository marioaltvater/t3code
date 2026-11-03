import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";

const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const object = (value: unknown): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : {};
const array = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);
const text = (value: unknown) => String(value ?? "");
const lower = (value: unknown) => text(value).trim().toLowerCase();
const samePrincipal = (a: unknown, b: unknown) => lower(a) !== "" && lower(a) === lower(b);
const issueNumber = (value: unknown) => {
  const match = /^(?:#|github[-:])?(\d{1,9})$/i.exec(text(value).trim());
  return match ? Number(match[1]) : null;
};
const topicNumbers = (value: unknown, kind: "graph" | "issue") =>
  array(value).flatMap((topic) => {
    const match = new RegExp(`^${kind}:(?:github-)?(\\d{1,9})$`).exec(text(topic));
    return match ? [Number(match[1])] : [];
  });
const normalizedPath = (value: unknown) =>
  text(value)
    .trim()
    .replace(/^(\.\/)+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
export const pathsOverlap = (a: unknown, b: unknown) => {
  const x = normalizedPath(a);
  const y = normalizedPath(b);
  return Boolean(x && y) && (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`));
};
interface ClaimFact {
  readonly seq: number;
  readonly ts: number;
  readonly exp: number;
  readonly principal: string;
  readonly agent_id: string;
  readonly issues: ReadonlyArray<number>;
  readonly paths: ReadonlyArray<string>;
  readonly topics: ReadonlyArray<unknown>;
}
interface LiveClaim {
  readonly issue: number | null;
  readonly principal: string;
  readonly agent_id: string;
  readonly tenure_seq: number;
  readonly seq: number;
  readonly ts: string;
  readonly expires_at: string;
  readonly paths: ReadonlyArray<string>;
  readonly topics: ReadonlyArray<unknown>;
}
const claimFact = (raw: unknown): ClaimFact | null => {
  const event = object(raw);
  const from = object(event.from);
  const data = object(event.data);
  const claim = object(data.claim);
  const principal = typeof from.principal === "string" ? from.principal : "";
  const ts = Date.parse(text(event.ts));
  const exp = Date.parse(text(claim.expires_at));
  if (
    event.type !== "claim" ||
    !isRecord(data.claim) ||
    !principal ||
    typeof event.seq !== "number" ||
    !Number.isInteger(event.seq) ||
    !Number.isFinite(ts) ||
    !Number.isFinite(exp)
  )
    return null;
  return {
    seq: event.seq,
    ts,
    exp,
    principal,
    agent_id: text(from.agent_id),
    issues: [
      ...new Set(
        array(claim.issues).flatMap((i) => {
          const n = issueNumber(i);
          return n === null ? [] : [n];
        }),
      ),
    ],
    paths: array(claim.paths).filter(
      (p): p is string => typeof p === "string" && Boolean(p.trim()),
    ),
    topics: array(event.topics),
  };
};
const liveAt = (f: ClaimFact, at: number) => f.exp - f.ts > 60_000 && f.exp - at > 60_000;
const shape = (issue: number | null, tenure: number, f: ClaimFact): LiveClaim => ({
  issue,
  principal: f.principal,
  agent_id: f.agent_id,
  tenure_seq: tenure,
  seq: f.seq,
  ts: DateTime.formatIso(DateTime.makeUnsafe(f.ts)),
  expires_at: DateTime.formatIso(DateTime.makeUnsafe(f.exp)),
  paths: f.paths,
  topics: f.topics,
});
export function liveClaims(events: ReadonlyArray<unknown>, now: number): ReadonlyArray<LiveClaim> {
  const facts = events
    .flatMap((raw) => {
      const f = claimFact(raw);
      return f ? [f] : [];
    })
    .sort((a, b) => a.seq - b.seq);
  const seen = new Set<number>();
  const runs = new Map<string, { issue: number; tenure: number; last: ClaimFact }>();
  const pathOnly = new Map<string, ClaimFact>();
  for (const f of facts) {
    if (seen.has(f.seq)) continue;
    seen.add(f.seq);
    if (!f.issues.length) {
      pathOnly.set(`${lower(f.principal)}\n${f.agent_id}`, f);
      continue;
    }
    for (const issue of f.issues) {
      const key = `${lower(f.principal)}\n${issue}`;
      const run = runs.get(key);
      if (f.exp - f.ts <= 60_000) runs.delete(key);
      else if (run && liveAt(run.last, f.ts)) run.last = f;
      else runs.set(key, { issue, tenure: f.seq, last: f });
    }
  }
  const out: Array<LiveClaim> = [];
  for (const run of runs.values())
    if (liveAt(run.last, now)) out.push(shape(run.issue, run.tenure, run.last));
  for (const f of pathOnly.values())
    if (liveAt(f, now) && f.paths.length) out.push(shape(null, f.seq, f));
  return out.sort((a, b) => a.tenure_seq - b.tenure_seq || a.seq - b.seq);
}
export interface SymphonyTriageContext {
  readonly target: string;
  readonly principal: string;
  readonly issues: ReadonlyArray<number>;
  readonly paths: ReadonlyArray<string>;
  readonly graphs: ReadonlyArray<number>;
  readonly aliases: ReadonlyArray<string>;
}
export const triageContext = (input: {
  readonly target: string;
  readonly principal: string;
  readonly claimEvents: ReadonlyArray<unknown>;
  readonly now: number;
  readonly graphs: ReadonlyArray<number>;
  readonly aliases?: ReadonlyArray<string>;
}): SymphonyTriageContext => {
  const mine = liveClaims(input.claimEvents, input.now).filter((c) =>
    samePrincipal(c.principal, input.principal),
  );
  return {
    target: input.target,
    principal: input.principal,
    issues: [...new Set(mine.flatMap((c) => (c.issue === null ? [] : [c.issue])))],
    paths: [...new Set(mine.flatMap((c) => c.paths))],
    graphs: [
      ...new Set([...mine.flatMap((c) => topicNumbers(c.topics, "graph")), ...input.graphs]),
    ],
    aliases: [...new Set(input.aliases ?? [])],
  };
};
export interface SymphonyTriageHit {
  readonly reason:
    | "human"
    | "addressed"
    | "engine_update"
    | "review"
    | "collision"
    | "landing"
    | "handoff"
    | "supersedes";
  readonly human: boolean;
  readonly message: boolean;
}
const hit = (
  reason: SymphonyTriageHit["reason"],
  human = false,
  message = true,
): SymphonyTriageHit => ({ reason, human, message });
const eventIssues = (event: Readonly<Record<string, unknown>>) => {
  const ref = issueNumber(event.issue ?? object(event.refs).issue);
  return [...new Set([...topicNumbers(event.topics, "issue"), ...(ref === null ? [] : [ref])])];
};
export function classify(raw: unknown, ctx: SymphonyTriageContext): SymphonyTriageHit | null {
  if (!isRecord(raw) || !ctx.target || !ctx.principal) return null;
  const type = text(raw.type);
  const from = object(raw.from);
  const sender = text(from.agent_id);
  if (!type || type.startsWith("symphony") || sender === `v12:${ctx.principal}:watcher`)
    return null;
  const data = object(raw.data);
  const question = object(data.question);
  const forRole =
    typeof raw.for_role === "string" && raw.for_role.trim() ? raw.for_role : question.for_role;
  const role = lower(typeof forRole === "string" ? forRole : "");
  const other = !samePrincipal(from.principal, ctx.principal);
  if (role === `human:${lower(ctx.principal)}`) return hit("human", true, sender !== ctx.target);
  const mailboxes = [ctx.target, ...ctx.aliases];
  const addressed = mailboxes.some(
    (id) => array(raw.topics).includes(`agent:${id}`) || array(raw.deliver_to).includes(id),
  );
  if (
    sender !== ctx.target &&
    (addressed || role === "orchestrator" || role === `orchestrator:${lower(ctx.principal)}`)
  )
    return hit("addressed");
  if (
    sender !== ctx.target &&
    type === "note" &&
    text(raw.body).split(/\r?\n/, 1)[0]?.trim() === "symphony:engine_update"
  )
    return hit("engine_update");
  if (!other) return null;
  if (
    type === "review" ||
    (type === "question" && (role === "reviewer" || role === `reviewer:${lower(ctx.principal)}`))
  )
    return hit("review");
  const claim = object(data.claim);
  if (type === "claim" && isRecord(data.claim)) {
    const span = Date.parse(text(claim.expires_at)) - Date.parse(text(raw.ts));
    if (
      Number.isFinite(span) &&
      span > 60_000 &&
      (array(claim.issues).some((i) => {
        const n = issueNumber(i);
        return n !== null && ctx.issues.includes(n);
      }) ||
        array(claim.paths).some(
          (p) => typeof p === "string" && ctx.paths.some((ours) => pathsOverlap(ours, p)),
        ))
    )
      return hit("collision");
  }
  const ours =
    eventIssues(raw).some((n) => ctx.issues.includes(n)) ||
    topicNumbers(raw.topics, "graph").some((n) => ctx.graphs.includes(n));
  if ((type === "landing" || type === "handoff") && ours) return hit(type);
  if (type === "decision" && text(object(data.decision).supersedes).trim() && ours)
    return hit("supersedes");
  return null;
}

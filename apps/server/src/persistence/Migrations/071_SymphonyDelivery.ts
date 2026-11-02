import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE symphony_delivery_state (
    environment_id TEXT NOT NULL, thread_id TEXT NOT NULL, identity TEXT NOT NULL,
    record_json TEXT NOT NULL, PRIMARY KEY(environment_id, thread_id, identity)
  )`;
  yield* sql`CREATE TABLE symphony_delivery_batches (
    token TEXT PRIMARY KEY, environment_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    identity TEXT NOT NULL, lane TEXT NOT NULL, status TEXT NOT NULL, record_json TEXT NOT NULL
  )`;
  yield* sql`CREATE UNIQUE INDEX idx_symphony_pending_delivery
    ON symphony_delivery_batches(environment_id, thread_id, identity, lane) WHERE status = 'pending'`;
});

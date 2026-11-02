import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE symphony_thread_participation (
    environment_id TEXT NOT NULL, thread_id TEXT NOT NULL, identity TEXT,
    holds_identity INTEGER NOT NULL, record_json TEXT NOT NULL,
    PRIMARY KEY (environment_id, thread_id)
  )`;
  yield* sql`CREATE UNIQUE INDEX idx_symphony_participant_identity
    ON symphony_thread_participation(environment_id, identity) WHERE holds_identity = 1`;
  yield* sql`CREATE TABLE symphony_participation_requests (
    environment_id TEXT NOT NULL, thread_id TEXT NOT NULL, client_request_id TEXT NOT NULL,
    request_json TEXT NOT NULL, response_json TEXT NOT NULL,
    PRIMARY KEY (environment_id, thread_id, client_request_id)
  )`;
});

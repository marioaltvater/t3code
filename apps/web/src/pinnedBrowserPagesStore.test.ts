import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { createJSONStorage } from "zustand/middleware";
import { expect, it } from "vite-plus/test";

import { createMemoryStorage } from "./lib/storage";
import { usePinnedBrowserPagesStore as store } from "./pinnedBrowserPagesStore";

const ref = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("thread") };
const page = { url: "https://example.com/docs#setup", title: "Setup", profileId: "work" };
const STORAGE_KEY = "t3code:pinned-browser-pages:v1";

function setup() {
  const storage = createMemoryStorage();
  store.persist.setOptions({ storage: createJSONStorage(() => storage) });
  store.setState({ byThreadKey: {} });
  return storage;
}

it("pins once per URL and profile, separately for each thread and environment", () => {
  setup();
  const otherThread = { ...ref, threadId: ThreadId.make("other") };
  const otherEnvironment = { ...ref, environmentId: EnvironmentId.make("remote") };
  store.getState().pin(ref, page);
  store.getState().pin(ref, { ...page, title: "Changed title" });
  store.getState().pin(ref, { ...page, profileId: "personal" });
  store.getState().pin(otherThread, page);
  store.getState().pin(otherEnvironment, page);
  expect(store.getState().byThreadKey[scopedThreadKey(ref)]).toEqual([
    page,
    { ...page, profileId: "personal" },
  ]);
  store.getState().unpin(ref, page);
  expect(store.getState().byThreadKey[scopedThreadKey(ref)]).toEqual([
    { ...page, profileId: "personal" },
  ]);
  expect(store.getState().byThreadKey[scopedThreadKey(otherThread)]).toEqual([page]);
  expect(store.getState().byThreadKey[scopedThreadKey(otherEnvironment)]).toEqual([page]);
});

it("rehydrates saved pins after a restart and persists unpinning", async () => {
  const storage = setup();
  store.getState().pin(ref, page);
  const saved = storage.getItem(STORAGE_KEY);
  store.setState({ byThreadKey: {} });
  storage.setItem(STORAGE_KEY, String(saved));
  await store.persist.rehydrate();
  expect(store.getState().byThreadKey[scopedThreadKey(ref)]).toEqual([page]);
  store.getState().unpin(ref, page);
  await store.persist.rehydrate();
  expect(store.getState().byThreadKey).toEqual({});
});

it("rejects unsupported pages and strips URL credentials", () => {
  setup();
  store.getState().pin(ref, { ...page, url: "about:blank" });
  store.getState().pin(ref, { ...page, url: "javascript:alert(1)" });
  expect(store.getState().byThreadKey).toEqual({});
  store.getState().pin(ref, { ...page, url: "https://user:password@example.com/docs#setup" });
  expect(store.getState().byThreadKey[scopedThreadKey(ref)]).toEqual([page]);
});

it("ignores malformed persisted entries and duplicate pins", async () => {
  const storage = setup();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      state: {
        byThreadKey: {
          [scopedThreadKey(ref)]: [null, page, page, { url: "oops" }],
          broken: "not an array",
        },
      },
      version: 0,
    }),
  );
  await store.persist.rehydrate();
  expect(store.getState().byThreadKey).toEqual({ [scopedThreadKey(ref)]: [page] });
});

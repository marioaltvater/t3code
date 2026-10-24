import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_BROWSER_PROFILE_ID,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { pinnedPageUrlKey } from "./browser/pinnedPageAsset";

export interface PinnedBrowserPage {
  url: string;
  title: string;
  profileId: string;
}

function sanitizePage(value: unknown): PinnedBrowserPage | null {
  if (!value || typeof value !== "object") return null;
  const { url, title, profileId } = value as Record<string, unknown>;
  if (typeof url !== "string" || typeof profileId !== "string" || !profileId) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.username = parsed.password = "";
    return {
      url: parsed.href,
      title: typeof title === "string" ? title.trim().slice(0, 512) : "",
      profileId,
    };
  } catch {
    return null;
  }
}

export function pinnedPageFromSnapshot(
  snapshot: PreviewSessionSnapshot | null,
): PinnedBrowserPage | null {
  if (!snapshot || snapshot.navStatus._tag === "Idle") return null;
  return sanitizePage({
    url: snapshot.navStatus.url,
    title: snapshot.navStatus.title,
    profileId: snapshot.profileId ?? DEFAULT_BROWSER_PROFILE_ID,
  });
}

export function samePinnedPage(left: PinnedBrowserPage, right: PinnedBrowserPage): boolean {
  return (
    left.profileId === right.profileId && pinnedPageUrlKey(left.url) === pinnedPageUrlKey(right.url)
  );
}

function restorePages(value: unknown): Record<string, PinnedBrowserPage[]> {
  if (!value || typeof value !== "object" || !("byThreadKey" in value)) return {};
  const raw = value.byThreadKey;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, entries]) => {
      if (!Array.isArray(entries)) return [];
      const pages: PinnedBrowserPage[] = [];
      for (const entry of entries) {
        const page = sanitizePage(entry);
        if (page && !pages.some((existing) => samePinnedPage(existing, page))) pages.push(page);
      }
      return pages.length ? [[key, pages]] : [];
    }),
  );
}

interface PinnedBrowserPagesState {
  byThreadKey: Record<string, PinnedBrowserPage[]>;
  pin: (ref: ScopedThreadRef, page: PinnedBrowserPage) => void;
  unpin: (ref: ScopedThreadRef, page: PinnedBrowserPage) => void;
}

export const usePinnedBrowserPagesStore = create<PinnedBrowserPagesState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      pin: (ref, input) => {
        const page = sanitizePage(input);
        if (!page) return;
        const key = scopedThreadKey(ref);
        set((state) => {
          const pages = state.byThreadKey[key] ?? [];
          if (pages.some((existing) => samePinnedPage(existing, page))) return state;
          return { byThreadKey: { ...state.byThreadKey, [key]: [...pages, page] } };
        });
      },
      unpin: (ref, page) =>
        set((state) => {
          const key = scopedThreadKey(ref);
          const pages = state.byThreadKey[key];
          if (!pages) return state;
          const next = pages.filter((existing) => !samePinnedPage(existing, page));
          const byThreadKey = { ...state.byThreadKey };
          if (next.length) byThreadKey[key] = next;
          else delete byThreadKey[key];
          return { byThreadKey };
        }),
    }),
    {
      name: "t3code:pinned-browser-pages:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      merge: (persisted, current) => ({ ...current, byThreadKey: restorePages(persisted) }),
    },
  ),
);

const EMPTY_PAGES: readonly PinnedBrowserPage[] = [];

export function usePinnedBrowserPages(ref: ScopedThreadRef): readonly PinnedBrowserPage[] {
  return usePinnedBrowserPagesStore(
    (state) => state.byThreadKey[scopedThreadKey(ref)] ?? EMPTY_PAGES,
  );
}

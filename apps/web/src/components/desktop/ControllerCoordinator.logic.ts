export function appendDictationText(prompt: string, transcript: string): string | null {
  const text = transcript.trim();
  if (!text) return null;
  return prompt.length > 0 ? `${prompt}\n${text}` : text;
}

export function resolveDictationTarget(input: {
  readonly draftId: string;
  readonly originalRef: { readonly environmentId: string; readonly threadId: string };
  readonly currentSession: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly promotedTo?: { readonly environmentId: string; readonly threadId: string } | null;
  } | null;
  readonly canonicalThreadExists: boolean;
}): { readonly environmentId: string; readonly threadId: string } | string | null {
  const sameRef = (
    left: { environmentId: string; threadId: string },
    right: { environmentId: string; threadId: string },
  ) => left.environmentId === right.environmentId && left.threadId === right.threadId;
  if (input.currentSession) {
    if (sameRef(input.currentSession, input.originalRef)) {
      return input.currentSession.promotedTo ?? input.draftId;
    }
    if (
      input.currentSession.promotedTo &&
      sameRef(input.currentSession.promotedTo, input.originalRef)
    ) {
      return input.originalRef;
    }
    return null;
  }
  return input.canonicalThreadExists ? input.originalRef : null;
}

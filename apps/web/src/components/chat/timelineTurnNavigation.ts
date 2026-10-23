export interface TimelineTurnNavigationState {
  identity: string;
  cursorItemId: string | null;
  scrollEpoch: number;
  inFlightScrolls: number;
}

export function createTimelineTurnNavigationState(identity: string): TimelineTurnNavigationState {
  return { identity, cursorItemId: null, scrollEpoch: 0, inFlightScrolls: 0 };
}

export function resetTimelineTurnNavigation(
  state: TimelineTurnNavigationState,
  identity = state.identity,
): void {
  state.identity = identity;
  state.cursorItemId = null;
  state.scrollEpoch += 1;
  state.inFlightScrolls = 0;
}

export function clearTimelineTurnCursor(
  state: TimelineTurnNavigationState,
  identity: string,
): void {
  if (state.identity !== identity) resetTimelineTurnNavigation(state, identity);
  else state.cursorItemId = null;
}

function resolveTimelineTurnTarget(input: {
  readonly state: TimelineTurnNavigationState;
  readonly identity: string;
  readonly itemIds: ReadonlyArray<string>;
  readonly currentIndex: number | null;
  readonly isAtEnd: boolean;
  readonly direction: -1 | 1;
}): number | null {
  const { state, identity, itemIds } = input;
  if (state.identity !== identity) resetTimelineTurnNavigation(state, identity);
  if (itemIds.length === 0) {
    state.cursorItemId = null;
    return null;
  }

  const cursorIndex = state.cursorItemId === null ? -1 : itemIds.indexOf(state.cursorItemId);
  const currentIndex =
    cursorIndex >= 0 ? cursorIndex : input.isAtEnd ? itemIds.length - 1 : (input.currentIndex ?? 0);
  const current = Math.max(0, Math.min(itemIds.length - 1, currentIndex));
  const target = Math.max(0, Math.min(itemIds.length - 1, current + input.direction));
  state.cursorItemId = itemIds[target] ?? null;
  return target === current ? null : target;
}

function beginTimelineTurnScroll(state: TimelineTurnNavigationState, identity: string): number {
  if (state.identity !== identity) resetTimelineTurnNavigation(state, identity);
  state.inFlightScrolls += 1;
  return state.scrollEpoch;
}

function finishTimelineTurnScroll(
  state: TimelineTurnNavigationState,
  identity: string,
  scrollEpoch: number,
): void {
  if (state.identity !== identity || state.scrollEpoch !== scrollEpoch) return;
  state.inFlightScrolls = Math.max(0, state.inFlightScrolls - 1);
}

export function navigateTimelineTurn(input: {
  readonly state: TimelineTurnNavigationState;
  readonly identity: string;
  readonly items: ReadonlyArray<{ readonly id: string; readonly rowIndex: number }>;
  readonly currentIndex: number | null;
  readonly isAtEnd: boolean;
  readonly direction: -1 | 1;
  readonly beforeNavigate: () => void;
  readonly scrollToIndex: (rowIndex: number) => Promise<void>;
}): boolean {
  const target = resolveTimelineTurnTarget({
    state: input.state,
    identity: input.identity,
    itemIds: input.items.map((item) => item.id),
    currentIndex: input.currentIndex,
    isAtEnd: input.isAtEnd,
    direction: input.direction,
  });
  if (target === null) return false;

  input.beforeNavigate();
  const scrollEpoch = beginTimelineTurnScroll(input.state, input.identity);
  const finish = () => finishTimelineTurnScroll(input.state, input.identity, scrollEpoch);
  let scrolling: Promise<void>;
  try {
    scrolling = input.scrollToIndex(input.items[target]!.rowIndex);
  } catch (error) {
    finish();
    throw error;
  }
  void scrolling.then(finish, finish);
  return true;
}

export function isTimelineTurnScrollInFlight(
  state: TimelineTurnNavigationState,
  identity: string,
): boolean {
  return state.identity === identity && state.inFlightScrolls > 0;
}

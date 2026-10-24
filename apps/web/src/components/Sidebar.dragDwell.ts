export function createSidebarDragDwell() {
  let target: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
    target = null;
  };
  return {
    clear,
    update(nextTarget: string | null, onDwell: (target: string) => void) {
      if (nextTarget === target) return;
      clear();
      if (nextTarget === null) return;
      target = nextTarget;
      timer = setTimeout(() => {
        clear();
        onDwell(nextTarget);
      }, 350);
    },
  };
}

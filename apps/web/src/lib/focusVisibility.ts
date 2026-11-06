import { isEditableFocused } from "./editableFocus";

const navigationKeys = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);
const textInputTypes = new Set(["text", "search", "email", "url", "tel", "password"]);

export function installFocusVisibility(target: Window): () => void {
  const root = target.document.documentElement;
  const reset = () => root.removeAttribute("data-keyboard-navigation");
  const onKeyDown = (event: KeyboardEvent) => {
    // OS shortcuts can reach Chromium before the window loses focus.
    if (event.metaKey || event.ctrlKey || event.altKey || event.key === "Meta") {
      reset();
      return;
    }
    if (!navigationKeys.has(event.key)) return;
    const eventTarget = event.composedPath()[0] ?? event.target;
    const editingText =
      eventTarget instanceof HTMLInputElement
        ? textInputTypes.has(eventTarget.type) &&
          eventTarget.getAttribute("role") !== "spinbutton" &&
          eventTarget.dataset.slot !== "number-field-input"
        : !(eventTarget instanceof HTMLSelectElement) && isEditableFocused(eventTarget);
    if (event.key !== "Tab" && editingText) {
      return;
    }
    root.toggleAttribute("data-keyboard-navigation", true);
  };

  reset();
  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("pointerdown", reset, true);
  target.addEventListener("blur", reset);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("pointerdown", reset, true);
    target.removeEventListener("blur", reset);
    reset();
  };
}

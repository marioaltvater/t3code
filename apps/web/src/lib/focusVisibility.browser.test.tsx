import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "../index.css";
import { render } from "../../test/render";
import { Input } from "../components/ui/input";
import { InputGroup, InputGroupInput } from "../components/ui/input-group";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../components/ui/number-field";
import { installFocusVisibility } from "./focusVisibility";

function trackFocusVisibility() {
  return { [Symbol.dispose]: installFocusVisibility(window) };
}

it("does not outline a clicked scroll pane when a non-navigation key is pressed", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <div tabIndex={0} style={{ overflow: "auto", height: 100 }} aria-label="Conversation">
      <div style={{ height: 300 }}>Conversation history</div>
    </div>,
  );
  const pane = screen.getByLabelText("Conversation");
  await pane.click();
  await userEvent.keyboard("a");
  expect(document.activeElement).toBe(pane.element());
  expect(getComputedStyle(pane.element()).outlineStyle).toBe("none");
});

it("shows native outlines and control rings for Tab and Shift+Tab", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <>
      <div tabIndex={0} aria-label="Conversation">
        Conversation history
      </div>
      <button className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        Action
      </button>
    </>,
  );
  const pane = screen.getByLabelText("Conversation");
  const button = screen.getByRole("button", { name: "Action" });
  await pane.click();
  await userEvent.tab();
  expect(document.activeElement).toBe(button.element());
  expect(getComputedStyle(button.element()).boxShadow).not.toBe("none");
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(pane.element());
  expect(getComputedStyle(pane.element()).outlineStyle).not.toBe("none");
});

it("hides focus rings on Super and restores them with Tab", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <>
      <button className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        First
      </button>
      <button className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        Second
      </button>
    </>,
  );
  const first = screen.getByRole("button", { name: "First" });
  const second = screen.getByRole("button", { name: "Second" });
  await first.click();
  await userEvent.tab();
  expect(getComputedStyle(second.element()).boxShadow).not.toBe("none");
  await userEvent.keyboard("{Meta}");
  expect(document.activeElement).toBe(second.element());
  expect(getComputedStyle(second.element()).boxShadow).toBe("none");
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(first.element());
  expect(getComputedStyle(first.element()).boxShadow).not.toBe("none");
});

it("clears keyboard focus styling when switching windows without moving focus", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <button className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      Action
    </button>,
  );
  const button = screen.getByRole("button", { name: "Action" });
  await button.click();
  await userEvent.keyboard("{ArrowDown}");
  expect(getComputedStyle(button.element()).boxShadow).not.toBe("none");
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("focus"));
  expect(document.activeElement).toBe(button.element());
  expect(getComputedStyle(button.element()).boxShadow).toBe("none");
});

it("keeps clicked text fields quiet during typing and caret navigation", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <>
      <button>Before</button>
      <input
        aria-label="Title"
        className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />
    </>,
  );
  const before = screen.getByRole("button", { name: "Before" });
  const input = screen.getByRole("textbox", { name: "Title" });
  await before.click();
  await userEvent.tab();
  expect(getComputedStyle(input.element()).boxShadow).not.toBe("none");
  await input.click();
  await userEvent.keyboard("Title{ArrowLeft}{Home}{End}");
  expect(getComputedStyle(input.element()).boxShadow).toBe("none");
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(before.element());
  expect(getComputedStyle(before.element()).outlineStyle).not.toBe("none");
});

it("preserves keyboard focus styling on input wrappers and grouped controls", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <>
      <button>Before</button>
      <Input aria-label="Title" />
      <button className="group">
        Action <span className="hidden group-focus-visible:inline">Keyboard action</span>
      </button>
    </>,
  );
  const input = screen.getByRole("textbox", { name: "Title" });
  const inputControl = input.element().closest("[data-slot='input-control']")!;
  await input.click();
  const pointerShadow = getComputedStyle(inputControl).boxShadow;
  await userEvent.tab({ shift: true });
  await userEvent.tab();
  expect(document.activeElement).toBe(input.element());
  expect(getComputedStyle(inputControl).boxShadow).not.toBe(pointerShadow);
  await userEvent.tab();
  await expect.element(screen.getByText("Keyboard action")).toBeVisible();
  await userEvent.keyboard("{Meta}");
  await expect.element(screen.getByText("Keyboard action")).not.toBeVisible();
});

it("limits grouped input rings to keyboard navigation", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <>
      <button>Before</button>
      <InputGroup aria-label="Search group">
        <InputGroupInput aria-label="Search" />
      </InputGroup>
    </>,
  );
  const input = screen.getByRole("textbox", { name: "Search" });
  const group = screen.getByRole("group", { name: "Search group" });
  await input.click();
  const pointerShadow = getComputedStyle(group.element()).boxShadow;
  await userEvent.tab({ shift: true });
  await userEvent.tab();
  expect(document.activeElement).toBe(input.element());
  expect(getComputedStyle(group.element()).boxShadow).not.toBe(pointerShadow);
  await userEvent.keyboard("{Meta}");
  expect(getComputedStyle(group.element()).boxShadow).toBe(pointerShadow);
});

it("shows focus when a clicked slider is adjusted with the keyboard", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <input
      type="range"
      aria-label="Contrast"
      defaultValue={50}
      className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    />,
  );
  const slider = screen.getByRole("slider", { name: "Contrast" });
  await slider.click();
  expect(getComputedStyle(slider.element()).boxShadow).toBe("none");
  const value = Number((slider.element() as HTMLInputElement).value);
  await userEvent.keyboard("{ArrowRight}");
  expect(Number((slider.element() as HTMLInputElement).value)).toBe(value + 1);
  expect(getComputedStyle(slider.element()).boxShadow).not.toBe("none");
});

it("shows number-field focus only when navigating or adjusting with the keyboard", async () => {
  using _focusVisibility = trackFocusVisibility();
  await using screen = await render(
    <NumberField defaultValue={5}>
      <NumberFieldGroup>
        <NumberFieldInput aria-label="Count" />
      </NumberFieldGroup>
    </NumberField>,
  );
  const input = screen.getByRole("textbox", { name: "Count" });
  const group = input.element().closest("[data-slot='number-field-group']")!;
  await input.click();
  const pointerShadow = getComputedStyle(group).getPropertyValue("--tw-ring-shadow");
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(input).toHaveValue("6");
  expect(getComputedStyle(group).getPropertyValue("--tw-ring-shadow")).not.toBe(pointerShadow);
  await userEvent.keyboard("{Meta}");
  expect(getComputedStyle(group).getPropertyValue("--tw-ring-shadow")).toBe(pointerShadow);
});

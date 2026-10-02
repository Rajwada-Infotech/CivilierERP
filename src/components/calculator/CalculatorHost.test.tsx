import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CalculatorHost } from "./CalculatorHost";
import { isCalculatorShortcut } from "@/hooks/useGlobalShortcuts";

afterEach(() => cleanup());

const key = (type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  fireEvent(target, new KeyboardEvent(type, { code, key: code.replace("Key", "").toLowerCase(), bubbles: true, cancelable: true, ...init }));

const panel = () => screen.queryByRole("dialog", { name: "Calculator" });

describe("isCalculatorShortcut", () => {
  it("needs Space held and a bare C", () => {
    expect(isCalculatorShortcut({ code: "KeyC", key: "c", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, true)).toBe(true);
    expect(isCalculatorShortcut({ code: "KeyC", key: "c", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, false)).toBe(false);
  });

  it("leaves Ctrl+C (copy) and Shift+C (CRM module switch) alone", () => {
    const base = { code: "KeyC", key: "c", metaKey: false, altKey: false };
    expect(isCalculatorShortcut({ ...base, ctrlKey: true, shiftKey: false }, true)).toBe(false);
    expect(isCalculatorShortcut({ ...base, ctrlKey: false, shiftKey: true }, true)).toBe(false);
  });
});

describe("CalculatorHost", () => {
  it("opens on Space + C and closes again on a second Space + C", () => {
    render(<CalculatorHost />);
    expect(panel()).toBeNull();

    key("keydown", "Space");
    key("keydown", "KeyC");
    key("keyup", "KeyC");
    key("keyup", "Space");
    expect(panel()).not.toBeNull();

    // Focus is now in the calculator's own box, so move it out before the chord.
    (document.activeElement as HTMLElement | null)?.blur();
    key("keydown", "Space");
    key("keydown", "KeyC");
    key("keyup", "Space");
    expect(panel()).toBeNull();
  });

  it("does not open from C alone", () => {
    render(<CalculatorHost />);
    key("keydown", "KeyC");
    expect(panel()).toBeNull();
  });

  it("does not open while typing in a text field", () => {
    render(
      <>
        <input data-testid="field" />
        <CalculatorHost />
      </>,
    );
    const field = screen.getByTestId("field");
    field.focus();
    key("keydown", "Space", {}, field);
    key("keydown", "KeyC", {}, field);
    expect(panel()).toBeNull();
  });

  it("does not stay armed after the window loses focus", () => {
    render(<CalculatorHost />);
    key("keydown", "Space");
    fireEvent(window, new Event("blur"));
    key("keydown", "KeyC");
    expect(panel()).toBeNull();
  });

  it("calculates live, sums a pasted column, and closes on Escape", () => {
    render(<CalculatorHost />);
    key("keydown", "Space");
    key("keydown", "KeyC");
    key("keyup", "Space");

    const box = screen.getByPlaceholderText("Type or paste figures…") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "₹1,200 + 800" } });
    expect(screen.getByText("2,000")).toBeTruthy();

    fireEvent.change(box, { target: { value: "" } });
    fireEvent.paste(box, { clipboardData: { getData: () => "1,200\n800\n450.50" } });
    expect(box.value).toBe("1200 + 800 + 450.50");
    expect(screen.getByText("2,450.5")).toBeTruthy();

    fireEvent.keyDown(box, { key: "Escape" });
    expect(panel()).toBeNull();
  });

  it("Enter keeps the answer in the box to continue from, and records it under Recent", () => {
    render(<CalculatorHost />);
    key("keydown", "Space");
    key("keydown", "KeyC");
    key("keyup", "Space");

    const box = screen.getByPlaceholderText("Type or paste figures…") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "12 * 5" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("60");
    expect(screen.getByText("Recent")).toBeTruthy();
  });
});

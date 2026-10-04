import { describe, expect, it } from "vitest";
import { getShortcutLabels, isCompassShortcut } from "./useCompass";

const ev = (over: Partial<Parameters<typeof isCompassShortcut>[0]>) => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("isCompassShortcut", () => {
  it("accepts Space while Enter is held", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space" }), { enter: true, space: false })).toBe(true);
  });

  it("accepts Enter while Space is held", () => {
    expect(isCompassShortcut(ev({ key: "Enter", code: "Enter" }), { enter: false, space: true })).toBe(true);
  });

  it("accepts macOS's non-breaking-space key for Space", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space" }), { enter: true, space: false })).toBe(true);
  });

  it("ignores either key alone", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space" }), { enter: false, space: false })).toBe(false);
    expect(isCompassShortcut(ev({ key: "Enter", code: "Enter" }), { enter: false, space: false })).toBe(false);
  });

  it("ignores unrelated keys even while the other half is held", () => {
    expect(isCompassShortcut(ev({ key: "k", code: "KeyK" }), { enter: true, space: false })).toBe(false);
  });

  it("ignores the chord with any modifier held", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space", shiftKey: true }), { enter: true, space: false })).toBe(false);
    expect(isCompassShortcut(ev({ key: " ", code: "Space", ctrlKey: true }), { enter: true, space: false })).toBe(false);
    expect(isCompassShortcut(ev({ key: "Enter", code: "Enter", metaKey: true }), { enter: false, space: true })).toBe(false);
    expect(isCompassShortcut(ev({ key: "Enter", code: "Enter", altKey: true }), { enter: false, space: true })).toBe(false);
  });

  it("no longer accepts the old Ctrl+K / Super+Space / Alt+Space chords", () => {
    expect(isCompassShortcut(ev({ key: "k", ctrlKey: true }), { enter: false, space: false })).toBe(false);
    expect(isCompassShortcut(ev({ key: " ", code: "Space", metaKey: true }), { enter: false, space: false })).toBe(false);
    expect(isCompassShortcut(ev({ key: " ", code: "Space", altKey: true }), { enter: false, space: false })).toBe(false);
  });
});

describe("getShortcutLabels", () => {
  it("returns a single platform-agnostic label", () => {
    expect(getShortcutLabels()).toEqual({ primary: "Enter + Space" });
  });
});

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
  it("accepts Super+Space", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space", metaKey: true }))).toBe(true);
  });

  it("accepts Alt+Space, including macOS's non-breaking-space key", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space", altKey: true }))).toBe(true);
    expect(isCompassShortcut(ev({ key: "\u00a0", code: "Space", altKey: true }))).toBe(true);
  });

  it("accepts Ctrl+K and ⌘K in either case", () => {
    expect(isCompassShortcut(ev({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isCompassShortcut(ev({ key: "K", ctrlKey: true }))).toBe(true);
    expect(isCompassShortcut(ev({ key: "k", metaKey: true }))).toBe(true);
  });

  it("ignores plain typing", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space" }))).toBe(false);
    expect(isCompassShortcut(ev({ key: "k", code: "KeyK" }))).toBe(false);
  });

  it("ignores Shift combos and other modifier mixes", () => {
    expect(isCompassShortcut(ev({ key: " ", code: "Space", metaKey: true, shiftKey: true }))).toBe(false);
    expect(isCompassShortcut(ev({ key: "k", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isCompassShortcut(ev({ key: "k", ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isCompassShortcut(ev({ key: " ", code: "Space", ctrlKey: true }))).toBe(false);
    expect(isCompassShortcut(ev({ key: " ", code: "Space", metaKey: true, altKey: true }))).toBe(false);
    expect(isCompassShortcut(ev({ key: "k", ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe("getShortcutLabels", () => {
  it("labels per platform", () => {
    expect(getShortcutLabels("MacIntel").primary).toBe("⌘ Space");
    expect(getShortcutLabels("Win32")).toEqual({ primary: "Win+Space", alt: "Alt+Space", fallback: "Ctrl+K" });
    expect(getShortcutLabels("Linux x86_64").primary).toBe("Super+Space");
  });
});

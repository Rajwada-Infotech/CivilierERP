import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setActiveModule: vi.fn(),
  setModuleSwitching: vi.fn(),
  setCollapsed: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/components/layout/layoutContexts", () => ({
  useSidebarState: () => ({ collapsed: false, setCollapsed: mocks.setCollapsed }),
}));
vi.mock("@/contexts/ModuleContext", () => ({
  useModule: () => ({ setActiveModule: mocks.setActiveModule, setModuleSwitching: mocks.setModuleSwitching }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ currentUser: { role: "super_admin" }, canAccessPage: () => true }),
}));

import {
  CHORD_GRACE_MS,
  MODULE_SHORTCUTS,
  isCheatsheetShortcut,
  useModuleSwitchShortcut,
} from "@/hooks/useGlobalShortcuts";
import { ShortcutsHost } from "./ShortcutsHost";
import { SHORTCUT_GROUPS } from "./shortcutCatalog";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const down = (code: string, extra: Partial<KeyboardEventInit> = {}, target: Element | Window = window) =>
  fireEvent.keyDown(target, { code, key: code.replace("Key", ""), ...extra });
const up = (code: string) => fireEvent.keyUp(window, { code, key: code.replace("Key", "") });

afterEach(cleanup);

describe("isCheatsheetShortcut", () => {
  const base = { key: "S", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true };
  it("needs Shift and the other chord key held", () => {
    expect(isCheatsheetShortcut({ ...base, code: "KeyS" }, { c: true, s: false })).toBe(true);
    expect(isCheatsheetShortcut({ ...base, code: "KeyC" }, { c: false, s: true })).toBe(true);
    expect(isCheatsheetShortcut({ ...base, code: "KeyS" }, { c: false, s: false })).toBe(false);
    expect(isCheatsheetShortcut({ ...base, shiftKey: false, code: "KeyS" }, { c: true, s: false })).toBe(false);
    expect(isCheatsheetShortcut({ ...base, ctrlKey: true, code: "KeyS" }, { c: true, s: false })).toBe(false);
  });
});

describe("cheatsheet catalog", () => {
  it("lists every module switch key and the global shortcuts", () => {
    const labels = SHORTCUT_GROUPS.flatMap((g) => g.rows.map((r) => r.label));
    for (const m of MODULE_SHORTCUTS) expect(labels).toContain(m.label);
    expect(labels).toEqual(expect.arrayContaining(["Find a page", "Find a document by number", "Calculator", "This cheatsheet"]));
  });
});

describe("ShortcutsHost (Shift + C + S)", () => {
  it("opens on Shift+C then S, and closes on the chord again", () => {
    render(<ShortcutsHost />);
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
    down("KeyC", { shiftKey: true });
    down("KeyS", { shiftKey: true });
    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
    up("KeyC");
    up("KeyS");
    down("KeyS", { shiftKey: true });
    down("KeyC", { shiftKey: true });
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  });

  it("works S-first too", () => {
    render(<ShortcutsHost />);
    down("KeyS", { shiftKey: true });
    down("KeyC", { shiftKey: true });
    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  });

  it("does nothing for S alone, C alone, or without Shift", () => {
    render(<ShortcutsHost />);
    down("KeyS", { shiftKey: true });
    up("KeyS");
    down("KeyC", { shiftKey: true });
    up("KeyC");
    down("KeyC");
    down("KeyS");
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  });

  it("does not fire while typing in a text field", () => {
    render(
      <>
        <input data-testid="f" />
        <ShortcutsHost />
      </>,
    );
    const f = screen.getByTestId("f");
    down("KeyC", { shiftKey: true }, f);
    down("KeyS", { shiftKey: true }, f);
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  });
});

describe("Shift+C still switches to CRM, but not when it is the cheatsheet chord", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(mocks).forEach((m) => m.mockClear());
  });
  afterEach(() => vi.useRealTimers());

  it("Shift+C alone reaches CRM after the grace period", () => {
    renderHook(() => useModuleSwitchShortcut());
    down("KeyC", { shiftKey: true });
    expect(mocks.setActiveModule).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(CHORD_GRACE_MS + 5));
    expect(mocks.setActiveModule).toHaveBeenCalledWith("crm");
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("Shift+C then S does not switch to CRM", () => {
    renderHook(() => useModuleSwitchShortcut());
    down("KeyC", { shiftKey: true });
    down("KeyS", { shiftKey: true });
    act(() => void vi.advanceTimersByTime(CHORD_GRACE_MS * 3));
    expect(mocks.setActiveModule).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("Shift+S then C does not switch to CRM", () => {
    renderHook(() => useModuleSwitchShortcut());
    down("KeyS", { shiftKey: true });
    down("KeyC", { shiftKey: true });
    act(() => void vi.advanceTimersByTime(CHORD_GRACE_MS * 3));
    expect(mocks.setActiveModule).not.toHaveBeenCalled();
  });

  it("other module keys are unaffected and instant", () => {
    renderHook(() => useModuleSwitchShortcut());
    down("Digit1", { shiftKey: true });
    expect(mocks.setActiveModule).toHaveBeenCalledWith("finance");
  });
});

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";

let mockRole: string | null = "super_admin";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ currentUser: mockRole ? { role: mockRole } : null }),
}));

import { ThemeProvider, useTheme, useThemeOptions, isThemeAllowed } from "./ThemeContext";

const wrapper = ({ children }: { children: React.ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

beforeEach(() => {
  // jsdom's localStorage isn't reliable under this Node version — use an in-memory one.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("cyberpunk theme is super-admin only", () => {
  it("isThemeAllowed: only a super admin may use it; every other theme is open", () => {
    expect(isThemeAllowed("cyberpunk", true)).toBe(true);
    expect(isThemeAllowed("cyberpunk", false)).toBe(false);
    expect(isThemeAllowed("glass", false)).toBe(true);
  });

  it("the theme picker lists Cyberpunk for a super admin and not for anyone else", () => {
    mockRole = "super_admin";
    expect(renderHook(() => useThemeOptions()).result.current.map(([t]) => t)).toContain("cyberpunk");
    for (const role of ["admin", "dba", "user", "engineer"]) {
      mockRole = role;
      expect(renderHook(() => useThemeOptions()).result.current.map(([t]) => t)).not.toContain("cyberpunk");
    }
  });

  it("a super admin can pick it: it is applied to <html> and remembered", () => {
    mockRole = "super_admin";
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("cyberpunk"));
    expect(result.current.theme).toBe("cyberpunk");
    expect(document.documentElement.getAttribute("data-theme")).toBe("cyberpunk");
    expect(localStorage.getItem("civilier-theme")).toBe("cyberpunk");
  });

  it("another role cannot select it, even by calling setTheme directly", () => {
    mockRole = "admin";
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("cyberpunk"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("civilier-theme")).toBeNull();
  });

  it("a stored Cyberpunk choice renders as the default for a non-super-admin (and when signed out)", () => {
    localStorage.setItem("civilier-theme", "cyberpunk");
    for (const role of ["admin", null]) {
      mockRole = role;
      document.documentElement.removeAttribute("data-theme");
      const { result, unmount } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("dark");
      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
      unmount();
    }
    // …but the choice is kept for the super admin's next visit
    expect(localStorage.getItem("civilier-theme")).toBe("cyberpunk");
    mockRole = "super_admin";
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("cyberpunk");
    expect(document.documentElement.getAttribute("data-theme")).toBe("cyberpunk");
  });
});

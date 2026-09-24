import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";

const mocks = vi.hoisted(() => ({ user: { id: "u1", role: "super_admin" } }));

// Compass only needs useNavigate/useLocation, so a tiny in-memory store stands
// in for the router — keeps this test independent of the installed
// react-router version.
const router = vi.hoisted(() => {
  let path = "/";
  const listeners = new Set<() => void>();
  return {
    get: () => path,
    set: (p: string) => {
      path = p;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
});
vi.mock("react-router-dom", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useLocation: () => ({ pathname: useSyncExternalStore(router.subscribe, router.get) }),
    useNavigate: () => (to: string) => router.set(to),
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ currentUser: mocks.user, canAccessPage: () => true }),
}));

import { CompassProvider } from "./CompassProvider";

// jsdom lacks these; cmdk and Radix expect them.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

const Loc = () => <div data-testid="loc">{useLocation().pathname}</div>;

const mount = (path = "/finance") => {
  router.set(path);
  return render(
    <CompassProvider>
      <Loc />
    </CompassProvider>,
  );
};

// Enter+Space chord: hold Enter, tap Space, release both — one full press
// per call, held state clean afterward so repeated calls behave like
// repeated real presses (and thus toggle open/closed each time).
const press = () => {
  fireEvent.keyDown(window, { code: "Enter", key: "Enter" });
  fireEvent.keyDown(window, { code: "Space", key: " " });
  fireEvent.keyUp(window, { code: "Space", key: " " });
  fireEvent.keyUp(window, { code: "Enter", key: "Enter" });
};
const input = () => screen.getByPlaceholderText(/search pages/i);
const isOpen = () => screen.queryByRole("dialog") !== null;

// Node 25 ships its own experimental `localStorage` global that shadows jsdom's
// and has no working methods without --localstorage-file; use a plain stub.
beforeAll(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});
// Node's own experimental localStorage can shadow jsdom's (no .clear()); use a plain in-memory one.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Compass hotkeys", () => {
  it("opens and closes with Enter+Space", async () => {
    mount();
    expect(isOpen()).toBe(false);
    press();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    press();
    await waitFor(() => expect(isOpen()).toBe(false));
  });

  it("opens holding Space first, then Enter", async () => {
    mount();
    fireEvent.keyDown(window, { code: "Space", key: " " });
    fireEvent.keyDown(window, { code: "Enter", key: "Enter" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not open on Enter alone or Space alone", () => {
    mount();
    fireEvent.keyDown(window, { code: "Enter", key: "Enter" });
    fireEvent.keyUp(window, { code: "Enter", key: "Enter" });
    fireEvent.keyDown(window, { code: "Space", key: " " });
    fireEvent.keyUp(window, { code: "Space", key: " " });
    expect(isOpen()).toBe(false);
  });

  it("no longer opens with the old Ctrl+K/Alt+Space/Super+Space chords", () => {
    mount();
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.keyDown(window, { code: "Space", key: " ", altKey: true });
    fireEvent.keyDown(window, { code: "Space", key: " ", metaKey: true });
    expect(isOpen()).toBe(false);
  });

  it("ignores the chord with an extra modifier held", () => {
    mount();
    fireEvent.keyDown(window, { code: "Enter", key: "Enter", shiftKey: true });
    fireEvent.keyDown(window, { code: "Space", key: " ", shiftKey: true });
    expect(isOpen()).toBe(false);
  });

  it("ignores OS auto-repeat of the second key (no flicker)", () => {
    mount();
    fireEvent.keyDown(window, { code: "Enter", key: "Enter" });
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    expect(isOpen()).toBe(true); // still open, not toggled closed again
  });

  it("prevents the browser default so Enter+Space doesn't also submit a form or scroll", () => {
    mount();
    const kdEnter = new KeyboardEvent("keydown", { code: "Enter", key: "Enter", cancelable: true, bubbles: true });
    window.dispatchEvent(kdEnter);
    const kdSpace = new KeyboardEvent("keydown", { code: "Space", key: " ", cancelable: true, bubbles: true });
    window.dispatchEvent(kdSpace);
    expect(kdSpace.defaultPrevented).toBe(true);
  });
});

describe("Compass search and navigation", () => {
  it("finds a page by an alias and groups it under its module", async () => {
    mount();
    press();
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "reconciliation" } });
    expect(await screen.findByText("BRS")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument(); // group heading
  });

  it("navigates to the highlighted result on Enter and closes", async () => {
    mount("/finance");
    press();
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "reconciliation" } });
    const item = await screen.findByText("BRS");
    await waitFor(() => expect(item.closest("[cmdk-item]")).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/brs"));
    await waitFor(() => expect(isOpen()).toBe(false));
  });

  it("navigates on click too", async () => {
    mount("/finance");
    press();
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "trial balance" } });
    fireEvent.click(await screen.findByText("Trial Balance"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/trial-balance"));
  });

  it("remembers the module of a /masters page so the right sidebar shows", async () => {
    mount("/finance");
    press();
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "customer master" } });
    fireEvent.click(await screen.findByText("Customer Master"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/masters/customers"));
    expect(sessionStorage.getItem("activeModule")).toBe("sales");
  });

  it("shows a friendly empty state", async () => {
    mount();
    press();
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "zzzzqqqq" } });
    expect(await screen.findByText(/No pages match/i)).toBeInTheDocument();
  });

  it("clears the query when reopened", async () => {
    mount();
    press();
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "invoice" } });
    press();
    await waitFor(() => expect(isOpen()).toBe(false));
    press();
    await screen.findByRole("dialog");
    expect(input()).toHaveValue("");
  });

  it("empty state offers module shortcuts instead of a blank box", async () => {
    mount();
    press();
    await screen.findByRole("dialog");
    expect(screen.getByText("Jump to a module")).toBeInTheDocument();
    expect(screen.queryByText("Recent")).not.toBeInTheDocument(); // nothing visited yet
  });
});

describe("Compass recent pages", () => {
  it("records visited pages per user and lists them (excluding the current page)", async () => {
    mount("/finance");
    // /finance was tracked on mount; go somewhere else through Compass
    press();
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "trial balance" } });
    fireEvent.click(await screen.findByText("Trial Balance"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/trial-balance"));

    const stored = JSON.parse(localStorage.getItem("compass:recent:v1:u1") ?? "[]");
    expect(stored).toEqual(["/trial-balance", "/finance"]);

    press();
    await screen.findByRole("dialog");
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText("Proceeding")).toBeInTheDocument(); // /finance's label
  });

  it("ignores stored routes the user can no longer open", async () => {
    localStorage.setItem("compass:recent:v1:u1", JSON.stringify(["/does-not-exist"]));
    mount("/finance");
    press();
    await screen.findByRole("dialog");
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("survives corrupt storage", async () => {
    localStorage.setItem("compass:recent:v1:u1", "{not json");
    mount("/finance");
    press();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

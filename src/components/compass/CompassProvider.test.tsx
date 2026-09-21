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

const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, { code: "Space", key: " ", ...init });
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
  it("opens and closes with Alt+Space", async () => {
    mount();
    expect(isOpen()).toBe(false);
    press({ altKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    press({ altKey: true });
    await waitFor(() => expect(isOpen()).toBe(false));
  });

  it("opens with Super+Space", async () => {
    mount();
    press({ metaKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("still opens with Ctrl+K", async () => {
    mount();
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("ignores lookalike chords", () => {
    mount();
    press({ altKey: true, shiftKey: true });
    press({ ctrlKey: true });
    press({});
    press({ altKey: true, metaKey: true });
    fireEvent.keyDown(window, { key: "k", code: "KeyK", altKey: true });
    expect(isOpen()).toBe(false);
  });

  it("ignores a held-down key (no flicker)", () => {
    mount();
    press({ altKey: true, repeat: true });
    expect(isOpen()).toBe(false);
  });

  it("prevents the browser default so Alt+Space doesn't also fire its own handler", () => {
    mount();
    const ev = new KeyboardEvent("keydown", { code: "Space", key: " ", altKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("Compass search and navigation", () => {
  it("finds a page by an alias and groups it under its module", async () => {
    mount();
    press({ altKey: true });
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "reconciliation" } });
    expect(await screen.findByText("BRS")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument(); // group heading
  });

  it("navigates to the highlighted result on Enter and closes", async () => {
    mount("/finance");
    press({ altKey: true });
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
    press({ altKey: true });
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "trial balance" } });
    fireEvent.click(await screen.findByText("Trial Balance"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/trial-balance"));
  });

  it("shows a friendly empty state", async () => {
    mount();
    press({ altKey: true });
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "zzzzqqqq" } });
    expect(await screen.findByText(/No pages match/i)).toBeInTheDocument();
  });

  it("clears the query when reopened", async () => {
    mount();
    press({ altKey: true });
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "invoice" } });
    press({ altKey: true });
    await waitFor(() => expect(isOpen()).toBe(false));
    press({ altKey: true });
    await screen.findByRole("dialog");
    expect(input()).toHaveValue("");
  });

  it("empty state offers module shortcuts instead of a blank box", async () => {
    mount();
    press({ altKey: true });
    await screen.findByRole("dialog");
    expect(screen.getByText("Jump to a module")).toBeInTheDocument();
    expect(screen.queryByText("Recent")).not.toBeInTheDocument(); // nothing visited yet
  });
});

describe("Compass recent pages", () => {
  it("records visited pages per user and lists them (excluding the current page)", async () => {
    mount("/finance");
    // /finance was tracked on mount; go somewhere else through Compass
    press({ altKey: true });
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "trial balance" } });
    fireEvent.click(await screen.findByText("Trial Balance"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/trial-balance"));

    const stored = JSON.parse(localStorage.getItem("compass:recent:v1:u1") ?? "[]");
    expect(stored).toEqual(["/trial-balance", "/finance"]);

    press({ altKey: true });
    await screen.findByRole("dialog");
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText("Proceeding")).toBeInTheDocument(); // /finance's label
  });

  it("ignores stored routes the user can no longer open", async () => {
    localStorage.setItem("compass:recent:v1:u1", JSON.stringify(["/does-not-exist"]));
    mount("/finance");
    press({ altKey: true });
    await screen.findByRole("dialog");
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("survives corrupt storage", async () => {
    localStorage.setItem("compass:recent:v1:u1", "{not json");
    mount("/finance");
    press({ altKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";

const api = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));
vi.mock("@/lib/fetchWithAuth", () => ({ fetchWithAuth: api.fetchWithAuth }));

// Same in-memory router stand-in as the Compass tests.
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
    useLocation: () => {
      const full = useSyncExternalStore(router.subscribe, router.get);
      const [pathname, search = ""] = full.split("?");
      return { pathname, search: search ? `?${search}` : "" };
    },
    useNavigate: () => (to: string) => router.set(to),
  };
});

import { isDocFinderShortcut } from "@/hooks/useGlobalShortcuts";
import { DocFinderProvider } from "./DocFinderProvider";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

const Loc = () => {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
};

const result = (over: Record<string, unknown> = {}) => ({
  table: "JournalVoucher",
  type: "Journal Voucher",
  id: 77,
  docNo: "JV-2026-00100",
  date: "2026-04-02T00:00:00.000Z",
  amount: 125000,
  status: "Approved",
  subtitle: "Site rent",
  route: "/journal-voucher",
  pageKey: "journal-voucher",
  url: "/journal-voucher?view=77",
  exact: true,
  ...over,
});

const respond = (results: unknown[]) =>
  api.fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => ({ query: "", tooShort: false, results }),
  });

const mount = () => {
  router.set("/finance");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocFinderProvider>
        <input data-testid="field" />
        <Loc />
      </DocFinderProvider>
    </QueryClientProvider>,
  );
};

const altShiftD = (target: Element | Window = window) =>
  fireEvent.keyDown(target, { code: "KeyD", key: "D", altKey: true, shiftKey: true });

beforeEach(() => api.fetchWithAuth.mockReset());
afterEach(cleanup);

describe("isDocFinderShortcut", () => {
  const base = { code: "KeyD", key: "D", ctrlKey: false, metaKey: false, altKey: true, shiftKey: true };
  it("matches Alt+Shift+D, including the macOS Option+D '∂' key value", () => {
    expect(isDocFinderShortcut(base)).toBe(true);
    expect(isDocFinderShortcut({ ...base, key: "∂" })).toBe(true);
  });
  it("rejects Shift+D, Ctrl+Shift+D and Alt+D", () => {
    expect(isDocFinderShortcut({ ...base, altKey: false })).toBe(false);
    expect(isDocFinderShortcut({ ...base, altKey: false, ctrlKey: true })).toBe(false);
    expect(isDocFinderShortcut({ ...base, shiftKey: false })).toBe(false);
    expect(isDocFinderShortcut({ ...base, ctrlKey: true })).toBe(false);
  });
});

describe("DocFinder", () => {
  it("opens on Alt+Shift+D and shows the hint, without calling the API", async () => {
    mount();
    expect(screen.queryByPlaceholderText(/Find a document/)).toBeNull();
    altShiftD();
    expect(await screen.findByPlaceholderText(/Find a document/)).toBeTruthy();
    expect(screen.getByText(/or just its last digits/)).toBeTruthy();
    expect(api.fetchWithAuth).not.toHaveBeenCalled();
  });

  it("does not fire while typing in a text field", () => {
    mount();
    altShiftD(screen.getByTestId("field"));
    expect(screen.queryByPlaceholderText(/Find a document/)).toBeNull();
  });

  it("searches after the debounce, groups by type, and Enter opens the record via ?view=", async () => {
    respond([result()]);
    mount();
    altShiftD();
    const input = await screen.findByPlaceholderText(/Find a document/);
    fireEvent.change(input, { target: { value: "JV-2026-00100" } });

    expect(await screen.findByText("JV-2026-00100")).toBeTruthy();
    expect(screen.getByText("Journal Voucher")).toBeTruthy(); // group heading
    expect(screen.getByText(/1,25,000/)).toBeTruthy();
    expect(api.fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(String(api.fetchWithAuth.mock.calls[0][0])).toBe("/api/doc-search?q=JV-2026-00100");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/journal-voucher?view=77"));
    await waitFor(() => expect(screen.queryByPlaceholderText(/Find a document/)).toBeNull());
  });

  it("shows a clear empty state for an unknown number", async () => {
    respond([]);
    mount();
    altShiftD();
    const input = await screen.findByPlaceholderText(/Find a document/);
    fireEvent.change(input, { target: { value: "ZZZ-999" } });
    expect(await screen.findByText(/No document found for/)).toBeTruthy();
    expect(screen.getByText(/ZZZ-999/)).toBeTruthy();
  });

  it("shows an error state, not a blank panel, when the search fails", async () => {
    api.fetchWithAuth.mockResolvedValue({ ok: false, json: async () => ({}) });
    mount();
    altShiftD();
    const input = await screen.findByPlaceholderText(/Find a document/);
    fireEvent.change(input, { target: { value: "SU-2026-00011" } });
    expect(await screen.findByText(/Search failed/)).toBeTruthy();
  });

  it("clears the query when closed and reopened", async () => {
    respond([result()]);
    mount();
    altShiftD();
    const input = (await screen.findByPlaceholderText(/Find a document/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "JV-2026" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText(/Find a document/)).toBeNull());
    altShiftD();
    const again = (await screen.findByPlaceholderText(/Find a document/)) as HTMLInputElement;
    expect(again.value).toBe("");
  });
});

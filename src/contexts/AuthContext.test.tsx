import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./AuthContext";

// AuthProvider calls useQueryClient() (to clear cached queries on login/
// logout — see AuthContext.tsx) so it must be rendered under a real
// QueryClientProvider, same as it always is in the actual app tree.
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/**
 * Verifies the fix for "rights changes aren't real-time": AuthContext used
 * to only re-fetch a non-admin user's pagePermissions every 5 minutes. Now
 * it also listens for a "permissions:updated" socket event (emitted by the
 * backend the instant an admin saves rights — see routes/roles.js,
 * routes/userRights.js, routes/users.js) and refreshes immediately.
 */

const mockSocketHandlers: Record<string, (...args: unknown[]) => void> = {};
const mockSocket = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    mockSocketHandlers[event] = handler;
  }),
  off: vi.fn(),
};

vi.mock("@/lib/socket", () => ({
  connectSocket: () => mockSocket,
  getSocket: () => mockSocket,
  disconnectSocket: vi.fn(),
}));

vi.mock("../api/authApi", () => ({ loginUser: vi.fn() }));
vi.mock("../api/userApi", () => ({ getUsers: vi.fn(async () => []) }));

function TestConsumer() {
  const { currentUser } = useAuth();
  return (
    <div data-testid="pages">
      {currentUser?.pagePermissions.map((p) => p.page).join(",") ?? ""}
    </div>
  );
}

describe("AuthContext: real-time rights refresh via socket", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(mockSocketHandlers).forEach((k) => delete mockSocketHandlers[k]);
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();

    localStorage.setItem("token", "fake-jwt-token");
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: "10",
        name: "Regular User",
        email: "user@example.com",
        role: "user",
        initials: "RU",
        pagePermissions: [{ page: "old-page", actions: ["view"] }],
        isActive: true,
      }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("subscribes to permissions:updated on mount for a non-privileged user", () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ rightsJson: [] }), { status: 200 })) as any;

    renderWithProviders(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(mockSocket.on).toHaveBeenCalledWith(
      "permissions:updated",
      expect.any(Function),
    );
  });

  it("re-fetches and applies fresh pagePermissions the instant permissions:updated fires", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/api/user-rights/my")) {
        return new Response(
          JSON.stringify({
            rightsJson: [{ page: "new-page", actions: ["view", "edit"] }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as any;

    renderWithProviders(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    // Before the push: still the old, stale permission set from localStorage.
    expect(screen.getByTestId("pages").textContent).toBe("old-page");

    // Simulate the backend pushing the event (as roles.js/userRights.js now do).
    mockSocketHandlers["permissions:updated"]?.();

    await waitFor(() => {
      expect(screen.getByTestId("pages").textContent).toBe("new-page");
    });

    // The refreshed permissions must also be persisted so a reload doesn't
    // regress back to the stale set.
    const stored = JSON.parse(localStorage.getItem("user") || "{}");
    expect(stored.pagePermissions).toEqual([
      { page: "new-page", actions: ["view", "edit"] },
    ]);
  });

  it("does not subscribe at all for privileged roles (they always have full access)", () => {
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: "1",
        name: "Admin",
        email: "admin@example.com",
        role: "super_admin",
        initials: "A",
        pagePermissions: [],
        isActive: true,
      }),
    );
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as any;

    renderWithProviders(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(mockSocket.on).not.toHaveBeenCalledWith(
      "permissions:updated",
      expect.any(Function),
    );
  });

  it("cleans up the socket listener on unmount", () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as any;

    const { unmount } = renderWithProviders(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith(
      "permissions:updated",
      expect.any(Function),
    );
  });
});

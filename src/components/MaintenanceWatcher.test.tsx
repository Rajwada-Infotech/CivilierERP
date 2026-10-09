import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { MaintenanceWatcher } from "./MaintenanceWatcher";
import { MAINTENANCE_EVENT } from "@/lib/maintenanceRedirect";

const status = vi.fn();
let mockUser: { role: string } | null = null;
const logout = vi.fn(async () => {});
const replace = vi.fn();
const realLocation = window.location;
vi.mock("@/api/maintenanceModeApi", () => ({ getMaintenanceStatus: () => status() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ currentUser: mockUser, logout }) }));
// The full-screen page has its own tests; here it only has to appear.
vi.mock("@/pages/Maintenance", () => ({
  default: ({ overlay }: { overlay?: { onAdminSignIn: () => void; onOver: () => void } }) => (
    <div data-testid="overlay">
      Maintenance screen
      <button onClick={overlay?.onAdminSignIn}>Administrator sign in</button>
      <button onClick={overlay?.onOver}>Maintenance is over</button>
    </div>
  ),
}));

const base = { title: "Upgrade", message: "Back soon", startedAt: "2026-10-09T10:00:00Z", endsAt: "2026-10-09T12:00:00Z", updatedBy: null };
const off = { ...base, active: false, enforced: false, startsAt: null };
const announced = { ...base, active: true, enforced: false, startsAt: "2026-10-09T10:05:00Z" };
const held = { ...base, active: true, enforced: true, startsAt: null };

function mount(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MaintenanceWatcher />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
  mockUser = { role: "user" };
  status.mockReset();
  logout.mockClear();
  replace.mockReset();
  sessionStorage.clear();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, pathname: "/projects", search: "", replace } });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("MaintenanceWatcher", () => {
  it("shows nothing while maintenance is off", async () => {
    status.mockResolvedValue(off);
    mount();
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("while announced, shows the countdown strip and lets people carry on - on the login page too", async () => {
    mockUser = null;
    status.mockResolvedValue(announced);
    mount("/login");
    expect(await screen.findByText(/Maintenance starts in/)).toBeInTheDocument();
    expect(screen.getByText(/^(5m 00s|4m 5\ds)$/)).toBeInTheDocument();
    expect(screen.getByText(/finish and save/)).toBeInTheDocument();
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/^4m (5[0-7])s$/)).toBeInTheDocument(); // counted down by at least the 3 seconds that passed
  });

  it("once started, covers the app with the full-screen page", async () => {
    status.mockResolvedValue(held);
    mount("/projects");
    expect(await screen.findByTestId("overlay")).toBeInTheDocument();
  });

  it("covers the app at once when a call is refused, before the next check", async () => {
    status.mockResolvedValue(off);
    mount("/projects");
    await waitFor(() => expect(status).toHaveBeenCalled());
    act(() => {
      window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT));
    });
    expect(await screen.findByTestId("overlay")).toBeInTheDocument();
  });

  it("a super admin is never held: only a small reminder", async () => {
    mockUser = { role: "super_admin" };
    status.mockResolvedValue(held);
    mount("/projects");
    expect(await screen.findByText(/Maintenance is ON/)).toBeInTheDocument();
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("href", "/admin/system-maintenance");
  });

  it("'Administrator sign in' lets the overlay step aside on the login page", async () => {
    mockUser = null;
    status.mockResolvedValue(held);
    mount("/");
    fireEvent.click(await screen.findByRole("button", { name: /administrator sign in/i }));
    await waitFor(() => expect(screen.queryByTestId("overlay")).not.toBeInTheDocument());
  });

  describe("when maintenance ends", () => {
    it("signs out someone who was held, then reloads the site on the login page", async () => {
      status.mockResolvedValue(held);
      mount("/projects");
      fireEvent.click(await screen.findByRole("button", { name: /maintenance is over/i }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
      expect(logout).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("maintenance:held")).toBeNull();
    });

    it("also does it when the status check is what notices it is over", async () => {
      status.mockResolvedValueOnce(held).mockResolvedValue(off);
      mount("/projects");
      await screen.findByTestId("overlay");
      act(() => {
        vi.advanceTimersByTime(16_000);
      });
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
      expect(logout).toHaveBeenCalledTimes(1);
    });

    it("a held visitor who is not signed in just gets the page reloaded", async () => {
      mockUser = null;
      status.mockResolvedValue(held);
      mount("/");
      fireEvent.click(await screen.findByRole("button", { name: /maintenance is over/i }));
      await waitFor(() => expect(replace).toHaveBeenCalled());
      expect(logout).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith("/projects"); // the path this test pinned window.location to
    });

    it("leaves alone people who only saw the countdown (called off before it started)", async () => {
      status.mockResolvedValueOnce(announced).mockResolvedValue(off);
      mount("/projects");
      await screen.findByText(/Maintenance starts in/);
      act(() => {
        vi.advanceTimersByTime(16_000);
      });
      await waitFor(() => expect(screen.queryByText(/Maintenance starts in/)).not.toBeInTheDocument());
      expect(logout).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it("never signs out a super admin", async () => {
      mockUser = { role: "super_admin" };
      sessionStorage.setItem("maintenance:held", "1"); // left over from an earlier session in this tab
      status.mockResolvedValue(held);
      mount("/projects");
      await screen.findByText(/Maintenance is ON/);
      expect(sessionStorage.getItem("maintenance:held")).toBeNull();
      expect(logout).not.toHaveBeenCalled();
    });

    it("remembers being held across a reload of the tab", async () => {
      sessionStorage.setItem("maintenance:held", "1");
      status.mockResolvedValue(off);
      mount("/projects");
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
      expect(logout).toHaveBeenCalledTimes(1);
    });
  });
});

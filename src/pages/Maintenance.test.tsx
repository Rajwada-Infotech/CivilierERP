import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Maintenance from "./Maintenance";
import { sendToMaintenancePage, MAINTENANCE_EVENT, MAINTENANCE_STORAGE_KEY } from "@/lib/maintenanceRedirect";

const status = vi.fn();
vi.mock("@/api/maintenanceModeApi", () => ({ getMaintenanceStatus: () => status() }));

const replace = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:30:00Z"));
  sessionStorage.clear();
  replace.mockReset();
  status.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, pathname: "/system-maintenance", replace } });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

const live = (over = {}) => ({
  active: true,
  enforced: true,
  startsAt: null,
  title: "Database upgrade",
  message: "Back after the upgrade.",
  startedAt: "2026-10-08T10:00:00Z",
  endsAt: "2026-10-08T12:00:00Z",
  updatedBy: null,
  ...over,
});
const renderPage = () =>
  render(
    <MemoryRouter>
      <Maintenance />
    </MemoryRouter>,
  );

describe("Maintenance page", () => {
  it("shows the message, the expected end in IST and a countdown", async () => {
    status.mockResolvedValue(live());
    renderPage();
    expect(await screen.findByText("Database upgrade")).toBeInTheDocument();
    expect(screen.getByText("Back after the upgrade.")).toBeInTheDocument();
    expect(screen.getByText("Thu, 8 Oct, 5:30 pm IST")).toBeInTheDocument();
    expect(screen.getByText("1h 30m 00s")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("counts down second by second", async () => {
    status.mockResolvedValue(live());
    renderPage();
    await screen.findByText("1h 30m 00s");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("1h 29m 55s")).toBeInTheDocument();
  });

  it("with no end time says so, and shows no countdown", async () => {
    status.mockResolvedValue(live({ endsAt: null }));
    renderPage();
    expect(await screen.findByText("We'll be back shortly")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("past the planned end it says it is taking longer instead of counting below zero", async () => {
    vi.setSystemTime(new Date("2026-10-08T12:05:00Z"));
    status.mockResolvedValue(live());
    renderPage();
    expect(await screen.findByText("Almost there")).toBeInTheDocument();
    expect(screen.getByText(/a little longer than planned/)).toBeInTheDocument();
  });

  it("sends people back in as soon as maintenance is over", async () => {
    status.mockResolvedValue({ active: false, enforced: false, title: null, message: null, startedAt: null, startsAt: null, endsAt: null, updatedBy: null });
    sessionStorage.setItem(MAINTENANCE_STORAGE_KEY, JSON.stringify(live()));
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(sessionStorage.getItem(MAINTENANCE_STORAGE_KEY)).toBeNull();
  });

  it("as an overlay it calls onOver instead of reloading, and the admin sign-in is a button", async () => {
    const onOver = vi.fn();
    const onAdminSignIn = vi.fn();
    status.mockResolvedValue({ active: false, enforced: false, title: null, message: null, startedAt: null, startsAt: null, endsAt: null, updatedBy: null });
    render(
      <MemoryRouter>
        <Maintenance overlay={{ onOver, onAdminSignIn }} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onOver).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it("starts from what the blocked call told it, before its own check answers", () => {
    status.mockReturnValue(new Promise(() => {}));
    sessionStorage.setItem(MAINTENANCE_STORAGE_KEY, JSON.stringify(live({ title: "From the 503" })));
    renderPage();
    expect(screen.getByText("From the 503")).toBeInTheDocument();
  });

  it("keeps the page and says so when the server cannot be reached", async () => {
    status.mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByText(/Can't reach the server/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers administrator sign-in", async () => {
    status.mockResolvedValue(live());
    renderPage();
    expect(await screen.findByRole("link", { name: /administrator sign in/i })).toHaveAttribute("href", "/login");
  });
});

describe("sendToMaintenancePage", () => {
  const json = (body: unknown, status = 503) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("remembers the answer and tells the overlay to cover the app - no reload", async () => {
    const heard = vi.fn();
    window.addEventListener(MAINTENANCE_EVENT, heard);
    const handled = await sendToMaintenancePage(json({ code: "MAINTENANCE", title: "T", message: "M", endsAt: "2026-10-08T12:00:00Z", startedAt: null }));
    window.removeEventListener(MAINTENANCE_EVENT, heard);
    expect(handled).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(MAINTENANCE_STORAGE_KEY) as string)).toMatchObject({ active: true, title: "T", endsAt: "2026-10-08T12:00:00Z" });
  });

  it("ignores every other 503, and HTML ones", async () => {
    expect(await sendToMaintenancePage(json({ error: "Needs migration 545" }))).toBe(false);
    expect(await sendToMaintenancePage(new Response("<html>", { status: 503, headers: { "content-type": "text/html" } }))).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});

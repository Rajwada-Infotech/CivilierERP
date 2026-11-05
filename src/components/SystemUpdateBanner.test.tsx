import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SystemUpdateBanner } from "./SystemUpdateBanner";
import { reportGatewayFailure, reportSystemRecovered, resetSystemStatus } from "@/lib/systemStatus";

const mount = () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <SystemUpdateBanner />
    </QueryClientProvider>,
  );
  return invalidate;
};

afterEach(() => {
  cleanup();
  resetSystemStatus();
});

describe("SystemUpdateBanner", () => {
  it("is not there while everything is fine", () => {
    mount();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears when a request fails at the gateway, with the plain message", () => {
    mount();
    act(() => reportGatewayFailure());
    expect(screen.getByRole("status")).toHaveTextContent(/Please wait a few seconds for the system to stabilise/);
  });

  it("goes away when the system is back, and the data on screen is refreshed", () => {
    const invalidate = mount();
    act(() => reportGatewayFailure());
    expect(invalidate).not.toHaveBeenCalled();
    act(() => reportSystemRecovered());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

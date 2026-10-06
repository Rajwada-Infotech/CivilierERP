import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AssignmentStatusSelect } from "./AssignmentStatusSelect";

function show(status: Parameters<typeof AssignmentStatusSelect>[0]["status"], resumed = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AssignmentStatusSelect rungId={1} status={status} resumed={resumed} />
    </QueryClientProvider>,
  );
  return screen.getByRole("combobox") as HTMLSelectElement;
}

describe("AssignmentStatusSelect shows the real status", () => {
  it("an Allocated activity reads Allocated, not In Progress", () => {
    const select = show("ALLOCATED");
    expect(select.value).toBe("ALLOCATED");
    expect(select.selectedOptions[0].textContent).toBe("Allocated");
  });

  it("a Pending activity reads Pending", () => {
    expect(show("PENDING").selectedOptions[0].textContent).toBe("Pending");
  });

  it("an In Progress activity still reads In Progress, with Hold and Cancelled offered", () => {
    const select = show("IN_PROGRESS");
    expect(select.value).toBe("IN_PROGRESS");
    expect([...select.options].map((o) => o.textContent)).toEqual(["In Progress", "Hold", "Cancelled"]);
  });
});

describe("Resumed", () => {
  it("an In Progress activity put back after a hold reads Resumed", () => {
    const select = show("IN_PROGRESS", true);
    expect(select.value).toBe("IN_PROGRESS");
    expect(select.selectedOptions[0].textContent).toBe("Resumed");
  });

  it("only In Progress can be Resumed — a hold or a normal start is unchanged", () => {
    expect(show("HOLD", true).selectedOptions[0].textContent).toBe("Hold");
  });

  it("a normal In Progress still reads In Progress", () => {
    expect(show("IN_PROGRESS", false).selectedOptions[0].textContent).toBe("In Progress");
  });
});

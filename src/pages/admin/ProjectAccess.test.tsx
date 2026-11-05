import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ fetch: vi.fn(), canEdit: true }));

vi.mock("@/lib/fetchWithAuth", () => ({ fetchWithAuth: h.fetch }));
vi.mock("@/api/userApi", () => ({
  getUsersForRights: async () => [
    { id: 42, name: "Asha", role: "site_engineer" },
    { id: 43, name: "Ravi", role: "purchase_manager" },
  ],
}));
vi.mock("@/api/roleApi", () => ({
  getRolesList: async () => [
    { RId: 7, RName: "Site Engineer" },
    { RId: 1, RName: "Super Admin" },
  ],
}));
vi.mock("@/hooks/usePageRights", () => ({ usePageRights: () => ({ canEdit: h.canEdit }) }));
vi.mock("@/components/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/admin/AdminShell", () => ({ AdminShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ProjectAccess from "./ProjectAccess";

const PROJECTS = [
  { id: 5, label: "Pristine Enclave" },
  { id: 6, label: "Royal Garden" },
  { id: 9, label: "Magnus" },
];

const json = (body: unknown) => ({ ok: true, json: async () => body });

// Routes the page's requests to canned answers; records PUT bodies.
function wire(answers: { user?: unknown; role?: unknown }) {
  h.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/enterprises/options")) return json(PROJECTS);
    if (init?.method === "PUT") return json({ success: true });
    if (url.startsWith("/api/user-project-access/role/")) return json(answers.role ?? { projectIds: [] });
    if (url.startsWith("/api/user-project-access/")) return json(answers.user ?? { projectIds: [] });
    return json([]);
  });
}
const puts = () => h.fetch.mock.calls.filter((c) => c[1]?.method === "PUT");

beforeEach(() => {
  h.fetch.mockReset();
  h.canEdit = true;
});
afterEach(cleanup);

const pick = async (label: RegExp | string, value: string) => {
  const sel = screen.getByDisplayValue(label) as HTMLSelectElement;
  fireEvent.change(sel, { target: { value } });
};

describe("Project Access — by user", () => {
  it("a user with no personal list but a restricted role is shown as following the role", async () => {
    wire({ user: { projectIds: [], roleId: 7, roleName: "Site Engineer", roleProjectIds: [5, 6] } });
    render(<ProjectAccess />);
    await screen.findByText("Select a user…");
    await pick("Select a user…", "42");
    expect(await screen.findByText(/follows the Site Engineer role: 2 project\(s\)/)).toBeTruthy();
  });

  it("'Start from the role's projects' pre-ticks them and saving writes a personal list", async () => {
    wire({ user: { projectIds: [], roleId: 7, roleName: "Site Engineer", roleProjectIds: [5, 6] } });
    render(<ProjectAccess />);
    await screen.findByText("Select a user…");
    await pick("Select a user…", "42");
    fireEvent.click(await screen.findByRole("button", { name: "Start from the role's projects" }));
    expect((screen.getByLabelText("Pristine Enclave") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Magnus") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][0]).toBe("/api/user-project-access/42");
    expect(JSON.parse(puts()[0][1].body)).toEqual({ projectIds: [5, 6] });
  });

  it("a personal list says it overrides the role's", async () => {
    wire({ user: { projectIds: [9], roleId: 7, roleName: "Site Engineer", roleProjectIds: [5, 6] } });
    render(<ProjectAccess />);
    await screen.findByText("Select a user…");
    await pick("Select a user…", "42");
    expect(await screen.findByText(/overrides the Site Engineer role's list/)).toBeTruthy();
  });

  it("with no role list either, the user is unrestricted", async () => {
    wire({ user: { projectIds: [], roleId: 7, roleName: "Site Engineer", roleProjectIds: [] } });
    render(<ProjectAccess />);
    await screen.findByText("Select a user…");
    await pick("Select a user…", "43");
    expect(await screen.findByText(/has no restrictions and sees every project/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start from the role's projects" })).toBeNull();
  });
});

describe("Project Access — by role", () => {
  const goRole = async () => {
    render(<ProjectAccess />);
    await screen.findByText("Select a user…");
    fireEvent.click(screen.getByRole("button", { name: "By role" }));
    await screen.findByText("Select a role…");
  };

  it("loads a role's projects and saves them through the role endpoint", async () => {
    wire({ role: { projectIds: [5] } });
    await goRole();
    await pick("Select a role…", "7");
    await waitFor(() => expect((screen.getByLabelText("Pristine Enclave") as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/without a personal list will only see the 1 ticked project/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Magnus"));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][0]).toBe("/api/user-project-access/role/7");
    expect(JSON.parse(puts()[0][1].body).projectIds.sort()).toEqual([5, 9]);
  });

  it("an empty role list means the role is unrestricted", async () => {
    wire({ role: { projectIds: [] } });
    await goRole();
    await pick("Select a role…", "7");
    expect(await screen.findByText(/Nobody in Site Engineer is restricted by the role/)).toBeTruthy();
  });

  it("an admin role is shown as never restricted and cannot be edited", async () => {
    wire({ role: { projectIds: [] } });
    await goRole();
    await pick("Select a role…", "1");
    expect(await screen.findByText(/admins are never restricted/)).toBeTruthy();
    expect((screen.getByLabelText("Magnus") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });

  it("switching modes clears the previous selection", async () => {
    wire({ role: { projectIds: [5] }, user: { projectIds: [], roleProjectIds: [] } });
    await goRole();
    await pick("Select a role…", "7");
    await waitFor(() => expect(screen.getByLabelText("Pristine Enclave")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "By user" }));
    expect(await screen.findByText(/Pick a user to manage/)).toBeTruthy();
    expect(screen.queryByLabelText("Pristine Enclave")).toBeNull();
  });
});

describe("Project Access — without edit rights", () => {
  it("shows the lists read-only with no Save button", async () => {
    h.canEdit = false;
    wire({ user: { projectIds: [5], roleId: 7, roleName: "x", roleProjectIds: [] } });
    render(<ProjectAccess />);
    await screen.findByText("Select a user…");
    await pick("Select a user…", "42");
    await waitFor(() => expect((screen.getByLabelText("Pristine Enclave") as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText("Pristine Enclave") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });
});

import React, { useState, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  Edit,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  UserPlus,
  X,
  Users as UsersIcon,
  ShieldCheck,
  Circle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getRolesList } from "@/api/roleApi";
import { getDepartmentOptions } from "@/api/departmentMasterApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { BodyPortal } from "@/components/ui/body-portal";

// ─── Types ───────────────────────────────────────────────────────────────────
interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  roleName: string;
  RoleId: number;
  created_datetime: string;
  discontinue: boolean;
  can_accept_tickets?: boolean;
  DepartmentId?: number | null;
  DepartmentName?: string | null;
}

// ─── API calls ────────────────────────────────────────────────────────────────
const BASE_URL = "/api/users";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${sessionStorage.getItem("token") ?? ""}`,
});

const getUsers = async (): Promise<User[]> => {
  const res = await fetch(BASE_URL, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => ({}));
};

const addUserApi = async (user: {
  name: string;
  email: string;
  RoleId: number;
  password: string;
  can_accept_tickets?: boolean;
  DepartmentId?: number | null;
}) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      throw new Error(
        data?.error ||
          `The email "${user.email}" is already registered to another user.`,
      );
    }
    throw new Error(data?.error || "Failed to add user");
  }
  return res.json().catch(() => ({}));
};

const updateUserApi = async (id: number, data: Partial<User>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      throw new Error(
        body?.error ||
          `The email "${data.email}" is already registered to another user.`,
      );
    }
    throw new Error(body?.error || "Failed to update user");
  }
  return res.json().catch(() => ({}));
};

const updateTicketAcceptanceApi = async (id: number, canAccept: boolean) => {
  const res = await fetch(`${BASE_URL}/${id}/ticket-access`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ can_accept_tickets: canAccept }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || "Failed to update ticket acceptance");
  }
  return res.json().catch(() => ({}));
};

const deleteUserApi = async (id: number) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to delete user");
  }
  return res.json().catch(() => ({}));
};

// ─── Avatar helper ────────────────────────────────────────────────────────────
const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const INPUT = "w-full h-10 px-3 bg-card border border-foreground/40 focus:border-foreground outline-none text-sm text-foreground placeholder:text-muted-foreground/60";
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 whitespace-nowrap";

// ─── Component ────────────────────────────────────────────────────────────────

function buildUserColumns(
  roles: { RId: number; RName: string }[],
  deleteConfirmId: number | null,
  setDeleteConfirmId: (id: number | null) => void,
  setEditUserId: (id: number) => void,
  setViewUserId: (id: number) => void,
  updateMutation: { mutate: (args: { id: number; data: any }) => void },
  ticketAccessMutation: {
    mutate: (args: { id: number; canAccept: boolean }) => void;
    isPending?: boolean;
  },
  deleteMutation: { mutate: (id: number) => void },
): ColumnDef<User, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: "User",
      size: 240,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 flex items-center justify-center text-[0.625rem] font-heading font-bold flex-shrink-0 border ${row.original.discontinue ? "border-foreground/40 text-muted-foreground" : "border-foreground text-foreground"}`}>
            {getInitials(row.original.name)}
          </div>
          <div className="min-w-0">
            <p className={`font-semibold truncate ${row.original.discontinue ? "text-muted-foreground" : "text-foreground"}`}>{row.original.name}</p>
            <p className="text-xs text-muted-foreground truncate">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "roleName",
      header: "Role",
      size: 140,
      cell: ({ row }) => (
        <span className={`${TAG} text-foreground border border-foreground/40`}>
          {row.original.roleName ?? roles.find((r) => r.RId === row.original.RoleId)?.RName ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "DepartmentName",
      header: "Department",
      size: 140,
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.DepartmentName ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "can_accept_tickets",
      header: "Ticket Access",
      size: 140,
      cell: ({ row }) => {
        const user = row.original;
        const canAccept =
          !!user.can_accept_tickets ||
          ["admin", "super_admin", "dba"].includes(user.role);
        const lockedByRole = ["admin", "super_admin", "dba"].includes(user.role);
        return (
          <button
            type="button"
            disabled={lockedByRole || ticketAccessMutation.isPending}
            onClick={() =>
              ticketAccessMutation.mutate({
                id: user.id,
                canAccept: !user.can_accept_tickets,
              })
            }
            className={`${TAG} border transition-colors ${
              canAccept
                ? "bg-foreground text-card border-foreground"
                : "border-dashed border-foreground/50 text-muted-foreground hover:text-foreground hover:border-foreground"
            } ${lockedByRole ? "opacity-70 cursor-not-allowed" : ""}`}
            title={
              lockedByRole
                ? "Privileged roles can always accept tickets"
                : "Toggle ticket acceptance"
            }
          >
            {canAccept ? "Can accept" : "No accept"}
          </button>
        );
      },
    },
    {
      accessorKey: "discontinue",
      header: "Status",
      size: 110,
      cell: ({ getValue }) => {
        const inactive = getValue() as boolean;
        return (
          !inactive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      size: 220,
      enableSorting: false,
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center justify-end gap-2.5">
            <button data-row-view onClick={() => setViewUserId(user.id)} className={ACT} title="View" aria-label="View"><Eye size={13} /></button>
            <button onClick={() => setEditUserId(user.id)} className={ACT} title="Edit" aria-label="Edit"><Edit size={13} /></button>
            <button
              onClick={() => updateMutation.mutate({ id: user.id, data: { discontinue: !user.discontinue } })}
              className={`${KEY} h-7 px-2.5 border ${!user.discontinue ? "border-foreground/40 text-muted-foreground hover:text-destructive hover:border-destructive" : "border-foreground text-foreground hover:bg-primary/10"}`}
            >
              {!user.discontinue ? "Deactivate" : "Activate"}
            </button>
            {deleteConfirmId === user.id ? (
              <div className="flex items-center gap-1 ml-1">
                <button onClick={() => deleteMutation.mutate(user.id)} className={`${KEY} h-7 px-2.5 bg-destructive text-destructive-foreground border border-destructive`}>Confirm</button>
                <button onClick={() => setDeleteConfirmId(null)} className={`${KEY} h-7 px-2 text-muted-foreground hover:text-foreground`}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirmId(user.id)} className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors" title="Delete" aria-label="Delete"><Trash2 size={13} /></button>
            )}
          </div>
        );
      },
    },
  ];
}

const Users = () => {
  const queryClient = useQueryClient();

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["roles:list"],
    queryFn: getRolesList,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["department-master"],
    queryFn: getDepartmentOptions,
  });

  const addMutation = useMutation({
    mutationFn: addUserApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User added successfully.");
      resetForm();
      setDrawerOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<User> }) =>
      updateUserApi(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated successfully.");
      resetForm();
      setDrawerOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const ticketAccessMutation = useMutation({
    mutationFn: ({ id, canAccept }: { id: number; canAccept: boolean }) =>
      updateTicketAcceptanceApi(id, canAccept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Ticket acceptance updated.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUserApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted.");
      setDeleteConfirmId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [form, setForm] = useState({
    name: "",
    email: "",
    RoleId: 0,
    DepartmentId: 0,
    password: "",
    isActive: true,
    canAcceptTickets: false,
  });

  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [viewUserId, setViewUserId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showPass, setShowPass] = useState(false);

  const columns = useMemo(
    () => buildUserColumns(roles, deleteConfirmId, setDeleteConfirmId, setEditUserId, setViewUserId, updateMutation, ticketAccessMutation, deleteMutation),
    [roles, deleteConfirmId, deleteMutation.isPending, ticketAccessMutation.isPending],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (editUserId !== null) {
      const user = allUsers.find((u) => u.id === editUserId);
      if (user) {
        setForm({
          name: user.name,
          email: user.email,
          RoleId: user.RoleId ?? 0,
          DepartmentId: user.DepartmentId ?? 0,
          password: "",
          isActive: !user.discontinue,
          canAcceptTickets: !!user.can_accept_tickets,
        });
        setDrawerOpen(true);
      }
    }
  }, [editUserId, allUsers]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and Email are required.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (editUserId === null && !form.password.trim()) {
      toast.error("Password is required when adding a new user.");
      return;
    }

    if (editUserId !== null) {
      updateMutation.mutate({
        id: editUserId,
        data: {
          name: form.name.trim(),
          email: form.email.trim(),
          RoleId: form.RoleId,
          DepartmentId: form.DepartmentId || null,
          discontinue: !form.isActive,
          can_accept_tickets: form.canAcceptTickets,
        },
      });
    } else {
      addMutation.mutate({
        name: form.name.trim(),
        email: form.email.trim(),
        RoleId: form.RoleId,
        DepartmentId: form.DepartmentId || null,
        password: form.password,
        can_accept_tickets: form.canAcceptTickets,
      });
    }
  };

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      RoleId: 0,
      DepartmentId: 0,
      password: "",
      isActive: true,
      canAcceptTickets: false,
    });
    setEditUserId(null);
    setShowPass(false);
  };

  const openAddDrawer = () => {
    resetForm();
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    resetForm();
  };


  const viewedUser =
    viewUserId !== null ? allUsers.find((u) => u.id === viewUserId) : null;

  const activeCount = allUsers.filter((u) => !u.discontinue).length;
  const inactiveCount = allUsers.filter((u) => u.discontinue).length;

  // Supplier Master auto-creates a login (role='supplier', LinkedLHeadId ->
  // the ledger head) for portal access — see accountHeadMaster.js. Those
  // aren't manually-managed system users, so keep them in their own section
  // instead of mixed in with the normally-created ones.
  const supplierUsers = allUsers.filter(
    (u) => (u.roleName ?? "").trim().toLowerCase() === "supplier",
  );
  const normalUsers = allUsers.filter(
    (u) => (u.roleName ?? "").trim().toLowerCase() !== "supplier",
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Users"]} />

      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="Users"
        subtitle="Everyone who can sign in: their role, department and whether they take tickets. Supplier portal logins are listed separately."
        action={
          <button onClick={openAddDrawer} className={`${KEY_INK} h-9 px-4 shrink-0`}>
            <UserPlus size={13} />
            New user
          </button>
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Users", value: allUsers.length, note: `${normalUsers.length} staff · ${supplierUsers.length} supplier portal` },
              { label: "Active", value: activeCount, note: "can sign in" },
              { label: "Inactive", value: inactiveCount, note: "sign-in blocked" },
            ].map((s) => (
              <div key={s.label}>
                <p className="label">{s.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : s.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{s.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5">
              <span className={HEAD}>System users</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{normalUsers.length}</span>
            </p>
          </div>
          <DataTable
            data={normalUsers}
            columns={columns}
            loading={isLoading}
            searchPlaceholder="Search users…"
            emptyMessage="No users added yet."
            defaultPageSize={25}
          />
        </div>

        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex flex-wrap items-baseline gap-2.5">
              <span className={HEAD}>Supplier portal users</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{supplierUsers.length}</span>
              <span className="text-xs text-muted-foreground">created automatically from Supplier Master</span>
            </p>
          </div>
          <DataTable
            data={supplierUsers}
            columns={columns}
            loading={isLoading}
            searchPlaceholder="Search suppliers…"
            emptyMessage="No supplier portal logins yet."
            defaultPageSize={25}
          />
        </div>
      </SheetShell>

      {/* ── Add / Edit Drawer ── */}
      {drawerOpen && (
        <BodyPortal><div
          className="fixed inset-0 bg-black/50 z-[60] flex justify-end"
          onClick={closeDrawer}
        >
          <div
            className="sheet-frame relative w-full max-w-md h-full bg-card flex flex-col overflow-y-auto" style={{ margin: 0, borderLeft: RULE }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-5 flex-shrink-0" style={{ borderBottom: RULE }}>
              <div>
                <p className={LBL}>User</p>
                <h2 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1">
                  {editUserId !== null ? "Edit user" : "New user"}
                </h2>
              </div>
              <button
                onClick={closeDrawer}
                className={ACT}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer body */}
            <form
              onSubmit={handleSubmit}
              className="flex flex-col flex-1 px-6 py-6 gap-5"
            >
              <div>
                <label className={`${LBL} mb-1.5 block`}>
                  Full Name *
                </label>
                <input
                  name="name"
                  placeholder="e.g. Rahul Sharma"
                  value={form.name}
                  onChange={handleChange}
                  required
                  className={INPUT}
                />
              </div>

              <div>
                <label className={`${LBL} mb-1.5 block`}>
                  Email Address *
                </label>
                <input
                  name="email"
                  type="email"
                  placeholder="user@company.com"
                  value={form.email}
                  onChange={handleChange}
                  required
                  className={INPUT}
                />
              </div>

              <div>
                <label className={`${LBL} mb-1.5 block`}>
                  Role
                </label>
                <div className="relative">
                  <select
                    name="RoleId"
                    value={form.RoleId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        RoleId: Number(e.target.value),
                      }))
                    }
                    className={`${INPUT} pr-9 appearance-none`}
                  >
                    <option value={0}>Select a role…</option>
                    {roles.map((r) => (
                      <option key={r.RId} value={r.RId}>
                        {r.RName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                </div>
              </div>

              <div>
                <label className={`${LBL} mb-1.5 block`}>
                  Department
                </label>
                <div className="relative">
                  <select
                    name="DepartmentId"
                    value={form.DepartmentId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        DepartmentId: Number(e.target.value),
                      }))
                    }
                    className={`${INPUT} pr-9 appearance-none`}
                  >
                    <option value={0}>Select a department…</option>
                    {departments.map((d) => (
                      <option key={d.Id} value={d.Id}>
                        {d.DepartmentName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                </div>
              </div>

              {editUserId === null && (
                <div>
                  <label className={`${LBL} mb-1.5 block`}>
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPass ? "text" : "password"}
                      placeholder="Set a password"
                      value={form.password}
                      onChange={handleChange}
                      required
                      className={`${INPUT} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((p) => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5 p-3.5 border border-foreground/30">
                <input
                  type="checkbox"
                  name="isActive"
                  id="isActive"
                  aria-label="Active User"
                  checked={form.isActive}
                  onChange={handleChange}
                  className="h-4 w-4 accent-foreground"
                />
                <label
                  htmlFor="isActive"
                  className="text-sm text-foreground cursor-pointer select-none flex-1"
                >
                  Active User
                </label>
                <span
                  className={`${TAG} ${
                    form.isActive
                      ? "bg-foreground text-card"
                      : "text-muted-foreground border border-dashed border-foreground/50"
                  }`}
                >
                  {form.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="flex items-center gap-2.5 p-3.5 border border-foreground/30">
                <input
                  type="checkbox"
                  name="canAcceptTickets"
                  id="canAcceptTickets"
                  aria-label="Can Accept Tickets"
                  checked={form.canAcceptTickets}
                  onChange={handleChange}
                  className="h-4 w-4 accent-foreground"
                />
                <label
                  htmlFor="canAcceptTickets"
                  className="text-sm text-foreground cursor-pointer select-none flex-1"
                >
                  Can accept tickets
                </label>
                <span
                  className={`${TAG} ${
                    form.canAcceptTickets
                      ? "bg-foreground text-card"
                      : "text-muted-foreground border border-dashed border-foreground/50"
                  }`}
                >
                  {form.canAcceptTickets ? "Enabled" : "Off"}
                </span>
              </div>

              {/* Drawer footer */}
              <div className="flex gap-2 mt-auto pt-4" style={{ borderTop: RULE }}>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className={`${KEY_LINE} flex-1 h-10`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addMutation.isPending || updateMutation.isPending}
                  className={`${KEY_INK} flex-1 h-10`}
                >
                  {addMutation.isPending || updateMutation.isPending
                    ? "Saving…"
                    : editUserId !== null
                      ? "Update user"
                      : "Add user"}
                </button>
              </div>
            </form>
          </div>
        </div></BodyPortal>
      )}

      {/* ── View User Modal ── */}
      {viewedUser && (
        <BodyPortal><div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
          onClick={() => setViewUserId(null)}
        >
          <div
            className="sheet-frame bg-card p-6 w-full max-w-sm mx-4"
            style={{ margin: 0, border: RULE, boxShadow: "8px 8px 0 hsl(var(--foreground) / 0.12)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Avatar header */}
            <div className="flex items-center gap-4 pb-4 mb-4" style={{ borderBottom: RULE }}>
              <div className="w-14 h-14 flex items-center justify-center text-lg font-heading font-bold border border-foreground text-foreground shrink-0">
                {getInitials(viewedUser.name)}
              </div>
              <div className="min-w-0">
                <h2 className="font-heading text-lg font-bold tracking-tight text-foreground truncate">
                  {viewedUser.name}
                </h2>
                <p className="text-sm text-muted-foreground truncate">
                  {viewedUser.email}
                </p>
                <div className="mt-1.5">
                  {!viewedUser.discontinue ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>Inactive</span>}
                </div>
              </div>
            </div>

            <div className="text-sm divide-y divide-foreground/15">
              <div className="flex justify-between py-2">
                <span className={LBL}>Role</span>
                <span className="font-medium text-foreground">
                  {viewedUser.roleName ??
                    roles.find((r) => r.RId === viewedUser.RoleId)?.RName ??
                    "—"}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className={LBL}>Department</span>
                <span className="font-medium text-foreground">
                  {viewedUser.DepartmentName ?? "—"}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className={LBL}>Created</span>
                <span className="font-medium text-foreground">
                  {new Date(viewedUser.created_datetime).toLocaleDateString(
                    "en-IN",
                    { day: "numeric", month: "short", year: "numeric" },
                  )}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className={LBL}>Ticket Accept</span>
                <span className="font-medium text-foreground">
                  {viewedUser.can_accept_tickets ||
                  ["admin", "super_admin", "dba"].includes(viewedUser.role)
                    ? "Allowed"
                    : "Not allowed"}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className={LBL}>User ID</span>
                <span className="font-heading text-xs tabular-nums text-muted-foreground">
                  #{viewedUser.id}
                </span>
              </div>
            </div>

            <button
              onClick={() => setViewUserId(null)}
              className={`${KEY_LINE} h-9 mt-5 w-full`}
            >
              Close
            </button>
          </div>
        </div></BodyPortal>
      )}
    </>
  );
};

export default Users;
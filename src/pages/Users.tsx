import React, { useState, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
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
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

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
}

// ─── API calls ────────────────────────────────────────────────────────────────
const BASE_URL = "/api/users";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
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

const avatarColors = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-indigo-500",
];
const getAvatarColor = (id: number) => avatarColors[id % avatarColors.length];

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
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${getAvatarColor(row.original.id)}`}>
            {getInitials(row.original.name)}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{row.original.name}</p>
            <p className="text-xs text-muted-foreground truncate">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "roleName",
      header: "Role",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-xs font-medium text-foreground">
          <ShieldCheck size={12} className="text-primary" />
          {row.original.roleName ?? roles.find((r) => r.RId === row.original.RoleId)?.RName ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "can_accept_tickets",
      header: "Ticket Access",
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
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition ${
              canAccept
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            } ${lockedByRole ? "opacity-70 cursor-not-allowed" : ""}`}
            title={
              lockedByRole
                ? "Privileged roles can always accept tickets"
                : "Toggle ticket acceptance"
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                canAccept ? "bg-blue-500" : "bg-muted-foreground"
              }`}
            />
            {canAccept ? "Can accept" : "No accept"}
          </button>
        );
      },
    },
    {
      accessorKey: "discontinue",
      header: "Status",
      cell: ({ getValue }) => {
        const inactive = getValue() as boolean;
        return (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${!inactive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${!inactive ? "bg-emerald-500" : "bg-rose-500"}`} />
            {!inactive ? "Active" : "Inactive"}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => setViewUserId(user.id)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition" title="View"><Eye size={15} /></button>
            <button onClick={() => setEditUserId(user.id)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition" title="Edit"><Edit size={15} /></button>
            <button
              onClick={() => updateMutation.mutate({ id: user.id, data: { discontinue: !user.discontinue } })}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${!user.discontinue ? "bg-rose-100 text-rose-600 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400"}`}
            >
              {!user.discontinue ? "Deactivate" : "Activate"}
            </button>
            {deleteConfirmId === user.id ? (
              <div className="flex items-center gap-1 ml-1">
                <button onClick={() => deleteMutation.mutate(user.id)} className="text-xs px-2.5 py-1 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition font-medium">Confirm</button>
                <button onClick={() => setDeleteConfirmId(null)} className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground transition">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirmId(user.id)} className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition" title="Delete"><Trash2 size={15} /></button>
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
          discontinue: !form.isActive,
          can_accept_tickets: form.canAcceptTickets,
        },
      });
    } else {
      addMutation.mutate({
        name: form.name.trim(),
        email: form.email.trim(),
        RoleId: form.RoleId,
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

      <AdminShell
        title="User Master"
        subtitle="Manage system users and access roles"
        icon={UsersIcon}
        action={
          <button
            onClick={openAddDrawer}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
          >
            <UserPlus size={15} />
            Add User
          </button>
        }
      >
      {/* ── Stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Total Users",
            value: allUsers.length,
            icon: UsersIcon,
            color: "text-primary",
          },
          {
            label: "Active",
            value: activeCount,
            icon: ShieldCheck,
            color: "text-emerald-500",
          },
          {
            label: "Inactive",
            value: inactiveCount,
            icon: Circle,
            color: "text-rose-400",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="glass rounded-xl px-5 py-4 flex items-center gap-4"
          >
            <div className={`p-2.5 rounded-lg bg-muted ${color}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold font-heading text-foreground leading-none">
                {value}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Normal users table ── */}
      <div className="flex items-center gap-2 mt-2">
        <UsersIcon size={15} className="text-primary" />
        <h3 className="font-heading font-semibold text-sm text-foreground">
          System Users
        </h3>
        <span className="text-xs text-muted-foreground">({normalUsers.length})</span>
      </div>
      <div className="glass rounded-xl overflow-hidden">
        <DataTable
          data={normalUsers}
          columns={columns}
          loading={isLoading}
          searchPlaceholder="Search users…"
          emptyMessage="No users added yet."
          defaultPageSize={25}
        />
      </div>

      {/* ── Supplier Master portal users table ── */}
      <div className="flex items-center gap-2 mt-4">
        <ShieldCheck size={15} className="text-primary" />
        <h3 className="font-heading font-semibold text-sm text-foreground">
          Supplier Portal Users
        </h3>
        <span className="text-xs text-muted-foreground">
          ({supplierUsers.length}) — auto-created from Supplier Master
        </span>
      </div>
      <div className="glass rounded-xl overflow-hidden">
        <DataTable
          data={supplierUsers}
          columns={columns}
          loading={isLoading}
          searchPlaceholder="Search suppliers…"
          emptyMessage="No supplier portal logins yet."
          defaultPageSize={25}
        />
      </div>

      </AdminShell>

      {/* ── Add / Edit Drawer ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 flex justify-end"
          onClick={closeDrawer}
        >
          <div
            className="relative w-full max-w-md h-full bg-card border-l border-border shadow-2xl flex flex-col overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <UserPlus size={18} />
                </div>
                <h2 className="font-heading font-semibold text-foreground">
                  {editUserId !== null ? "Edit User" : "New User"}
                </h2>
              </div>
              <button
                onClick={closeDrawer}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
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
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Full Name *
                </label>
                <input
                  name="name"
                  placeholder="e.g. Rahul Sharma"
                  value={form.name}
                  onChange={handleChange}
                  required
                  className="w-full h-10 px-3 bg-input/70 border border-border rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Email Address *
                </label>
                <input
                  name="email"
                  type="email"
                  placeholder="user@company.com"
                  value={form.email}
                  onChange={handleChange}
                  required
                  className="w-full h-10 px-3 bg-input/70 border border-border rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
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
                    className="w-full h-10 px-3 pr-9 bg-input/70 border border-border rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none appearance-none text-sm text-foreground"
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

              {editUserId === null && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
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
                      className="w-full h-10 px-3 pr-10 bg-input/70 border border-border rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm"
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

              <div className="flex items-center gap-2.5 p-3.5 rounded-lg bg-muted/50 border border-border">
                <input
                  type="checkbox"
                  name="isActive"
                  id="isActive"
                  aria-label="Active User"
                  checked={form.isActive}
                  onChange={handleChange}
                  className="h-4 w-4 accent-primary"
                />
                <label
                  htmlFor="isActive"
                  className="text-sm text-foreground cursor-pointer select-none flex-1"
                >
                  Active User
                </label>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    form.isActive
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                  }`}
                >
                  {form.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="flex items-center gap-2.5 p-3.5 rounded-lg bg-muted/50 border border-border">
                <input
                  type="checkbox"
                  name="canAcceptTickets"
                  id="canAcceptTickets"
                  aria-label="Can Accept Tickets"
                  checked={form.canAcceptTickets}
                  onChange={handleChange}
                  className="h-4 w-4 accent-primary"
                />
                <label
                  htmlFor="canAcceptTickets"
                  className="text-sm text-foreground cursor-pointer select-none flex-1"
                >
                  Can accept tickets
                </label>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    form.canAcceptTickets
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {form.canAcceptTickets ? "Enabled" : "Off"}
                </span>
              </div>

              {/* Drawer footer */}
              <div className="flex gap-3 mt-auto pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="flex-1 h-10 border border-border hover:bg-muted rounded-lg text-sm font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addMutation.isPending || updateMutation.isPending}
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto flex-1 flex items-center justify-center rounded-lg disabled:opacity-50 transition-all"
                >
                  {addMutation.isPending || updateMutation.isPending
                    ? "Saving…"
                    : editUserId !== null
                      ? "Update User"
                      : "Add User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── View User Modal ── */}
      {viewedUser && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setViewUserId(null)}
        >
          <div
            className="glass p-6 rounded-2xl w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Avatar header */}
            <div className="flex flex-col items-center mb-6 text-center">
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mb-3 ${getAvatarColor(viewedUser.id)}`}
              >
                {getInitials(viewedUser.name)}
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {viewedUser.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {viewedUser.email}
              </p>
              <span
                className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full ${
                  !viewedUser.discontinue
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${!viewedUser.discontinue ? "bg-emerald-500" : "bg-rose-500"}`}
                />
                {!viewedUser.discontinue ? "Active" : "Inactive"}
              </span>
            </div>

            <div className="space-y-3 text-sm border-t border-border pt-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Role</span>
                <span className="font-medium text-foreground">
                  {viewedUser.roleName ??
                    roles.find((r) => r.RId === viewedUser.RoleId)?.RName ??
                    "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium text-foreground">
                  {new Date(viewedUser.created_datetime).toLocaleDateString(
                    "en-IN",
                    { day: "numeric", month: "short", year: "numeric" },
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ticket Accept</span>
                <span className="font-medium text-foreground">
                  {viewedUser.can_accept_tickets ||
                  ["admin", "super_admin", "dba"].includes(viewedUser.role)
                    ? "Allowed"
                    : "Not allowed"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">User ID</span>
                <span className="font-mono text-xs text-muted-foreground">
                  #{viewedUser.id}
                </span>
              </div>
            </div>

            <button
              onClick={() => setViewUserId(null)}
              className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto mt-6 w-full flex items-center justify-center rounded-lg transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Users;
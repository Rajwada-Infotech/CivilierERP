import React, { useState, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Search, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  created_datetime: string;
  discontinue: boolean;
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
  return res.json();
};

const addUserApi = async (user: {
  name: string;
  email: string;
  role: string;
  password: string;
}) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to add user");
  }
  return res.json();
};

const updateUserApi = async (id: number, data: Partial<User>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || "Failed to update user");
  }
  return res.json();
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
  return res.json();
};

// ─── Component ────────────────────────────────────────────────────────────────
const Users = () => {
  const queryClient = useQueryClient();

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
  });

  const addMutation = useMutation({
    mutationFn: addUserApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User added successfully.");
      resetForm();
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
    role: "user",
    password: "",
    isActive: true,
  });

  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [viewUserId, setViewUserId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (editUserId !== null) {
      const user = allUsers.find((u) => u.id === editUserId);
      if (user) {
        setForm({
          name: user.name,
          email: user.email,
          role: user.role || "user",
          password: "",
          isActive: !user.discontinue,
        });
      }
    } else {
      resetForm();
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
          role: form.role,
          discontinue: !form.isActive,
        },
      });
    } else {
      addMutation.mutate({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password,
      });
    }
  };

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      role: "user",
      password: "",
      isActive: true,
    });
    setEditUserId(null);
  };

  const filteredUsers = allUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(filter.toLowerCase()) ||
      u.email.toLowerCase().includes(filter.toLowerCase()),
  );

  const viewedUser =
    viewUserId !== null ? allUsers.find((u) => u.id === viewUserId) : null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Users"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-6">
        User Master
      </h1>

      {/* ADD / EDIT FORM */}
      <div className="glass rounded-xl p-6 mb-8">
        <h2 className="font-heading font-semibold text-foreground mb-5">
          {editUserId !== null ? "Edit User" : "Add New User"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Full Name *
              </label>
              <input
                name="name"
                placeholder="Full Name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Role
              </label>
              <input
                name="role"
                placeholder="Role"
                value={form.role}
                onChange={handleChange}
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Email *
              </label>
              <input
                name="email"
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={handleChange}
                required
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            {editUserId === null && (
              <div className="relative">
                <label className="text-xs text-muted-foreground mb-1 block">
                  Password *
                </label>
                <input
                  name="password"
                  type={showPass ? "text" : "password"}
                  placeholder="Password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  className="w-full h-10 px-3 pr-10 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  className="absolute right-3 top-7 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                name="isActive"
                aria-label="Active User"
                checked={form.isActive}
                onChange={handleChange}
                className="h-4 w-4 accent-primary"
              />
              <label className="text-sm text-muted-foreground cursor-pointer">
                Active User
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            {editUserId !== null && (
              <button
                type="button"
                onClick={resetForm}
                className="px-5 h-10 border border-border hover:bg-muted rounded-md text-sm font-medium transition"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={addMutation.isPending || updateMutation.isPending}
              className="px-6 h-10 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition text-sm font-medium disabled:opacity-50"
            >
              {editUserId !== null ? "Update User" : "Add User"}
            </button>
          </div>
        </form>
      </div>

      {/* SEARCH */}
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          title="Toggle search filter"
          onClick={() => setShowFilter(!showFilter)}
          className="p-2.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition"
        >
          <Search size={18} />
        </button>
        {showFilter && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name or email..."
            className="px-4 h-10 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary outline-none w-80"
          />
        )}
      </div>

      {/* USERS TABLE */}
      <div className="glass rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-6 py-12 text-center text-muted-foreground">
            Loading users...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-6 py-4 text-left font-medium">Name</th>
                <th className="px-6 py-4 text-left font-medium">Email</th>
                <th className="px-6 py-4 text-left font-medium">Role</th>
                <th className="px-6 py-4 text-left font-medium">Status</th>
                <th className="px-6 py-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-muted-foreground"
                  >
                    {filter
                      ? "No users found matching your search."
                      : "No users added yet."}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-border hover:bg-muted/30 transition"
                  >
                    <td className="px-6 py-4 font-medium">{user.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {user.role}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-3 py-1 text-xs font-medium rounded-full ${
                          !user.discontinue
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {!user.discontinue ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 flex justify-end gap-2">
                      <button
                        onClick={() => setViewUserId(user.id)}
                        className="p-2 rounded hover:bg-muted transition"
                        title="View Details"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => setEditUserId(user.id)}
                        className="p-2 rounded hover:bg-muted transition"
                        title="Edit User"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() =>
                          updateMutation.mutate({
                            id: user.id,
                            data: { discontinue: !user.discontinue },
                          })
                        }
                        className="p-2 rounded hover:bg-muted transition text-xs"
                        title={!user.discontinue ? "Deactivate" : "Activate"}
                      >
                        {!user.discontinue ? "Deactivate" : "Activate"}
                      </button>
                      {deleteConfirmId === user.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => deleteMutation.mutate(user.id)}
                            className="text-xs px-3 py-1 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="text-xs px-3 py-1 text-muted-foreground hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(user.id)}
                          className="p-2 rounded hover:bg-destructive/10 text-destructive transition"
                          title="Delete User"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* VIEW USER MODAL */}
      {viewedUser && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setViewUserId(null)}
        >
          <div
            className="glass p-6 rounded-2xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-5">User Details</h2>
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">Name:</span>{" "}
                {viewedUser.name}
              </p>
              <p>
                <span className="text-muted-foreground">Email:</span>{" "}
                {viewedUser.email}
              </p>
              <p>
                <span className="text-muted-foreground">Role:</span>{" "}
                {viewedUser.role}
              </p>
              <p>
                <span className="text-muted-foreground">Created:</span>{" "}
                {new Date(viewedUser.created_datetime).toLocaleDateString()}
              </p>
              <p>
                <span className="text-muted-foreground">Status:</span>{" "}
                <span
                  className={`font-medium ${
                    !viewedUser.discontinue
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {!viewedUser.discontinue ? "Active" : "Inactive"}
                </span>
              </p>
            </div>
            <button
              onClick={() => setViewUserId(null)}
              className="mt-6 w-full h-10 bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition"
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

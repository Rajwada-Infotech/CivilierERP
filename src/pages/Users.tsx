import React, { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Search, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const Users = () => {
  const { allUsers, addUser, deleteUser, toggleUserStatus } = useAuth();

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    alias: "",
    password: "",
    isActive: true,
  });

  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  // Load user data when editing
  useEffect(() => {
    if (editUserId) {
      const user = allUsers.find((u) => u.id === editUserId);
      if (user) {
        setForm({
          name: user.name,
          email: user.email,
          phone: (user as any).phone || "",
          alias: (user as any).alias || "",
          password: "",
          isActive: user.isActive,
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
    if (!editUserId && !form.password.trim()) {
      toast.error("Password is required when adding a new user.");
      return;
    }

    const userData = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      alias: form.alias.trim() || undefined,
      initials: form.name
        .trim()
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      role: "user" as const,
      pagePermissions: [],
      isActive: form.isActive,
    };

    if (editUserId) {
      // Update status only if changed
      if (
        form.isActive !== allUsers.find((u) => u.id === editUserId)?.isActive
      ) {
        toggleUserStatus(editUserId);
      }
      toast.success(`User "${form.name}" updated successfully.`);
      setEditUserId(null);
      resetForm();
    } else {
      addUser({
        ...userData,
        password: form.password,
      });
      toast.success(`User "${form.name}" added successfully.`);
      resetForm();
    }
  };

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      phone: "",
      alias: "",
      password: "",
      isActive: true,
    });
    setEditUserId(null);
  };

  const handleEdit = (userId: string) => {
    setEditUserId(userId);
  };

  const handleDelete = (userId: string) => {
    deleteUser(userId);
    setDeleteConfirmId(null);
    toast.success("User has been deleted.");
  };

  const toggleStatus = (userId: string) => {
    toggleUserStatus(userId);
    toast.success("User status updated.");
  };

  const filteredUsers = allUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(filter.toLowerCase()) ||
      u.email.toLowerCase().includes(filter.toLowerCase()),
  );

  const viewedUser = viewUserId
    ? allUsers.find((u) => u.id === viewUserId)
    : null;

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Admin", "Users"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-6">
        User Master
      </h1>

      {/* ADD / EDIT FORM */}
      <div className="glass rounded-xl p-6 mb-8">
        <h2 className="font-heading font-semibold text-foreground mb-5">
          {editUserId ? "Edit User" : "Add New User"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Full Name *
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Alias
              </label>
              <input
                name="alias"
                value={form.alias}
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
                value={form.email}
                onChange={handleChange}
                required
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Phone
              </label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            {/* Password field - only for new users */}
            {!editUserId && (
              <div className="relative">
                <label className="text-xs text-muted-foreground mb-1 block">
                  Password *
                </label>
                <input
                  name="password"
                  type={showPass ? "text" : "password"}
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
            {editUserId && (
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
              className="px-6 h-10 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition text-sm font-medium"
            >
              {editUserId ? "Update User" : "Add User"}
            </button>
          </div>
        </form>
      </div>

      {/* SEARCH */}
      <div className="flex items-center gap-3 mb-5">
        <button
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
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-6 py-4 text-left font-medium">Name</th>
              <th className="px-6 py-4 text-left font-medium">Email</th>
              <th className="px-6 py-4 text-left font-medium">Status</th>
              <th className="px-6 py-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
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
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block px-3 py-1 text-xs font-medium rounded-full ${
                        user.isActive
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {user.isActive ? "Active" : "Inactive"}
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
                      onClick={() => handleEdit(user.id)}
                      className="p-2 rounded hover:bg-muted transition"
                      title="Edit User"
                    >
                      <Edit size={16} />
                    </button>

                    <button
                      onClick={() => toggleStatus(user.id)}
                      className="p-2 rounded hover:bg-muted transition"
                      title={user.isActive ? "Deactivate" : "Activate"}
                    >
                      {user.isActive ? "Deactivate" : "Activate"}
                    </button>

                    {deleteConfirmId === user.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDelete(user.id)}
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
                <span className="text-muted-foreground">Status:</span>
                <span
                  className={
                    viewedUser.isActive ? "text-green-500" : "text-red-500"
                  }
                >
                  {" "}
                  {viewedUser.isActive ? "Active" : "Inactive"}
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
    </AppLayout>
  );
};

export default Users;

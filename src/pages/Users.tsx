import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Search, Edit, Trash2, Eye, EyeOff } from "lucide-react";
// FIX: Was a completely isolated local-state user list disconnected from AuthContext.
//      Now properly wired to the shared AuthContext so changes persist app-wide.
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const Users = () => {
  const { allUsers, addUser, deleteUser, toggleUserStatus } = useAuth();

  // Local form state for adding a new user
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    alias: "",
    // FIX: Password is only used during creation and never stored in display state
    password: "",
  });
  const [showPass, setShowPass] = useState(false);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [viewUser, setViewUser] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error("Name, email and password are required.");
      return;
    }
    addUser({
      name: form.name.trim(),
      email: form.email.trim(),
      initials: form.name.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
      role: "user",
      pagePermissions: [],
      isActive: true,
      password: form.password,
    });
    toast.success(`User "${form.name}" added.`);
    setForm({ name: "", email: "", phone: "", alias: "", password: "" });
  };

  const handleDelete = (userId: string) => {
    deleteUser(userId);
    setDeleteConfirmId(null);
    toast.success("User removed.");
  };

  const filteredUsers = allUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(filter.toLowerCase()) ||
      u.email.toLowerCase().includes(filter.toLowerCase())
  );

  const viewedUser = viewUser ? allUsers.find(u => u.id === viewUser) : null;

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Admin", "Users"]} />

      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        User Master
      </h1>

      {/* FORM */}
      <div className="glass rounded-xl p-5 mb-8">
        <h2 className="font-heading font-semibold text-foreground mb-4">Add New User</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Full Name *</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="e.g. Ramesh Sharma"
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Alias</label>
              <input
                name="alias"
                value={form.alias}
                onChange={handleChange}
                placeholder="Short name / display name"
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email *</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
                placeholder="name@company.com"
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="10-digit mobile number"
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            {/* FIX: Password field with show/hide toggle, not shown anywhere after submission */}
            <div className="relative">
              <label className="text-xs text-muted-foreground mb-1 block">Password *</label>
              <input
                name="password"
                type={showPass ? "text" : "password"}
                value={form.password}
                onChange={handleChange}
                required
                placeholder="Temporary password"
                className="w-full h-10 px-3 pr-10 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPass(p => !p)}
                className="absolute right-3 top-7 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-6 h-10 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition text-sm font-medium"
            >
              Add User
            </button>
          </div>
        </form>
      </div>

      {/* SEARCH */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => setShowFilter(!showFilter)}
          className="p-2 bg-secondary text-secondary-foreground rounded-md"
        >
          <Search size={16} />
        </button>

        {showFilter && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name or email..."
            className="px-3 h-10 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary outline-none"
          />
        )}
      </div>

      {/* TABLE */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left">Name</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">Pages</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">
                  {filter ? "No users match your search." : "No users added yet."}
                </td>
              </tr>
            ) : filteredUsers.map((u) => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-3 font-medium">{u.name}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.pagePermissions.length} pages</td>
                <td className="px-5 py-3">
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      u.isActive
                        ? "bg-primary/20 text-primary"
                        : "bg-destructive/20 text-destructive"
                    }`}
                  >
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-2 items-center">
                    <button
                      onClick={() => setViewUser(u.id)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="View"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      onClick={() => toggleUserStatus(u.id)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title={u.isActive ? "Deactivate" : "Activate"}
                    >
                      <Edit size={15} />
                    </button>
                    {deleteConfirmId === u.id ? (
                      <>
                        <button onClick={() => handleDelete(u.id)} className="text-xs text-destructive hover:underline px-1">Confirm</button>
                        <button onClick={() => setDeleteConfirmId(null)} className="text-xs text-muted-foreground hover:underline px-1">Cancel</button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(u.id)}
                        className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* VIEW MODAL */}
      {viewedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setViewUser(null)}>
          <div className="glass p-6 rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="mb-4 font-semibold text-foreground text-lg">User Details</h2>
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Name:</span> <span className="text-foreground font-medium">{viewedUser.name}</span></p>
              <p><span className="text-muted-foreground">Email:</span> <span className="text-foreground">{viewedUser.email}</span></p>
              <p><span className="text-muted-foreground">Role:</span> <span className="text-foreground capitalize">{viewedUser.role}</span></p>
              <p><span className="text-muted-foreground">Status:</span> <span className={viewedUser.isActive ? "text-primary" : "text-destructive"}>{viewedUser.isActive ? "Active" : "Inactive"}</span></p>
              <p><span className="text-muted-foreground">Pages:</span> <span className="text-foreground">{viewedUser.pagePermissions.length} pages assigned</span></p>
            </div>
            <button
              onClick={() => setViewUser(null)}
              className="mt-5 w-full h-10 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition"
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

import React, { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Search, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const Users = () => {
  const { allUsers, addUser, deleteUser } = useAuth();

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    alias: "",
    password: "",
    discontinue: false,
  });

  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [viewUser, setViewUser] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (editUserId) {
      const user = allUsers.find(u => u.id === editUserId);
      if (user) {
        setForm({
          name: user.name,
          email: user.email,
          phone: user.phone || "",
          alias: user.alias || "",
          password: "",
          discontinue: !user.isActive,
        });
      }
    } else {
      resetForm();
    }
  }, [editUserId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim() || !form.email.trim() || (!editUserId && !form.password.trim())) {
      toast.error("Name, email and password are required.");
      return;
    }

    if (editUserId) {
      const user = allUsers.find(u => u.id === editUserId);
      if (!user) return;

      user.name = form.name.trim();
      user.email = form.email.trim();
      user.alias = form.alias.trim();
      user.phone = form.phone.trim();
      user.isActive = !form.discontinue;
      toast.success(`User "${form.name}" updated.`);
      setEditUserId(null);
      resetForm();
    } else {
      addUser({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        alias: form.alias.trim(),
        initials: form.name
          .trim()
          .split(" ")
          .map(w => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        role: "user",
        pagePermissions: [],
        isActive: !form.discontinue,
        password: form.password,
      });
      toast.success(`User "${form.name}" added.`);
      resetForm();
    }
  };

  const resetForm = () => {
    setForm({ name: "", email: "", phone: "", alias: "", password: "", discontinue: false });
    setEditUserId(null);
  };

  const handleEdit = (userId: string) => setEditUserId(userId);
  const handleDelete = (userId: string) => {
    deleteUser(userId);
    setDeleteConfirmId(null);
    toast.success("User removed.");
  };

  const filteredUsers = allUsers.filter(
    u => u.name.toLowerCase().includes(filter.toLowerCase()) || u.email.toLowerCase().includes(filter.toLowerCase())
  );

  const viewedUser = viewUser ? allUsers.find(u => u.id === viewUser) : null;

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Admin", "Users"]} />

      <h1 className="text-xl font-heading font-bold text-foreground mb-4">User Master</h1>

      {/* FORM */}
      <div className="glass rounded-xl p-5 mb-8">
        <h2 className="font-heading font-semibold text-foreground mb-4">{editUserId ? "Edit User" : "Add New User"}</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Full Name *</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Alias</label>
              <input
                name="alias"
                value={form.alias}
                onChange={handleChange}
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
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            {!editUserId && (
              <div className="relative">
                <label className="text-xs text-muted-foreground mb-1 block">Password *</label>
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
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-7 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            )}

            {/* Discontinue checkbox */}
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  name="discontinue"
                  checked={form.discontinue}
                  onChange={handleChange}
                  className="h-4 w-4"
                />
                Mark as Inactive
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {editUserId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 h-10 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition text-sm font-medium"
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

      {/* SEARCH & TABLE */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setShowFilter(!showFilter)} className="p-2 bg-secondary text-secondary-foreground rounded-md">
          <Search size={16} />
        </button>
        {showFilter && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 h-10 bg-input/70 border border-border rounded-md focus:ring-1 focus:ring-primary outline-none"
          />
        )}
      </div>

      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left">Name</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground text-sm">
                  {filter ? "No users match your search." : "No users added yet."}
                </td>
              </tr>
            ) : filteredUsers.map(u => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-3 font-medium">{u.name}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${u.isActive ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"}`}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-5 py-3 flex justify-end gap-2">
                  <button onClick={() => setViewUser(u.id)} className="p-1.5 rounded hover:bg-muted" title="View"><Eye size={15} /></button>
                  <button onClick={() => handleEdit(u.id)} className="p-1.5 rounded hover:bg-muted" title="Edit"><Edit size={15} /></button>
                  {deleteConfirmId === u.id ? (
                    <>
                      <button onClick={() => handleDelete(u.id)} className="text-xs text-destructive hover:underline px-1">Confirm</button>
                      <button onClick={() => setDeleteConfirmId(null)} className="text-xs text-muted-foreground hover:underline px-1">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setDeleteConfirmId(u.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="Delete"><Trash2 size={15} /></button>
                  )}
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
              <p><span className="text-muted-foreground">Name:</span> {viewedUser.name}</p>
              <p><span className="text-muted-foreground">Email:</span> {viewedUser.email}</p>
              <p><span className="text-muted-foreground">Role:</span> {viewedUser.role}</p>
              <p><span className="text-muted-foreground">Status:</span> {viewedUser.isActive ? "Active" : "Inactive"}</p>
            </div>
            <button onClick={() => setViewUser(null)} className="mt-5 w-full h-10 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition">Close</button>
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default Users;
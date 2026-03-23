import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Search, Edit, Trash2, Eye } from "lucide-react";

interface User {
  name: string;
  email: string;
  phone: string;
  password: string;
  alias: string;
  discontinue: boolean;
}

const Users = () => {
  const [form, setForm] = useState<User>({
    name: "",
    email: "",
    phone: "",
    password: "",
    alias: "",
    discontinue: false,
  });

  const [users, setUsers] = useState<User[]>([]);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (editIndex !== null) {
      const updated = [...users];
      updated[editIndex] = form;
      setUsers(updated);
      setEditIndex(null);
    } else {
      setUsers([...users, form]);
    }

    resetForm();
  };

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      phone: "",
      password: "",
      alias: "",
      discontinue: false,
    });
    setEditIndex(null);
  };

  const handleEdit = (index: number) => {
    setForm(users[index]);
    setEditIndex(index);
  };

  const handleDelete = (index: number) => {
    setUsers(users.filter((_, i) => i !== index));
  };

  const handleView = (index: number) => setViewIndex(index);
  const closeView = () => setViewIndex(null);

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(filter.toLowerCase()) ||
      u.alias.toLowerCase().includes(filter.toLowerCase()) ||
      u.email.toLowerCase().includes(filter.toLowerCase()) ||
      u.phone.includes(filter),
  );

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Admin", "Users"]} />

      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        User Master
      </h1>

      {/* FORM */}
      <div className="glass rounded-xl p-5 mb-8">
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
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md
                focus:ring-1 focus:ring-primary focus:border-primary outline-none"
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
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md
                focus:ring-1 focus:ring-primary focus:border-primary outline-none"
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
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md
                focus:ring-1 focus:ring-primary focus:border-primary outline-none"
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
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md
                focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Password *
              </label>
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                required
                className="w-full h-10 px-3 bg-input/70 border border-border rounded-md
                focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              />
            </div>

            {/* Checkbox aligned properly */}
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

          {/* Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-6 h-10 bg-primary text-primary-foreground rounded-md
              hover:opacity-90 transition text-sm font-medium"
            >
              {editIndex !== null ? "Update User" : "Add User"}
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
            placeholder="Search users..."
            className="px-3 h-10 bg-input/70 border border-border rounded-md
            focus:ring-1 focus:ring-primary outline-none"
          />
        )}
      </div>

      {/* TABLE */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left">Name</th>
              <th className="px-5 py-3 text-left">Alias</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">Phone</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredUsers.map((u, i) => (
              <tr key={i} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-3">{u.name}</td>
                <td className="px-5 py-3">{u.alias}</td>
                <td className="px-5 py-3">{u.email}</td>
                <td className="px-5 py-3">{u.phone}</td>
                <td className="px-5 py-3">
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      u.discontinue
                        ? "bg-destructive/20 text-destructive"
                        : "bg-primary/20 text-primary"
                    }`}
                  >
                    {u.discontinue ? "Inactive" : "Active"}
                  </span>
                </td>
                <td className="px-5 py-3 flex justify-end gap-2">
                  <Eye
                    size={16}
                    onClick={() => handleView(i)}
                    className="cursor-pointer"
                  />
                  <Edit
                    size={16}
                    onClick={() => handleEdit(i)}
                    className="cursor-pointer"
                  />
                  <Trash2
                    size={16}
                    onClick={() => handleDelete(i)}
                    className="cursor-pointer"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL */}
      {viewIndex !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
          <div className="glass p-6 rounded-xl w-full max-w-md">
            <h2 className="mb-4 font-semibold">User Details</h2>
            <p>Name: {users[viewIndex].name}</p>
            <p>Email: {users[viewIndex].email}</p>
            <p>Phone: {users[viewIndex].phone}</p>

            <button
              onClick={closeView}
              className="mt-4 w-full h-10 bg-primary text-primary-foreground rounded-md"
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

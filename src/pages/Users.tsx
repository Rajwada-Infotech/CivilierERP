import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
  const [filter, setFilter] = useState<string>("");
  const [showFilter, setShowFilter] = useState<boolean>(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm({
      ...form,
      [name]: type === "checkbox" ? checked : value,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editIndex !== null) {
      const updatedUsers = [...users];
      updatedUsers[editIndex] = form;
      setUsers(updatedUsers);
      setEditIndex(null);
    } else {
      setUsers([...users, form]);
    }
    setForm({
      name: "",
      email: "",
      phone: "",
      password: "",
      alias: "",
      discontinue: false,
    });
  };

  const handleEdit = (index: number) => {
    setForm(users[index]);
    setEditIndex(index);
  };

  const handleDelete = (index: number) => {
    const filteredUsers = users.filter((_, i) => i !== index);
    setUsers(filteredUsers);
    if (editIndex === index) setEditIndex(null);
    if (viewIndex === index) setViewIndex(null);
  };

  const handleView = (index: number) => setViewIndex(index);
  const closeView = () => setViewIndex(null);

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(filter.toLowerCase()) ||
      u.alias.toLowerCase().includes(filter.toLowerCase()) ||
      u.email.toLowerCase().includes(filter.toLowerCase()) ||
      u.phone.includes(filter)
  );

  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <span key={i} className="bg-yellow-200 px-1 rounded">{part}</span>
          ) : (
            part
          )
        )}
      </>
    );
  };

  const cardVariants = {
    hidden: { opacity: 0, x: -50 },
    visible: (i: number) => ({
      opacity: 1,
      x: 0,
      transition: { delay: i * 0.1 },
    }),
    exit: { opacity: 0, x: 50, transition: { duration: 0.2 } },
  };

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Users"]} />
      <h1 className="text-2xl font-heading font-bold text-foreground mb-6">
        User Management
      </h1>

      {/* Form */}
      <motion.form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-card p-6 rounded-xl border border-border shadow-md"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          placeholder="Name"
          className="w-full p-3 border rounded-lg text-black focus:ring-2 focus:ring-blue-400 transition"
          required
        />
        <input
          name="alias"
          value={form.alias}
          onChange={handleChange}
          placeholder="Alias"
          className="w-full p-3 border rounded-lg text-black focus:ring-2 focus:ring-blue-400 transition"
        />
        <input
          name="email"
          value={form.email}
          onChange={handleChange}
          placeholder="Email"
          type="email"
          className="w-full p-3 border rounded-lg text-black focus:ring-2 focus:ring-blue-400 transition"
          required
        />
        <input
          name="phone"
          value={form.phone}
          onChange={handleChange}
          placeholder="Phone"
          className="w-full p-3 border rounded-lg text-black focus:ring-2 focus:ring-blue-400 transition"
        />
        <input
          name="password"
          value={form.password}
          onChange={handleChange}
          placeholder="Password"
          type="password"
          className="w-full p-3 border rounded-lg text-black focus:ring-2 focus:ring-blue-400 transition"
          required
        />
        <label className="flex items-center gap-2 col-span-1 md:col-span-2 cursor-pointer w-full">
          <input
            type="checkbox"
            name="discontinue"
            checked={form.discontinue}
            onChange={handleChange}
            className="accent-red-500"
          />
          Discontinue User
        </label>
        <button
          type="submit"
          className="col-span-1 md:col-span-2 w-full bg-primary hover:bg-primary/80 text-white py-3 rounded-lg transition shadow"
        >
          {editIndex !== null ? "Update User" : "Add User"}
        </button>
      </motion.form>

      {/* Filter: Magnifying Glass Toggle */}
      <div className="mt-6 mb-4 flex items-center gap-2">
        <button
          onClick={() => setShowFilter(!showFilter)}
          className="p-2 border rounded text-white bg-blue-600 flex items-center justify-center hover:bg-blue-500 transition"
          title="Filter Users"
        >
          <Search size={18} />
        </button>

        <AnimatePresence>
          {showFilter && (
            <motion.input
              type="text"
              placeholder="Search by name, alias, email, phone"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="p-3 border rounded-lg text-black w-full sm:w-80 focus:ring-2 focus:ring-blue-400 transition"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              autoFocus
            />
          )}
        </AnimatePresence>
      </div>

      {/* Users Table (Desktop) */}
      <div className="hidden md:block bg-card border rounded-xl p-4 mt-2 shadow overflow-x-auto">
        <h2 className="mb-3 font-medium">User List</h2>
        <table className="w-full text-sm border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Name</th>
              <th className="p-2">Alias</th>
              <th className="p-2">Email</th>
              <th className="p-2">Phone</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center p-4 text-muted-foreground">
                  No users found
                </td>
              </tr>
            )}
            <AnimatePresence>
              {filteredUsers.map((u, i) => (
                <motion.tr
                  key={i}
                  className="border-b rounded transition cursor-pointer hover:bg-gray-800 hover:text-white"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  layout
                >
                  <td className="p-2">{highlightText(u.name, filter)}</td>
                  <td className="p-2">{highlightText(u.alias, filter)}</td>
                  <td className="p-2">{highlightText(u.email, filter)}</td>
                  <td className="p-2">{highlightText(u.phone, filter)}</td>
                  <td className="p-2">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        u.discontinue ? "bg-red-200 text-red-800" : "bg-green-200 text-green-800"
                      }`}
                    >
                      {u.discontinue ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td className="p-2 flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleView(i)}
                      className="bg-blue-500 hover:bg-blue-400 text-white px-2 py-1 rounded text-xs flex-1 sm:flex-none"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleEdit(i)}
                      className="bg-yellow-400 hover:bg-yellow-300 text-white px-2 py-1 rounded text-xs flex-1 sm:flex-none"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(i)}
                      className="bg-red-500 hover:bg-red-400 text-white px-2 py-1 rounded text-xs flex-1 sm:flex-none"
                    >
                      Delete
                    </button>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden grid grid-cols-1 gap-4 mt-2">
        {filteredUsers.length === 0 && (
          <p className="text-center p-4 text-muted-foreground">No users found</p>
        )}
        <AnimatePresence>
          {filteredUsers.map((u, i) => (
            <motion.div
              key={i}
              className="bg-card p-4 rounded-xl shadow flex flex-col gap-2 hover:bg-gray-700 hover:text-white transition"
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              layout
            >
              <p><strong>Name:</strong> {highlightText(u.name, filter)}</p>
              <p><strong>Alias:</strong> {highlightText(u.alias, filter)}</p>
              <p><strong>Email:</strong> {highlightText(u.email, filter)}</p>
              <p><strong>Phone:</strong> {highlightText(u.phone, filter)}</p>
              <p>
                <strong>Status:</strong>{" "}
                <span
                  className={`px-2 py-1 rounded text-xs font-semibold ${
                    u.discontinue ? "bg-red-200 text-red-800" : "bg-green-200 text-green-800"
                  }`}
                >
                  {u.discontinue ? "Inactive" : "Active"}
                </span>
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={() => handleView(i)}
                  className="bg-blue-500 hover:bg-blue-400 text-white px-2 py-1 rounded text-xs flex-1"
                >
                  View
                </button>
                <button
                  onClick={() => handleEdit(i)}
                  className="bg-yellow-400 hover:bg-yellow-300 text-white px-2 py-1 rounded text-xs flex-1"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(i)}
                  className="bg-red-500 hover:bg-red-400 text-white px-2 py-1 rounded text-xs flex-1"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* View Modal */}
      <AnimatePresence>
        {viewIndex !== null && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-card p-6 rounded-xl w-full max-w-md shadow-lg"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
            >
              <h2 className="text-lg font-semibold mb-4">User Details</h2>
              <p><strong>Name:</strong> {users[viewIndex].name}</p>
              <p><strong>Alias:</strong> {users[viewIndex].alias}</p>
              <p><strong>Email:</strong> {users[viewIndex].email}</p>
              <p><strong>Phone:</strong> {users[viewIndex].phone}</p>
              <p><strong>Password:</strong> {users[viewIndex].password}</p>
              <p><strong>Status:</strong> {users[viewIndex].discontinue ? "Inactive" : "Active"}</p>
              <button
                onClick={closeView}
                className="mt-4 bg-primary hover:bg-primary/80 text-white px-4 py-2 rounded w-full transition"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppLayout>
  );
};

export default Users;
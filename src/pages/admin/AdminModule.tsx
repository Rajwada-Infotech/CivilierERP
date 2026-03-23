import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  useAuth, PAGE_DEFINITIONS, PagePermission, PageAction, PageKey, AppUser,
} from "@/contexts/AuthContext";
import {
  Shield, Users, UserCheck, UserX, Trash2, Plus, Check, X,
  Crown, Lock, Unlock, Eye, EyeOff, ShieldCheck, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<PageAction, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete",
};

const ACTION_COLORS: Record<PageAction, string> = {
  view:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
  create: "bg-green-500/15 text-green-400 border-green-500/30",
  edit:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  delete: "bg-red-500/15 text-red-400 border-red-500/30",
};

const ACTION_COLORS_ON: Record<PageAction, string> = {
  view:   "bg-blue-500 text-white border-blue-500",
  create: "bg-green-500 text-white border-green-500",
  edit:   "bg-yellow-500 text-white border-yellow-500",
  delete: "bg-red-500 text-white border-red-500",
};

// Group pages by their group label
const GROUPED_PAGES = PAGE_DEFINITIONS.reduce((acc, p) => {
  if (!acc[p.group]) acc[p.group] = [];
  acc[p.group].push(p);
  return acc;
}, {} as Record<string, typeof PAGE_DEFINITIONS>);

// ─── Page Access Editor ───────────────────────────────────────────────────────
const PageAccessEditor = ({
  pagePermissions,
  onChange,
}: {
  pagePermissions: PagePermission[];
  onChange: (pp: PagePermission[]) => void;
}) => {
  const getActions = (page: PageKey): PageAction[] =>
    pagePermissions.find(p => p.page === page)?.actions ?? [];

  const toggleAction = (page: PageKey, action: PageAction, availableActions: PageAction[]) => {
    const current = getActions(page);
    let next: PageAction[];

    if (action === "view") {
      // toggling view off removes all actions for the page
      const hasView = current.includes("view");
      if (hasView) {
        // remove entire page
        onChange(pagePermissions.filter(p => p.page !== page));
      } else {
        // add view
        onChange([...pagePermissions.filter(p => p.page !== page), { page, actions: ["view"] }]);
      }
      return;
    }

    // For non-view actions: must have view first
    if (!current.includes("view")) return;

    next = current.includes(action)
      ? current.filter(a => a !== action)
      : [...current, action];

    onChange([...pagePermissions.filter(p => p.page !== page), { page, actions: next }]);
  };

  const toggleAllPage = (page: PageKey, availableActions: PageAction[]) => {
    const current = getActions(page);
    const hasAll = availableActions.every(a => current.includes(a));
    if (hasAll) {
      onChange(pagePermissions.filter(p => p.page !== page));
    } else {
      onChange([...pagePermissions.filter(p => p.page !== page), { page, actions: [...availableActions] }]);
    }
  };

  return (
    <div className="space-y-4">
      {Object.entries(GROUPED_PAGES).map(([group, pages]) => (
        <div key={group}>
          <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground mb-2">{group}</p>
          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
            {pages.map(({ key, label, availableActions }) => {
              const currentActions = getActions(key);
              const hasView = currentActions.includes("view");
              const hasAll = availableActions.every(a => currentActions.includes(a));

              return (
                <div key={key} className={`flex items-center gap-3 px-4 py-3 transition-colors ${hasView ? "bg-card" : "bg-muted/30"}`}>
                  {/* Page name + master toggle */}
                  <div className="flex items-center gap-2 w-28 sm:w-40 shrink-0">
                    <button
                      onClick={() => toggleAllPage(key, availableActions)}
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${hasAll ? "bg-primary border-primary" : hasView ? "bg-primary/30 border-primary/50" : "border-border bg-muted"}`}
                      title={hasAll ? "Remove all access" : "Grant all access"}
                    >
                      {hasAll && <Check size={10} className="text-primary-foreground" />}
                      {hasView && !hasAll && <div className="w-2 h-0.5 bg-primary rounded" />}
                    </button>
                    <span className={`text-sm font-heading ${hasView ? "text-foreground" : "text-muted-foreground"}`}>
                      {label}
                    </span>
                  </div>

                  {/* Action pills */}
                  <div className="flex items-center gap-1.5 flex-wrap flex-1">
                    {availableActions.map(action => {
                      const on = currentActions.includes(action);
                      const disabled = action !== "view" && !hasView;
                      return (
                        <button
                          key={action}
                          onClick={() => !disabled && toggleAction(key, action, availableActions)}
                          disabled={disabled}
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-heading border transition-all ${
                            disabled
                              ? "opacity-25 cursor-not-allowed border-border text-muted-foreground bg-transparent"
                              : on
                              ? ACTION_COLORS_ON[action]
                              : ACTION_COLORS[action] + " hover:opacity-80"
                          }`}
                        >
                          {ACTION_LABELS[action]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Status / Role Badges ─────────────────────────────────────────────────────
const StatusBadge = ({ active }: { active: boolean }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${active ? "bg-green-500/15 text-green-500" : "bg-destructive/15 text-destructive"}`}>
    {active ? "Active" : "Inactive"}
  </span>
);

// ─── Add Admin Form ───────────────────────────────────────────────────────────
const AddAdminForm = ({ onClose }: { onClose: () => void }) => {
  const { addAdmin } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", initials: "" });
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) { toast.error("Fill all required fields."); return; }
    addAdmin({
      name: form.name, email: form.email, password: form.password,
      initials: form.initials || form.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2),
      role: "admin",
      pagePermissions: PAGE_DEFINITIONS.map(p => ({ page: p.key, actions: [...p.availableActions] })),
      isActive: true,
    });
    toast.success(`Admin "${form.name}" created.`);
    onClose();
  };

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="rounded-xl bg-card border border-border p-5 mb-4">
      <h3 className="font-heading font-semibold text-foreground mb-4 flex items-center gap-2"><Plus size={15} className="text-primary" /> New Admin Account</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {[{ k: "name", l: "Full Name *", ph: "John Smith" }, { k: "email", l: "Email *", ph: "john@co.com" }, { k: "initials", l: "Initials (auto)", ph: "JS" }].map(f => (
            <div key={f.k}>
              <label className="block text-xs font-heading text-muted-foreground mb-1">{f.l}</label>
              <input type={f.k === "email" ? "email" : "text"} value={form[f.k as keyof typeof form]}
                onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))} placeholder={f.ph}
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          ))}
          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-1">Password *</label>
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Set password"
                className="w-full px-3 py-2 pr-9 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-primary-foreground hover:-translate-y-0.5 transition-all">Create Admin</button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted transition-all">Cancel</button>
        </div>
      </form>
    </motion.div>
  );
};

// ─── Add User Form ────────────────────────────────────────────────────────────
const AddUserForm = ({ onClose }: { onClose: () => void }) => {
  const { addUser } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", initials: "" });
  const [pagePermissions, setPagePermissions] = useState<PagePermission[]>([{ page: "dashboard", actions: ["view"] }]);
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) { toast.error("Fill all required fields."); return; }
    addUser({
      name: form.name, email: form.email, password: form.password,
      initials: form.initials || form.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2),
      role: "user", pagePermissions, isActive: true,
    });
    toast.success(`User "${form.name}" created.`);
    onClose();
  };

  return (
    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="rounded-xl bg-card border border-border p-5 mb-4">
      <h3 className="font-heading font-semibold text-foreground mb-4 flex items-center gap-2"><Plus size={15} className="text-primary" /> New User Account</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {[{ k: "name", l: "Full Name *", ph: "Amit Shah" }, { k: "email", l: "Email *", ph: "amit@co.com" }, { k: "initials", l: "Initials (auto)", ph: "AS" }].map(f => (
            <div key={f.k}>
              <label className="block text-xs font-heading text-muted-foreground mb-1">{f.l}</label>
              <input type={f.k === "email" ? "email" : "text"} value={form[f.k as keyof typeof form]}
                onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))} placeholder={f.ph}
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          ))}
          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-1">Password *</label>
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Set password"
                className="w-full px-3 py-2 pr-9 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="mb-5">
          <label className="block text-xs font-heading text-muted-foreground mb-3">Page Access & Actions</label>
          <PageAccessEditor pagePermissions={pagePermissions} onChange={setPagePermissions} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-primary-foreground hover:-translate-y-0.5 transition-all">Create User</button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted transition-all">Cancel</button>
        </div>
      </form>
    </motion.div>
  );
};

// ─── User Row ─────────────────────────────────────────────────────────────────
const UserRow = ({ user }: { user: AppUser }) => {
  const { updateUserPagePermissions, toggleUserStatus, deleteUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [localPerms, setLocalPerms] = useState<PagePermission[]>(user.pagePermissions);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);

  const handleChange = (pp: PagePermission[]) => { setLocalPerms(pp); setDirty(true); };
  const handleSave = () => { updateUserPagePermissions(user.id, localPerms); setDirty(false); toast.success(`Access updated for ${user.name}`); };
  const handleDiscard = () => { setLocalPerms(user.pagePermissions); setDirty(false); };
  const handleToggle = () => { toggleUserStatus(user.id); toast.success(`${user.name} ${user.isActive ? "deactivated" : "activated"}.`); };
  const handleDelete = () => { deleteUser(user.id); toast.success(`${user.name} removed.`); };

  const pageCount = user.pagePermissions.filter(p => p.actions.includes("view")).length;

  return (
    <div className={`border border-border rounded-xl overflow-hidden transition-all ${!user.isActive ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3 bg-card">
        <div className="w-9 h-9 rounded-full gradient-accent flex items-center justify-center text-xs font-heading font-bold text-primary-foreground shrink-0">
          {user.initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-heading font-semibold text-foreground truncate">{user.name}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <StatusBadge active={user.isActive} />
          <span className="text-xs text-muted-foreground font-heading">{pageCount} page{pageCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={handleToggle} title={user.isActive ? "Deactivate" : "Activate"}
            className={`p-1.5 rounded-lg transition-colors ${user.isActive ? "text-yellow-500 hover:bg-yellow-500/10" : "text-green-500 hover:bg-green-500/10"}`}>
            {user.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
          </button>
          {deleteConfirm ? (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Check size={14} /></button>
              <button onClick={() => setDeleteConfirm(false)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => setDeleteConfirm(true)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={15} /></button>
          )}
          <button onClick={() => setExpanded(p => !p)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 py-4 border-t border-border bg-muted/20">
              <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground mb-4">Page Access & Actions</p>
              <PageAccessEditor pagePermissions={localPerms} onChange={handleChange} />
              {dirty && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex gap-2">
                  <button onClick={handleSave} className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-primary-foreground hover:-translate-y-0.5 transition-all">Save Changes</button>
                  <button onClick={handleDiscard} className="px-4 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-all">Discard</button>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Admin Row ────────────────────────────────────────────────────────────────
const AdminRow = ({ admin }: { admin: AppUser }) => {
  const { deleteAdmin, toggleAdminStatus } = useAuth();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card ${!admin.isActive ? "opacity-60" : ""}`}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-heading font-bold text-white shrink-0" style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>
        {admin.initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-heading font-semibold text-foreground truncate">{admin.name}</p>
        <p className="text-xs text-muted-foreground truncate">{admin.email}</p>
      </div>
      <div className="hidden sm:flex items-center gap-2">
        <span className="px-2 py-0.5 rounded-full text-xs font-heading font-semibold" style={{ background: "rgba(37,99,235,0.12)", color: "#2563eb" }}>Admin</span>
        <StatusBadge active={admin.isActive} />
      </div>
      <div className="flex items-center gap-1 ml-2">
        <button onClick={() => { toggleAdminStatus(admin.id); toast.success(`${admin.name} ${admin.isActive ? "deactivated" : "activated"}.`); }}
          className={`p-1.5 rounded-lg transition-colors ${admin.isActive ? "text-yellow-500 hover:bg-yellow-500/10" : "text-green-500 hover:bg-green-500/10"}`}>
          {admin.isActive ? <Lock size={15} /> : <Unlock size={15} />}
        </button>
        {deleteConfirm ? (
          <div className="flex items-center gap-1">
            <button onClick={() => { deleteAdmin(admin.id); toast.success(`Admin "${admin.name}" removed.`); }} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Check size={14} /></button>
            <button onClick={() => setDeleteConfirm(false)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => setDeleteConfirm(true)} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={15} /></button>
        )}
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminModule() {
  const { currentUser, allUsers, allAdmins } = useAuth();
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin = currentUser?.role === "admin" || isSuperAdmin;

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Shield size={48} className="text-muted-foreground mb-4" />
          <h1 className="text-xl font-heading font-bold text-foreground mb-2">Access Denied</h1>
          <p className="text-muted-foreground text-sm">You don't have permission to view this module.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Admin Module"]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <ShieldCheck size={22} className="text-primary" /> Admin Module
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isSuperAdmin ? "Manage admins and control user access" : "Control user page access and actions"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-semibold"
          style={isSuperAdmin ? { background: "rgba(124,58,237,0.12)", color: "#7c3aed" } : { background: "rgba(37,99,235,0.12)", color: "#2563eb" }}>
          {isSuperAdmin ? <><Crown size={13} /> Super Admin</> : <><Shield size={13} /> Admin</>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Users",    value: allUsers.length,                          color: "hsl(var(--primary))" },
          { label: "Active Users",   value: allUsers.filter(u => u.isActive).length,  color: "hsl(142,71%,45%)" },
          { label: "Inactive Users", value: allUsers.filter(u => !u.isActive).length, color: "hsl(0,72%,51%)" },
          ...(isSuperAdmin ? [{ label: "Admins", value: allAdmins.length, color: "#2563eb" }] : []),
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-card border border-border p-4" style={{ borderLeftWidth: 3, borderLeftColor: s.color }}>
            <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
            <p className="text-2xl font-heading font-bold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Admin management (Super Admin only) */}
      {isSuperAdmin && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold text-foreground flex items-center gap-2"><Shield size={16} className="text-blue-500" /> Admin Accounts</h2>
            <button onClick={() => { setShowAddAdmin(p => !p); setShowAddUser(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold border border-blue-500/40 text-blue-500 hover:bg-blue-500/10 transition-all">
              <Plus size={13} /> Add Admin
            </button>
          </div>
          <AnimatePresence>{showAddAdmin && <AddAdminForm onClose={() => setShowAddAdmin(false)} />}</AnimatePresence>
          <div className="space-y-2">
            {allAdmins.length === 0
              ? <div className="py-8 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border">No admin accounts yet.</div>
              : allAdmins.map(a => <AdminRow key={a.id} admin={a} />)}
          </div>
        </div>
      )}

      {/* User Access Control */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-semibold text-foreground flex items-center gap-2"><Users size={16} className="text-primary" /> User Access Control</h2>
          <button onClick={() => { setShowAddUser(p => !p); setShowAddAdmin(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-primary-foreground hover:-translate-y-0.5 transition-all">
            <Plus size={13} /> Add User
          </button>
        </div>
        <AnimatePresence>{showAddUser && <AddUserForm onClose={() => setShowAddUser(false)} />}</AnimatePresence>

        {/* Legend */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-xs text-muted-foreground font-heading">Actions:</span>
          {(Object.entries(ACTION_LABELS) as [PageAction, string][]).map(([action, label]) => (
            <span key={action} className={`px-2 py-0.5 rounded-full text-[11px] font-heading border ${ACTION_COLORS_ON[action]}`}>{label}</span>
          ))}
        </div>

        <div className="space-y-2">
          {allUsers.length === 0
            ? <div className="py-8 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border">No users yet.</div>
            : allUsers.map(u => <UserRow key={u.id} user={u} />)}
        </div>
        <p className="mt-4 text-xs text-muted-foreground text-center">Expand a user row to control which pages they can access and what actions they can perform.</p>
      </div>
    </AppLayout>
  );
}

import React, { useState } from "react";
import { useTask, TaskPriority, QualityCriteria } from "@/contexts/TaskContext";
import { useAuth } from "@/contexts/AuthContext";
import { X, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

export default function TaskFormModal({ onClose, editTask }: { onClose: () => void; editTask?: any }) {
  const { addTask, updateTask } = useTask();
  const { currentUser, allUsers } = useAuth();

  const [form, setForm] = useState({
    title: editTask?.title || "",
    description: editTask?.description || "",
    priority: (editTask?.priority || "medium") as TaskPriority,
    assignedTo: editTask?.assignedTo || "",
    assignedToName: editTask?.assignedToName || "",
    dueDate: editTask?.dueDate || "",
    status: editTask?.status || "open",
  });
  const [criteria, setCriteria] = useState<QualityCriteria[]>(editTask?.qualityCriteria || []);
  const [newCriteria, setNewCriteria] = useState("");

  const handleAssign = (userId: string) => {
    const user = allUsers.find(u => u.id === userId);
    setForm(p => ({ ...p, assignedTo: userId, assignedToName: user?.name || "" }));
  };

  const addCriteria = () => {
    if (!newCriteria.trim()) return;
    setCriteria(prev => [...prev, { id: `qc-${Date.now()}`, label: newCriteria.trim(), met: false }]);
    setNewCriteria("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.assignedTo || !form.dueDate) return;
    if (editTask) {
      updateTask(editTask.id, { ...form, qualityCriteria: criteria });
    } else {
      addTask({ ...form, createdBy: currentUser!.id, createdByName: currentUser!.name, qualityCriteria: criteria, status: "open" });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-heading font-semibold text-foreground">{editTask ? "Edit Task" : "New Task"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-1">Task Title *</label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required
              placeholder="e.g. Review supplier invoices"
              className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3} placeholder="Describe what needs to be done..."
              className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-heading text-muted-foreground mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value as TaskPriority }))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-heading text-muted-foreground mb-1">Due Date *</label>
              <input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} required
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-1">Assign To *</label>
            <select value={form.assignedTo} onChange={e => handleAssign(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select user...</option>
              {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-heading text-muted-foreground mb-2">Quality Criteria</label>
            <div className="space-y-2 mb-2">
              {criteria.map(c => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border">
                  <span className="text-sm text-foreground flex-1">{c.label}</span>
                  <button type="button" onClick={() => setCriteria(prev => prev.filter(x => x.id !== c.id))}
                    className="text-destructive hover:bg-destructive/10 p-0.5 rounded transition-colors shrink-0"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newCriteria} onChange={e => setNewCriteria(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCriteria())}
                placeholder="Add quality criterion..."
                className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              <button type="button" onClick={addCriteria}
                className="px-3 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted transition-colors shrink-0">
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit"
              className="flex-1 py-2.5 rounded-lg text-sm font-heading font-semibold gradient-accent text-primary-foreground hover:-translate-y-0.5 transition-all">
              {editTask ? "Save Changes" : "Create Task"}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted transition-all">
              Cancel
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

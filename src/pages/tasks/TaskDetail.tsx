import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useTask } from "@/contexts/TaskContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowLeft, CheckCircle2, Circle, Clock, AlertCircle, Send,
  Flag, CalendarDays, User, Trash2, Edit2, ThumbsUp, ThumbsDown, Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import TaskFormModal from "./TaskFormModal";

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const formatDateTime = (date: string) =>
  new Date(date).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_CONFIG = {
  open:        { label: "Open",        color: "text-blue-400",   bg: "bg-blue-500/15" },
  in_progress: { label: "In Progress", color: "text-yellow-400", bg: "bg-yellow-500/15" },
  closed:      { label: "Closed",      color: "text-purple-400", bg: "bg-purple-500/15" },
  reviewed:    { label: "Reviewed",    color: "text-green-400",  bg: "bg-green-500/15" },
};

const PRIORITY_CONFIG = {
  low:    { label: "Low",    color: "text-muted-foreground" },
  medium: { label: "Medium", color: "text-yellow-400" },
  high:   { label: "High",   color: "text-red-400" },
};

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tasks, closeTask, reviewTask, addComment, toggleQualityCriteria, deleteTask, updateTask } = useTask();
  const { currentUser } = useAuth();
  const [comment, setComment] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const task = tasks.find(t => t.id === id);

  if (!task) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-32 text-center px-4">
          <Circle size={48} className="text-muted-foreground mb-4 opacity-30" />
          <h1 className="text-xl font-heading font-bold text-foreground mb-2">Task not found</h1>
          <button onClick={() => navigate("/tasks")} className="text-primary text-sm hover:underline">Back to tasks</button>
        </div>
      </AppLayout>
    );
  }

  const isAssignee = currentUser?.id === task.assignedTo;
  const isCreator = currentUser?.id === task.createdBy;
  const isAdminOrAbove = currentUser?.role === "admin" || currentUser?.role === "super_admin";
  const overdue = (task.status === "open" || task.status === "in_progress") && new Date(task.dueDate) < new Date();
  const allCriteriaMet = task.qualityCriteria.length === 0 || task.qualityCriteria.every(q => q.met);
  const metCount = task.qualityCriteria.filter(q => q.met).length;
  const cfg = STATUS_CONFIG[task.status];

  const handleClose = () => {
    if (!allCriteriaMet) { return; }
    closeTask(task.id); // FIX: userId/userName params removed from closeTask signature
  };

  const handleComment = () => {
    if (!comment.trim()) return;
    addComment(task.id, { id: currentUser!.id, name: currentUser!.name, initials: currentUser!.initials }, comment.trim());
    setComment("");
  };

  const handleDelete = () => { deleteTask(task.id); navigate("/tasks"); };

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Tasks", task.title]} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex items-start gap-2 min-w-0">
          <button onClick={() => navigate("/tasks")} className="mt-0.5 p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
              <span className={`flex items-center gap-1 text-xs font-heading ${PRIORITY_CONFIG[task.priority].color}`}>
                <Flag size={11} /> {PRIORITY_CONFIG[task.priority].label}
              </span>
              {overdue && <span className="flex items-center gap-1 text-xs text-red-400 font-heading"><AlertCircle size={11} /> Overdue</span>}
            </div>
            <h1 className="text-lg sm:text-xl font-heading font-bold text-foreground">{task.title}</h1>
          </div>
        </div>
        {(isAdminOrAbove || isCreator) && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setShowEdit(true)} className="p-2 rounded-lg hover:bg-muted text-primary transition-colors"><Edit2 size={15} /></button>
            {deleteConfirm ? (
              <div className="flex items-center gap-1">
                <button onClick={handleDelete} className="p-2 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><Check size={15} /></button>
                <button onClick={() => setDeleteConfirm(false)} className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><Circle size={15} /></button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirm(true)} className="p-2 rounded-lg hover:bg-muted text-destructive transition-colors"><Trash2 size={15} /></button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main */}
        <div className="lg:col-span-2 space-y-5">
          {/* Description */}
          <div className="rounded-xl bg-card border border-border p-4 sm:p-5">
            <h2 className="font-heading font-semibold text-foreground text-sm mb-2">Description</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{task.description || "No description provided."}</p>
          </div>

          {/* Quality Criteria */}
          {task.qualityCriteria.length > 0 && (
            <div className="rounded-xl bg-card border border-border p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading font-semibold text-foreground text-sm">Quality Criteria</h2>
                <span className="text-xs text-muted-foreground font-heading">{metCount}/{task.qualityCriteria.length} met</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-muted mb-4 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${(metCount / task.qualityCriteria.length) * 100}%`, background: "hsl(var(--primary))" }} />
              </div>
              <div className="space-y-2">
                {task.qualityCriteria.map(qc => (
                  <button key={qc.id}
                    onClick={() => (isAssignee || isAdminOrAbove) && toggleQualityCriteria(task.id, qc.id)}
                    disabled={task.status === "reviewed"}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                      qc.met ? "border-green-500/30 bg-green-500/10" : "border-border bg-muted/30 hover:border-primary/40"
                    } ${task.status === "reviewed" ? "cursor-default" : "cursor-pointer"}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${qc.met ? "bg-green-500 border-green-500" : "border-border bg-muted"}`}>
                      {qc.met && <Check size={11} className="text-white" />}
                    </div>
                    <span className={`text-sm font-heading ${qc.met ? "text-green-400" : "text-foreground"}`}>{qc.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="rounded-xl bg-card border border-border p-4 sm:p-5">
            <h2 className="font-heading font-semibold text-foreground text-sm mb-4">Comments</h2>
            <div className="space-y-4 mb-4">
              {task.comments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No comments yet.</p>
              ) : (
                task.comments.map(c => (
                  <div key={c.id} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full gradient-accent flex items-center justify-center text-[10px] font-heading font-bold text-primary-foreground shrink-0">
                      {c.userInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-heading font-semibold text-foreground">{c.userName}</span>
                        <span className="text-[10px] text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground break-words">{c.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input value={comment} onChange={e => setComment(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleComment()}
                placeholder="Add a comment..."
                className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              <button onClick={handleComment} className="px-3 py-2 rounded-lg gradient-accent text-primary-foreground transition-all hover:-translate-y-0.5 shrink-0">
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Meta */}
          <div className="rounded-xl bg-card border border-border p-4 space-y-3">
            {[
              { label: "Assigned To",  value: task.assignedToName,                                        icon: User },
              { label: "Created By",   value: task.createdByName,                                         icon: User },
              { label: "Due Date",     value: formatDate(task.dueDate),                                   icon: CalendarDays },
              ...(task.closedAt      ? [{ label: "Closed At",    value: formatDateTime(task.closedAt),    icon: CheckCircle2 }] : []),
              ...(task.reviewedByName ? [{ label: "Reviewed By", value: task.reviewedByName,              icon: CheckCircle2 }] : []),
              ...(task.reviewedAt    ? [{ label: "Reviewed At",  value: formatDateTime(task.reviewedAt),  icon: Clock }]        : []),
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-start gap-2">
                <Icon size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-heading text-muted-foreground uppercase tracking-wider">{label}</p>
                  <p className="text-sm text-foreground font-heading break-words">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="rounded-xl bg-card border border-border p-4 space-y-2">
            <p className="text-[10px] font-heading text-muted-foreground uppercase tracking-wider mb-3">Actions</p>

            {isAssignee && task.status === "open" && (
              <button onClick={() => updateTask(task.id, { status: "in_progress" })}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-heading border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-all">
                <Clock size={14} /> Start Working
              </button>
            )}

            {isAssignee && (task.status === "open" || task.status === "in_progress") && (
              <button onClick={handleClose} disabled={!allCriteriaMet}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-heading transition-all ${
                  allCriteriaMet
                    ? "border border-purple-500/40 text-purple-400 hover:bg-purple-500/10"
                    : "opacity-40 cursor-not-allowed border border-border text-muted-foreground"
                }`}>
                <CheckCircle2 size={14} />
                {allCriteriaMet ? "Close Task" : `${metCount}/${task.qualityCriteria.length} criteria met`}
              </button>
            )}

            {(isAdminOrAbove || isCreator) && task.status === "closed" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-heading text-center">Ready for review</p>
                <button onClick={() => reviewTask(task.id, currentUser!.id, currentUser!.name, true)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-heading border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-all">
                  <ThumbsUp size={14} /> Approve & Close
                </button>
                <button onClick={() => reviewTask(task.id, currentUser!.id, currentUser!.name, false)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-heading border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all">
                  <ThumbsDown size={14} /> Send Back for Rework
                </button>
              </div>
            )}

            {task.status === "reviewed" && (
              <div className="flex items-center justify-center gap-2 py-3 text-green-400">
                <CheckCircle2 size={16} />
                <span className="text-sm font-heading">Completed & reviewed</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showEdit && <TaskFormModal editTask={task} onClose={() => setShowEdit(false)} />}
      </AnimatePresence>
    </AppLayout>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getCheckpoints,
  addCheckpoint,
  renameActivityCheckpoint,
  setActivityCheckpointMinWaitDays,
  deleteActivityCheckpoint,
  type ActivityCheckpoint,
} from "@/api/activityCheckpointApi";
import { ClipboardCheck, ListChecks, Plus, Pencil, Trash2, X, Check, Timer } from "lucide-react";

const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

function CheckpointRow({
  checkpoint, canEdit, canDelete, onRenamed, onDeleted,
}: {
  checkpoint: ActivityCheckpoint;
  canEdit: boolean;
  canDelete: boolean;
  onRenamed: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(checkpoint.fieldName);
  const [waitDays, setWaitDays] = useState(checkpoint.minWaitDays != null ? String(checkpoint.minWaitDays) : "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const trimmed = value.trim();
    const nextMinWaitDays = waitDays.trim() === "" ? null : parseInt(waitDays, 10);
    const nameChanged = trimmed && trimmed !== checkpoint.fieldName;
    const waitChanged = nextMinWaitDays !== (checkpoint.minWaitDays ?? null);
    if (!nameChanged && !waitChanged) {
      setEditing(false);
      setValue(checkpoint.fieldName);
      return;
    }
    setSaving(true);
    try {
      if (nameChanged) await renameActivityCheckpoint(checkpoint.id, trimmed);
      if (waitChanged) await setActivityCheckpointMinWaitDays(checkpoint.id, nextMinWaitDays);
      onRenamed();
      setEditing(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteActivityCheckpoint(checkpoint.id);
      onDeleted();
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/5 px-3 py-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { setEditing(false); setValue(checkpoint.fieldName); }
          }}
          maxLength={200}
          disabled={saving}
          className="flex-1 bg-transparent text-sm text-foreground focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-center gap-1 shrink-0" title="Minimum wait days after start date">
          <Timer size={12} className="text-muted-foreground" />
          <input
            type="number"
            min={0}
            value={waitDays}
            onChange={(e) => setWaitDays(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { setEditing(false); setValue(checkpoint.fieldName); }
            }}
            placeholder="days"
            disabled={saving}
            className="w-16 bg-transparent text-xs text-foreground border border-border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 disabled:opacity-50"
          />
        </div>
        <button type="button" onClick={save} disabled={saving} className="w-6 h-6 shrink-0 rounded-md bg-cyan-500 text-white flex items-center justify-center hover:bg-cyan-600 disabled:opacity-40 transition-colors">
          <Check size={12} />
        </button>
        <button type="button" onClick={() => { setEditing(false); setValue(checkpoint.fieldName); setWaitDays(checkpoint.minWaitDays != null ? String(checkpoint.minWaitDays) : ""); }} disabled={saving} className="w-6 h-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <span className="flex items-center gap-2 text-sm text-foreground">
        {checkpoint.fieldName}
        {checkpoint.minWaitDays != null && checkpoint.minWaitDays > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
            <Timer size={9} /> {checkpoint.minWaitDays}d wait
          </span>
        )}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
            <Pencil size={13} />
          </button>
        )}
        {canDelete && (
          <button type="button" onClick={remove} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Remove">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function WorkCheckpointMaster() {
  const rights = usePageRights("work-checkpoint-master");
  const qc = useQueryClient();

  const [newField, setNewField] = useState("");
  const [newWaitDays, setNewWaitDays] = useState("");
  const [adding, setAdding] = useState(false);

  // One general list — Work Allocation picks from it for any activity.
  const { data: checkpoints = [], isLoading } = useQuery({
    queryKey: ["work-checkpoints"],
    queryFn: getCheckpoints,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["work-checkpoints"] });

  const handleAdd = async () => {
    const trimmed = newField.trim();
    if (!trimmed) return;
    const minWaitDays = newWaitDays.trim() === "" ? null : parseInt(newWaitDays, 10);
    setAdding(true);
    try {
      await addCheckpoint(trimmed, minWaitDays);
      setNewField("");
      setNewWaitDays("");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't add checkpoint");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Civil Work DPR", path: "/civilworkdpr" },
          { label: "Work Checkpoint Master" },
        ]}
      />
      <CivilWorkDprShell
        title="Work Checkpoint Master"
        subtitle="One general list of checkpoints — Work Allocation picks the ones that apply to each activity, e.g. 'Wall surface cleaned', 'Water curing done'"
        icon={ClipboardCheck}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <span className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground">
                  <ListChecks size={14} className="text-cyan-600 dark:text-cyan-400" />
                  Checkpoints
                </span>
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {isLoading ? "…" : checkpoints.length}
                </span>
              </div>
              <div className="p-5 space-y-3">
                {isLoading ? (
                  <div className="h-20 rounded-lg border border-border bg-muted/30 animate-pulse" />
                ) : (
                  <>
                    {checkpoints.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No checkpoints yet — add the first one below.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {checkpoints.map((cp) => (
                          <CheckpointRow
                            key={cp.id}
                            checkpoint={cp}
                            canEdit={rights.canEdit}
                            canDelete={rights.canDelete}
                            onRenamed={invalidate}
                            onDeleted={invalidate}
                          />
                        ))}
                      </div>
                    )}

                    {rights.canCreate && (
                      <div className="flex items-center gap-1.5 pt-2">
                        <input
                          value={newField}
                          onChange={(e) => setNewField(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
                          }}
                          placeholder="e.g. Wall surface cleaned"
                          maxLength={200}
                          disabled={adding}
                          className={`${inputCls} flex-1`}
                        />
                        <div className="flex items-center gap-1 shrink-0" title="Minimum wait days after start date (optional)">
                          <Timer size={13} className="text-muted-foreground" />
                          <input
                            type="number"
                            min={0}
                            value={newWaitDays}
                            onChange={(e) => setNewWaitDays(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
                            }}
                            placeholder="days"
                            disabled={adding}
                            className="w-20 h-[42px] rounded-lg text-sm bg-muted border border-border text-foreground px-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleAdd}
                          disabled={adding || !newField.trim()}
                          className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 disabled:opacity-50 transition-all"
                        >
                          <Plus size={13} /> Add
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </CivilWorkDprShell>
    </>
  );
}

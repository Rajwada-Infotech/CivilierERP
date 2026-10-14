import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getCheckpoints,
  addCheckpoint,
  renameActivityCheckpoint,
  setCheckpointDaily,
  deleteActivityCheckpoint,
  type ActivityCheckpoint,
} from "@/api/activityCheckpointApi";
import { Plus, Pencil, Trash2, X, Check, Timer, CalendarDays } from "lucide-react";

const inputCls =
  "w-full h-9 px-3 text-sm bg-card border border-foreground/40 focus:border-foreground text-foreground transition-colors focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 disabled:cursor-not-allowed";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 shrink-0";

// The "calendar mark": a checkpoint that's updated every day (photo + date) rather
// than ticked once — Work Allocation shows a calendar and live camera for it.
function DailyToggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Daily update"
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={on ? "Daily update: ON — Work Allocation shows a calendar and camera" : "Daily update: OFF"}
      className={`${KEY} h-7 px-2 shrink-0 border ${
        on
          ? "bg-foreground text-card border-foreground"
          : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
      }`}
    >
      <CalendarDays size={11} /> Daily
    </button>
  );
}

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
  const [isDaily, setIsDaily] = useState(checkpoint.isDaily);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const trimmed = value.trim();
    const nameChanged = trimmed && trimmed !== checkpoint.fieldName;
    const dailyChanged = isDaily !== checkpoint.isDaily;
    if (!nameChanged && !dailyChanged) {
      setEditing(false);
      setValue(checkpoint.fieldName);
      return;
    }
    setSaving(true);
    try {
      if (nameChanged) await renameActivityCheckpoint(checkpoint.id, trimmed);
      if (dailyChanged) await setCheckpointDaily(checkpoint.id, isDaily);
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
      <div className="flex items-center gap-1.5 border border-foreground px-2 py-1.5 my-1">
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
        <DailyToggle on={isDaily} onChange={setIsDaily} disabled={saving} />
        <button type="button" onClick={save} disabled={saving} aria-label="Save" className="w-7 h-7 shrink-0 bg-foreground text-card flex items-center justify-center disabled:opacity-40 transition-opacity">
          <Check size={12} />
        </button>
        <button type="button" onClick={() => { setEditing(false); setValue(checkpoint.fieldName); setIsDaily(checkpoint.isDaily); }} disabled={saving} aria-label="Cancel" className="w-7 h-7 shrink-0 text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-foreground/15">
      <span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        {checkpoint.fieldName}
        {checkpoint.minWaitDays != null && checkpoint.minWaitDays > 0 && (
          <span className={`${TAG} text-foreground border border-foreground/50`}>
            <Timer size={9} /> {checkpoint.minWaitDays}d wait
          </span>
        )}
        {checkpoint.isDaily && (
          <span className={`${TAG} text-foreground border border-dashed border-foreground`}>
            <CalendarDays size={9} /> Daily
          </span>
        )}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors" title="Edit" aria-label="Edit">
            <Pencil size={13} />
          </button>
        )}
        {canDelete && (
          <button type="button" onClick={remove} className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors" title="Remove" aria-label="Remove">
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
  const [newDaily, setNewDaily] = useState(false);
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
    setAdding(true);
    try {
      await addCheckpoint(trimmed, null, newDaily);
      setNewField("");
      setNewDaily(false);
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
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Work checkpoints"
        subtitle="One general list of checks. Work Allocation picks the ones that apply to each activity, such as wall surface cleaned or water curing done."
      >
        {!rights.canView ? (
          <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-foreground/40">
            You don't have access to this page.
          </div>
        ) : (
          <>
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow" style={{ padding: "16px 16px 18px" }}>
                {[
                  { label: "Checkpoints", value: checkpoints.length, note: "in the list" },
                  { label: "Daily", value: checkpoints.filter((c) => c.isDaily).length, note: "updated each day with a photo" },
                  { label: "With a wait", value: checkpoints.filter((c) => (c.minWaitDays ?? 0) > 0).length, note: "hold the next step for days" },
                ].map((x) => (
                  <div key={x.label}>
                    <p className="label">{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card" style={{ border: RULE }}>
              <div className="flex items-baseline gap-2.5 px-4 py-3" style={{ borderBottom: RULE }}>
                <span className={HEAD}>Checkpoints</span>
                <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{isLoading ? "…" : checkpoints.length}</span>
              </div>
              <div className="px-4 pt-2 pb-4">
                {isLoading ? (
                  <div className="mt-2 h-20 border border-foreground/20 bg-muted/30 animate-pulse" />
                ) : (
                  <>
                    {checkpoints.length === 0 ? (
                      <p className="py-3 text-sm text-muted-foreground">No checkpoints yet — add the first one below.</p>
                    ) : (
                      <div className="grid gap-x-8 sm:grid-cols-2">
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
                      <div className="flex items-center gap-1.5 pt-4">
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
                        <DailyToggle on={newDaily} onChange={setNewDaily} disabled={adding} />
                        <button
                          type="button"
                          onClick={handleAdd}
                          disabled={adding || !newField.trim()}
                          className={`${KEY} h-9 px-4 shrink-0 bg-foreground text-card border border-foreground`}
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
      </SheetShell>
    </>
  );
}

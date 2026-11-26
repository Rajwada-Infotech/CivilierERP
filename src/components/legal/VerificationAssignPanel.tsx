import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getLegalLookup } from "@/api/legalMastersApi";
import { saveAssignments, type Activity, type Workspace } from "@/api/legalVerificationApi";

const sel = "h-8 w-full border border-foreground/30 bg-background px-1.5 text-xs focus:border-foreground focus:outline-none disabled:opacity-50";
type Row = { emp: string; ver: string; due: string };
const rowOf = (a: Activity): Row => ({ emp: a.AssignedUserId ? String(a.AssignedUserId) : "", ver: a.VerifierUserId ? String(a.VerifierUserId) : "", due: a.DueDate ?? "" });

/**
 * Assign view: every activity of the workspace in one table — employee, verifier and target date — saved together.
 * "Apply to all open" fills the same employee / verifier into every activity that is not closed.
 */
export function VerificationAssignPanel({ w, canEdit, onSaved }: { w: Workspace; canEdit: boolean; onSaved: () => void }) {
  const users = useQuery({ queryKey: ["legal-lookup", "user"], queryFn: () => getLegalLookup("user"), staleTime: 600_000 });
  const [rows, setRows] = useState<Record<number, Row>>(() => Object.fromEntries(w.activities.map((a) => [a.ActivityId, rowOf(a)])));
  const [allEmp, setAllEmp] = useState("");
  const [allVer, setAllVer] = useState("");
  const [handover, setHandover] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (id: number, k: keyof Row, v: string) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }));
  const changed = useMemo(() => w.activities.filter((a) => { const o = rowOf(a), n = rows[a.ActivityId]; return o.emp !== n.emp || o.ver !== n.ver || o.due !== n.due; }), [rows, w.activities]);
  const reassigning = changed.some((a) => a.AssignedUserId && String(a.AssignedUserId) !== rows[a.ActivityId].emp);
  const open = (a: Activity) => a.Status !== "Closed";
  const applyAll = () => setRows((r) => Object.fromEntries(Object.entries(r).map(([id, v]) => {
    const a = w.activities.find((x) => x.ActivityId === Number(id))!;
    return [id, open(a) ? { ...v, emp: allEmp || v.emp, ver: allVer || v.ver } : v];
  })));
  const save = async () => {
    if (!changed.length) { toast.info("Nothing changed"); return; }
    if (reassigning && !handover.trim()) { toast.error("Write a handover note for the reassigned activities"); return; }
    setBusy(true);
    try {
      const r = await saveAssignments(w.VerificationId, changed.map((a) => ({ activityId: a.ActivityId, assignedUserId: rows[a.ActivityId].emp ? Number(rows[a.ActivityId].emp) : null,
        verifierUserId: rows[a.ActivityId].ver ? Number(rows[a.ActivityId].ver) : null, dueDate: rows[a.ActivityId].due || null, updatedAt: a.UpdatedAt })), handover || undefined);
      toast.success(r.message); setHandover(""); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const opts = (users.data ?? []).map((u) => <option key={u.value} value={u.value}>{u.label}</option>);
  return (
    <div>
      {canEdit && (
        <div className="mb-3 flex flex-wrap items-end gap-2 border border-border p-2 text-xs">
          <label className="min-w-[10rem]"><span className="mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">Employee for all open</span>
            <select className={sel} value={allEmp} onChange={(e) => setAllEmp(e.target.value)}><option value="">—</option>{opts}</select></label>
          <label className="min-w-[10rem]"><span className="mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">Verifier for all open</span>
            <select className={sel} value={allVer} onChange={(e) => setAllVer(e.target.value)}><option value="">—</option>{opts}</select></label>
          <button disabled={!allEmp && !allVer} onClick={applyAll} className="h-8 border border-foreground px-3 font-semibold uppercase disabled:opacity-40">Apply to all open</button>
          <span className="text-muted-foreground">Then adjust single rows below and save.</span>
        </div>
      )}
      <div className="overflow-x-auto border border-border">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-2 py-1.5">No.</th><th className="px-2 py-1.5">Activity</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5">Employee</th><th className="px-2 py-1.5">Verifier</th><th className="px-2 py-1.5">Target date</th></tr>
          </thead>
          <tbody>
            {w.activities.map((a) => {
              const r = rows[a.ActivityId];
              const dirty = changed.includes(a);
              const locked = !canEdit || !open(a);
              return (
                <tr key={a.ActivityId} className={`border-t border-border/60 ${dirty ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                  <td className="px-2 py-1 font-mono text-muted-foreground">{a.ActivityRef}</td>
                  <td className="px-2 py-1">{a.ActivityName}{!a.IsMandatory && <span className="ml-1 text-muted-foreground">(optional)</span>}{a.Department && <span className="block text-muted-foreground">{a.Department}</span>}</td>
                  <td className="px-2 py-1">{a.Status} · {a.VerifyStatus}</td>
                  <td className="px-2 py-1"><select disabled={locked} className={sel} value={r.emp} onChange={(e) => set(a.ActivityId, "emp", e.target.value)}><option value="">Not assigned</option>{opts}</select></td>
                  <td className="px-2 py-1"><select disabled={locked} className={`${sel} ${r.emp && r.emp === r.ver ? "border-destructive" : ""}`} value={r.ver} onChange={(e) => set(a.ActivityId, "ver", e.target.value)}><option value="">Any verifier</option>{opts}</select></td>
                  <td className="px-2 py-1"><input disabled={locked} type="date" className={sel} value={r.due} onChange={(e) => set(a.ActivityId, "due", e.target.value)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {reassigning && <input className="h-8 min-w-[18rem] flex-1 border border-foreground/30 bg-background px-2" maxLength={800} value={handover} onChange={(e) => setHandover(e.target.value)}
            placeholder="Handover note for the reassigned activities (required)" />}
          <span className="ml-auto text-muted-foreground">{changed.length ? `${changed.length} change${changed.length === 1 ? "" : "s"} not saved` : "No changes"}</span>
          <button disabled={busy || !changed.length} onClick={() => setRows(Object.fromEntries(w.activities.map((a) => [a.ActivityId, rowOf(a)])))} className="h-8 border border-foreground/40 px-3 font-semibold uppercase disabled:opacity-40">Undo</button>
          <button disabled={busy || !changed.length} onClick={save} className="h-8 bg-foreground px-4 font-semibold uppercase text-background disabled:opacity-40">{busy ? "Saving…" : "Save assignments"}</button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Verified or N/A activities are locked (reopen them first). The verifier must be someone other than the employee. Everyone assigned gets a notification and sees the work in My tasks.</p>
    </div>
  );
}

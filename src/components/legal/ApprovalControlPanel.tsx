import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { getApprovalRoles, saveApprovalRole, getLegalLookup, type ApprovalRole } from "@/api/legalMastersApi";
import { useAuth } from "@/contexts/AuthContext";

const ROLE_HELP: Record<string, string> = {
  Verifier: "Checks due diligence, does Final Verification, re-verifies changes",
  "L1 Approver": "First approval in Deed Process; applies to deed register",
  "L2 Approver": "Final approval in Deed Process (not the L1 approver)",
  "Legal Reviewer": "Gives legal clearance, clears court cases",
};

/**
 * Users dropdown with checkboxes and search. The open list is drawn on top of the page (a portal placed under the
 * button), so the table's scroll area never clips it. Closes on Done, Esc or a click outside.
 */
function UserPicker({ options, value, onChange }: { options: { value: number; label: string }[]; value: number[]; onChange: (v: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 0, up: false });

  // Place the list under the button (or above it when there is no room below); follow scrolling and resizing.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const up = window.innerHeight - r.bottom < 340 && r.top > 340;
      setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: r.width, up });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  const names = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 border border-border bg-background px-3 py-2 text-left text-sm">
        <span className={`truncate ${names.length ? "" : "text-muted-foreground"}`}>{names.length ? names.join(", ") : "Select users…"}</span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">{names.length ? `${names.length} selected ` : ""}▾</span>
      </button>
      {open && createPortal(
        <div ref={panel} className="fixed z-[1000] border border-border bg-background shadow-xl"
          style={{ left: pos.left, width: Math.max(pos.width, 260), ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <input autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
            {value.length > 0 && <button type="button" className="text-xs underline" onClick={() => onChange([])}>Clear</button>}
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {shown.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-muted/50">
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
              </label>
            ))}
            {!shown.length && <p className="px-2 py-1 text-xs text-muted-foreground">No match</p>}
          </div>
          <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
            <span className="text-xs text-muted-foreground">{value.length} selected</span>
            <button type="button" className="bg-foreground px-3 py-1 text-xs font-semibold text-card" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Approval Control, one row per role with all its users side by side. Stored as one row per user (the approval checks
 * read that); saving a role makes its users exactly the ones ticked. Only an administrator can change it.
 */
export function ApprovalControlPanel() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const isAdmin = ["super_admin", "admin", "dba"].includes(currentUser?.role ?? "");
  const { data: roles = [], isLoading, error } = useQuery({ queryKey: ["legal-approval-roles"], queryFn: getApprovalRoles });
  const { data: users = [] } = useQuery({ queryKey: ["legal-lookup", "user"], queryFn: () => getLegalLookup("user"), staleTime: 5 * 60_000 });
  const [editing, setEditing] = useState<{ stage: string; userIds: number[]; remarks: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const start = (r: ApprovalRole) => setEditing({ stage: r.stage, userIds: r.users.map((u) => u.id), remarks: r.remarks ?? "" });
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      toast.success((await saveApprovalRole(editing.stage, editing.userIds, editing.remarks)).message);
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["legal-approval-roles"] });
      qc.invalidateQueries({ queryKey: ["legal-master"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  const options = users.filter((u) => u.active !== false).map((u) => ({ value: Number(u.value), label: u.label }));
  const roleCell = (r: ApprovalRole) => (
    <td className="px-4 py-3 font-semibold">{r.stage}<span className="block text-xs font-normal text-muted-foreground">{ROLE_HELP[r.stage] ?? ""}</span></td>
  );

  return (
    <div className="border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-4 py-2.5">Approval role</th><th className="px-4 py-2.5">Users</th><th className="px-4 py-2.5">Remarks</th>{isAdmin && <th className="px-4 py-2.5 text-right">Actions</th>}</tr>
          </thead>
          <tbody>
            {roles.map((r) => editing?.stage === r.stage ? (
              <tr key={r.stage} className="border-t border-border bg-muted/30 align-top">
                {roleCell(r)}
                <td className="w-[38%] px-4 py-3"><UserPicker options={options} value={editing.userIds} onChange={(v) => setEditing({ ...editing, userIds: v })} /></td>
                <td className="px-4 py-3"><input className="w-full border border-border bg-background px-2 py-2 text-sm" placeholder="Remarks" value={editing.remarks} maxLength={500} onChange={(e) => setEditing({ ...editing, remarks: e.target.value })} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button className="bg-foreground px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-40" disabled={busy} onClick={save}>Save</button>
                  <button className="ml-2 text-xs underline" onClick={() => setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={r.stage} className="border-t border-border align-top">
                {roleCell(r)}
                <td className="px-4 py-3">
                  {r.users.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {r.users.map((u) => <span key={u.id} className={`border px-2 py-0.5 text-xs ${u.active ? "border-foreground/30 bg-primary/10" : "border-border text-muted-foreground line-through"}`}>{u.name ?? `User ${u.id}`}</span>)}
                    </span>
                  ) : <span className="text-xs text-amber-600">No user yet — anyone with the Approve right on the land page can act</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{r.remarks ?? "—"}</td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <button className="inline-flex items-center gap-1 border border-foreground px-2.5 py-1 text-xs font-semibold hover:bg-primary/10 disabled:opacity-40" disabled={!!editing} onClick={() => start(r)}>
                      <Pencil size={12} /> Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isAdmin && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Only an administrator can change Approval Control.</p>}
    </div>
  );
}

// Maintenance → Security Guards: which guard is posted at which gate, on which shift, from when to when. A guard is a
// user whose role is named Guard or Security Guard (made in User Management); shifts come from Security Attendance →
// Shifts. The Civilier Security app shows each guard today's gate and shift from here.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, SheetBox, TD, TH } from "@/components/maintenance/maintParts";
import { HrStatStrip } from "@/components/hrpayroll/HrUi";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK } from "@/components/sheet/sheetParts";
import { DateInput } from "@/components/ui/date-input";
import { usePageRights } from "@/hooks/usePageRights";
import {
  createGuardAssignment,
  deleteGuardAssignment,
  getGuardAssignments,
  getGuardOptions,
  updateGuardAssignment,
  type AssignmentInput,
  type GuardAssignment,
  type GuardOptions,
} from "@/api/securityIntercomApi";
import { EmptyRow, Field, SheetDialog, fieldCls } from "./securityParts";

const PAGE_KEY = "security-guards";
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Current: active and today falls in its dates. Ended: past its end date or switched off. Upcoming: starts later. */
function stateOf(a: GuardAssignment): { text: string; tone: "done" | "waiting" | "draft" } {
  const t = todayIst();
  if (!a.isActive || (a.effectiveTo && a.effectiveTo < t)) return { text: "Ended", tone: "draft" };
  if (a.effectiveFrom > t) return { text: "Upcoming", tone: "waiting" };
  return { text: "Current", tone: "done" };
}

export default function SecurityGuards() {
  const rights = usePageRights(PAGE_KEY);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const [editing, setEditing] = useState<GuardAssignment | "new" | null>(null);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["security-guard-assignments"], queryFn: getGuardAssignments });
  const { data: options } = useQuery({ queryKey: ["security-guard-options"], queryFn: getGuardOptions });

  const remove = async (a: GuardAssignment) => {
    if (!window.confirm(`Delete ${a.guardName ?? "this guard"}'s assignment to ${a.gateName}? This can't be undone. To end it but keep the record, edit it and set an end date.`)) return;
    try {
      await deleteGuardAssignment(a.id);
      toast.success("Assignment deleted");
      void qc.invalidateQueries({ queryKey: ["security-guard-assignments"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((a) => (showEnded || stateOf(a).text !== "Ended") && (!needle || `${a.guardName} ${a.gateName} ${a.projectName} ${a.shiftName}`.toLowerCase().includes(needle)));
  }, [rows, q, showEnded]);
  const current = rows.filter((a) => stateOf(a).text === "Current");
  const unassigned = (options?.guards ?? []).filter((g) => !current.some((a) => a.guardUserId === g.id));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Security Guards"]} />
      <MaintenanceShell
        title="Security Guards"
        subtitle="Which guard is posted at which gate, on which shift"
        action={
          rights.canCreate ? (
            <button type="button" onClick={() => setEditing("new")} className={`${KEY_INK} h-9 px-4`}>
              <Plus size={13} /> Assign Guard
            </button>
          ) : undefined
        }
      >
        <HrStatStrip
          items={[
            { label: "Guards", value: options ? options.guards.length : "…", hint: "Users with the Guard role" },
            { label: "Posted now", value: isLoading ? "…" : new Set(current.map((a) => a.guardUserId)).size },
            { label: "Not posted", value: options ? unassigned.length : "…", tone: unassigned.length ? "hsl(var(--destructive))" : undefined },
          ]}
        />
        {options && options.guards.length === 0 && (
          <p className="text-sm text-muted-foreground border border-foreground/30 px-3 py-2">
            No users have the Guard role yet. Create the guards' logins in User Management with the role Guard, then assign them here.
          </p>
        )}

        <SheetBox
          title="Assignments"
          note={shown.length}
          flush
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> Show ended
              </label>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guard, gate or project" className={`${fieldCls} w-56 h-8 pl-7`} />
              </div>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Guard</th>
                  <th className={TH}>Gate</th>
                  <th className={TH}>Shift</th>
                  <th className={TH}>From</th>
                  <th className={TH}>To</th>
                  <th className={TH}>Status</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <EmptyRow cols={7}>Reading…</EmptyRow>
                ) : error ? (
                  <EmptyRow cols={7}><span className="text-destructive">{(error as Error).message}</span></EmptyRow>
                ) : shown.length === 0 ? (
                  <EmptyRow cols={7}>{rows.length ? "No assignment matches." : "No guard is assigned yet."}</EmptyRow>
                ) : (
                  shown.map((a) => {
                    const st = stateOf(a);
                    return (
                      <tr key={a.id} className="hover:bg-primary/5">
                        <td className={`${TD} font-medium`}>{a.guardName ?? `User ${a.guardUserId}`}</td>
                        <td className={TD}>
                          {a.gateName}
                          <span className="block text-[0.6875rem] text-muted-foreground">{a.projectName}</span>
                        </td>
                        <td className={TD}>
                          {a.shiftName}
                          <span className="block text-[0.6875rem] text-muted-foreground font-heading tabular-nums">{a.startTime} – {a.endTime}</span>
                        </td>
                        <td className={`${TD} font-heading tabular-nums`}>{fmtDate(a.effectiveFrom)}</td>
                        <td className={`${TD} font-heading tabular-nums`}>{a.effectiveTo ? fmtDate(a.effectiveTo) : <span className="text-muted-foreground">Open</span>}</td>
                        <td className={TD}><SheetMark text={st.text} tone={st.tone} /></td>
                        <td className={`${TD} text-right`}>
                          {rights.canEdit && (
                            <button type="button" className={ICON_ACT} onClick={() => setEditing(a)} aria-label={`Edit ${a.guardName}'s assignment`}>
                              <Pencil size={13} />
                            </button>
                          )}
                          {rights.canDelete && (
                            <button type="button" className={ICON_ACT_RED} onClick={() => void remove(a)} aria-label={`Delete ${a.guardName}'s assignment`}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </SheetBox>
      </MaintenanceShell>

      {editing && options && (
        <AssignmentDialog
          row={editing === "new" ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["security-guard-assignments"] });
          }}
        />
      )}
    </>
  );
}

function AssignmentDialog({ row, options, onClose, onSaved }: { row: GuardAssignment | null; options: GuardOptions; onClose: () => void; onSaved: () => void }) {
  const [guardUserId, setGuard] = useState(row ? String(row.guardUserId) : "");
  const [gateId, setGate] = useState(row ? String(row.gateId) : "");
  const [shiftId, setShift] = useState(row ? String(row.shiftId) : "");
  const [from, setFrom] = useState(row?.effectiveFrom ?? todayIst());
  const [to, setTo] = useState(row?.effectiveTo ?? "");
  const [active, setActive] = useState(row?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!guardUserId) return toast.error("Choose the guard.");
    if (!gateId) return toast.error("Choose the gate.");
    if (!shiftId) return toast.error("Choose the shift.");
    if (!from) return toast.error("Enter the start date.");
    if (to && to < from) return toast.error("The end date can't be before the start date.");
    const body: AssignmentInput = { guardUserId: Number(guardUserId), gateId: Number(gateId), shiftId: Number(shiftId), effectiveFrom: from, effectiveTo: to || null, isActive: active };
    setSaving(true);
    try {
      if (row) await updateGuardAssignment(row.id, body);
      else await createGuardAssignment(body);
      toast.success(row ? "Assignment saved" : "Guard assigned");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetDialog title={row ? "Edit assignment" : "Assign a guard"} onClose={onClose} onSubmit={submit} saving={saving} icon={<Save size={13} />} submitLabel={row ? "Save" : "Assign"}>
      <Field label="Guard">
        <select value={guardUserId} onChange={(e) => setGuard(e.target.value)} className={fieldCls}>
          <option value="">Choose the guard…</option>
          {options.guards.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Gate">
        <select value={gateId} onChange={(e) => setGate(e.target.value)} className={fieldCls}>
          <option value="">Choose the gate…</option>
          {options.gates.map((g) => (
            <option key={g.id} value={g.id}>{g.projectName ? `${g.projectName} · ${g.name}` : g.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Shift" hint={options.shifts.length ? undefined : "No active shifts. Add one in Security Attendance → Shifts."}>
        <select value={shiftId} onChange={(e) => setShift(e.target.value)} className={fieldCls}>
          <option value="">Choose the shift…</option>
          {options.shifts.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.startTime} – {s.endTime})</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} className={fieldCls} />
        </Field>
        <Field label="To (optional)">
          <DateInput value={to} onChange={(e) => setTo(e.target.value)} className={fieldCls} />
        </Field>
      </div>
      {row && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      )}
    </SheetDialog>
  );
}

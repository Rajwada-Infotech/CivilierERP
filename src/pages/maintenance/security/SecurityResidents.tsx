// Maintenance → Residents: who can approve visitors for each flat in the Civilier Security app. Residents sign in with
// their customer-portal account (mobile + password). Most rows come from the CRM: a booking whose key handover is
// Completed makes its applicant the primary resident and its co-applicants members (synced hourly, on a completed
// handover, and by "Sync from CRM"). Tenants and family are added here by hand; a resident is removed by deactivating
// them, and every change is kept in the resident's history.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History as HistoryIcon, Loader2, Plus, RefreshCw, Search, UserCheck, UserX } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, SheetBox, TAG, TD, TH } from "@/components/maintenance/maintParts";
import { HrStatStrip } from "@/components/hrpayroll/HrUi";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import { usePageRights } from "@/hooks/usePageRights";
import {
  addResident,
  getResidentAudit,
  getResidents,
  searchResidentCustomers,
  syncResidents,
  updateResident,
  type CustomerOption,
  type ProjectOption,
  type SecurityResident,
} from "@/api/securityIntercomApi";
import { EmptyRow, Field, SheetDialog, fieldCls, flatLabel } from "./securityParts";

const PAGE_KEY = "security-residents";
const ACTION_LABEL: Record<string, string> = { ADDED: "Added", UPDATED: "Changed", DEACTIVATED: "Removed", REACTIVATED: "Restored" };

export default function SecurityResidents() {
  const rights = usePageRights(PAGE_KEY);
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<SecurityResident | null>(null);
  const [removing, setRemoving] = useState<SecurityResident | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ["security-residents", projectId], queryFn: () => getResidents(projectId ? Number(projectId) : null) });
  const all = data?.residents ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["security-residents"] });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/[\s-]+/g, "");
    return all.filter(
      (r) =>
        (showInactive || r.isActive) &&
        (!needle || `${r.customerName}${r.mobile}${r.block}${r.flatNo}${flatLabel(r.block, r.flatNo)}${r.bookingNo ?? ""}`.toLowerCase().replace(/[\s-]+/g, "").includes(needle)),
    );
  }, [all, q, showInactive]);
  const active = all.filter((r) => r.isActive);
  const flats = new Set(active.map((r) => `${r.projectId}|${r.block}|${r.flatNo}`)).size;
  const noLogin = active.filter((r) => !r.hasPortalLogin).length;

  const runSync = async () => {
    setSyncing(true);
    try {
      const s = await syncResidents(projectId ? Number(projectId) : null);
      const parts = [s.added && `${s.added} added`, s.reactivated && `${s.reactivated} restored`, s.updated && `${s.updated} changed`, s.deactivated && `${s.deactivated} removed`].filter(Boolean);
      toast.success(parts.length ? `Synced from CRM: ${parts.join(", ")}` : "Synced from CRM: already up to date");
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const toggle = async (r: SecurityResident, patch: { isActive?: boolean; isPrimary?: boolean }, done: string) => {
    try {
      await updateResident(r.id, patch);
      toast.success(done);
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Residents"]} />
      <MaintenanceShell
        title="Residents"
        subtitle="Who approves visitors for each flat, signed in with their customer-portal account"
        action={
          rights.canCreate ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={runSync} disabled={syncing} className={`${KEY_LINE} h-9 px-3`}>
                {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync from CRM
              </button>
              <button type="button" onClick={() => setAdding(true)} className={`${KEY_INK} h-9 px-4`}>
                <Plus size={13} /> Add Resident
              </button>
            </div>
          ) : undefined
        }
      >
        <HrStatStrip
          items={[
            { label: "Residents", value: isLoading ? "…" : active.length },
            { label: "Flats", value: isLoading ? "…" : flats },
            { label: "No portal login", value: isLoading ? "…" : noLogin, tone: noLogin ? "hsl(var(--destructive))" : undefined, hint: "Can't sign in to approve visitors" },
          ]}
        />

        <SheetBox
          title="Residents"
          note={shown.length}
          flush
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show removed
              </label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${fieldCls} w-auto h-8`} aria-label="Project">
                <option value="">All projects</option>
                {(data?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile or flat" className={`${fieldCls} w-52 h-8 pl-7`} />
              </div>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Flat</th>
                  <th className={TH}>Resident</th>
                  <th className={TH}>Mobile</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>From</th>
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
                  <EmptyRow cols={7}>{all.length ? "No resident matches." : "No residents yet. Sync from CRM to bring in handed-over flats."}</EmptyRow>
                ) : (
                  shown.map((r) => (
                    <tr key={r.id} className={`hover:bg-primary/5 ${r.isActive ? "" : "text-muted-foreground"}`}>
                      <td className={TD}>
                        <span className="font-heading tabular-nums font-semibold">{flatLabel(r.block, r.flatNo)}</span>
                        <span className="block text-[0.6875rem] text-muted-foreground">{r.projectName}</span>
                      </td>
                      <td className={TD}>
                        {r.customerName ?? `Customer ${r.customerId}`}
                        {!r.hasPortalLogin && r.isActive && <span className="block text-[0.6875rem] text-destructive">No portal login</span>}
                      </td>
                      <td className={`${TD} font-heading tabular-nums`}>{r.mobile ?? "—"}</td>
                      <td className={TD}>
                        <span className={TAG}>{r.isPrimary ? "Primary" : "Member"}</span>
                      </td>
                      <td className={TD}>
                        {r.source === "CRM_SYNC" ? (r.bookingNo ? `Handover · ${r.bookingNo}` : "Handover") : "Added by admin"}
                      </td>
                      <td className={TD}><SheetMark text={r.isActive ? "Active" : "Removed"} tone={r.isActive ? "done" : "draft"} /></td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        <button type="button" className={ICON_ACT} onClick={() => setHistory(r)} aria-label="History" title="History">
                          <HistoryIcon size={13} />
                        </button>
                        {rights.canEdit && r.isActive && (
                          <>
                            <button
                              type="button"
                              className={`${ICON_ACT} w-auto px-2 text-[0.625rem] font-heading font-semibold uppercase tracking-[0.1em]`}
                              onClick={() => toggle(r, { isPrimary: !r.isPrimary }, r.isPrimary ? "Made a member" : "Made primary")}
                              title={r.isPrimary ? "Make member" : "Make primary"}
                            >
                              {r.isPrimary ? "Member" : "Primary"}
                            </button>
                            <button type="button" className={ICON_ACT_RED} onClick={() => setRemoving(r)} aria-label="Remove" title="Remove">
                              <UserX size={13} />
                            </button>
                          </>
                        )}
                        {rights.canEdit && !r.isActive && (
                          <button type="button" className={ICON_ACT} onClick={() => toggle(r, { isActive: true }, "Resident restored")} aria-label="Restore" title="Restore">
                            <UserCheck size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SheetBox>
        <p className="text-[0.6875rem] text-muted-foreground">
          Flats come from the CRM once a booking's key handover is Completed. A sync also removes owners whose booking was cancelled or
          moved, but never touches residents added or changed here.
        </p>
      </MaintenanceShell>

      {adding && <AddResidentDialog projects={data?.projects ?? []} defaultProject={projectId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void refresh(); }} />}
      {history && <HistoryDialog resident={history} onClose={() => setHistory(null)} />}
      {removing && (
        <RemoveDialog
          resident={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function AddResidentDialog({ projects, defaultProject, onClose, onSaved }: { projects: ProjectOption[]; defaultProject: string; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [projectId, setProjectId] = useState(defaultProject);
  const [block, setBlock] = useState("");
  const [flatNo, setFlatNo] = useState("");
  const [isPrimary, setPrimary] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data: found = [], isFetching } = useQuery({ queryKey: ["security-resident-customers", debounced], queryFn: () => searchResidentCustomers(debounced), enabled: debounced.length >= 2 && !customer });

  const submit = async () => {
    if (!customer) return toast.error("Choose the customer.");
    if (!projectId) return toast.error("Choose the project.");
    if (!flatNo.trim()) return toast.error("Enter the flat number.");
    setSaving(true);
    try {
      await addResident({ customerId: customer.id, projectId: Number(projectId), block: block.trim(), flatNo: flatNo.trim(), isPrimary, note: note.trim() || undefined });
      toast.success("Resident added");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetDialog title="Add a resident" onClose={onClose} onSubmit={submit} saving={saving} icon={<Plus size={13} />} submitLabel="Add Resident" wide>
      <p className="text-xs text-muted-foreground">
        For tenants and family. The person needs a CRM customer record and a customer-portal login to sign in to the Security app.
      </p>
      <Field label="Customer">
        {customer ? (
          <div className="flex items-center justify-between gap-2 border border-foreground/40 px-2.5 h-9 text-sm">
            <span className="truncate">
              {customer.name} <span className="font-heading tabular-nums text-muted-foreground">· {customer.mobile}</span>
              {!customer.hasPortalLogin && <span className="text-destructive"> · no portal login</span>}
            </span>
            <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setCustomer(null)}>Change</button>
          </div>
        ) : (
          <div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, customer no. or mobile" className={fieldCls} autoFocus />
            {debounced.length >= 2 && (
              <div className="mt-1 max-h-48 overflow-y-auto border border-foreground/20">
                {isFetching ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                ) : found.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No customer found.</p>
                ) : (
                  found.map((c) => (
                    <button key={c.id} type="button" onClick={() => setCustomer(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 border-b border-foreground/10 last:border-b-0">
                      {c.name} <span className="font-heading tabular-nums text-muted-foreground">· {c.mobile} · {c.customerNo}</span>
                      {!c.hasPortalLogin && <span className="text-destructive text-xs"> · no portal login</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </Field>
      <Field label="Project">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={fieldCls}>
          <option value="">Choose the project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Block (optional)">
          <input value={block} onChange={(e) => setBlock(e.target.value)} maxLength={50} className={fieldCls} placeholder="A" />
        </Field>
        <Field label="Flat no.">
          <input value={flatNo} onChange={(e) => setFlatNo(e.target.value)} maxLength={50} className={fieldCls} placeholder="302" />
        </Field>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">Write the block and flat exactly as the CRM shows them, so the guard's request reaches everyone on the flat.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(e.target.checked)} />
        Primary resident (otherwise a member)
      </label>
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} className={fieldCls} placeholder="Tenant from 1 Dec, lease till Nov 2027" />
      </Field>
    </SheetDialog>
  );
}

function RemoveDialog({ resident, onClose, onRemoved }: { resident: SecurityResident; onClose: () => void; onRemoved: () => void }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await updateResident(resident.id, { isActive: false, note: note.trim() || undefined });
      toast.success("Resident removed");
      onRemoved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <SheetDialog title={`Remove ${resident.customerName ?? "resident"}`} onClose={onClose} onSubmit={submit} saving={saving} icon={<UserX size={13} />} submitLabel="Remove">
      <p className="text-sm">
        {resident.customerName} stops receiving visitor requests for flat {flatLabel(resident.block, resident.flatNo)} ({resident.projectName}). You can restore them later.
      </p>
      {resident.source === "CRM_SYNC" && (
        <p className="text-xs text-muted-foreground">They came from a CRM handover. Once you remove them here, the CRM sync leaves them removed.</p>
      )}
      <Field label="Reason (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} className={fieldCls} placeholder="Tenant moved out" />
      </Field>
    </SheetDialog>
  );
}

function HistoryDialog({ resident, onClose }: { resident: SecurityResident; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["security-resident-audit", resident.id], queryFn: () => getResidentAudit(resident.id) });
  return (
    <SheetDialog title={`History — ${resident.customerName ?? "resident"}, ${flatLabel(resident.block, resident.flatNo)}`} onClose={onClose} wide>
      <div className="max-h-80 overflow-y-auto border border-foreground/20">
        {isLoading ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Reading…</p>
        ) : data.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">No history.</p>
        ) : (
          data.map((h) => (
            <div key={h.id} className="px-3 py-2 border-b border-foreground/10 last:border-b-0 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{ACTION_LABEL[h.action] ?? h.action}</span>
                <span className="font-heading tabular-nums text-xs text-muted-foreground">
                  {new Date(h.at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {[h.detail, h.source === "CRM_SYNC" ? "CRM sync" : h.byName ? `by ${h.byName}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
          ))
        )}
      </div>
    </SheetDialog>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Car, CheckCircle2, Lock, ExternalLink, Pencil, X, ChevronDown, ChevronRight } from "lucide-react";

// Deliberately its own component/file, rendered as a separate toggle inside
// CrmProjectAutoSetup.tsx rather than folded into that page's Block/Floor/
// Unit wizard. Parking is Block-scoped only (dbo.ParkingSlot has no
// FloorNo) — it never needed Floors/Units to exist first, so there's no
// real workflow reason to couple it to that flow. Keeping it fully separate
// (own Project selector, own fetches, own state) means a re-render or a
// stuck request on one side can never affect the other — switching tabs is
// a plain in-memory conditional render, no route change, no reload.
const API = "/api/crm/project-auto-setup";
const PROJECTS_API = "/api/unit-master/projects";
const DROPDOWN_API = "/api/business/dropdown";

const PARKING_TYPES = ["Open", "Covered", "Stack", "Basement"];
type ParkingTemplateRow = { ParkingType: string; Count: string };

async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(PROJECTS_API); return r.ok ? r.json() : []; } catch { return []; }
}
// Company is the real top of this hierarchy (dbo.enterprise: business_type
// 'C' is a Project's business_type 'P' parent via company_id) — same shared
// dropdown endpoint every other Company->Project chain in the app already
// uses. fetchProjects above already returns each Project's CompanyId.
async function fetchCompanies(): Promise<{ id: number; name: string }[]> {
  try {
    const r = await fetchWithAuth(DROPDOWN_API);
    if (!r.ok) return [];
    const data = await r.json();
    return data.companies ?? [];
  } catch { return []; }
}
async function fetchStatus(projectId: string): Promise<any> {
  const r = await fetchWithAuth(`${API}/status?projectId=${projectId}`);
  return r.ok ? r.json() : null;
}

const inputCls = "w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background";
const labelCls = "text-xs text-muted-foreground block mb-1";
const cardCls = "rounded-xl border border-border p-4 space-y-3";

const CrmProjectAutoSetupParking: React.FC = () => {
  const qc = useQueryClient();
  // Strict Company -> Project gate — matches the cascade now enforced in
  // CrmProjectAutoSetup.tsx and every other Company->Project master page.
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [parkingTemplates, setParkingTemplates] = useState<Record<number, ParkingTemplateRow[]>>({});
  const [savingTemplateBlockId, setSavingTemplateBlockId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [expandedBlockId, setExpandedBlockId] = useState<number | null>(null);
  const [blockSlots, setBlockSlots] = useState<Record<number, any[]>>({});
  const [loadingSlotsBlockId, setLoadingSlotsBlockId] = useState<number | null>(null);
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [editingSlot, setEditingSlot] = useState<{ SlotNo: string; ParkingType: string } | null>(null);
  const [savingSlotId, setSavingSlotId] = useState<number | null>(null);

  // Own query keys (prefixed crm-auto-project-setup-parking-*), separate
  // from the Block/Floor/Unit page's ["crm-auto-project-setup-status", ...]
  // key — no shared cache entry, so nothing here can invalidate/refetch
  // that page's data or vice versa.
  const { data: companies = [] } = useQuery({ queryKey: ["business-dropdown-companies"], queryFn: fetchCompanies, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["crm-auto-project-setup-parking-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const projectsForCompany = useMemo(
    () => (companyId ? (projects as any[]).filter((p: any) => String(p.CompanyId) === companyId) : []),
    [projects, companyId],
  );
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["crm-auto-project-setup-parking-status", projectId],
    queryFn: () => fetchStatus(projectId),
    enabled: !!projectId,
  });

  const refetchStatus = () => qc.invalidateQueries({ queryKey: ["crm-auto-project-setup-parking-status", projectId] });
  const invalidateSyncedMasters = () => {
    qc.invalidateQueries({ queryKey: ["parking-master"] });
    qc.invalidateQueries({ queryKey: ["parking-slot-master"] });
    qc.invalidateQueries({ queryKey: ["crm-parking-matrix"] });
  };

  const blocks: any[] = status?.blocks || [];
  const step1Done = blocks.length > 0;

  // Lazily fetches each block's Parking template the first time it's seen.
  // Defaults to one blank row (Open) so there's always something to edit.
  useEffect(() => {
    if (!step1Done) return;
    blocks.forEach(async (b) => {
      if (parkingTemplates[b.Id] !== undefined) return;
      try {
        const r = await fetchWithAuth(`${API}/blocks/${b.Id}/parking-template`);
        const data = r.ok ? await r.json() : { items: [] };
        const rows: ParkingTemplateRow[] = (data.items || []).length
          ? data.items.map((it: any) => ({ ParkingType: it.ParkingType, Count: String(it.Count) }))
          : [{ ParkingType: "Open", Count: "1" }];
        setParkingTemplates((m) => ({ ...m, [b.Id]: rows }));
      } catch { /* leave unset — user can still add rows manually */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step1Done, blocks]);

  const templateTotal = (blockId: number) =>
    (parkingTemplates[blockId] || []).reduce((s, r) => s + (parseInt(r.Count, 10) || 0), 0);

  const addTemplateRow = (blockId: number) =>
    setParkingTemplates((m) => ({ ...m, [blockId]: [...(m[blockId] || []), { ParkingType: "Open", Count: "1" }] }));
  const removeTemplateRow = (blockId: number, idx: number) =>
    setParkingTemplates((m) => ({ ...m, [blockId]: (m[blockId] || []).filter((_, i) => i !== idx) }));
  const updateTemplateRow = (blockId: number, idx: number, patch: Partial<ParkingTemplateRow>) =>
    setParkingTemplates((m) => ({ ...m, [blockId]: (m[blockId] || []).map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));

  const handleSaveTemplate = async (blockId: number) => {
    const rows = parkingTemplates[blockId] || [];
    if (!rows.length) { toast.error("Add at least one Parking Type row"); return; }
    if (rows.some((r) => !r.ParkingType || !parseInt(r.Count, 10))) { toast.error("Every row needs a Parking Type and a Count of at least 1"); return; }
    setSavingTemplateBlockId(blockId);
    try {
      const res = await fetchWithAuth(`${API}/blocks/${blockId}/parking-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Items: rows.map((r) => ({ ParkingType: r.ParkingType, Count: r.Count })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save parking template");
      toast.success(`Template saved — ${data.total} slot(s)`);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingTemplateBlockId(null);
    }
  };

  // Project-wide — generates slots for every Block whose template has a
  // total > 0. Idempotent/additive on the backend: re-running after raising
  // a template just fills in the new slots, existing active ones untouched.
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`${API}/generate-parking-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate parking slots");
      if (data.createdCount === 0) {
        toast.info("No eligible blocks to generate — save a Parking template with at least one row first");
      } else {
        toast.success(`${data.createdCount} parking slot(s) created — e.g. ${data.sample.slice(0, 3).join(", ")}`);
      }
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleExpand = async (b: any) => {
    if (expandedBlockId === b.Id) { setExpandedBlockId(null); return; }
    setExpandedBlockId(b.Id);
    if (blockSlots[b.Id]) return;
    setLoadingSlotsBlockId(b.Id);
    try {
      const res = await fetchWithAuth(`${API}/blocks/${b.Id}/parking-slots`);
      const data = await res.json();
      if (res.ok) setBlockSlots((m) => ({ ...m, [b.Id]: data.slots }));
    } finally {
      setLoadingSlotsBlockId(null);
    }
  };

  // Deletes straight through the existing Parking Slot Master endpoint — it
  // already enforces the shared booking/hold lock check, nothing duplicated
  // here.
  const handleDeleteSlot = async (blockId: number, slot: any) => {
    if (!window.confirm(`Delete parking slot "${slot.SlotNo}"?`)) return;
    try {
      const res = await fetchWithAuth(`/api/parking-slot-master/${slot.Id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete parking slot");
      toast.success(data.message || "Parking slot deleted");
      setBlockSlots((m) => ({ ...m, [blockId]: (m[blockId] || []).filter((s) => s.Id !== slot.Id) }));
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const startEditSlot = (slot: any) => {
    setEditingSlotId(slot.Id);
    setEditingSlot({ SlotNo: slot.SlotNo || "", ParkingType: slot.ParkingType || "Open" });
  };

  const handleSaveSlot = async (blockId: number, slot: any) => {
    if (!editingSlot) return;
    const slotNo = editingSlot.SlotNo.trim();
    if (!slotNo) { toast.error("Slot number is required"); return; }
    setSavingSlotId(slot.Id);
    try {
      const res = await fetchWithAuth(`/api/parking-slot-master/${slot.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: slot.ProjectId,
          BlockId: slot.BlockId,
          SlotNo: slotNo,
          ParkingType: editingSlot.ParkingType,
          IsActive: slot.IsActive !== false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update parking slot");
      toast.success(data.message || "Parking slot updated");
      setBlockSlots((m) => ({
        ...m,
        [blockId]: (m[blockId] || []).map((s) => s.Id === slot.Id ? { ...s, SlotNo: slotNo, ParkingType: editingSlot.ParkingType } : s),
      }));
      setEditingSlotId(null);
      setEditingSlot(null);
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingSlotId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <label className={labelCls}>Company</label>
        <select
          value={companyId}
          onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); }}
          className={inputCls}
        >
          <option value="">Select company</option>
          {(companies as any[]).map((c: any) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
      </div>

      <div className={cardCls}>
        <label className={labelCls}>Project</label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={!companyId}
          className={`${inputCls} ${!companyId ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <option value="">{companyId ? "Select project" : "Select a Company first"}</option>
          {projectsForCompany.map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
        </select>
      </div>

      {projectId && statusLoading && (
        <div className="text-sm text-muted-foreground text-center py-6">Loading...</div>
      )}

      {projectId && status && !step1Done && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          This project has no Blocks yet — create Blocks first in "Block / Floor / Unit Setup" (the other toggle above), then come back here to set up Parking.
        </div>
      )}

      {projectId && status && step1Done && (
        <div className={cardCls}>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Car size={14} className="text-primary" /> Parking — Block-wise
            {blocks.some((b) => b.ParkingSlotCount > 0) && <CheckCircle2 size={13} className="text-green-600" />}
          </h3>

          <div className="space-y-4">
            {blocks.map((b) => {
              const rows = parkingTemplates[b.Id] || [];
              return (
                <div key={b.Id} className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold">{b.BlockName}</div>
                    {b.ParkingSlotCount > 0 && (
                      <button onClick={() => handleToggleExpand(b)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
                        {expandedBlockId === b.Id ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                        <Lock size={9} /> {b.ParkingSlotCount} slot(s) generated — click to manage
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {rows.map((row, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select value={row.ParkingType} onChange={(e) => updateTemplateRow(b.Id, idx, { ParkingType: e.target.value })}
                          className={`${inputCls} !py-1 flex-1`}>
                          {PARKING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <input type="number" min={1} max={500} placeholder="Count" value={row.Count}
                          onChange={(e) => updateTemplateRow(b.Id, idx, { Count: e.target.value })}
                          className={`${inputCls} !py-1 !w-20`} />
                        <button onClick={() => removeTemplateRow(b.Id, idx)} className="text-muted-foreground hover:text-red-600 shrink-0">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <button onClick={() => addTemplateRow(b.Id)} className="text-xs text-primary hover:underline">+ Add Type</button>
                      <span className="text-[11px] text-muted-foreground ml-auto">Total: {templateTotal(b.Id)} slot(s)</span>
                      <button onClick={() => handleSaveTemplate(b.Id)} disabled={savingTemplateBlockId === b.Id}
                        className="px-2.5 py-1 text-[11px] bg-muted rounded-lg font-medium hover:bg-muted/70 disabled:opacity-40">
                        Save Template
                      </button>
                    </div>
                  </div>

                  {expandedBlockId === b.Id && (
                    <ParkingSlotList
                      blockId={b.Id}
                      slots={blockSlots[b.Id]}
                      loading={loadingSlotsBlockId === b.Id}
                      editingSlotId={editingSlotId}
                      editingSlot={editingSlot}
                      savingSlotId={savingSlotId}
                      onStartEdit={startEditSlot}
                      onEditChange={(patch) => setEditingSlot((s) => s ? { ...s, ...patch } : s)}
                      onCancelEdit={() => { setEditingSlotId(null); setEditingSlot(null); }}
                      onSave={handleSaveSlot}
                      onDelete={handleDeleteSlot}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={handleGenerate} disabled={generating}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            Generate Parking Slots
          </button>
        </div>
      )}
    </div>
  );
};

// Shared expanded-slot list for a generated Block's Parking — real
// ParkingSlot rows, each deletable/editable straight through the existing
// Parking Slot Master endpoints (already enforce the booking/hold lock).
const ParkingSlotList: React.FC<{
  blockId: number;
  slots: any[] | undefined;
  loading: boolean;
  editingSlotId: number | null;
  editingSlot: { SlotNo: string; ParkingType: string } | null;
  savingSlotId: number | null;
  onStartEdit: (slot: any) => void;
  onEditChange: (patch: Partial<{ SlotNo: string; ParkingType: string }>) => void;
  onCancelEdit: () => void;
  onSave: (blockId: number, slot: any) => void;
  onDelete: (blockId: number, slot: any) => void;
}> = ({ blockId, slots, loading, editingSlotId, editingSlot, savingSlotId, onStartEdit, onEditChange, onCancelEdit, onSave, onDelete }) => (
  <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
    {loading ? (
      <div className="text-[11px] text-muted-foreground">Loading...</div>
    ) : (slots || []).length === 0 ? (
      <div className="text-[11px] text-muted-foreground">No slots left in this block.</div>
    ) : (slots || []).map((s) => {
      const lockReason = s.LockBookingNo ? `booked (${s.LockBookingNo})`
        : s.LockHoldId ? "on hold"
        : s.LockAllotmentId ? "allotted"
        : null;
      const isEditing = editingSlotId === s.Id && editingSlot;
      return (
        <div key={s.Id} className="flex items-center justify-between gap-2 text-[11px]">
          {isEditing ? (
            <span className="grid grid-cols-[minmax(160px,1fr)_92px] gap-1 flex-1">
              <input autoFocus value={editingSlot.SlotNo}
                onChange={(e) => onEditChange({ SlotNo: e.target.value })}
                className="h-7 rounded border border-border bg-background px-2 font-mono outline-none focus:border-primary" />
              <select value={editingSlot.ParkingType}
                onChange={(e) => onEditChange({ ParkingType: e.target.value })}
                className="h-7 rounded border border-border bg-background px-1 outline-none focus:border-primary">
                {PARKING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </span>
          ) : (
          <span className="font-mono">{s.SlotNo}{s.ParkingType ? ` — ${s.ParkingType}` : ""}</span>
          )}
          <span className="flex items-center gap-2">
            {lockReason && <span className="text-amber-600 flex items-center gap-0.5"><Lock size={9} /> {lockReason}</span>}
            {isEditing ? (
              <>
                <button onClick={() => onSave(blockId, s)} disabled={savingSlotId === s.Id}
                  className="text-primary hover:underline disabled:opacity-40">Save</button>
                <button onClick={onCancelEdit} className="text-muted-foreground hover:text-foreground">Cancel</button>
              </>
            ) : (
              <>
                <button onClick={() => onStartEdit(s)} disabled={!!lockReason}
                  className="text-muted-foreground hover:text-primary disabled:opacity-40"><Pencil size={10} /></button>
                <button onClick={() => onDelete(blockId, s)} disabled={!!lockReason}
                  className="text-muted-foreground hover:text-red-600 disabled:opacity-40"><X size={10} /></button>
              </>
            )}
          </span>
        </div>
      );
    })}
    <a href="/crm/setup/parking-slot-master" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
      edit details in Parking Slot Master <ExternalLink size={9} />
    </a>
  </div>
);

export default CrmProjectAutoSetupParking;
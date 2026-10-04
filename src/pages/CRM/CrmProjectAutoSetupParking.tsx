import React, { useEffect, useMemo, useState } from "react";
import { ParkingNamingPanel } from "./autoSetup/NamingPanel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Car, CheckCircle2, Lock, ExternalLink, Pencil, X, ChevronDown, ChevronRight } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";

// Deliberately its own component/file, rendered as a separate toggle inside
// CrmProjectAutoSetup.tsx rather than folded into that page's Block/Floor/
// Unit wizard. Parking is Block-scoped only (dbo.ParkingSlot has no
// FloorNo) — it never needed Floors/Units to exist first, so there's no
// real workflow reason to couple it to that flow. Keeping it fully separate
// (own Project selector, own fetches, own state) means a re-render or a
// stuck request on one side can never affect the other — switching tabs is
// a plain in-memory conditional render, no route change, no reload.
const API = "/api/crm/project-auto-setup";
const DROPDOWN_API = "/api/business/dropdown";

type ParkingTemplateRow = { ParkingType: string; Count: string; Charge: string; GstRate: string };

async function fetchParkingTypes(): Promise<string[]> {
  try {
    const r = await fetchWithAuth("/api/parking-master/types");
    return r.ok ? r.json() : [];
  } catch { return []; }
}

// Companies and projects from the shared business dropdown. Same query key
// and shape as CrmProjectAutoSetup.tsx's fetchDropdown, so the two pages
// share one cache entry — keep the return shape identical.
async function fetchDropdown(): Promise<{ companies: any[]; projects: any[] }> {
  try {
    const r = await fetchWithAuth(DROPDOWN_API);
    if (!r.ok) return { companies: [], projects: [] };
    return r.json();
  } catch { return { companies: [], projects: [] }; }
}
async function fetchStatus(projectId: string): Promise<any> {
  const r = await fetchWithAuth(`${API}/status?projectId=${projectId}`);
  return r.ok ? r.json() : null;
}

const inputCls = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-muted/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-sky-500/30";
const labelCls = "text-[0.6875rem] uppercase tracking-widest font-heading text-muted-foreground block mb-1.5";
const cardCls = "rounded-xl border border-border p-4 space-y-3";

const CrmProjectAutoSetupParking: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-auto-project-setup");
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
  // Which generated block's mix is open for editing (locked otherwise).
  const [editingTemplateFor, setEditingTemplateFor] = useState<number | null>(null);

  // Own query keys (prefixed crm-auto-project-setup-parking-*), separate
  // from the Block/Floor/Unit page's ["crm-auto-project-setup-status", ...]
  // key — no shared cache entry, so nothing here can invalidate/refetch
  // that page's data or vice versa.
  const { data: dropdown } = useQuery({ queryKey: ["crm-business-dropdown"], queryFn: fetchDropdown, staleTime: 5 * 60_000 });
  const companies = dropdown?.companies || [];
  const projects = dropdown?.projects || [];
  const { data: parkingTypes = [] } = useQuery<string[]>({ queryKey: ["parking-master-types"], queryFn: fetchParkingTypes, staleTime: 10 * 60_000 });
  const projectsForCompany = useMemo(
    () => companyId ? (projects as any[]).filter((p: any) => String(p.company_ids || p.company_id || p.CompanyId || "").split(",").includes(companyId)) : [],
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
          ? data.items.map((it: any) => ({
              ParkingType: it.ParkingType,
              Count: String(it.Count),
              Charge: it.Charge != null ? String(it.Charge) : "",
              GstRate: it.GstRate != null ? String(it.GstRate) : "",
            }))
          : [{ ParkingType: parkingTypes[0] ?? "", Count: "1", Charge: "", GstRate: "" }];
        setParkingTemplates((m) => ({ ...m, [b.Id]: rows }));
      } catch { /* leave unset — user can still add rows manually */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step1Done, blocks]);

  const templateTotal = (blockId: number) =>
    (parkingTemplates[blockId] || []).reduce((s, r) => s + (parseInt(r.Count, 10) || 0), 0);

  const addTemplateRow = (blockId: number) =>
    setParkingTemplates((m) => ({ ...m, [blockId]: [...(m[blockId] || []), { ParkingType: parkingTypes[0] ?? "", Count: "1", Charge: "", GstRate: "" }] }));
  const removeTemplateRow = (blockId: number, idx: number) =>
    setParkingTemplates((m) => ({ ...m, [blockId]: (m[blockId] || []).filter((_, i) => i !== idx) }));
  const updateTemplateRow = (blockId: number, idx: number, patch: Partial<ParkingTemplateRow>) =>
    setParkingTemplates((m) => ({ ...m, [blockId]: (m[blockId] || []).map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));

  const handleSaveTemplate = async (blockId: number) => {
    const rows = parkingTemplates[blockId] || [];
    if (!rows.length) { toast.error("Add at least one Parking Type row"); return false; }
    if (rows.some((r) => !r.ParkingType || !parseInt(r.Count, 10))) { toast.error("Every row needs a Parking Type and a Count of at least 1"); return false; }
    setSavingTemplateBlockId(blockId);
    try {
      const res = await fetchWithAuth(`${API}/blocks/${blockId}/parking-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Items: rows.map((r) => ({
            ParkingType: r.ParkingType,
            Count: r.Count,
            Charge: r.Charge,
            GstRate: r.GstRate,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save parking template");
      toast.success(`Saved — ${data.total} slot(s)`);
      return true;
    } catch (e: any) {
      toast.error(translateError(e.message));
      return false;
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
    setEditingSlot({ SlotNo: slot.SlotNo || "", ParkingType: slot.ParkingType || parkingTypes[0] || "" });
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
          {(companies as any[]).map((c: any) => <option key={c.id || c.Id} value={String(c.id || c.Id)}>{c.name || c.Name}</option>)}
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
          {projectsForCompany.map((p: any) => <option key={p.id || p.Id} value={String(p.id || p.Id)}>{p.name || p.Name}</option>)}
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

      {/* Surfaces the parking equivalent of the floor-less unit gap:
          slots whose BlockId IS NULL are visible in the parking matrix
          but invisible to the wizard's per-block totals. parkingSlotMaster.js
          POST allows BlockId to be optional, so these can accumulate silently.
          Shown regardless of step1Done — the orphan slots exist at project
          level and need fixing even if the block tree isn't set up yet. */}
      {projectId && status && (status.orphanParkingSlotCount ?? 0) > 0 && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm text-sky-600">
          {status.orphanParkingSlotCount} parking slot{status.orphanParkingSlotCount === 1 ? "" : "s"} on this project{" "}
          {status.orphanParkingSlotCount === 1 ? "has" : "have"} no Block assigned and won't appear in the
          per-block totals below — assign a Block in{" "}
          <a href="/crm/setup/parking-slot-master" className="underline">
            Parking Slot Master
          </a>{" "}
          before relying on this page as the full picture.
        </div>
      )}

      {projectId && status && step1Done && (
        <div className={cardCls}>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Car size={14} className="text-primary" /> Parking — Block-wise
            {blocks.some((b) => b.ParkingSlotCount > 0) && <CheckCircle2 size={13} className="text-green-600" />}
          </h3>

          <ParkingNamingPanel projectId={Number(projectId)} shortName={status?.project?.ShortCode} blocks={blocks} canEdit={rights.canEdit} />

          {/* One compact card per block: locked summary once slots exist
              (Edit to change), an editable table while setting up. */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {blocks.map((b) => {
              const rows = parkingTemplates[b.Id] || [];
              const generatedCount = b.ParkingSlotCount || 0;
              const locked = generatedCount > 0 && editingTemplateFor !== b.Id;
              const total = templateTotal(b.Id);
              const pending = Math.max(0, total - generatedCount);
              const inr = (v: string) => (v === "" || v == null ? "—" : `₹${Number(v).toLocaleString("en-IN")}`);
              return (
                <div key={b.Id} className="rounded-xl border border-border/60 bg-background/50 p-3 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Block {b.BlockName}</span>
                    {generatedCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 size={11} /> {generatedCount} slot{generatedCount === 1 ? "" : "s"} created
                      </span>
                    ) : (
                      <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Not created yet</span>
                    )}
                    {pending > 0 && generatedCount > 0 && (
                      <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">+{pending} to create</span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      {generatedCount > 0 && (
                        <button onClick={() => handleToggleExpand(b)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted/50">
                          {expandedBlockId === b.Id ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Slots
                        </button>
                      )}
                      {locked && rights.canEdit && (
                        <button onClick={() => setEditingTemplateFor(b.Id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-border text-primary hover:bg-primary/5">
                          <Pencil size={11} /> Edit
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Mix table — read-only when locked, inputs while editing. */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                          <th className="text-left font-medium pb-1.5">Type</th>
                          <th className="text-right font-medium pb-1.5 w-20">Slots</th>
                          <th className="text-right font-medium pb-1.5 w-32">Charge</th>
                          <th className="text-right font-medium pb-1.5 w-20">GST</th>
                          {!locked && <th className="w-6" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {rows.map((row, idx) => locked ? (
                          <tr key={idx}>
                            <td className="py-1.5">{row.ParkingType}</td>
                            <td className="py-1.5 text-right tabular-nums">{row.Count}</td>
                            <td className="py-1.5 text-right tabular-nums">{inr(row.Charge)}</td>
                            <td className="py-1.5 text-right tabular-nums">{row.GstRate === "" ? "—" : `${row.GstRate}%`}</td>
                          </tr>
                        ) : (
                          <tr key={idx}>
                            <td className="py-1 pr-2">
                              <select value={row.ParkingType} onChange={(e) => updateTemplateRow(b.Id, idx, { ParkingType: e.target.value })}
                                className="w-full max-w-[180px] h-8 px-2 text-xs rounded-lg border border-border bg-background">
                                {parkingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td className="py-1 pl-1">
                              <input type="number" min={1} max={500} value={row.Count} aria-label="Slots"
                                onChange={(e) => updateTemplateRow(b.Id, idx, { Count: e.target.value })}
                                className="w-full h-8 px-2 text-xs text-right rounded-lg border border-border bg-background tabular-nums" />
                            </td>
                            <td className="py-1 pl-1">
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                                <input type="number" min={0} value={row.Charge} placeholder="0" aria-label="Charge"
                                  onChange={(e) => updateTemplateRow(b.Id, idx, { Charge: e.target.value })}
                                  className="w-full h-8 pl-5 pr-2 text-xs text-right rounded-lg border border-border bg-background tabular-nums" />
                              </div>
                            </td>
                            <td className="py-1 pl-1">
                              <div className="relative">
                                <input type="number" min={0} max={100} step={0.01} value={row.GstRate} placeholder="0" aria-label="GST %"
                                  onChange={(e) => updateTemplateRow(b.Id, idx, { GstRate: e.target.value })}
                                  className="w-full h-8 pl-2 pr-5 text-xs text-right rounded-lg border border-border bg-background tabular-nums" />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                              </div>
                            </td>
                            <td className="py-1 pl-1 text-center">
                              {rows.length > 1 && (
                                <button onClick={() => removeTemplateRow(b.Id, idx)} aria-label="Remove type"
                                  className="text-muted-foreground hover:text-red-600"><X size={13} /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border">
                          <td className="pt-1.5 text-muted-foreground">
                            {!locked && <button onClick={() => addTemplateRow(b.Id)} className="text-primary hover:underline">+ Add type</button>}
                          </td>
                          <td className="pt-1.5 text-right font-semibold tabular-nums">{total}</td>
                          <td colSpan={locked ? 2 : 3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {!locked && generatedCount > 0 && (
                    <p className="text-[0.6875rem] text-muted-foreground">
                      Raising a count adds new slots when you create them. Lowering it doesn&apos;t remove slots already created — delete those under “Slots”.
                    </p>
                  )}
                  {!locked && rights.canEdit && (
                    <div className="flex justify-end gap-2">
                      {generatedCount > 0 && (
                        <button onClick={() => setEditingTemplateFor(null)}
                          className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted/50">Cancel</button>
                      )}
                      <button onClick={async () => { if (await handleSaveTemplate(b.Id)) setEditingTemplateFor(null); }}
                        disabled={savingTemplateBlockId === b.Id}
                        className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40">
                        {savingTemplateBlockId === b.Id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  )}

                  {expandedBlockId === b.Id && (
                    <ParkingSlotList
                      blockId={b.Id}
                      slots={blockSlots[b.Id]}
                      loading={loadingSlotsBlockId === b.Id}
                      editingSlotId={editingSlotId}
                      editingSlot={editingSlot}
                      savingSlotId={savingSlotId}
                      parkingTypes={parkingTypes}
                      onStartEdit={startEditSlot}
                      onEditChange={(patch) => setEditingSlot((s) => s ? { ...s, ...patch } : s)}
                      onCancelEdit={() => { setEditingSlotId(null); setEditingSlot(null); }}
                      onSave={handleSaveSlot}
                      onDelete={handleDeleteSlot}
                      canEdit={rights.canEdit}
                      canDelete={rights.canDelete}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Only show when at least one block has ungenerated slots — mirrors
              the unit setup's "only show when something is eligible" pattern.
              Once all templates are fully generated the button disappears. */}
          {rights.canCreate && blocks.some((b) => templateTotal(b.Id) > (b.ParkingSlotCount || 0)) && (
            <button onClick={handleGenerate} disabled={generating}
              className="px-4 py-2 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40">
              {generating ? "Creating…" : `Create ${blocks.reduce((s, b) => s + Math.max(0, templateTotal(b.Id) - (b.ParkingSlotCount || 0)), 0)} parking slot(s)`}
            </button>
          )}
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
  parkingTypes: string[];
  onStartEdit: (slot: any) => void;
  onEditChange: (patch: Partial<{ SlotNo: string; ParkingType: string }>) => void;
  onCancelEdit: () => void;
  onSave: (blockId: number, slot: any) => void;
  onDelete: (blockId: number, slot: any) => void;
  canEdit: boolean;
  canDelete: boolean;
}> = ({ blockId, slots, loading, editingSlotId, editingSlot, savingSlotId, parkingTypes, onStartEdit, onEditChange, onCancelEdit, onSave, onDelete, canEdit, canDelete }) => (
  <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
    {loading ? (
      <div className="text-[0.6875rem] text-muted-foreground">Loading...</div>
    ) : (slots || []).length === 0 ? (
      <div className="text-[0.6875rem] text-muted-foreground">No slots left in this block.</div>
    ) : (slots || []).map((s) => {
      const lockReason = s.LockBookingNo ? `booked (${s.LockBookingNo})`
        : s.LockHoldId ? "on hold"
        : s.LockAllotmentId ? "allotted"
        : null;
      const isEditing = editingSlotId === s.Id && editingSlot;
      return (
        <div key={s.Id} className="flex items-center justify-between gap-2 text-[0.6875rem]">
          {isEditing ? (
            <span className="grid grid-cols-[minmax(160px,1fr)_92px] gap-1 flex-1">
              <input autoFocus value={editingSlot.SlotNo}
                onChange={(e) => onEditChange({ SlotNo: e.target.value })}
                className="h-7 rounded border border-border bg-background px-2 font-mono outline-none focus:border-primary" />
              <select value={editingSlot.ParkingType}
                onChange={(e) => onEditChange({ ParkingType: e.target.value })}
                className="h-7 rounded border border-border bg-background px-1 outline-none focus:border-primary">
                {parkingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </span>
          ) : (
          <span className="font-mono">{s.SlotNo}{s.ParkingType ? ` — ${s.ParkingType}` : ""}</span>
          )}
          <span className="flex items-center gap-2">
            {lockReason && <span className="text-sky-600 flex items-center gap-0.5"><Lock size={9} /> {lockReason}</span>}
            {isEditing ? (
              <>
                <button onClick={() => onSave(blockId, s)} disabled={savingSlotId === s.Id}
                  className="text-primary hover:underline disabled:opacity-40">Save</button>
                <button onClick={onCancelEdit} className="text-muted-foreground hover:text-foreground">Cancel</button>
              </>
            ) : (
              <>
                {canEdit && (
                  <button onClick={() => onStartEdit(s)} disabled={!!lockReason}
                    className="text-muted-foreground hover:text-primary disabled:opacity-40"><Pencil size={10} /></button>
                )}
                {canDelete && (
                  <button onClick={() => onDelete(blockId, s)} disabled={!!lockReason}
                    className="text-muted-foreground hover:text-red-600 disabled:opacity-40"><X size={10} /></button>
                )}
              </>
            )}
          </span>
        </div>
      );
    })}
    <a href="/crm/setup/parking-slot-master" className="text-[0.6875rem] text-primary hover:underline flex items-center gap-0.5">
      edit details in Parking Slot Master <ExternalLink size={9} />
    </a>
  </div>
);

export default CrmProjectAutoSetupParking;
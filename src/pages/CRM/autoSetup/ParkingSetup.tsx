// Auto Project Setup's parking tab. Its own component with its own project, fetches and state: parking is
// block-scoped only (dbo.ParkingSlot has no floor), so it never needed floors or units first, and a slow request on
// one tab can't affect the other.
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { SheetMark } from "@/components/sheet/Sheet";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { ParkingNamingPanel } from "./NamingPanel";
import { ProjectPicker } from "./ProjectPicker";
import { API, INP, KEY_INK, KEY_LINE, LBL, NUM, Notice, PANEL, RULE, RULE_SOFT, Section, TEXT_LINK, fetchStatus, lockOf, plural } from "./config";

type ParkingTemplateRow = { ParkingType: string; Count: string; Charge: string; GstRate: string };
type SlotEdit = { SlotNo: string; ParkingType: string };

async function fetchParkingTypes(): Promise<string[]> {
  try {
    const r = await fetchWithAuth("/api/parking-master/types");
    return r.ok ? r.json() : [];
  } catch { return []; }
}

const SMALL_INP = `${INP} !h-8 !text-xs`;
const inr = (v: string) => (v === "" || v == null ? "—" : `₹${Number(v).toLocaleString("en-IN")}`);

const ParkingSetup: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const rights = usePageRights("crm-auto-project-setup");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [parkingTemplates, setParkingTemplates] = useState<Record<number, ParkingTemplateRow[]>>({});
  const [savingTemplateBlockId, setSavingTemplateBlockId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [expandedBlockId, setExpandedBlockId] = useState<number | null>(null);
  const [blockSlots, setBlockSlots] = useState<Record<number, any[]>>({});
  const [loadingSlotsBlockId, setLoadingSlotsBlockId] = useState<number | null>(null);
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [editingSlot, setEditingSlot] = useState<SlotEdit | null>(null);
  const [savingSlotId, setSavingSlotId] = useState<number | null>(null);
  // Which generated block's mix is open for editing (locked otherwise).
  const [editingTemplateFor, setEditingTemplateFor] = useState<number | null>(null);

  // Own query keys, apart from the setup tab's, so nothing here refetches that tab or the other way round.
  const { data: parkingTypes = [] } = useQuery<string[]>({ queryKey: ["parking-master-types"], queryFn: fetchParkingTypes, staleTime: 10 * 60_000 });
  const { data: status, isLoading: statusLoading, isError: statusFailed, error: statusError } = useQuery({
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

  // Each block's parking mix, fetched the first time it's seen; one blank row when it has none.
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
      } catch { /* leave unset — rows can still be added */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step1Done, blocks]);

  const templateTotal = (blockId: number) => (parkingTemplates[blockId] || []).reduce((s, r) => s + (parseInt(r.Count, 10) || 0), 0);
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
        body: JSON.stringify({ Items: rows.map((r) => ({ ParkingType: r.ParkingType, Count: r.Count, Charge: r.Charge, GstRate: r.GstRate })) }),
      });
      const data = await res.json().catch(() => ({}));
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

  // Project-wide and additive: slots for every block whose mix totals more than it has; existing slots untouched.
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`${API}/generate-parking-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to generate parking slots");
      if (data.createdCount === 0) toast.info("No eligible blocks to generate — save a Parking template with at least one row first");
      else toast.success(`${data.createdCount} parking slot(s) created — e.g. ${data.sample.slice(0, 3).join(", ")}`);
      // The slot lists shown are stale now.
      setBlockSlots({});
      setExpandedBlockId(null);
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
      const data = await res.json().catch(() => ({}));
      // A failed load said nothing and showed "No slots left".
      if (!res.ok) throw new Error(data.error || "The slots didn't load");
      setBlockSlots((m) => ({ ...m, [b.Id]: data.slots || [] }));
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setLoadingSlotsBlockId(null);
    }
  };

  // Through Parking Slot Master's own endpoints — they enforce the booking / hold / allotment lock.
  const handleDeleteSlot = async (blockId: number, slot: any) => {
    if (!(await ask.confirm(`Delete parking slot "${slot.SlotNo}"?`, { okLabel: "Delete", danger: true }))) return;
    try {
      const res = await fetchWithAuth(`/api/parking-slot-master/${slot.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete parking slot");
      toast.success(data.message || "Parking slot deleted");
      setBlockSlots((m) => ({ ...m, [blockId]: (m[blockId] || []).filter((s) => s.Id !== slot.Id) }));
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
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
        body: JSON.stringify({ ProjectId: slot.ProjectId, BlockId: slot.BlockId, SlotNo: slotNo, ParkingType: editingSlot.ParkingType, IsActive: slot.IsActive !== false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update parking slot");
      toast.success(data.message || "Parking slot updated");
      setBlockSlots((m) => ({ ...m, [blockId]: (m[blockId] || []).map((s) => (s.Id === slot.Id ? { ...s, SlotNo: slotNo, ParkingType: editingSlot.ParkingType } : s)) }));
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

  const toCreate = blocks.reduce((s, b) => s + Math.max(0, templateTotal(b.Id) - (b.ParkingSlotCount || 0)), 0);
  const th = `!px-2 !py-2 text-left ${LBL}`;

  return (
    <div className="space-y-5">
      {ask.node}
      <ProjectPicker companyId={companyId} projectId={projectId} onCompany={(v) => { setCompanyId(v); setProjectId(""); }} onProject={setProjectId} />

      {!projectId && (
        <div className="bg-card px-6 py-10 text-center" style={{ border: RULE_SOFT }}>
          <p className="text-sm font-medium">No project selected</p>
          <p className="text-xs text-muted-foreground mt-1">Pick a company and project above to set up its parking.</p>
        </div>
      )}
      {projectId && statusLoading && <p className="text-sm text-muted-foreground">Loading the project…</p>}
      {projectId && statusFailed && <Notice tone="error">{(statusError as Error)?.message}</Notice>}

      {projectId && status && !step1Done && (
        <Notice>This project has no blocks yet. Create them on the Blocks tab first, then come back here to set up parking.</Notice>
      )}

      {/* Slots with no block show in the parking matrix but not in the per-block totals below. */}
      {projectId && status && (status.orphanParkingSlotCount ?? 0) > 0 && (
        <Notice tone="fix">
          <span className={NUM}>{plural(status.orphanParkingSlotCount, "parking slot")}</span> on this project {status.orphanParkingSlotCount === 1 ? "has" : "have"} no block and won&apos;t appear in the per-block totals below — give {status.orphanParkingSlotCount === 1 ? "it" : "them"} a block in{" "}
          <Link to="/crm/setup/parking-slot-master" className={TEXT_LINK}>Parking Slot Master</Link> before relying on this page as the full picture.
        </Notice>
      )}

      {projectId && status && step1Done && (
        <Section title="Parking, block by block" done={blocks.some((b) => b.ParkingSlotCount > 0)}
          note="Each block's mix of parking types, with the charge and GST per slot. Saved mixes lock; Edit to change."
          right={rights.canCreate && toCreate > 0 && (
            <button onClick={handleGenerate} disabled={generating} className={`${KEY_INK} h-8 px-3`}>
              {generating ? "Creating…" : `Create ${plural(toCreate, "parking slot")}`}
            </button>
          )}>
          <ParkingNamingPanel projectId={Number(projectId)} shortName={status.project?.ShortCode} blocks={blocks} canEdit={rights.canEdit} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {blocks.map((b) => {
              const rows = parkingTemplates[b.Id] || [];
              const generatedCount = b.ParkingSlotCount || 0;
              const locked = !rights.canEdit || (generatedCount > 0 && editingTemplateFor !== b.Id);
              const total = templateTotal(b.Id);
              const pending = Math.max(0, total - generatedCount);
              return (
                <div key={b.Id} className={PANEL}>
                  <div className="px-3 py-2.5 flex flex-wrap items-center gap-2" style={{ borderBottom: RULE_SOFT }}>
                    <span className="text-sm font-semibold">Block {b.BlockName}</span>
                    {generatedCount > 0
                      ? <SheetMark text={`${plural(generatedCount, "slot")} created`} tone="done" />
                      : <SheetMark text="Not created yet" tone="draft" />}
                    {pending > 0 && generatedCount > 0 && <SheetMark text={`+${pending} to create`} tone="waiting" />}
                    <div className="ml-auto flex items-center gap-1.5">
                      {generatedCount > 0 && (
                        <button onClick={() => handleToggleExpand(b)} className={`${KEY_LINE} h-7 px-2.5`}>
                          {expandedBlockId === b.Id ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Slots
                        </button>
                      )}
                      {rights.canEdit && generatedCount > 0 && editingTemplateFor !== b.Id && (
                        <button onClick={() => setEditingTemplateFor(b.Id)} className={`${KEY_LINE} h-7 px-2.5`}><Pencil size={11} /> Edit</button>
                      )}
                    </div>
                  </div>

                  <div className="px-3 py-2 overflow-x-auto thin-scroll">
                    <table className="w-full text-xs min-w-[380px]">
                      <thead>
                        <tr style={{ borderBottom: RULE }}>
                          <th className={th}>Type</th>
                          <th className={`${th} !text-right w-20`}>Slots</th>
                          <th className={`${th} !text-right w-32`}>Charge</th>
                          <th className={`${th} !text-right w-20`}>GST</th>
                          {!locked && <th className="w-6" />}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => locked ? (
                          <tr key={idx} style={{ borderBottom: RULE_SOFT }}>
                            <td className="!px-2 !py-2">{row.ParkingType}</td>
                            <td className={`!px-2 !py-2 text-right ${NUM}`}>{row.Count}</td>
                            <td className={`!px-2 !py-2 text-right ${NUM}`}>{inr(row.Charge)}</td>
                            <td className={`!px-2 !py-2 text-right ${NUM}`}>{row.GstRate === "" ? "—" : `${row.GstRate}%`}</td>
                          </tr>
                        ) : (
                          <tr key={idx} style={{ borderBottom: RULE_SOFT }}>
                            <td className="!px-1 !py-1.5">
                              <select value={row.ParkingType} onChange={(e) => updateTemplateRow(b.Id, idx, { ParkingType: e.target.value })} className={`${SMALL_INP} max-w-[180px]`}>
                                {parkingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td className="!px-1 !py-1.5">
                              <input type="number" min={1} max={500} value={row.Count} aria-label="Slots"
                                onChange={(e) => updateTemplateRow(b.Id, idx, { Count: e.target.value })} className={`${SMALL_INP} ${NUM} text-right`} />
                            </td>
                            <td className="!px-1 !py-1.5">
                              <input type="number" min={0} value={row.Charge} placeholder="₹ 0" aria-label="Charge"
                                onChange={(e) => updateTemplateRow(b.Id, idx, { Charge: e.target.value })} className={`${SMALL_INP} ${NUM} text-right`} />
                            </td>
                            <td className="!px-1 !py-1.5">
                              <input type="number" min={0} max={100} step={0.01} value={row.GstRate} placeholder="0 %" aria-label="GST %"
                                onChange={(e) => updateTemplateRow(b.Id, idx, { GstRate: e.target.value })} className={`${SMALL_INP} ${NUM} text-right`} />
                            </td>
                            <td className="!px-1 !py-1.5 text-center">
                              {rows.length > 1 && (
                                <button onClick={() => removeTemplateRow(b.Id, idx)} aria-label="Remove type" className="text-muted-foreground hover:text-destructive"><X size={13} /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="!px-2 !pt-2">
                            {!locked && <button onClick={() => addTemplateRow(b.Id)} className={`${TEXT_LINK} inline-flex items-center gap-1`}><Plus size={11} /> Add a type</button>}
                          </td>
                          <td className={`!px-2 !pt-2 text-right font-semibold ${NUM}`}>{total}</td>
                          <td colSpan={locked ? 2 : 3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {!locked && (
                    <div className="px-3 pb-3 space-y-2">
                      {generatedCount > 0 && (
                        <p className="text-xs text-muted-foreground">Raising a count adds new slots when you create them. Lowering it doesn&apos;t remove slots already created — delete those under Slots.</p>
                      )}
                      <div className="flex justify-end gap-2">
                        {generatedCount > 0 && <button onClick={() => setEditingTemplateFor(null)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>}
                        <button onClick={async () => { if (await handleSaveTemplate(b.Id)) setEditingTemplateFor(null); }} disabled={savingTemplateBlockId === b.Id} className={`${KEY_INK} h-8 px-3`}>
                          {savingTemplateBlockId === b.Id ? "Saving…" : "Save mix"}
                        </button>
                      </div>
                    </div>
                  )}

                  {expandedBlockId === b.Id && (
                    <div className="px-3 pb-3 pt-2 space-y-1.5" style={{ borderTop: RULE_SOFT }}>
                      {loadingSlotsBlockId === b.Id ? (
                        <p className="text-xs text-muted-foreground">Loading slots…</p>
                      ) : !blockSlots[b.Id] ? (
                        <p className="text-xs text-destructive">The slots didn&apos;t load. Close and open them again.</p>
                      ) : blockSlots[b.Id].length === 0 ? (
                        <p className="text-xs text-muted-foreground">No slots left in this block.</p>
                      ) : blockSlots[b.Id].map((s) => {
                        const lock = lockOf(s);
                        const isEditing = editingSlotId === s.Id && editingSlot;
                        return (
                          <div key={s.Id} className="flex flex-wrap items-center justify-between gap-2 text-xs py-1" style={{ borderBottom: RULE_SOFT }}>
                            {isEditing ? (
                              <span className="grid grid-cols-[minmax(140px,1fr)_110px] gap-1.5 flex-1">
                                <input autoFocus value={editingSlot.SlotNo} onChange={(e) => setEditingSlot((x) => (x ? { ...x, SlotNo: e.target.value } : x))} className={`${SMALL_INP} ${NUM}`} />
                                <select value={editingSlot.ParkingType} onChange={(e) => setEditingSlot((x) => (x ? { ...x, ParkingType: e.target.value } : x))} className={SMALL_INP}>
                                  {parkingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </span>
                            ) : (
                              <span><span className={`${NUM} font-medium`}>{s.SlotNo}</span>{s.ParkingType ? <span className="text-muted-foreground"> · {s.ParkingType}</span> : null}</span>
                            )}
                            <span className="flex items-center gap-3">
                              {lock && <SheetMark text={lock.text} tone={lock.tone} />}
                              {isEditing ? (
                                <>
                                  <button onClick={() => handleSaveSlot(b.Id, s)} disabled={savingSlotId === s.Id} className={TEXT_LINK}>{savingSlotId === s.Id ? "Saving…" : "Save"}</button>
                                  <button onClick={() => { setEditingSlotId(null); setEditingSlot(null); }} className={`${TEXT_LINK} text-muted-foreground`}>Cancel</button>
                                </>
                              ) : (
                                <>
                                  {rights.canEdit && (
                                    <button onClick={() => { setEditingSlotId(s.Id); setEditingSlot({ SlotNo: s.SlotNo || "", ParkingType: s.ParkingType || parkingTypes[0] || "" }); }}
                                      disabled={!!lock} className={TEXT_LINK}>Edit</button>
                                  )}
                                  {rights.canDelete && <button onClick={() => handleDeleteSlot(b.Id, s)} disabled={!!lock} className={`${TEXT_LINK} text-destructive`}>Delete</button>}
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      <Link to="/crm/setup/parking-slot-master" className={`${TEXT_LINK} inline-block text-muted-foreground`}>Edit details in Parking Slot Master</Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
};

export default ParkingSetup;

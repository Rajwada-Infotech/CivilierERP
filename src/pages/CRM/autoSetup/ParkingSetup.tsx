// Auto Project Setup's parking tab. Its own component with its own fetches and state (the project is shared via the
// address): parking is block-scoped only (dbo.ParkingSlot has no floor), so it never needed floors or units first, and
// a slow request on one tab can't affect the other.
//
// The page reads top to bottom: the project's parking at a glance (planned, created, free / held / booked, value),
// then each block — its mix of types with charge, GST and value, and a map of its real slots (the Parking Matrix's
// tiles) where a click opens that slot to rename, retype or delete it.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { SheetMark, money } from "@/components/sheet/Sheet";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useUrlParam } from "@/hooks/useUrlParam";
import { usePageRights } from "@/hooks/usePageRights";
import { Legend, Tile, type TileStatus } from "../matrix/shared";
import { ParkingNamingPanel } from "./NamingPanel";
import { ProjectPicker } from "./ProjectPicker";
import { API, INP, KEY_INK, KEY_LINE, LBL, NUM, Notice, PANEL, RULE, RULE_SOFT, Section, TEXT_LINK, fetchStatus, lockOf, plural } from "./config";

type ParkingTemplateRow = { ParkingType: string; Count: string; Charge: string; GstRate: string };
type SlotEdit = { SlotNo: string; ParkingType: string };
type Slot = {
  Id: number; ProjectId: number; BlockId: number; SlotNo: string; ParkingType: string | null; IsActive: boolean;
  LockAllotmentId: number | null; LockBookingNo: string | null; LockHoldId: number | null;
};

async function fetchParkingTypes(): Promise<string[]> {
  try {
    const r = await fetchWithAuth("/api/parking-master/types");
    return r.ok ? r.json() : [];
  } catch { return []; }
}
async function fetchProjectSlots(projectId: string): Promise<Slot[]> {
  const r = await fetchWithAuth(`${API}/projects/${projectId}/parking-slots`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "The parking slots didn't load");
  return data.slots || [];
}

const SMALL_INP = `${INP} !h-8 !text-xs`;
const num = (v: string) => (v === "" || v == null ? 0 : Number(v) || 0);
const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
const inrOrDash = (v: string) => (v === "" || v == null ? "—" : inr(Number(v)));
// A slot's state on the map: allotted to a booking = booked; on hold = held; else free.
const slotStatus = (s: Slot): TileStatus => (s.LockAllotmentId || s.LockBookingNo ? "Booked" : s.LockHoldId ? "OnHold" : "Available");
// "TSTRSD/A/P07" reads as "P07" on a tile; the full name is its tooltip.
const shortName = (slotNo: string) => slotNo.split("/").pop() || slotNo;
const COUNT0: Record<TileStatus, number> = { Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
// The block list is rows of a CSS grid, not a <table>: an open block's own mix table
// would otherwise be a table inside a table cell, which the app's table styles break.
const ROW = "grid grid-cols-[minmax(100px,1fr)_minmax(150px,2.4fr)_84px_56px_64px_64px_88px_112px] items-center gap-x-2 min-w-[760px]";
const CELL_NUM = "text-right tabular-nums";

const ParkingSetup: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const rights = usePageRights("crm-auto-project-setup");
  // In the address, shared with the setup tab (see CrmProjectAutoSetup).
  const [companyId, setCompanyId] = useUrlParam("company");
  const [projectId, setProjectId] = useUrlParam("project");
  const [parkingTemplates, setParkingTemplates] = useState<Record<number, ParkingTemplateRow[]>>({});
  // Each block's mix as last saved (the editor rows can hold unsaved changes, or a blank starter row) — the
  // project totals count only these.
  const [savedMix, setSavedMix] = useState<Record<number, ParkingTemplateRow[]>>({});
  const [savingTemplateBlockId, setSavingTemplateBlockId] = useState<number | null>(null);
  // null = idle; "all" = every block; a block id = that block only.
  const [generating, setGenerating] = useState<number | "all" | null>(null);
  // Which generated block's mix is open for editing (locked otherwise).
  const [editingTemplateFor, setEditingTemplateFor] = useState<number | null>(null);
  // The one block opened below its row (its mix and slot map).
  const [openBlockId, setOpenBlockId] = useState<number | null>(null);
  // The slot opened on a block's map.
  const [openSlotId, setOpenSlotId] = useState<number | null>(null);
  const [editingSlot, setEditingSlot] = useState<SlotEdit | null>(null);
  const [savingSlot, setSavingSlot] = useState(false);

  // Own query keys, apart from the setup tab's, so nothing here refetches that tab or the other way round.
  const { data: parkingTypes = [] } = useQuery<string[]>({ queryKey: ["parking-master-types"], queryFn: fetchParkingTypes, staleTime: 10 * 60_000 });
  const { data: status, isLoading: statusLoading, isError: statusFailed, error: statusError } = useQuery({
    queryKey: ["crm-auto-project-setup-parking-status", projectId],
    queryFn: () => fetchStatus(projectId),
    enabled: !!projectId,
  });
  const { data: slots = [], isError: slotsFailed, error: slotsError } = useQuery({
    queryKey: ["crm-auto-project-setup-parking-slots", projectId],
    queryFn: () => fetchProjectSlots(projectId),
    enabled: !!projectId,
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["crm-auto-project-setup-parking-status", projectId] });
    qc.invalidateQueries({ queryKey: ["crm-auto-project-setup-parking-slots", projectId] });
  };
  const invalidateSyncedMasters = () => {
    qc.invalidateQueries({ queryKey: ["parking-master"] });
    qc.invalidateQueries({ queryKey: ["parking-slot-master"] });
    qc.invalidateQueries({ queryKey: ["crm-parking-matrix"] });
  };

  const blocks: any[] = status?.blocks || [];
  const step1Done = blocks.length > 0;
  const slotsByBlock = useMemo(() => {
    const m: Record<number, Slot[]> = {};
    slots.forEach((s) => { (m[s.BlockId] ||= []).push(s); });
    return m;
  }, [slots]);

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
        setSavedMix((m) => ({ ...m, [b.Id]: (data.items || []).length ? rows : [] }));
      } catch { /* leave unset — rows can still be added */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step1Done, blocks]);

  const rowsTotal = (rows: ParkingTemplateRow[] = []) => rows.reduce((s, r) => s + (parseInt(r.Count, 10) || 0), 0);
  const rowsValue = (rows: ParkingTemplateRow[] = []) => rows.reduce((s, r) => s + (parseInt(r.Count, 10) || 0) * num(r.Charge), 0);
  const templateTotal = (blockId: number) => rowsTotal(parkingTemplates[blockId]);
  const templateValue = (blockId: number) => rowsValue(parkingTemplates[blockId]);
  // One row per type (a block holds one charge per type): a new row takes the first type not yet used.
  const unusedTypes = (blockId: number) => parkingTypes.filter((t) => !(parkingTemplates[blockId] || []).some((r) => r.ParkingType === t));
  const addTemplateRow = (blockId: number) =>
    setParkingTemplates((m) => ({ ...m, [blockId]: [...(m[blockId] || []), { ParkingType: unusedTypes(blockId)[0] ?? "", Count: "1", Charge: "", GstRate: "" }] }));
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
      setSavedMix((m) => ({ ...m, [blockId]: rows.map((r) => ({ ...r })) }));
      return true;
    } catch (e: any) {
      toast.error(translateError(e.message));
      return false;
    } finally {
      setSavingTemplateBlockId(null);
    }
  };

  // Additive: creates exactly the slots each mix still lacks, type by type (the server counts them, so this
  // matches the "+N to create" figure); existing slots are never touched. One block, or every block.
  const handleGenerate = async (blockId?: number) => {
    setGenerating(blockId ?? "all");
    try {
      const res = await fetchWithAuth(`${API}/generate-parking-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId), ...(blockId ? { BlockIds: [blockId] } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to generate parking slots");
      // After a save that added nothing (a charge, GST or a lowered count), stay quiet.
      if (data.createdCount === 0) { if (!blockId) toast.info("Nothing to create — every block already has the slots its mix asks for"); }
      else toast.success(`${plural(data.createdCount, "parking slot")} created — e.g. ${data.sample.slice(0, 3).join(", ")}`);
      refetchAll();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setGenerating(null);
    }
  };

  // Through Parking Slot Master's own endpoints — they enforce the booking / hold / allotment lock.
  const handleDeleteSlot = async (slot: Slot) => {
    if (!(await ask.confirm(`Delete parking slot "${slot.SlotNo}"?`, { okLabel: "Delete", danger: true }))) return;
    setSavingSlot(true);
    try {
      const res = await fetchWithAuth(`/api/parking-slot-master/${slot.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete parking slot");
      toast.success(data.message || "Parking slot deleted");
      setOpenSlotId(null);
      refetchAll();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingSlot(false);
    }
  };

  const handleSaveSlot = async (slot: Slot) => {
    if (!editingSlot) return;
    const slotNo = editingSlot.SlotNo.trim();
    if (!slotNo) { toast.error("Slot number is required"); return; }
    setSavingSlot(true);
    try {
      const res = await fetchWithAuth(`/api/parking-slot-master/${slot.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: slot.ProjectId, BlockId: slot.BlockId, SlotNo: slotNo, ParkingType: editingSlot.ParkingType, IsActive: slot.IsActive !== false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update parking slot");
      toast.success(data.message || "Parking slot updated");
      setEditingSlot(null);
      refetchAll();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingSlot(false);
    }
  };

  // ── Project totals ──
  const planned = blocks.reduce((s, b) => s + rowsTotal(savedMix[b.Id]), 0);
  const created = slots.length;
  // The server's count, per type (status.blocks[].ParkingSlotsToCreate) — the same figure create uses.
  const toCreate = blocks.reduce((s, b) => s + (b.ParkingSlotsToCreate || 0), 0);
  const value = blocks.reduce((s, b) => s + rowsValue(savedMix[b.Id]), 0);
  const stateCounts = slots.reduce((c, s) => ({ ...c, [slotStatus(s)]: c[slotStatus(s)] + 1 }), { ...COUNT0 });
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
      {projectId && slotsFailed && <Notice tone="error">{(slotsError as Error)?.message}</Notice>}

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
        <>
          <Section title="Parking, block by block" done={blocks.some((b) => b.ParkingSlotCount > 0)}
            note="One row per block. Open a block to set its mix (types, slots, charge, GST) and see its slots."
            right={rights.canCreate && toCreate > 0 && (
              <button onClick={() => handleGenerate()} disabled={generating !== null} className={`${KEY_INK} h-8 px-3`}>
                {generating === "all" ? "Creating…" : `Create all ${plural(toCreate, "parking slot")}`}
              </button>
            )}>
            <ParkingNamingPanel projectId={Number(projectId)} shortName={status.project?.ShortCode} blocks={blocks} canEdit={rights.canEdit} />

            {/* One row per block; one block open at a time below its row. */}
            <div className="overflow-x-auto thin-scroll text-sm" style={{ border: RULE }}>
              <div className={`${ROW} px-3 py-2`} style={{ borderBottom: RULE }}>
                <span className={LBL}>Block</span>
                <span className={LBL}>Mix</span>
                <span className={`${LBL} text-right`}>Slots</span>
                <span className={`${LBL} text-right`}>Free</span>
                <span className={`${LBL} text-right`}>On hold</span>
                <span className={`${LBL} text-right`}>Booked</span>
                <span className={`${LBL} text-right`}>Value</span>
                <span />
              </div>
              {blocks.map((b) => {
                const rows = parkingTemplates[b.Id] || [];
                const saved = savedMix[b.Id] || [];
                const blockSlots = slotsByBlock[b.Id] || [];
                const generatedCount = b.ParkingSlotCount || 0;
                const locked = !rights.canEdit || (generatedCount > 0 && editingTemplateFor !== b.Id);
                const total = templateTotal(b.Id);
                const pending = b.ParkingSlotsToCreate || 0;
                const isOpen = openBlockId === b.Id;
                const counts = blockSlots.reduce((c, sl) => ({ ...c, [slotStatus(sl)]: c[slotStatus(sl)] + 1 }), { ...COUNT0 });
                const openSlot = blockSlots.find((sl) => sl.Id === openSlotId) || null;
                const openLock = openSlot ? lockOf(openSlot) : null;
                const toggle = () => { setOpenBlockId(isOpen ? null : b.Id); setOpenSlotId(null); setEditingSlot(null); };
                return (
                  <React.Fragment key={b.Id}>
                  <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                    aria-expanded={isOpen}
                    className={`${ROW} px-3 py-2 cursor-pointer transition-colors ${isOpen ? "bg-primary/5" : "hover:bg-primary/5"}`} style={{ borderBottom: RULE_SOFT }}>
                    <span className="font-semibold whitespace-nowrap inline-flex items-center gap-1.5">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Block {b.BlockName}</span>
                    <span className="text-xs text-muted-foreground truncate" title={saved.map((r) => `${r.ParkingType} ${r.Count}`).join(" · ") || undefined}>
                      {saved.length ? saved.map((r) => `${r.ParkingType} ${r.Count}`).join(" · ") : <span className="italic">No mix yet</span>}
                    </span>
                    <span className={CELL_NUM}>{generatedCount}{rowsTotal(saved) ? <span className="text-muted-foreground"> / {rowsTotal(saved)}</span> : null}</span>
                    <span className={CELL_NUM}>{counts.Available || "—"}</span>
                    <span className={CELL_NUM}>{counts.OnHold || "—"}</span>
                    <span className={CELL_NUM}>{counts.Booked || "—"}</span>
                    <span className={`${CELL_NUM} whitespace-nowrap`} title={inr(rowsValue(saved))}>{rowsValue(saved) ? money(rowsValue(saved)) : "—"}</span>
                    <span className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {rights.canCreate && pending > 0 && saved.length > 0 ? (
                        <button onClick={() => handleGenerate(b.Id)} disabled={generating !== null} className={`${KEY_INK} h-7 px-2.5`}>
                          <Plus size={11} /> {generating === b.Id ? "Creating…" : `Create ${pending}`}
                        </button>
                      ) : !saved.length && rights.canEdit ? (
                        <button onClick={toggle} className={`${KEY_LINE} h-7 px-2.5`}>Set up</button>
                      ) : null}
                    </span>
                  </div>
                  {isOpen && (
                  <div className="bg-card" style={{ borderBottom: RULE }}>
                    {rights.canEdit && generatedCount > 0 && editingTemplateFor !== b.Id && (
                      <div className="px-3 pt-2.5 flex justify-end max-w-3xl">
                        <button onClick={() => setEditingTemplateFor(b.Id)} className={`${KEY_LINE} h-7 px-2.5`}><Pencil size={11} /> Edit mix</button>
                      </div>
                    )}
                    {/* ── The mix (kept narrow: a type reads next to its numbers) ── */}
                    <div className="px-3 py-2 overflow-x-auto thin-scroll max-w-3xl">
                      <table className="w-full text-xs min-w-[420px]">
                        <thead>
                          <tr style={{ borderBottom: RULE }}>
                            <th className={th}>Type</th>
                            <th className={`${th} !text-right w-16`}>Slots</th>
                            <th className={`${th} !text-right w-28`}>Charge / slot</th>
                            <th className={`${th} !text-right w-16`}>GST</th>
                            <th className={`${th} !text-right w-28`}>Value</th>
                            {!locked && <th className="w-6" />}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, idx) => {
                            const rowValue = (parseInt(row.Count, 10) || 0) * num(row.Charge);
                            return locked ? (
                              <tr key={idx} style={{ borderBottom: RULE_SOFT }}>
                                <td className="!px-2 !py-2">{row.ParkingType}</td>
                                <td className={`!px-2 !py-2 text-right ${NUM}`}>{row.Count}</td>
                                <td className={`!px-2 !py-2 text-right ${NUM}`}>{inrOrDash(row.Charge)}</td>
                                <td className={`!px-2 !py-2 text-right ${NUM}`}>{row.GstRate === "" ? "—" : `${row.GstRate}%`}</td>
                                <td className={`!px-2 !py-2 text-right ${NUM}`}>{rowValue ? inr(rowValue) : "—"}</td>
                              </tr>
                            ) : (
                              <tr key={idx} style={{ borderBottom: RULE_SOFT }}>
                                <td className="!px-1 !py-1.5">
                                  <select value={row.ParkingType} onChange={(e) => updateTemplateRow(b.Id, idx, { ParkingType: e.target.value })} className={`${SMALL_INP} max-w-[180px]`}>
                                    {parkingTypes.filter((t) => t === row.ParkingType || !rows.some((r) => r.ParkingType === t)).map((t) => <option key={t} value={t}>{t}</option>)}
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
                                <td className={`!px-2 !py-1.5 text-right ${NUM} text-muted-foreground`}>{rowValue ? inr(rowValue) : "—"}</td>
                                <td className="!px-1 !py-1.5 text-center">
                                  {rows.length > 1 && (
                                    <button onClick={() => removeTemplateRow(b.Id, idx)} aria-label="Remove type" className="text-muted-foreground hover:text-destructive"><X size={13} /></button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td className="!px-2 !pt-2">
                              {!locked && unusedTypes(b.Id).length > 0 && <button onClick={() => addTemplateRow(b.Id)} className={`${TEXT_LINK} inline-flex items-center gap-1`}><Plus size={11} /> Add a type</button>}
                            </td>
                            <td className={`!px-2 !pt-2 text-right font-semibold ${NUM}`}>{total}</td>
                            <td colSpan={2} />
                            <td className={`!px-2 !pt-2 text-right font-semibold ${NUM}`}>{templateValue(b.Id) ? inr(templateValue(b.Id)) : "—"}</td>
                            {!locked && <td />}
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {!locked && (
                      <div className="px-3 pb-3 space-y-2 max-w-3xl">
                        {generatedCount > 0 && (
                          <p className="text-xs text-muted-foreground">Saving creates the slots a raised count adds. Lowering a count doesn&apos;t remove slots already created — delete those on the map below.</p>
                        )}
                        <div className="flex justify-end gap-2">
                          {generatedCount > 0 && <button onClick={() => setEditingTemplateFor(null)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>}
                          {/* Saving a mix creates what it adds at once — a saved-but-not-created mix
                              looked like parking that "didn't show". */}
                          <button onClick={async () => {
                            if (!(await handleSaveTemplate(b.Id))) return;
                            setEditingTemplateFor(null);
                            if (rights.canCreate) await handleGenerate(b.Id); else refetchAll();
                          }} disabled={savingTemplateBlockId === b.Id || generating !== null} className={`${KEY_INK} h-8 px-3`}>
                            {savingTemplateBlockId === b.Id ? "Saving…" : generating === b.Id ? "Creating…" : rights.canCreate ? "Save & create slots" : "Save mix"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── The slots, as a map ── */}
                    {blockSlots.length > 0 && (
                      <div className="px-3 pb-3 pt-2.5 space-y-2" style={{ borderTop: RULE_SOFT }}>
                        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-10 gap-1.5">
                          {blockSlots.map((s) => (
                            <Tile key={s.Id} name={shortName(s.SlotNo)} status={slotStatus(s)} tag={null}
                              line={s.ParkingType || "—"} title={`${s.SlotNo}${s.LockBookingNo ? ` — ${s.LockBookingNo}` : ""}`}
                              onClick={() => { setOpenSlotId(openSlotId === s.Id ? null : s.Id); setEditingSlot(null); }} />
                          ))}
                        </div>

                        {openSlot && (
                          <div className="px-3 py-2.5 bg-card space-y-2" style={{ border: RULE }}>
                            {editingSlot ? (
                              <div className="flex flex-wrap items-end gap-2">
                                <label className="space-y-1 flex-1 min-w-[160px]">
                                  <span className={`block ${LBL}`}>Slot name</span>
                                  <input autoFocus value={editingSlot.SlotNo} onChange={(e) => setEditingSlot((x) => (x ? { ...x, SlotNo: e.target.value } : x))} className={`${SMALL_INP} ${NUM}`} />
                                </label>
                                <label className="space-y-1 w-36">
                                  <span className={`block ${LBL}`}>Type</span>
                                  <select value={editingSlot.ParkingType} onChange={(e) => setEditingSlot((x) => (x ? { ...x, ParkingType: e.target.value } : x))} className={SMALL_INP}>
                                    {parkingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </label>
                                <button onClick={() => handleSaveSlot(openSlot)} disabled={savingSlot} className={`${KEY_INK} h-8 px-3`}>{savingSlot ? "Saving…" : "Save"}</button>
                                <button onClick={() => setEditingSlot(null)} className={`${KEY_LINE} h-8 px-3`}>Cancel</button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-3">
                                <span className="text-sm"><span className={`${NUM} font-semibold`}>{openSlot.SlotNo}</span> <span className="text-muted-foreground">· {openSlot.ParkingType || "No type"}</span></span>
                                {openLock ? <SheetMark text={openLock.text} tone={openLock.tone} /> : <SheetMark text="Free" tone="done" />}
                                <span className="ml-auto flex items-center gap-1.5">
                                  {rights.canEdit && (
                                    <button onClick={() => setEditingSlot({ SlotNo: openSlot.SlotNo || "", ParkingType: openSlot.ParkingType || parkingTypes[0] || "" })}
                                      disabled={!!openLock || savingSlot} title={openLock ? "Booked or held — release it first" : undefined} className={`${KEY_LINE} h-7 px-2.5`}><Pencil size={11} /> Edit</button>
                                  )}
                                  {rights.canDelete && (
                                    <button onClick={() => handleDeleteSlot(openSlot)} disabled={!!openLock || savingSlot}
                                      title={openLock ? "Booked or held — release it first" : undefined} className={`${KEY_LINE} h-7 px-2.5 !text-destructive !border-destructive`}><Trash2 size={11} /> Delete</button>
                                  )}
                                  <button onClick={() => setOpenSlotId(null)} aria-label="Close" className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"><X size={13} /></button>
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        <Legend counts={counts} />
                      </div>
                    )}
                  </div>
                  )}
                  </React.Fragment>
                );
              })}
              {/* The project's totals. */}
              <div className={`${ROW} px-3 py-2.5 font-semibold`}>
                <span className={LBL}>Project</span>
                <span className="text-xs font-normal text-muted-foreground">{toCreate > 0 ? `${plural(toCreate, "slot")} still to create` : "Every saved mix is filled"}</span>
                <span className={CELL_NUM}>{created}<span className="text-muted-foreground font-normal"> / {planned}</span></span>
                <span className={CELL_NUM}>{stateCounts.Available}</span>
                <span className={CELL_NUM}>{stateCounts.OnHold}</span>
                <span className={CELL_NUM}>{stateCounts.Booked}</span>
                <span className={`${CELL_NUM} whitespace-nowrap`} title={inr(value)}>{money(value)}</span>
                <span />
              </div>
            </div>
            <Link to="/crm/setup/parking-slot-master" className={`${TEXT_LINK} inline-block text-muted-foreground`}>All slot details in Parking Slot Master</Link>
          </Section>
        </>
      )}
    </div>
  );
};

export default ParkingSetup;

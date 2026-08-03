import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Building2, Layers, Ruler, Car, CheckCircle2, Lock, ExternalLink, Pencil, X, ChevronDown, ChevronRight } from "lucide-react";
import CrmProjectAutoSetupParking from "./CrmProjectAutoSetupParking";

const API = "/api/crm/project-auto-setup";
const PROJECTS_API = "/api/unit-master/projects";
const DROPDOWN_API = "/api/business/dropdown";

type NamingScheme = "Alphabetical" | "Numeric" | "Custom";

// Same vocabulary as src/pages/followup/UnitMaster.tsx's own UNIT_TYPES, so a
// type picked here reads back identically once units land on that page.
const UNIT_TYPES = [
  "1 BHK", "1.5 BHK", "2 BHK", "2.5 BHK", "3 BHK", "3.5 BHK", "4 BHK", "4+ BHK",
  "Studio", "Villa", "Plot", "Commercial", "Other",
];

type TemplateRow = { UnitType: string; Count: string; AreaSqFt: string };

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

// A-Z, then AA, AB, ... for anything beyond 26 — same wrap-around scheme
// spreadsheet columns use, so it stays readable at any block count.
function alphabeticalName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Skips any candidate name already taken (case-insensitive) — so suggesting
// names for "Add More Blocks" never re-offers e.g. "A1" if a Block named
// "A1" (or "a1") already exists on this project, no matter how far it has to
// walk the sequence to find the next free one. Custom scheme has no
// generated candidates, so it's untouched (blank inputs either way).
function generateNames(count: number, scheme: NamingScheme, existingLower?: Set<string>): string[] {
  if (scheme === "Custom") return Array.from({ length: count }, () => "");
  const names: string[] = [];
  let i = 0;
  let guard = 0; // safety valve — never loop forever even in a pathological all-taken case
  while (names.length < count && guard < count + 10000) {
    guard++;
    const candidate = scheme === "Alphabetical" ? alphabeticalName(i) : String(i + 1);
    i++;
    if (existingLower && existingLower.has(candidate.toLowerCase())) continue;
    names.push(candidate);
  }
  return names;
}

// True if `name` collides (case-insensitive, trimmed) with an existing Block
// on this project, or with another name already sitting in the current
// in-progress add-batch (idx is excluded from the batch check so a field
// isn't flagged as colliding with itself).
function isDuplicateBlockName(name: string, idx: number, batch: string[], existingLower: Set<string>): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (existingLower.has(n)) return true;
  return batch.some((other, i) => i !== idx && other.trim().toLowerCase() === n);
}

const inputCls = "w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background";
const labelCls = "text-xs text-muted-foreground block mb-1";
const cardCls = "rounded-xl border border-border p-4 space-y-3";

// Consistent section header across the Blocks/Floors/Units cards — a small
// colored icon badge instead of a bare icon, so the three sections read as
// distinct, color-coded areas of one page rather than a numbered "Step 1/2/3"
// wizard (this is a resumable, all-editable dashboard now, not a strict
// linear flow — the label shouldn't pretend otherwise).
const SectionHeader: React.FC<{ icon: React.ElementType; colorClass: string; title: string; done?: boolean; right?: React.ReactNode }> =
  ({ icon: Icon, colorClass, title, done, right }) => (
    <div className="flex items-center gap-2">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon size={13} />
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
      {done && <CheckCircle2 size={13} className="text-green-600" />}
      {right}
    </div>
  );

const CrmProjectAutoSetup: React.FC = () => {
  const qc = useQueryClient();
  // Top-level toggle between this page's Block/Floor/Unit wizard and the
  // fully separate Parking Setup component (CrmProjectAutoSetupParking.tsx).
  // Plain in-memory state, not a route — switching tabs never reloads or
  // refetches anything on the other side, and Parking keeps its own
  // Project selection/state entirely, so nothing here is shared with it.
  const [activeTab, setActiveTab] = useState<"setup" | "parking">("setup");
  // Strict Company -> Project gate — a Project can only be picked once its
  // Company is chosen, matching the same cascade now enforced in
  // BlockMaster.tsx/UnitMaster.tsx/ParkingMaster.tsx/ParkingSlotMaster.tsx.
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [blockCount, setBlockCount] = useState("2");
  const [namingScheme, setNamingScheme] = useState<NamingScheme>("Alphabetical");
  const [blockNames, setBlockNames] = useState<string[]>(generateNames(2, "Alphabetical"));
  const [floorCounts, setFloorCounts] = useState<Record<number, string>>({});
  const [savingBlocks, setSavingBlocks] = useState(false);
  const [savingFloors, setSavingFloors] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editingBlockName, setEditingBlockName] = useState("");
  // The "Add More Blocks" form only opens on demand once Blocks already
  // exist — always-open was cluttering the card with a full form nobody
  // was using yet. Starts open for a brand-new project (nothing to add
  // "more" to) and auto-collapses again after a successful add.
  const [showAddBlockForm, setShowAddBlockForm] = useState(false);
  // Rename/delete on Blocks and Floors are locked behind an explicit "Edit"
  // toggle rather than always live on hover — someone just visiting to see
  // the project plan shouldn't be greeted by pencils and × buttons on every
  // chip; editing is a deliberate mode you step into and back out of.
  const [blocksEditMode, setBlocksEditMode] = useState(false);
  const [floorsEditMode, setFloorsEditMode] = useState(false);
  // The Block→Floor→Unit drill-down tree appears in FOUR separate places on
  // this page (the always-on overview card, the Blocks section, the Floor
  // Plan section, and Unit Types & Generation) — each needs its OWN
  // "which floor is expanded" state. Sharing one variable across all four
  // (the original bug) meant clicking a floor in any one place also
  // silently expanded that same floor in every other place using it.
  // floorUnits/loadingUnitsFloorId stay shared — that's just a fetched-data
  // cache, safe to reuse regardless of which section triggered the fetch.
  const [expandedFloorId, setExpandedFloorId] = useState<number | null>(null); // Unit Types & Generation
  const [overviewExpandedFloorId, setOverviewExpandedFloorId] = useState<number | null>(null);
  const [blocksExpandedFloorId, setBlocksExpandedFloorId] = useState<number | null>(null);
  const [floorPlanExpandedFloorId, setFloorPlanExpandedFloorId] = useState<number | null>(null);
  const [floorUnits, setFloorUnits] = useState<Record<number, any[]>>({});
  const [loadingUnitsFloorId, setLoadingUnitsFloorId] = useState<number | null>(null);
  // Per-block Unit Type template (e.g. 2x 2BHK + 2x 3BHK) — applies to every
  // non-Ground floor in that block instead of typing a count for each one.
  const [templates, setTemplates] = useState<Record<number, TemplateRow[]>>({});
  const [savingTemplateBlockId, setSavingTemplateBlockId] = useState<number | null>(null);
  const [applyingTemplateBlockId, setApplyingTemplateBlockId] = useState<number | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [editingUnit, setEditingUnit] = useState<{ UnitName: string; UnitType: string; AreaSqFt: string } | null>(null);
  const [savingUnitId, setSavingUnitId] = useState<number | null>(null);
  // Non-Ground floors render as a compact one-line summary by default — this
  // tracks which single floor is currently expanded into its editable count
  // input, same click-to-reveal pattern used for the Block chips above.
  const [editingFloorId, setEditingFloorId] = useState<number | null>(null);
  // Step 2 (Floors) now mirrors Step 1 (Blocks): a block that already has
  // floors shows a collapsed, tree-style chip summary instead of the raw
  // count input sitting open forever — this is the fix for "still showing
  // Generate option" after floors already exist. The input only opens by
  // default for a block with zero floors (nothing to summarize yet) or once
  // the user explicitly asks to add more via this toggle.
  const [floorFormOpenFor, setFloorFormOpenFor] = useState<Record<number, boolean>>({});
  // Collapsed by default per block — the always-on structure tree and the
  // Blocks section each get their own independent copy of this (same
  // "shared state expands everything at once" reasoning as the floor state
  // above), so expanding a block in one doesn't also expand it in the other.
  const [treeExpandedBlocks, setTreeExpandedBlocks] = useState<Record<number, boolean>>({});
  const [blocksExpandedBlocks, setBlocksExpandedBlocks] = useState<Record<number, boolean>>({});
  // Step 3 (Units) gets the same collapse-when-done treatment as Steps 1 & 2:
  // once every eligible floor in a block has real Units generated, the
  // template editor + per-floor controls collapse into a locked summary row
  // instead of staying open with nothing left to do. This re-opens it
  // on demand (e.g. to prep the template before adding more floors later).
  const [unitTemplateOpenFor, setUnitTemplateOpenFor] = useState<Record<number, boolean>>({});

  const { data: companies = [] } = useQuery({ queryKey: ["business-dropdown-companies"], queryFn: fetchCompanies, staleTime: 5 * 60_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const projectsForCompany = useMemo(
    () => (companyId ? (projects as any[]).filter((p: any) => String(p.CompanyId) === companyId) : []),
    [projects, companyId],
  );
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["crm-auto-project-setup-status", projectId],
    queryFn: () => fetchStatus(projectId),
    enabled: !!projectId,
  });

  const refetchStatus = () => qc.invalidateQueries({ queryKey: ["crm-auto-project-setup-status", projectId] });
  const invalidateSyncedMasters = () => {
    qc.invalidateQueries({ queryKey: ["unit-master"] });
    qc.invalidateQueries({ queryKey: ["block-master"] });
    qc.invalidateQueries({ queryKey: ["parking-master"] });
    qc.invalidateQueries({ queryKey: ["crm-unit-matrix"] });
    qc.invalidateQueries({ queryKey: ["crm-parking-matrix"] });
    qc.invalidateQueries({ queryKey: ["crm-payment-plans"] });
  };

  const blocksForNames: any[] = status?.blocks || [];
  const existingBlockNamesLower = useMemo(
    () => new Set(blocksForNames.map((b) => String(b.BlockName).trim().toLowerCase())),
    [blocksForNames],
  );

  // Regenerate the "add more blocks" name inputs whenever count/scheme/
  // existing-blocks changes, always skipping names already taken on this
  // project (see generateNames) so the suggestion never collides with what's
  // already there. This form is always available (adding blocks to a
  // project that already has some is just another POST /blocks call), so
  // it's no longer gated on whether Blocks already exist.
  useEffect(() => {
    const n = Math.max(1, Math.min(100, parseInt(blockCount, 10) || 0));
    setBlockNames(generateNames(n, namingScheme, existingBlockNamesLower));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockCount, namingScheme, status?.project?.Id, existingBlockNamesLower]);

  const blocks: any[] = status?.blocks || [];
  const floors: any[] = status?.floors || [];
  const floorsByBlock = useMemo(() => {
    const map = new Map<number, any[]>();
    floors.forEach((f) => {
      if (!map.has(f.BlockId)) map.set(f.BlockId, []);
      map.get(f.BlockId)!.push(f);
    });
    return map;
  }, [floors]);

  // Seed each block's floor-count field with its CURRENT floor count the
  // first time it's seen, so extending an already-set-up block (e.g. adding
  // 2 more floors to a 10-floor block) starts from what's really there
  // instead of a blank field the user would have to recompute by hand.
  // Never overwrites a value the user is already editing.
  useEffect(() => {
    if (!blocks.length) return;
    setFloorCounts((prev) => {
      let changed = false;
      const next = { ...prev };
      blocks.forEach((b) => {
        if (next[b.Id] === undefined) {
          const current = (floorsByBlock.get(b.Id) || []).length;
          next[b.Id] = current > 0 ? String(current) : "";
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [blocks, floorsByBlock]);

  const step1Done = blocks.length > 0;
  const step2Done = floors.length > 0;

  // Lazily fetches each block's Unit Type template the first time Step 3
  // becomes visible for it — defaults to one blank row (2 BHK) so there's
  // always something to edit rather than an empty state with no way in.
  useEffect(() => {
    if (!step2Done) return;
    blocks.forEach(async (b) => {
      if (templates[b.Id] !== undefined) return;
      try {
        const r = await fetchWithAuth(`${API}/blocks/${b.Id}/unit-template`);
        const data = r.ok ? await r.json() : { items: [] };
        const rows: TemplateRow[] = (data.items || []).length
          ? data.items.map((it: any) => ({ UnitType: it.UnitType, Count: String(it.Count), AreaSqFt: it.AreaSqFt != null ? String(it.AreaSqFt) : "" }))
          : [{ UnitType: "2 BHK", Count: "1", AreaSqFt: "" }];
        setTemplates((m) => ({ ...m, [b.Id]: rows }));
      } catch { /* leave unset — user can still add rows manually */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step2Done, blocks]);

  const handleSaveBlocks = async () => {
    if (!projectId) { toast.error("Select a project"); return; }
    if (blockNames.some((n) => !n.trim())) { toast.error("Every block name is required"); return; }
    // Client-side mirror of the server's case-insensitive uniqueness rule —
    // catches it before a round trip, both against Blocks that already
    // exist on this project AND against another name in this same batch.
    const dupeIdx = blockNames.findIndex((n, i) => isDuplicateBlockName(n, i, blockNames, existingBlockNamesLower));
    if (dupeIdx !== -1) { toast.error(`Block "${blockNames[dupeIdx].trim()}" already exists — choose a different name.`); return; }
    setSavingBlocks(true);
    try {
      const res = await fetchWithAuth(`${API}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId), Names: blockNames }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save blocks");
      toast.success(`${data.blocks.length} block(s) created`);
      // Reset the "add more" form so it's ready for another batch instead of
      // still showing the names that were just consumed, and collapse it —
      // the user just finished adding, no need to keep the form open.
      setBlockNames(generateNames(Math.max(1, Math.min(100, parseInt(blockCount, 10) || 1)), namingScheme));
      setShowAddBlockForm(false);
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingBlocks(false);
    }
  };

  // Only sends blocks with a valid, filled-in count — so extending just one
  // block's floors doesn't require re-confirming every other block's
  // already-correct count first. POST /floors is additive/idempotent on the
  // backend, so re-sending an unchanged count for an already-set-up block is
  // always a safe no-op.
  const handleSaveFloors = async () => {
    const payload = blocks
      .map((b) => ({ BlockId: b.Id, FloorCount: parseInt(floorCounts[b.Id] || "", 10) }))
      .filter((p) => Number.isFinite(p.FloorCount) && p.FloorCount >= 1);
    if (!payload.length) { toast.error("Enter a floor count for at least one block"); return; }
    setSavingFloors(true);
    try {
      const res = await fetchWithAuth(`${API}/floors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId), Blocks: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save floors");
      toast.success("Floors generated");
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingFloors(false);
    }
  };

  const handleFloorFieldSave = async (floor: any, patch: { UnitCount?: number; HasUnits?: boolean }) => {
    try {
      const res = await fetchWithAuth(`${API}/floors/${floor.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update floor");
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRenameBlock = async (b: any) => {
    const name = editingBlockName.trim();
    if (!name || name === b.BlockName) { setEditingBlockId(null); return; }
    const collides = blocks.some((other) => other.Id !== b.Id && String(other.BlockName).trim().toLowerCase() === name.toLowerCase());
    if (collides) { toast.error(`Block "${name}" already exists in this Project.`); return; }
    try {
      const res = await fetchWithAuth(`${API}/blocks/${b.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BlockName: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to rename block");
      toast.success("Block renamed");
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEditingBlockId(null);
    }
  };

  // Backend refuses (409, with a reason like "has 3 active unit(s) under
  // it") whenever a child still exists — see getBlockLockReason in
  // crmHierarchyLocks.js — surfaced here as a toast, same pattern as
  // booking/hold errors elsewhere in this app.
  const handleDeleteBlock = async (b: any) => {
    if (!window.confirm(`Delete block "${b.BlockName}"?`)) return;
    try {
      const res = await fetchWithAuth(`${API}/blocks/${b.Id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete block");
      toast.success(data.message || "Block deleted");
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDeleteFloor = async (f: any) => {
    if (!window.confirm(`Delete floor "${f.FloorLabel}"?`)) return;
    try {
      const res = await fetchWithAuth(`${API}/floors/${f.Id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete floor");
      toast.success(data.message || "Floor deleted");
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Shared by all four independent "which floor is expanded" states below —
  // takes the current value + its own setter so each call site's toggle
  // only ever touches its own state, never any other section's.
  const toggleFloorGeneric = async (f: any, current: number | null, setCurrent: (v: number | null) => void) => {
    if (current === f.Id) { setCurrent(null); return; }
    setCurrent(f.Id);
    if (floorUnits[f.Id]) return;
    setLoadingUnitsFloorId(f.Id);
    try {
      const res = await fetchWithAuth(`${API}/floors/${f.Id}/units`);
      const data = await res.json();
      if (res.ok) setFloorUnits((m) => ({ ...m, [f.Id]: data.units }));
    } finally {
      setLoadingUnitsFloorId(null);
    }
  };
  const handleToggleExpandFloor = (f: any) => toggleFloorGeneric(f, expandedFloorId, setExpandedFloorId); // Unit Types & Generation
  const handleToggleOverviewFloor = (f: any) => toggleFloorGeneric(f, overviewExpandedFloorId, setOverviewExpandedFloorId);
  const handleToggleBlocksFloor = (f: any) => toggleFloorGeneric(f, blocksExpandedFloorId, setBlocksExpandedFloorId);
  const handleToggleFloorPlanFloor = (f: any) => toggleFloorGeneric(f, floorPlanExpandedFloorId, setFloorPlanExpandedFloorId);

  // Deletes straight through the existing Unit Master endpoint — it already
  // enforces the (now Application-aware) Unit-level lock check, so nothing
  // is duplicated here.
  const handleDeleteUnit = async (floorId: number, unit: any) => {
    if (!window.confirm(`Delete unit "${unit.UnitName}"?`)) return;
    try {
      const res = await fetchWithAuth(`/api/unit-master/${unit.Id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete unit");
      toast.success(data.message || "Unit deleted");
      setFloorUnits((m) => ({ ...m, [floorId]: (m[floorId] || []).filter((u) => u.Id !== unit.Id) }));
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const startEditUnit = (unit: any) => {
    setEditingUnitId(unit.Id);
    setEditingUnit({
      UnitName: unit.UnitName || "",
      UnitType: unit.UnitType || "2 BHK",
      AreaSqFt: unit.AreaSqFt != null ? String(unit.AreaSqFt) : "",
    });
  };

  const handleSaveUnit = async (floorId: number, unit: any) => {
    if (!editingUnit) return;
    const unitName = editingUnit.UnitName.trim();
    if (!unitName) { toast.error("Unit name is required"); return; }
    setSavingUnitId(unit.Id);
    try {
      const res = await fetchWithAuth(`/api/unit-master/${unit.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: unit.ProjectId,
          BlockId: unit.BlockId,
          UnitName: unitName,
          FloorNo: unit.FloorNo,
          UnitType: editingUnit.UnitType || null,
          AreaSqFt: editingUnit.AreaSqFt || null,
          IsActive: unit.IsActive !== false,
          PaymentPlanIds: unit.PaymentPlanIds ? String(unit.PaymentPlanIds).split(",").map((x) => parseInt(x, 10)).filter(Number.isFinite) : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update unit");
      toast.success(data.message || "Unit updated");
      setFloorUnits((m) => ({
        ...m,
        [floorId]: (m[floorId] || []).map((u) => u.Id === unit.Id
          ? { ...u, UnitName: unitName, UnitType: editingUnit.UnitType, AreaSqFt: editingUnit.AreaSqFt || null }
          : u),
      }));
      setEditingUnitId(null);
      setEditingUnit(null);
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingUnitId(null);
    }
  };

  const templateTotal = (blockId: number) => (templates[blockId] || []).reduce((s, r) => s + (parseInt(r.Count, 10) || 0), 0);

  const addTemplateRow = (blockId: number) =>
    setTemplates((m) => ({ ...m, [blockId]: [...(m[blockId] || []), { UnitType: "2 BHK", Count: "1", AreaSqFt: "" }] }));
  const removeTemplateRow = (blockId: number, idx: number) =>
    setTemplates((m) => ({ ...m, [blockId]: (m[blockId] || []).filter((_, i) => i !== idx) }));
  const updateTemplateRow = (blockId: number, idx: number, patch: Partial<TemplateRow>) =>
    setTemplates((m) => ({ ...m, [blockId]: (m[blockId] || []).map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));

  const handleSaveTemplate = async (blockId: number) => {
    const rows = templates[blockId] || [];
    if (!rows.length) { toast.error("Add at least one Unit Type row"); return; }
    if (rows.some((r) => !r.UnitType || !parseInt(r.Count, 10))) { toast.error("Every row needs a Unit Type and a Count of at least 1"); return; }
    setSavingTemplateBlockId(blockId);
    try {
      const res = await fetchWithAuth(`${API}/blocks/${blockId}/unit-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Items: rows.map((r) => ({ UnitType: r.UnitType, Count: r.Count, AreaSqFt: r.AreaSqFt || null })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save template");
      toast.success(`Template saved — ${data.total} units/floor`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingTemplateBlockId(null);
    }
  };

  const handleApplyTemplate = async (blockId: number) => {
    setApplyingTemplateBlockId(blockId);
    try {
      const res = await fetchWithAuth(`${API}/blocks/${blockId}/unit-template/apply`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply template");
      toast.success(`Applied to ${data.updatedCount} floor(s) — ${data.total} units each`);
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setApplyingTemplateBlockId(null);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`${API}/generate-units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate units");
      if (data.createdCount === 0) {
        toast.info("No eligible floors to generate — set a unit count on at least one floor first");
      } else {
        toast.success(`${data.createdCount} unit(s) created — e.g. ${data.sample.slice(0, 3).join(", ")}`);
      }
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Auto Project Setup"
      subtitle="Pick a Project, then generate its Blocks, Floors, and Units in one guided flow instead of one-row-at-a-time forms"
    >
      <div className="space-y-4">
        {/* Plain in-page toggle — no route change, so switching tabs never
            reloads or refetches anything. Parking is a fully separate
            component with its own Project selector/state (see
            CrmProjectAutoSetupParking.tsx); nothing below is shared with
            it, so a slow request or stale render on one side can never
            affect the other. */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setActiveTab("setup")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              activeTab === "setup" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Building2 size={14} /> Block / Floor / Unit Setup
          </button>
          <button
            onClick={() => setActiveTab("parking")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              activeTab === "parking" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Car size={14} /> Parking Setup
          </button>
        </div>

        {activeTab === "parking" ? (
          <CrmProjectAutoSetupParking />
        ) : (
        <>
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

        {projectId && status && !status.shortCodeValid && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            This project has no valid Short Name set (letters/numbers only) — set one in Project Master first, it becomes the first segment of every generated unit name (e.g. RYG/A/1001).
          </div>
        )}

        {/* Flags the exact class of gap that caused a real mix-up once
            before: active Units under this project with no Floor at all
            can't show up in the tree below, so this surfaces them instead
            of silently doing nothing about them. */}
        {projectId && status && status.legacyUnitCount > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-600">
            {status.legacyUnitCount} unit{status.legacyUnitCount === 1 ? "" : "s"} on this project {status.legacyUnitCount === 1 ? "has" : "have"} no Floor assigned and won't appear in the tree below — resolve them in <a href="/crm/setup/unit-master" className="underline">Unit Master</a> (assign a floor, or deactivate if they're stale/duplicate data) before relying on this page as the full picture.
          </div>
        )}

        {projectId && status && (
          <>
            {/* Always-on structure tree — a resumable, at-a-glance view of
                exactly where this project stands (Project > Block > Floor >
                Units), built straight from `status` so it's never stale
                relative to what the step cards below show. This is what a
                person should be able to glance at instead of having to
                infer progress from which form happens to be open — the
                step cards below still do the actual editing, but a
                completed Block/Floor/Unit no longer needs a "Generate"-
                shaped form left open to prove it exists. */}
            {blocks.length > 0 && (() => {
              const totalFloors = floors.length;
              const totalUnitsGenerated = floors.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
              const pendingFloorCount = floors.filter((f) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0).length;
              return (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="p-4 pb-3 flex items-center gap-2 border-b border-border bg-muted/20">
                    <Building2 size={16} className="text-primary shrink-0" />
                    <span className="text-sm font-semibold truncate">{status.project?.Name}</span>
                  </div>
                  {/* Stat strip — the at-a-glance numbers a person actually
                      scans for first, ahead of the per-block detail below. */}
                  <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
                    {[
                      { label: "Blocks", value: blocks.length },
                      { label: "Floors", value: totalFloors },
                      { label: "Units generated", value: totalUnitsGenerated },
                      { label: "Floors pending", value: pendingFloorCount, accent: pendingFloorCount > 0 },
                    ].map((stat) => (
                      <div key={stat.label} className="px-4 py-2.5 text-center">
                        <div className={`text-lg font-semibold ${stat.accent ? "text-amber-600" : "text-foreground"}`}>{stat.value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="p-2">
                    {blocks.map((b) => {
                      const blockFloors = floorsByBlock.get(b.Id) || [];
                      const totalUnits = blockFloors.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
                      const pendingFloors = blockFloors.filter((f) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0);
                      const isExpanded = !!treeExpandedBlocks[b.Id];
                      // What's still pending for this block, in plain words,
                      // so resuming mid-setup never needs guesswork about
                      // which step comes next.
                      const pendingLabel = !blockFloors.length
                        ? "Set up floors"
                        : pendingFloors.length
                          ? `Generate units on ${pendingFloors.length} floor${pendingFloors.length === 1 ? "" : "s"}`
                          : null;
                      return (
                        <div key={b.Id} className="text-xs rounded-lg hover:bg-muted/30">
                          {/* Same 4-column layout as the stat-strip header
                              above (Name | Floors | Units | Status), so this
                              row actually fills the row's width with real
                              data instead of one left-aligned label and a
                              badge stranded far to the right. */}
                          <button onClick={() => setTreeExpandedBlocks((m) => ({ ...m, [b.Id]: !isExpanded }))}
                            className="w-full grid grid-cols-4 items-center gap-2 px-2 py-1.5 text-left">
                            <span className="flex items-center gap-2 min-w-0">
                              {isExpanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                              <span className="font-medium truncate">{b.BlockName}</span>
                            </span>
                            <span className="text-muted-foreground">{blockFloors.length} floor{blockFloors.length === 1 ? "" : "s"}</span>
                            <span className="text-muted-foreground">{totalUnits} unit{totalUnits === 1 ? "" : "s"} generated</span>
                            <span>
                              {pendingLabel ? (
                                <span className="text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full">{pendingLabel}</span>
                              ) : blockFloors.length > 0 ? (
                                <span className="inline-flex items-center gap-1 text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">
                                  <CheckCircle2 size={11} /> Done
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="ml-6 pl-3 border-l border-border pb-1.5">
                              <BlockFloorTree
                                blockFloors={blockFloors}
                                expandedFloorId={overviewExpandedFloorId}
                                onToggleFloor={handleToggleOverviewFloor}
                                floorUnits={floorUnits}
                                loadingUnitsFloorId={loadingUnitsFloorId}
                                editingUnitId={editingUnitId}
                                editingUnit={editingUnit}
                                savingUnitId={savingUnitId}
                                onStartEditUnit={startEditUnit}
                                onEditUnitChange={(patch) => setEditingUnit((u) => u ? { ...u, ...patch } : u)}
                                onCancelEditUnit={() => { setEditingUnitId(null); setEditingUnit(null); }}
                                onSaveUnit={handleSaveUnit}
                                onDeleteUnit={handleDeleteUnit}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Step 1 — Blocks. Collapsed state is a single dense row —
                header, chips, and the add-affordance all inline — instead
                of stacked sections, since at rest there's nothing here but
                a handful of short labels. */}
            <div className={`${cardCls} border-l-2 border-l-violet-500`}>
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center bg-violet-500/10 text-violet-600">
                    <Building2 size={13} />
                  </span>
                  <h3 className="text-sm font-semibold">Blocks</h3>
                  {step1Done && <CheckCircle2 size={13} className="text-green-600" />}
                </div>

                {/* Locked, plain-label chips by default — someone just here
                    to see the project plan gets a calm, read-only list, not
                    a row of pencils/× (backend still refuses delete with a
                    clear reason if anything exists underneath it — see
                    getBlockLockReason). Rename/delete only appear once
                    blocksEditMode is switched on via the toggle below. */}
                {blocks.map((b) => (
                  <span key={b.Id} className={`flex items-center gap-1 text-[11px] pl-2 pr-1.5 py-0.5 rounded-full font-medium ${blocksEditMode ? "bg-muted/70 border border-border" : "bg-muted/40"}`}>
                    {editingBlockId === b.Id ? (
                      <input autoFocus type="text" value={editingBlockName}
                        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                        name={`block-rename-${b.Id}`}
                        onChange={(e) => setEditingBlockName(e.target.value)}
                        onBlur={() => handleRenameBlock(b)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleRenameBlock(b); if (e.key === "Escape") setEditingBlockId(null); }}
                        className="w-14 bg-transparent border-b border-primary outline-none" />
                    ) : blocksEditMode ? (
                      <>
                        <span>{b.BlockName}</span>
                        <button onClick={() => { setEditingBlockId(b.Id); setEditingBlockName(b.BlockName); }}
                          className="text-muted-foreground hover:text-primary">
                          <Pencil size={9} />
                        </button>
                        <button onClick={() => handleDeleteBlock(b)}
                          className="text-muted-foreground hover:text-red-600">
                          <X size={10} />
                        </button>
                      </>
                    ) : (
                      // View mode — clicking a Block name drills into its
                      // Floors (and from there, into real Units), same tree
                      // interaction as the overview card above — but with
                      // its own independent expand state (blocksExpandedBlocks),
                      // so expanding it here doesn't also expand it up there.
                      <button onClick={() => setBlocksExpandedBlocks((m) => ({ ...m, [b.Id]: !m[b.Id] }))}
                        className="flex items-center gap-1 hover:text-primary">
                        {blocksExpandedBlocks[b.Id] ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                        {b.BlockName}
                      </button>
                    )}
                  </span>
                ))}

                {step1Done && (
                  <button onClick={() => { setBlocksEditMode((v) => !v); setEditingBlockId(null); }}
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${blocksEditMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground border border-border"}`}>
                    {blocksEditMode ? "Done" : "Edit"}
                  </button>
                )}

                {/* "Add More Blocks" only opens on demand — a collapsed
                    project already has its blocks; there's no reason to keep
                    a whole create-form permanently open underneath them. A
                    brand-new project (nothing to add "more" to yet) shows
                    the form open by default instead of an empty collapsed
                    card. */}
                {step1Done && !showAddBlockForm && (
                  <button onClick={() => setShowAddBlockForm(true)}
                    className="text-[11px] text-primary hover:underline">
                    + Add
                  </button>
                )}
              </div>

              {/* Expanded Block(s) — its Floor tree, drilling further into
                  real Units per Floor, same as clicking through the
                  overview card above. */}
              {blocks.filter((b) => blocksExpandedBlocks[b.Id]).map((b) => (
                <div key={b.Id} className="rounded-lg border border-border/50 p-2 text-xs">
                  <div className="font-medium mb-1">{b.BlockName}</div>
                  <BlockFloorTree
                    blockFloors={floorsByBlock.get(b.Id) || []}
                    expandedFloorId={blocksExpandedFloorId}
                    onToggleFloor={handleToggleBlocksFloor}
                    floorUnits={floorUnits}
                    loadingUnitsFloorId={loadingUnitsFloorId}
                    editingUnitId={editingUnitId}
                    editingUnit={editingUnit}
                    savingUnitId={savingUnitId}
                    onStartEditUnit={startEditUnit}
                    onEditUnitChange={(patch) => setEditingUnit((u) => u ? { ...u, ...patch } : u)}
                    onCancelEditUnit={() => { setEditingUnitId(null); setEditingUnit(null); }}
                    onSaveUnit={handleSaveUnit}
                    onDeleteUnit={handleDeleteUnit}
                  />
                </div>
              ))}

              {(!step1Done || showAddBlockForm) && (
                <div className={step1Done ? "pt-2 mt-2 border-t border-border space-y-3" : "space-y-3"}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-foreground">{step1Done ? "Add More Blocks" : "Create Blocks"}</div>
                    {step1Done && (
                      <button onClick={() => setShowAddBlockForm(false)} className="text-xs text-muted-foreground hover:text-foreground">
                        Cancel
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Number of Blocks</label>
                      <input type="number" min={1} max={100} value={blockCount}
                        onChange={(e) => setBlockCount(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Naming Scheme</label>
                      <div className="flex items-center gap-3 h-[34px]">
                        {(["Alphabetical", "Numeric", "Custom"] as NamingScheme[]).map((s) => (
                          <label key={s} className="flex items-center gap-1 text-xs cursor-pointer">
                            <input type="radio" checked={namingScheme === s} onChange={() => setNamingScheme(s)} /> {s}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {blockNames.map((name, i) => {
                      const dupe = isDuplicateBlockName(name, i, blockNames, existingBlockNamesLower);
                      return (
                        <div key={i}>
                          <input type="text" value={name} placeholder={`Block ${i + 1}`}
                            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                            name={`block-name-${i}-${projectId || "new"}`}
                            onChange={(e) => setBlockNames((arr) => arr.map((v, idx) => idx === i ? e.target.value : v))}
                            className={`${inputCls} ${dupe ? "border-destructive text-destructive" : ""}`} />
                          {dupe && <div className="text-[10px] text-destructive mt-0.5">Already exists</div>}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={handleSaveBlocks} disabled={savingBlocks || blockNames.some((n, i) => isDuplicateBlockName(n, i, blockNames, existingBlockNamesLower))}
                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                    {step1Done ? "Add Blocks" : "OK — Create Blocks"}
                  </button>
                </div>
              )}
            </div>

            {/* Step 2 — Floors. Every block's floor count stays editable —
                prefilled with what's already there, so bumping a 10-floor
                block up to 12 is just changing one number, not starting
                over. Submitting an unchanged count for an already-set-up
                block is always a safe no-op (POST /floors only ever adds
                what's missing). */}
            {step1Done && (
              <div className={`${cardCls} border-l-2 border-l-cyan-500`}>
                <SectionHeader icon={Layers} colorClass="bg-cyan-500/10 text-cyan-600" title="Floor Plan" done={step2Done} right={
                  step2Done && (
                    <button onClick={() => setFloorsEditMode((v) => !v)}
                      className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-medium ${floorsEditMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground border border-border"}`}>
                      {floorsEditMode ? "Done" : "Edit"}
                    </button>
                  )
                } />

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                  {blocks.map((b) => {
                    const blockFloors = floorsByBlock.get(b.Id) || [];
                    const hasFloors = blockFloors.length > 0;
                    // Open by default when there's nothing to summarize yet;
                    // otherwise only open once the user explicitly asks for
                    // more via the toggle below.
                    const isOpen = !hasFloors || !!floorFormOpenFor[b.Id];
                    return (
                      <div key={b.Id} className="rounded-lg border border-border/50 p-2">
                        {hasFloors && !isOpen ? (
                          // Collapsed tree row — this is the state a
                          // completed block sits in, instead of the input
                          // staying open forever.
                          <div>
                            <div className="flex items-center flex-wrap gap-1.5">
                              <span className="text-xs font-medium w-20 shrink-0 flex items-center gap-1">
                                {b.BlockName} <CheckCircle2 size={11} className="text-green-600" />
                              </span>
                              <div className="flex flex-wrap items-center gap-1">
                                {blockFloors.map((f) => (
                                  <span key={f.Id} className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded text-muted-foreground ${floorsEditMode ? "bg-muted/70" : "bg-muted/40"}`}>
                                    {/* Generated floors are clickable in view
                                        mode — same drill-into-Units tree as
                                        the overview card/Blocks section. */}
                                    {!floorsEditMode && f.IsGenerated ? (
                                      <button onClick={() => handleToggleFloorPlanFloor(f)} className="hover:text-primary">{f.FloorLabel}</button>
                                    ) : (
                                      <span>{f.FloorLabel}</span>
                                    )}
                                    {floorsEditMode && (
                                      <button onClick={() => handleDeleteFloor(f)} className="hover:text-red-600">
                                        <X size={9} />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                              <button onClick={() => setFloorFormOpenFor((m) => ({ ...m, [b.Id]: true }))}
                                className="text-[11px] text-primary hover:underline ml-auto">
                                + Add more floors
                              </button>
                            </div>
                            {(() => {
                              const expandedFloor = blockFloors.find((f) => f.Id === floorPlanExpandedFloorId);
                              return expandedFloor ? (
                                <FloorUnitList
                                  floorId={expandedFloor.Id}
                                  units={floorUnits[expandedFloor.Id]}
                                  loading={loadingUnitsFloorId === expandedFloor.Id}
                                  editingUnitId={editingUnitId}
                                  editingUnit={editingUnit}
                                  savingUnitId={savingUnitId}
                                  onStartEdit={startEditUnit}
                                  onEditChange={(patch) => setEditingUnit((u) => u ? { ...u, ...patch } : u)}
                                  onCancelEdit={() => { setEditingUnitId(null); setEditingUnit(null); }}
                                  onSave={handleSaveUnit}
                                  onDelete={handleDeleteUnit}
                                />
                              ) : null;
                            })()}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-medium w-20 shrink-0">{b.BlockName}</span>
                              <input type="number" min={1} max={100} placeholder="Number of floors"
                                value={floorCounts[b.Id] || ""}
                                onChange={(e) => setFloorCounts((m) => ({ ...m, [b.Id]: e.target.value }))}
                                className={inputCls} />
                              {hasFloors && (
                                <button onClick={() => setFloorFormOpenFor((m) => ({ ...m, [b.Id]: false }))}
                                  className="text-xs text-muted-foreground hover:text-foreground shrink-0">
                                  Cancel
                                </button>
                              )}
                            </div>
                            {hasFloors && (
                              <div className="flex flex-wrap items-center gap-1 pl-[92px]">
                                {blockFloors.map((f) => (
                                  <span key={f.Id} className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded text-muted-foreground ${floorsEditMode ? "bg-muted/70" : "bg-muted/40"}`}>
                                    {!floorsEditMode && f.IsGenerated ? (
                                      <button onClick={() => handleToggleFloorPlanFloor(f)} className="hover:text-primary">{f.FloorLabel}</button>
                                    ) : (
                                      <span>{f.FloorLabel}</span>
                                    )}
                                    {floorsEditMode && (
                                      <button onClick={() => handleDeleteFloor(f)} className="hover:text-red-600">
                                        <X size={9} />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                            {(() => {
                              const expandedFloor = blockFloors.find((f) => f.Id === floorPlanExpandedFloorId);
                              return expandedFloor ? (
                                <FloorUnitList
                                  floorId={expandedFloor.Id}
                                  units={floorUnits[expandedFloor.Id]}
                                  loading={loadingUnitsFloorId === expandedFloor.Id}
                                  editingUnitId={editingUnitId}
                                  editingUnit={editingUnit}
                                  savingUnitId={savingUnitId}
                                  onStartEdit={startEditUnit}
                                  onEditChange={(patch) => setEditingUnit((u) => u ? { ...u, ...patch } : u)}
                                  onCancelEdit={() => { setEditingUnitId(null); setEditingUnit(null); }}
                                  onSave={handleSaveUnit}
                                  onDelete={handleDeleteUnit}
                                />
                              ) : null;
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {blocks.some((b) => !(floorsByBlock.get(b.Id) || []).length || floorFormOpenFor[b.Id]) && (
                  <button onClick={async () => { await handleSaveFloors(); setFloorFormOpenFor({}); }} disabled={savingFloors}
                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                    {step2Done ? "Add Floors" : "OK — Generate Floors"}
                  </button>
                )}
              </div>
            )}

            {/* Unit Types & Generation */}
            {step2Done && (
              <div className={`${cardCls} border-l-2 border-l-amber-500`}>
                <SectionHeader icon={Ruler} colorClass="bg-amber-500/10 text-amber-600" title="Unit Types & Generation" />

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {blocks.map((b) => {
                    const rows = templates[b.Id] || [];
                    const nonGroundFloors = (floorsByBlock.get(b.Id) || []).filter((f) => f.FloorNo !== 0);
                    const groundFloor = (floorsByBlock.get(b.Id) || []).find((f) => f.FloorNo === 0);

                    // Anything left this block could still generate right
                    // now — mirrors the backend's own eligibility check
                    // (IsGenerated=0, HasUnits=1, UnitCount>0).
                    // Fully done: at least one non-Ground floor exists and
                    // every one of them (plus Ground, if it's marked
                    // sellable) is already generated.
                    const blockFullyGenerated = nonGroundFloors.length > 0
                      && nonGroundFloors.every((f) => f.IsGenerated)
                      && (!groundFloor || groundFloor.IsGenerated || !groundFloor.HasUnits);
                    const totalGeneratedUnits = (floorsByBlock.get(b.Id) || []).reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);

                    return (
                      <div key={b.Id} className="rounded-lg border border-border/60 p-3 space-y-2">
                        {blockFullyGenerated && !unitTemplateOpenFor[b.Id] ? (
                          // Locked summary row — nothing pending here, so the
                          // template editor and per-floor forms stay closed
                          // instead of sitting open with nothing left to do.
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold flex items-center gap-1">
                                {b.BlockName} <CheckCircle2 size={12} className="text-green-600" />
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {totalGeneratedUnits} unit{totalGeneratedUnits === 1 ? "" : "s"} generated
                              </span>
                              <button onClick={() => setUnitTemplateOpenFor((m) => ({ ...m, [b.Id]: true }))}
                                className="text-[11px] text-primary hover:underline ml-auto">
                                Manage template / units
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {groundFloor && (
                                <button onClick={() => handleToggleExpandFloor(groundFloor)}
                                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded bg-muted/40">
                                  {expandedFloorId === groundFloor.Id ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                  <Lock size={9} /> Ground: {groundFloor.GeneratedUnitCount || 0}
                                </button>
                              )}
                              {nonGroundFloors.map((f) => (
                                <button key={f.Id} onClick={() => handleToggleExpandFloor(f)}
                                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded bg-muted/40">
                                  {expandedFloorId === f.Id ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                  <Lock size={9} /> {f.FloorLabel}: {f.GeneratedUnitCount}
                                </button>
                              ))}
                            </div>
                            {[groundFloor, ...nonGroundFloors].filter(Boolean).map((f: any) => expandedFloorId === f.Id && (
                              <FloorUnitList
                                key={f.Id}
                                floorId={f.Id}
                                units={floorUnits[f.Id]}
                                loading={loadingUnitsFloorId === f.Id}
                                editingUnitId={editingUnitId}
                                editingUnit={editingUnit}
                                savingUnitId={savingUnitId}
                                onStartEdit={startEditUnit}
                                onEditChange={(patch) => setEditingUnit((u) => u ? { ...u, ...patch } : u)}
                                onCancelEdit={() => { setEditingUnitId(null); setEditingUnit(null); }}
                                onSave={handleSaveUnit}
                                onDelete={handleDeleteUnit}
                              />
                            ))}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold">{b.BlockName}</span>
                              {blockFullyGenerated && (
                                <button onClick={() => setUnitTemplateOpenFor((m) => ({ ...m, [b.Id]: false }))}
                                  className="text-[11px] text-muted-foreground hover:text-foreground ml-auto">
                                  Collapse
                                </button>
                              )}
                            </div>

                        {/* Unit Type template — defined ONCE per block, then
                            applied to every non-Ground floor in one click.
                            A floor whose count is later customized away from
                            this total still gets typed by cycling through
                            this same sequence (see getBlockUnitSequence). */}
                        <div className="space-y-1.5">
                          {rows.map((row, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <select value={row.UnitType} onChange={(e) => updateTemplateRow(b.Id, idx, { UnitType: e.target.value })}
                                className={`${inputCls} !py-1 flex-1`}>
                                {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <input type="number" min={1} max={100} placeholder="Count" value={row.Count}
                                onChange={(e) => updateTemplateRow(b.Id, idx, { Count: e.target.value })}
                                className={`${inputCls} !py-1 !w-20`} />
                              <input type="number" min={0} placeholder="Area (sqft)" value={row.AreaSqFt}
                                onChange={(e) => updateTemplateRow(b.Id, idx, { AreaSqFt: e.target.value })}
                                className={`${inputCls} !py-1 !w-28`} />
                              <button onClick={() => removeTemplateRow(b.Id, idx)} className="text-muted-foreground hover:text-red-600 shrink-0">
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center gap-2">
                            <button onClick={() => addTemplateRow(b.Id)} className="text-xs text-primary hover:underline">+ Add Type</button>
                            <span className="text-[11px] text-muted-foreground ml-auto">Total: {templateTotal(b.Id)} unit(s)/floor</span>
                            <button onClick={() => handleSaveTemplate(b.Id)} disabled={savingTemplateBlockId === b.Id}
                              className="px-2.5 py-1 text-[11px] bg-muted rounded-lg font-medium hover:bg-muted/70 disabled:opacity-40">
                              Save Template
                            </button>
                            <button onClick={() => handleApplyTemplate(b.Id)} disabled={applyingTemplateBlockId === b.Id || !templateTotal(b.Id)}
                              className="px-2.5 py-1 text-[11px] bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                              Apply to Floors
                            </button>
                          </div>
                        </div>

                        {/* Ground floor stays its own explicit row — never
                            covered by the block template above. */}
                        {groundFloor && (
                          <div className="pt-1 border-t border-border/60">
                            {groundFloor.IsGenerated ? (
                              <button onClick={() => handleToggleExpandFloor(groundFloor)}
                                className="text-xs text-muted-foreground flex items-center gap-1 hover:text-primary">
                                {expandedFloorId === groundFloor.Id ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                <Lock size={10} /> Ground: {groundFloor.GeneratedUnitCount} unit(s) generated — click to manage
                              </button>
                            ) : (
                              <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                                <input type="checkbox" checked={!!groundFloor.HasUnits}
                                  onChange={(e) => handleFloorFieldSave(groundFloor, { HasUnits: e.target.checked, UnitCount: e.target.checked ? (groundFloor.UnitCount || 0) : 0 })} />
                                <span className="text-muted-foreground">This block's ground floor has sellable units</span>
                                {groundFloor.HasUnits && (
                                  <input type="number" min={0} max={500} value={groundFloor.UnitCount}
                                    onChange={(e) => handleFloorFieldSave(groundFloor, { UnitCount: parseInt(e.target.value, 10) || 0, HasUnits: true })}
                                    className={`${inputCls} !w-20 !py-1`} />
                                )}
                              </label>
                            )}
                            {expandedFloorId === groundFloor.Id && (
                              <FloorUnitList
                                floorId={groundFloor.Id}
                                units={floorUnits[groundFloor.Id]}
                                loading={loadingUnitsFloorId === groundFloor.Id}
                                editingUnitId={editingUnitId}
                                editingUnit={editingUnit}
                                savingUnitId={savingUnitId}
                                onStartEdit={startEditUnit}
                                onEditChange={(patch) => setEditingUnit((u) => u ? { ...u, ...patch } : u)}
                                onCancelEdit={() => { setEditingUnitId(null); setEditingUnit(null); }}
                                onSave={handleSaveUnit}
                                onDelete={handleDeleteUnit}
                              />
                            )}
                          </div>
                        )}

                        {/* Non-Ground floors — compact one-liner by default
                            (generated by the template above); a pencil
                            reveals the editable count for a real exception. */}
                        {nonGroundFloors.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1 border-t border-border/60">
                            {nonGroundFloors.map((f) => (
                              <div key={f.Id} className="text-xs">
                                {f.IsGenerated ? (
                                  <button onClick={() => handleToggleExpandFloor(f)}
                                    className="flex items-center gap-1 text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded bg-muted/40">
                                    {expandedFloorId === f.Id ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                    <Lock size={9} /> {f.FloorLabel}: {f.GeneratedUnitCount}
                                  </button>
                                ) : editingFloorId === f.Id ? (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/40">
                                    {f.FloorLabel}:
                                    <input autoFocus type="number" min={0} max={500} value={f.UnitCount}
                                      onChange={(e) => handleFloorFieldSave(f, { UnitCount: parseInt(e.target.value, 10) || 0 })}
                                      onBlur={() => setEditingFloorId(null)}
                                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingFloorId(null); }}
                                      className="w-14 bg-transparent border-b border-primary outline-none" />
                                  </span>
                                ) : (
                                  <button onClick={() => setEditingFloorId(f.Id)}
                                    className="group flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/40 hover:bg-muted/70">
                                    <span>{f.FloorLabel}: {f.UnitCount}</span>
                                    <Pencil size={8} className="opacity-0 group-hover:opacity-60" />
                                  </button>
                                )}
                                {expandedFloorId === f.Id && (
                                  <FloorUnitList
                                    floorId={f.Id}
                                    units={floorUnits[f.Id]}
                                    loading={loadingUnitsFloorId === f.Id}
                                    editingUnitId={editingUnitId}
                                    editingUnit={editingUnit}
                                    savingUnitId={savingUnitId}
                                    onStartEdit={startEditUnit}
                                    onEditChange={(patch) => setEditingUnit((u) => u ? { ...u, ...patch } : u)}
                                    onCancelEdit={() => { setEditingUnitId(null); setEditingUnit(null); }}
                                    onSave={handleSaveUnit}
                                    onDelete={handleDeleteUnit}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* The commit button only shows up when something is
                    actually eligible to generate anywhere on this project —
                    otherwise it's just an invitation to re-click into the
                    same "No eligible floors" toast with nothing to act on. */}
                {blocks.some((b) => {
                  const bf = floorsByBlock.get(b.Id) || [];
                  const ng = bf.filter((f) => f.FloorNo !== 0);
                  const g = bf.find((f) => f.FloorNo === 0);
                  return ng.some((f) => !f.IsGenerated && f.UnitCount > 0) || (!!g && !g.IsGenerated && !!g.HasUnits && g.UnitCount > 0);
                }) && (
                  <button onClick={handleGenerate} disabled={generating}
                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                    Generate Units
                  </button>
                )}
              </div>
            )}
          </>
        )}
        </>
        )}
      </div>
    </SalesAutoShell>
  );
};

// Shared expanded-unit list for a generated floor (Ground or otherwise) —
// real UnitMaster rows, each deletable straight through the existing Unit
// Master endpoint (already enforces the booking/hold/Application lock).
// Deleting every unit here is what then lets the Floor itself be deleted
// in Step 2 above.
// A Block's Floor list, each generated Floor clickable to drill down into
// its real Units (via FloorUnitList) — the same tree interaction reused in
// three places: the always-on overview card, the Blocks section, and the
// Floor Plan section, so clicking a Block or Floor name behaves identically
// everywhere it appears instead of only working in one spot.
const BlockFloorTree: React.FC<{
  blockFloors: any[];
  expandedFloorId: number | null;
  onToggleFloor: (f: any) => void;
  floorUnits: Record<number, any[]>;
  loadingUnitsFloorId: number | null;
  editingUnitId: number | null;
  editingUnit: { UnitName: string; UnitType: string; AreaSqFt: string } | null;
  savingUnitId: number | null;
  onStartEditUnit: (unit: any) => void;
  onEditUnitChange: (patch: Partial<{ UnitName: string; UnitType: string; AreaSqFt: string }>) => void;
  onCancelEditUnit: () => void;
  onSaveUnit: (floorId: number, unit: any) => void;
  onDeleteUnit: (floorId: number, unit: any) => void;
}> = ({ blockFloors, expandedFloorId, onToggleFloor, floorUnits, loadingUnitsFloorId, editingUnitId, editingUnit, savingUnitId, onStartEditUnit, onEditUnitChange, onCancelEditUnit, onSaveUnit, onDeleteUnit }) => (
  <div className="space-y-0.5">
    {blockFloors.length === 0 ? (
      <div className="text-muted-foreground py-0.5">No floors yet.</div>
    ) : (
      blockFloors.map((f) => (
        <div key={f.Id}>
          {f.IsGenerated ? (
            <button onClick={() => onToggleFloor(f)}
              className="w-full flex items-center gap-1.5 py-0.5 text-left hover:text-primary">
              {expandedFloorId === f.Id ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />}
              <Layers size={10} className="text-muted-foreground shrink-0" />
              <span className="shrink-0">Floor {f.FloorLabel}</span>
              <span className="text-muted-foreground flex items-center gap-1">
                <Lock size={9} /> {f.GeneratedUnitCount} unit{f.GeneratedUnitCount === 1 ? "" : "s"} generated
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 py-0.5 pl-[15px]">
              <Layers size={10} className="text-muted-foreground shrink-0" />
              <span className="shrink-0">Floor {f.FloorLabel}</span>
              {f.HasUnits && f.UnitCount > 0 ? (
                <span className="text-amber-600">{f.UnitCount} unit{f.UnitCount === 1 ? "" : "s"} planned — not generated yet</span>
              ) : (
                <span className="text-muted-foreground">no units planned</span>
              )}
            </div>
          )}
          {expandedFloorId === f.Id && (
            <FloorUnitList
              floorId={f.Id}
              units={floorUnits[f.Id]}
              loading={loadingUnitsFloorId === f.Id}
              editingUnitId={editingUnitId}
              editingUnit={editingUnit}
              savingUnitId={savingUnitId}
              onStartEdit={onStartEditUnit}
              onEditChange={onEditUnitChange}
              onCancelEdit={onCancelEditUnit}
              onSave={onSaveUnit}
              onDelete={onDeleteUnit}
            />
          )}
        </div>
      ))
    )}
  </div>
);

const FloorUnitList: React.FC<{
  floorId: number;
  units: any[] | undefined;
  loading: boolean;
  editingUnitId: number | null;
  editingUnit: { UnitName: string; UnitType: string; AreaSqFt: string } | null;
  savingUnitId: number | null;
  onStartEdit: (unit: any) => void;
  onEditChange: (patch: Partial<{ UnitName: string; UnitType: string; AreaSqFt: string }>) => void;
  onCancelEdit: () => void;
  onSave: (floorId: number, unit: any) => void;
  onDelete: (floorId: number, unit: any) => void;
}> = ({ floorId, units, loading, editingUnitId, editingUnit, savingUnitId, onStartEdit, onEditChange, onCancelEdit, onSave, onDelete }) => {
  // Tapping a unit expands it into a small detail panel (status + real
  // Edit/Delete buttons) instead of always showing a bare pencil/× stranded
  // at the far edge of the row. Local to this floor's list — each floor
  // tracks its own expanded unit independently.
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);

  return (
    <div className="ml-4 mt-1 border-l border-border pl-3">
      {loading ? (
        <div className="text-[11px] text-muted-foreground py-1">Loading...</div>
      ) : (units || []).length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-1">No units left on this floor.</div>
      ) : (
        // A responsive card grid instead of one full-width row per unit —
        // uses the available width on a wide screen instead of a single
        // narrow column with a name on the left and buttons stranded far
        // off to the right.
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 py-1">
          {(units || []).map((u) => {
            const lockReason = u.LockBookingNo ? `Booked — ${u.LockBookingNo}`
              : u.LockHoldId ? "On hold"
              : u.LockApplicationNo ? `Applied — ${u.LockApplicationNo}`
              : null;
            const isEditing = editingUnitId === u.Id && editingUnit;
            const isExpanded = expandedUnitId === u.Id;
            const dotColor = u.LockBookingNo ? "bg-red-500" : u.LockHoldId ? "bg-amber-500" : u.LockApplicationNo ? "bg-amber-500" : "bg-green-500";

            if (isEditing) {
              return (
                <div key={u.Id} className="col-span-2 sm:col-span-3 lg:col-span-4 rounded-lg border border-primary/40 bg-muted/20 p-2 space-y-1.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    <input autoFocus value={editingUnit.UnitName}
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                      name={`unit-name-${u.Id}`}
                      onChange={(e) => onEditChange({ UnitName: e.target.value })}
                      placeholder="Unit name"
                      className="h-7 rounded border border-border bg-background px-2 text-[11px] font-mono outline-none focus:border-primary" />
                    <select value={editingUnit.UnitType}
                      onChange={(e) => onEditChange({ UnitType: e.target.value })}
                      className="h-7 rounded border border-border bg-background px-1 text-[11px] outline-none focus:border-primary">
                      {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input value={editingUnit.AreaSqFt} type="number" min={0} placeholder="Area (sqft)"
                      onChange={(e) => onEditChange({ AreaSqFt: e.target.value })}
                      className="h-7 rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-primary" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={onCancelEdit} className="text-[11px] px-2 py-1 rounded text-muted-foreground hover:text-foreground">Cancel</button>
                    <button onClick={() => onSave(floorId, u)} disabled={savingUnitId === u.Id}
                      className="text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-40">
                      Save
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={u.Id}
                className={`rounded-lg border p-2 text-[11px] cursor-pointer transition-colors ${isExpanded ? "border-primary/50 bg-primary/5" : "border-border/60 bg-muted/20 hover:bg-muted/40"}`}
                onClick={() => setExpandedUnitId(isExpanded ? null : u.Id)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono font-semibold truncate">{u.UnitName}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} title={lockReason || "Available"} />
                </div>
                <div className="text-muted-foreground truncate">
                  {u.UnitType || "No type set"}{u.AreaSqFt ? ` · ${u.AreaSqFt} sqft` : ""}
                </div>

                {isExpanded && (
                  <div onClick={(e) => e.stopPropagation()} className="mt-1.5 pt-1.5 border-t border-border/60 space-y-1.5">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Status:</span>
                      {lockReason ? (
                        <span className="text-amber-600 flex items-center gap-0.5"><Lock size={9} /> {lockReason}</span>
                      ) : (
                        <span className="text-green-600">Available</span>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => onStartEdit(u)} disabled={!!lockReason}
                        className="text-primary hover:underline disabled:opacity-40 disabled:no-underline">Edit</button>
                      <button onClick={() => onDelete(floorId, u)} disabled={!!lockReason}
                        className="text-red-600 hover:underline disabled:opacity-40 disabled:no-underline">Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <a href="/crm/setup/unit-master" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
        edit details in Unit Master <ExternalLink size={9} />
      </a>
    </div>
  );
};

export default CrmProjectAutoSetup;
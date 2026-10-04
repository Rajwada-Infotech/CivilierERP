import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateRoomData } from "@/lib/roomQueries";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Building2, Layers, Ruler, Car, CheckCircle2, Lock, ExternalLink, Pencil, X, ChevronDown, ChevronRight, Map as MapIcon } from "lucide-react";
import CrmProjectAutoSetupParking from "./CrmProjectAutoSetupParking";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NamingPanel } from "./autoSetup/NamingPanel";
import { getLayoutTypes, unitTypeOptions, LAYOUT_TYPES_QUERY_KEY, type LayoutType } from "@/api/unitBhkConfigApi";

const API = "/api/crm/project-auto-setup";
const PROJECTS_API = "/api/unit-master/projects";
const DROPDOWN_API = "/api/business/dropdown";
const EMPTY_ITEMS: any[] = [];

type NamingScheme = "Alphabetical" | "Numeric" | "Custom";

// Unit Types come from Unit Composition (dbo.RoomLayoutType) — only types
// with a defined room layout are offered for a new pick (see unitTypeOptions),
// since every generated unit's rooms are built from its layout.
function firstPickableType(types: LayoutType[]): string {
  return types.find((t) => t.roomCount > 0)?.label ?? "";
}

type TemplateRow = { UnitType: string; Count: string; AreaSqFt: string; CarpetAreaSqFt: string; BuiltUpAreaSqFt: string; SuperBuiltUpAreaSqFt: string; OpenTerraceAreaSqFt: string; RatePerSqFt: string };
type PaymentPlan = { Id: number; PlanName: string; IsActive: boolean };
type UnitEdit = { UnitName: string; FloorNo: string; UnitType: string; AreaSqFt: string; CarpetAreaSqFt: string; BuiltUpAreaSqFt: string; SuperBuiltUpAreaSqFt: string; OpenTerraceAreaSqFt: string; RatePerSqFt: string };

async function fetchApplicablePlans(projectId: string): Promise<PaymentPlan[]> {
  try {
    const r = await fetchWithAuth(`/api/unit-master/applicable-payment-plans?projectId=${projectId}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

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

// Field/label/card styles shared with the rest of the app's forms (uppercase
// tracked labels, soft muted inputs, card surfaces).
const inputCls = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-muted/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/40 transition-colors";
const labelCls = "text-[0.6875rem] uppercase tracking-widest font-heading text-muted-foreground block mb-1.5";
const cardCls = "rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm";
// Touch-friendly pill used for blocks / floors / units chips.
const chipCls = "inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors";

// Consistent section header across the Blocks/Floors/Units cards — a coloured
// icon badge plus a one-line hint, so each section says what it is for. The
// sections stay independently editable (a resumable dashboard, not a strict
// wizard).
const SectionHeader: React.FC<{ icon: React.ElementType; colorClass: string; title: string; hint?: string; done?: boolean; right?: React.ReactNode }> =
  ({ icon: Icon, colorClass, title, hint, done, right }) => (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm sm:text-base font-heading font-semibold flex items-center gap-1.5">
          {title}
          {done && (
            <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={11} /> Done
            </span>
          )}
        </h3>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {right && <div className="flex items-center gap-2 ml-auto">{right}</div>}
    </div>
  );

// Blocks → Floors → Units progress, so it's obvious at a glance which part of
// the setup is complete and what comes next.
const SetupProgress: React.FC<{ steps: { label: string; detail: string; done: boolean; active: boolean }[] }> = ({ steps }) => (
  <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2">
    {steps.map((s, i) => (
      <li
        key={s.label}
        className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
          s.done
            ? "border-green-500/30 bg-green-500/5"
            : s.active
              ? "border-sky-500/40 bg-sky-500/5 ring-1 ring-sky-500/20"
              : "border-border bg-card"
        }`}
      >
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
            s.done ? "bg-green-500 text-white" : s.active ? "btn-module text-white" : "bg-muted text-muted-foreground"
          }`}
        >
          {s.done ? <CheckCircle2 size={16} /> : i + 1}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-heading font-semibold">{s.label}</div>
          <div className="text-xs text-muted-foreground truncate">{s.detail}</div>
        </div>
      </li>
    ))}
  </ol>
);


// ── Plot Layout (plotted projects) ──────────────────────────────────────────
// The floor-driven step above cannot describe a plotted block: there are no
// floors to hang units off. This is its counterpart — one template per BLOCK,
// because in a plotted development the block IS the layout.
//
// The sizes here SEED the generated plots; they are not a claim that every plot
// is identical. Real layouts have plots of differing sizes, each with its own
// area, dimensions, facing and survey number, edited per plot afterwards.
// Generating uniform plots and refining them beats hand-creating sixty rows.
const PlotLayoutStep: React.FC<{
  blocks: any[];
  projectTypeName?: string;
  canEdit: boolean;
  canCreate: boolean;
  onChanged: () => void;
}> = ({ blocks, projectTypeName, canEdit, canCreate, onChanged }) => {
  const [drafts, setDrafts] = useState<Record<number, any>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const draftFor = (b: any) => {
    const t = b.PlotTemplate;
    return (
      drafts[b.Id] ?? {
        PlotCount: t?.PlotCount ?? "",
        NumberPrefix: t?.NumberPrefix ?? "P-",
        StartNumber: t?.StartNumber ?? 1,
        DefaultAreaSqFt: t?.DefaultAreaSqFt ?? "",
        DefaultRatePerSqFt: t?.DefaultRatePerSqFt ?? "",
        DefaultFacing: t?.DefaultFacing ?? "",
        DefaultRoadWidthFt: t?.DefaultRoadWidthFt ?? "",
      }
    );
  };
  const patch = (id: number, p: any) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftFor(blocks.find((b) => b.Id === id)), ...p } }));

  const save = async (b: any) => {
    const d = draftFor(b);
    if (!d.PlotCount) { toast.error("How many plots?"); return; }
    setBusy(b.Id);
    try {
      const r = await fetchWithAuth(`${API}/blocks/${b.Id}/plot-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not save the plot layout");
      toast.success(`Plot layout saved for ${b.BlockName}`);
      onChanged();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const generate = async (b: any) => {
    setBusy(b.Id);
    try {
      const r = await fetchWithAuth(`${API}/generate-plots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BlockId: b.Id }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Could not generate plots");
      // Skipped names are reported rather than swallowed: a partially generated
      // block is completed without anyone wondering why the count is short.
      toast.success(
        `${body.created} plot(s) created in ${b.BlockName}` +
          (body.skipped?.length ? ` — ${body.skipped.length} already existed` : ""),
      );
      onChanged();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  return (
    <div className={`${cardCls} border-l-2 border-l-emerald-500`}>
      <SectionHeader
        icon={Ruler}
        colorClass="bg-emerald-500/10 text-emerald-600"
        title="Plot Layout"
        done={blocks.some((b) => b.PlotTemplate?.IsGenerated)}
      />
      <p className="text-[0.6875rem] text-muted-foreground -mt-1">
        {projectTypeName ? `${projectTypeName} — no floors. ` : ""}
        Plots are laid out per block. These sizes seed every plot; adjust each
        plot&apos;s own area, dimensions, facing and survey number afterwards in Plot Master.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {blocks.map((b) => {
          const d = draftFor(b);
          const t = b.PlotTemplate;
          const generated = !!t?.IsGenerated;
          const working = busy === b.Id;
          const f = (label: string, key: string, type = "number", placeholder = "") => (
            <div>
              <label className="block text-[0.625rem] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</label>
              <input
                type={type}
                value={d[key] ?? ""}
                placeholder={placeholder}
                disabled={generated || !canEdit || working}
                onChange={(e) => patch(b.Id, { [key]: e.target.value })}
                className="w-full h-8 text-xs border border-border rounded-lg px-2 bg-background disabled:opacity-50"
              />
            </div>
          );
          // Plots entered or imported directly in Plot Master: nothing to lay out here.
          if (t?.FromPlotMaster) return (
            <div key={b.Id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{b.BlockName}</span>
                <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">{t.PlotsCreated} plot(s) in Plot Master</span>
              </div>
              <p className="text-xs text-muted-foreground">These plots were entered in Plot Master, each with its own number and area. Edit them there.</p>
            </div>
          );
          return (
            <div key={b.Id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{b.BlockName}</span>
                {generated ? (
                  <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                    {t.PlotsCreated} plot(s) created
                  </span>
                ) : (
                  <span className="text-[0.6875rem] text-muted-foreground">not laid out yet</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {f("Plots", "PlotCount")}
                {f("Prefix", "NumberPrefix", "text", "P-")}
                {f("Start No.", "StartNumber")}
                {f("Area (sq ft)", "DefaultAreaSqFt")}
                {f("Rate / sq ft", "DefaultRatePerSqFt")}
                {f("Road (ft)", "DefaultRoadWidthFt")}
                <div className="col-span-3">
                  {f("Facing", "DefaultFacing", "text", "e.g. North")}
                </div>
              </div>

              {!generated && (
                <div className="flex justify-end gap-2 pt-1">
                  {canEdit && (
                    <button onClick={() => save(b)} disabled={working}
                      className="px-3 h-8 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40">
                      {working ? "Saving…" : "Save layout"}
                    </button>
                  )}
                  {canCreate && t && (
                    <button onClick={() => generate(b)} disabled={working}
                      className="px-3 h-8 text-xs bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-40">
                      {working ? "Generating…" : `Generate ${t.PlotCount} plot(s)`}
                    </button>
                  )}
                </div>
              )}
              {generated && (
                <p className="text-[0.6875rem] text-muted-foreground">
                  Generated. Manage this land inventory in Plot Master. Regenerating here is blocked so the layout cannot be doubled.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Plot Block Expand Row ───────────────────────────────────────────────────
// Wraps PlotBlockBrowser with its own expand/collapse toggle. Exists as a
// separate component (not inlined into .map()) because React requires hooks
// to be called unconditionally at the top level of a component — calling
// useState inside a map callback violates the Rules of Hooks.
const PlotBlockExpandRow: React.FC<{
  block: any;
  onChanged: () => void;
}> = ({ block, onChanged }) => {
  const [open, setOpen] = useState(false);
  const tpl = block.PlotTemplate;
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
      >
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <span className="text-xs font-medium flex-1">{block.BlockName}</span>
        {tpl && (
          <span className="text-[0.6875rem] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium shrink-0">
            {tpl.PlotsCreated ?? tpl.PlotCount} plot(s)
          </span>
        )}
      </button>
      {open && (
        <PlotBlockBrowser
          blockId={block.Id}
          blockName={block.BlockName}
          onDeleteUnit={() => onChanged()}
        />
      )}
    </div>
  );
};

// ── Plot Block Browser ──────────────────────────────────────────────────────
// Shows the generated plots for a plotted block in a card grid — the same
// "browse what was generated" experience that BlockFloorTree + FloorUnitList
// provides for floored projects. Fetches on first mount via the new
// GET /blocks/:blockId/plots endpoint (no FloorId exists for plots).
type PlotUnit = {
  Id: number; UnitName: string; PlotNo?: string; AreaSqFt?: number; RatePerSqFt?: number;
  Facing?: string; RoadWidthFt?: number; IsActive: boolean; UnitKind: string;
  LockBookingNo?: string; LockHoldId?: string; LockApplicationNo?: string;
};
const PlotBlockBrowser: React.FC<{
  blockId: number;
  blockName: string;
  onDeleteUnit: (unit: PlotUnit) => void;
}> = ({ blockId, blockName, onDeleteUnit }) => {
  const [plots, setPlots] = useState<PlotUnit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (plots !== null) return;
    setLoading(true);
    fetchWithAuth(`${API}/blocks/${blockId}/plots`)
      .then((r) => r.ok ? r.json() : { plots: [] })
      .then((data) => setPlots(data.plots || []))
      .catch(() => setPlots([]))
      .finally(() => setLoading(false));
  }, [blockId, plots]);

  const handleDelete = async (u: PlotUnit) => {
    if (!window.confirm(`Delete plot "${u.UnitName}"?`)) return;
    setDeletingId(u.Id);
    try {
      const res = await fetchWithAuth(`${API}/plots/${u.Id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete plot");
      toast.success(data.message || "Plot deleted");
      setPlots((ps) => (ps || []).filter((p) => p.Id !== u.Id));
      onDeleteUnit(u);
    } catch (e: any) { toast.error(e.message); } finally { setDeletingId(null); }
  };

  return (
    <div className="ml-6 pl-3 border-l border-border pb-1.5">
      {loading ? (
        <div className="text-[0.6875rem] text-muted-foreground py-1">Loading plots…</div>
      ) : !plots?.length ? (
        <div className="text-[0.6875rem] text-muted-foreground py-1">No plots found — try refreshing.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 py-1">
          {plots.map((u) => {
            const lockReason = u.LockBookingNo ? `Booked — ${u.LockBookingNo}`
              : u.LockHoldId ? "On hold"
              : u.LockApplicationNo ? `Applied — ${u.LockApplicationNo}`
              : null;
            const isExpanded = expandedId === u.Id;
            const dotColor = u.LockBookingNo ? "bg-red-500" : u.LockHoldId ? "bg-sky-500" : u.LockApplicationNo ? "bg-sky-500" : "bg-green-500";
            return (
              <div key={u.Id}
                className={`rounded-lg border p-2 text-[0.6875rem] cursor-pointer transition-colors ${isExpanded ? "border-emerald-500/50 bg-emerald-500/5" : "border-border/60 bg-muted/20 hover:bg-muted/40"}`}
                onClick={() => setExpandedId(isExpanded ? null : u.Id)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono font-semibold truncate">{u.UnitName}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} title={lockReason || "Available"} />
                </div>
                <div className="text-muted-foreground truncate">
                  {u.AreaSqFt ? `${u.AreaSqFt} sq ft` : "—"}
                  {u.RatePerSqFt ? ` · ₹${Number(u.RatePerSqFt).toLocaleString("en-IN")}/sqft` : ""}
                  {u.Facing ? ` · ${u.Facing}` : ""}
                </div>
                {isExpanded && (
                  <div onClick={(e) => e.stopPropagation()} className="mt-1.5 pt-1.5 border-t border-border/60 space-y-1.5">
                    {u.RoadWidthFt && <div className="text-muted-foreground">Road: {u.RoadWidthFt} ft</div>}
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Status:</span>
                      {lockReason ? (
                        <span className="text-sky-600 flex items-center gap-0.5"><Lock size={9} /> {lockReason}</span>
                      ) : (
                        <span className="text-green-600">Available</span>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <a href="/crm/setup/plot-master" className="text-primary hover:underline">Open Plot Master</a>
                      <button onClick={() => handleDelete(u)} disabled={!!lockReason || deletingId === u.Id}
                        className="text-red-600 hover:underline disabled:opacity-40 disabled:no-underline">
                        {deletingId === u.Id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <a href="/crm/setup/plot-master" className="text-[0.6875rem] text-primary hover:underline flex items-center gap-0.5 mt-0.5">
        manage land inventory in Plot Master <ExternalLink size={9} />
      </a>
    </div>
  );
};

const CrmProjectAutoSetup: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-auto-project-setup");
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
  const [editingUnit, setEditingUnit] = useState<UnitEdit | null>(null);
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
  // Payment plan IDs selected per block — forward-filled to every unit generated in that block.
  const [blockPaymentPlans, setBlockPaymentPlans] = useState<Record<number, number[]>>({});

  const { data: dropdown } = useQuery({ queryKey: ["crm-business-dropdown"], queryFn: fetchDropdown, staleTime: 5 * 60_000 });
  const companies = dropdown?.companies || [];
  const projects = dropdown?.projects || [];
  const { data: unitTypesMaster = [] } = useQuery<LayoutType[]>({ queryKey: LAYOUT_TYPES_QUERY_KEY, queryFn: getLayoutTypes, staleTime: 60_000 });
  const { data: applicablePlans = [] } = useQuery<PaymentPlan[]>({
    queryKey: ["applicable-plans-for-project", projectId],
    queryFn: () => fetchApplicablePlans(projectId),
    enabled: !!projectId,
    staleTime: 2 * 60_000,
  });
  const projectsForCompany = useMemo(
    () => companyId ? (projects as any[]).filter((p: any) => String(p.company_ids || p.company_id || p.CompanyId || "").split(",").includes(companyId)) : [],
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
    // Flat Master (Civil Work DPR) — generating/editing units here also
    // builds/adjusts their rooms there.
    invalidateRoomData(qc);
  };

  const blocksForNames: any[] = status?.blocks ?? EMPTY_ITEMS;
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
    const nextNames = generateNames(n, namingScheme, existingBlockNamesLower);
    setBlockNames((current) =>
      current.length === nextNames.length && current.every((name, index) => name === nextNames[index])
        ? current
        : nextNames,
    );
  }, [blockCount, namingScheme, existingBlockNamesLower]);

  const blocks: any[] = status?.blocks ?? EMPTY_ITEMS;
  const floors: any[] = status?.floors ?? EMPTY_ITEMS;
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

  // Whether this project lays out FLOORS or PLOTS. Taken from the type's
  // HasFloors flag, resolved server-side in /status — never from its name, so
  // a type added in Project Type master works here with no change. A project
  // with no type set resolves to floors, which is the legacy behaviour.
  const isPlotted = status?.projectType ? !status.projectType.HasFloors : false;

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
          ? data.items.map((it: any) => ({
              UnitType: it.UnitType,
              Count: String(it.Count),
              AreaSqFt: it.AreaSqFt != null ? String(it.AreaSqFt) : "",
              CarpetAreaSqFt: it.CarpetAreaSqFt != null ? String(it.CarpetAreaSqFt) : "",
              BuiltUpAreaSqFt: it.BuiltUpAreaSqFt != null ? String(it.BuiltUpAreaSqFt) : "",
              SuperBuiltUpAreaSqFt: it.SuperBuiltUpAreaSqFt != null ? String(it.SuperBuiltUpAreaSqFt) : (it.AreaSqFt != null ? String(it.AreaSqFt) : ""),
              OpenTerraceAreaSqFt: it.OpenTerraceAreaSqFt != null ? String(it.OpenTerraceAreaSqFt) : "",
              RatePerSqFt: it.RatePerSqFt != null ? String(it.RatePerSqFt) : "",
            }))
          : [{ UnitType: firstPickableType(unitTypesMaster), Count: "1", AreaSqFt: "", CarpetAreaSqFt: "", BuiltUpAreaSqFt: "", SuperBuiltUpAreaSqFt: "", OpenTerraceAreaSqFt: "", RatePerSqFt: "" }];
        setTemplates((m) => ({ ...m, [b.Id]: rows }));
        if (data.paymentPlanIds?.length) {
          setBlockPaymentPlans((m) => ({ ...m, [b.Id]: data.paymentPlanIds }));
        }
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
    }
  };

  const startEditUnit = (unit: any) => {
    setEditingUnitId(unit.Id);
    setEditingUnit({
      UnitName: unit.UnitName || "",
      FloorNo: unit.FloorNo != null ? String(unit.FloorNo) : "",
      UnitType: unit.UnitType || firstPickableType(unitTypesMaster),
      AreaSqFt: unit.AreaSqFt != null ? String(unit.AreaSqFt) : "",
      CarpetAreaSqFt: unit.CarpetAreaSqFt != null ? String(unit.CarpetAreaSqFt) : "",
      BuiltUpAreaSqFt: unit.BuiltUpAreaSqFt != null ? String(unit.BuiltUpAreaSqFt) : "",
      SuperBuiltUpAreaSqFt: unit.SuperBuiltUpAreaSqFt != null ? String(unit.SuperBuiltUpAreaSqFt)
        : unit.AreaSqFt != null ? String(unit.AreaSqFt) : "",
      OpenTerraceAreaSqFt: unit.OpenTerraceAreaSqFt != null ? String(unit.OpenTerraceAreaSqFt) : "",
      RatePerSqFt: unit.RatePerSqFt != null ? String(unit.RatePerSqFt) : "",
    });
  };

  const handleSaveUnit = async (floorId: number, unit: any) => {
    if (!editingUnit) return;
    const unitName = editingUnit.UnitName.trim();
    if (!unitName) { toast.error("Unit name is required"); return; }
    const floorNo = editingUnit.FloorNo !== "" ? parseInt(editingUnit.FloorNo, 10) : null;
    setSavingUnitId(unit.Id);
    try {
      const res = await fetchWithAuth(`/api/unit-master/${unit.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: unit.ProjectId,
          BlockId: unit.BlockId,
          UnitName: unitName,
          FloorNo: floorNo,
          UnitType: editingUnit.UnitType || null,
          AreaSqFt: editingUnit.AreaSqFt || null,
          CarpetAreaSqFt: editingUnit.CarpetAreaSqFt || null,
          BuiltUpAreaSqFt: editingUnit.BuiltUpAreaSqFt || null,
          SuperBuiltUpAreaSqFt: editingUnit.SuperBuiltUpAreaSqFt || null,
          OpenTerraceAreaSqFt: editingUnit.OpenTerraceAreaSqFt || null,
          RatePerSqFt: editingUnit.RatePerSqFt || null,
          IsActive: unit.IsActive !== false,
          PaymentPlanIds: unit.PaymentPlanIds ? String(unit.PaymentPlanIds).split(",").map((x) => parseInt(x, 10)).filter(Number.isFinite) : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update unit");
      // A Unit Type change rebuilds the unit's rooms from the new layout.
      const rs = data.roomSync;
      toast.success(
        (data.message || "Unit updated")
        + (rs?.added ? ` — ${rs.added} room(s) added from the ${rs.layout} layout` : "")
        + (rs?.deactivated ? `, ${rs.deactivated} old room(s) deactivated` : ""),
      );
      if (rs?.keptWithWork?.length) {
        toast.warning(`Kept ${rs.keptWithWork.join(", ")} — not in the new layout but has DPR work recorded against it.`);
      }
      setFloorUnits((m) => ({
        ...m,
        [floorId]: (m[floorId] || []).map((u) => u.Id === unit.Id
          ? { ...u, UnitName: unitName, UnitType: editingUnit.UnitType,
              CarpetAreaSqFt: editingUnit.CarpetAreaSqFt || null,
              BuiltUpAreaSqFt: editingUnit.BuiltUpAreaSqFt || null,
              SuperBuiltUpAreaSqFt: editingUnit.SuperBuiltUpAreaSqFt || null,
              OpenTerraceAreaSqFt: editingUnit.OpenTerraceAreaSqFt || null,
              RatePerSqFt: editingUnit.RatePerSqFt || null,
              AreaSqFt: editingUnit.AreaSqFt || null }
          : u),
      }));
      setEditingUnitId(null);
      setEditingUnit(null);
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingUnitId(null);
    }
  };

  const templateTotal = (blockId: number) => (templates[blockId] || []).reduce((s, r) => s + (parseInt(r.Count, 10) || 0), 0);

  const addTemplateRow = (blockId: number) =>
    setTemplates((m) => ({ ...m, [blockId]: [...(m[blockId] || []), { UnitType: firstPickableType(unitTypesMaster), Count: "1", AreaSqFt: "", CarpetAreaSqFt: "", BuiltUpAreaSqFt: "", SuperBuiltUpAreaSqFt: "", OpenTerraceAreaSqFt: "", RatePerSqFt: "" }] }));
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
        body: JSON.stringify({
          Items: rows.map((r) => ({
            UnitType: r.UnitType,
            Count: r.Count,
            AreaSqFt: r.AreaSqFt || null,
            CarpetAreaSqFt: r.CarpetAreaSqFt || null,
            BuiltUpAreaSqFt: r.BuiltUpAreaSqFt || null,
            SuperBuiltUpAreaSqFt: r.SuperBuiltUpAreaSqFt || null,
            OpenTerraceAreaSqFt: r.OpenTerraceAreaSqFt || null,
            RatePerSqFt: r.RatePerSqFt || null,
          })),
          PaymentPlanIds: blockPaymentPlans[blockId] || [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save template");
      toast.success(`Template saved — ${data.total} units/floor`);
    } catch (e: any) {
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
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
        toast.success(
          `${data.createdCount} unit(s) created — e.g. ${data.sample.slice(0, 3).join(", ")}`
          + (data.roomsCreated ? ` · ${data.roomsCreated} room(s) built in Flat Master from their layouts` : ""),
        );
        const noRooms: { unitType: string; count: number }[] = data.unitsWithoutRooms ?? [];
        if (noRooms.length) {
          toast.warning(
            `No rooms built for ${noRooms.map((r) => `${r.count} × ${r.unitType}`).join(", ")} — that Unit Type has no layout yet. `
            + "Define it in Civil Work DPR › Unit Composition, then use Flat Master's \"Generate Rooms in Bulk\".",
            { duration: 12000 },
          );
        }
      }
      refetchStatus();
      invalidateSyncedMasters();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Project Auto Setup"]} />
      <CrmShell
        title="CRM — Auto Project Setup"
        subtitle={isPlotted
          ? "Configure plot blocks and land inventory here. Plot Master remains the sales inventory until construction creates a Unit Master record."
          : "Pick a Project, then generate its Blocks, Floors, and Units in one guided flow instead of one-row-at-a-time forms"}
    >
      <div className="space-y-4">
        {/* Plain in-page toggle — no route change, so switching tabs never
            reloads or refetches anything. Parking is a fully separate
            component with its own Project selector/state (see
            CrmProjectAutoSetupParking.tsx); nothing below is shared with
            it, so a slow request or stale render on one side can never
            affect the other. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:flex sm:w-fit items-center gap-1 rounded-xl border border-border bg-muted/30 p-1">
          <button
            onClick={() => setActiveTab("setup")}
            className={`flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-lg font-medium transition-all ${
              activeTab === "setup" ? "btn-module text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background/60"
            }`}
          >
            <Building2 size={15} className="shrink-0" /> <span className="truncate">{isPlotted ? "Block / Plot" : "Block / Floor / Unit"}</span>
          </button>
          <button
            onClick={() => setActiveTab("parking")}
            className={`flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-lg font-medium transition-all ${
              activeTab === "parking" ? "btn-module text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background/60"
            }`}
          >
            <Car size={15} className="shrink-0" /> <span className="truncate">Parking Setup</span>
          </button>
        </div>

        {activeTab === "parking" ? (
          <CrmProjectAutoSetupParking />
        ) : (
        <>
        {/* Company → Project picker, side by side on wider screens. */}
        <div className={cardCls}>
          <SectionHeader
            icon={Building2}
            colorClass="bg-sky-500/10 text-sky-600"
            title="Select Project"
            hint="Choose the company and project you want to set up."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Company <span className="text-destructive">*</span></label>
              <select
                value={companyId}
                onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); }}
                className={inputCls}
              >
                <option value="">Select company</option>
                {(companies as any[]).map((c: any) => <option key={c.id || c.Id} value={String(c.id || c.Id)}>{c.name || c.Name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Project <span className="text-destructive">*</span></label>
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
          </div>
        </div>

        {!projectId && (
          <div className="rounded-xl border border-dashed border-border bg-muted/10 px-6 py-10 text-center">
            <Building2 size={28} className="mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm font-medium">No project selected</p>
            <p className="text-xs text-muted-foreground mt-1">Pick a company and project above to see and manage its blocks, floors and units.</p>
          </div>
        )}

        {projectId && statusLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />)}
          </div>
        )}

        {/* Progress across the three setup sections. */}
        {projectId && status && (() => {
          const generatedUnits = floors.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
          return (
            <SetupProgress
              steps={[
                { label: "Blocks", detail: step1Done ? `${blocks.length} block${blocks.length === 1 ? "" : "s"} created` : "Create the project's blocks", done: step1Done, active: !step1Done },
                { label: "Floors", detail: step2Done ? `${floors.length} floor${floors.length === 1 ? "" : "s"} planned` : "Set floors for each block", done: step2Done, active: step1Done && !step2Done },
                { label: "Units", detail: generatedUnits ? `${generatedUnits} unit${generatedUnits === 1 ? "" : "s"} generated` : "Define unit types & generate", done: step2Done && generatedUnits > 0 && !floors.some((f) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0), active: step2Done },
              ]}
            />
          );
        })()}

        {projectId && status && !status.shortCodeValid && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            This project has no valid Short Name set (letters/numbers only) — set one in Project Master first, it becomes the first segment of every generated unit name (e.g. RYG/A/1001).
          </div>
        )}

        {/* Floor-less units are now shown in the Unassigned row in the tree
            below (Option B synthetic bucket). This note stays as a lightweight
            signpost so staff know what the amber row means without having to
            guess — it disappears automatically once all units are fixed. */}
        {projectId && status && !isPlotted && status.legacyUnitCount > 0 && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-2.5 text-sm text-sky-600 flex items-center gap-2">
            <span>
              {status.legacyUnitCount} unit{status.legacyUnitCount === 1 ? "" : "s"} with no floor assigned — visible as the{" "}
              <span className="font-semibold">Unassigned</span> row in the tree below. Edit each unit to assign a floor, or go to{" "}
              <a href="/crm/setup/unit-master" className="underline" onClick={(e) => e.stopPropagation()}>
                Unit Master
              </a>.
            </span>
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
              // ── Plotted overview ─────────────────────────────────────────
              if (isPlotted) {
                const totalPlotted   = blocks.reduce((s, b) => s + (b.PlotTemplate?.PlotCount  ?? 0), 0);
                const totalCreated   = blocks.reduce((s, b) => s + (b.PlotTemplate?.PlotsCreated ?? 0), 0);
                const pendingBlocks  = blocks.filter((b) => b.PlotTemplate && !b.PlotTemplate.IsGenerated).length;
                const noTemplates    = blocks.filter((b) => !b.PlotTemplate).length;
                return (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="p-4 pb-3 flex items-center gap-2 border-b border-border bg-muted/20">
                      <Building2 size={16} className="text-primary shrink-0" />
                      <span className="text-sm font-semibold truncate">{status.project?.Name}</span>
                      <span className="ml-2 text-[0.6875rem] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">
                        {status.projectType?.Name ?? "Plotted"}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
                      {[
                        { label: "Blocks",          value: blocks.length },
                        { label: "Plots configured", value: totalPlotted },
                        { label: "Plots created",    value: totalCreated },
                        { label: "Blocks pending",   value: pendingBlocks + noTemplates, accent: (pendingBlocks + noTemplates) > 0 },
                      ].map((stat) => (
                        <div key={stat.label} className="px-4 py-2.5 text-center">
                          <div className={`text-lg font-semibold ${stat.accent ? "text-sky-600" : "text-foreground"}`}>{stat.value}</div>
                          <div className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">{stat.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="p-2">
                      {blocks.map((b) => {
                        const tpl = b.PlotTemplate;
                        const isExpanded = !!treeExpandedBlocks[b.Id];
                        const pendingLabel = !tpl
                          ? "Set up plot layout"
                          : !tpl.IsGenerated
                            ? `Generate ${tpl.PlotCount} plot(s)`
                            : null;
                        return (
                          <div key={b.Id} className="text-xs rounded-lg hover:bg-muted/30">
                            <button
                              onClick={() => setTreeExpandedBlocks((m) => ({ ...m, [b.Id]: !isExpanded }))}
                              className="w-full grid grid-cols-4 items-center gap-2 px-2 py-1.5 text-left"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                {isExpanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                                <span className="font-medium truncate">{b.BlockName}</span>
                              </span>
                              <span className="text-muted-foreground">{tpl ? `${tpl.PlotCount} configured` : "—"}</span>
                              <span className="text-muted-foreground">{tpl?.PlotsCreated ?? 0} created</span>
                              <span>
                                {pendingLabel ? (
                                  <span className="text-sky-600 bg-sky-500/10 px-1.5 py-0.5 rounded-full">{pendingLabel}</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">
                                    <CheckCircle2 size={11} /> Done
                                  </span>
                                )}
                              </span>
                            </button>
                            {isExpanded && tpl?.IsGenerated && (
                              <PlotBlockBrowser
                                blockId={b.Id}
                                blockName={b.BlockName}
                                onDeleteUnit={(unit) => { refetchStatus(); invalidateSyncedMasters(); }}
                              />
                            )}
                            {isExpanded && !tpl?.IsGenerated && (
                              <div className="ml-6 pl-3 border-l border-border pb-1.5 text-muted-foreground text-[0.6875rem] py-1">
                                {tpl ? "Generate plots first to browse them here." : "Set up the plot layout below first."}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // ── Floored overview ─────────────────────────────────────────
              const totalFloors = floors.length;
              const totalUnitsGenerated = floors.reduce((s, f) => s + (f.GeneratedUnitCount || 0), 0);
              const pendingFloorCount = floors.filter((f) => !f.IsGenerated && f.HasUnits && f.UnitCount > 0).length;
              return (
                <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                  <div className="px-4 sm:px-5 py-3.5 flex items-center gap-3 border-b border-border bg-muted/20">
                    <span className="w-9 h-9 rounded-xl btn-module flex items-center justify-center shrink-0">
                      <Building2 size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm sm:text-base font-heading font-semibold truncate">{status.project?.Name}</div>
                      <div className="text-xs text-muted-foreground">Project overview — click a block to see its floors and units</div>
                    </div>
                  </div>
                  {/* Stat cards — the at-a-glance numbers a person actually
                      scans for first, ahead of the per-block detail below. */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 p-3 sm:p-4 border-b border-border">
                    {[
                      { label: "Blocks", value: blocks.length, icon: Building2, tone: "text-violet-600 bg-violet-500/10" },
                      { label: "Floors", value: totalFloors, icon: Layers, tone: "text-cyan-600 bg-cyan-500/10" },
                      { label: "Units generated", value: totalUnitsGenerated, icon: Ruler, tone: "text-sky-600 bg-sky-500/10" },
                      { label: "Floors pending", value: pendingFloorCount, icon: Lock, tone: pendingFloorCount > 0 ? "text-amber-600 bg-[#ffe2021a]" : "text-green-600 bg-green-500/10" },
                    ].map((stat) => (
                      <div key={stat.label} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${stat.tone}`}>
                          <stat.icon size={16} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-lg sm:text-xl font-heading font-bold leading-tight">{stat.value}</div>
                          <div className="text-[0.6875rem] text-muted-foreground uppercase tracking-wide truncate">{stat.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-2 sm:p-3 space-y-1">
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
                        <div key={b.Id} className={`text-xs rounded-lg border transition-colors ${isExpanded ? "border-border bg-muted/20" : "border-transparent hover:bg-muted/30"}`}>
                          {/* Name | Floors | Units | Status — stacks into two
                              lines on phones so nothing gets squeezed. */}
                          <button onClick={() => setTreeExpandedBlocks((m) => ({ ...m, [b.Id]: !isExpanded }))}
                            className="w-full grid grid-cols-[1fr_auto] sm:grid-cols-4 items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left">
                            <span className="flex items-center gap-2 min-w-0">
                              {isExpanded ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                              <span className="w-7 h-7 rounded-lg bg-violet-500/10 text-violet-600 flex items-center justify-center shrink-0">
                                <Building2 size={13} />
                              </span>
                              <span className="text-sm font-semibold truncate">Block {b.BlockName}</span>
                            </span>
                            <span className="hidden sm:flex items-center gap-1.5 text-muted-foreground">
                              <Layers size={12} /> {blockFloors.length} floor{blockFloors.length === 1 ? "" : "s"}
                            </span>
                            <span className="hidden sm:flex items-center gap-1.5 text-muted-foreground">
                              <Ruler size={12} /> {totalUnits} unit{totalUnits === 1 ? "" : "s"} generated
                            </span>
                            <span className="justify-self-end sm:justify-self-start">
                              {pendingLabel ? (
                                <span className="inline-flex text-amber-600 bg-[#ffe2021a] px-2 py-0.5 rounded-full font-medium">{pendingLabel}</span>
                              ) : blockFloors.length > 0 ? (
                                <span className="inline-flex items-center gap-1 text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full font-medium">
                                  <CheckCircle2 size={11} /> Done
                                </span>
                              ) : null}
                            </span>
                            <span className="sm:hidden col-span-2 pl-[3.25rem] text-muted-foreground">
                              {blockFloors.length} floor{blockFloors.length === 1 ? "" : "s"} · {totalUnits} unit{totalUnits === 1 ? "" : "s"} generated
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="ml-5 sm:ml-8 mr-2 pl-3 border-l-2 border-border pb-2">
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
                                unitTypesMaster={unitTypesMaster}
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
            <div className={`${cardCls} border-l-4 border-l-violet-500`}>
              <SectionHeader
                icon={Building2}
                colorClass="bg-violet-500/10 text-violet-600"
                title={isPlotted ? "1 · Plot Blocks" : "1 · Blocks"}
                hint={step1Done ? "Click a block to see its floors. Use Edit to rename or remove blocks." : "Create the towers / blocks of this project."}
                done={step1Done}
                right={
                  <>
                    {rights.canEdit && step1Done && (
                      <button onClick={() => { setBlocksEditMode((v) => !v); setEditingBlockId(null); }}
                        className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium ${blocksEditMode ? "btn-module text-white" : "text-muted-foreground hover:text-foreground border border-border hover:bg-muted/50"}`}>
                        <Pencil size={12} /> {blocksEditMode ? "Done" : "Edit"}
                      </button>
                    )}
                    {step1Done && !showAddBlockForm && (
                      <button onClick={() => setShowAddBlockForm(true)}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium border border-dashed border-primary/50 text-primary hover:bg-primary/5">
                        + Add Blocks
                      </button>
                    )}
                  </>
                }
              />
              <div className="flex items-center flex-wrap gap-2">

                {/* Locked, plain-label chips by default — someone just here
                    to see the project plan gets a calm, read-only list, not
                    a row of pencils/× (backend still refuses delete with a
                    clear reason if anything exists underneath it — see
                    getBlockLockReason). Rename/delete only appear once
                    blocksEditMode is switched on via the toggle below. */}
                {blocks.map((b) => (
                  <span key={b.Id} className={`${chipCls} font-medium ${
                    blocksEditMode
                      ? "bg-muted/70 border-border"
                      : blocksExpandedBlocks[b.Id]
                        ? "bg-violet-500/10 border-violet-500/40 text-violet-700 dark:text-violet-300"
                        : "bg-muted/40 border-border/60 hover:border-violet-500/40"
                  }`}>
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
                          title="Rename block" className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10">
                          <Pencil size={11} />
                        </button>
                        <button onClick={() => handleDeleteBlock(b)}
                          title="Delete block" className="p-0.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10">
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      // View mode — clicking a Block name drills into its
                      // Floors (and from there, into real Units), same tree
                      // interaction as the overview card above — but with
                      // its own independent expand state (blocksExpandedBlocks),
                      // so expanding it here doesn't also expand it up there.
                        isPlotted ? (
                          <a href="/crm/setup/plot-master" className="flex items-center gap-1 hover:text-primary">
                            <MapIcon size={12} /> {b.BlockName}
                          </a>
                        ) : (
                        <button onClick={() => setBlocksExpandedBlocks((m) => ({ ...m, [b.Id]: !m[b.Id] }))}
                          className="flex items-center gap-1">
                          {blocksExpandedBlocks[b.Id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {b.BlockName}
                        </button>
                        )
                    )}
                  </span>
                ))}
                {/* Edit / "+ Add Blocks" live in the section header. "Add
                    More Blocks" only opens on demand; a brand-new project
                    shows the create form open by default. */}
              </div>

              {/* Expanded Block(s) — its Floor tree, drilling further into
                  real Units per Floor, same as clicking through the
                  overview card above. */}
              {!isPlotted && blocks.filter((b) => blocksExpandedBlocks[b.Id]).map((b) => (
                <div key={b.Id} className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3 text-xs">
                  <div className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                    <Building2 size={13} className="text-violet-600" /> Block {b.BlockName}
                  </div>
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
                    unitTypesMaster={unitTypesMaster}
                  />
                </div>
              ))}

              {(!step1Done || showAddBlockForm) && (
                <div className={step1Done ? "rounded-xl border border-dashed border-border bg-muted/10 p-3 sm:p-4 space-y-4" : "space-y-4"}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-heading font-semibold text-foreground">{step1Done ? `Add More ${isPlotted ? "Plot " : ""}Blocks` : `Create ${isPlotted ? "Plot " : ""}Blocks`}</div>
                    {step1Done && (
                      <button onClick={() => setShowAddBlockForm(false)} className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50">
                        Cancel
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Number of Blocks</label>
                      <input type="number" min={1} max={100} value={blockCount}
                        onChange={(e) => setBlockCount(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Naming Scheme</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 rounded-lg border border-border bg-muted/30 p-1">
                        {(["Alphabetical", "Numeric", "Custom"] as NamingScheme[]).map((s) => (
                          <label key={s} className={`flex items-center justify-center gap-1 text-xs py-1.5 rounded-md cursor-pointer transition-colors ${
                            namingScheme === s ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}>
                            <input type="radio" className="sr-only" checked={namingScheme === s} onChange={() => setNamingScheme(s)} /> {s}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <label className={labelCls}>Block Names</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 -mt-2">
                    {blockNames.map((name, i) => {
                      const dupe = isDuplicateBlockName(name, i, blockNames, existingBlockNamesLower);
                      return (
                        <div key={i}>
                          <input type="text" value={name} placeholder={`Block ${i + 1}`}
                            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                            name={`block-name-${i}-${projectId || "new"}`}
                            onChange={(e) => setBlockNames((arr) => arr.map((v, idx) => idx === i ? e.target.value : v))}
                            className={`${inputCls} ${dupe ? "border-destructive text-destructive" : ""}`} />
                          {dupe && <div className="text-[0.625rem] text-destructive mt-0.5">Already exists</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-end pt-1">
                    <button onClick={handleSaveBlocks} disabled={savingBlocks || !rights.canCreate || blockNames.some((n, i) => isDuplicateBlockName(n, i, blockNames, existingBlockNamesLower))}
                      className="w-full sm:w-auto px-5 py-2.5 text-sm btn-module text-white rounded-lg font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                      {savingBlocks ? "Saving…" : step1Done ? "Add Blocks" : "OK — Create Blocks"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Step 2 — Floors. Every block's floor count stays editable —
                prefilled with what's already there, so bumping a 10-floor
                block up to 12 is just changing one number, not starting
                over. Submitting an unchanged count for an already-set-up
                block is always a safe no-op (POST /floors only ever adds
                what's missing). */}
            {/* A plotted block has no floors, so the whole Floor Plan step is
                replaced rather than hidden field-by-field — the backend refuses
                POST /floors for such a block anyway, and leaving the step
                visible would invite an action that can only fail. */}
            {step1Done && isPlotted && (
              <PlotLayoutStep
                blocks={blocks}
                projectTypeName={status?.projectType?.Name}
                canEdit={rights.canEdit}
                canCreate={rights.canCreate}
                onChanged={() => { refetchStatus(); invalidateSyncedMasters(); }}
              />
            )}

            {/* Plot browse — shown once at least one block has plots generated.
                Mirrors the "Unit Types & Generation" card for floored projects:
                expand a block to browse every plot, check availability status,
                and delete a plot (with the booking/hold lock guard in place).
                Detailed editing stays in Unit Master. */}
            {step1Done && isPlotted && blocks.some((b) => b.PlotTemplate?.IsGenerated) && (
              <div className={`${cardCls} border-l-2 border-l-sky-500`}>
                <SectionHeader
                  icon={MapIcon}
                  colorClass="bg-sky-500/10 text-sky-600"
                  title="Land Inventory"
                  done={blocks.every((b) => !b.PlotTemplate || b.PlotTemplate.IsGenerated)}
                  right={<a href={`/crm/setup/plot-master?projectId=${projectId}`} className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] text-primary hover:underline">Open Plot Master <ExternalLink size={11} /></a>}
                />
                <p className="text-[0.6875rem] text-muted-foreground -mt-1">Review live availability below. Use Plot Master for filters, plot history, and conversion to Unit Master after construction.</p>
                <div className="space-y-1.5">
                  {blocks.map((b) => {
                    const tpl = b.PlotTemplate;
                    if (!tpl?.IsGenerated) {
                      return (
                        <div key={b.Id} className="rounded-lg border border-border/50 p-2 flex items-center gap-2">
                          <span className="text-xs font-medium">{b.BlockName}</span>
                          <span className="text-[0.6875rem] text-muted-foreground">
                            {tpl ? `${tpl.PlotCount} configured — generate plots first` : "No layout set"}
                          </span>
                        </div>
                      );
                    }
                    return <PlotBlockExpandRow key={b.Id} block={b} onChanged={() => { refetchStatus(); invalidateSyncedMasters(); }} />;
                  })}
                </div>
              </div>
            )}

            {step1Done && !isPlotted && (
              <div className={`${cardCls} border-l-4 border-l-cyan-500`}>
                <SectionHeader icon={Layers} colorClass="bg-cyan-500/10 text-cyan-600" title="2 · Floor Plan" done={step2Done}
                  hint={step2Done ? "Click a floor to see its units. Use Edit to remove empty floors." : "Enter how many floors each block has."}
                  right={
                  rights.canEdit && step2Done && (
                    <button onClick={() => setFloorsEditMode((v) => !v)}
                      className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium ${floorsEditMode ? "btn-module text-white" : "text-muted-foreground hover:text-foreground border border-border hover:bg-muted/50"}`}>
                      <Pencil size={12} /> {floorsEditMode ? "Done" : "Edit"}
                    </button>
                  )
                } />

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {blocks.map((b) => {
                    const blockFloors = floorsByBlock.get(b.Id) || [];
                    const hasFloors = blockFloors.length > 0;
                    // Open by default when there's nothing to summarize yet;
                    // otherwise only open once the user explicitly asks for
                    // more via the toggle below.
                    const isOpen = !hasFloors || !!floorFormOpenFor[b.Id];
                    return (
                      <div key={b.Id} className="rounded-xl border border-border/60 bg-background/50 p-3">
                        {hasFloors && !isOpen ? (
                          // Collapsed tree row — this is the state a
                          // completed block sits in, instead of the input
                          // staying open forever.
                          <div>
                            <div className="flex items-center flex-wrap gap-2">
                              <span className="text-sm font-semibold flex items-center gap-1.5 w-full sm:w-auto">
                                <Building2 size={13} className="text-violet-600" /> Block {b.BlockName}
                                <CheckCircle2 size={13} className="text-green-600" />
                                <span className="text-xs font-normal text-muted-foreground">· {blockFloors.length} floor{blockFloors.length === 1 ? "" : "s"}</span>
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5 order-last w-full">
                                {blockFloors.map((f) => (
                                  <span key={f.Id} className={`inline-flex items-center gap-1 text-xs min-w-[2rem] justify-center px-2 py-1 rounded-lg border text-muted-foreground transition-colors ${
                                    f.FloorNo === -1
                                      ? "bg-sky-500/10 text-sky-600 border-sky-500/30"
                                      : floorPlanExpandedFloorId === f.Id
                                        ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40"
                                        : floorsEditMode ? "bg-muted/70 border-border" : "bg-muted/40 border-border/50 hover:border-cyan-500/40"
                                  }`}>
                                    {/* Generated floors are clickable in view
                                        mode — same drill-into-Units tree as
                                        the overview card/Blocks section.
                                        Unassigned bucket (FloorNo -1) is not
                                        clickable here — use the overview tree. */}
                                    {!floorsEditMode && f.IsGenerated && f.FloorNo !== -1 ? (
                                      <button onClick={() => handleToggleFloorPlanFloor(f)} className="hover:text-primary">{f.FloorLabel}</button>
                                    ) : (
                                      <span>{f.FloorLabel}</span>
                                    )}
                                    {floorsEditMode && f.FloorNo !== -1 && (
                                      <button onClick={() => handleDeleteFloor(f)} title="Delete floor" className="rounded hover:text-red-600 hover:bg-red-500/10">
                                        <X size={11} />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                              <button onClick={() => setFloorFormOpenFor((m) => ({ ...m, [b.Id]: true }))}
                                className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-primary/50 text-primary hover:bg-primary/5 ml-auto">
                                + Add floors
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
                                  unitTypesMaster={unitTypesMaster}
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
                              <span className="text-sm font-semibold w-24 shrink-0 flex items-center gap-1.5">
                                <Building2 size={13} className="text-violet-600" /> {b.BlockName}
                              </span>
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
                              <div className="flex flex-wrap items-center gap-1.5 sm:pl-[108px]">
                                {blockFloors.map((f) => (
                                  <span key={f.Id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-border/50 text-muted-foreground ${floorsEditMode ? "bg-muted/70" : "bg-muted/40"}`}>
                                    {!floorsEditMode && f.IsGenerated ? (
                                      <button onClick={() => handleToggleFloorPlanFloor(f)} className="hover:text-primary">{f.FloorLabel}</button>
                                    ) : (
                                      <span>{f.FloorLabel}</span>
                                    )}
                                    {floorsEditMode && (
                                      <button onClick={() => handleDeleteFloor(f)} title="Delete floor" className="rounded hover:text-red-600 hover:bg-red-500/10">
                                        <X size={11} />
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
                                  unitTypesMaster={unitTypesMaster}
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
                  <div className="flex justify-end pt-1 border-t border-border/60">
                    <button onClick={async () => { await handleSaveFloors(); setFloorFormOpenFor({}); }} disabled={savingFloors}
                      className="w-full sm:w-auto mt-3 px-5 py-2.5 text-sm btn-module text-white rounded-lg font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                      {savingFloors ? "Saving…" : step2Done ? "Add Floors" : "OK — Generate Floors"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Unit Types & Generation */}
            {step2Done && !isPlotted && (
              <div className={`${cardCls} border-l-4 border-l-sky-500`}>
                <SectionHeader icon={Ruler} colorClass="bg-sky-500/10 text-sky-600" title="3 · Unit Types & Generation"
                  hint="Define the unit mix per floor for each block, apply it to the floors, then generate the units." />

                {/* How the units will be named — project default, block and
                    floor overrides, with the exact names previewed first. */}
                <NamingPanel projectId={Number(projectId)} shortName={status?.project?.ShortCode} blocks={blocks} floorsByBlock={floorsByBlock} canEdit={rights.canEdit} />

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
                      <div key={b.Id} className="rounded-xl border border-border/60 bg-background/50 p-3 sm:p-4 space-y-3">
                        {blockFullyGenerated && !unitTemplateOpenFor[b.Id] ? (
                          // Locked summary row — nothing pending here, so the
                          // template editor and per-floor forms stay closed
                          // instead of sitting open with nothing left to do.
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              <span className="text-sm font-semibold flex items-center gap-1.5">
                                <Building2 size={13} className="text-violet-600" /> Block {b.BlockName} <CheckCircle2 size={13} className="text-green-600" />
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {totalGeneratedUnits} unit{totalGeneratedUnits === 1 ? "" : "s"} generated
                              </span>
                              <button onClick={() => setUnitTemplateOpenFor((m) => ({ ...m, [b.Id]: true }))}
                                className="text-xs px-2.5 py-1 rounded-lg border border-border text-primary hover:bg-primary/5 ml-auto">
                                Manage template / units
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {groundFloor && (
                                <button onClick={() => handleToggleExpandFloor(groundFloor)}
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded-lg border border-border/50 bg-muted/40 hover:border-sky-500/40">
                                  {expandedFloorId === groundFloor.Id ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                  <Lock size={9} /> Ground: {groundFloor.GeneratedUnitCount || 0}
                                </button>
                              )}
                              {nonGroundFloors.map((f) => (
                                <button key={f.Id} onClick={() => handleToggleExpandFloor(f)}
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded-lg border border-border/50 bg-muted/40 hover:border-sky-500/40">
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
                                unitTypesMaster={unitTypesMaster}
                              />
                            ))}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold flex items-center gap-1.5">
                                <Building2 size={13} className="text-violet-600" /> Block {b.BlockName}
                              </span>
                              {blockFullyGenerated && (
                                <button onClick={() => setUnitTemplateOpenFor((m) => ({ ...m, [b.Id]: false }))}
                                  className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 ml-auto">
                                  Collapse
                                </button>
                              )}
                            </div>
                            <div className="text-[0.6875rem] uppercase tracking-widest font-heading text-muted-foreground">Unit mix per floor</div>

                        {/* Unit Type template — defined ONCE per block, then
                            applied to every non-Ground floor in one click.
                            A floor whose count is later customized away from
                            this total still gets typed by cycling through
                            this same sequence (see getBlockUnitSequence). */}
                        <div className="space-y-1.5">
                          {!firstPickableType(unitTypesMaster) && (
                            <p className="text-[0.6875rem] text-sky-600 dark:text-sky-400">
                              No Unit Type has a room layout yet — define one in Civil Work DPR › Unit Composition first.
                            </p>
                          )}
                          {rows.map((row, idx) => (
                            <div key={idx} className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-2">
                              <div className="flex items-center gap-2">
                                <select value={row.UnitType} onChange={(e) => updateTemplateRow(b.Id, idx, { UnitType: e.target.value })}
                                  title={unitTypesMaster.find((t) => t.label === row.UnitType)?.summary || undefined}
                                  className={`${inputCls} !py-1 flex-1`}>
                                  {!row.UnitType && <option value="" disabled>Select Unit Type</option>}
                                  {unitTypeOptions(unitTypesMaster, row.UnitType).map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}
                                </select>
                                <input type="number" min={1} max={100} placeholder="Count" value={row.Count}
                                  onChange={(e) => updateTemplateRow(b.Id, idx, { Count: e.target.value })}
                                  className={`${inputCls} !py-1 !w-20`} />
                                <button onClick={() => removeTemplateRow(b.Id, idx)} title="Remove unit type" className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 shrink-0 ml-auto">
                                  <X size={14} />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-2">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Saleable (sqft)</span>
                                  <input type="number" min={0} placeholder="—" value={row.AreaSqFt}
                                    onChange={(e) => updateTemplateRow(b.Id, idx, { AreaSqFt: e.target.value })}
                                    className={`${inputCls} !py-1`} />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Rate/sqft (₹)</span>
                                  <input type="number" min={0} placeholder="—" value={row.RatePerSqFt}
                                    onChange={(e) => updateTemplateRow(b.Id, idx, { RatePerSqFt: e.target.value })}
                                    className={`${inputCls} !py-1`} />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Carpet (sqft)</span>
                                  <input type="number" min={0} placeholder="—" value={row.CarpetAreaSqFt}
                                    onChange={(e) => updateTemplateRow(b.Id, idx, { CarpetAreaSqFt: e.target.value })}
                                    className={`${inputCls} !py-1`} />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Built-up (sqft)</span>
                                  <input type="number" min={0} placeholder="—" value={row.BuiltUpAreaSqFt}
                                    onChange={(e) => updateTemplateRow(b.Id, idx, { BuiltUpAreaSqFt: e.target.value })}
                                    className={`${inputCls} !py-1`} />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">SBU (sqft)</span>
                                  <input type="number" min={0} placeholder="—" value={row.SuperBuiltUpAreaSqFt}
                                    onChange={(e) => updateTemplateRow(b.Id, idx, { SuperBuiltUpAreaSqFt: e.target.value })}
                                    className={`${inputCls} !py-1`} />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Open Terrace (sqft)</span>
                                  <input type="number" min={0} placeholder="—" value={row.OpenTerraceAreaSqFt}
                                    onChange={(e) => updateTemplateRow(b.Id, idx, { OpenTerraceAreaSqFt: e.target.value })}
                                    className={`${inputCls} !py-1`} />
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => addTemplateRow(b.Id)} className="text-xs px-2.5 py-1.5 rounded-lg border border-dashed border-primary/50 text-primary hover:bg-primary/5">+ Add Type</button>
                            <span className="text-xs text-muted-foreground ml-auto">Total: <span className="font-semibold text-foreground">{templateTotal(b.Id)}</span> unit(s)/floor</span>
                            {rights.canEdit && (
                              <button onClick={() => handleSaveTemplate(b.Id)} disabled={savingTemplateBlockId === b.Id}
                                className="px-3 py-1.5 text-xs border border-border bg-background rounded-lg font-medium hover:bg-muted/60 disabled:opacity-40">
                                Save Template
                              </button>
                            )}
                            {rights.canEdit && (
                              <button onClick={() => handleApplyTemplate(b.Id)} disabled={applyingTemplateBlockId === b.Id || !templateTotal(b.Id)}
                                className="px-3 py-1.5 text-xs btn-module text-white rounded-lg font-medium shadow-sm disabled:opacity-40">
                                Apply to Floors
                              </button>
                            )}
                          </div>
                          {applicablePlans.length > 0 && (
                            <div className="pt-1.5 border-t border-border/40">
                              <div className="text-[0.625rem] text-muted-foreground uppercase tracking-wide mb-1">
                                Payment Plans — forward-filled to every unit generated in this block
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {applicablePlans.map((plan) => {
                                  const selected = (blockPaymentPlans[b.Id] || []).includes(plan.Id);
                                  return (
                                    <button
                                      key={plan.Id}
                                      onClick={() => setBlockPaymentPlans((m) => ({
                                        ...m,
                                        [b.Id]: selected
                                          ? (m[b.Id] || []).filter((id) => id !== plan.Id)
                                          : [...(m[b.Id] || []), plan.Id],
                                      }))}
                                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                                        selected
                                          ? "btn-module text-white border-primary"
                                          : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      {plan.PlanName}
                                    </button>
                                  );
                                })}
                              </div>
                              {(blockPaymentPlans[b.Id] || []).length > 0 && (
                                <div className="text-[0.625rem] text-green-600 mt-1">
                                  {(blockPaymentPlans[b.Id] || []).length} plan{(blockPaymentPlans[b.Id] || []).length > 1 ? "s" : ""} selected — saved with template
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Ground floor stays its own explicit row — never
                            covered by the block template above. */}
                        {groundFloor && (
                          <div className="pt-3 border-t border-border/60 space-y-2">
                            <div className="text-[0.6875rem] uppercase tracking-widest font-heading text-muted-foreground">Ground floor</div>
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
                                unitTypesMaster={unitTypesMaster}
                              />
                            )}
                          </div>
                        )}

                        {/* Non-Ground floors — compact one-liner by default
                            (generated by the template above); a pencil
                            reveals the editable count for a real exception. */}
                        {nonGroundFloors.length > 0 && (
                          <div className="pt-3 border-t border-border/60 space-y-2">
                          <div className="text-[0.6875rem] uppercase tracking-widest font-heading text-muted-foreground">Units per floor</div>
                          <div className="flex flex-wrap gap-1.5">
                            {nonGroundFloors.map((f) => (
                              <div key={f.Id} className="text-xs">
                                {f.IsGenerated ? (
                                  <button onClick={() => handleToggleExpandFloor(f)}
                                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary px-2 py-1 rounded-lg border border-border/50 bg-muted/40 hover:border-sky-500/40">
                                    {expandedFloorId === f.Id ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                    <Lock size={9} /> {f.FloorLabel}: {f.GeneratedUnitCount}
                                  </button>
                                ) : editingFloorId === f.Id ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-primary/40 bg-muted/40">
                                    {f.FloorLabel}:
                                    <input autoFocus type="number" min={0} max={500} value={f.UnitCount}
                                      onChange={(e) => handleFloorFieldSave(f, { UnitCount: parseInt(e.target.value, 10) || 0 })}
                                      onBlur={() => setEditingFloorId(null)}
                                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingFloorId(null); }}
                                      className="w-14 bg-transparent border-b border-primary outline-none" />
                                  </span>
                                ) : (
                                  <button onClick={() => setEditingFloorId(f.Id)}
                                    className="group inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border/50 bg-muted/40 hover:bg-muted/70" title="Edit unit count for this floor">
                                    <span>{f.FloorLabel}: {f.UnitCount}</span>
                                    <Pencil size={10} className="opacity-40 group-hover:opacity-80" />
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
                                    unitTypesMaster={unitTypesMaster}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
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
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-3">
                    <div className="text-xs text-muted-foreground flex-1">
                      <span className="font-semibold text-foreground">Ready to generate.</span> Units will be created for every floor that has a unit count and isn't generated yet.
                    </div>
                    <button onClick={handleGenerate} disabled={generating}
                      className="w-full sm:w-auto px-5 py-2.5 text-sm btn-module text-white rounded-lg font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                      {generating ? "Generating…" : "Generate Units"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        </>
        )}
      </div>
      </CrmShell>
    </>
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
  editingUnit: UnitEdit | null;
  savingUnitId: number | null;
  onStartEditUnit: (unit: any) => void;
  onEditUnitChange: (patch: Partial<UnitEdit>) => void;
  onCancelEditUnit: () => void;
  onSaveUnit: (floorId: number, unit: any) => void;
  onDeleteUnit: (floorId: number, unit: any) => void;
  unitTypesMaster: LayoutType[];
}> = ({ blockFloors, expandedFloorId, onToggleFloor, floorUnits, loadingUnitsFloorId, editingUnitId, editingUnit, savingUnitId, onStartEditUnit, onEditUnitChange, onCancelEditUnit, onSaveUnit, onDeleteUnit, unitTypesMaster }) => (
  <div className="space-y-0.5">
    {blockFloors.length === 0 ? (
      <div className="text-muted-foreground py-0.5">No floors yet.</div>
    ) : (
      blockFloors.map((f) => (
        <div key={f.Id}>
          {f.FloorNo === -1 ? (
            // Synthetic "Unassigned" bucket — units with no FloorNo at all.
            // Still clickable to expand and edit inline (assign a real floor),
            // but amber-styled so it reads as "something to fix" not "done".
            <button onClick={() => onToggleFloor(f)}
              className="w-full flex items-center gap-1.5 py-0.5 text-left hover:text-sky-700 text-sky-600">
              {expandedFloorId === f.Id ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />}
              <Layers size={10} className="shrink-0" />
              <span className="shrink-0 font-medium">Unassigned</span>
              <span className="text-sky-500/80">
                {f.GeneratedUnitCount ?? f.UnitCount} unit{(f.GeneratedUnitCount ?? f.UnitCount) === 1 ? "" : "s"} — no floor set, edit to assign one
              </span>
            </button>
          ) : f.IsGenerated ? (
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
                <span className="text-sky-600">{f.UnitCount} unit{f.UnitCount === 1 ? "" : "s"} planned — not generated yet</span>
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
              unitTypesMaster={unitTypesMaster}
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
  editingUnit: UnitEdit | null;
  savingUnitId: number | null;
  unitTypesMaster: LayoutType[];
  onStartEdit: (unit: any) => void;
  onEditChange: (patch: Partial<UnitEdit>) => void;
  onCancelEdit: () => void;
  onSave: (floorId: number, unit: any) => void;
  onDelete: (floorId: number, unit: any) => void;
}> = ({ floorId, units, loading, editingUnitId, editingUnit, savingUnitId, unitTypesMaster, onStartEdit, onEditChange, onCancelEdit, onSave, onDelete }) => {
  // Tapping a unit expands it into a small detail panel (status + real
  // Edit/Delete buttons) instead of always showing a bare pencil/× stranded
  // at the far edge of the row. Local to this floor's list — each floor
  // tracks its own expanded unit independently.
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);

  return (
    <div className="ml-4 mt-1 border-l border-border pl-3">
      {loading ? (
        <div className="text-[0.6875rem] text-muted-foreground py-1">Loading...</div>
      ) : (units || []).length === 0 ? (
        <div className="text-[0.6875rem] text-muted-foreground py-1">No units left on this floor.</div>
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
            const dotColor = u.LockBookingNo ? "bg-red-500" : u.LockHoldId ? "bg-sky-500" : u.LockApplicationNo ? "bg-sky-500" : "bg-green-500";

            if (isEditing) {
              return (
                <div key={u.Id} className="col-span-2 sm:col-span-3 lg:col-span-4 rounded-lg border border-primary/40 bg-muted/20 p-2 space-y-1.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <input autoFocus value={editingUnit.UnitName}
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                      name={`unit-name-${u.Id}`}
                      onChange={(e) => onEditChange({ UnitName: e.target.value })}
                      placeholder="Unit name"
                      className="h-7 rounded border border-border bg-background px-2 text-[0.6875rem] font-mono outline-none focus:border-primary" />
                    <select value={editingUnit.UnitType}
                      onChange={(e) => onEditChange({ UnitType: e.target.value })}
                      title={unitTypesMaster.find((t) => t.label === editingUnit.UnitType)?.summary || undefined}
                      className="h-7 rounded border border-border bg-background px-1 text-[0.6875rem] outline-none focus:border-primary">
                      {!editingUnit.UnitType && <option value="" disabled>Select Unit Type</option>}
                      {unitTypeOptions(unitTypesMaster, u.UnitType).map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}
                    </select>
                  </div>
                  {/* Floor No. input — only shown for Unassigned units (FloorNo IS NULL)
                      so staff can assign a real floor right here without going to Unit Master.
                      Hidden for units already on a real floor — their floor is set correctly
                      by the wizard and shouldn't be changed from the inline form. */}
                  {u.FloorNo == null && (
                    <div className="flex items-center gap-2">
                      <span className="text-[0.625rem] text-sky-600 uppercase tracking-wide font-medium shrink-0">Floor No. (required)</span>
                      <input
                        value={editingUnit.FloorNo}
                        type="number"
                        placeholder="e.g. 1"
                        onChange={(e) => onEditChange({ FloorNo: e.target.value })}
                        className="h-7 w-24 rounded border border-sky-500/50 bg-background px-2 text-[0.6875rem] outline-none focus:border-sky-600"
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Saleable (sqft)</span>
                      <input value={editingUnit.AreaSqFt} type="number" min={0} placeholder="—"
                        onChange={(e) => onEditChange({ AreaSqFt: e.target.value })}
                        className="h-7 rounded border border-border bg-background px-2 text-[0.6875rem] outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Carpet (sqft)</span>
                      <input value={editingUnit.CarpetAreaSqFt} type="number" min={0} placeholder="—"
                        onChange={(e) => onEditChange({ CarpetAreaSqFt: e.target.value })}
                        className="h-7 rounded border border-border bg-background px-2 text-[0.6875rem] outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Built-up (sqft)</span>
                      <input value={editingUnit.BuiltUpAreaSqFt} type="number" min={0} placeholder="—"
                        onChange={(e) => onEditChange({ BuiltUpAreaSqFt: e.target.value })}
                        className="h-7 rounded border border-border bg-background px-2 text-[0.6875rem] outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">SBU (sqft)</span>
                      <input value={editingUnit.SuperBuiltUpAreaSqFt} type="number" min={0} placeholder="—"
                        onChange={(e) => onEditChange({ SuperBuiltUpAreaSqFt: e.target.value })}
                        className="h-7 rounded border border-border bg-background px-2 text-[0.6875rem] outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Open Terrace (sqft)</span>
                      <input value={editingUnit.OpenTerraceAreaSqFt} type="number" min={0} placeholder="—"
                        onChange={(e) => onEditChange({ OpenTerraceAreaSqFt: e.target.value })}
                        className="h-7 rounded border border-border bg-background px-2 text-[0.6875rem] outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide">Rate/sqft (₹)</span>
                      <input value={editingUnit.RatePerSqFt} type="number" min={0} placeholder="—"
                        onChange={(e) => onEditChange({ RatePerSqFt: e.target.value })}
                        className="h-7 rounded border border-border bg-background px-2 text-[0.6875rem] outline-none focus:border-primary" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={onCancelEdit} className="text-[0.6875rem] px-2 py-1 rounded text-muted-foreground hover:text-foreground">Cancel</button>
                    <button onClick={() => onSave(floorId, u)} disabled={savingUnitId === u.Id}
                      className="text-[0.6875rem] px-2 py-1 rounded btn-module text-white font-medium disabled:opacity-40">
                      Save
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={u.Id}
                className={`rounded-lg border p-2 text-[0.6875rem] cursor-pointer transition-colors ${isExpanded ? "border-primary/50 bg-primary/5" : "border-border/60 bg-muted/20 hover:bg-muted/40"}`}
                onClick={() => setExpandedUnitId(isExpanded ? null : u.Id)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono font-semibold truncate">{u.UnitName}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} title={lockReason || "Available"} />
                </div>
                <div className="text-muted-foreground truncate">
                  {u.UnitType || "No type set"}
                  {u.AreaSqFt ? ` · ${u.AreaSqFt} sqft` : ""}
                  {u.RatePerSqFt ? ` · ₹${Number(u.RatePerSqFt).toLocaleString("en-IN")}/sqft` : ""}
                </div>

                {isExpanded && (
                  <div onClick={(e) => e.stopPropagation()} className="mt-1.5 pt-1.5 border-t border-border/60 space-y-1.5">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Status:</span>
                      {lockReason ? (
                        <span className="text-sky-600 flex items-center gap-0.5"><Lock size={9} /> {lockReason}</span>
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
      <a href="/crm/setup/unit-master" className="text-[0.6875rem] text-primary hover:underline flex items-center gap-0.5">
        edit details in Unit Master <ExternalLink size={9} />
      </a>
    </div>
  );
};

export default CrmProjectAutoSetup;

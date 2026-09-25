import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText, Upload, DoorOpen, Sparkles, Loader2, CheckCircle2,
  ChevronDown, ChevronRight, Eye, Printer, Pencil, Trash2, Building2, Building, FolderTree, Layers, LayoutGrid, AlertTriangle,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getProjectOverrides } from "@/api/unitLayoutOverrideApi";
import { getLayoutTypes, LAYOUT_TYPES_QUERY_KEY, type LayoutType } from "@/api/unitBhkConfigApi";
import { getRoomCategoryOptions, type RoomCategory } from "@/api/roomCategoryMasterApi";
import {
  resolveLayout, compositionText, roomTotal,
  type Level, type Position, type LayoutOverrideRow,
} from "@/lib/layoutResolve";
import { InlineLayoutEditor, type NodeType } from "./InlineLayoutEditor";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import { ExportMenu } from "@/components/ExportMenu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/room-master";

const BLUEPRINT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const BLUEPRINT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

// GET /:id/blueprint returns base64 JSON rather than a raw file stream —
// the app's auth is a Bearer token attached only by fetchWithAuth's own
// header, so a plain <a href> straight to the API 401s with "No token
// provided". This decodes the base64 into a Blob and opens that instead,
// going through fetchWithAuth so the request is actually authenticated.
async function openBlueprint(roomId: string | number) {
  try {
    const res = await fetchWithAuth(`${API}/${roomId}/blueprint`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Could not load blueprint");
    }
    const { mimeType, dataBase64 } = await res.json();
    const byteChars = atob(dataBase64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err: any) {
    toast.error(err.message || "Could not open blueprint");
  }
}

// Extracted out of the (now hidden, see hideTable below) MasterPage table's
// onPrint prop so the custom grouped table's own Print button can call it
// directly.
function printRoom(row: RecordWithId) {
  const win = window.open("", "_blank", "width=600,height=400");
  if (!win) return;
  win.document.write(safeHtml`
    <html><head><title>Room — ${row.roomName}</title>
    <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
    </head><body><h2>Room Card</h2><table>
      <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
      <tr><td>Block</td><td>${row.blockName || "—"}</td></tr>
      <tr><td>Unit</td><td>${row.unitName || "—"}</td></tr>
      <tr><td>Room Name</td><td>${row.roomName || "—"}</td></tr>
      <tr><td>Floor</td><td>${row.floor || "—"}</td></tr>
      <tr><td>Status</td><td>${row.isActive ? "Active" : "Inactive"}</td></tr>
    </table></body></html>
  `);
  win.document.close();
  win.print();
}

// The "custom" field's render prop is just a function, not a component, so
// it can't hold a ref/hook itself — pulled out into its own component so a
// hidden <input type="file"> + a normal styled <button> can drive it. The
// native input's own "block w-full" + pseudo-element styling used to leave
// a full-row invisible click target (clicking anywhere past the visible
// "Choose File"/"No file chosen" text still opened the picker) and its
// browser-default button never matched the app's own controls — this
// button-triggers-hidden-input pattern fixes both at once.
function BlueprintUploadField({
  value,
  onChange,
  formData,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  formData?: Record<string, unknown>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const pendingFile = value as File | undefined;
  const existingName = formData?.blueprintFileName as string | undefined;
  const existingId = formData?._id as string | undefined;
  return (
    <div className="space-y-2">
      {pendingFile ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <Upload size={13} className="text-muted-foreground shrink-0" />
          <span className="flex-1 truncate">{pendingFile.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">Will upload on save</span>
        </div>
      ) : existingName ? (
        <button
          type="button"
          onClick={() => existingId && openBlueprint(existingId)}
          className="flex items-center gap-2 w-full rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/40 transition-colors text-left"
        >
          <FileText size={13} className="text-muted-foreground shrink-0" />
          <span className="flex-1 truncate font-medium text-foreground">{existingName}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">View current</span>
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">No blueprint uploaded yet.</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={BLUEPRINT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!BLUEPRINT_MIME_TYPES.has(file.type)) {
            toast.error("Blueprint must be a PDF, JPG, or PNG file");
            e.target.value = "";
            return;
          }
          onChange(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-background text-foreground hover:bg-muted/40 transition-colors"
      >
        <Upload size={12} />
        {pendingFile || existingName ? "Replace file" : "Choose file"}
      </button>
    </div>
  );
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function fetchRooms(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch rooms");
  return res.json().catch(() => []);
}

async function fetchProjectOptions(): Promise<
  { value: string; label: string }[]
> {
  const res = await fetchWithAuth(`${API}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => []);
  return data.map((p) => ({ value: String(p.Id), label: p.Name }));
}

type UnitOption = {
  Id: number;
  Name: string;
  ProjectId: number;
  BlockId: number;
  BlockName: string | null;
  UnitType: string | null;
  FloorNo: number | null;
};

// 0 = Ground -> "G", otherwise the numbered floor, same convention
// CrmProjectAutoSetupFloor.FloorLabel and the backend's own Floor-derivation
// (roomMaster.js POST/PUT/generate) already use — kept in sync here purely
// for display, the actual stored value always comes from the server.
function floorLabel(floorNo: number | null | undefined): string | null {
  if (floorNo == null) return null;
  return floorNo === 0 ? "G" : String(floorNo);
}

type UnitRoomsResponse = {
  unit: { Id: number; UnitName: string; UnitType: string | null };
  template: { quantity: number; alias: string }[];
  existing: { Id: number; RoomName: string; IsActive: boolean; BlueprintFileName: string | null }[];
};

async function fetchUnitRooms(unitId: string): Promise<UnitRoomsResponse> {
  const res = await fetchWithAuth(`${API}/unit-rooms/${unitId}`);
  if (!res.ok) throw new Error("Failed to fetch this unit's rooms");
  return res.json();
}

// Preview of a unit's room template (from Unit Composition, keyed off its
// Unit Type) next to what's already been created for it, with a one-click
// bulk-create — this is what replaces the old one-room-at-a-time flow for
// the common case of "generate every room this unit's layout calls for".
// The Add Room form below still exists for anything the template doesn't
// cover.
function UnitRoomConfigCard({ unitId }: { unitId: string }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["room-master-unit-rooms", unitId],
    queryFn: () => fetchUnitRooms(unitId),
  });

  const templateTotal = (data?.template ?? []).reduce((s, r) => s + r.quantity, 0);
  const activeExisting = (data?.existing ?? []).filter((r) => r.IsActive);
  const allCreated = templateTotal > 0 && activeExisting.length >= templateTotal;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`${API}/generate/${unitId}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to create rooms");
      toast.success(body.message || "Rooms created");
      await qc.invalidateQueries({ queryKey: ["room-master-unit-rooms", unitId] });
      await qc.invalidateQueries({ queryKey: ["room-master"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create rooms");
    } finally {
      setGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 size={12} className="animate-spin" /> Loading room configuration…
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Room Configuration{data.unit.UnitType ? ` — ${data.unit.UnitType}` : ""}
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || templateTotal === 0 || allCreated}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-cyan-500 to-teal-400 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {allCreated ? "All rooms created" : "Create Rooms"}
        </button>
      </div>

      {data.template.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {data.unit.UnitType
            ? `No room template set up for "${data.unit.UnitType}" — configure one in Unit Composition first.`
            : "This unit has no Unit Type set — set one in Unit Master first."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {data.template.map((t) => (
            <span key={t.alias} className="text-xs font-medium bg-background border border-border px-2 py-1 rounded-lg">
              {t.alias} <span className="text-muted-foreground">×{t.quantity}</span>
            </span>
          ))}
        </div>
      )}

      {activeExisting.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {activeExisting.length} room{activeExisting.length === 1 ? "" : "s"} already tagged to this unit:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {activeExisting.map((r) => (
              <span
                key={r.Id}
                className="inline-flex items-center gap-1 text-[11px] bg-background border border-border px-2 py-0.5 rounded-full"
              >
                <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                {r.RoomName}
                {r.BlueprintFileName && (
                  <button
                    type="button"
                    onClick={() => openBlueprint(r.Id)}
                    className="text-primary hover:underline"
                    title="View blueprint"
                  >
                    <FileText size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Bulk counterpart of the per-unit "Create Rooms" above: builds the rooms of
// every unit in a project (or one block) from each unit's own Unit
// Composition layout. For units that existed before rooms were generated
// automatically — units created from now on get theirs at creation.
// Idempotent/add-only server-side (roomMaster.js POST /generate-bulk).
function BulkGenerateRoomsPanel({ units }: { units: UnitOption[] }) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = React.useState("");
  const [blockId, setBlockId] = React.useState("");
  const [running, setRunning] = React.useState(false);

  const { data: projects = [] } = useQuery<{ Id: number; Name: string }[]>({
    queryKey: ["room-master-projects"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/projects`);
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json().catch(() => []);
    },
    staleTime: 10 * 60 * 1000,
  });

  const projectIdsWithUnits = React.useMemo(() => new Set(units.map((u) => String(u.ProjectId))), [units]);
  const projectOptions = projects.filter((p) => projectIdsWithUnits.has(String(p.Id)));
  const blockOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    units.filter((u) => String(u.ProjectId) === projectId)
      .forEach((u) => m.set(String(u.BlockId), u.BlockName ?? `Block ${u.BlockId}`));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [units, projectId]);
  const unitCount = units.filter((u) => String(u.ProjectId) === projectId && (!blockId || String(u.BlockId) === blockId)).length;

  const handleRun = async () => {
    if (!projectId) return;
    const scope = blockId ? blockOptions.find(([id]) => id === blockId)?.[1] ?? "this block" : "this project";
    if (!window.confirm(`Generate rooms for all ${unitCount} unit(s) in ${scope} from their Unit Composition layouts? Existing rooms are kept; only missing ones are added.`)) return;
    setRunning(true);
    try {
      const res = await fetchWithAuth(`${API}/generate-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId, 10), BlockId: blockId ? parseInt(blockId, 10) : null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to generate rooms");
      if (body.failed?.length) toast.warning(body.message);
      else toast.success(body.message || "Rooms generated");
      await qc.invalidateQueries({ queryKey: ["room-master"] });
      await qc.invalidateQueries({ queryKey: ["room-master-unit-rooms"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate rooms");
    } finally {
      setRunning(false);
    }
  };

  const selectCls = "h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary min-w-[10rem]";
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[14rem]">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Generate Rooms in Bulk</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Builds every unit's rooms from its Unit Composition layout. Only adds what's missing.
        </p>
      </div>
      <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockId(""); }} className={selectCls}>
        <option value="">Select Project</option>
        {projectOptions.map((p) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
      </select>
      <select value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={!projectId} className={`${selectCls} disabled:opacity-50`}>
        <option value="">All Blocks</option>
        {blockOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <button
        type="button"
        onClick={handleRun}
        disabled={!projectId || running || unitCount === 0}
        className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-gradient-to-r from-cyan-500 to-teal-400 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {running ? "Generating…" : projectId ? `Generate for ${unitCount} unit(s)` : "Generate"}
      </button>
    </div>
  );
}

type UnitRoomGroup = {
  key: string;
  unitId: string;
  projectId: string;
  blockId: string;
  projectName: string;
  blockName: string;
  unitName: string;
  floorNo: number | null;
  bhkType: string | null;
  rooms: RecordWithId[];
};

// One collapsible level of the Room Records tree (Project / Block / Floor),
// indented by depth, with its rolled-up unit and room counts.
function TreeRow({ depth, expanded, onToggle, icon, label, units, rooms, strong = false, custom = false, chips, onEditLayout, editing = false }: {
  depth: number; expanded: boolean; onToggle: () => void; icon: React.ReactNode;
  label: string; units: number; rooms: number; strong?: boolean;
  custom?: boolean; chips?: React.ReactNode; onEditLayout?: () => void; editing?: boolean;
}) {
  return (
    <div className={`flex items-center hover:bg-muted/20 transition-colors ${strong ? "bg-muted/10" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex-1 min-w-0 flex items-center gap-2.5 pr-2 py-2 text-left"
        style={{ paddingLeft: 16 + depth * 20 }}
      >
        {expanded ? <ChevronDown size={13} className="text-muted-foreground shrink-0" /> : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
        {icon}
        <span className={`text-sm truncate ${strong ? "font-semibold" : "font-medium"} text-foreground`}>{label}</span>
        {custom && <CustomBadge />}
        {chips}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{units} unit{units === 1 ? "" : "s"}</span>
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{rooms} room{rooms === 1 ? "" : "s"}</span>
        </span>
      </button>
      {onEditLayout ? <EditLayoutButton onClick={onEditLayout} active={editing} /> : <span className="w-[92px] shrink-0" />}
    </div>
  );
}

function CustomBadge() {
  return (
    <span className="text-[9px] font-semibold uppercase tracking-wide bg-violet-500/15 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded shrink-0"
      title="This level has its own layout (overrides the one above)">
      Custom
    </span>
  );
}

function EditLayoutButton({ onClick, active = false }: { onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={active}
      className={`mr-3 shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
        active ? "border-cyan-500 text-cyan-600 dark:text-cyan-400 bg-cyan-500/10" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
      title="View / set this level's room layout">
      <LayoutGrid size={11} /> Layout
    </button>
  );
}

// "2 BHK · 6" chips: rooms per unit this level defines for each type in it.
function LayoutChips({ items }: { items: { label: string; total: number; text: string }[] }) {
  if (!items.length) return null;
  return (
    <span className="hidden md:flex items-center gap-1 min-w-0 overflow-hidden">
      {items.map((i) => (
        <span key={i.label} title={`${i.label}: ${i.text || "no rooms"}`}
          className="text-[10px] text-muted-foreground border border-border px-1.5 py-0.5 rounded shrink-0">
          {i.label} · {i.total}
        </span>
      ))}
    </span>
  );
}

// Sentinel for a unit with no FloorNo set — real floor numbers are >= 0
// (0 = Ground), so this can never collide with an actual value.
const NO_FLOOR = "__none__";

// ── Fields ────────────────────────────────────────────────────────────────────
// A real cascade — Project -> Block -> Floor -> Unit — instead of a flat
// Unit dropdown with Block/Floor shown read-only afterwards. All four levels
// come from the same __units list (Unit Master, populated by CRM Auto
// Project Setup), filtered client-side at each step rather than round-
// tripping to /structure or /floor-units per selection. Block/Floor are
// still re-derived from the chosen Unit server-side on save (roomMaster.js
// POST/PUT) — these selects are purely a faster way to land on the right
// unit, not something the server trusts blindly.
const fields: FieldDef[] = [
  {
    name: "projectId",
    label: "Project",
    type: "select",
    required: true,
    asyncOptions: fetchProjectOptions,
  },
  {
    name: "blockId",
    label: "Block",
    type: "select",
    required: true,
    disabledWhen: (form) => !form?.projectId,
    disabledPlaceholder: "Select a project first",
    optionsProvider: (_data, _currentId, form) => {
      const units: UnitOption[] = (form?.__units as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      const seen = new Map<string, string>();
      units
        .filter((u) => (selectedProject ? String(u.ProjectId) === selectedProject : true))
        .forEach((u) => {
          if (u.BlockId != null) seen.set(String(u.BlockId), u.BlockName || `Block ${u.BlockId}`);
        });
      return Array.from(seen, ([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
  },
  {
    name: "floorId",
    label: "Floor",
    type: "select",
    required: true,
    disabledWhen: (form) => !form?.blockId,
    disabledPlaceholder: "Select a block first",
    optionsProvider: (_data, _currentId, form) => {
      const units: UnitOption[] = (form?.__units as any) ?? [];
      const selectedBlock = form?.blockId as string | undefined;
      if (!selectedBlock) return [];
      const floorNos = new Set<number | null>();
      units
        .filter((u) => String(u.BlockId) === selectedBlock)
        .forEach((u) => floorNos.add(u.FloorNo));
      return Array.from(floorNos)
        .sort((a, b) => (a ?? -Infinity) - (b ?? -Infinity))
        .map((f) => ({
          value: f == null ? NO_FLOOR : String(f),
          label: f == null ? "No Floor" : `Floor ${floorLabel(f)}`,
        }));
    },
  },
  {
    name: "unitId",
    label: "Unit",
    type: "select",
    required: true,
    disabledWhen: (form) => !form?.floorId,
    disabledPlaceholder: "Select a floor first",
    optionsProvider: (_data, _currentId, form) => {
      const units: UnitOption[] = (form?.__units as any) ?? [];
      const selectedBlock = form?.blockId as string | undefined;
      const selectedFloor = form?.floorId as string | undefined;
      if (!selectedBlock || !selectedFloor) return [];
      return units
        .filter((u) => {
          if (String(u.BlockId) !== selectedBlock) return false;
          return selectedFloor === NO_FLOOR ? u.FloorNo == null : String(u.FloorNo) === selectedFloor;
        })
        .map((u) => ({ value: String(u.Id), label: u.Name }));
    },
  },
  // Rooms are created exclusively from the unit's template below (Create
  // Rooms) — there's no more manual "type a Room Name and Save" path, so
  // that field was removed; canCreate is hardcoded false on MasterPage to
  // match (the Save button only ever does Edit now).
  {
    name: "roomConfigPreview",
    label: "Room Configuration",
    type: "custom",
    fullWidth: true,
    render: ({ formData }) => {
      const unitId = formData?.unitId as string | undefined;
      if (!unitId) return null;
      return <UnitRoomConfigCard unitId={unitId} />;
    },
  },
  {
    name: "blueprintUpload",
    label: "Blueprint (PDF, JPG or PNG)",
    type: "custom",
    fullWidth: true,
    render: ({ value, onChange, formData }) => (
      <BlueprintUploadField value={value} onChange={onChange} formData={formData} />
    ),
  },
  {
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "projectName", label: "Project" },
  { key: "blockName", label: "Block" },
  { key: "unitName", label: "Unit" },
  { key: "roomName", label: "Room Name" },
  { key: "floor", label: "Floor" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Unit", accessor: "unitName" },
  { header: "Room Name", accessor: "roomName" },
  { header: "Floor", accessor: "floor" },
  { header: "Status", accessor: "isActive" },
];

// Shared between MasterPage's own view modal (viewConfig, still reachable
// while the Add/Edit form is open) and the custom grouped table's own View
// dialog below, so the two never drift apart.
const roomViewFields: {
  key: string;
  label: string;
  render?: (val: unknown, row: RecordWithId) => React.ReactNode;
}[] = [
  { key: "projectName", label: "Project" },
  { key: "blockName", label: "Block" },
  { key: "unitName", label: "Unit" },
  { key: "roomName", label: "Room Name" },
  { key: "floor", label: "Floor" },
  { key: "isActive", label: "Status" },
  {
    key: "blueprintFileName",
    label: "Blueprint",
    render: (val, row) =>
      val ? (
        <button
          type="button"
          onClick={() => openBlueprint(row._id)}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <FileText size={13} className="shrink-0" />
          <span className="truncate">{String(val)}</span>
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">Not uploaded</p>
      ),
  },
];

// ── Component ─────────────────────────────────────────────────────────────────
const RoomMaster: React.FC = () => {
  const rights = usePageRights("civilworkdpr-room-master");
  const queryClient = useQueryClient();

  const {
    data: rooms,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["room-master"],
    queryFn: fetchRooms,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all units once — passed into form as __units so optionsProvider /
  // the read-only block+floor displays can filter & look up by id, and
  // reused below for the Generate Rooms panel's own Project/Unit pickers.
  const { data: allUnits = [] } = useQuery<UnitOption[]>({
    queryKey: ["room-master-units"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/units`);
      if (!res.ok) throw new Error("Failed to fetch units");
      return res.json().catch(() => []);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Backend → frontend shape; also inject __units so optionsProvider/render can see them
  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(rooms)) return [];
    return rooms.map((item) => ({
      _id: String(item.Id),
      projectId: String(item.ProjectId),
      projectName: item.ProjectName ?? "",
      blockId: String(item.BlockId),
      blockName: item.BlockName ?? "",
      // Floor cascade field expects the raw FloorNo ("0" for Ground, NO_FLOOR
      // sentinel for none) — item.Floor is the display label ("G", "3", …)
      // computed server-side at save time, so undo floorLabel's "G" mapping
      // to get back to a value the Floor select's options actually contain.
      floorId: item.Floor === "G" ? "0" : item.Floor ? String(item.Floor) : NO_FLOOR,
      unitId: String(item.UnitId),
      unitName: item.UnitName ?? "",
      roomName: item.RoomName ?? "",
      roomCategoryId: item.RoomCategoryId ?? null,
      floor: item.Floor ?? "",
      isActive: Boolean(item.IsActive),
      blueprintFileName: item.BlueprintFileName ?? null,
      blueprintMimeType: item.BlueprintMimeType ?? null,
    }));
  }, [rooms]);

  // Rooms grouped by their owning Unit — collapsible, same "PO grouping its
  // GRNs" pattern GRN.tsx uses. Sorted by Project/Block/Unit so the list
  // reads in the same order the old flat table's default sort did.
  const { data: projectList = [] } = useQuery<{ Id: number; Name: string }[]>({
    queryKey: ["room-master-projects"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/projects`);
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json().catch(() => []);
    },
    staleTime: 10 * 60 * 1000,
  });

  const roomGroups = React.useMemo(() => {
    const projectName = new Map(projectList.map((p) => [String(p.Id), p.Name]));
    const map = new Map<string, UnitRoomGroup>();
    // Every active unit is a node — including one with no rooms yet, so a
    // unit that is out of sync with its layout is visible (0/7), not hidden.
    for (const u of allUnits) {
      map.set(`u:${u.Id}`, {
        key: `u:${u.Id}`, unitId: String(u.Id), projectId: String(u.ProjectId), blockId: String(u.BlockId),
        projectName: projectName.get(String(u.ProjectId)) || "", blockName: u.BlockName || "", unitName: u.Name || "",
        floorNo: u.FloorNo ?? null, bhkType: u.UnitType ?? null, rooms: [],
      });
    }
    for (const r of mappedData) {
      const key = `u:${r.unitId}`;
      if (!map.has(key)) {
        // A room whose unit is no longer active — still listed, placed by
        // the room's own Project/Block/Floor.
        const floorNo = r.floor === "G" ? 0 : r.floor ? Number(r.floor) : null;
        map.set(key, {
          key, unitId: r.unitId as string, projectId: r.projectId as string, blockId: r.blockId as string,
          projectName: (r.projectName as string) || "", blockName: (r.blockName as string) || "", unitName: (r.unitName as string) || "",
          floorNo: Number.isFinite(floorNo as number) ? (floorNo as number) : null, bhkType: null, rooms: [],
        });
      }
      const g = map.get(key)!;
      if (!g.projectName && r.projectName) g.projectName = r.projectName as string;
      g.rooms.push(r);
    }
    return Array.from(map.values());
  }, [mappedData, allUnits, projectList]);

  // Room Records as a tree: Project > Block > Floor > Unit > Rooms. Every
  // level collapsible, collapsed by default; counts roll up at each level.
  const roomTree = React.useMemo(() => {
    const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    const projects = new Map<string, { key: string; name: string; blocks: Map<string, { key: string; name: string; floors: Map<string, { key: string; floorNo: number | null; units: UnitRoomGroup[] }> }> }>();
    for (const g of roomGroups) {
      if (!projects.has(g.projectId)) projects.set(g.projectId, { key: `p:${g.projectId}`, name: g.projectName || `Project #${g.projectId}`, blocks: new Map() });
      const p = projects.get(g.projectId)!;
      if (!p.blocks.has(g.blockId)) p.blocks.set(g.blockId, { key: `b:${g.projectId}-${g.blockId}`, name: g.blockName || "—", floors: new Map() });
      const b = p.blocks.get(g.blockId)!;
      const fk = g.floorNo == null ? "none" : String(g.floorNo);
      if (!b.floors.has(fk)) b.floors.set(fk, { key: `f:${g.projectId}-${g.blockId}-${fk}`, floorNo: g.floorNo, units: [] });
      b.floors.get(fk)!.units.push(g);
    }
    const count = (units: UnitRoomGroup[]) => ({ unitCount: units.length, roomCount: units.reduce((s, u) => s + u.rooms.length, 0) });
    return Array.from(projects.values()).sort((a, b) => natural(a.name, b.name)).map((p) => {
      const blocks = Array.from(p.blocks.values()).sort((a, b) => natural(a.name, b.name)).map((b) => {
        const floors = Array.from(b.floors.values())
          .sort((a, c) => (a.floorNo ?? Number.MAX_SAFE_INTEGER) - (c.floorNo ?? Number.MAX_SAFE_INTEGER))
          .map((f) => {
            const units = [...f.units].sort((a, c) => natural(a.unitName, c.unitName));
            return { ...f, units, ...count(units) };
          });
        const all = floors.flatMap((f) => f.units);
        return { key: b.key, blockIdNum: Number(b.key.split("-").pop()), name: b.name, floors, ...count(all) };
      });
      const all = blocks.flatMap((b) => b.floors.flatMap((f) => f.units));
      return { key: p.key, name: p.name, blocks, ...count(all) };
    });
  }, [roomGroups]);

  // Layout overrides of every project in the tree — drives the "Custom"
  // badges. One small request per project.
  const treeProjectIds = React.useMemo(() => roomTree.map((p) => Number(p.key.slice(2))).filter(Number.isInteger), [roomTree]);
  const { data: overrides = [] } = useQuery<LayoutOverrideRow[]>({
    queryKey: ["layout-overrides-project", treeProjectIds],
    queryFn: async () => (await Promise.all(treeProjectIds.map((id) => getProjectOverrides(id)))).flat(),
    enabled: treeProjectIds.length > 0,
    staleTime: 30 * 1000,
  });
  const isCustom = {
    project: (pid: number) => overrides.some((o) => o.ScopeLevel === "PROJECT" && o.ProjectId === pid),
    block: (bid: number) => overrides.some((o) => o.ScopeLevel === "BLOCK" && o.BlockId === bid),
    floor: (bid: number, floorNo: number | null) => floorNo != null && overrides.some((o) => o.ScopeLevel === "FLOOR" && o.BlockId === bid && floorNo >= (o.FloorFrom ?? 0) && floorNo <= (o.FloorTo ?? -1)),
    unit: (uid: number) => overrides.some((o) => o.ScopeLevel === "UNIT" && o.UnitId === uid),
  };

  // Global layouts (Unit Composition) by label — a unit's UnitType is its
  // layout type's Label (migration 477 canonicalized them).
  const { data: layoutTypes = [] } = useQuery<LayoutType[]>({ queryKey: LAYOUT_TYPES_QUERY_KEY, queryFn: getLayoutTypes, staleTime: 60 * 1000 });
  const typeByLabel = React.useMemo(() => new Map(layoutTypes.map((t) => [t.label, t])), [layoutTypes]);
  const { data: roomCategories = [] } = useQuery<RoomCategory[]>({ queryKey: ["room-categories-options"], queryFn: getRoomCategoryOptions, staleTime: 5 * 60 * 1000 });

  // Types present among some units, with counts — for a node's chips / editor.
  const typesOf = React.useCallback((units: UnitRoomGroup[]): NodeType[] => {
    const counts = new Map<string, number>();
    for (const u of units) if (u.bhkType) counts.set(u.bhkType, (counts.get(u.bhkType) || 0) + 1);
    return [...counts.entries()].map(([label, n]) => typeByLabel.get(label) && ({
      layoutTypeId: typeByLabel.get(label)!.id, label, units: n, global: typeByLabel.get(label)!.composition ?? [],
    })).filter(Boolean).sort((a, b) => (a as NodeType).label.localeCompare((b as NodeType).label, undefined, { numeric: true })) as NodeType[];
  }, [typeByLabel]);

  // What each type gets AT this level (ignoring exceptions below it).
  const chipsFor = (types: NodeType[], pos: Position, level: Level) => types.map((t) => {
    const r = resolveLayout(overrides, t.global, t.layoutTypeId, pos, level);
    return { label: t.label, total: roomTotal(r.composition), text: compositionText(r.composition) };
  });

  // Rooms a unit SHOULD have (its effective layout) vs what it has.
  const expectedRooms = (g: UnitRoomGroup) => {
    const t = g.bhkType ? typeByLabel.get(g.bhkType) : undefined;
    if (!t) return null;
    const r = resolveLayout(overrides, t.composition ?? [], t.id, {
      projectId: Number(g.projectId), blockId: Number(g.blockId), floorNo: g.floorNo, unitId: Number(g.unitId),
    });
    return roomTotal(r.composition);
  };

  // One inline layout editor open at a time; switching away from unsaved
  // changes asks first.
  const [editing, setEditing] = React.useState<{ key: string; level: Level; position: Position & { projectId: number }; types: NodeType[] } | null>(null);
  const editingDirty = React.useRef(false);
  const onDirtyChange = React.useCallback((d: boolean) => { editingDirty.current = d; }, []);
  const toggleEditor = (next: { key: string; level: Level; position: Position & { projectId: number }; types: NodeType[] }) => {
    if (editing?.key === next.key) {
      if (editingDirty.current && !window.confirm("Discard the unsaved layout changes?")) return;
      editingDirty.current = false;
      setEditing(null);
      return;
    }
    if (editing && editingDirty.current && !window.confirm("Discard the unsaved layout changes?")) return;
    editingDirty.current = false;
    setEditing(next);
  };
  const closeEditor = React.useCallback(() => { editingDirty.current = false; setEditing(null); }, []);
  const editorFor = (key: string) => editing?.key === key && (
    <InlineLayoutEditor
      key={key}
      level={editing.level}
      position={editing.position}
      types={editing.types}
      overrides={overrides}
      categories={roomCategories}
      canEdit={rights.canEdit}
      onClose={closeEditor}
      onDirtyChange={onDirtyChange}
    />
  );

  const allTreeKeys = React.useMemo(() => {
    const keys: string[] = [];
    for (const p of roomTree) {
      keys.push(p.key);
      for (const b of p.blocks) {
        keys.push(b.key);
        for (const f of b.floors) {
          keys.push(f.key);
          for (const u of f.units) keys.push(u.key);
        }
      }
    }
    return keys;
  }, [roomTree]);

  // Collapsed by default — the same reasoning as every other "N rows under
  // one parent" list in this app (Work Allocation's dependency chains,
  // Approval Inbox's per-module groups): a flat 21-row table was the actual
  // complaint, not any one unit's own room count.
  const [expandedUnits, setExpandedUnits] = React.useState<Set<string>>(new Set());
  const toggleUnit = (key: string) =>
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Edit re-opens MasterPage's own Add/Edit form from outside — the table
  // itself is hidden (hideTable below) in favour of this grouped view, so
  // there's no in-table Edit button to click anymore.
  const [requestEditId, setRequestEditId] = React.useState<string | null>(null);
  const [requestEditKey, setRequestEditKey] = React.useState(0);
  const requestEdit = (id: string) => {
    setRequestEditId(id);
    setRequestEditKey((k) => k + 1);
  };
  const [viewRoom, setViewRoom] = React.useState<RecordWithId | null>(null);
  const [deletingRoom, setDeletingRoom] = React.useState<RecordWithId | null>(null);

  // externalFormPatch injects __units into the form so optionsProvider/render can filter/look up
  const unitsPatch = React.useMemo(() => ({ __units: allUnits }), [allUnits]);

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    UnitId: parseInt(r.unitId),
    RoomName: r.roomName?.trim() || null,
    IsActive: r.isActive !== false,
  });

  // Blueprint upload is a separate multipart request, kept out of
  // toPayload's plain-JSON body (a File can't be JSON.stringify'd
  // meaningfully) — fired right after the room record itself is
  // created/updated, once its id is known. A failure here is reported but
  // doesn't roll back the room save, same as Loan Sanction's own
  // document-attach-after-create flow.
  const uploadBlueprintIfStaged = async (roomId: string, record: Record<string, unknown>) => {
    const file = record.blueprintUpload as File | undefined;
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchWithAuth(`${API}/${roomId}/blueprint`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Blueprint upload failed");
    }
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      // Read the body ONCE — ReadableStream can only be consumed once.
      // Previously: error-check path consumed body first, then the success
      // path tried to read it again and always got {}, so body.id was always
      // undefined and the blueprint upload received "undefined" as roomId.
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any).error || "Failed to add room");
      const newId = (body as any).id;
      if (!newId) throw new Error("Server did not return the new room ID");
      toast.success("Room added!");
      try {
        await uploadBlueprintIfStaged(String(newId), event.record);
      } catch (err: any) {
        toast.error(`Room saved, but blueprint upload failed: ${err.message}`);
      }
    }
    if (event.action === "update") {
      // toPayload's RoomName is always null now (the field is gone from the
      // form) — carry the room's existing name through instead, since the
      // backend still requires it and this form no longer edits it.
      const existing = mappedData.find((m) => m._id === event.id);
      const payload = { ...toPayload(event.record), RoomName: (existing?.roomName as string) || null };
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to update room");
      toast.success("Room updated!");
      try {
        await uploadBlueprintIfStaged(event.id, event.record);
      } catch (err: any) {
        toast.error(`Room updated, but blueprint upload failed: ${err.message}`);
      }
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "DELETE",
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to delete room");
      toast.success("Room deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["room-master"] });
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading rooms...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load rooms.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Setup", "Flat Master"]} />
      <CivilWorkDprShell
        title="Flat Master"
        icon={DoorOpen}
      >
      {rights.canCreate && <BulkGenerateRoomsPanel units={allUnits} />}
      <MasterPage
        title="Room"
        // Rooms are only ever created via the Room Configuration card's
        // "Create Rooms" (template-driven) — the manual Save-a-new-room path
        // is gone, so Save is disabled in Add mode regardless of the create
        // right. Edit still works, for toggling Active / swapping a blueprint.
        canCreate={false}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        // The records table itself is hidden in favour of the grouped-by-
        // Unit view below — requestEditId/requestEditKey re-opens this same
        // Add/Edit form from that view's own Edit button, exactly as if a
        // (now nonexistent) in-table Edit button had been clicked.
        hideTable
        requestEditId={requestEditId}
        requestEditKey={requestEditKey}
        // Inject __units + cascade-reset the fields below whichever level changed
        externalFormPatch={unitsPatch}
        externalFormPatchKey={allUnits.length}
        onFieldChange={(form, fieldName) => {
          if (fieldName === "projectId") {
            return { ...form, blockId: "", floorId: "", unitId: "" };
          }
          if (fieldName === "blockId") {
            return { ...form, floorId: "", unitId: "" };
          }
          if (fieldName === "floorId") {
            return { ...form, unitId: "" };
          }
          return form;
        }}
      />

      {/* ── Room Records — grouped by Unit, collapsible, same "PO groups its
          GRNs" pattern GRN.tsx uses. Row-level actions (View/Print/Edit/
          Delete) are unchanged from the old flat table, just reached from
          here instead. ── */}
      <div className="mt-4 rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/20">
          <div>
            <p className="text-sm font-heading font-semibold text-foreground">Room Records</p>
            <p className="text-[11px] text-muted-foreground">{mappedData.length} record{mappedData.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex items-center gap-2">
          {roomTree.length > 0 && (
            <>
              <button type="button" onClick={() => setExpandedUnits(new Set(allTreeKeys))}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Expand all
              </button>
              <button type="button" onClick={() => setExpandedUnits(new Set())}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Collapse all
              </button>
            </>
          )}
          <ExportMenu
            data={mappedData}
            columns={exportColumns}
            title="Flat Master"
            filename="room-master"
            disabled={mappedData.length === 0}
          />
          </div>
        </div>

        {roomGroups.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No rooms recorded yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {roomTree.map((p) => (
              <div key={p.key}>
                {(() => {
                  const pos = { projectId: Number(p.key.slice(2)) };
                  const types = typesOf(p.blocks.flatMap((b) => b.floors.flatMap((f) => f.units)));
                  return (
                    <TreeRow depth={0} expanded={expandedUnits.has(p.key)} onToggle={() => toggleUnit(p.key)}
                      icon={<FolderTree size={13} className="text-violet-500 shrink-0" />} label={p.name} units={p.unitCount} rooms={p.roomCount} strong
                      custom={isCustom.project(pos.projectId)} chips={<LayoutChips items={chipsFor(types, pos, "PROJECT")} />}
                      editing={editing?.key === p.key}
                      onEditLayout={() => toggleEditor({ key: p.key, level: "PROJECT", position: pos, types })} />
                  );
                })()}
                {editorFor(p.key)}
                {expandedUnits.has(p.key) && p.blocks.map((b) => (
                  <div key={b.key}>
                    {(() => {
                      const pos = { projectId: Number(p.key.slice(2)), blockId: b.blockIdNum };
                      const types = typesOf(b.floors.flatMap((f) => f.units));
                      return (
                        <TreeRow depth={1} expanded={expandedUnits.has(b.key)} onToggle={() => toggleUnit(b.key)}
                          icon={<Building size={13} className="text-sky-500 shrink-0" />} label={`Block ${b.name}`} units={b.unitCount} rooms={b.roomCount}
                          custom={isCustom.block(b.blockIdNum)} chips={<LayoutChips items={chipsFor(types, pos, "BLOCK")} />}
                          editing={editing?.key === b.key}
                          onEditLayout={() => toggleEditor({ key: b.key, level: "BLOCK", position: pos, types })} />
                      );
                    })()}
                    {editorFor(b.key)}
                    {expandedUnits.has(b.key) && b.floors.map((f) => (
                      <div key={f.key}>
                        {(() => {
                          const pos = { projectId: Number(p.key.slice(2)), blockId: b.blockIdNum, floorNo: f.floorNo };
                          const types = typesOf(f.units);
                          return (
                            <TreeRow depth={2} expanded={expandedUnits.has(f.key)} onToggle={() => toggleUnit(f.key)}
                              icon={<Layers size={13} className="text-amber-500 shrink-0" />}
                              label={f.floorNo == null ? "No floor" : f.floorNo === 0 ? "Ground Floor" : `Floor ${f.floorNo}`}
                              units={f.unitCount} rooms={f.roomCount}
                              custom={isCustom.floor(b.blockIdNum, f.floorNo)}
                              chips={f.floorNo == null ? undefined : <LayoutChips items={chipsFor(types, pos, "FLOOR")} />}
                              editing={editing?.key === f.key}
                              onEditLayout={f.floorNo == null ? undefined : () => toggleEditor({ key: f.key, level: "FLOOR", position: pos, types })} />
                          );
                        })()}
                        {editorFor(f.key)}
                        {expandedUnits.has(f.key) && f.units.map((g) => {
                          const expanded = expandedUnits.has(g.key);
                          return (
                            <div key={g.key}>
                              <div className="flex items-center hover:bg-muted/20 transition-colors">
                              <button
                                type="button"
                                onClick={() => toggleUnit(g.key)}
                                className="flex-1 min-w-0 flex items-center gap-2.5 pr-2 py-2 text-left"
                                style={{ paddingLeft: 16 + 3 * 20 }}
                              >
                                {expanded ? (
                                  <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight size={13} className="text-muted-foreground shrink-0" />
                                )}
                                <Building2 size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                                <span className="text-sm font-medium text-foreground">{g.unitName || "—"}</span>
                                {g.bhkType && (
                                  <span className="text-[10px] font-medium text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full shrink-0">
                                    {g.bhkType}
                                  </span>
                                )}
                                {isCustom.unit(Number(g.unitId)) && <CustomBadge />}
                                {(() => {
                                  // layout rooms only — a custom room with no category (e.g. "Pooja Room") is
                                  // an intentional extra the sync never touches, not a mismatch
                                  const active = g.rooms.filter((r) => r.isActive && r.roomCategoryId != null).length;
                                  const exp = expectedRooms(g);
                                  return exp != null && active !== exp ? (
                                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full shrink-0"
                                      title={`Has ${active} active room(s); its layout calls for ${exp}. Run "Generate" in Generate Rooms in Bulk, or check the layout.`}>
                                      <AlertTriangle size={10} /> {active}/{exp} rooms
                                    </span>
                                  ) : (
                                    <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                                      {g.rooms.length} room{g.rooms.length === 1 ? "" : "s"}
                                    </span>
                                  );
                                })()}
                              </button>
                              {g.bhkType && typeByLabel.get(g.bhkType) ? (
                                <EditLayoutButton active={editing?.key === g.key} onClick={() => toggleEditor({
                                  key: g.key, level: "UNIT",
                                  position: { projectId: Number(g.projectId), blockId: Number(g.blockId), floorNo: g.floorNo, unitId: Number(g.unitId) },
                                  types: typesOf([g]),
                                })} />
                              ) : <span className="w-[92px] shrink-0" />}
                              </div>
                              {editorFor(g.key)}

                              {expanded && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-border text-left text-[11px] font-heading font-semibold text-muted-foreground uppercase tracking-wide bg-muted/10">
                                        <th className="pr-3 py-2" style={{ paddingLeft: 16 + 4 * 20 + 8 }}>Room Name</th>
                                        <th className="px-3 py-2">Floor</th>
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-5 py-2 text-right">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {g.rooms.map((room) => (
                                        <tr key={room._id} className="border-b border-border last:border-0 hover:bg-muted/10">
                                          <td className="pr-3 py-2.5 font-medium text-foreground" style={{ paddingLeft: 16 + 4 * 20 + 8 }}>{room.roomName as string}</td>
                                          <td className="px-3 py-2.5 text-muted-foreground">{(room.floor as string) || "—"}</td>
                                          <td className="px-3 py-2.5">
                                            {room.isActive ? (
                                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Active
                                              </span>
                                            ) : (
                                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                                <span className="w-1.5 h-1.5 rounded-full bg-border inline-block" />Inactive
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-5 py-2.5">
                                            <div className="flex items-center justify-end gap-1">
                                              <button
                                                onClick={() => setViewRoom(room)}
                                                className="p-1.5 rounded-lg text-sky-500 hover:bg-sky-500/10 transition-colors"
                                                title="View"
                                              >
                                                <Eye size={13} />
                                              </button>
                                              <button
                                                onClick={() => printRoom(room)}
                                                className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors"
                                                title="Print"
                                              >
                                                <Printer size={13} />
                                              </button>
                                              {rights.canEdit && (
                                                <button
                                                  onClick={() => requestEdit(room._id)}
                                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                                  title="Edit"
                                                >
                                                  <Pencil size={13} />
                                                </button>
                                              )}
                                              {rights.canDelete && (
                                                <button
                                                  onClick={() => setDeletingRoom(room)}
                                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                  title="Delete"
                                                >
                                                  <Trash2 size={13} />
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── View dialog — same fields MasterPage's own viewConfig would have shown ── */}
      <Dialog open={!!viewRoom} onOpenChange={(open) => !open && setViewRoom(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Room Details</DialogTitle>
          </DialogHeader>
          {viewRoom && (
            <div className="space-y-3 pt-1">
              {roomViewFields.map((f) => (
                <div key={f.key} className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{f.label}</p>
                  <div className="text-sm text-foreground">
                    {f.render ? f.render(viewRoom[f.key], viewRoom) : String(viewRoom[f.key] ?? "—")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <Dialog open={!!deletingRoom} onOpenChange={(open) => !open && setDeletingRoom(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Room</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground pt-1">
            Delete <strong>{deletingRoom?.roomName as string}</strong>? This can't be undone.
          </p>
          <DialogFooter className="pt-2">
            <button onClick={() => setDeletingRoom(null)} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              onClick={async () => {
                if (!deletingRoom) return;
                try {
                  await handleDataEvent({ action: "delete", id: deletingRoom._id, records: mappedData });
                } finally {
                  setDeletingRoom(null);
                }
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </CivilWorkDprShell>
    </>
  );
};

export default RoomMaster;

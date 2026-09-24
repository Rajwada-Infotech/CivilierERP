import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Upload, DoorOpen, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
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

// Suggests Room Master's active room-type aliases (the same list Room
// Composition Builder and Work Done's Room dropdown read) instead of typing
// a name from scratch — but stays a real text input, not a strict dropdown,
// because a unit can have more than one room of the same category
// ("Bedroom 1", "Bedroom 2", same convention the template-based generator
// below also respects — each generated room keeps a plain category name so
// it still matches these suggestions) and an existing room's saved name
// still needs to display correctly even once it no longer matches an alias
// exactly.
let roomCategoryOptionsCache: { value: string; label: string }[] | null = null;
function RoomNameField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: unknown) => void;
}) {
  const { data: categories = [] } = useQuery({
    queryKey: ["room-master-room-category-options"],
    queryFn: fetchRoomCategoryOptions,
    staleTime: 5 * 60 * 1000,
    initialData: roomCategoryOptionsCache ?? undefined,
  });
  React.useEffect(() => {
    roomCategoryOptionsCache = categories;
  }, [categories]);

  // Custom suggestion panel instead of a native <datalist> — a datalist's
  // popup is rendered entirely by the browser (plain white list, no way to
  // theme it), which looked jarringly out of place against every other
  // themed dropdown in the app. This keeps the same "pick a suggestion or
  // type your own" behaviour (still a real text input underneath, so
  // "Bedroom 1"/"Bedroom 2" etc. still work) with a panel styled to match.
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const query = (value ?? "").trim().toLowerCase();
  const suggestions = query
    ? categories.filter((c) => c.label.toLowerCase().includes(query))
    : categories;

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Pick a category or type a name"
        className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1">
          {suggestions.map((c) => (
            <button
              key={c.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c.value);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
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

// Same active-categories list Room Composition Builder and Work Done's Room
// dropdown both read (GET /options, ordered by SortOrder) — Room Name now
// picks from here instead of free text, so a room is always named after one
// of the categories actually set up in Room Master.
async function fetchRoomCategoryOptions(): Promise<
  { value: string; label: string }[]
> {
  const res = await fetchWithAuth("/api/room-category-master/options");
  if (!res.ok) throw new Error("Failed to fetch room categories");
  const data: { id: number; categoryName: string; alias: string }[] = await res
    .json()
    .catch(() => []);
  return data.map((c) => ({ value: c.alias, label: c.alias }));
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
  {
    name: "roomName",
    label: "Room Name",
    type: "custom",
    required: true,
    render: ({ value, onChange }) => (
      <RoomNameField value={value as string | undefined} onChange={onChange} />
    ),
  },
  // Once a Unit is picked above, shows that unit's room template (from Unit
  // Composition) and a one-click bulk-create — the fast path for "give me
  // every room this unit's layout calls for" instead of filling Room Name
  // one room at a time. Lives inside this same form (reading the Unit
  // already selected above) rather than as a separate section with its own
  // Project/Unit pickers — a standalone panel like that was tried before and
  // pulled for being clumsy/duplicative; this reuses the form's own Unit.
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
      floor: item.Floor ?? "",
      isActive: Boolean(item.IsActive),
      blueprintFileName: item.BlueprintFileName ?? null,
      blueprintMimeType: item.BlueprintMimeType ?? null,
    }));
  }, [rooms]);

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
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
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
        canCreate={rights.canCreate}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
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
        exportConfig={{
          title: "Flat Master",
          filename: "room-master",
          columns: exportColumns,
        }}
        viewConfig={{
          title: "Room Details",
          fields: [
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
          ],
        }}
        onPrint={(row) => {
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
        }}
      />
      </CivilWorkDprShell>
    </>
  );
};

export default RoomMaster;

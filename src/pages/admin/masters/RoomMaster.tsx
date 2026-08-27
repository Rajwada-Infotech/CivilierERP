import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Sparkles, Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { FollowupShell } from "@/components/followup/FollowupShell";
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
async function openBlueprint(roomId: string) {
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

// Generates real RoomMaster rows for a unit from its BHK layout template
// (Unit Type -> Room Composition Builder's category x quantity, the same
// data Work Reporting's synthetic Room dropdown reads) instead of typing
// each room in by hand. Scoped to Project -> Unit only — Block is implied
// by the unit, same as the create form above.
function GenerateFromLayoutPanel({
  units,
  onGenerated,
}: {
  units: { Id: number; Name: string; ProjectId: number; UnitType?: string | null }[];
  onGenerated: () => void;
}) {
  const [projectId, setProjectId] = React.useState("");
  const [unitId, setUnitId] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const { data: projectOptions = [] } = useQuery({
    queryKey: ["room-master-project-options"],
    queryFn: fetchProjectOptions,
    staleTime: 5 * 60 * 1000,
  });

  const unitOptions = React.useMemo(
    () => units.filter((u) => (projectId ? String(u.ProjectId) === projectId : true)),
    [units, projectId],
  );
  const selectedUnit = unitOptions.find((u) => String(u.Id) === unitId);

  const handleGenerate = async () => {
    if (!unitId) return;
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`${API}/generate/${unitId}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to generate rooms");
      toast.success(body.message || "Rooms generated");
      if (body.createdCount > 0) onGenerated();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate rooms");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
        <Sparkles size={14} className="text-cyan-600 dark:text-cyan-400" />
        <span className="text-sm font-heading font-semibold text-foreground">Generate from Unit Layout</span>
      </div>
      <div className="p-5 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Project</label>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setUnitId("");
            }}
            className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
          >
            <option value="">Select project</option>
            {projectOptions.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unit</label>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!projectId}
            className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm disabled:opacity-50"
          >
            <option value="">Select unit</option>
            {unitOptions.map((u) => (
              <option key={u.Id} value={u.Id}>
                {u.Name}{u.UnitType ? ` (${u.UnitType})` : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!unitId || generating || (!!selectedUnit && !selectedUnit.UnitType)}
          title={selectedUnit && !selectedUnit.UnitType ? "This unit has no Unit Type set" : undefined}
          className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-4 py-2 h-9 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 disabled:opacity-50 transition-all"
        >
          <Sparkles size={13} /> {generating ? "Generating…" : "Generate Rooms"}
        </button>
      </div>
      {selectedUnit && !selectedUnit.UnitType && (
        <p className="px-5 pb-4 -mt-2 text-xs text-amber-600 dark:text-amber-400">
          This unit has no Unit Type set, so its layout can't be resolved — set one in Unit Master first.
        </p>
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

// ── Fields ────────────────────────────────────────────────────────────────────
// Unit is filtered by the selected project. Block is never chosen directly —
// it's whichever block the selected unit belongs to, shown read-only.
const fields: FieldDef[] = [
  {
    name: "projectId",
    label: "Project",
    type: "select",
    required: true,
    asyncOptions: fetchProjectOptions,
  },
  {
    name: "unitId",
    label: "Unit",
    type: "select",
    required: true,
    optionsProvider: (_data, _currentId, form) => {
      const units: { Id: number; Name: string; ProjectId: number }[] =
        (form?.__units as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      return units
        .filter((u) =>
          selectedProject ? String(u.ProjectId) === selectedProject : true,
        )
        .map((u) => ({ value: String(u.Id), label: u.Name }));
    },
  },
  {
    name: "blockNameDisplay",
    label: "Block",
    type: "custom",
    render: ({ formData }) => {
      const units: { Id: number; BlockName: string | null }[] =
        (formData?.__units as any) ?? [];
      const selectedUnit = formData?.unitId as string | undefined;
      const unit = units.find((u) => String(u.Id) === selectedUnit);
      return (
        <div className="text-sm text-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
          {unit?.BlockName || (
            <span className="text-muted-foreground italic">
              Select a unit to see its block
            </span>
          )}
        </div>
      );
    },
  },
  {
    name: "roomName",
    label: "Room Name",
    type: "text",
    required: true,
  },
  {
    name: "floor",
    label: "Floor",
    type: "text",
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
  usePageRights("room-master");
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
  // the read-only block display can filter & look up by id.
  const { data: allUnits = [] } = useQuery<
    { Id: number; Name: string; ProjectId: number; BlockId: number; BlockName: string | null; UnitType: string | null }[]
  >({
    queryKey: ["room-master-units"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/units`);
      if (!res.ok) throw new Error("Failed to fetch units");
      return res.json().catch(() => ({}));
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
    Floor: r.floor?.trim() || null,
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
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to add room");
        const body = await res.json().catch(() => ({}));
        toast.success("Room added!");
        try {
          await uploadBlueprintIfStaged(String(body.id), event.record);
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
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading rooms...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load rooms.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Room Master"]} />
      <FollowupShell title="Room Master">
      <GenerateFromLayoutPanel
        units={allUnits}
        onGenerated={() => queryClient.invalidateQueries({ queryKey: ["room-master"] })}
      />
      <MasterPage
        title="Room"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        // Inject __units + reset unitId when project changes
        externalFormPatch={unitsPatch}
        externalFormPatchKey={allUnits.length}
        onFieldChange={(form, fieldName) => {
          if (fieldName === "projectId") {
            return { ...form, unitId: "" };
          }
          return form;
        }}
        exportConfig={{
          title: "Room Master",
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
      </FollowupShell>
    </>
  );
};

export default RoomMaster;

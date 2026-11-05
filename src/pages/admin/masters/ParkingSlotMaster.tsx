import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/parking-slot-master";
const DROPDOWN_API = "/api/business/dropdown";
const RULE = "1px solid hsl(var(--foreground))";
const NUM = "font-heading tabular-nums";
// A project can belong to several companies (company_ids); company_id is only its primary one. Filtering on it hid a
// project from every company but the first.
const companiesOf = (p: { company_id?: number; company_ids?: string }) =>
  String(p.company_ids ?? p.company_id ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const STATUS_TONE: Record<string, "done" | "waiting" | "stopped" | "draft"> = { Available: "done", "On Hold": "waiting", Booked: "stopped", Allotted: "stopped", Blocked: "draft" };

async function fetchSlots(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || "Failed to load parking slots");
  return Array.isArray(body) ? body : [];
}

// Real, individually numbered parking inventory — distinct from Parking
// Master (which is only the pricing rate). This is what the Parking Matrix
// renders and what a sale actually allots against.
// Company -> Project -> Block, each strictly gated behind its parent
// (disabledWhen in MasterPage.tsx) so this can never fall back to showing
// every row unfiltered.
const FIELDS_SLOT_PREFIX: FieldDef[] = [
  {
    name: "companyId",
    label: "Company",
    type: "select",
    required: true,
    optionsProvider: (_data, _currentId, form) => {
      const companies: { id: number; name: string }[] = (form?.__companies as any) ?? [];
      return companies.map((c) => ({ value: String(c.id), label: c.name }));
    },
  },
  {
    name: "projectId",
    label: "Project",
    type: "select",
    required: true,
    disabledWhen: (form) => !form?.companyId,
    disabledPlaceholder: "Select a Company first",
    optionsProvider: (_data, _currentId, form) => {
      const projects: { id: number; name: string; company_id: number; company_ids?: string }[] = (form?.__projects as any) ?? [];
      const selectedCompany = form?.companyId as string | undefined;
      if (!selectedCompany) return [];
      return projects
        .filter((p) => companiesOf(p).includes(selectedCompany))
        .map((p) => ({ value: String(p.id), label: p.name }));
    },
  },
  {
    name: "blockId",
    label: "Block",
    type: "select",
    disabledWhen: (form) => !form?.projectId,
    disabledPlaceholder: "Select a Project first",
    optionsProvider: (_data, _currentId, form) => {
      const blocks: { Id: number; Name: string; ProjectId: number }[] = (form?.__blocks as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      if (!selectedProject) return [];
      return blocks
        .filter((b) => String(b.ProjectId) === selectedProject)
        .map((b) => ({ value: String(b.Id), label: b.Name }));
    },
  },
  {
    name: "slotNo",
    label: "Slot No.",
    type: "text",
    required: true,
  },
];
const FIELDS_SLOT_SUFFIX: FieldDef[] = [
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
  { key: "slotNo", label: "Slot No." },
  { key: "parkingType", label: "Type" },
  { key: "status", label: "Status", sortable: false },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Slot No.", accessor: "slotNo" },
  { header: "Type", accessor: "parkingType" },
  { header: "Status", accessor: "status" },
];

// Same precedence parkingMatrix.js uses server-side (Blocked > Booked >
// OnHold > Available), computed from the exact lock fields the GET route
// now returns — so this can never drift from what the matrix shows. A slot sold on its own (a standalone allotment, no
// booking) reads "Allotted" — it was called "Booked" with no booking to show.
function computeStatus(item: {
  isActive: boolean;
  lockAllotmentId: number | null;
  lockBookingNo: string | null;
  lockHoldId: number | null;
}): string {
  if (!item.isActive) return "Blocked";
  if (item.lockAllotmentId != null) return item.lockBookingNo ? "Booked" : "Allotted";
  if (item.lockHoldId != null) return "On Hold";
  return "Available";
}

const ParkingSlotMaster: React.FC = () => {
  const rights = usePageRights("followup-parking-slot-master");
  const queryClient = useQueryClient();

  const { data: slots, isLoading, error } = useQuery({
    queryKey: ["parking-slot-master"],
    queryFn: fetchSlots,
    staleTime: 5 * 60 * 1000,
  });

  const { data: parkingTypes = [] } = useQuery<string[]>({
    queryKey: ["parking-master-types"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/parking-master/types");
      return r.ok ? r.json() : [];
    },
    staleTime: 10 * 60 * 1000,
  });

  const fields = React.useMemo<FieldDef[]>(() => [
    ...FIELDS_SLOT_PREFIX,
    {
      name: "parkingType",
      label: "Parking Type",
      type: "select",
      required: true,
      defaultValue: parkingTypes[0] ?? "Open",
      options: parkingTypes,
    } as FieldDef,
    ...FIELDS_SLOT_SUFFIX,
  ], [parkingTypes]);

  const { data: allBlocks = [] } = useQuery<{ Id: number; Name: string; ProjectId: number }[]>({
    queryKey: ["parking-slot-master-blocks"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/unit-master/blocks");
      if (!res.ok) throw new Error("Failed to fetch blocks");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Company -> Project source data for the two new cascade fields above.
  // Same shared dropdown endpoint every other Company->Project chain in the
  // app (BlockMaster.tsx, UnitMaster.tsx, CrmApplication.tsx) already uses.
  const { data: dropdownData } = useQuery<{
    companies: { id: number; name: string }[];
    projects: { id: number; name: string; company_id: number; company_ids?: string }[];
  }>({
    queryKey: ["business-dropdown"],
    queryFn: async () => {
      const res = await fetchWithAuth(DROPDOWN_API);
      if (!res.ok) throw new Error("Failed to fetch company/project dropdown");
      return res.json().catch(() => ({ companies: [], projects: [] }));
    },
    staleTime: 5 * 60 * 1000,
  });
  const companies = dropdownData?.companies ?? [];
  const projectsList = dropdownData?.projects ?? [];

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(slots)) return [];
    return slots.map((item) => {
      const isActive = Boolean(item.IsActive);
      const lockAllotmentId = item.LockAllotmentId ?? null;
      const lockBookingNo = item.LockBookingNo ?? null;
      const lockHoldId = item.LockHoldId ?? null;
      // A slot's own row only carries ProjectId — the Company shown/edited
      // here is derived from the Project's own company_id so an existing
      // slot reopens with the correct Company already selected.
      const project = projectsList.find((p) => p.id === item.ProjectId);
      return {
        _id: String(item.Id),
        companyId: project ? String(project.company_id) : "",
        projectId: String(item.ProjectId),
        projectName: item.ProjectName ?? "",
        blockId: item.BlockId != null ? String(item.BlockId) : "",
        blockName: item.BlockName ?? "",
        slotNo: item.SlotNo ?? "",
        parkingType: item.ParkingType ?? "Open",
        isActive,
        lockAllotmentId,
        lockBookingNo,
        lockHoldId,
        status: computeStatus({ isActive, lockAllotmentId, lockBookingNo, lockHoldId }),
      };
    });
  }, [slots, projectsList]);

  const blocksPatch = React.useMemo(
    () => ({ __blocks: allBlocks, __companies: companies, __projects: projectsList }),
    [allBlocks, companies, projectsList],
  );

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockId: r.blockId ? parseInt(r.blockId) : null,
    SlotNo: r.slotNo?.trim() || null,
    ParkingType: r.parkingType || "Open",
    IsActive: r.isActive !== false,
  });

  // No internal try/catch here — a thrown error must propagate up to
  // MasterPage's own handleSave/handleDelete catch, or a server-side
  // rejection (409 duplicate, 409 locked) gets reported as a success and
  // leaves a phantom row in the table.
  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to add parking slot");
      toast.success("Parking slot added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to update parking slot");
      toast.success("Parking slot updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete parking slot");
      toast.success("Parking slot deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["parking-slot-master"] });
  };

  const count = (st: string) => mappedData.filter((r) => r.status === st).length;
  const noBlock = mappedData.filter((r) => !r.blockId).length;
  const figures = [
    { label: "Slots", value: mappedData.length, note: "in your projects" },
    { label: "Available", value: count("Available"), note: "free to allot" },
    { label: "Booked / held", value: count("Booked") + count("Allotted") + count("On Hold"), note: "locked — not editable here" },
    { label: "No block", value: noBlock, note: "missing from per-block totals", red: noBlock > 0 },
  ];
  const statusMark = (v: unknown) => <SheetMark text={String(v)} tone={STATUS_TONE[String(v)] ?? "waiting"} />;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Parking Slot Master"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Parking slots"
        subtitle="Every numbered parking slot — what the Parking Matrix shows and a sale is allotted against. Its price comes from Parking Master. Booked and held slots are locked."
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {figures.map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading parking slots…</p>
        ) : error ? (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
            {(error as Error)?.message || "Failed to load parking slots."}
          </div>
        ) : (
          <MasterPage
            title="Parking Slot"
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            fields={fields}
            columns={columns}
            columnRenderers={{
              status: (value) => statusMark(value),
              slotNo: (value) => <span className={`${NUM} text-xs font-semibold`}>{String(value ?? "")}</span>,
              blockName: (value) => (value ? <span>{String(value)}</span> : <span className="text-destructive text-xs">No block</span>),
            }}
            initialData={mappedData}
            onDataEvent={handleDataEvent}
            externalFormPatch={blocksPatch}
            externalFormPatchKey={`${allBlocks.length}:${companies.length}:${projectsList.length}`}
            onFieldChange={(form, fieldName) => {
              if (fieldName === "companyId") {
                return { ...form, projectId: "", blockId: "" };
              }
              if (fieldName === "projectId") {
                return { ...form, blockId: "" };
              }
              return form;
            }}
            // A Booked or OnHold slot can't be edited OR deleted — it's an
            // individual inventory item, same treatment as Unit Master.
            isRowLocked={(row) =>
              row.lockAllotmentId != null
                ? row.lockBookingNo
                  ? `Booked (${row.lockBookingNo as string})`
                  : "Currently allotted"
                : row.lockHoldId != null
                  ? "Currently on hold"
                  : null
            }
            exportConfig={rights.canExport ? {
              title: "Parking Slot Master",
              filename: "parking-slot-master",
              columns: exportColumns,
            } : undefined}
            viewConfig={{
              title: "Parking Slot Details",
              fields: [
                { key: "projectName", label: "Project" },
                { key: "blockName", label: "Block" },
                { key: "slotNo", label: "Slot No." },
                { key: "parkingType", label: "Type" },
                { key: "status", label: "Status", render: (v) => statusMark(v) },
              ],
            }}
            onPrint={(row) => {
              const win = window.open("", "_blank", "width=600,height=400");
              if (!win) return;
              win.document.write(safeHtml`
                <html><head><title>Parking Slot — ${row.slotNo}</title>
                <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
                </head><body><h2>Parking Slot</h2><table>
                  <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
                  <tr><td>Block</td><td>${row.blockName || "—"}</td></tr>
                  <tr><td>Slot No.</td><td>${row.slotNo || "—"}</td></tr>
                  <tr><td>Type</td><td>${row.parkingType || "—"}</td></tr>
                  <tr><td>Status</td><td>${row.status}</td></tr>
                </table></body></html>
              `);
              win.document.close();
              win.print();
            }}
          />
        )}
      </SheetShell>
    </>
  );
};

export default ParkingSlotMaster;
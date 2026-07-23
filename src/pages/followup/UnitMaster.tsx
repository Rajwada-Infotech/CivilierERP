import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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

const API = "/api/unit-master";

// Fixed vocabulary shared with every page that consumes Unit Master
// (CrmBooking, etc.) so "Type of Unit" is picked once here and auto-fetched
// everywhere the unit itself is selected — never re-typed per transaction.
const UNIT_TYPES = [
  "1 BHK", "1.5 BHK", "2 BHK", "2.5 BHK", "3 BHK", "3.5 BHK", "4 BHK", "4+ BHK",
  "Studio", "Villa", "Plot", "Commercial", "Other",
];

// ── API helpers ────────────────────────────────────────────────────────────────
async function fetchUnits(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch units");
  return res.json().catch(() => ({}));
}

async function fetchProjectOptions(): Promise<
  { value: string; label: string }[]
> {
  const res = await fetchWithAuth(`${API}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => ({}));
  return data.map((p) => ({ value: String(p.Id), label: p.Name }));
}

// ── Fields — block uses optionsProvider so it can filter by selected project ──
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
    // Filters live off the current form's projectId
    optionsProvider: (_data, _currentId, form) => {
      const blocks: { Id: number; Name: string; ProjectId: number }[] =
        (form?.__blocks as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      return blocks
        .filter((b) =>
          selectedProject ? String(b.ProjectId) === selectedProject : true,
        )
        .map((b) => ({ value: String(b.Id), label: b.Name }));
    },
  },
  {
    name: "unitName",
    label: "Unit Name",
    type: "text",
    required: true,
  },
  {
    name: "defaultPaymentPlanId",
    label: "Default Payment Plan",
    type: "select",
    // Every place a unit gets selected (Application wizard, etc.) auto-fetches
    // and locks this plan — staff can still override per-deal, but the
    // starting point is decided once here rather than re-picked every time.
    // Scoped the same way the Payment Plan Master itself is: a plan with no
    // Project/Block set applies everywhere, otherwise it must match this
    // unit's own Project/Block.
    optionsProvider: (_data, _currentId, form) => {
      const plans: any[] = (form?.__paymentPlans as any) ?? [];
      const projectId = form?.projectId as string | undefined;
      const blockId = form?.blockId as string | undefined;
      return plans
        .filter((p) => p.IsActive)
        .filter((p) => !p.ProjectId || String(p.ProjectId) === projectId)
        .filter((p) => !p.BlockId || String(p.BlockId) === blockId)
        .map((p) => ({ value: String(p.Id), label: p.PlanName }));
    },
  },
  {
    name: "floorNo",
    label: "Floor No.",
    type: "number",
  },
  {
    name: "unitType",
    label: "Type of Unit",
    type: "select",
    options: UNIT_TYPES,
  },
  {
    name: "areaSqFt",
    label: "Area (sq ft)",
    type: "number",
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
  { key: "unitName", label: "Unit Name" },
  { key: "floorNo", label: "Floor No." },
  { key: "unitType", label: "Type of Unit" },
  { key: "areaSqFt", label: "Area (sq ft)" },
  { key: "defaultPaymentPlanName", label: "Default Payment Plan" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Unit Name", accessor: "unitName" },
  { header: "Floor No.", accessor: "floorNo" },
  { header: "Type of Unit", accessor: "unitType" },
  { header: "Area (sq ft)", accessor: "areaSqFt" },
  { header: "Default Payment Plan", accessor: "defaultPaymentPlanName" },
  { header: "Status", accessor: "isActive" },
];

// ── Component ─────────────────────────────────────────────────────────────────
const UnitMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: units,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["unit-master"],
    queryFn: fetchUnits,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all blocks once — passed into form as __blocks so optionsProvider can filter
  const { data: allBlocks = [] } = useQuery<
    { Id: number; Name: string; ProjectId: number }[]
  >({
    queryKey: ["unit-master-blocks"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/blocks`);
      if (!res.ok) throw new Error("Failed to fetch blocks");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Same pattern as __blocks — every payment plan, filtered client-side in
  // the field's optionsProvider by the form's current project/block.
  const { data: allPaymentPlans = [] } = useQuery<any[]>({
    queryKey: ["unit-master-payment-plans"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/crm/payment-plans");
      if (!res.ok) throw new Error("Failed to fetch payment plans");
      return res.json().catch(() => ([]));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Backend → frontend shape; also inject __blocks so optionsProvider can see them
  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(units)) return [];
    return units.map((item) => ({
      _id: String(item.Id),
      projectId: String(item.ProjectId),
      projectName: item.ProjectName ?? "",
      blockId: String(item.BlockId),
      blockName: item.BlockName ?? "",
      unitName: item.UnitName ?? "",
      floorNo: item.FloorNo != null ? String(item.FloorNo) : "",
      unitType: item.UnitType ?? "",
      areaSqFt: item.AreaSqFt != null ? String(item.AreaSqFt) : "",
      defaultPaymentPlanId: item.DefaultPaymentPlanId != null ? String(item.DefaultPaymentPlanId) : "",
      defaultPaymentPlanName: item.DefaultPaymentPlanName ?? "",
      isActive: Boolean(item.IsActive),
    }));
  }, [units]);

  // externalFormPatch injects __blocks/__paymentPlans into the form so each
  // field's optionsProvider can filter off the current project/block
  const blocksPatch = React.useMemo(
    () => ({ __blocks: allBlocks, __paymentPlans: allPaymentPlans }),
    [allBlocks, allPaymentPlans],
  );

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockId: parseInt(r.blockId),
    UnitName: r.unitName?.trim() || null,
    FloorNo: r.floorNo !== "" && r.floorNo != null ? parseInt(r.floorNo) : null,
    UnitType: r.unitType || null,
    AreaSqFt: r.areaSqFt !== "" && r.areaSqFt != null ? parseFloat(r.areaSqFt) : null,
    DefaultPaymentPlanId: r.defaultPaymentPlanId ? parseInt(r.defaultPaymentPlanId) : null,
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to add unit");
        toast.success("Unit added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to update unit");
        toast.success("Unit updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "DELETE",
        });
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to delete unit");
        toast.success("Unit deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["unit-master"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading units...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load units.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Unit Master"]} />
      <FollowupShell title="Unit Master">
      <MasterPage
        title="Unit"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        // Inject __blocks + reset blockId when project changes
        externalFormPatch={blocksPatch}
        externalFormPatchKey={allBlocks.length}
        onFieldChange={(form, fieldName) => {
          if (fieldName === "projectId") {
            return { ...form, blockId: "" };
          }
          return form;
        }}
        exportConfig={{
          title: "Unit Master",
          filename: "unit-master",
          columns: exportColumns,
        }}
        viewConfig={{
          title: "Unit Details",
          fields: [
            { key: "projectName", label: "Project" },
            { key: "blockName", label: "Block" },
            { key: "unitName", label: "Unit Name" },
            { key: "floorNo", label: "Floor No." },
            { key: "unitType", label: "Type of Unit" },
            { key: "areaSqFt", label: "Area (sq ft)" },
            { key: "defaultPaymentPlanName", label: "Default Payment Plan" },
            { key: "isActive", label: "Status" },
          ],
        }}
        onPrint={(row) => {
          const win = window.open("", "_blank", "width=600,height=400");
          if (!win) return;
          win.document.write(safeHtml`
            <html><head><title>Unit — ${row.unitName}</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
            </head><body><h2>Unit Card</h2><table>
              <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
              <tr><td>Block</td><td>${row.blockName || "—"}</td></tr>
              <tr><td>Unit Name</td><td>${row.unitName || "—"}</td></tr>
              <tr><td>Floor No.</td><td>${row.floorNo || "—"}</td></tr>
              <tr><td>Type of Unit</td><td>${row.unitType || "—"}</td></tr>
              <tr><td>Area (sq ft)</td><td>${row.areaSqFt || "—"}</td></tr>
              <tr><td>Default Payment Plan</td><td>${row.defaultPaymentPlanName || "—"}</td></tr>
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

export default UnitMaster;

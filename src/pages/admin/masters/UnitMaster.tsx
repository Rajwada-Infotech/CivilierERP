import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { StatusBadge } from "@/components/StatusBadge";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/unit-master";
const DROPDOWN_API = "/api/business/dropdown";

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

// ── Fields — Company -> Project -> Block, each filtered by its parent via
// optionsProvider off form state injected through externalFormPatch below.
// Company is the real top of this hierarchy (dbo.enterprise: business_type
// 'C' is a Project's business_type 'P' parent via company_id) — every other
// CRM entry point (e.g. CrmApplication.tsx) already gates Project selection
// behind Company first; this page previously jumped straight to a flat
// Project list.
const fields: FieldDef[] = [
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
    // Strict cascade — disabledWhen (MasterPage.tsx) locks this field until
    // its Company is picked instead of ever falling back to "show everything".
    disabledWhen: (form) => !form?.companyId,
    disabledPlaceholder: "Select a Company first",
    optionsProvider: (_data, _currentId, form) => {
      const projects: { id: number; name: string; company_id: number }[] = (form?.__projects as any) ?? [];
      const selectedCompany = form?.companyId as string | undefined;
      if (!selectedCompany) return [];
      return projects
        .filter((p) => String(p.company_id) === selectedCompany)
        .map((p) => ({ value: String(p.id), label: p.name }));
    },
  },
  {
    name: "blockId",
    label: "Block",
    type: "select",
    required: true,
    // Same strict cascade one tier down — locked until a Project is picked.
    disabledWhen: (form) => !form?.projectId,
    disabledPlaceholder: "Select a Project first",
    optionsProvider: (_data, _currentId, form) => {
      const blocks: { Id: number; Name: string; ProjectId: number }[] =
        (form?.__blocks as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      if (!selectedProject) return [];
      return blocks
        .filter((b) => String(b.ProjectId) === selectedProject)
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
    // Payment plans are created independently in Payment Plan Master, then
    // tagged Project -> Block -> Unit (see crmEntityCreation.js's
    // getApplicablePaymentPlans). This picker only offers the Block's own
    // tagged plans if any; else falls back to the Project's tagged plans;
    // else every active plan. Not required: a unit with zero tags of its
    // own just inherits whatever the cascade resolves to (see
    // resolveApplicationPaymentPlan).
    name: "paymentPlanIds",
    label: "Payment Plans",
    type: "custom",
    fullWidth: true,
    defaultValue: [],
    render: ({ value, onChange, formData }) => {
      const allPlans: any[] = ((formData?.__paymentPlans as any) ?? []).filter((p: any) => p.IsActive);
      const blockTags: any[] = (formData?.__blockPlanTags as any) ?? [];
      const blockId = formData?.blockId as string | undefined;
      const projectId = formData?.projectId as string | undefined;

      const blockRow = blockId ? blockTags.find((b: any) => String(b.Id) === blockId) : null;
      const blockTaggedIds: string[] = blockRow?.PaymentPlanIds ? String(blockRow.PaymentPlanIds).split(",") : [];
      const projectTagged = projectId
        ? allPlans.filter((p: any) => p.ProjectIds && String(p.ProjectIds).split(",").includes(projectId))
        : [];

      let plans: any[];
      let scopeNote = "";
      if (blockTaggedIds.length) {
        plans = allPlans.filter((p: any) => blockTaggedIds.includes(String(p.Id)));
        scopeNote = "Showing this Block's tagged plans.";
      } else if (projectTagged.length) {
        plans = projectTagged;
        scopeNote = "This Block has no plans of its own — showing this Project's tagged plans.";
      } else {
        plans = allPlans;
      }

      const selected: string[] = (value as string[]) || [];
      if (!plans.length) {
        return <p className="text-[11px] text-muted-foreground">No active payment plans exist yet — create one in Payment Plan Master first.</p>;
      }
      return (
        <div>
          {scopeNote && <p className="text-[11px] text-muted-foreground mb-1.5">{scopeNote}</p>}
          <div className="flex flex-wrap gap-2">
          {plans.map((p) => {
            const id = String(p.Id);
            const isSelected = selected.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() =>
                  onChange(isSelected ? selected.filter((x) => x !== id) : [...selected, id])
                }
                className={`px-3 py-1 rounded-full text-xs font-heading border transition-all ${isSelected ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary"}`}
              >
                {p.PlanName}
              </button>
            );
          })}
          </div>
        </div>
      );
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
  { key: "paymentPlanNames", label: "Payment Plans" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Unit Name", accessor: "unitName" },
  { header: "Floor No.", accessor: "floorNo" },
  { header: "Type of Unit", accessor: "unitType" },
  { header: "Area (sq ft)", accessor: "areaSqFt" },
  { header: "Payment Plans", accessor: "paymentPlanNames" },
  { header: "Status", accessor: "status" },
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

  // Same pattern as __blocks — every payment plan (with its tagged
  // ProjectIds), filtered client-side in the field's render by the form's
  // current project/block, cascading Block's tags -> Project's tags -> all.
  const { data: allPaymentPlans = [] } = useQuery<any[]>({
    queryKey: ["unit-master-payment-plans"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/crm/payment-plans");
      if (!res.ok) throw new Error("Failed to fetch payment plans");
      return res.json().catch(() => ([]));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Blocks' own tagged PaymentPlanIds — the middle cascade tier. Fetched
  // from Block Master's own GET (unlike __blocks above, which only carries
  // Id/Name/ProjectId) so the render below can check "does this Unit's
  // selected Block have its own tags" without a per-keystroke API call.
  const { data: blockPlanTags = [] } = useQuery<any[]>({
    queryKey: ["unit-master-block-plan-tags"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/block-master");
      if (!res.ok) throw new Error("Failed to fetch block payment plan tags");
      return res.json().catch(() => ([]));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Company -> Project source data for the two new cascade fields above.
  // Same shared dropdown endpoint CrmApplication.tsx already uses for its
  // own Company -> Project chain.
  const { data: dropdownData } = useQuery<{
    companies: { id: number; name: string }[];
    projects: { id: number; name: string; company_id: number }[];
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

  // Backend → frontend shape; also inject __blocks so optionsProvider can see them
  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(units)) return [];
    return units.map((item) => {
      // A Unit's own row only carries ProjectId — the Company shown/edited
      // here is derived from the Project's own company_id so an existing
      // Unit reopens with the correct Company already selected instead of
      // forcing a re-pick every edit.
      const project = projectsList.find((p) => p.id === item.ProjectId);
      return {
      _id: String(item.Id),
      companyId: project ? String(project.company_id) : "",
      projectId: String(item.ProjectId),
      projectName: item.ProjectName ?? "",
      blockId: String(item.BlockId),
      blockName: item.BlockName ?? "",
      unitName: item.UnitName ?? "",
      floorNo: item.FloorNo != null ? String(item.FloorNo) : "",
      unitType: item.UnitType ?? "",
      areaSqFt: item.AreaSqFt != null ? String(item.AreaSqFt) : "",
      // PaymentPlanIds comes back as a comma-joined string from the
      // STRING_AGG in unitMaster.js's GET / — split into the string[] the
      // multi-select chip picker (and toPayload) expect.
      paymentPlanIds: item.PaymentPlanIds ? String(item.PaymentPlanIds).split(",") : [],
      paymentPlanNames: item.PaymentPlanNames ?? "",
      isActive: Boolean(item.IsActive),
      lockBookingNo: item.LockBookingNo ?? null,
      lockHoldId: item.LockHoldId ?? null,
      // Same precedence unitMatrix.js derives Status with server-side
      // (Blocked > Booked > OnHold > Available), driven off the exact same
      // LockBookingNo/LockHoldId this GET endpoint already returns — never
      // a separate guess, so it can't drift from what the matrix shows.
      status: !Boolean(item.IsActive)
        ? "Blocked"
        : item.LockBookingNo
          ? "Booked"
          : item.LockHoldId
            ? "On Hold"
            : "Available",
      };
    });
  }, [units, projectsList]);

  // externalFormPatch injects __blocks/__paymentPlans into the form so each
  // field's optionsProvider can filter off the current project/block
  const blocksPatch = React.useMemo(
    () => ({
      __blocks: allBlocks,
      __paymentPlans: allPaymentPlans,
      __blockPlanTags: blockPlanTags,
      __companies: companies,
      __projects: projectsList,
    }),
    [allBlocks, allPaymentPlans, blockPlanTags, companies, projectsList],
  );

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockId: parseInt(r.blockId),
    UnitName: r.unitName?.trim() || null,
    FloorNo: r.floorNo !== "" && r.floorNo != null ? parseInt(r.floorNo) : null,
    UnitType: r.unitType || null,
    AreaSqFt: r.areaSqFt !== "" && r.areaSqFt != null ? parseFloat(r.areaSqFt) : null,
    PaymentPlanIds: Array.isArray(r.paymentPlanIds) ? r.paymentPlanIds.map((x: any) => parseInt(x)).filter(Number.isFinite) : [],
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
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
        columnRenderers={{
          status: (value) => <StatusBadge status={value as string} />,
        }}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        // A Booked or OnHold unit can't be edited or deleted from here —
        // matches the server-side guard in unitMaster.js exactly, using the
        // lock fields the GET endpoint now returns per row.
        isRowLocked={(row) =>
          row.lockBookingNo
            ? `Booked (${row.lockBookingNo as string})`
            : row.lockHoldId
              ? "On Hold"
              : null
        }
        // Inject __blocks + reset blockId when project changes
        externalFormPatch={blocksPatch}
        externalFormPatchKey={`${allBlocks.length}:${allPaymentPlans.length}:${blockPlanTags.length}:${companies.length}:${projectsList.length}`}
        onFieldChange={(form, fieldName) => {
          if (fieldName === "companyId") {
            return { ...form, projectId: "", blockId: "" };
          }
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
            { key: "paymentPlanNames", label: "Payment Plans" },
            { key: "status", label: "Status" },
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
              <tr><td>Payment Plans</td><td>${row.paymentPlanNames || "—"}</td></tr>
              <tr><td>Status</td><td>${row.status || "—"}</td></tr>
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
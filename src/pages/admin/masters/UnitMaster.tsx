import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
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
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";

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
  return res.json().catch(() => []);
}

// ── Fields — Company -> Project -> Block, each filtered by its parent via
// optionsProvider off form state injected through externalFormPatch below.
// Company is the real top of this hierarchy (dbo.enterprise: business_type
// 'C' is a Project's business_type 'P' parent via company_id) — every other
// CRM entry point (e.g. CrmApplication.tsx) already gates Project selection
// behind Company first; this page previously jumped straight to a flat
// Project list.
const fields: FieldDef[] = [
  // ── Unit Identity ────────────────────────────────────────────────────────────
  { name: "_s1", label: "Unit Identity", type: "section", fullWidth: true },
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
  // ── Configuration ────────────────────────────────────────────────────────────
  { name: "_s2", label: "Configuration", type: "section", fullWidth: true },
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

      return (
        <MultiSelectDropdown
          options={plans.map((p: any) => ({ id: p.Id, label: p.PlanName }))}
          value={value}
          onChange={onChange}
          itemNoun="payment plan"
          placeholder="No payment plans tagged — inherits from Block or Project"
          searchPlaceholder="Search payment plans…"
          note={scopeNote || undefined}
          emptyMessage="No active payment plans exist yet — create one in Payment Plan Master first."
        />
      );
    },
  },
  // ── Area Breakdown ────────────────────────────────────────────────────────────
  // Carpet, Built-up, SBU are authoritative at Block+UnitType level (BlockUnitTypeSpec).
  // They are shown as inherited read-only here so staff can confirm the values
  // without being able to enter conflicting per-unit overrides.
  // Open Terrace is the one area that can differ per unit (corner units etc.) and
  // stays editable.
  { name: "_s3", label: "Area Breakdown", type: "section", fullWidth: true },
  {
    name: "_areaInherited",
    label: "Structural Areas",
    type: "custom",
    fullWidth: true,
    render: ({ formData }) => {
      const carpet = formData?.carpetAreaSqFt as string;
      const builtUp = formData?.builtUpAreaSqFt as string;
      const sbu = formData?.superBuiltUpAreaSqFt as string;
      const hasAny = carpet || builtUp || sbu;
      const blockId = formData?.blockId as string;
      const unitType = formData?.unitType as string;
      const fmt = (v: string) => v ? `${parseFloat(v).toLocaleString("en-IN")} sq ft` : "—";
      return (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Inherited from Block Type Spec</span>
            {blockId && unitType && (
              <span className="text-xs text-muted-foreground italic">Set these in Block Master → Unit Type Specifications</span>
            )}
          </div>
          {hasAny ? (
            <div className="grid grid-cols-3 gap-3 mt-1">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Carpet</div>
                <div className="font-medium tabular-nums">{fmt(carpet)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Built-up</div>
                <div className="font-medium tabular-nums">{fmt(builtUp)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Super Built-up (Saleable)</div>
                <div className="font-medium tabular-nums">{fmt(sbu)}</div>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground italic text-xs">
              No spec defined for this Block + Unit Type yet.
              {blockId && unitType
                ? " Go to Block Master → Unit Type Specifications to define areas."
                : " Select a Block and Unit Type first."}
            </div>
          )}
        </div>
      );
    },
  },
  {
    name: "openTerraceAreaSqFt",
    label: "Open Terrace Area (sq ft)",
    type: "number",
  },
  // ── Pricing ───────────────────────────────────────────────────────────────────
  // Rate × Super Built-up Area = Base Price. areaSqFt is the legacy field kept
  // in sync server-side with SuperBuiltUpAreaSqFt — not user-editable here.
  { name: "_s4", label: "Pricing", type: "section", fullWidth: true },
  {
    name: "ratePerSqFt",
    label: "Rate per sq ft (₹)",
    type: "number",
    prefix: "₹",
  },
  {
    name: "_basePrice",
    label: "Base Price",
    type: "custom",
    fullWidth: true,
    render: ({ formData }) => {
      const rate = parseFloat(formData?.ratePerSqFt as string);
      const sbu = parseFloat(formData?.superBuiltUpAreaSqFt as string);
      const price = !isNaN(rate) && !isNaN(sbu) && rate > 0 && sbu > 0
        ? Math.round(rate * sbu)
        : null;
      return (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          {price != null
            ? <span className="font-semibold tabular-nums">₹ {price.toLocaleString("en-IN")}</span>
            : <span className="text-muted-foreground italic">Enter Rate and Super Built-up Area to see Base Price</span>}
        </div>
      );
    },
  },
  // ── Settings ──────────────────────────────────────────────────────────────────
  { name: "_s5", label: "Settings", type: "section", fullWidth: true },
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
  { key: "floorNo", label: "Floor" },
  { key: "unitType", label: "Type" },
  { key: "saleableAreaSqFt", label: "Saleable Area" },
  { key: "ratePerSqFt", label: "Inclusive Rate/sqft" },
  { key: "paymentPlanNames", label: "Payment Plans" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Unit Name", accessor: "unitName" },
  { header: "Floor No.", accessor: "floorNo" },
  { header: "Type of Unit", accessor: "unitType" },
  { header: "Saleable Area (sq ft)", accessor: "areaSqFt" },
  { header: "Carpet Area (sq ft)", accessor: "carpetAreaSqFt" },
  { header: "Built-up Area (sq ft)", accessor: "builtUpAreaSqFt" },
  { header: "Inclusive Saleable / Super Built-up Area (sq ft)", accessor: "superBuiltUpAreaSqFt" },
  { header: "Open Terrace Area (sq ft)", accessor: "openTerraceAreaSqFt" },
  { header: "Rate per sq ft (₹)", accessor: "ratePerSqFt" },
  { header: "Payment Plans", accessor: "paymentPlanNames" },
  { header: "Status", accessor: "status" },
];

// ── Component ─────────────────────────────────────────────────────────────────
const UnitMaster: React.FC = () => {
  usePageRights("followup-unit-master");
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
      return res.json().catch(() => []);
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
      // 2-tier: unit's own explicit value → block spec default → empty
      carpetAreaSqFt:       (item.CarpetAreaSqFt       ?? item.SpecCarpetAreaSqFt)       != null ? String(item.CarpetAreaSqFt       ?? item.SpecCarpetAreaSqFt)       : "",
      builtUpAreaSqFt:      (item.BuiltUpAreaSqFt      ?? item.SpecBuiltUpAreaSqFt)      != null ? String(item.BuiltUpAreaSqFt      ?? item.SpecBuiltUpAreaSqFt)      : "",
      superBuiltUpAreaSqFt: (item.SuperBuiltUpAreaSqFt ?? item.SpecSuperBuiltUpAreaSqFt) != null ? String(item.SuperBuiltUpAreaSqFt ?? item.SpecSuperBuiltUpAreaSqFt) : "",
      openTerraceAreaSqFt:  item.OpenTerraceAreaSqFt   != null ? String(item.OpenTerraceAreaSqFt) : "",
      ratePerSqFt:          (item.RatePerSqFt          ?? item.SpecBaseRatePerSqFt)      != null ? String(item.RatePerSqFt          ?? item.SpecBaseRatePerSqFt)      : "",
      // SBU is the saleable/priced area; AreaSqFt is the legacy fallback.
      saleableAreaSqFt: item.SuperBuiltUpAreaSqFt ?? item.AreaSqFt ?? null,
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
    CarpetAreaSqFt: r.carpetAreaSqFt !== "" && r.carpetAreaSqFt != null ? parseFloat(r.carpetAreaSqFt) : null,
    BuiltUpAreaSqFt: r.builtUpAreaSqFt !== "" && r.builtUpAreaSqFt != null ? parseFloat(r.builtUpAreaSqFt) : null,
    SuperBuiltUpAreaSqFt: r.superBuiltUpAreaSqFt !== "" && r.superBuiltUpAreaSqFt != null ? parseFloat(r.superBuiltUpAreaSqFt) : null,
    OpenTerraceAreaSqFt: r.openTerraceAreaSqFt !== "" && r.openTerraceAreaSqFt != null ? parseFloat(r.openTerraceAreaSqFt) : null,
    RatePerSqFt: r.ratePerSqFt !== "" && r.ratePerSqFt != null ? parseFloat(r.ratePerSqFt) : null,
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
          saleableAreaSqFt: (value) =>
            value != null && value !== ""
              ? <span className="tabular-nums">{Number(value).toLocaleString("en-IN")} sqft</span>
              : <span className="text-muted-foreground">—</span>,
          ratePerSqFt: (value) =>
            value && value !== ""
              ? <span className="tabular-nums">₹ {Number(value).toLocaleString("en-IN")}</span>
              : <span className="text-muted-foreground">—</span>,
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
            { key: "carpetAreaSqFt", label: "Carpet Area (sq ft)" },
            { key: "builtUpAreaSqFt", label: "Built-up Area (sq ft)" },
            { key: "superBuiltUpAreaSqFt", label: "Super Built-up / Saleable Area (sq ft)" },
            { key: "openTerraceAreaSqFt", label: "Open Terrace Area (sq ft)" },
            { key: "ratePerSqFt", label: "Rate per sq ft (₹)" },
            {
              key: "saleableAreaSqFt",
              label: "Base Price",
              render: (_, row) => {
                const rate = parseFloat(row.ratePerSqFt as string);
                const sbu = parseFloat(row.superBuiltUpAreaSqFt as string);
                const price = !isNaN(rate) && !isNaN(sbu) && rate > 0 && sbu > 0
                  ? Math.round(rate * sbu)
                  : null;
                return price != null
                  ? <span className="font-semibold tabular-nums">₹ {price.toLocaleString("en-IN")}</span>
                  : <span className="text-muted-foreground">—</span>;
              },
            },
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
              <tr><td>Carpet Area (sq ft)</td><td>${row.carpetAreaSqFt || "—"}</td></tr>
              <tr><td>Built-up Area (sq ft)</td><td>${row.builtUpAreaSqFt || "—"}</td></tr>
              <tr><td>Super Built-up / Saleable Area (sq ft)</td><td>${row.superBuiltUpAreaSqFt || "—"}</td></tr>
              <tr><td>Open Terrace Area (sq ft)</td><td>${row.openTerraceAreaSqFt || "—"}</td></tr>
              <tr><td>Rate per sq ft (₹)</td><td>${row.ratePerSqFt ? "₹ " + Number(row.ratePerSqFt).toLocaleString("en-IN") : "—"}</td></tr>
              <tr><td>Base Price</td><td>${(() => { const r = parseFloat(row.ratePerSqFt as string); const s = parseFloat(row.superBuiltUpAreaSqFt as string); return !isNaN(r) && !isNaN(s) && r > 0 && s > 0 ? "₹ " + Math.round(r * s).toLocaleString("en-IN") : "—"; })()}</td></tr>
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

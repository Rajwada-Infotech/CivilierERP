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

const API = "/api/parking-master";
const RULE = "1px solid hsl(var(--foreground))";
const NUM = "font-heading tabular-nums";
// A project can belong to several companies (company_ids); company_id is only its primary one. Filtering on it hid a
// project from every company but the first.
const companiesOf = (p: { company_id?: number; company_ids?: string }) =>
  String(p.company_ids ?? p.company_id ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const DROPDOWN_API = "/api/business/dropdown";
async function fetchParkingRates(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || "Failed to load parking rates");
  return Array.isArray(body) ? body : [];
}

// ── Fields defined inside the component so parkingTypes (fetched live from
// /api/parking-master/types) can drive the ParkingType dropdown dynamically.
const FIELDS_STATIC_PREFIX: FieldDef[] = [
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
    label: "Block (leave blank = applies to whole project)",
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
];
const FIELDS_STATIC_SUFFIX: FieldDef[] = [
  {
    name: "charge",
    label: "Charge ₹ (before GST)",
    type: "number",
    required: true,
  },
  {
    name: "gstRate",
    label: "GST Rate (%)",
    type: "number",
    defaultValue: "18",
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
  { key: "parkingType", label: "Type" },
  { key: "charge", label: "Charge" },
  { key: "gstRate", label: "GST" },
  { key: "total", label: "With GST", sortable: false },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Type", accessor: "parkingType" },
  { header: "Charge", accessor: "charge" },
  { header: "GST %", accessor: "gstRate" },
  { header: "Status", accessor: "status" },
];

const ParkingMaster: React.FC = () => {
  const rights = usePageRights("followup-parking-master");
  const queryClient = useQueryClient();

  const { data: rates, isLoading, error } = useQuery({
    queryKey: ["parking-master"],
    queryFn: fetchParkingRates,
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
    ...FIELDS_STATIC_PREFIX,
    {
      name: "parkingType",
      label: "Parking Type",
      type: "select",
      required: true,
      defaultValue: parkingTypes[0] ?? "Open",
      options: parkingTypes,
    } as FieldDef,
    ...FIELDS_STATIC_SUFFIX,
  ], [parkingTypes]);

  const { data: allBlocks = [] } = useQuery<{ Id: number; Name: string; ProjectId: number }[]>({
    queryKey: ["parking-master-blocks"],
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
    if (!Array.isArray(rates)) return [];
    return rates.map((item) => {
      // A rate's own row only carries ProjectId — the Company shown/edited
      // here is derived from the Project's own company_id so an existing
      // rate reopens with the correct Company already selected.
      const project = projectsList.find((p) => p.id === item.ProjectId);
      return {
        _id: String(item.Id),
        companyId: project ? String(project.company_id) : "",
        projectId: String(item.ProjectId),
        projectName: item.ProjectName ?? "",
        blockId: item.BlockId != null ? String(item.BlockId) : "",
        blockName: item.BlockName ?? "All blocks",
        parkingType: item.ParkingType ?? "Open",
        charge: item.Charge != null ? String(item.Charge) : "",
        gstRate: item.GstRate != null ? String(item.GstRate) : "18",
        total: item.Charge != null ? Number(item.Charge) * (1 + (item.GstRate != null ? Number(item.GstRate) : 18) / 100) : null,
        isActive: Boolean(item.IsActive),
        // MasterPage's built-in Active/Inactive pill only kicks in for a
        // column keyed "status" — alias it here instead of showing the raw
        // isActive boolean as literal "true"/"false" text (same fix already
        // applied in BlockMaster.tsx).
        status: Boolean(item.IsActive),
        inUse: Boolean(item.InUse),
      };
    });
  }, [rates, projectsList]);

  const blocksPatch = React.useMemo(
    () => ({ __blocks: allBlocks, __companies: companies, __projects: projectsList }),
    [allBlocks, companies, projectsList],
  );

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockId: r.blockId ? parseInt(r.blockId) : null,
    ParkingType: r.parkingType || "Open",
    Charge: parseFloat(r.charge),
    GstRate: r.gstRate !== "" ? parseFloat(r.gstRate) : 18,
    IsActive: r.isActive !== false,
  });

  // No internal try/catch here — same fix as Block/Unit Master: swallowing
  // the error here would let a 409 (duplicate rate, or in-use on delete)
  // get reported to the user as a success.
  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to add parking rate");
      toast.success("Parking rate added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to update parking rate");
      toast.success("Parking rate updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete parking rate");
      toast.success("Parking rate deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["parking-master"] });
  };

  const rupees = (v: unknown) => (v === "" || v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  const active = mappedData.filter((r) => r.isActive).length;
  const figures = [
    { label: "Rates", value: mappedData.length, note: "in your projects" },
    { label: "Active", value: active, note: "offered when allotting parking" },
    { label: "Allotted", value: mappedData.filter((r) => r.inUse).length, note: "on a booking — can't be deleted" },
    { label: "Inactive", value: mappedData.length - active, note: "kept on old bookings" },
  ];
  const statusMark = (v: unknown) => <SheetMark text={v ? "Active" : "Inactive"} tone={v ? "done" : "draft"} />;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Parking Master"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Parking rates"
        subtitle="What each type of parking costs in a project — or in one block of it, which wins over the project-wide rate — and its GST. Allotments take the charge from here."
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {figures.map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading parking rates…</p>
        ) : error ? (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
            {(error as Error)?.message || "Failed to load parking rates."}
          </div>
        ) : (
          <MasterPage
            title="Parking Rate"
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            fields={fields}
            columns={columns}
            columnRenderers={{
              blockName: (v) => (v === "All blocks" ? <span className="text-muted-foreground">All blocks</span> : <span className="font-medium">{String(v)}</span>),
              charge: (v) => <span className={NUM}>{rupees(v)}</span>,
              gstRate: (v) => <span className={NUM}>{v === "" ? "—" : `${Number(v)}%`}</span>,
              total: (v) => <span className={`${NUM} font-semibold`}>{rupees(v)}</span>,
              status: (v) => statusMark(v),
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
            // A rate that's ever been allotted to a booking can't be
            // deleted — matches the server-side guard in parkingMaster.js
            // exactly. Editing stays open (same as Block Master) since a
            // correction here is looked up live, not snapshotted.
            isDeleteLocked={(row) =>
              row.inUse ? "Already allotted to one or more bookings" : null
            }
            exportConfig={rights.canExport ? {
              title: "Parking Master",
              filename: "parking-master",
              columns: exportColumns,
            } : undefined}
            viewConfig={{
              title: "Parking Rate Details",
              fields: [
                { key: "projectName", label: "Project" },
                { key: "blockName", label: "Block" },
                { key: "parkingType", label: "Type" },
                { key: "charge", label: "Charge (before GST)", render: (v) => <span className={NUM}>{rupees(v)}</span> },
                { key: "gstRate", label: "GST", render: (v) => <span className={NUM}>{v === "" ? "—" : `${Number(v)}%`}</span> },
                { key: "total", label: "With GST", render: (v) => <span className={`${NUM} font-semibold`}>{rupees(v)}</span> },
                { key: "status", label: "Status", render: (v) => statusMark(v) },
              ],
            }}
            onPrint={(row) => {
              const win = window.open("", "_blank", "width=600,height=400");
              if (!win) return;
              win.document.write(safeHtml`
                <html><head><title>Parking Rate — ${row.parkingType}</title>
                <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
                </head><body><h2>Parking Rate</h2><table>
                  <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
                  <tr><td>Block</td><td>${row.blockName || "All blocks"}</td></tr>
                  <tr><td>Type</td><td>${row.parkingType || "—"}</td></tr>
                  <tr><td>Charge</td><td>₹${row.charge || "0"}</td></tr>
                  <tr><td>GST %</td><td>${row.gstRate || "0"}%</td></tr>
                  <tr><td>Status</td><td>${row.isActive ? "Active" : "Inactive"}</td></tr>
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

export default ParkingMaster;
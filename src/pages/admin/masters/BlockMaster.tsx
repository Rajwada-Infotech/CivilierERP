import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

const RULE = "1px solid hsl(var(--foreground))";
const RULE_SOFT = "1px solid hsl(var(--foreground) / 0.15)";
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const KEY_INK = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-foreground text-card border border-foreground";
const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none transition-colors";
// A project can belong to several companies (company_ids); company_id is only its primary one. Filtering on it hid a
// project from every company but the first.
const companiesOf = (p: { company_id?: number; company_ids?: string }) =>
  String(p.company_ids ?? p.company_id ?? "").split(",").map((x) => x.trim()).filter(Boolean);

// ── Unit Type Spec row shape ──────────────────────────────────────────────────
interface SpecRow {
  unitType: string;   // read-only — comes from real data
  carpetArea: string;
  builtUpArea: string;
  superBuiltUpArea: string;
  openTerrace: string;
  baseRate: string;
}

// ── BlockUnitTypeSpec panel ───────────────────────────────────────────────────
// Unit types are NOT free-typed — they are fetched from real data:
//   • CrmProjectAutoSetupUnitTemplate (auto-setup configured types for this block)
//   • UnitMaster (unit types that exist as actual inventory in this block)
// Staff only fill in the area/rate values. Unit types are immutable here.
const SpecPanel: React.FC<{ blocks: RecordWithId[]; canEdit: boolean }> = ({ blocks, canEdit }) => {
  const queryClient = useQueryClient();
  const [blockId, setBlockId] = React.useState<string>("");
  const [rows, setRows] = React.useState<SpecRow[]>([]);
  const [dirty, setDirty] = React.useState(false);

  const activeBlocks = blocks.filter((b) => b.isActive);

  // A failed load used to read "No unit types found for this block".
  const { data: serverData, isFetching, isError, error } = useQuery<{ unitTypes: string[]; specs: any[] }>({
    queryKey: ["block-unit-type-specs", blockId],
    queryFn: async () => {
      if (!blockId) return { unitTypes: [], specs: [] };
      const res = await fetchWithAuth(`/api/block-master/${blockId}/unit-type-specs`);
      if (!res.ok) throw new Error("Failed to fetch specs");
      return res.json().catch(() => ({ unitTypes: [], specs: [] }));
    },
    enabled: !!blockId,
    staleTime: 0,
  });

  React.useEffect(() => {
    if (!blockId) { setRows([]); setDirty(false); return; }
    if (!serverData) return;

    const { unitTypes, specs } = serverData;
    // Build a lookup from existing specs
    const specByType: Record<string, any> = {};
    for (const s of specs) specByType[s.UnitType] = s;

    // One row per real unit type — populated with existing spec values if any
    setRows(
      unitTypes.map((ut) => {
        const s = specByType[ut];
        return {
          unitType: ut,
          carpetArea:       s?.CarpetAreaSqFt       != null ? String(s.CarpetAreaSqFt)       : "",
          builtUpArea:      s?.BuiltUpAreaSqFt      != null ? String(s.BuiltUpAreaSqFt)      : "",
          superBuiltUpArea: s?.SuperBuiltUpAreaSqFt != null ? String(s.SuperBuiltUpAreaSqFt) : "",
          openTerrace:      s?.OpenTerraceAreaSqFt  != null ? String(s.OpenTerraceAreaSqFt)  : "",
          baseRate:         s?.BaseRatePerSqFt      != null ? String(s.BaseRatePerSqFt)      : "",
        };
      })
    );
    setDirty(false);
  }, [serverData, blockId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = rows.map((r) => ({
        UnitType:             r.unitType,
        CarpetAreaSqFt:       r.carpetArea       !== "" ? parseFloat(r.carpetArea)       : null,
        BuiltUpAreaSqFt:      r.builtUpArea      !== "" ? parseFloat(r.builtUpArea)      : null,
        SuperBuiltUpAreaSqFt: r.superBuiltUpArea !== "" ? parseFloat(r.superBuiltUpArea) : null,
        OpenTerraceAreaSqFt:  r.openTerrace      !== "" ? parseFloat(r.openTerrace)      : null,
        BaseRatePerSqFt:      r.baseRate         !== "" ? parseFloat(r.baseRate)         : null,
      }));
      const res = await fetchWithAuth(`/api/block-master/${blockId}/unit-type-specs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to save specs");
    },
    onSuccess: () => {
      toast.success("Specs saved!");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["block-unit-type-specs", blockId] });
      queryClient.invalidateQueries({ queryKey: ["unit-master"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateRow = (idx: number, field: keyof Omit<SpecRow, "unitType">, val: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
    setDirty(true);
  };

  const numInput = (idx: number, field: keyof Omit<SpecRow, "unitType">) => (
    <input
      type="number"
      min={0}
      step={0.01}
      placeholder="—"
      value={rows[idx][field]}
      readOnly={!canEdit}
      onChange={(e) => updateRow(idx, field, e.target.value)}
      className={`${INP} !h-8 font-heading tabular-nums text-right read-only:bg-muted/30 read-only:border-foreground/20`}
    />
  );

  const th = `!px-3 !py-2.5 text-left whitespace-nowrap ${LBL}`;
  const sample = rows.find((r) => r.superBuiltUpArea && r.baseRate);
  return (
    <section className="bg-card" style={{ border: RULE }}>
      <header className="px-4 py-3" style={{ borderBottom: RULE }}>
        <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Unit type area specifications</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          RERA area breakdown and base rate per unit type, per block. Unit types are picked up from Auto Setup and existing inventory — set the areas here once and every unit in this block inherits them.
        </p>
      </header>
      <div className="p-4 space-y-4">
        <label className="flex flex-wrap items-center gap-3">
          <span className={LBL}>Block</span>
          <select value={blockId} onChange={(e) => { setBlockId(e.target.value); setDirty(false); }} className={`${INP} !w-auto min-w-0 sm:min-w-[260px]`}>
            <option value="">— choose a block —</option>
            {activeBlocks.map((b) => (
              <option key={b._id} value={b._id}>{String(b.projectName ?? "")} / {String(b.blockName ?? "")}</option>
            ))}
          </select>
          {isFetching && <span className="text-xs text-muted-foreground">Loading…</span>}
        </label>

        {blockId && isError && <p className="text-xs text-destructive">{(error as Error)?.message || "Failed to fetch specs"}</p>}
        {blockId && !isFetching && !isError && (
          rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No unit types found for this block. Configure unit types in Auto Project Setup first.</p>
          ) : (
            <>
              <div className="overflow-x-auto thin-scroll" style={{ border: RULE }}>
                <table className="w-full text-sm min-w-[680px]">
                  <thead>
                    <tr style={{ borderBottom: RULE }}>
                      <th className={th}>Unit type</th>
                      <th className={`${th} !text-right`}>Carpet sq ft</th>
                      <th className={`${th} !text-right`}>Built-up sq ft</th>
                      <th className={`${th} !text-right`}>Super built-up sq ft</th>
                      <th className={`${th} !text-right`}>Terrace sq ft</th>
                      <th className={`${th} !text-right`}>Base rate ₹ / sq ft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={row.unitType} style={{ borderBottom: RULE_SOFT }}>
                        <td className="!px-3 !py-2 font-medium">{row.unitType}</td>
                        <td className="!px-3 !py-2">{numInput(idx, "carpetArea")}</td>
                        <td className="!px-3 !py-2">{numInput(idx, "builtUpArea")}</td>
                        <td className="!px-3 !py-2">{numInput(idx, "superBuiltUpArea")}</td>
                        <td className="!px-3 !py-2">{numInput(idx, "openTerrace")}</td>
                        <td className="!px-3 !py-2">{numInput(idx, "baseRate")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {sample && <>{sample.unitType}: <span className="font-heading tabular-nums">₹{parseFloat(sample.baseRate).toLocaleString("en-IN")}</span>/sq ft × <span className="font-heading tabular-nums">{sample.superBuiltUpArea}</span> sq ft = <span className="font-heading tabular-nums text-foreground">₹{Math.round(parseFloat(sample.superBuiltUpArea) * parseFloat(sample.baseRate)).toLocaleString("en-IN")}</span></>}
                </p>
                {canEdit && (
                  <div className="flex items-center gap-3">
                    {dirty && <SheetMark text="Unsaved changes" tone="waiting" />}
                    <button type="button" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()} className={`${KEY_INK} h-9 px-4`}>
                      {saveMutation.isPending ? "Saving…" : "Save specs"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    </section>
  );
};

const API = "/api/block-master";
const DROPDOWN_API = "/api/business/dropdown";

async function fetchBlocks(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch blocks");
  return res.json().catch(() => []);
}

// ── Fields ────────────────────────────────────────────────────────────────────
// Company -> Project is the real top of this hierarchy (dbo.enterprise:
// business_type='C' is a Project's business_type='P' parent via company_id)
// — every other CRM entry point (e.g. CrmApplication.tsx) already gates
// Project selection behind Company first. __companies/__projects are
// injected via externalFormPatch below (same pattern as __blocks/__paymentPlans).
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
    // Strict cascade — a Project can only be picked once its Company is
    // chosen; disabledWhen (MasterPage.tsx) locks the field and swaps in
    // disabledPlaceholder until then, so this never falls back to showing
    // every Project unfiltered.
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
    name: "blockName",
    label: "Block Name",
    type: "text",
    required: true,
  },
  {
    // Middle tier of the Project -> Block -> Unit Payment Plan cascade (see
    // crmEntityCreation.js's getApplicablePaymentPlans). Only offers plans
    // already tagged to this Block's Project — falling back to every active
    // plan if the Project itself has nothing tagged, so an untagged Project
    // never leaves this picker empty. Optional: an untagged Block just means
    // Unit Master falls through to the Project's (or global) tags instead.
    name: "paymentPlanIds",
    label: "Payment Plans",
    type: "custom",
    fullWidth: true,
    defaultValue: [],
    render: ({ value, onChange, formData }) => {
      const allPlans: any[] = ((formData?.__paymentPlans as any) ?? []).filter((p: any) => p.IsActive);
      const projectId = formData?.projectId as string | undefined;
      const taggedForProject = projectId
        ? allPlans.filter((p: any) => p.ProjectIds && String(p.ProjectIds).split(",").includes(projectId))
        : [];
      const plans = taggedForProject.length ? taggedForProject : allPlans;
      const selected: string[] = (value as string[]) || [];
      if (!projectId) {
        return <p className="text-xs text-muted-foreground">Select a project first.</p>;
      }
      if (!plans.length) {
        return <p className="text-xs text-muted-foreground">No active payment plans exist yet — create one in Payment Plan Master first.</p>;
      }
      return (
        <div>
          {taggedForProject.length > 0 && (
            <p className="text-xs text-muted-foreground mb-1.5">Showing this project&apos;s tagged plans.</p>
          )}
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
                  aria-pressed={isSelected}
                  className={`h-7 px-2.5 text-xs border transition-colors ${isSelected ? "bg-foreground text-card border-foreground" : "bg-card text-foreground border-foreground/30 hover:border-foreground"}`}
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
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "projectName", label: "Project" },
  { key: "blockName", label: "Block Name" },
  { key: "typeName", label: "Type" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block Name", accessor: "blockName" },
  { header: "Status", accessor: "status" },
];

// ── Component ─────────────────────────────────────────────────────────────────
const BlockMaster: React.FC = () => {
  const rights = usePageRights("followup-block-master");
  const queryClient = useQueryClient();

  const {
    data: blocks,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["block-master"],
    queryFn: fetchBlocks,
    staleTime: 5 * 60 * 1000,
  });

  // Every active payment plan (with its tagged ProjectIds) — filtered
  // client-side in the paymentPlanIds field's render by the form's currently
  // selected project, same pattern UnitMaster.tsx uses for __blocks.
  const { data: allPaymentPlans = [] } = useQuery<any[]>({
    queryKey: ["block-master-payment-plans"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/crm/payment-plans");
      if (!res.ok) throw new Error("Failed to fetch payment plans");
      return res.json().catch(() => ([]));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Company -> Project source data for the two new cascade fields above.
  // Same shared dropdown endpoint CrmApplication.tsx already uses for its
  // own Company -> Project chain.
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
    if (!Array.isArray(blocks)) return [];
    return blocks.map((item) => {
      // A Block's own row only carries ProjectId — the Company shown/edited
      // here is derived from the Project's own company_id so an existing
      // Block reopens with the correct Company already selected instead of
      // forcing a re-pick every edit.
      const project = projectsList.find((p) => p.id === item.ProjectId);
      return {
        _id: String(item.Id),
        companyId: project ? String(project.company_id) : "",
        projectId: String(item.ProjectId),
        projectName: item.ProjectName ?? "",
        blockName: item.BlockName ?? "",
        // Effective type; set in Auto Project Setup's Project type bar.
        typeName: item.TypeName ? `${item.TypeName}${item.HasOwnType ? " (block's own)" : ""}` : "Not set",
        // PaymentPlanIds comes back as a comma-joined string from blockMaster.js's
        // GET / STRING_AGG — split into the string[] the chip picker expects.
        paymentPlanIds: item.PaymentPlanIds ? String(item.PaymentPlanIds).split(",") : [],
        paymentPlanNames: item.PaymentPlanNames ?? "",
        isActive: Boolean(item.IsActive),
        // MasterPage's built-in Active/Inactive pill only kicks in for a
        // column keyed "status" — alias it here instead of showing the raw
        // isActive boolean as literal "true"/"false" text.
        status: Boolean(item.IsActive),
        lockBookingNo: item.LockBookingNo ?? null,
        lockHoldId: item.LockHoldId ?? null,
      };
    });
  }, [blocks, projectsList]);

  const formDataPatch = React.useMemo(
    () => ({ __paymentPlans: allPaymentPlans, __companies: companies, __projects: projectsList }),
    [allPaymentPlans, companies, projectsList],
  );

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockName: r.blockName?.trim() || null,
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
        throw new Error((await res.json().catch(() => ({}))).error || "Failed to add block");
      toast.success("Block added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).error || "Failed to update block");
      toast.success("Block updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "DELETE",
      });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete block");
      toast.success("Block deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["block-master"] });
  };

  const active = mappedData.filter((r) => r.isActive).length;
  const figures = [
    { label: "Blocks", value: mappedData.length, note: "in your projects" },
    { label: "Active", value: active, note: "offered for units and bookings" },
    { label: "Locked", value: mappedData.filter((r) => r.lockBookingNo || r.lockHoldId != null).length, note: "a unit booked or on hold — can't be deleted" },
    { label: "Inactive", value: mappedData.length - active, note: "kept on old records" },
  ];

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Follow-Up", "Setup", "Block Master"]}
      />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Blocks"
        subtitle="Each project's towers and blocks: the payment plans they offer, their type, and the area and rate every unit type in them inherits."
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
          <p className="text-sm text-muted-foreground">Loading blocks…</p>
        ) : error ? (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
            {(error as Error)?.message || "Failed to load blocks."}
          </div>
        ) : (
        <>
          <SpecPanel blocks={mappedData} canEdit={rights.canEdit} />
          <MasterPage
            title="Block"
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            fields={fields}
            columns={columns}
            columnRenderers={{
              status: (v) => <SheetMark text={v ? "Active" : "Inactive"} tone={v ? "done" : "draft"} />,
              blockName: (v) => <span className="font-heading text-xs font-semibold">{String(v ?? "")}</span>,
              typeName: (v) => <span className={v === "Not set" ? "text-muted-foreground" : ""}>{String(v ?? "")}</span>,
            }}
            initialData={mappedData}
            onDataEvent={handleDataEvent}
            externalFormPatch={formDataPatch}
            externalFormPatchKey={`${allPaymentPlans.length}:${companies.length}:${projectsList.length}`}
            onFieldChange={(form, fieldName) => {
              // Changing Company invalidates whatever Project was picked under
              // the old one — same reset unitMaster.js's own projectId->blockId
              // change already does one tier down.
              if (fieldName === "companyId") {
                return { ...form, projectId: "" };
              }
              return form;
            }}
            // A Block with a Booked or OnHold Unit under it can't be deleted —
            // matches the server-side guard in blockMaster.js exactly. Editing
            // stays open (unlike Unit Master) since a rename/reassign here is
            // live-joined project-wide rather than locked to this one row.
            isDeleteLocked={(row) =>
              row.lockBookingNo
                ? `Has a Unit booked (${row.lockBookingNo as string})`
                : row.lockHoldId != null
                  ? "Has a Unit on hold"
                  : null
            }
            exportConfig={rights.canExport ? {
              title: "Block Master",
              filename: "block-master",
              columns: exportColumns,
            } : undefined}
            viewConfig={{
              title: "Block Details",
              fields: [
                { key: "projectName", label: "Project" },
                { key: "blockName", label: "Block Name" },
                { key: "paymentPlanNames", label: "Payment Plans" },
                { key: "typeName", label: "Type" },
                { key: "status", label: "Status", render: (v) => <SheetMark text={v ? "Active" : "Inactive"} tone={v ? "done" : "draft"} /> },
              ],
            }}
            onPrint={(row) => {
              const win = window.open("", "_blank", "width=600,height=400");
              if (!win) return;
              win.document.write(safeHtml`
                <html><head><title>Block — ${row.blockName}</title>
                <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
                </head><body><h2>Block Card</h2><table>
                  <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
                  <tr><td>Block Name</td><td>${row.blockName || "—"}</td></tr>
                  <tr><td>Status</td><td>${row.status ? "Active" : "Inactive"}</td></tr>
                </table></body></html>
              `);
              win.document.close();
              win.print();
            }}
          />
        </>
        )}
      </SheetShell>
    </>
  );
};

export default BlockMaster;
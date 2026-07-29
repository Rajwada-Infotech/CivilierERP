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

const API = "/api/block-master";
const DROPDOWN_API = "/api/business/dropdown";

async function fetchBlocks(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch blocks");
  return res.json().catch(() => ({}));
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
      const projects: { id: number; name: string; company_id: number }[] = (form?.__projects as any) ?? [];
      const selectedCompany = form?.companyId as string | undefined;
      if (!selectedCompany) return [];
      return projects
        .filter((p) => String(p.company_id) === selectedCompany)
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
        return <p className="text-[11px] text-muted-foreground">Select a Project first.</p>;
      }
      if (!plans.length) {
        return <p className="text-[11px] text-muted-foreground">No active payment plans exist yet — create one in Payment Plan Master first.</p>;
      }
      return (
        <div>
          {taggedForProject.length > 0 && (
            <p className="text-[11px] text-muted-foreground mb-1.5">Showing this Project's tagged plans.</p>
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
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "projectName", label: "Project" },
  { key: "blockName", label: "Block Name" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block Name", accessor: "blockName" },
  { header: "Status", accessor: "status" },
];

// ── Component ─────────────────────────────────────────────────────────────────
const BlockMaster: React.FC = () => {
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
        throw new Error((await res.json()).error || "Failed to add block");
      toast.success("Block added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to update block");
      toast.success("Block updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "DELETE",
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to delete block");
      toast.success("Block deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["block-master"] });
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading blocks...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load blocks.</div>;

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Follow-Up", "Setup", "Block Master"]}
      />
      <FollowupShell title="Block Master">
      <MasterPage
        title="Block"
        fields={fields}
        columns={columns}
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
            : row.lockHoldId
              ? "Has a Unit on hold"
              : null
        }
        exportConfig={{
          title: "Block Master",
          filename: "block-master",
          columns: exportColumns,
        }}
        viewConfig={{
          title: "Block Details",
          fields: [
            { key: "projectName", label: "Project" },
            { key: "blockName", label: "Block Name" },
            { key: "paymentPlanNames", label: "Payment Plans" },
            { key: "status", label: "Status" },
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
      </FollowupShell>
    </>
  );
};

export default BlockMaster;
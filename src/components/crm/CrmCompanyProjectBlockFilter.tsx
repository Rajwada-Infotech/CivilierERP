import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Shared cascading Company -> Project -> Block filter for every CRM list
// page being migrated to server-side pagination + real filtering. Backed by
// lightweight master-data endpoints (/api/business/dropdown for Company +
// Project, /api/unit-master/blocks for Block scoped to the selected
// project) — deliberately NOT derived from a transactional list (bookings,
// applications, etc.) the way CrmInvoices.tsx's GenerateInvoiceDialog first
// did, since re-fetching a full transactional list just to populate filter
// options is the exact scalability problem this whole rollout exists to fix.
const DROPDOWN_API = "/api/business/dropdown";
const BLOCKS_API = "/api/unit-master/blocks";

async function fetchDropdown(): Promise<{ companies: any[]; projects: any[] }> {
  const res = await fetchWithAuth(DROPDOWN_API);
  if (!res.ok) return { companies: [], projects: [] };
  return res.json();
}
async function fetchBlocks(projectId: string): Promise<any[]> {
  const res = await fetchWithAuth(`${BLOCKS_API}?projectId=${projectId}`);
  if (!res.ok) return [];
  return res.json();
}

export interface CrmCompanyProjectBlockValue {
  companyId: string;
  projectId: string;
  blockId: string;
}

export function CrmCompanyProjectBlockFilter({
  value, onChange, className = "",
}: {
  value: CrmCompanyProjectBlockValue;
  onChange: (next: CrmCompanyProjectBlockValue) => void;
  className?: string;
}) {
  const { data: dropdown } = useQuery({
    queryKey: ["crm-business-dropdown"],
    queryFn: fetchDropdown,
    staleTime: 5 * 60_000,
  });
  const companies = dropdown?.companies || [];
  const projects = dropdown?.projects || [];

  // company_ids is the project's primary company plus every company it's
  // tagged to (see businessRoutes.js) — checking membership here, not
  // exact equality against company_id, is what lets a project tagged to
  // more than one company show up for each of them.
  const projectOptions = useMemo(
    () =>
      value.companyId
        ? projects.filter((p: any) =>
            String(p.company_ids || p.company_id || "")
              .split(",")
              .includes(value.companyId),
          )
        : projects,
    [projects, value.companyId],
  );

  const { data: blocks = [] } = useQuery({
    queryKey: ["crm-unit-master-blocks", value.projectId],
    queryFn: () => fetchBlocks(value.projectId),
    enabled: !!value.projectId,
    staleTime: 5 * 60_000,
  });

  return (
    <div className={`flex gap-2 flex-wrap sm:flex-nowrap ${className}`}>
      <Select
        value={value.companyId || "__all__"}
        onValueChange={(v) => onChange({ companyId: v === "__all__" ? "" : v, projectId: "", blockId: "" })}
      >
        <SelectTrigger className="h-8 text-sm min-w-[130px]">
          <SelectValue placeholder="All Companies" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Companies</SelectItem>
          {companies.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select
        value={value.projectId || "__all__"}
        onValueChange={(v) => onChange({ ...value, projectId: v === "__all__" ? "" : v, blockId: "" })}
      >
        <SelectTrigger className="h-8 text-sm min-w-[130px]">
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All Projects</SelectItem>
          {projectOptions.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select
        value={value.blockId || "__all__"}
        onValueChange={(v) => onChange({ ...value, blockId: v === "__all__" ? "" : v })}
        disabled={!value.projectId}
      >
        <SelectTrigger className="h-8 text-sm min-w-[130px] disabled:opacity-50 disabled:cursor-not-allowed">
          <SelectValue placeholder={value.projectId ? "All Blocks" : "Select a Project first"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{value.projectId ? "All Blocks" : "Select a Project first"}</SelectItem>
          {blocks.map((b: any) => <SelectItem key={b.Id} value={String(b.Id)}>{b.Name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

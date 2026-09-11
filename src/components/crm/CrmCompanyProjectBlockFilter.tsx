import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

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

  const projectOptions = useMemo(
    () => (value.companyId ? projects.filter((p: any) => String(p.company_id) === value.companyId) : projects),
    [projects, value.companyId],
  );

  const { data: blocks = [] } = useQuery({
    queryKey: ["crm-unit-master-blocks", value.projectId],
    queryFn: () => fetchBlocks(value.projectId),
    enabled: !!value.projectId,
    staleTime: 5 * 60_000,
  });

  return (
    <div className={`flex gap-2 flex-wrap ${className}`}>
      <select
        value={value.companyId}
        onChange={(e) => onChange({ companyId: e.target.value, projectId: "", blockId: "" })}
        className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
        <option value="">All Companies</option>
        {companies.map((c: any) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
      </select>
      <select
        value={value.projectId}
        onChange={(e) => onChange({ ...value, projectId: e.target.value, blockId: "" })}
        className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
        <option value="">All Projects</option>
        {projectOptions.map((p: any) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
      </select>
      <select
        value={value.blockId}
        onChange={(e) => onChange({ ...value, blockId: e.target.value })}
        disabled={!value.projectId}
        className="px-3 py-2 text-sm border border-border rounded-lg bg-background disabled:opacity-50 disabled:cursor-not-allowed">
        <option value="">{value.projectId ? "All Blocks" : "Select a Project first"}</option>
        {blocks.map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.Name}</option>)}
      </select>
    </div>
  );
}

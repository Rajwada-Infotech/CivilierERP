import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { GRID_CARD } from "@/components/crm/CrmDataTable";
import { INP, LBL, TONE_ROSE_TEXT, fetchDropdown, projectsOfCompany } from "./config";

/** A rounded company → project selector shared by both Setup and Parking tabs (state stored in URL params). */
export const ProjectPicker: React.FC<{ companyId: string; projectId: string; onCompany: (v: string) => void; onProject: (v: string) => void }> =
  ({ companyId, projectId, onCompany, onProject }) => {
    const { data: dropdown, isError, error } = useQuery({ queryKey: ["crm-business-dropdown"], queryFn: fetchDropdown, staleTime: 5 * 60_000 });
    const companies = dropdown?.companies || [];
    const projects = useMemo(() => projectsOfCompany(dropdown?.projects || [], companyId), [dropdown, companyId]);
    return (
      <section className={`${GRID_CARD} rounded-xl px-5 py-4 space-y-3`} aria-label="Select company and project">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
            <Building2 size={14} className="text-primary" />
            <span>Project scope</span>
          </span>
          <span className="text-[0.6875rem] text-muted-foreground">Company &amp; Project filter stays synced across Setup &amp; Parking tabs</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={`block ${LBL}`}>Company <span className={TONE_ROSE_TEXT}>*</span></span>
            <select value={companyId} onChange={(e) => onCompany(e.target.value)} className={INP}>
              <option value="">Select a company</option>
              {companies.map((c: any) => <option key={c.id || c.Id} value={String(c.id || c.Id)}>{c.name || c.Name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className={`block ${LBL}`}>Project <span className={TONE_ROSE_TEXT}>*</span></span>
            <select value={projectId} onChange={(e) => onProject(e.target.value)} disabled={!companyId} className={`${INP} disabled:opacity-50`}>
              <option value="">{companyId ? "Select a project" : "Select a company first"}</option>
              {projects.map((p: any) => <option key={p.id || p.Id} value={String(p.id || p.Id)}>{p.name || p.Name}</option>)}
            </select>
          </label>
        </div>
        {isError && <p className={`text-xs ${TONE_ROSE_TEXT}`}>{(error as Error)?.message}</p>}
      </section>
    );
  };

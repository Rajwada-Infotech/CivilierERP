import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { INP, LBL, RULE, fetchDropdown, projectsOfCompany } from "./config";

/** A ruled company → project pick, used by the setup and parking tabs (each keeps its own choice). */
export const ProjectPicker: React.FC<{ companyId: string; projectId: string; onCompany: (v: string) => void; onProject: (v: string) => void }> =
  ({ companyId, projectId, onCompany, onProject }) => {
    const { data: dropdown, isError, error } = useQuery({ queryKey: ["crm-business-dropdown"], queryFn: fetchDropdown, staleTime: 5 * 60_000 });
    const companies = dropdown?.companies || [];
    const projects = useMemo(() => projectsOfCompany(dropdown?.projects || [], companyId), [dropdown, companyId]);
    return (
      <div className="bg-card px-4 py-3.5 space-y-3" style={{ border: RULE }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={`block ${LBL}`}>Company <span className="text-destructive">*</span></span>
            <select value={companyId} onChange={(e) => onCompany(e.target.value)} className={INP}>
              <option value="">Select a company</option>
              {companies.map((c: any) => <option key={c.id || c.Id} value={String(c.id || c.Id)}>{c.name || c.Name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className={`block ${LBL}`}>Project <span className="text-destructive">*</span></span>
            <select value={projectId} onChange={(e) => onProject(e.target.value)} disabled={!companyId} className={`${INP} disabled:opacity-50`}>
              <option value="">{companyId ? "Select a project" : "Select a company first"}</option>
              {projects.map((p: any) => <option key={p.id || p.Id} value={String(p.id || p.Id)}>{p.name || p.Name}</option>)}
            </select>
          </label>
        </div>
        {isError && <p className="text-xs text-destructive">{(error as Error)?.message}</p>}
      </div>
    );
  };

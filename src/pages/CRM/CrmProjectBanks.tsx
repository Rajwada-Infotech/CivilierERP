import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, Landmark } from "lucide-react";

const API = "/api/crm/project-banks";
const UNIT_API = "/api/unit-master";
const BANK_MASTER_API = "/api/bank-master";

async function fetchLinks(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}/projects`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBanks(): Promise<any[]> {
  try { const r = await fetchWithAuth(BANK_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmProjectBanks: React.FC = () => {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [bankId, setBankId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: links = [], isLoading } = useQuery({ queryKey: ["crm-project-banks"], queryFn: fetchLinks, staleTime: 30_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: banks = [] } = useQuery({ queryKey: ["bank-master-dropdown"], queryFn: fetchBanks, staleTime: 5 * 60_000 });

  const linksByProject = useMemo(() => {
    const map = new Map<string, any[]>();
    (links as any[]).forEach((l) => {
      const key = String(l.ProjectId);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    });
    return map;
  }, [links]);

  const banksForSelectedProject = useMemo(() => {
    if (!projectId) return [];
    const linked = new Set((linksByProject.get(projectId) || []).map((l) => l.BankLHeadId));
    return (banks as any[]).filter((b: any) => !linked.has(b.BId));
  }, [banks, linksByProject, projectId]);

  const handleAdd = async () => {
    if (!projectId || !bankId) { toast.error("Select a project and a bank"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProjectId: parseInt(projectId), BankLHeadId: parseInt(bankId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to link bank");
      toast.success(data.alreadyLinked ? "Already linked" : "Bank linked to project");
      setBankId("");
      qc.invalidateQueries({ queryKey: ["crm-project-banks"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Bank unlinked");
      qc.invalidateQueries({ queryKey: ["crm-project-banks"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Project Bank Mapping"
      subtitle="Which company bank account(s) a project's payments should be deposited into — a project with no banks linked falls back to the full bank list everywhere"
    >
      <div className="rounded-xl border border-border p-4 space-y-3">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Landmark size={13} /> Link a Bank to a Project</label>
        <div className="flex gap-2">
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setBankId(""); }}
            className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
            <option value="">Select project</option>
            {(projects as any[]).map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
          </select>
          <select value={bankId} onChange={(e) => setBankId(e.target.value)} disabled={!projectId}
            className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-background disabled:opacity-60">
            <option value="">Select bank</option>
            {banksForSelectedProject.map((b: any) => <option key={b.BId} value={String(b.BId)}>{b.BName}</option>)}
          </select>
          <button onClick={handleAdd} disabled={saving || !projectId || !bankId}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1.5 shrink-0">
            <Plus size={14} /> Link
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No projects found</div>
        ) : (projects as any[]).map((p: any) => {
          const rows = linksByProject.get(String(p.Id)) || [];
          return (
            <div key={p.Id} className="rounded-xl border border-border p-4">
              <div className="font-medium mb-2">{p.Name}</div>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No banks linked — every payment surface falls back to the full bank list for this project.</p>
              ) : (
                <div className="space-y-1.5">
                  {rows.map((l: any) => (
                    <div key={l.Id} className="flex items-center justify-between text-xs rounded-md bg-muted/30 px-2.5 py-1.5">
                      <span>{l.BankName}</span>
                      <button onClick={() => handleRemove(l.Id)} className="text-muted-foreground hover:text-red-600"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SalesAutoShell>
  );
};

export default CrmProjectBanks;

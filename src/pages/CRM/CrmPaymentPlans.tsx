import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw, X } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { PlanFormDialog } from "./paymentPlans/PlanFormDialog";
import { PlanPreviewDialog } from "./paymentPlans/PlanPreviewDialog";
import {
  API, INP, KEY_INK, KEY_LINE, LBL, MilestoneBar, NUM, PAGE_SIZE, RULE, RULE_SOFT, companiesOf,
  fetchCompanyProjectDropdown, fetchMilestoneMaster, fetchPlansList, parseMilestones, segmentColor, type PlanListFilters,
} from "./paymentPlans/config";

const CrmPaymentPlans: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-payment-plans");
  const ask = useSheetAsk();
  // null = closed; "new" = a new plan; a number = editing that plan.
  const [formTarget, setFormTarget] = useState<number | "new" | null>(null);
  // Read-only view, opened by a card; built from the list row.
  const [previewPlan, setPreviewPlan] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // The list's company -> project filter (a plan has no block).
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");
  const [page, setPage] = useState(1);
  const listFilters: PlanListFilters = useMemo(() => ({ companyId: filterCompanyId, projectId: filterProjectId }), [filterCompanyId, filterProjectId]);

  const { data: listResult, isLoading, isFetching, refetch, isError, error } = useQuery({
    queryKey: ["crm-payment-plans", listFilters, page],
    queryFn: () => fetchPlansList(listFilters, page),
    staleTime: 30_000,
  });
  const plans: any[] = listResult?.rows ?? [];
  const planTotal = listResult?.total ?? 0;
  const { data: milestoneMaster = [], isError: milestonesFailed } = useQuery({ queryKey: ["crm-milestone-master"], queryFn: fetchMilestoneMaster, staleTime: 5 * 60_000 });
  const { data: dropdownData } = useQuery({ queryKey: ["business-dropdown"], queryFn: fetchCompanyProjectDropdown, staleTime: 5 * 60_000 });
  const companies = dropdownData?.companies ?? [];
  const projects = dropdownData?.projects ?? [];
  // A project tagged to several companies shows under each of them.
  const filterProjects = useMemo(() => (filterCompanyId ? projects.filter((p) => companiesOf(p).includes(filterCompanyId)) : projects), [projects, filterCompanyId]);

  const handleDelete = async (plan: any) => {
    if (!(await ask.confirm(`Delete the payment plan ${plan.PlanName}? This cannot be undone.`, { okLabel: "Delete", danger: true }))) return;
    setDeletingId(plan.Id);
    try {
      const res = await fetchWithAuth(`${API}/${plan.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the plan");
      toast.success("Payment plan deleted");
      setPreviewPlan(null);
      qc.invalidateQueries({ queryKey: ["crm-payment-plans"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setDeletingId(null);
    }
  };

  const activeOnPage = plans.filter((p) => p.IsActive).length;
  const unbalanced = plans.filter((p) => Math.round(Number(p.TotalPercent)) !== 100).length;
  const figures = [
    { label: "Plans", value: String(planTotal), note: filterCompanyId || filterProjectId ? "for this company / project" : "in all" },
    { label: "Active", value: String(activeOnPage), note: "on this page" },
    { label: "Not at 100%", value: String(unbalanced), note: "milestones after booking don't add up", red: unbalanced > 0 },
    { label: "Tagged to a project", value: String(plans.filter((p) => p.ProjectsJson && p.ProjectsJson !== "[]").length), note: "on this page; others are fallbacks" },
  ];

  return (
    <>
      {ask.node}
      <Breadcrumbs items={["Dashboard", "CRM", "Payment Plans"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Payment plans"
        subtitle="Reusable payment schedules: a fixed booking amount, then milestones that split the rest. Tag a plan to projects, then to blocks and units."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setFormTarget("new")} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New plan</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card px-4 py-3.5 flex flex-wrap items-end gap-2.5" style={{ border: RULE }}>
            <label className="block space-y-1 w-full sm:w-56">
              <span className={`block ${LBL}`}>Company</span>
              <select value={filterCompanyId} onChange={(e) => { setFilterCompanyId(e.target.value); setFilterProjectId(""); setPage(1); }} className={INP}>
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1 w-full sm:w-56">
              <span className={`block ${LBL}`}>Project</span>
              <select value={filterProjectId} onChange={(e) => { setFilterProjectId(e.target.value); setPage(1); }} className={INP}>
                <option value="">All projects</option>
                {filterProjects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </label>
            {(filterCompanyId || filterProjectId) && (
              <button onClick={() => { setFilterCompanyId(""); setFilterProjectId(""); setPage(1); }} className={`${KEY_LINE} h-9 px-3`}><X size={12} /> Clear</button>
            )}
          </div>

          {isError ? (
            <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>{(error as Error)?.message}</div>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Loading plans…</p>
          ) : plans.length === 0 ? (
            <div className="bg-card px-6 py-10 text-center" style={{ border: RULE_SOFT }}>
              <p className="text-sm text-muted-foreground">
                {filterCompanyId || filterProjectId ? "No payment plan is tagged to this company / project." : "No payment plans yet — create one to start tagging it onto units."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plans.map((p) => {
                const milestones = parseMilestones(p.MilestonesJson);
                const shown = milestones.slice(0, 5);
                const hidden = milestones.length - shown.length;
                const balanced = Math.round(Number(p.TotalPercent)) === 100;
                return (
                  <button key={p.Id} onClick={() => setPreviewPlan(p)}
                    className="flex flex-col justify-start text-left bg-card p-4 space-y-3 border border-foreground hover:bg-primary/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-heading text-sm font-bold">{p.PlanName}</div>
                        {p.Description && <div className="mt-0.5 text-xs text-muted-foreground">{p.Description}</div>}
                      </div>
                      <SheetMark text={p.IsActive ? "Active" : "Inactive"} tone={p.IsActive ? "done" : "draft"} />
                    </div>
                    <MilestoneBar milestones={milestones} />
                    {/* Every card shows its actual split, so a plan needn't be opened to know what it is. */}
                    <div className="space-y-1">
                      {shown.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="h-2.5 w-2.5 shrink-0 border border-foreground/40" style={{ background: i === 0 ? "transparent" : segmentColor(i) }} />
                          <span className="flex-1 min-w-0 truncate">{m.name}</span>
                          <span className={`${NUM} font-semibold`}>{i === 0 ? fmtRupees(Number(p.BookingAmount || 0)) : `${m.pct}%`}</span>
                        </div>
                      ))}
                      {hidden > 0 && <div className="text-xs text-muted-foreground pl-[18px]">+{hidden} more…</div>}
                    </div>
                    <div className="pt-2 flex items-center justify-between text-xs text-muted-foreground" style={{ borderTop: RULE_SOFT }}>
                      <span><span className={NUM}>{p.ItemCount}</span> milestone{p.ItemCount === 1 ? "" : "s"}</span>
                      <span className={`${NUM} font-semibold ${balanced ? "text-foreground" : "text-destructive"}`}>{p.TotalPercent}% after booking</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={planTotal} onPage={setPage} />
        </div>
      </SheetShell>

      <PlanPreviewDialog plan={previewPlan} onClose={() => setPreviewPlan(null)} companies={companies} projects={projects}
        canEdit={rights.canEdit} canDelete={rights.canDelete} deleting={deletingId === previewPlan?.Id}
        onEdit={(id) => { setPreviewPlan(null); setFormTarget(id); }} onDelete={handleDelete} />

      <PlanFormDialog target={formTarget} onClose={() => setFormTarget(null)}
        milestoneMaster={milestoneMaster} milestonesFailed={milestonesFailed} companies={companies} projects={projects} />
    </>
  );
};

export default CrmPaymentPlans;

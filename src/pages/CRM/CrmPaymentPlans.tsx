import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Trash2, Pencil, Layers, ListChecks, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/payment-plans";
const MILESTONE_MASTER_API = "/api/crm/milestone-master";

// Cycled across a plan's milestone rows so the segmented bar (card + preview)
// gives each milestone a stable, distinguishable color regardless of how many
// milestones the plan has.
const SEGMENT_COLORS = [
  "bg-primary", "bg-sky-500", "bg-emerald-500", "bg-violet-500",
  "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-fuchsia-500",
];

type MilestoneRow = { name: string; pct: number };

function parseMilestones(json: string | null | undefined): MilestoneRow[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    return (raw as any[]).map((r) => ({ name: r.name, pct: Number(r.pct) || 0 }));
  } catch { return []; }
}

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchMilestoneMaster(): Promise<any[]> {
  try { const r = await fetchWithAuth(MILESTONE_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
}
// Company -> Project source for the Tagged Projects picker below. Company
// is the real top of this hierarchy (dbo.enterprise: business_type 'C' is a
// Project's business_type 'P' parent via company_id) — this reuses the same
// shared dropdown endpoint CrmApplication.tsx/BlockMaster.tsx/UnitMaster.tsx
// already use for their own Company -> Project chains, so the chip picker
// below can group projects under their Company instead of one flat list.
async function fetchCompanyProjectDropdown(): Promise<{
  companies: { id: number; name: string }[];
  projects: { id: number; name: string; company_id: number }[];
}> {
  try {
    const r = await fetchWithAuth("/api/business/dropdown");
    return r.ok ? r.json() : { companies: [], projects: [] };
  } catch { return { companies: [], projects: [] }; }
}
async function fetchPlanDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}

// The segmented percentage bar shared by both the card grid and the preview
// dialog — a plan's milestone split is the one thing worth seeing at a
// glance, so it gets a real proportional visual instead of just a number.
const MilestoneBar: React.FC<{ milestones: MilestoneRow[]; height?: string }> = ({ milestones, height = "h-2" }) => {
  if (!milestones.length) return <div className={`${height} w-full rounded-full bg-muted`} />;
  return (
    <div className={`flex ${height} w-full overflow-hidden rounded-full bg-muted gap-px`}>
      {milestones.map((m, i) => (
        <div
          key={i}
          title={`${m.name} — ${m.pct}%`}
          className={`${SEGMENT_COLORS[i % SEGMENT_COLORS.length]} first:rounded-l-full last:rounded-r-full`}
          style={{ width: `${m.pct}%` }}
        />
      ))}
    </div>
  );
};

const CrmPaymentPlans: React.FC = () => {
  const qc = useQueryClient();

  // Edit/Create form dialog — always editable while open (see previewPlan
  // below for the read-only view; there's no longer a "locked" mode here).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [planName, setPlanName] = useState("");
  const [description, setDescription] = useState("");
  // Booking is a fixed ₹ figure decided when the PLAN is created — not typed
  // fresh on every booking, and never a % of the plan (see the locked row
  // below). This is what generateMilestonesForBooking (backend) now treats
  // as the authoritative Booking amount for any booking tagged to this plan.
  const [bookingAmount, setBookingAmount] = useState("");
  const [items, setItems] = useState([{ MilestoneMasterId: "", MilestoneName: "Booking", Percent: "" }]);
  // Which Projects this plan is tagged to — the top tier of the Project ->
  // Block -> Unit cascade (see crmEntityCreation.js's getApplicablePaymentPlans).
  // Optional: an untagged plan still participates in every level's "all
  // active plans" fallback, it just never appears in a Project-filtered list.
  const [projectIds, setProjectIds] = useState<string[]>([]);
  // Dropdown-wise Add-a-Project flow for the Tagged Projects field below —
  // Company picked first, Project narrows to that Company's list and stays
  // disabled until then (same disciplined Company->Project gate every other
  // master page in the app now uses), then "+ Add" appends it to projectIds.
  const [tagCompanyId, setTagCompanyId] = useState("");
  const [tagProjectId, setTagProjectId] = useState("");
  const [saving, setSaving] = useState(false);

  // Read-only preview, opened by tapping a card. Built straight from the
  // list row's own MilestonesJson — no extra fetch, no loading flicker.
  const [previewPlan, setPreviewPlan] = useState<any | null>(null);

  const inputCls = "w-full text-sm border border-border rounded px-2 py-1.5 bg-background";

  const { data: plans = [], isLoading } = useQuery({ queryKey: ["crm-payment-plans"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: milestoneMaster = [] } = useQuery({ queryKey: ["crm-milestone-master"], queryFn: fetchMilestoneMaster, staleTime: 5 * 60_000 });
  const { data: dropdownData } = useQuery({ queryKey: ["business-dropdown"], queryFn: fetchCompanyProjectDropdown, staleTime: 5 * 60_000 });
  const companies = dropdownData?.companies ?? [];
  const projects = dropdownData?.projects ?? [];
  // Lookups for the dropdown-wise Add-a-Project flow and the selected-chips
  // list below — a plan can legitimately tag Projects across multiple
  // Companies, so Company here is just which list the Project dropdown
  // narrows to, not a hard single-Company gate on the whole field.
  const companiesById = useMemo(() => new Map(companies.map((c) => [String(c.id), c])), [companies]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects]);
  const projectsForTagCompany = useMemo(
    () => (tagCompanyId
      ? projects.filter((p) => String(p.company_id) === tagCompanyId && !projectIds.includes(String(p.id)))
      : []),
    [projects, tagCompanyId, projectIds],
  );
  const selectedTaggedProjects = useMemo(
    () => projectIds
      .map((id) => {
        const p = projectsById.get(id);
        if (!p) return null;
        const company = companiesById.get(String(p.company_id));
        return { id, name: p.name, companyName: company?.name ?? "" };
      })
      .filter((x): x is { id: string; name: string; companyName: string } => x !== null),
    [projectIds, projectsById, companiesById],
  );

  const handleAddTaggedProject = () => {
    if (!tagProjectId) return;
    setProjectIds((prev) => (prev.includes(tagProjectId) ? prev : [...prev, tagProjectId]));
    setTagProjectId("");
  };

  // Item 0 is always "Booking" — a fixed ₹ figure decided per booking, never
  // a slice of the plan's 100%. Only the milestones that come after Booking
  // are required to sum to 100 (that 100% represents TotalValue - Booking,
  // not TotalValue itself — see generateMilestonesForBooking on the backend).
  const totalPct = items.slice(1).reduce((s, i) => s + (parseFloat(i.Percent) || 0), 0);

  const resetForm = () => {
    setEditingId(null);
    setPlanName(""); setDescription(""); setBookingAmount("");
    setItems([{ MilestoneMasterId: "", MilestoneName: "Booking", Percent: "" }]);
    setProjectIds([]);
    setTagCompanyId(""); setTagProjectId("");
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  const openEdit = async (id: number) => {
    setPreviewPlan(null);
    const detail = await fetchPlanDetail(id);
    if (!detail) { toast.error("Could not load plan"); return; }
    const { plan, items: planItems } = detail;
    setEditingId(id);
    setPlanName(plan.PlanName);
    setDescription(plan.Description || "");
    setBookingAmount(plan.BookingAmount != null ? String(plan.BookingAmount) : "");
    setProjectIds(plan.ProjectIds ? String(plan.ProjectIds).split(",") : []);
    setTagCompanyId(""); setTagProjectId("");
    setItems(
      (planItems as any[]).length
        ? planItems.map((i: any) => ({
            MilestoneMasterId: i.MilestoneMasterId ? String(i.MilestoneMasterId) : "",
            MilestoneName: i.MilestoneName, Percent: String(i.Percent),
          }))
        : [{ MilestoneMasterId: "", MilestoneName: "Booking", Percent: "" }],
    );
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!planName.trim()) { toast.error("Plan name is required"); return; }
    if (bookingAmount === "" || isNaN(parseFloat(bookingAmount)) || parseFloat(bookingAmount) < 0) {
      toast.error("Enter a valid Booking Amount for this plan"); return;
    }
    if (items.length < 2) { toast.error("Add at least one milestone after Booking"); return; }
    if (Math.round(totalPct * 100) !== 10000) { toast.error(`Post-Booking milestones must sum to 100% (currently ${totalPct}%)`); return; }
    const seenMasterIds = new Set<string>();
    for (const it of items) {
      if (!it.MilestoneMasterId) continue;
      if (seenMasterIds.has(it.MilestoneMasterId)) {
        toast.error(`"${it.MilestoneName}" is selected more than once — each milestone can only appear once per plan`);
        return;
      }
      seenMasterIds.add(it.MilestoneMasterId);
    }
    setSaving(true);
    try {
      const isEdit = editingId != null;
      // Booking never carries a % — it's a real ₹ amount fixed on the plan
      // itself, so its stored Percent is always 0 regardless of what an
      // older plan (saved before this rule) had in that field.
      const normalizedItems = items.map((it, idx) => idx === 0 ? { ...it, Percent: "0" } : it);
      const res = await fetchWithAuth(isEdit ? `${API}/${editingId}` : API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          PlanName: planName, Description: description, BookingAmount: bookingAmount, Items: normalizedItems,
          ProjectIds: projectIds.map((x) => parseInt(x)).filter(Number.isFinite),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (isEdit && data.bookingsUsingPlan > 0) {
        toast.success(
          `Payment plan updated. Note: ${data.bookingsUsingPlan} existing booking(s) already generated their schedule from the old split and are unaffected — only new bookings use the updated split.`,
          { duration: 7000 },
        );
      } else {
        toast.success(isEdit ? "Payment plan updated" : "Payment plan created");
      }
      setDialogOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["crm-payment-plans"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const previewMilestones = useMemo(() => parseMilestones(previewPlan?.MilestonesJson), [previewPlan]);

  return (
    <SalesAutoShell
      title="CRM — Payment Plan Master"
      subtitle="Reusable milestone templates — tag them onto units from Unit Master"
      action={
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Plan
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : plans.length === 0 ? (
          <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center">
            <Layers size={24} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No payment plans yet — create one to start tagging it onto units.</p>
          </div>
        ) : (plans as any[]).map((p: any) => {
          const milestones = parseMilestones(p.MilestonesJson);
          const shown = milestones.slice(0, 5);
          const hiddenCount = milestones.length - shown.length;
          return (
            <button
              key={p.Id}
              onClick={() => setPreviewPlan(p)}
              className="group text-left rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{p.PlanName}</div>
                  {p.Description && <div className="text-xs text-muted-foreground mt-0.5">{p.Description}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    p.IsActive
                      ? "text-green-600 dark:text-green-400 bg-green-500/15 border-green-500/30"
                      : "text-muted-foreground bg-muted/50 border-border"
                  }`}>
                    {p.IsActive ? "Active" : "Inactive"}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); openEdit(p.Id); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openEdit(p.Id); } }}
                    title="Edit plan"
                    className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-muted opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <Pencil size={13} />
                  </span>
                </div>
              </div>

              <div className="mt-3">
                <MilestoneBar milestones={milestones} />
              </div>

              {/* The brief itself — every card shows its actual milestone
                  split, not just a count, so staff don't have to open the
                  preview to know what they're tagging onto a unit. */}
              <div className="mt-2.5 space-y-1">
                {shown.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} />
                    <span className="flex-1 min-w-0 text-foreground/90 truncate">{m.name}</span>
                    <span className="font-semibold tabular-nums text-muted-foreground">
                      {i === 0 ? `₹${Number(p.BookingAmount || 0).toLocaleString("en-IN")}` : `${m.pct}%`}
                    </span>
                  </div>
                ))}
                {hiddenCount > 0 && (
                  <div className="text-xs text-muted-foreground pl-3.5">+{hiddenCount} more…</div>
                )}
              </div>

              <div className="mt-2.5 pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><ListChecks size={12} /> {p.ItemCount} milestone{p.ItemCount === 1 ? "" : "s"}</span>
                <span className={Math.round(p.TotalPercent) === 100 ? "text-green-600 dark:text-green-400 font-medium" : "text-amber-600 font-medium"}>
                  {p.TotalPercent}% total
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Read-only preview — tapping a card opens this instead of dropping
          straight into a greyed-out copy of the edit form. */}
      <Dialog open={!!previewPlan} onOpenChange={(o) => { if (!o) setPreviewPlan(null); }}>
        <DialogContent className="max-w-lg">
          {previewPlan && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading flex items-start justify-between gap-2 pr-6">
                  <div className="min-w-0">
                    <div>{previewPlan.PlanName}</div>
                    {previewPlan.Description && (
                      <div className="text-xs font-normal text-muted-foreground mt-1">{previewPlan.Description}</div>
                    )}
                  </div>
                  <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    previewPlan.IsActive
                      ? "text-green-600 dark:text-green-400 bg-green-500/15 border-green-500/30"
                      : "text-muted-foreground bg-muted/50 border-border"
                  }`}>
                    {previewPlan.IsActive ? "Active" : "Inactive"}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <MilestoneBar milestones={previewMilestones} height="h-2.5" />

                <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
                  {previewMilestones.map((m, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-sm rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <span className={`mt-0.5 shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`}>
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 break-words text-foreground font-medium">{m.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                        {i === 0 ? `₹${Number(previewPlan.BookingAmount || 0).toLocaleString("en-IN")}` : `${m.pct}%`}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
                  <span className="flex items-center gap-3">
                    <span>{previewMilestones.length} milestone{previewMilestones.length === 1 ? "" : "s"}</span>
                    {previewPlan.CreatedAt && <span>Created {new Date(previewPlan.CreatedAt).toLocaleDateString()}</span>}
                  </span>
                  <span className={Math.round(previewMilestones.slice(1).reduce((s, m) => s + m.pct, 0)) === 100 ? "text-green-600 dark:text-green-400 font-semibold" : "text-amber-600 font-semibold"}>
                    {previewMilestones.slice(1).reduce((s, m) => s + m.pct, 0)}% total (after Booking)
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button onClick={() => setPreviewPlan(null)}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
                <button onClick={() => openEdit(previewPlan.Id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                  <Pencil size={13} /> Edit Plan
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create / Edit form — always editable while open. */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editingId != null ? "Edit Payment Plan" : "New Payment Plan"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Plan Name *</label>
              <input type="text" value={planName} onChange={(e) => setPlanName(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                className={inputCls} />
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Tagged Projects</label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Optional — leave empty and this plan still shows up everywhere as a fallback option.
                Tag it to one or more Projects to make it selectable from Block/Unit Payment Plan pickers under those Projects.
              </p>

              {/* Dropdown-wise add flow — pick a Company, then a Project
                  under it, then Add. Same Company -> Project gate used
                  everywhere else in the app (Project stays disabled with a
                  plain-language hint until a Company is chosen), so this
                  reads the same way for a non-technical user as every other
                  master page instead of a wall of always-visible toggle chips. */}
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Company</label>
                    <select
                      value={tagCompanyId}
                      onChange={(e) => { setTagCompanyId(e.target.value); setTagProjectId(""); }}
                      className={inputCls}
                    >
                      <option value="">Select company</option>
                      {companies.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Project</label>
                    <select
                      value={tagProjectId}
                      onChange={(e) => setTagProjectId(e.target.value)}
                      disabled={!tagCompanyId}
                      className={`${inputCls} ${!tagCompanyId ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <option value="">
                        {!tagCompanyId
                          ? "Select a Company first"
                          : projectsForTagCompany.length === 0
                            ? "All projects already tagged"
                            : "Select project"}
                      </option>
                      {projectsForTagCompany.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddTaggedProject}
                    disabled={!tagProjectId}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed h-[34px]"
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
              </div>

              {/* Already-tagged Projects — shown as removable chips, each
                  labeled with its Company so it's unambiguous which is which
                  even when Projects across different Companies are tagged
                  at once. */}
              <div className="mt-2.5">
                {selectedTaggedProjects.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No projects tagged yet — add one above.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selectedTaggedProjects.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-heading bg-primary/10 text-foreground border border-primary/30"
                      >
                        <span>
                          {p.name}
                          {p.companyName && <span className="text-muted-foreground font-normal"> — {p.companyName}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => setProjectIds((prev) => prev.filter((x) => x !== p.id))}
                          title={`Remove ${p.name}`}
                          className="p-0.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Milestones after Booking (must total 100%)</label>
                <span className={`text-xs font-medium ${Math.round(totalPct * 100) === 10000 ? "text-green-600 dark:text-green-400" : "text-red-600"}`}>{totalPct}%</span>
              </div>
              <div className="space-y-2.5">
                {items.map((it, idx) => {
                  const fromMaster = !!it.MilestoneMasterId;
                  const isBooking = idx === 0;
                  if (isBooking) {
                    return (
                      <div key={idx} className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-1 shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold">
                            1
                          </span>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="text-sm font-medium text-foreground">Booking</div>
                            <p className="text-[11px] text-muted-foreground">
                              Fixed ₹ amount, set here on the plan — never typed per booking, never a % of
                              the plan. Milestones below split 100% of whatever's left after this is deducted.
                            </p>
                            <div>
                              <label className="text-[11px] text-muted-foreground block mb-1">Booking Amount (₹) *</label>
                              <div className="relative w-40">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">₹</span>
                                <input type="number" placeholder="0" value={bookingAmount}
                                  onChange={(e) => setBookingAmount(e.target.value)}
                                  className={`${inputCls} pl-5 font-semibold`} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-1 shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div>
                            <label className="text-[11px] text-muted-foreground block mb-1">Source</label>
                            <select value={it.MilestoneMasterId}
                              onChange={(e) => {
                                const master = (milestoneMaster as any[]).find((m: any) => String(m.Id) === e.target.value);
                                setItems((arr) => arr.map((x, i) => i === idx ? {
                                  ...x,
                                  MilestoneMasterId: e.target.value,
                                  MilestoneName: master ? master.Name : x.MilestoneName,
                                } : x));
                              }}
                              className={inputCls}>
                              <option value="">✎ Custom milestone (type name below)</option>
                              {(milestoneMaster as any[])
                                .filter((m: any) => m.IsActive)
                                // Don't offer "Booking" here — it's already the fixed row above.
                                .filter((m: any) => m.Name?.trim().toLowerCase() !== "booking")
                                // Each master milestone can only be used once per plan — hide it
                                // from every row except the one that currently has it selected.
                                .filter((m: any) => String(m.Id) === it.MilestoneMasterId
                                  || !items.some((x, i) => i !== idx && String(x.MilestoneMasterId) === String(m.Id)))
                                .map((m: any) => (
                                  <option key={m.Id} value={String(m.Id)}>{m.Name}</option>
                                ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                            <div>
                              <label className="text-[11px] text-muted-foreground block mb-1">Milestone Name</label>
                              {fromMaster ? (
                                <div className="w-full text-sm rounded px-2 py-1.5 bg-muted/40 border border-border text-foreground font-medium truncate" title={it.MilestoneName}>
                                  {it.MilestoneName}
                                </div>
                              ) : (
                                <input type="text" placeholder="e.g. Foundation, Handover" value={it.MilestoneName}
                                  onChange={(e) => setItems((arr) => arr.map((x, i) => i === idx ? { ...x, MilestoneName: e.target.value } : x))}
                                  className={inputCls} />
                              )}
                            </div>
                            <div>
                              <label className="text-[11px] text-muted-foreground block mb-1">% Share</label>
                              <div className="relative w-24">
                                <input type="number" placeholder="0" value={it.Percent}
                                  onChange={(e) => setItems((arr) => arr.map((x, i) => i === idx ? { ...x, Percent: e.target.value } : x))}
                                  className={`${inputCls} pr-6 text-right font-semibold`} />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <button onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))}
                          title="Remove milestone"
                          className="mt-1 shrink-0 p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => setItems((arr) => [...arr, { MilestoneMasterId: "", MilestoneName: "", Percent: "" }])}
                className="text-xs text-primary hover:underline mt-2">+ Add milestone</button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); resetForm(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : editingId != null ? "Save Changes" : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmPaymentPlans;
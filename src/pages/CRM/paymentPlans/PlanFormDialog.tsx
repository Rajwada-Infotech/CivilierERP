// Create or edit a payment plan: its name, the fixed booking amount, the milestones after booking (100% between
// them), the projects it's tagged to, and whether it's offered.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Plus, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SheetMark } from "@/components/sheet/Sheet";
import {
  API, INP, KEY_INK, KEY_LINE, LBL, NUM, RULE, RULE_SOFT, companiesOf, fetchPlanDetail, parseTaggedProjects,
  type Company, type Project,
} from "./config";

type Item = { MilestoneMasterId: string; MilestoneName: string; Percent: string };
const BOOKING_ROW: Item = { MilestoneMasterId: "", MilestoneName: "Booking", Percent: "" };

export const PlanFormDialog: React.FC<{
  /** null = closed; "new" = a new plan; a number = that plan. */
  target: number | "new" | null;
  onClose: () => void;
  milestoneMaster: any[]; milestonesFailed: boolean;
  companies: Company[]; projects: Project[];
}> = ({ target, onClose, milestoneMaster, milestonesFailed, companies, projects }) => {
  const qc = useQueryClient();
  const editingId = typeof target === "number" ? target : null;
  const [loading, setLoading] = useState(false);
  const [planName, setPlanName] = useState("");
  const [description, setDescription] = useState("");
  // Booking is a fixed ₹ figure set on the PLAN — never typed per booking, never a % of the plan. It is what the
  // server's generateMilestonesForBooking takes as the booking amount for any booking on this plan.
  const [bookingAmount, setBookingAmount] = useState("");
  const [items, setItems] = useState<Item[]>([BOOKING_ROW]);
  // The projects this plan is tagged to (many-to-many). Optional: an untagged plan is offered everywhere as a fallback.
  const [projectIds, setProjectIds] = useState<string[]>([]);
  // Only sent when the user added / removed a tag this session — loading the plan's tags is not a change. Sending them
  // on every save used to wipe real tags whenever that load was incomplete.
  const [projectTagsTouched, setProjectTagsTouched] = useState(false);
  const [tagCompanyId, setTagCompanyId] = useState("");
  const [tagProjectPick, setTagProjectPick] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Opening one plan, then another before the first loads, must not let the first land late and stomp the second.
  const requestRef = useRef(0);
  useEffect(() => {
    if (target === null) return;
    const requestId = ++requestRef.current;
    setPlanName(""); setDescription(""); setBookingAmount(""); setItems([BOOKING_ROW]);
    setProjectIds([]); setProjectTagsTouched(false); setTagCompanyId(""); setTagProjectPick(""); setIsActive(true);
    if (target === "new") return;
    setLoading(true);
    fetchPlanDetail(target)
      .then(({ plan, items: planItems }) => {
        if (requestRef.current !== requestId) return;
        setPlanName(plan.PlanName);
        setDescription(plan.Description || "");
        setBookingAmount(plan.BookingAmount != null ? String(plan.BookingAmount) : "");
        setProjectIds(parseTaggedProjects(plan.ProjectsJson).map((row) => String(row.ProjectId)));
        setIsActive(plan.IsActive !== false && plan.IsActive !== 0);
        setItems((planItems as any[]).length
          ? planItems.map((i: any) => ({ MilestoneMasterId: i.MilestoneMasterId ? String(i.MilestoneMasterId) : "", MilestoneName: i.MilestoneName, Percent: String(i.Percent) }))
          : [BOOKING_ROW]);
      })
      .catch((e) => { if (requestRef.current === requestId) { toast.error(e.message); onClose(); } })
      .finally(() => { if (requestRef.current === requestId) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const companiesById = useMemo(() => new Map(companies.map((c) => [String(c.id), c])), [companies]);
  const projectsById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects]);
  const projectsForTagCompany = useMemo(() => (tagCompanyId ? projects.filter((p) => companiesOf(p).includes(tagCompanyId)) : []), [projects, tagCompanyId]);
  const selectedTagged = projectIds.map((id) => {
    const p = projectsById.get(id);
    const company = p ? companiesById.get(String(p.company_id)) : null;
    return { id, name: p?.name ?? "A project outside your access", companyName: company?.name ?? "", known: !!p };
  });

  // Booking (row 0) is a fixed ₹ amount; only the milestones after it split 100% (of the value less booking).
  const totalPct = items.slice(1).reduce((s, i) => s + (parseFloat(i.Percent) || 0), 0);
  const balanced = Math.round(totalPct * 100) === 10000;
  const hasUnusedMilestones = useMemo(() => {
    const used = new Set(items.slice(1).map((i) => i.MilestoneMasterId).filter(Boolean));
    return milestoneMaster.some((m: any) => m.IsActive && m.Name?.trim().toLowerCase() !== "booking" && !used.has(String(m.Id)));
  }, [milestoneMaster, items]);

  const save = async () => {
    if (!planName.trim()) { toast.error("Plan name is required"); return; }
    if (bookingAmount === "" || isNaN(parseFloat(bookingAmount)) || parseFloat(bookingAmount) < 0) { toast.error("Enter a valid booking amount for this plan"); return; }
    if (items.length < 2) { toast.error("Add at least one milestone after Booking"); return; }
    if (!balanced) { toast.error(`Milestones after Booking must total 100% (now ${totalPct}%)`); return; }
    if (items.slice(1).some((it) => !it.MilestoneMasterId)) { toast.error("Pick a milestone for every row"); return; }
    const seen = new Set<string>();
    for (const it of items) {
      if (!it.MilestoneMasterId) continue;
      if (seen.has(it.MilestoneMasterId)) { toast.error(`"${it.MilestoneName}" is picked more than once — each milestone can appear once per plan`); return; }
      seen.add(it.MilestoneMasterId);
    }
    setSaving(true);
    try {
      // Booking never carries a % — its stored Percent is always 0, whatever an older plan held.
      const normalizedItems = items.map((it, idx) => (idx === 0 ? { ...it, Percent: "0" } : it));
      const body: Record<string, any> = { PlanName: planName, Description: description, BookingAmount: bookingAmount, Items: normalizedItems, IsActive: isActive };
      if (editingId == null || projectTagsTouched) body.ProjectIds = projectIds.map((id) => parseInt(id, 10));
      const res = await fetchWithAuth(editingId != null ? `${API}/${editingId}` : API, {
        method: editingId != null ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the plan");
      if (editingId != null && data.bookingsUsingPlan > 0) {
        toast.success(`Payment plan updated. ${data.bookingsUsingPlan} existing booking(s) already made their schedule from the old split and keep it — only new bookings use the new one.`, { duration: 7000 });
      } else {
        toast.success(editingId != null ? "Payment plan updated" : "Payment plan created");
      }
      qc.invalidateQueries({ queryKey: ["crm-payment-plans"] });
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, children: React.ReactNode, required = false) => (
    <label className="block space-y-1 min-w-0">
      <span className={`block ${LBL}`}>{label}{required && <span className="text-destructive"> *</span>}</span>
      {children}
    </label>
  );
  const head = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";

  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto thin-scroll rounded-none p-5 gap-4" style={{ border: RULE }}>
        <div className="pb-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>Payment plans</p>
          <DialogTitle className="mt-1 font-heading text-lg font-bold tracking-tight">{editingId != null ? `Edit ${planName || "plan"}` : "New payment plan"}</DialogTitle>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Loading the plan…</p> : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {field("Plan name", <input value={planName} onChange={(e) => setPlanName(e.target.value)} className={INP} />, true)}
              {field("Description", <input value={description} onChange={(e) => setDescription(e.target.value)} className={INP} />)}
            </div>

            <button type="button" role="switch" aria-checked={isActive} onClick={() => setIsActive((v) => !v)} className="flex items-start gap-3 text-left">
              <span className={`mt-0.5 relative h-4 w-7 shrink-0 border border-foreground transition-colors ${isActive ? "bg-foreground" : "bg-card"}`}>
                <span className={`absolute top-[2px] h-2.5 w-2.5 transition-all ${isActive ? "left-[14px] bg-card" : "left-[2px] bg-foreground"}`} />
              </span>
              <span className="text-xs">
                <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]">Status</span>
                <span className="text-muted-foreground"> — {isActive ? "Active: offered wherever payment plans are picked." : "Inactive: hidden from pickers, kept for existing bookings."}</span>
              </span>
            </button>

            <section className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className={head}>Milestones</span>
                <span className="text-xs text-muted-foreground">After booking: <span className={`${NUM} font-semibold ${balanced ? "text-foreground" : "text-destructive"}`}>{totalPct}%</span> of 100%</span>
              </div>
              {milestonesFailed && <p className="text-xs text-destructive">The milestones didn&apos;t load, so none can be picked. Reload the page.</p>}
              <div style={{ border: RULE }}>
                {items.map((it, idx) => idx === 0 ? (
                  <div key={idx} className="px-3 py-3 bg-primary/5 flex flex-wrap items-end gap-3" style={{ borderBottom: RULE_SOFT }}>
                    <span className={`${NUM} text-xs w-5`}>1</span>
                    <div className="flex-1 min-w-[12rem]">
                      <p className="text-sm font-semibold">Booking</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">A fixed amount set on the plan, never a % — the milestones below split 100% of what&apos;s left after it.</p>
                    </div>
                    <label className="block space-y-1 w-40">
                      <span className={`block ${LBL}`}>Amount ₹ <span className="text-destructive">*</span></span>
                      <input type="number" placeholder="0" value={bookingAmount} onChange={(e) => setBookingAmount(e.target.value)} className={`${INP} ${NUM} text-right font-semibold`} />
                    </label>
                  </div>
                ) : (
                  <div key={idx} className="px-3 py-2.5 flex flex-wrap items-end gap-3" style={{ borderBottom: RULE_SOFT }}>
                    <span className={`${NUM} text-xs w-5 pb-2.5`}>{idx + 1}</span>
                    <label className="block space-y-1 flex-1 min-w-[12rem]">
                      <span className={`block ${LBL}`}>Milestone <span className="text-destructive">*</span></span>
                      <select value={it.MilestoneMasterId} className={INP}
                        onChange={(e) => {
                          const master = milestoneMaster.find((m: any) => String(m.Id) === e.target.value);
                          setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, MilestoneMasterId: e.target.value, MilestoneName: master ? master.Name : "" } : x)));
                        }}>
                        <option value="">Select a milestone…</option>
                        {milestoneMaster
                          // One deactivated after being picked stays on its row, so a save doesn't detach it.
                          .filter((m: any) => m.IsActive || String(m.Id) === it.MilestoneMasterId)
                          .filter((m: any) => m.Name?.trim().toLowerCase() !== "booking")
                          // Each milestone once per plan.
                          .filter((m: any) => String(m.Id) === it.MilestoneMasterId || !items.some((x, i) => i !== idx && String(x.MilestoneMasterId) === String(m.Id)))
                          .map((m: any) => <option key={m.Id} value={String(m.Id)}>{m.Name}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1 w-24">
                      <span className={`block ${LBL}`}>Share %</span>
                      <input type="number" placeholder="0" value={it.Percent}
                        onChange={(e) => setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, Percent: e.target.value } : x)))}
                        className={`${INP} ${NUM} text-right font-semibold`} />
                    </label>
                    <button onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))} title="Remove milestone"
                      className="w-9 h-9 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setItems((arr) => [...arr, { MilestoneMasterId: "", MilestoneName: "", Percent: "" }])} disabled={!hasUnusedMilestones} className={`${KEY_LINE} h-8 px-3`}>
                  <Plus size={12} /> Add milestone
                </button>
                {!hasUnusedMilestones && !milestonesFailed && (
                  <span className="text-xs text-muted-foreground">Every active milestone is already in this plan — <Link to="/crm/milestone-master" className="underline underline-offset-2">add more in Milestone Master</Link>.</span>
                )}
              </div>
            </section>

            <section className="space-y-2.5">
              <span className={head}>Tagged projects</span>
              <p className="text-xs text-muted-foreground">
                Optional — untagged, the plan is offered everywhere as a fallback. Tagged, it&apos;s offered in those projects&apos; block and unit pickers. A plan can be tagged to many projects, across companies.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                {field("Company", (
                  <select value={tagCompanyId} onChange={(e) => { setTagCompanyId(e.target.value); setTagProjectPick(""); }} className={INP}>
                    <option value="">Select a company</option>
                    {companies.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                ))}
                {field("Project", (
                  <select value={tagProjectPick} onChange={(e) => setTagProjectPick(e.target.value)} disabled={!tagCompanyId} className={`${INP} disabled:opacity-50`}>
                    <option value="">{tagCompanyId ? "Select a project" : "Select a company first"}</option>
                    {projectsForTagCompany.filter((p) => !projectIds.includes(String(p.id))).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                  </select>
                ))}
                <button type="button" disabled={!tagProjectPick} className={`${KEY_LINE} h-9 px-3`}
                  onClick={() => {
                    if (!tagProjectPick || projectIds.includes(tagProjectPick)) return;
                    setProjectIds((ids) => [...ids, tagProjectPick]); setProjectTagsTouched(true); setTagProjectPick("");
                  }}>
                  <Plus size={12} /> Add
                </button>
              </div>
              {selectedTagged.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedTagged.map((tp) => (
                    <span key={tp.id} className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 text-xs border border-foreground/40">
                      <span>{tp.name}{tp.companyName && <span className="text-muted-foreground"> · {tp.companyName}</span>}</span>
                      {/* A tag on a project outside the user's access stays as it is (the server keeps it). */}
                      {tp.known && (
                        <button type="button" onClick={() => { setProjectIds((ids) => ids.filter((id) => id !== tp.id)); setProjectTagsTouched(true); }}
                          title={`Remove ${tp.name}`} className="p-0.5 text-muted-foreground hover:text-destructive"><X size={11} /></button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {!selectedTagged.length && <SheetMark text="Not tagged — a fallback everywhere" tone="draft" />}
            </section>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={save} disabled={saving || loading} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : editingId != null ? "Save changes" : "Create plan"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

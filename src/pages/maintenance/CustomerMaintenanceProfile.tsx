import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UserCircle2, Phone, Mail, Home, Building2, ArrowLeft,
  History, Wallet, ListChecks, Receipt, Ticket, Plus, X,
  Loader2, CheckCircle2, Clock, AlertCircle, Calendar,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlassSection } from "@/components/dashboard/GlassShell";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getMaintenanceCustomer, getMaintenanceCharges, addMaintenanceCharge, removeMaintenanceCharge,
  type MaintenanceCustomerCharge,
} from "@/api/maintenanceApi";
import { getMaintenanceBills, type MaintenanceBillListRow } from "@/api/maintenanceBillApi";
import {
  getTicketsForBooking, createServiceTicket, markTicketInProgress,
  resolveServiceTicket, closeServiceTicket,
  type ServiceTicketRow, type TicketCategory, type TicketPriority,
} from "@/api/serviceTicketApi";
import { getActiveChargeHeads, type ChargeHeadRow } from "@/api/chargeHeadApi";
import { usePageRights } from "@/hooks/usePageRights";

const INR = (n: number | null | undefined) =>
  `\u20B9${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "\u2014");

const STATUS_COLOR: Record<string, string> = {
  Open:       "bg-amber-500/10 border-amber-500/20 text-amber-600",
  Assigned:   "bg-sky-500/10 border-sky-500/20 text-sky-600",
  InProgress: "bg-violet-500/10 border-violet-500/20 text-violet-600",
  Resolved:   "bg-emerald-500/10 border-emerald-500/20 text-emerald-600",
  Closed:     "bg-muted border-border text-muted-foreground",
  Reopened:   "bg-orange-500/10 border-orange-500/20 text-orange-600",
};
const PRIORITY_COLOR: Record<string, string> = {
  Urgent: "bg-red-500/10 border-red-500/20 text-red-600",
  High:   "bg-orange-500/10 border-orange-500/20 text-orange-600",
  Normal: "bg-sky-500/10 border-sky-500/20 text-sky-600",
  Low:    "bg-muted border-border text-muted-foreground",
};
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${STATUS_COLOR[status] || "bg-muted border-border text-muted-foreground"}`}>
      {status}
    </span>
  );
}
function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${PRIORITY_COLOR[priority] || "bg-muted border-border text-muted-foreground"}`}>
      {priority}
    </span>
  );
}

const TICKET_CATEGORIES: TicketCategory[] = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const TICKET_PRIORITIES: TicketPriority[] = ["Low", "Normal", "High", "Urgent"];


export default function CustomerMaintenanceProfile() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const chargesRights = usePageRights("maintenance-customer-charges");
  const ticketRights  = usePageRights("crm-service-tickets");
  const qc = useQueryClient();

  const [addChargeOpen, setAddChargeOpen]       = useState(false);
  const [raiseTicketOpen, setRaiseTicketOpen]   = useState(false);
  const [resolveTicketId, setResolveTicketId]   = useState<number | null>(null);
  const [resolutionNotes, setResolutionNotes]   = useState("");
  const [actionLoading, setActionLoading]       = useState(false);
  const [removingChargeId, setRemovingChargeId] = useState<number | null>(null);

  const { data: customer, isLoading: customerLoading, error: customerError } = useQuery({
    queryKey: ["maintenance-customer", bookingId],
    queryFn: () => getMaintenanceCustomer(bookingId!),
    enabled: !!bookingId,
  });
  const { data: charges, isLoading: chargesLoading } = useQuery({
    queryKey: ["maintenance-charges", bookingId],
    queryFn: () => getMaintenanceCharges(bookingId!),
    enabled: !!bookingId,
  });
  const { data: bills, isLoading: billsLoading } = useQuery({
    queryKey: ["maintenance-bills", { bookingId }],
    queryFn: () => getMaintenanceBills({ bookingId: bookingId! }),
    enabled: !!bookingId,
  });
  const { data: tickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ["service-tickets-booking", bookingId],
    queryFn: () => getTicketsForBooking(bookingId!),
    enabled: !!bookingId && ticketRights.canView,
  });
  const { data: chargeHeads } = useQuery({
    queryKey: ["charge-heads", "active"],
    queryFn: getActiveChargeHeads,
    enabled: addChargeOpen,
  });

  if (customerLoading) return <div className="p-6 text-muted-foreground">Loading\u2026</div>;
  if (customerError || !customer)
    return <div className="p-6 text-red-500">This customer is not eligible for Maintenance yet \u2014 the unit has not been handed over.</div>;

  const chargeRows: MaintenanceCustomerCharge[] = Array.isArray(charges) ? charges : [];
  const billRows:   MaintenanceBillListRow[]    = Array.isArray(bills)   ? bills   : [];
  const ticketRows: ServiceTicketRow[]          = Array.isArray(tickets) ? tickets : [];
  const chargeHeadRows: ChargeHeadRow[]         = Array.isArray(chargeHeads) ? chargeHeads : [];
  const assignedIds                             = new Set(chargeRows.map((c) => c.ChargeHeadId));
  const availableChargeHeads                   = chargeHeadRows.filter((ch) => !assignedIds.has(ch.Id));
  const activeBills                            = billRows.filter((b) => b.Status === "Active");
  const totalBilled                            = activeBills.reduce((s, b) => s + (Number(b.GrandTotal) || 0), 0);
  const openTickets                            = ticketRows.filter((t) => !["Closed", "Resolved"].includes(t.Status));

  const handleAddCharge = async (chargeHeadId: number) => {
    try {
      await addMaintenanceCharge(bookingId!, chargeHeadId);
      toast.success("Charge added");
      qc.invalidateQueries({ queryKey: ["maintenance-charges", bookingId] });
      setAddChargeOpen(false);
    } catch (err: unknown) { toast.error((err as Error).message || "Failed to add charge"); }
  };
  const handleRemoveCharge = async (chargeId: number) => {
    setRemovingChargeId(chargeId);
    try {
      await removeMaintenanceCharge(bookingId!, chargeId);
      toast.success("Charge removed");
      qc.invalidateQueries({ queryKey: ["maintenance-charges", bookingId] });
    } catch (err: unknown) { toast.error((err as Error).message || "Failed to remove charge"); }
    finally { setRemovingChargeId(null); }
  };
  const handleMarkInProgress = async (id: number) => {
    setActionLoading(true);
    try {
      await markTicketInProgress(id);
      toast.success("Marked In Progress");
      qc.invalidateQueries({ queryKey: ["service-tickets-booking", bookingId] });
    } catch (err: unknown) { toast.error((err as Error).message || "Failed"); }
    finally { setActionLoading(false); }
  };
  const handleResolve = async () => {
    if (!resolveTicketId) return;
    if (!resolutionNotes.trim()) { toast.error("Resolution notes required"); return; }
    setActionLoading(true);
    try {
      await resolveServiceTicket(resolveTicketId, resolutionNotes.trim());
      toast.success("Ticket resolved");
      qc.invalidateQueries({ queryKey: ["service-tickets-booking", bookingId] });
      setResolveTicketId(null); setResolutionNotes("");
    } catch (err: unknown) { toast.error((err as Error).message || "Failed"); }
    finally { setActionLoading(false); }
  };
  const handleClose = async (id: number) => {
    setActionLoading(true);
    try {
      await closeServiceTicket(id);
      toast.success("Ticket closed");
      qc.invalidateQueries({ queryKey: ["service-tickets-booking", bookingId] });
    } catch (err: unknown) { toast.error((err as Error).message || "Failed"); }
    finally { setActionLoading(false); }
  };


  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Customer Directory", customer.CustomerName || "Profile"]} />
      <MaintenanceShell
        title={customer.CustomerName || "Customer"}
        subtitle={`${customer.BookingNo} \u2014 ${[customer.BlockName, customer.UnitNo].filter(Boolean).join(" / ") || "Unit not set"}`}
        icon={UserCircle2}
        action={
          <button onClick={() => navigate("/maintenance/directory")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
            <ArrowLeft size={13} /> Directory
          </button>
        }
      >
        {/* Customer info */}
        <div className="rounded-xl border border-border bg-muted/10 px-4 py-3.5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <InfoField icon={Phone}     label="Contact"     value={customer.ContactNumber || "\u2014"} />
            <InfoField icon={Mail}      label="Email"       value={customer.Email || "\u2014"} />
            <InfoField icon={Home}      label="Unit"        value={[customer.BlockName, customer.UnitNo].filter(Boolean).join(" / ") || "\u2014"} />
            <InfoField icon={Building2} label="Project"     value={customer.ProjectName || "\u2014"} />
            <InfoField icon={Calendar}  label="Handed Over" value={fmtDate((customer as { HandoverDate?: string }).HandoverDate)} />
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Assigned Charges", value: chargesLoading ? "\u2026" : String(chargeRows.length),  color: ACCENT,     icon: ListChecks },
            { label: "Total Billed",     value: billsLoading   ? "\u2026" : INR(totalBilled),          color: "#f59e0b",  icon: Wallet     },
            { label: "Open Tickets",     value: ticketsLoading ? "\u2026" : String(openTickets.length), color: "#a78bfa",  icon: Ticket     },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border bg-card/40 px-4 py-3 flex items-center gap-3" style={{ borderColor: `${s.color}30` }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}18` }}>
                <s.icon size={15} style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground">{s.label}</p>
                <p className="text-lg font-heading font-bold text-foreground">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Assigned Charges */}
        <GlassSection
          title="Assigned Charges" icon={ListChecks} accentColor={ACCENT}
          action={chargesRights.canCreate && (
            <button onClick={() => setAddChargeOpen(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-heading font-semibold border transition-all" style={{ borderColor: `${ACCENT}50`, color: ACCENT, background: `${ACCENT}10` }}>
              <Plus size={12} /> Add Charge
            </button>
          )}
        >
          {chargesLoading ? <div className="text-sm text-muted-foreground">Loading\u2026</div>
          : chargeRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 flex flex-col items-center gap-2">
              <ListChecks size={18} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No charges assigned to this unit yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                  <tr>
                    <th className="text-left px-4 py-2">Charge</th>
                    <th className="text-right px-4 py-2">Base</th>
                    <th className="text-right px-4 py-2">Tax %</th>
                    <th className="text-right px-4 py-2">Tax</th>
                    <th className="text-right px-4 py-2">Total</th>
                    {chargesRights.canDelete && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {chargeRows.map((c) => (
                    <tr key={c.Id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium text-foreground">{c.ChargeHeadName}</td>
                      <td className="px-4 py-2 text-right font-mono">{INR(c.BaseAmount)}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{Number(c.TaxPct) || 0}%</td>
                      <td className="px-4 py-2 text-right font-mono">{INR(c.TaxAmount)}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{INR(c.TotalAmount)}</td>
                      {chargesRights.canDelete && (
                        <td className="px-2 py-2">
                          <button onClick={() => handleRemoveCharge(c.Id)} disabled={removingChargeId === c.Id} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40">
                            {removingChargeId === c.Id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassSection>


        {/* Bills */}
        <GlassSection title="Bills" icon={Receipt} accentColor="#f59e0b">
          {billsLoading ? <div className="text-sm text-muted-foreground">Loading\u2026</div>
          : billRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 flex flex-col items-center gap-2">
              <Receipt size={18} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No bills raised for this customer yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                  <tr>
                    <th className="text-left px-4 py-2">Bill No</th>
                    <th className="text-left px-4 py-2">Bill Date</th>
                    <th className="text-left px-4 py-2">Due Date</th>
                    <th className="text-right px-4 py-2">Grand Total</th>
                    <th className="text-left px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {billRows.map((b) => (
                    <tr key={b.Id} onClick={() => navigate("/maintenance/bills")} className="hover:bg-muted/20 cursor-pointer">
                      <td className="px-4 py-2 font-mono text-xs font-medium">{b.BillNo}</td>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(b.BillDate)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{fmtDate(b.DueDate)}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{INR(b.GrandTotal)}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${b.Status === "Active" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}>
                          {b.Status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassSection>

        {/* Service Tickets */}
        {ticketRights.canView && (
          <GlassSection
            title="Service Tickets" icon={Ticket} accentColor="#a78bfa"
            action={ticketRights.canCreate && (
              <button onClick={() => setRaiseTicketOpen(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-heading font-semibold border transition-all" style={{ borderColor: "#a78bfa50", color: "#a78bfa", background: "#a78bfa10" }}>
                <Plus size={12} /> Raise Ticket
              </button>
            )}
          >
            {ticketsLoading ? <div className="text-sm text-muted-foreground">Loading\u2026</div>
            : ticketRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-8 flex flex-col items-center gap-2">
                <Ticket size={18} className="text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No service tickets for this customer yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {ticketRows.map((t) => (
                  <div key={t.Id} className="px-4 py-3 hover:bg-muted/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-muted-foreground">{t.TicketNo}</span>
                          <StatusBadge status={t.Status} />
                          <PriorityBadge priority={t.Priority} />
                          <span className="text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5">{t.Category}</span>
                        </div>
                        <p className="text-sm font-heading font-semibold text-foreground truncate">{t.Subject}</p>
                        {t.AssigneeName && <p className="text-xs text-muted-foreground mt-0.5">Assigned to: {t.AssigneeName}</p>}
                        {t.SlaDueDate && <p className="text-xs text-muted-foreground mt-0.5">SLA: {fmtDate(t.SlaDueDate)}</p>}
                      </div>
                      {ticketRights.canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          {t.Status === "Assigned" && (
                            <button onClick={() => handleMarkInProgress(t.Id)} disabled={actionLoading} title="Mark In Progress" className="p-1.5 rounded-md text-muted-foreground hover:text-violet-500 hover:bg-violet-500/10 transition-colors disabled:opacity-40">
                              <Clock size={14} />
                            </button>
                          )}
                          {["Assigned", "InProgress", "Reopened"].includes(t.Status) && (
                            <button onClick={() => setResolveTicketId(t.Id)} disabled={actionLoading} title="Resolve" className="p-1.5 rounded-md text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-40">
                              <CheckCircle2 size={14} />
                            </button>
                          )}
                          {t.Status === "Resolved" && (
                            <button onClick={() => handleClose(t.Id)} disabled={actionLoading} title="Close" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40">
                              <AlertCircle size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassSection>
        )}

        {/* Payment History */}
        <GlassSection title="Payment History (Bills)" icon={History} accentColor={ACCENT}>
          {billsLoading ? <div className="text-sm text-muted-foreground">Loading\u2026</div>
          : billRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 flex flex-col items-center gap-2 text-center px-6">
              <Wallet size={18} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No maintenance bills recorded yet.</p>
              <p className="text-xs text-muted-foreground max-w-sm">Bills raised for this customer appear here as payment demand notices. Payment is collected offline and settled externally.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {billRows.map((b) => (
                <div key={b.Id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 bg-card/40 hover:bg-muted/20">
                  <div>
                    <p className="text-xs font-mono font-medium text-foreground">{b.BillNo}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(b.BillDate)}{b.DueDate ? ` \u00B7 Due ${fmtDate(b.DueDate)}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-heading font-semibold text-foreground">{INR(b.GrandTotal)}</p>
                    <span className={`text-[11px] font-heading ${b.Status === "Active" ? "text-emerald-600" : "text-red-500"}`}>{b.Status}</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">Total billed (active)</span>
                <span className="text-sm font-heading font-bold text-foreground">{INR(totalBilled)}</span>
              </div>
            </div>
          )}
        </GlassSection>
      </MaintenanceShell>

      {/* Add Charge Dialog */}
      <Dialog open={addChargeOpen} onOpenChange={(o) => !o && setAddChargeOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading text-base">Add Charge Head</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            {availableChargeHeads.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">{chargeHeadRows.length === 0 ? "Loading charge heads\u2026" : "All charge heads already assigned."}</p>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {availableChargeHeads.map((ch) => (
                  <button key={ch.Id} onClick={() => handleAddCharge(ch.Id)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/40 transition-colors text-left">
                    <span className="text-sm font-medium text-foreground">{ch.Name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{INR(ch.Rate)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-1 border-t border-border">
              <button onClick={() => setAddChargeOpen(false)} className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">Close</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Raise Ticket Dialog */}
      {raiseTicketOpen && (
        <RaiseTicketDialog
          bookingId={Number(bookingId)} customerName={customer.CustomerName || ""}
          onClose={() => setRaiseTicketOpen(false)}
          onSaved={() => { setRaiseTicketOpen(false); qc.invalidateQueries({ queryKey: ["service-tickets-booking", bookingId] }); }}
        />
      )}

      {/* Resolve Dialog */}
      <Dialog open={resolveTicketId !== null} onOpenChange={(o) => !o && setResolveTicketId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading text-base">Resolve Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Resolution Notes *</label>
              <textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={3} placeholder="Describe what was done\u2026" className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={() => setResolveTicketId(null)} className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">Cancel</button>
              <button onClick={handleResolve} disabled={actionLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-emerald-600 text-white hover:opacity-90 transition-all disabled:opacity-60">
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Resolve
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfoField({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        <Icon size={11} /> {label}
      </p>
      <p className="text-sm font-medium text-foreground truncate" title={value}>{value}</p>
    </div>
  );
}

function RaiseTicketDialog({ bookingId, customerName, onClose, onSaved }: { bookingId: number; customerName: string; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<TicketCategory>("Complaint");
  const [priority, setPriority] = useState<TicketPriority>("Normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!subject.trim()) { toast.error("Subject is required"); return; }
    setSaving(true);
    try {
      await createServiceTicket({ BookingId: bookingId, Category: category, Priority: priority, Subject: subject.trim(), Description: description.trim() || undefined });
      toast.success("Ticket raised");
      onSaved();
    } catch (err: unknown) { toast.error((err as Error).message || "Failed to raise ticket"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-heading text-base">Raise Service Ticket</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">For: <span className="font-medium text-foreground">{customerName}</span></p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none text-foreground">
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none text-foreground">
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Subject *</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief subject line\u2026" className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Detailed description (optional)\u2026" className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-all disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Ticket size={13} />} Raise Ticket
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

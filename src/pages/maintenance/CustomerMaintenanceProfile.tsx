import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Phone, Mail, Home, Building2, ArrowLeft,
  Wallet, ListChecks, Receipt, Ticket, Plus, X,
  Loader2, CheckCircle2, Clock, AlertCircle, Calendar,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import {
  ICON_ACT, ICON_ACT_RED, SHEET_DIALOG, SheetBox, TAG, TD, TH,
  TICKET_PRIORITY_TONE, TICKET_STATUS_TONE, ticketStatusLabel,
} from "@/components/maintenance/maintParts";
import { HrEmpty, HrError, HrStatStrip, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
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
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const TICKET_CATEGORIES: TicketCategory[] = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const TICKET_PRIORITIES: TicketPriority[] = ["Low", "Normal", "High", "Urgent"];

const billMark = (status: string) => <SheetMark text={status} tone={status === "Active" ? "done" : "stopped"} />;

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

  if (customerLoading) return <div className="skel m-6" style={{ height: 320 }} />;
  if (customerError || !customer)
    return <HrError text={"This customer is not eligible for Maintenance yet — the unit has not been handed over."} />;

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

  const info: { icon: typeof Phone; label: string; value: string; num?: boolean }[] = [
    { icon: Phone,     label: "Contact",     value: customer.ContactNumber || "—", num: true },
    { icon: Mail,      label: "Email",       value: customer.Email || "—" },
    { icon: Home,      label: "Unit",        value: [customer.BlockName, customer.UnitNo].filter(Boolean).join(" / ") || "—" },
    { icon: Building2, label: "Project",     value: customer.ProjectName || "—" },
    { icon: Calendar,  label: "Handed Over", value: fmtDate((customer as { HandoverDate?: string }).HandoverDate), num: true },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Customer Directory", customer.CustomerName || "Profile"]} />
      <MaintenanceShell
        title={customer.CustomerName || "Customer"}
        subtitle={`${customer.BookingNo} — ${[customer.BlockName, customer.UnitNo].filter(Boolean).join(" / ") || "Unit not set"}`}
        action={
          <button onClick={() => navigate("/maintenance/directory")} className={`${KEY_LINE} h-9 px-3`}>
            <ArrowLeft size={13} /> Directory
          </button>
        }
      >
        {/* Customer info */}
        <div className="grid grid-cols-2 sm:grid-cols-5 bg-card" style={{ border: HR_RULE }}>
          {info.map((f, i) => (
            <div key={f.label} className="px-4 py-3 min-w-0" style={{ borderLeft: i ? "1px solid hsl(var(--foreground) / 0.15)" : undefined }}>
              <p className={`flex items-center gap-1.5 ${HR_LBL}`}><f.icon size={11} /> {f.label}</p>
              <p className={`mt-1 text-sm font-medium text-foreground truncate ${f.num ? HR_NUM : ""}`} title={f.value}>{f.value}</p>
            </div>
          ))}
        </div>

        {/* Quick stats */}
        <HrStatStrip items={[
          { label: "Assigned Charges", value: chargesLoading ? "…" : String(chargeRows.length) },
          { label: "Total Billed",     value: billsLoading   ? "…" : INR(totalBilled) },
          { label: "Open Tickets",     value: ticketsLoading ? "…" : String(openTickets.length), tone: openTickets.length ? "hsl(var(--destructive))" : undefined },
        ]} />

        {/* Assigned Charges */}
        <SheetBox
          title="Assigned Charges" note={chargesLoading ? undefined : chargeRows.length} flush
          action={chargesRights.canCreate && (
            <button onClick={() => setAddChargeOpen(true)} className={`${KEY_LINE} h-8 px-3`}>
              <Plus size={12} /> Add Charge
            </button>
          )}
        >
          {chargesLoading ? <div className="skel m-4" style={{ height: 80 }} />
          : chargeRows.length === 0 ? (
            <HrEmpty icon={ListChecks} title="No charges" text="No charges assigned to this unit yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Charge</th>
                    <th className={`${TH} text-right`}>Base</th>
                    <th className={`${TH} text-right`}>Tax %</th>
                    <th className={`${TH} text-right`}>Tax</th>
                    <th className={`${TH} text-right`}>Total</th>
                    {chargesRights.canDelete && <th className={`${TH} w-10`} />}
                  </tr>
                </thead>
                <tbody>
                  {chargeRows.map((c) => (
                    <tr key={c.Id} className="hover:bg-primary/5">
                      <td className={`${TD} font-medium text-foreground`}>{c.ChargeHeadName}</td>
                      <td className={`${TD} text-right ${HR_NUM}`}>{INR(c.BaseAmount)}</td>
                      <td className={`${TD} text-right text-muted-foreground ${HR_NUM}`}>{Number(c.TaxPct) || 0}%</td>
                      <td className={`${TD} text-right ${HR_NUM}`}>{INR(c.TaxAmount)}</td>
                      <td className={`${TD} text-right font-semibold ${HR_NUM}`}>{INR(c.TotalAmount)}</td>
                      {chargesRights.canDelete && (
                        <td className={`${TD} text-right`}>
                          <button onClick={() => handleRemoveCharge(c.Id)} disabled={removingChargeId === c.Id} title="Remove" className={ICON_ACT_RED}>
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
        </SheetBox>

        {/* Bills */}
        <SheetBox title="Bills" note={billsLoading ? undefined : billRows.length} flush>
          {billsLoading ? <div className="skel m-4" style={{ height: 80 }} />
          : billRows.length === 0 ? (
            <HrEmpty icon={Receipt} title="No bills" text="No bills raised for this customer yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Bill No</th>
                    <th className={TH}>Bill Date</th>
                    <th className={TH}>Due Date</th>
                    <th className={`${TH} text-right`}>Grand Total</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billRows.map((b) => (
                    <tr key={b.Id} onClick={() => navigate("/maintenance/bills")} className="hover:bg-primary/5 cursor-pointer">
                      <td className={`${TD} text-xs font-medium ${HR_NUM}`}>{b.BillNo}</td>
                      <td className={`${TD} text-muted-foreground ${HR_NUM}`}>{fmtDate(b.BillDate)}</td>
                      <td className={`${TD} text-muted-foreground ${HR_NUM}`}>{fmtDate(b.DueDate)}</td>
                      <td className={`${TD} text-right font-semibold ${HR_NUM}`}>{INR(b.GrandTotal)}</td>
                      <td className={TD}>{billMark(b.Status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SheetBox>

        {/* Service Tickets */}
        {ticketRights.canView && (
          <SheetBox
            title="Service Tickets" note={ticketsLoading ? undefined : ticketRows.length} flush
            action={ticketRights.canCreate && (
              <button onClick={() => setRaiseTicketOpen(true)} className={`${KEY_LINE} h-8 px-3`}>
                <Plus size={12} /> Raise Ticket
              </button>
            )}
          >
            {ticketsLoading ? <div className="skel m-4" style={{ height: 80 }} />
            : ticketRows.length === 0 ? (
              <HrEmpty icon={Ticket} title="No tickets" text="No service tickets for this customer yet." />
            ) : (
              <div className="divide-y divide-foreground/15">
                {ticketRows.map((t) => (
                  <div key={t.Id} className="px-4 py-3 hover:bg-primary/5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3 mb-1">
                          <span className={`text-xs text-foreground ${HR_NUM}`}>{t.TicketNo}</span>
                          <SheetMark text={ticketStatusLabel(t.Status)} tone={TICKET_STATUS_TONE[t.Status] ?? "waiting"} />
                          <SheetMark text={t.Priority} tone={TICKET_PRIORITY_TONE[t.Priority] ?? "draft"} />
                          {t.Category && <span className={TAG}>{t.Category}</span>}
                        </div>
                        <p className="text-sm font-heading font-semibold text-foreground truncate">{t.Subject}</p>
                        {t.AssigneeName && <p className="text-xs text-muted-foreground mt-0.5">Assigned to: {t.AssigneeName}</p>}
                        {t.SlaDueDate && <p className="text-xs text-muted-foreground mt-0.5">SLA: <span className={HR_NUM}>{fmtDate(t.SlaDueDate)}</span></p>}
                      </div>
                      {ticketRights.canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          {t.Status === "Assigned" && (
                            <button onClick={() => handleMarkInProgress(t.Id)} disabled={actionLoading} title="Mark In Progress" className={ICON_ACT}>
                              <Clock size={14} />
                            </button>
                          )}
                          {["Assigned", "InProgress", "Reopened"].includes(t.Status) && (
                            <button onClick={() => setResolveTicketId(t.Id)} disabled={actionLoading} title="Resolve" className={ICON_ACT}>
                              <CheckCircle2 size={14} />
                            </button>
                          )}
                          {t.Status === "Resolved" && (
                            <button onClick={() => handleClose(t.Id)} disabled={actionLoading} title="Close" className={ICON_ACT}>
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
          </SheetBox>
        )}

        {/* Payment History */}
        <SheetBox title="Payment History (Bills)" flush>
          {billsLoading ? <div className="skel m-4" style={{ height: 80 }} />
          : billRows.length === 0 ? (
            <HrEmpty
              icon={Wallet}
              title="No maintenance bills"
              text="Bills raised for this customer appear here as payment demand notices. Payment is collected offline and settled externally."
            />
          ) : (
            <div>
              {billRows.map((b) => (
                <div key={b.Id} className="flex items-center justify-between px-4 py-2.5 border-b border-foreground/10 hover:bg-primary/5">
                  <div>
                    <p className={`text-xs font-medium text-foreground ${HR_NUM}`}>{b.BillNo}</p>
                    <p className={`text-[0.6875rem] text-muted-foreground ${HR_NUM}`}>{fmtDate(b.BillDate)}{b.DueDate ? ` · Due ${fmtDate(b.DueDate)}` : ""}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className={`text-sm font-semibold text-foreground ${HR_NUM}`}>{INR(b.GrandTotal)}</p>
                    {billMark(b.Status)}
                  </div>
                </div>
              ))}
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className={HR_LBL}>Total billed (active)</span>
                <span className={`text-sm font-bold text-foreground ${HR_NUM}`}>{INR(totalBilled)}</span>
              </div>
            </div>
          )}
        </SheetBox>
      </MaintenanceShell>

      {/* Add Charge Dialog */}
      <Dialog open={addChargeOpen} onOpenChange={(o) => !o && setAddChargeOpen(false)}>
        <DialogContent className={`${SHEET_DIALOG} max-w-sm`} style={{ margin: 0 }}>
          <DialogHeader><DialogTitle className={HR_HEAD}>Add Charge Head</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            {availableChargeHeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">{chargeHeadRows.length === 0 ? "Loading charge heads…" : "All charge heads already assigned."}</p>
            ) : (
              <div className="divide-y divide-foreground/15" style={{ border: HR_RULE }}>
                {availableChargeHeads.map((ch) => (
                  <button key={ch.Id} onClick={() => handleAddCharge(ch.Id)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-primary/5 transition-colors text-left">
                    <span className="text-sm font-medium text-foreground">{ch.Name}</span>
                    <span className={`text-xs text-muted-foreground ${HR_NUM}`}>{INR(ch.Rate)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-3 border-t border-foreground/15">
              <button onClick={() => setAddChargeOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Close</button>
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
        <DialogContent className={`${SHEET_DIALOG} max-w-sm`} style={{ margin: 0 }}>
          <DialogHeader><DialogTitle className={HR_HEAD}>Resolve Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className={`block mb-1.5 ${HR_LBL}`}>Resolution Notes *</label>
              <textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={3} placeholder={"Describe what was done…"} className={`${HR_FIELD} h-auto py-2 resize-none`} />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
              <button onClick={() => setResolveTicketId(null)} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
              <button onClick={handleResolve} disabled={actionLoading} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Resolve
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
      <DialogContent className={`${SHEET_DIALOG} max-w-md`} style={{ margin: 0 }}>
        <DialogHeader><DialogTitle className={HR_HEAD}>Raise Service Ticket</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">For: <span className="font-medium text-foreground">{customerName}</span></p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block mb-1.5 ${HR_LBL}`}>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className={HR_FIELD}>
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={`block mb-1.5 ${HR_LBL}`}>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className={HR_FIELD}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={`block mb-1.5 ${HR_LBL}`}>Subject *</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={"Brief subject line…"} className={HR_FIELD} />
          </div>
          <div>
            <label className={`block mb-1.5 ${HR_LBL}`}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={"Detailed description (optional)…"} className={`${HR_FIELD} h-auto py-2 resize-none`} />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Ticket size={13} />} Raise Ticket
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

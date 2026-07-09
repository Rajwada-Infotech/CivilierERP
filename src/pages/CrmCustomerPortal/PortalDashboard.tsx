import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Circle, Clock, LogOut, LifeBuoy, Plus } from "lucide-react";

const API = "/api/crm-portal";
const TICKET_CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];

function authHeaders() {
  const token = localStorage.getItem("crm_portal_token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function fetchMe() {
  const res = await fetch(`${API}/me`, { headers: authHeaders() });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("Failed to load profile");
  return res.json();
}
async function fetchTimeline() {
  const res = await fetch(`${API}/timeline`, { headers: authHeaders() });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("Failed to load timeline");
  return res.json();
}
async function fetchTickets() {
  const res = await fetch(`${API}/tickets`, { headers: authHeaders() });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("Failed to load tickets");
  return res.json();
}

// Step-by-step milestone view — no brokerage information appears anywhere here, by design.
const STAGES = ["Application", "Booking", "WelcomeCall", "CustomerDetails", "Agreement", "Payments", "SalesDeed", "Handover"];

const PortalDashboard: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me, error: meError } = useQuery({ queryKey: ["portal-me"], queryFn: fetchMe, retry: false });
  const { data: timeline, error: tlError } = useQuery({ queryKey: ["portal-timeline"], queryFn: fetchTimeline, retry: false });
  const { data: tickets = [] } = useQuery({ queryKey: ["portal-tickets"], queryFn: fetchTickets, retry: false });
  const [ticketFormOpen, setTicketFormOpen] = useState(false);
  const [ticketForm, setTicketForm] = useState({ category: "ServiceRequest", subject: "", description: "" });
  const [submittingTicket, setSubmittingTicket] = useState(false);

  useEffect(() => {
    if (meError?.message === "unauthorized" || tlError?.message === "unauthorized") {
      localStorage.removeItem("crm_portal_token");
      navigate("/crm-client-portal/login");
    }
  }, [meError, tlError, navigate]);

  const handleLogout = () => {
    localStorage.removeItem("crm_portal_token");
    navigate("/crm-client-portal/login");
  };

  const handleAgreementRespond = async (decision: "Approve" | "Recheck") => {
    const remarks = decision === "Recheck" ? window.prompt("Please describe what needs to be rechecked:") || "" : "";
    try {
      const res = await fetch(`${API}/agreement/respond`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ decision, remarks }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(decision === "Approve" ? "Agreement approved!" : "Recheck requested");
      qc.invalidateQueries({ queryKey: ["portal-timeline"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSalesDeedRespond = async (decision: "Approve" | "Recheck") => {
    const remarks = decision === "Recheck" ? window.prompt("Please describe what needs to be rechecked:") || "" : "";
    try {
      const res = await fetch(`${API}/sales-deed/respond`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ decision, remarks }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(decision === "Approve" ? "Sales deed approved!" : "Sales deed recheck requested");
      qc.invalidateQueries({ queryKey: ["portal-timeline"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRaiseTicket = async () => {
    if (!ticketForm.subject.trim()) { toast.error("Subject is required"); return; }
    setSubmittingTicket(true);
    try {
      const res = await fetch(`${API}/tickets`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(ticketForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Ticket ${data.TicketNo} raised`);
      setTicketFormOpen(false);
      setTicketForm({ category: "ServiceRequest", subject: "", description: "" });
      qc.invalidateQueries({ queryKey: ["portal-tickets"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmittingTicket(false);
    }
  };

  if (!me || !timeline) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading your dashboard...</div>;
  }

  const agreement = timeline.agreement;
  const customerDetailsComplete = !!timeline.customerDetails?.IsComplete;
  const currentStageIdx = !timeline.booking ? 0
    : !timeline.welcomeCall ? 1
    : !customerDetailsComplete ? 2
    : !agreement ? 3
    : agreement.CustomerApprovalStatus !== "Approved" ? 4
    : timeline.paymentMilestones?.some((m: any) => m.Status === "Pending") ? 5
    : !timeline.salesDeed ? 6
    : !timeline.handover ? 7 : 7;

  return (
    <div className="min-h-screen bg-muted/10">
      <div className="bg-background border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-bold">{me.ApplicantName}</h1>
          <p className="text-xs text-muted-foreground">{me.ApplicationNo}</p>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <LogOut size={14} /> Logout
        </button>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Progress timeline */}
        <div className="bg-background rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold mb-3">Your Journey</h2>
          <div className="flex items-center justify-between">
            {STAGES.map((s, idx) => (
              <div key={s} className="flex-1 flex flex-col items-center relative">
                {idx > 0 && <div className={`absolute top-3 right-1/2 w-full h-0.5 ${idx <= currentStageIdx ? "bg-primary" : "bg-muted"}`} />}
                {idx < currentStageIdx ? <CheckCircle2 size={20} className="text-primary relative z-10 bg-background" />
                  : idx === currentStageIdx ? <Clock size={20} className="text-orange-500 relative z-10 bg-background" />
                  : <Circle size={20} className="text-muted-foreground relative z-10 bg-background" />}
                <span className="text-[10px] mt-1 text-center text-muted-foreground">{s.replace(/([A-Z])/g, " $1").trim()}</span>
              </div>
            ))}
          </div>
        </div>

        {timeline.booking && (
          <div className="bg-background rounded-xl border border-border p-4">
            <h2 className="text-sm font-semibold mb-2">Booking</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-xs text-muted-foreground">Unit: </span>{timeline.booking.UnitNo}</div>
              <div><span className="text-xs text-muted-foreground">Project: </span>{timeline.booking.ProjectName || "—"}</div>
              <div><span className="text-xs text-muted-foreground">Total Value: </span>₹{Number(timeline.booking.TotalValue || 0).toLocaleString("en-IN")}</div>
              <div><span className="text-xs text-muted-foreground">Status: </span>{timeline.booking.BookingStatus}</div>
            </div>
          </div>
        )}

        {timeline.welcomeCall && (
          <div className="bg-background rounded-xl border border-border p-4">
            <h2 className="text-sm font-semibold mb-2">Welcome Call</h2>
            <div className="text-sm">
              <span className="text-xs text-muted-foreground">Status: </span>
              {timeline.welcomeCall.Outcome || "Pending"}
            </div>
          </div>
        )}

        {!customerDetailsComplete && timeline.booking && (
          <div className="bg-background rounded-xl border border-orange-200 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-orange-600 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold">Customer Details</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Bank, nominee, PAN, and Aadhaar details are being completed before agreement preparation.
                </p>
              </div>
            </div>
          </div>
        )}

        {agreement?.SentToCustomerAt && (
          <div className="bg-background rounded-xl border border-primary/30 p-4">
            <h2 className="text-sm font-semibold mb-2">Agreement — {agreement.AgreementNo}</h2>
            <div className="text-sm mb-3">
              <div><span className="text-xs text-muted-foreground">Proposed Date: </span>{agreement.ProposedDateByCompany ? String(agreement.ProposedDateByCompany).slice(0,10) : "—"}</div>
              <div className="mt-1"><span className="text-xs text-muted-foreground">Your Response: </span>{agreement.CustomerApprovalStatus}</div>
              <div className="mt-1"><span className="text-xs text-muted-foreground">Documents: </span>{agreement.DocumentCount || 0}</div>
            </div>
            {agreement.CustomerApprovalStatus === "Pending" && (
              <div className="flex gap-2">
                <button onClick={() => handleAgreementRespond("Approve")}
                  className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90">
                  Approve Agreement
                </button>
                <button onClick={() => handleAgreementRespond("Recheck")}
                  className="px-3 py-1.5 border border-border text-xs font-medium rounded-lg hover:bg-muted">
                  Request Recheck
                </button>
              </div>
            )}
            {agreement.CustomerApprovalStatus === "Approved" && (
              <div className="text-xs text-green-600 font-medium">You've approved this agreement. Thank you!</div>
            )}
          </div>
        )}

        {timeline.paymentMilestones?.length > 0 && (
          <div className="bg-background rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
              <h2 className="text-sm font-semibold">Payment Milestones</h2>
            </div>
            {timeline.paymentMilestones.map((m: any) => (
              <div key={m.MilestoneNo} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{m.MilestoneName}</div>
                  <div className="text-xs text-muted-foreground">{m.DueDate ? String(m.DueDate).slice(0,10) : "No due date"}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">₹{Number(m.AmountDue).toLocaleString("en-IN")}</div>
                  <div className={`text-xs ${m.Status === "Paid" ? "text-green-600" : "text-orange-600"}`}>{m.Status}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {timeline.constructionUpdates?.length > 0 && (
          <div className="bg-background rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
              <h2 className="text-sm font-semibold">Construction Progress</h2>
            </div>
            {timeline.constructionUpdates.map((u: any, i: number) => (
              <div key={i} className="px-4 py-3 border-b border-border last:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{u.Stage}</span>
                  <span className="text-xs text-muted-foreground">{String(u.UpdateDate).slice(0,10)}</span>
                </div>
                {u.PercentComplete != null && (
                  <div className="w-full bg-muted rounded-full h-1.5 mt-2 mb-1.5">
                    <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(100, u.PercentComplete)}%` }} />
                  </div>
                )}
                {u.Summary && <p className="text-xs text-muted-foreground mt-1">{u.Summary}</p>}
              </div>
            ))}
          </div>
        )}

        {timeline.salesDeed?.SentToCustomerAt && (
          <div className="bg-background rounded-xl border border-primary/30 p-4">
            <h2 className="text-sm font-semibold mb-2">Sales Deed</h2>
            <div className="text-sm mb-3">
              <div><span className="text-xs text-muted-foreground">Status: </span>{timeline.salesDeed.Status}</div>
              <div className="mt-1"><span className="text-xs text-muted-foreground">Your Response: </span>{timeline.salesDeed.CustomerApprovalStatus}</div>
            </div>
            {timeline.salesDeed.CustomerApprovalStatus === "Pending" && (
              <div className="flex gap-2">
                <button onClick={() => handleSalesDeedRespond("Approve")}
                  className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90">
                  Approve Sales Deed
                </button>
                <button onClick={() => handleSalesDeedRespond("Recheck")}
                  className="px-3 py-1.5 border border-border text-xs font-medium rounded-lg hover:bg-muted">
                  Request Recheck
                </button>
              </div>
            )}
            {timeline.salesDeed.CustomerApprovalStatus === "Approved" && (
              <div className="text-xs text-green-600 font-medium">You've approved this sales deed.</div>
            )}
          </div>
        )}

        {/* Support Tickets */}
        <div className="bg-background rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><LifeBuoy size={14} /> Support Tickets</h2>
            <button onClick={() => setTicketFormOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus size={12} /> Raise a Ticket
            </button>
          </div>

          {ticketFormOpen && (
            <div className="p-4 border-b border-border space-y-2">
              <select value={ticketForm.category} onChange={(e) => setTicketForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/([A-Z])/g, " $1").trim()}</option>)}
              </select>
              <input type="text" placeholder="Subject" value={ticketForm.subject}
                onChange={(e) => setTicketForm((f) => ({ ...f, subject: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              <textarea placeholder="Describe your request..." rows={3} value={ticketForm.description}
                onChange={(e) => setTicketForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              <button onClick={handleRaiseTicket} disabled={submittingTicket}
                className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 disabled:opacity-40">
                {submittingTicket ? "Submitting..." : "Submit"}
              </button>
            </div>
          )}

          {tickets.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">No support tickets yet</div>
          ) : (tickets as any[]).map((t) => (
            <div key={t.Id} className="px-4 py-3 border-b border-border last:border-0">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{t.Subject}</span>
                  <span className="text-xs text-muted-foreground ml-2">{t.TicketNo}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                  t.Status === "Resolved" || t.Status === "Closed" ? "text-green-600 bg-green-50 border-green-200" : "text-orange-600 bg-orange-50 border-orange-200"
                }`}>
                  {t.Status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.Category.replace(/([A-Z])/g, " $1").trim()} · {String(t.CreatedAt).slice(0,10)}</div>
              {t.ResolutionNotes && <p className="text-xs mt-1 text-muted-foreground">Resolution: {t.ResolutionNotes}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PortalDashboard;

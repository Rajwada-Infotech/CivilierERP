// One booking's welcome call: log (or edit) the call and work through the rest of the checklist.
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Phone, X, FileCheck, Users, ChevronRight, Check, Upload, Trash2, IndianRupee, Landmark, ClipboardCheck, Wallet, Lock, Timer, PhoneCall, CalendarClock, StickyNote, ListPlus, Building2, Car, AlertTriangle, MapPin } from "lucide-react";
import { FinancialStatusBar } from "@/components/crm/FinancialStatusBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactActionBar } from "@/components/crm/ContactActionBar";
import { useAuth } from "@/contexts/AuthContext";
import { translateError } from "@/lib/translateError";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { KEY_INK, KEY_LINE, RULE, API, CO_API, DOC_API, OUTCOMES, OUTCOME_LABEL, EMPTY_FORM, fmt, nowLocal, fetchUsers, fetchChecklist, fetchDocs, fetchCoApplicants, fetchCallContext, fetchLoanDetail, fetchBookingMilestones, fetchBookingInvoices, fetchParkingAllotments, fetchExtraCharges, fetchBankPreferences, VcItem, mimeIcon, fmtBytes } from "./config";
import { DocPreviewDialog, WelcomeCallPdfDialog, InvoicePdfDialog } from "./PreviewDialogs";
import { InlineVerify, useVerificationChecklist, ChecklistProgressBar, ChecklistSectionBlock, ChecklistSubmitFooter } from "./Checklist";

// ─── Intake dialog: log the call + work through the rest of the checklist ──
export const IntakeDialog: React.FC<{ booking: any; editingCall?: any | null; onCancelEdit?: () => void; onClose: () => void }> = ({ booking, editingCall, onCancelEdit, onClose }) => {
  const rights = usePageRights("crm-welcome-calls");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  // Editing a past call is a correction of what happened (outcome, notes,
  // follow-up dates), never a rewrite of when it happened — CalledBy/
  // CallDate/DurationSeconds are the factual record and stay locked/
  // display-only below whenever editingCall is set.
  const isEditingCall = !!editingCall;
  // Auto-fetched, locked by default: the call is almost always logged by
  // whoever is on this screen right now, and the moment it happens — not
  // something staff should have to re-pick/re-type every single time.
  // "Change" unlocks both for the (rarer) case someone is logging a call on
  // a colleague's behalf, or after the fact.
  const [form, setForm] = useState(() => isEditingCall ? {
    CalledBy: editingCall.CalledBy ? String(editingCall.CalledBy) : "",
    CallDate: editingCall.CallDate ? String(editingCall.CallDate).slice(0, 16) : "",
    DurationSeconds: editingCall.DurationSeconds != null ? String(editingCall.DurationSeconds) : "",
    Outcome: editingCall.Outcome || "",
    NextCallDate: editingCall.NextCallDate ? String(editingCall.NextCallDate).slice(0, 10) : "",
    Notes: editingCall.Notes || "",
    PreferredAgreementDate: editingCall.PreferredAgreementDate ? String(editingCall.PreferredAgreementDate).slice(0, 10) : "",
  } : { ...EMPTY_FORM, CalledBy: currentUser?.id || "", CallDate: nowLocal() });
  const [calledByLocked, setCalledByLocked] = useState(true);
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>(() => {
    if (!isEditingCall) return [];
    try { return editingCall.CustomFields ? JSON.parse(editingCall.CustomFields) : []; } catch { return []; }
  });
  const [saving, setSaving] = useState(false);
  const [deletingCall, setDeletingCall] = useState(false);
  const [docType, setDocType] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Live call-duration timer — a real "dynamic" touch for a page whose whole
  // job is timing/logging a phone call: start it when the call begins, and
  // Duration auto-fills from the elapsed time when stopped (still editable
  // afterward, in case it needs correcting). Not relevant once reviewing a
  // past call — that call already happened and its timing is locked.
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  useEffect(() => {
    if (!timerRunning) return;
    const start = Date.now() - timerSeconds * 1000;
    const id = setInterval(() => setTimerSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning]);
  const fmtTimer = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const [paymentPlanConfirmed, setPaymentPlanConfirmed] = useState<true | false | null>(null);
  const [paymentPlanDisputeReason, setPaymentPlanDisputeReason] = useState("");
  const [coForm, setCoForm] = useState({ Name: "", Relation: "", Mobile: "", Email: "", PanNo: "", AadhaarNo: "", Reason: "" });
  const [addingCo, setAddingCo] = useState(false);

  // Bank Preference tab — telecaller captures which bank(s) the customer
  // prefers for their home loan during the call; multiple entries allowed.
  const [bpBankName, setBpBankName] = useState("");
  const [bpRemarks, setBpRemarks] = useState("");
  const [bpSaving, setBpSaving] = useState(false);
  // Financing type quick-capture — saves immediately on button click so the
  // telecaller doesn't need a separate Save step for a simple two-option pick.
  const [ftSaving, setFtSaving] = useState(false);

  // Which Financial Summary card is expanded — Payment Plan and Bank
  // Preference are collapsed by default; tapping either flexes it open to
  // show the real detail (milestone schedule / full loan record) instead of
  // just the one-line teaser.
  const [expandedCard, setExpandedCard] = useState<"plan" | "bank" | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<any | null>(null);
  const [viewingWelcomeCallPdf, setViewingWelcomeCallPdf] = useState<{ id: number, no: string } | null>(null);
  // Was a fixed 300px sidebar + narrow column crammed into max-w-6xl with
  // 11px fonts everywhere — genuinely well-architected underneath (single
  // shared checklist source, verify-next-to-the-real-data placement, a live
  // call timer, a tri-state readiness stepper) but unreadable. Same fix as
  // CrmBookingDetail.tsx: tabs, with each checklist section still dropped in
  // right next to the data card it verifies — just given actual room.
  const WC_TABS = ["Overview", "Documents", "Co-Applicant", "Bank Preference"] as const;
  type WcTab = typeof WC_TABS[number];
  const [wcTab, setWcTab] = useState<WcTab>("Overview");

  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { refetch: refetchChecklist } = useQuery({
    queryKey: ["crm-welcome-checklist", booking.BookingId],
    queryFn: () => fetchChecklist(booking.BookingId),
  });
  const { data: callContext } = useQuery({
    queryKey: ["crm-welcome-call-context", booking.BookingId],
    queryFn: () => fetchCallContext(booking.BookingId),
  });
  // Carry the customer's already-known preferred Agreement date forward onto
  // a NEW call (never onto an edit of a past call, which has its own real
  // value or intentional blank). Without this, a follow-up call that's just
  // confirming something else — not re-asking about the Agreement date —
  // left this field blank, and since crmAgreements.js used to read only the
  // LATEST call's own value, that blank silently overwrote/hid the date the
  // customer already gave. Only fills an empty field — never clobbers
  // something staff already typed into this same call.
  useEffect(() => {
    if (isEditingCall || !callContext?.latestPreferredAgreementDate) return;
    setForm((f) => f.PreferredAgreementDate ? f : { ...f, PreferredAgreementDate: String(callContext.latestPreferredAgreementDate).slice(0, 10) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callContext?.latestPreferredAgreementDate]);
  const { data: docData = { documents: [], standardTypes: [] }, refetch: refetchDocs } = useQuery({
    queryKey: ["crm-booking-documents", booking.BookingId],
    queryFn: () => fetchDocs(booking.BookingId),
  });
  const { data: coApplicants = [], refetch: refetchCo } = useQuery({
    queryKey: ["crm-co-applicants", booking.BookingId],
    queryFn: () => fetchCoApplicants(booking.BookingId),
  });
  const { data: parkingAllotments = [] } = useQuery({
    queryKey: ["crm-welcome-parking", booking.BookingId],
    queryFn: () => fetchParkingAllotments(booking.BookingId),
  });
  const { data: extraCharges = [] } = useQuery({
    queryKey: ["crm-welcome-extra-charges", booking.BookingId],
    queryFn: () => fetchExtraCharges(booking.BookingId),
  });
  // Fetched eagerly (no `enabled` condition) because milestones are used for
  // the overdue count in FinancialStatusBar even when the plan card is collapsed.
  // The expanded plan card view also reads from this same query.
  const { data: milestones = [] } = useQuery({
    queryKey: ["crm-welcome-milestones", booking.BookingId],
    queryFn: () => fetchBookingMilestones(booking.BookingId),
  });
  const { data: loanDetail, isLoading: loanLoading } = useQuery({
    queryKey: ["crm-welcome-loan", booking.BookingId],
    queryFn: () => fetchLoanDetail(booking.BookingId),
    enabled: expandedCard === "bank",
  });
  // Bank Preference tab — fetched on demand when the tab is first opened,
  // same lazy pattern as loanDetail above.
  const { data: bankPreferences = [], refetch: refetchBankPreferences } = useQuery({
    queryKey: ["crm-welcome-bank-preferences", booking.BookingId],
    queryFn: () => fetchBankPreferences(booking.BookingId),
    enabled: wcTab === "Bank Preference",
  });
  // Single shared source for the verification checklist — every
  // ChecklistSectionBlock dropped in near its matching data card below
  // reads from this same vc/refetch pair, so ticking an item in one place
  // and the progress bar / submit gate elsewhere always agree.
  const vcState = useVerificationChecklist(booking.BookingId);

  const invalidateQueue = () => qc.invalidateQueries({ queryKey: ["crm-welcome-queue"] });

  // Full invoice rows aren't in call-context's trimmed projection — fetch
  // the real list (same endpoint CrmBookingDetail.tsx's own Invoices tab
  // reads) on demand and pull out the one that was tapped, rather than
  // needing a dedicated single-invoice endpoint that doesn't exist.
  const handleViewInvoice = async (invoiceNo: string) => {
    const list = await fetchBookingInvoices(booking.BookingId);
    const found = list.find((i: any) => i.InvoiceNo === invoiceNo);
    if (found) setViewingInvoice(found);
    else toast.error("Could not load invoice detail");
  };

  const handleLogCall = async () => {
    // Without this, "Log Call" happily saves a row with nothing but who
    // called and when — Outcome is the one field every other screen
    // (queue, history, checklist) actually reads to know what happened on
    // the call, so a blank one is a useless log entry masquerading as a
    // real one.
    if (!form.Outcome) { toast.error("Select an outcome before logging the call"); return; }
    if (paymentPlanConfirmed === false && !paymentPlanDisputeReason.trim()) {
      toast.error("Describe the customer's objection before logging — required when payment plan is not confirmed");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: booking.BookingId,
          CalledBy: form.CalledBy || null,
          CallDate: form.CallDate || null,
          // The live timer wins if it was used and nobody typed a manual
          // override — matches what actually happened on the call instead
          // of staff having to copy the number across by hand.
          DurationSeconds: form.DurationSeconds || (timerSeconds > 0 ? String(timerSeconds) : null),
          Outcome: form.Outcome || null,
          NextCallDate: form.NextCallDate || null,
          Notes: form.Notes || null,
          PreferredAgreementDate: form.PreferredAgreementDate || null,
          CustomFields: customFields,
          PaymentPlanConfirmed: paymentPlanConfirmed,
          PaymentPlanDisputeReason: paymentPlanConfirmed === false ? paymentPlanDisputeReason.trim() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log call");
      setForm({ ...EMPTY_FORM, CalledBy: currentUser?.id || "", CallDate: nowLocal() });
      setCustomFields([]);
      setPaymentPlanConfirmed(null);
      setPaymentPlanDisputeReason("");
      setTimerRunning(false);
      setTimerSeconds(0);
      refetchChecklist();
      vcState.refetch();
      invalidateQueue();
      qc.invalidateQueries({ queryKey: ["crm-welcome-calls-history"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });

      if (form.Outcome === "Welcomed") {
        // Stay in the dialog so the user can complete the verification checklist —
        // closing immediately was the bug: the dialog disappeared before staff had
        // a chance to tick any checklist items, leaving the submission permanently
        // blocked. Navigate to Communication Log only after they finish and close.
        toast.success("Welcome call logged — complete the verification checklist below to finish");
      } else if (["NotReachable", "Busy", "SwitchedOff", "VoiceMail"].includes(form.Outcome)) {
        // Auto-set next call date to tomorrow so the booking doesn't
        // silently fall out of queue without a follow-up scheduled.
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
        const tomorrowStr = tomorrow.toISOString().slice(0, 16);
        setForm((f) => ({ ...f, NextCallDate: f.NextCallDate || tomorrowStr }));
        toast.info("Call logged. Next call date pre-filled for tomorrow — update if needed before the next log.");
      } else {
        toast.success("Welcome call logged");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // Correcting a past call: only outcome/follow-up/notes/custom fields are
  // ever sent — CalledBy, CallDate and DurationSeconds are the factual
  // record of when the call happened and are never part of this payload,
  // matching the backend, which ignores them on this endpoint too.
  const handleSaveEditedCall = async () => {
    if (!editingCall) return;
    if (!form.Outcome) { toast.error("Select an outcome before saving"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${editingCall.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Outcome: form.Outcome || null,
          NextCallDate: form.NextCallDate || null,
          Notes: form.Notes || null,
          PreferredAgreementDate: form.PreferredAgreementDate || null,
          CustomFields: customFields,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update call");
      toast.success("Call updated");
      refetchChecklist();
      vcState.refetch();
      invalidateQueue();
      qc.invalidateQueries({ queryKey: ["crm-welcome-calls-history"] });
      onCancelEdit?.();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEditedCall = async () => {
    if (!editingCall) return;
    setDeletingCall(true);
    try {
      const res = await fetchWithAuth(`${API}/${editingCall.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove call log");
      toast.success("Call log removed");
      refetchChecklist();
      vcState.refetch();
      invalidateQueue();
      qc.invalidateQueries({ queryKey: ["crm-welcome-calls-history"] });
      onCancelEdit?.();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setDeletingCall(false);
    }
  };

  const handleAddDoc = async () => {
    if (!docType) { toast.error("Select a document type"); return; }
    if (!docUrl.trim()) { toast.error("Enter a URL, or use the upload button to attach a file"); return; }
    try {
      const res = await fetchWithAuth(`${DOC_API}/booking/${booking.BookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentType: docType, DocumentUrl: docUrl || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDocType(""); setDocUrl("");
      refetchDocs();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!docType) { toast.error("Select a document type before uploading"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("DocumentType", docType);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetchWithAuth(`${DOC_API}/booking/${booking.BookingId}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success(`${data.count} file(s) uploaded`);
      setDocType("");
      refetchDocs();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveDoc = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${DOC_API}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refetchDocs();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleVerifyDoc = async (id: number, verified: boolean) => {
    try {
      await fetchWithAuth(`${DOC_API}/${id}/verify`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IsVerified: verified }),
      });
      refetchDocs();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleAddCoApplicant = async () => {
    if (!coForm.Name.trim()) { toast.error("Name is required"); return; }
    try {
      const res = await fetchWithAuth(`${CO_API}/booking/${booking.BookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(coForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      // A co-applicant is a named party on the Agreement itself — once legal
      // documents already exist for this booking, adding one is queued for
      // approval instead of applying immediately (see crmCoApplicant.js).
      toast.success(data.pending
        ? "Amendment queued — legal documents are under verification. This needs sign-off before it applies."
        : "Co-applicant added");
      setCoForm({ Name: "", Relation: "", Mobile: "", Email: "", PanNo: "", AadhaarNo: "", Reason: "" });
      setAddingCo(false);
      refetchCo();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleRemoveCoApplicant = async (id: number) => {
    try {
      let res = await fetchWithAuth(`${CO_API}/${id}`, { method: "DELETE" });
      let data = await res.json().catch(() => ({}));
      // Same legal-work-started gate as adding one — the backend asks for a
      // reason only when it's actually needed, so ask here rather than
      // always demanding one up front for the common (no legal work yet) case.
      if (!res.ok && /reason is required/i.test(data.error || "")) {
        const reason = window.prompt("Legal documents already exist for this booking — describe why this co-applicant should be removed:");
        if (!reason?.trim()) return;
        res = await fetchWithAuth(`${CO_API}/${id}`, {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Reason: reason.trim() }),
        });
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(data.error);
      toast.success(data.pending
        ? "Amendment queued — legal documents are under verification. This needs sign-off before it applies."
        : "Co-applicant removed");
      refetchCo();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleAddBankPreference = async () => {
    if (!bpBankName.trim()) { toast.error("Enter a bank name before adding"); return; }
    setBpSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${booking.BookingId}/bank-preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BankName: bpBankName.trim(), Remarks: bpRemarks.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setBpBankName("");
      setBpRemarks("");
      refetchBankPreferences();
      toast.success(`Bank preference saved — ${bpBankName.trim()}`);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBpSaving(false);
    }
  };

  const handleRemoveBankPreference = async (id: number, bankName: string) => {
    try {
      const res = await fetchWithAuth(`${API}/${booking.BookingId}/bank-preferences/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove");
      refetchBankPreferences();
      toast.success(`Removed — ${bankName}`);
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  // Financing type single-click save — no form, no Save button; tapping either
  // option immediately writes it to CrmBooking.FinancingType via the welcome-
  // call-specific endpoint (no Milestone-1 payment gate, unlike the Bank & KYC
  // page). Invalidates call-context so the tab reflects the change instantly.
  const handleSetFinancingType = async (ft: "SelfFunded" | "LoanFinanced") => {
    setFtSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${booking.BookingId}/financing-type`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ FinancingType: ft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success(ft === "SelfFunded" ? "Marked as self-funded" : "Marked as loan-financed");
      qc.invalidateQueries({ queryKey: ["crm-welcome-call-context", booking.BookingId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setFtSaving(false);
    }
  };

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto thin-scroll rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <PhoneCall size={18} className="text-foreground" />
            Welcome Call — <ApplicantNames name={booking.ApplicantName} bookingId={booking.BookingId} applicationId={booking.ApplicationId} /> <span className="text-muted-foreground font-normal text-sm">({booking.BookingNo})</span>
          </DialogTitle>
        </DialogHeader>

        {/* Persistent header — contact + project/unit + address, stays
            visible across every tab since it's what the telecaller needs on
            screen for the entire call, not just one section of it. */}
        <div className="border border-border bg-muted/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <ContactActionBar
            applicantName={callContext?.customer?.CustomerName || booking.ApplicantName}
            mobile={callContext?.customer?.Mobile || booking.Mobile}
            email={callContext?.customer?.Email || null}
          />
          <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:text-right sm:border-l sm:border-border sm:pl-4">
            <div className="flex items-center gap-1.5 sm:justify-end">
              <Building2 size={12} className="shrink-0" />
              <span className="truncate">{callContext?.booking?.ProjectName || booking.ProjectName || "—"}</span>
            </div>
            <div className="flex items-center gap-1.5 sm:justify-end">
              <Car size={12} className="shrink-0" />
              <span className="truncate">Unit {callContext?.booking?.UnitNo || booking.UnitNo || "—"}</span>
            </div>
            {/* Backs the "Communication address confirmed" checklist item on
                the Overview tab — call-context previously only carried
                Name/Mobile/Email/PAN, so that item had no data anywhere on
                the page to actually verify against. */}
            {(callContext?.customer?.Address || callContext?.customer?.City) && (
              <div className="flex items-start gap-1.5 sm:justify-end max-w-xs">
                <MapPin size={12} className="shrink-0 mt-0.5" />
                <span>
                  {[callContext.customer.Address, callContext.customer.City, callContext.customer.State, callContext.customer.Pincode]
                    .filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Persistent verification progress — the master submit-readiness
            gate, same "always visible regardless of which tab you're on"
            treatment as CrmBookingDetail.tsx's Data Review Checklist strip.
            Submit sits right here too, not buried at the bottom of the
            Bank Preference tab (tab 4 of 4) — that used to mean the one
            action that actually finishes this whole dossier was invisible
            unless staff happened to click through every tab, and easy to
            miss entirely on a self-funded booking where that tab shows
            nothing but "Not on file". It belongs next to the progress it
            reports on, reachable from every tab, same as Log Call. */}
        <ChecklistProgressBar vc={vcState.vc} bookingId={booking.BookingId} />
        <ChecklistSubmitFooter
          vc={vcState.vc} locked={vcState.locked} submitting={vcState.submitting} reopening={vcState.reopening}
          onSubmit={vcState.handleSubmit} onReopen={vcState.handleReopen}
          onPreviewPdf={() => setViewingWelcomeCallPdf({ id: booking.BookingId, no: booking.BookingNo })}
        />

        {/* F3 — Escalation banner: fires when customer has been unreachable 3+ consecutive times */}
        {(callContext?.consecutiveNonReached ?? 0) >= 3 && (
          <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3">
            <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">
                Customer unreachable — {callContext!.consecutiveNonReached} consecutive attempt{callContext!.consecutiveNonReached !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-destructive mt-0.5">
                Consider escalating to a manager or trying a different contact method before logging another attempt.
              </p>
            </div>
          </div>
        )}

        {/* Split from the middle: Log Call is the one thing staff are
            actively doing on every single call, so it stays permanently on
            screen on the left — never buried behind a tab click mid-call.
            Everything else (customer/booking reference data + its matching
            verify ticks, documents, co-applicant, bank/nominee) lives in
            tabs on the right. */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 items-start">
          <div className="lg:sticky lg:top-0 space-y-4">
            {/* ── Log Call / Edit Call ── */}
            <div className="border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">
                    <Phone size={14} className="text-foreground" /> {isEditingCall ? "Edit Call Log" : "Log This Call"}
                  </h3>
                  {isEditingCall && (
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                      {editingCall.CalledByName && <>Logged by <span className="font-medium text-foreground">{editingCall.CalledByName}</span></>}
                      {editingCall.CreatedAt && <> on {new Date(editingCall.CreatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
                    </p>
                  )}
                </div>
                {/* Live duration timer — a genuinely dynamic touch: start it the
                    moment the call connects, it counts up on-screen, and Duration
                    below auto-fills from it when stopped. Only relevant while
                    logging a call that's happening right now. */}
                {!isEditingCall && (
                  <div className="flex items-center gap-2">
                    {timerRunning && <span className="font-heading tabular-nums text-sm font-semibold text-primary tabular-nums">{fmtTimer(timerSeconds)}</span>}
                    <button type="button" onClick={() => setTimerRunning((r) => !r)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 border font-medium ${
                        timerRunning ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10" : "border-foreground/30 bg-card text-foreground hover:bg-primary/10"
                      }`}>
                      <Timer size={13} /> {timerRunning ? "Stop Timer" : "Start Call Timer"}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Called By</label>
                  {isEditingCall ? (
                    <div className="bg-muted/30 px-2 py-1.5 border border-border">
                      <span className="text-sm text-foreground truncate">{editingCall.CalledByName || "—"}</span>
                    </div>
                  ) : calledByLocked ? (
                    <div className="flex items-center justify-between gap-2 bg-muted/30 px-2 py-1.5 border border-border">
                      <span className="text-sm text-foreground truncate">{currentUser?.name || "Self"} <span className="text-xs text-muted-foreground">(you)</span></span>
                      <button type="button" onClick={() => setCalledByLocked(false)} className="text-xs text-primary hover:underline shrink-0">Change</button>
                    </div>
                  ) : (
                    <SearchableNativeSelect value={form.CalledBy} onChange={(e) => setForm((f) => ({ ...f, CalledBy: e.target.value }))}
                      className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                      <option value="">— Self —</option>
                      {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </SearchableNativeSelect>
                  )}
                </div>
                <div>
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Call Date & Time</label>
                  {isEditingCall ? (
                    <div className="bg-muted/30 px-2 py-1.5 border border-border">
                      <span className="text-sm text-foreground">{form.CallDate ? form.CallDate.replace("T", " ") : "—"}</span>
                    </div>
                  ) : (
                    <DateTimeInput value={form.CallDate}
                      onChange={(e) => setForm((f) => ({ ...f, CallDate: e.target.value }))}
                      className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
                  )}
                </div>
                <div className="col-span-2">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">
                    Duration {!isEditingCall && timerSeconds > 0 && !form.DurationSeconds ? <span className="text-foreground">(from timer — edit if needed)</span> : ""}
                  </label>
                  {isEditingCall ? (
                    <div className="bg-muted/30 px-2 py-1.5 border border-border inline-block">
                      <span className="text-sm text-foreground">
                        {form.DurationSeconds ? `${Math.floor(Number(form.DurationSeconds) / 60)}m ${Number(form.DurationSeconds) % 60}s` : "—"}
                      </span>
                    </div>
                  ) : (
                  /* MM:SS picker — converts to seconds on change */
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={0} max={999}
                      value={form.DurationSeconds ? String(Math.floor(Number(form.DurationSeconds) / 60)) : timerSeconds > 0 ? String(Math.floor(timerSeconds / 60)) : ""}
                      onChange={(e) => {
                        const mm = Math.max(0, Number(e.target.value) || 0);
                        const ss = form.DurationSeconds ? Number(form.DurationSeconds) % 60 : timerSeconds % 60;
                        setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                      }}
                      placeholder="MM"
                      className="w-16 text-sm border border-border px-2 py-1.5 bg-background text-center" />
                    <span className="text-muted-foreground font-semibold">:</span>
                    <input type="number" min={0} max={59}
                      value={form.DurationSeconds ? String(Number(form.DurationSeconds) % 60).padStart(2, "0") : timerSeconds > 0 ? String(timerSeconds % 60).padStart(2, "0") : ""}
                      onChange={(e) => {
                        const ss = Math.min(59, Math.max(0, Number(e.target.value) || 0));
                        const mm = form.DurationSeconds ? Math.floor(Number(form.DurationSeconds) / 60) : Math.floor(timerSeconds / 60);
                        setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                      }}
                      placeholder="SS"
                      className="w-16 text-sm border border-border px-2 py-1.5 bg-background text-center" />
                    <span className="text-xs text-muted-foreground ml-1">min : sec</span>
                    {form.DurationSeconds && Number(form.DurationSeconds) > 0 && (
                      <span className="text-xs text-muted-foreground ml-auto">{Number(form.DurationSeconds)}s total</span>
                    )}
                  </div>
                  )}
                </div>
              </div>

              {/* Quick-pick outcome keys: one tap instead of a dropdown; the picked one is inked. */}
              <div>
                <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5">Outcome</label>
                <div className="flex flex-wrap gap-1.5">
                  {OUTCOMES.map((o) => (
                    <button key={o} type="button" onClick={() => setForm((f) => ({ ...f, Outcome: o }))}
                      className={form.Outcome === o ? `${KEY_INK} h-8 px-3` : `${KEY_LINE} h-8 px-3`}>
                      {form.Outcome === o && <Check size={11} />}{OUTCOME_LABEL[o] || o}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment plan confirmation — captured once per call, stored in
                  CrmWelcomeCall.PaymentPlanConfirmed, and surfaced in the
                  Communication Log when the customer disputes. Sending null
                  (not answered) is valid — not every call reaches this question. */}
              {!isEditingCall && (
                <div>
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5">Payment Plan Confirmed by Customer?</label>
                  <div className="flex items-center gap-2">
                    {([true, false] as const).map((v) => (
                      <button key={String(v)} type="button"
                        onClick={() => { setPaymentPlanConfirmed((prev) => prev === v ? null : v); if (v === true) setPaymentPlanDisputeReason(""); }}
                        className={`text-xs px-3 py-1.5 border font-medium transition-colors ${
                          paymentPlanConfirmed === v
                            ? v ? "border-foreground/30 bg-card text-foreground" : "border-destructive/40 bg-destructive/5 text-destructive"
                            : "border-border text-muted-foreground hover:bg-muted/40"
                        }`}>
                        {paymentPlanConfirmed === v && <Check size={11} className="inline mr-1 -mt-0.5" />}{v ? "Yes — confirmed" : "No — disputed"}
                      </button>
                    ))}
                    {paymentPlanConfirmed !== null && (
                      <button type="button" onClick={() => { setPaymentPlanConfirmed(null); setPaymentPlanDisputeReason(""); }}
                        className="text-[0.6875rem] text-muted-foreground hover:underline">Clear</button>
                    )}
                  </div>
                  {paymentPlanConfirmed === false && (
                    <textarea value={paymentPlanDisputeReason} onChange={(e) => setPaymentPlanDisputeReason(e.target.value)}
                      placeholder="What is the customer's objection to the payment plan? (required)"
                      rows={2} className="mt-1.5 w-full text-xs border border-destructive/40 px-2 py-1.5 bg-background resize-none" />
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><CalendarClock size={11} /> Schedule Follow-up Call</label>
                  <DateInput value={form.NextCallDate}
                    onChange={(e) => setForm((f) => ({ ...f, NextCallDate: e.target.value }))}
                    className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
                </div>
                <div>
                  {/* Purely an informal note for whoever preps the real
                      Agreement later — this is never what actually sets
                      AgreementDate. The real date is only ever proposed
                      once the Agreement exists (CrmAgreement.tsx's Propose
                      Agreement Date flow, requiring both sides to match and
                      a super_admin sign-off). Labeled explicitly so this
                      never reads as if it's already the confirmed date. */}
                  <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><CalendarClock size={11} /> Discussed Agreement Date (note only)</label>
                  <DateInput value={form.PreferredAgreementDate}
                    onChange={(e) => setForm((f) => ({ ...f, PreferredAgreementDate: e.target.value }))}
                    className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
                  <p className="text-[0.625rem] text-muted-foreground mt-1">Not the formal proposal — that happens later on the Agreement page.</p>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><StickyNote size={11} /> Notes</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  rows={3} placeholder="What was discussed on this call..."
                  className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
              </div>

              {/* Dynamic custom fields */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1"><ListPlus size={11} /> Additional Fields</label>
                  <button onClick={() => setCustomFields((f) => [...f, { key: "", value: "" }])}
                    className="text-xs text-primary hover:underline flex items-center gap-0.5">
                    <Plus size={11} /> Add Field
                  </button>
                </div>
                {customFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <input placeholder="Field name" value={f.key}
                      onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                      className="flex-1 text-sm border border-border px-2 py-1.5 bg-background" />
                    <input placeholder="Value" value={f.value}
                      onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                      className="flex-1 text-sm border border-border px-2 py-1.5 bg-background" />
                    <button onClick={() => setCustomFields((cf) => cf.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {isEditingCall ? (
                <div className="flex items-center justify-between gap-2 pt-1">
                  {rights.canDelete && (
                    <button onClick={handleDeleteEditedCall} disabled={deletingCall || saving}
                      className="text-xs px-3 py-1.5 border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40">
                      {deletingCall ? "Removing..." : "Delete Call"}
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => onCancelEdit?.()} disabled={saving || deletingCall}
                      className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted disabled:opacity-40">
                      Cancel
                    </button>
                    {rights.canEdit && (
                      <button onClick={handleSaveEditedCall} disabled={saving || deletingCall || !form.Outcome}
                        title={!form.Outcome ? "Select an outcome above first" : undefined}
                        className={`${KEY_INK} h-8 px-3`}>
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                rights.canCreate && (
                  <button onClick={handleLogCall} disabled={saving || !form.Outcome}
                    title={!form.Outcome ? "Select an outcome above first" : undefined}
                    className={`${KEY_INK} h-8 px-3`}>
                    {saving ? "Logging..." : "Log Call"}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto thin-scroll">
          {WC_TABS.map((t) => (
            <button key={t} onClick={() => setWcTab(t)}
              className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                wcTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {t}
            </button>
          ))}
        </div>

        {wcTab === "Overview" && (
        <div className="space-y-4 pt-1">
            {/* ── Customer — each field with its own mandatory tick directly
                underneath, so while the telecaller reads the field out loud
                to the customer, the tick for that exact fact is right there
                to hit immediately, not scrolled off in a separate list. ── */}
            <div className="border border-border p-4 space-y-3">
              <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5"><Users size={14} className="text-foreground" /> Customer</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="relative">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Name</label>
                  <div className="text-sm font-medium truncate">{callContext?.customer?.CustomerName || booking.ApplicantName || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "applicant_name")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Mobile</label>
                  <div className="text-sm font-medium truncate">{callContext?.customer?.Mobile || booking.Mobile || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "mobile_number")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Email</label>
                  <div className="text-sm font-medium truncate">{callContext?.customer?.Email || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "email")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative col-span-2 md:col-span-1">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Address</label>
                  <div className="text-sm font-medium truncate" title={[callContext?.customer?.Address, callContext?.customer?.City, callContext?.customer?.State, callContext?.customer?.Pincode].filter(Boolean).join(", ")}>
                    {[callContext?.customer?.Address, callContext?.customer?.City].filter(Boolean).join(", ") || "—"}
                  </div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "address")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
              </div>
            </div>

            {/* ── Application & Booking details — same pairing pattern ── */}
            <div className="border border-border p-4 space-y-3">
              <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5"><Building2 size={14} className="text-foreground" /> Application &amp; Booking</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="relative">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Project</label>
                  <div className="text-sm font-medium truncate">{callContext?.booking?.ProjectName || booking.ProjectName || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "project_name")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">{callContext?.booking?.IsPlotSale ? "Plots" : "Unit"}</label>
                  <div className="text-sm font-medium truncate">{callContext?.booking?.UnitNo || booking.UnitNo || "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "unit_no")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Booking Date</label>
                  <div className="text-sm font-medium truncate">{callContext?.booking?.BookingDate ? new Date(callContext.booking.BookingDate).toLocaleDateString("en-IN") : "—"}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "booking_date")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                <div className="relative">
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Total Value</label>
                  <div className="text-sm font-medium truncate">{fmt(callContext?.booking?.GrandTotal ?? callContext?.booking?.TotalValue)}</div>
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "total_value")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
              </div>
            </div>

            <div className="border border-border p-3.5 space-y-2.5">
              {(() => {
                const cleared = Number(callContext?.outstanding?.totalPaid ?? 0);
                const mrReceived = Number(callContext?.mrReceived ?? 0);
                const bk = callContext?.booking;
                const storedGrand = Number(bk?.GrandTotal ?? 0);
                const grandTotal = storedGrand > 0 ? storedGrand : (Number(bk?.TotalValue || 0) + Number(bk?.ParkingTotal || 0) + Number(bk?.ExtraChargesTotal || 0));
                return (
                  <FinancialStatusBar
                    grandTotal={grandTotal}
                    cleared={cleared}
                    pendingReceipts={Math.max(0, mrReceived - cleared)}
                    approvedOnAccount={Number(callContext?.onAccount?.availableBalance ?? 0)}
                    overdueCount={milestones.filter((m: any) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date()).length}
                    compact
                  />
                );
              })()}
              <div className="pt-1">
                <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "outstanding_balance")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
              </div>
              {/* Payment Plan — tap to flex open the real milestone
                  schedule instead of just the plan name. */}
              <div className="relative border border-border bg-background overflow-hidden">
                <button type="button" onClick={() => setExpandedCard((c) => c === "plan" ? null : "plan")}
                  className="w-full text-left p-2.5 text-xs hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 text-muted-foreground"><ClipboardCheck size={11} /> {callContext?.booking?.IsPlotSale ? "Payment Schedule" : "Payment Plan"}</span>
                    <ChevronRight size={12} className={`text-muted-foreground transition-transform ${expandedCard === "plan" ? "rotate-90" : ""}`} />
                  </div>
                  <div className="font-medium text-sm truncate" title={callContext?.booking?.PaymentPlanName}>{callContext?.booking?.IsPlotSale ? "Booking Amount, then the balance" : (callContext?.booking?.PaymentPlanName || "7-stage default")}</div>
                </button>
                <div className="px-2.5 pb-2">
                  {/* Single merged checklist item — plan structure and its
                      milestone schedule are confirmed together as one fact,
                      not two separate ticks. Always visible here regardless
                      of whether the schedule itself is expanded below. */}
                  <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "plan_structure")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                </div>
                {expandedCard === "plan" && (
                  <div className="border-t border-border px-2.5 py-1.5 space-y-1.5 bg-muted/10">
                    {milestones.length === 0 ? (
                      <p className="text-[0.6875rem] text-muted-foreground">No milestone schedule generated yet.</p>
                    ) : milestones.map((m: any) => {
                      // Due/Paid per milestone are already the real, live
                      // numbers — including any excess from an earlier
                      // milestone auto-swept in via on-account (crmPayments.js's
                      // autoApplyOnAccount caps a milestone's own AmountPaid at
                      // its AmountDue and carries any further excess forward to
                      // the next milestone), so this stays accurate with zero
                      // extra plumbing here — just render what's already there.
                      const due = Number(m.AmountDue || 0);
                      const paid = Number(m.AmountPaid || 0);
                      const balance = Math.max(0, due - paid);
                      const isDone = m.Status === CrmStatus.PAID || m.Status === "Waived";
                      const label = m.Status === "Waived" ? "Waived" : isDone ? "Paid" : paid > 0 ? "Partially Paid" : "Pending";
                      return (
                        <div key={m.Id} className="text-[0.6875rem] space-y-0.5">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-foreground/90 truncate">{m.MilestoneNo}. {m.MilestoneName}</span>
                            <span className={`shrink-0 px-1.5 py-0.5 border font-medium ${
                              isDone ? "text-foreground bg-card border-foreground/30"
                                : paid > 0 ? "text-foreground bg-card border-foreground/30"
                                : "text-muted-foreground bg-muted/40 border-border"
                            }`}>{label}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Due {fmt(due)}</span>
                            {paid > 0 && <span className="text-foreground">Paid {fmt(paid)}</span>}
                            {!isDone && balance > 0 && <span className="text-foreground">Balance {fmt(balance)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bank Preference (home loan) — a genuinely separate record
                  from the customer's own Bank Details below (that's
                  KYC/refund banking; this is which bank is financing the
                  purchase). Tap to flex open the full loan record, sourced
                  straight from the same GET the Home Loan Tracking page
                  itself uses (dbo.CrmLoanDetail via GET /:id/loan) rather
                  than the trimmed subset call-context carries. */}
              <div className="border border-border bg-background overflow-hidden">
                <button type="button" onClick={() => setExpandedCard((c) => c === "bank" ? null : "bank")}
                  className="w-full text-left p-2.5 text-xs hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1 text-muted-foreground"><Landmark size={11} /> Bank Preference (Home Loan)</span>
                    <ChevronRight size={12} className={`text-muted-foreground transition-transform ${expandedCard === "bank" ? "rotate-90" : ""}`} />
                  </div>
                  <div className="font-medium text-sm truncate" title={callContext?.loan?.BankName}>{callContext?.loan?.BankName || "Not on file"}</div>
                </button>
                {expandedCard === "bank" && (
                  <div className="border-t border-border px-2.5 py-2 space-y-1 bg-muted/10 text-[0.6875rem]">
                    {loanLoading ? (
                      <p className="text-muted-foreground">Loading...</p>
                    ) : !loanDetail ? (
                      <p className="text-muted-foreground">No loan/bank preference on file — record one from the Home Loan Tracking page.</p>
                    ) : (
                      <>
                        <div className="flex justify-between"><span className="text-muted-foreground">Bank / Branch</span><span className="font-medium">{loanDetail.BankName || "—"}{loanDetail.BranchName ? ` · ${loanDetail.BranchName}` : ""}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Loan Amount</span><span className="font-medium">{fmt(loanDetail.LoanAmount)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Sanction Status</span><span className="font-medium">{loanDetail.SanctionStatus || "NotApplied"}</span></div>
                        {loanDetail.DisbursedAmount > 0 && (
                          <div className="flex justify-between"><span className="text-muted-foreground">Disbursed</span><span className="font-medium">{fmt(loanDetail.DisbursedAmount)}</span></div>
                        )}
                        {loanDetail.LoanAccountNo && (
                          <div className="flex justify-between"><span className="text-muted-foreground">Loan A/c No.</span><span className="font-medium font-heading tabular-nums">{loanDetail.LoanAccountNo}</span></div>
                        )}
                        {loanDetail.RmName && (
                          <div className="flex justify-between"><span className="text-muted-foreground">RM</span><span className="font-medium">{loanDetail.RmName}{loanDetail.RmContact ? ` · ${loanDetail.RmContact}` : ""}</span></div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {(callContext?.invoices?.length ?? 0) > 0 && (
                <div className="text-xs pt-1 border-t border-border">
                  <span className="text-muted-foreground block mb-1">Invoices</span>
                  <div className="flex flex-wrap gap-1">
                    {callContext.invoices.map((inv: any) => (
                      <button key={inv.InvoiceNo} type="button" onClick={() => handleViewInvoice(inv.InvoiceNo)}
                        className="inline-block px-1.5 py-0.5 border border-border font-heading tabular-nums text-[0.6875rem] hover:bg-muted hover:border-foreground">
                        {inv.InvoiceNo} ({fmt(inv.Amount)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Parking & Extra Charges — read-only reference so staff can
                actually see what was sold before confirming it with the
                customer. The reference card always shows (so "None on this
                booking" is visible either way), but the verify checkbox
                below it is dynamic: it only renders when vc.items actually
                contains that key, which the backend only includes when this
                booking really has a parking allotment / extra charge on
                file. Nothing to verify → no checkbox, not a forced "N/A" tick. */}
            <div className="border border-border p-3.5 space-y-2.5">
              <h4 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{callContext?.booking?.IsPlotSale ? "Extra Charges" : <>Parking &amp; Extra Charges</>}</h4>
              {/* A plot (land) sale has no parking. */}
              {!callContext?.booking?.IsPlotSale && (
              <div className="relative space-y-1">
                <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground"><Car size={11} /> Parking</span>
                {parkingAllotments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None on this booking.</p>
                ) : parkingAllotments.map((p: any) => (
                  <div key={p.Id} className="flex items-center justify-between text-xs border border-border bg-background px-2.5 py-1.5">
                    <span className="truncate">{p.ParkingSlotNo || p.ParkingType || "Slot"} {p.Quantity > 1 ? `× ${p.Quantity}` : ""}</span>
                    <span className="font-medium shrink-0">{fmt(p.TotalAmount)}</span>
                  </div>
                ))}
                <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "parking_selection")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
              </div>
              )}
              <div className="relative space-y-1 pt-1">
                <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground"><IndianRupee size={11} /> Extra Charges</span>
                {extraCharges.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None on this booking.</p>
                ) : extraCharges.map((c: any) => (
                  <div key={c.Id} className="flex items-center justify-between text-xs border border-border bg-background px-2.5 py-1.5">
                    <span className="truncate">{c.Description || c.MasterChargeName || "Extra charge"}</span>
                    <span className="font-medium shrink-0">{fmt(c.TotalAmount)}</span>
                  </div>
                ))}
                <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "extra_charges")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
              </div>
            </div>

        </div>
        )}

        {wcTab === "Documents" && (
        <div className="space-y-4 pt-1">
            {/* ── Document Verification ── */}
            <div className="border border-border p-4 space-y-2">
              <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5"><FileCheck size={14} /> Document & Attachment Verification</h3>

              {docData.documents.map((d: any) => (
                <div key={d.Id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0 gap-2">
                  <button
                    onClick={() => (d.FilePath ? setPreviewDoc(d) : d.DocumentUrl && window.open(d.DocumentUrl, "_blank"))}
                    disabled={!d.FilePath && !d.DocumentUrl}
                    className="flex items-center gap-2 min-w-0 text-left disabled:cursor-default"
                  >
                    {mimeIcon(d.MimeType)}
                    <span className="min-w-0">
                      <span className="font-medium">{d.DocumentType}</span>
                      {d.FileName && <span className="block text-[0.6875rem] text-muted-foreground truncate max-w-[220px]">{d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}</span>}
                    </span>
                    
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {rights.canEdit && (
                      <button onClick={() => handleVerifyDoc(d.Id, !d.IsVerified)}
                        className={`text-xs px-2 py-0.5 border font-medium ${d.IsVerified ? "text-foreground bg-card border-foreground/30" : "text-foreground bg-card border-foreground/30"}`}>
                        {d.IsVerified ? "Verified" : "Mark Verified"}
                      </button>
                    )}
                    {rights.canDelete && (
                      <button onClick={() => handleRemoveDoc(d.Id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {rights.canCreate && (
              <div className="flex items-center gap-2 pt-1">
                <select value={docType} onChange={(e) => setDocType(e.target.value)}
                  className="flex-1 text-sm border border-border px-2 py-1.5 bg-background">
                  <option value="">Select document type</option>
                  {docData.standardTypes.map((t: string) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="file" multiple ref={fileInputRef}
                  onChange={(e) => handleUploadFiles(e.target.files)}
                  className="hidden" />
                <button onClick={() => { if (!docType) { toast.error("Select a document type first"); return; } fileInputRef.current?.click(); }}
                  disabled={uploading}
                  className="text-xs px-3 py-1.5 border border-border hover:bg-muted shrink-0 flex items-center gap-1 disabled:opacity-40">
                  <Upload size={13} /> {uploading ? "Uploading..." : "Upload File(s)"}
                </button>
              </div>
              )}
              {rights.canCreate && (
              <div className="flex items-center gap-2">
                <input placeholder="...or paste an external document URL instead" value={docUrl} onChange={(e) => setDocUrl(e.target.value)}
                  className="flex-1 text-sm border border-border px-2 py-1.5 bg-background" />
                <button onClick={handleAddDoc} className="text-xs px-3 py-1.5 border border-border hover:bg-muted shrink-0">
                  + Add Link
                </button>
              </div>
              )}
              <p className="text-[0.6875rem] text-muted-foreground">PDF, images, Word, Excel · up to 10 files, 25 MB each</p>
            </div>

            <ChecklistSectionBlock vc={vcState.vc} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} sectionKey="Documents" />
        </div>
        )}

        {wcTab === "Co-Applicant" && (
        <div className="space-y-4 pt-1">
            {/* ── Co-Applicant — full detail cards, not a one-line summary ── */}
            <div className="border border-border p-4 space-y-2.5">
              <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5"><Users size={14} /> Co-Applicant</h3>
              {coApplicants.length === 0 && !addingCo && (
                <p className="text-xs text-muted-foreground">No co-applicant on this booking yet.</p>
              )}
              {coApplicants.map((c: any) => (
                <div key={c.Id} className="border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm text-foreground">{c.ApplicantNo ? <span className="mr-1.5 bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary">Applicant {c.ApplicantNo}</span> : null}{c.Name}{c.Relation ? <span className="text-muted-foreground font-normal"> · {c.Relation}</span> : ""}{c.CustomerNo ? <span className="text-muted-foreground font-normal text-xs"> · customer {c.CustomerNo}</span> : ""}</div>
                    {rights.canDelete && !vcState.locked && (
                      <button onClick={() => handleRemoveCoApplicant(c.Id)} className="text-xs text-destructive hover:underline shrink-0">Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
                    <div><span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Mobile</span>{c.Mobile || "—"}</div>
                    <div><span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Email</span>{c.Email || "—"}</div>
                    <div><span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">PAN (Permanent Account Number)</span>{c.PanNo || "—"}</div>
                    <div><span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Aadhaar</span>{c.AadhaarNo || "—"}</div>
                  </div>
                </div>
              ))}
              {/* Adding/removing a co-applicant changes whether the
                  "Co-Applicant Details" verification item even applies —
                  doing that after the checklist is Submitted and locked
                  would leave a locked, "fully verified" checklist silently
                  stale. Reopen first, same gate the backend enforces. */}
              {vcState.locked ? (
                <p className="text-[0.6875rem] text-muted-foreground flex items-center gap-1"><Lock size={10} /> Reopen the verification checklist to add or remove a co-applicant.</p>
              ) : !addingCo ? (
                rights.canCreate && (
                  <button onClick={() => setAddingCo(true)} className="text-xs text-foreground hover:underline flex items-center gap-0.5">
                    <Plus size={11} /> Add Co-Applicant
                  </button>
                )
              ) : (
                <div className="space-y-2 pt-1 border border-border p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input placeholder="Name *" value={coForm.Name} onChange={(e) => setCoForm((f) => ({ ...f, Name: e.target.value }))}
                      className="text-sm border border-border px-2 py-1.5 bg-background" />
                    <input placeholder="Relation" value={coForm.Relation} onChange={(e) => setCoForm((f) => ({ ...f, Relation: e.target.value }))}
                      className="text-sm border border-border px-2 py-1.5 bg-background" />
                    <input placeholder="Mobile" value={coForm.Mobile} onChange={(e) => setCoForm((f) => ({ ...f, Mobile: e.target.value }))}
                      className="text-sm border border-border px-2 py-1.5 bg-background" />
                    <input placeholder="Email" value={coForm.Email} onChange={(e) => setCoForm((f) => ({ ...f, Email: e.target.value }))}
                      className="text-sm border border-border px-2 py-1.5 bg-background" />
                    <input placeholder="PAN (Permanent Account Number)" value={coForm.PanNo} onChange={(e) => setCoForm((f) => ({ ...f, PanNo: e.target.value }))}
                      className="text-sm border border-border px-2 py-1.5 bg-background" />
                    <input placeholder="Aadhaar No." value={coForm.AadhaarNo} onChange={(e) => setCoForm((f) => ({ ...f, AadhaarNo: e.target.value }))}
                      className="text-sm border border-border px-2 py-1.5 bg-background" />
                  </div>
                  <input placeholder="Reason (only needed if legal documents already exist for this booking)"
                    value={coForm.Reason} onChange={(e) => setCoForm((f) => ({ ...f, Reason: e.target.value }))}
                    className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
                  <div className="flex gap-2">
                    <button onClick={handleAddCoApplicant} className={`${KEY_INK} h-8 px-3`}>Save</button>
                    <button onClick={() => setAddingCo(false)} className="text-xs px-3 py-1.5 border border-border text-muted-foreground hover:bg-muted">Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <ChecklistSectionBlock vc={vcState.vc} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} sectionKey="CoApplicant" />
        </div>
        )}

        {wcTab === "Bank Preference" && (
        <div className="space-y-4 pt-1">
          {/* ── How is this purchase being financed? ── */}
          <div className="border border-border p-4 space-y-3">
            <div>
              <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">
                <Wallet size={14} className="text-foreground" /> How is this purchase being financed?
              </h3>
              <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                Ask the customer during the call — this unlocks the loan-tracking step and prefills Bank &amp; KYC.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(["SelfFunded", "LoanFinanced"] as const).map((opt) => {
                const isSelected = callContext?.financingType === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={ftSaving}
                    onClick={() => handleSetFinancingType(opt)}
                    className={`text-sm border px-3 py-2.5 text-left transition-colors flex items-center gap-2 ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border bg-background hover:bg-muted/40"
                    } ${ftSaving ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className={`w-3.5 h-3.5 border-2 shrink-0 flex items-center justify-center ${isSelected ? "border-primary" : "border-muted-foreground/40"}`}>
                      {isSelected && <span className="w-1.5 h-1.5 bg-primary block" />}
                    </span>
                    {opt === "SelfFunded" ? "Self-funded" : "Home Loan"}
                  </button>
                );
              })}
            </div>
            {!callContext?.financingType && (
              <p className="text-[0.6875rem] text-foreground flex items-center gap-1.5">
                <AlertTriangle size={11} className="shrink-0" /> Ask the customer and select above — required before agreement prep.
              </p>
            )}
          </div>

          {/* ── Bank Preference ── */}
          <div className="border border-border p-4 space-y-4">
            <div>
              <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5"><Landmark size={14} className="text-foreground" /> Customer's Preferred Banks (Home Loan)</h3>
              <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                {callContext?.financingType === "SelfFunded"
                  ? "Customer is self-funded — bank preferences are optional but can still be recorded."
                  : "Banks the customer prefers for their home loan — not the finalised/sanctioned loan. Multiple banks can be recorded."}
              </p>
            </div>

            {/* Saved preference bank cards */}
            {bankPreferences.length === 0 ? (
              <p className="text-xs text-muted-foreground">No bank preferences recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {bankPreferences.map((bp: any) => (
                  <div key={bp.Id} className="flex items-start justify-between gap-3 border border-border bg-background px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Landmark size={13} className="text-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{bp.BankName}</span>
                      </div>
                      {bp.Remarks && (
                        <p className="text-[0.6875rem] text-muted-foreground mt-0.5 ml-5">{bp.Remarks}</p>
                      )}
                      <p className="text-[0.625rem] text-muted-foreground mt-0.5 ml-5">
                        Added by {bp.CreatedByName || "—"} · {bp.CreatedAt ? fmtIstIso(bp.CreatedAt) : ""}
                      </p>
                    </div>
                    {rights.canDelete && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBankPreference(bp.Id, bp.BankName)}
                        className="text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                        title="Remove this bank preference"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add new preference */}
            {rights.canCreate && (
            <div className="space-y-2 pt-1 border-t border-border">
              <label className="text-xs text-muted-foreground font-medium">Add a Bank Preference</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Bank name (e.g. SBI, HDFC, ICICI...)"
                  value={bpBankName}
                  onChange={(e) => setBpBankName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddBankPreference()}
                  className="flex-1 text-sm border border-border px-2 py-1.5 bg-background"
                />
                <button
                  type="button"
                  onClick={handleAddBankPreference}
                  disabled={bpSaving || !bpBankName.trim()}
                  className={`${KEY_INK} h-8 px-3`}
                >
                  <Plus size={13} />
                  {bpSaving ? "Adding..." : "Add"}
                </button>
              </div>
              <input
                type="text"
                placeholder="Remarks (optional) — e.g. customer already has an account here"
                value={bpRemarks}
                onChange={(e) => setBpRemarks(e.target.value)}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background"
              />
            </div>
            )}
          </div>
        </div>
        )}
          </div>
        </div>

        <div className="flex justify-end pt-3 mt-1 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Close</button>
        </div>
      </DialogContent>
    </Dialog>

    {previewDoc && <DocPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />}

    {/* Invoice PDF preview — real generated PDF, same as CrmBookingDetail.tsx's Payment & Invoice tab */}
    {viewingWelcomeCallPdf && (
      <WelcomeCallPdfDialog bookingId={viewingWelcomeCallPdf.id} bookingNo={viewingWelcomeCallPdf.no} onClose={() => setViewingWelcomeCallPdf(null)} />
    )}
    {viewingInvoice && (
      <InvoicePdfDialog bookingId={booking.BookingId} invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
    )}
    </>
  );
};

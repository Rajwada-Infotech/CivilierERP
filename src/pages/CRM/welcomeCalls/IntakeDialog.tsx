// One booking's welcome call dossier: executive masthead, live call logger,
// tabbed customer/booking/financial/document/co-applicant/bank verification,
// inline & sectioned checklist controls, and call history timeline.
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, Phone, X, FileCheck, Users, ChevronRight, Check, Upload, Trash2,
  IndianRupee, Landmark, ClipboardCheck, Wallet, Lock, Timer, PhoneCall,
  CalendarClock, StickyNote, ListPlus, Building2, Car, AlertTriangle,
  History, ShieldAlert, Pencil,
} from "lucide-react";
import { financialFigures, fmtRupees } from "@/components/crm/FinancialStatusBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactActionBar } from "@/components/crm/ContactActionBar";
import { GridGuidance, GridHighlights, GridStatusPill, GridToneMark } from "@/components/crm/CrmDataTable";
import { useAuth } from "@/contexts/AuthContext";
import { translateError } from "@/lib/translateError";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { cn } from "@/lib/utils";
import { asName } from "../payments/parts";
import {
  KEY_INK, KEY_LINE, KEY_RED, INP, TEXTAREA,
  TONE_EMERALD_TEXT, TONE_EMERALD_PILL, TONE_AMBER_TEXT,
  API, CO_API, DOC_API, OUTCOMES, OUTCOME_LABEL, EMPTY_FORM, outcomeTone,
  fmt, nowLocal, fetchUsers, fetchChecklist, fetchDocs, fetchCoApplicants,
  fetchCallContext, fetchLoanDetail, fetchBookingMilestones, fetchBookingInvoices,
  fetchParkingAllotments, fetchExtraCharges, fetchBankPreferences, VcItem,
  mimeIcon, fmtBytes,
} from "./config";
import { DocPreviewDialog, WelcomeCallPdfDialog, InvoicePdfDialog } from "./PreviewDialogs";
import { InlineVerify, useVerificationChecklist, VerificationBanner, ChecklistSectionBlock } from "./Checklist";

const WC_TABS = ["Overview", "Documents", "Co-Applicant", "Bank Preference", "Call Log"] as const;
type WcTab = typeof WC_TABS[number];

const TAB_SECTIONS: Record<WcTab, string[]> = {
  Overview: ["PersonalContact", "ProjectUnit", "PaymentPlan", "ParkingExtra"],
  Documents: ["Documents"],
  "Co-Applicant": ["CoApplicant"],
  "Bank Preference": [],
  "Call Log": [],
};

const CARD_SHELL = "rounded-xl border border-border bg-card overflow-hidden";
const CARD_HEAD = "flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-muted/30";
const FIELD_LBL = "text-xs font-medium text-muted-foreground block mb-1";
const FIELD_WELL = "text-sm font-medium text-foreground px-3 py-2 rounded-md bg-muted/40 border border-border/50 truncate";

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec === 0) return "—";
  const m = Math.floor(Number(sec) / 60);
  const s = Number(sec) % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Intake dialog: log the call + complete the verification checklist ──────
export const IntakeDialog: React.FC<{
  booking: any;
  editingCall?: any | null;
  onCancelEdit?: () => void;
  onClose: () => void;
}> = ({ booking, editingCall, onCancelEdit, onClose }) => {
  const ask = useSheetAsk();
  const rights = usePageRights("crm-welcome-calls");
  const qc = useQueryClient();
  const { currentUser } = useAuth();

  const [localEditingCall, setLocalEditingCall] = useState<any | null>(null);
  const activeEditingCall = editingCall ?? localEditingCall;
  const isEditingCall = !!activeEditingCall;

  const [form, setForm] = useState(() => activeEditingCall ? {
    CalledBy: activeEditingCall.CalledBy ? String(activeEditingCall.CalledBy) : "",
    CallDate: activeEditingCall.CallDate ? String(activeEditingCall.CallDate).slice(0, 16) : "",
    DurationSeconds: activeEditingCall.DurationSeconds != null ? String(activeEditingCall.DurationSeconds) : "",
    Outcome: activeEditingCall.Outcome || "",
    NextCallDate: activeEditingCall.NextCallDate ? String(activeEditingCall.NextCallDate).slice(0, 10) : "",
    Notes: activeEditingCall.Notes || "",
    PreferredAgreementDate: activeEditingCall.PreferredAgreementDate ? String(activeEditingCall.PreferredAgreementDate).slice(0, 10) : "",
  } : { ...EMPTY_FORM, CalledBy: currentUser?.id || "", CallDate: nowLocal() });

  const [calledByLocked, setCalledByLocked] = useState(true);
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>(() => {
    if (!activeEditingCall) return [];
    try { return activeEditingCall.CustomFields ? JSON.parse(activeEditingCall.CustomFields) : []; } catch { return []; }
  });
  const [saving, setSaving] = useState(false);
  const [deletingCall, setDeletingCall] = useState(false);
  const [docType, setDocType] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const [bpBankName, setBpBankName] = useState("");
  const [bpRemarks, setBpRemarks] = useState("");
  const [bpSaving, setBpSaving] = useState(false);
  const [ftSaving, setFtSaving] = useState(false);

  const [expandedCard, setExpandedCard] = useState<"plan" | "bank" | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<any | null>(null);
  const [viewingWelcomeCallPdf, setViewingWelcomeCallPdf] = useState<{ id: number; no: string } | null>(null);
  const [wcTab, setWcTab] = useState<WcTab>("Overview");

  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { refetch: refetchChecklist } = useQuery({
    queryKey: ["crm-welcome-checklist", booking.BookingId],
    queryFn: () => fetchChecklist(booking.BookingId),
  });
  const { data: callContext, refetch: refetchCallContext } = useQuery({
    queryKey: ["crm-welcome-call-context", booking.BookingId],
    queryFn: () => fetchCallContext(booking.BookingId),
  });

  // Keep form synchronized when toggling between logging a new call and editing an existing call
  const prevEditIdRef = useRef<number | null>(activeEditingCall?.Id ?? null);
  useEffect(() => {
    const nextId = activeEditingCall?.Id ?? null;
    if (prevEditIdRef.current === nextId) return;
    prevEditIdRef.current = nextId;
    if (activeEditingCall) {
      setForm({
        CalledBy: activeEditingCall.CalledBy ? String(activeEditingCall.CalledBy) : "",
        CallDate: activeEditingCall.CallDate ? String(activeEditingCall.CallDate).slice(0, 16) : "",
        DurationSeconds: activeEditingCall.DurationSeconds != null ? String(activeEditingCall.DurationSeconds) : "",
        Outcome: activeEditingCall.Outcome || "",
        NextCallDate: activeEditingCall.NextCallDate ? String(activeEditingCall.NextCallDate).slice(0, 10) : "",
        Notes: activeEditingCall.Notes || "",
        PreferredAgreementDate: activeEditingCall.PreferredAgreementDate ? String(activeEditingCall.PreferredAgreementDate).slice(0, 10) : "",
      });
      try {
        setCustomFields(activeEditingCall.CustomFields ? JSON.parse(activeEditingCall.CustomFields) : []);
      } catch {
        setCustomFields([]);
      }
      setTimerRunning(false);
    } else {
      setForm({
        ...EMPTY_FORM,
        CalledBy: currentUser?.id || "",
        CallDate: nowLocal(),
        PreferredAgreementDate: callContext?.latestPreferredAgreementDate
          ? String(callContext.latestPreferredAgreementDate).slice(0, 10)
          : "",
      });
      setCustomFields([]);
    }
  }, [activeEditingCall, currentUser?.id, callContext?.latestPreferredAgreementDate]);

  useEffect(() => {
    if (isEditingCall || !callContext?.latestPreferredAgreementDate) return;
    setForm((f) => f.PreferredAgreementDate
      ? f
      : { ...f, PreferredAgreementDate: String(callContext.latestPreferredAgreementDate).slice(0, 10) });
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
  const { data: milestones = [] } = useQuery({
    queryKey: ["crm-welcome-milestones", booking.BookingId],
    queryFn: () => fetchBookingMilestones(booking.BookingId),
  });
  const { data: loanDetail, isLoading: loanLoading } = useQuery({
    queryKey: ["crm-welcome-loan", booking.BookingId],
    queryFn: () => fetchLoanDetail(booking.BookingId),
    enabled: expandedCard === "bank",
  });
  const { data: bankPreferences = [], refetch: refetchBankPreferences } = useQuery({
    queryKey: ["crm-welcome-bank-preferences", booking.BookingId],
    queryFn: () => fetchBankPreferences(booking.BookingId),
    enabled: wcTab === "Bank Preference",
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["crm-welcome-queue"] });
    qc.invalidateQueries({ queryKey: ["crm-welcome-calls-history"] });
    qc.invalidateQueries({ queryKey: ["crm-welcome-call-context", booking.BookingId] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  };

  const vcState = useVerificationChecklist(booking.BookingId, invalidateAll);

  const exitEditMode = () => {
    if (editingCall) onCancelEdit?.();
    else setLocalEditingCall(null);
  };

  const handleViewInvoice = async (invoiceNo: string) => {
    const list = await fetchBookingInvoices(booking.BookingId);
    const found = list.find((i: any) => i.InvoiceNo === invoiceNo);
    if (found) setViewingInvoice(found);
    else toast.error("Could not load invoice detail");
  };

  const handleLogCall = async () => {
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
      if (!res.ok) throw new Error(data.error || "Could not log call");
      setForm({ ...EMPTY_FORM, CalledBy: currentUser?.id || "", CallDate: nowLocal() });
      setCustomFields([]);
      setPaymentPlanConfirmed(null);
      setPaymentPlanDisputeReason("");
      setTimerRunning(false);
      setTimerSeconds(0);
      refetchChecklist();
      refetchCallContext();
      vcState.refetch();
      invalidateAll();

      if (form.Outcome === "Welcomed") {
        toast.success("Welcome call logged — complete the verification checklist to finish");
      } else if (["NotReachable", "Busy", "SwitchedOff", "VoiceMail"].includes(form.Outcome)) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
        const tomorrowStr = tomorrow.toISOString().slice(0, 16);
        setForm((f) => ({ ...f, NextCallDate: f.NextCallDate || tomorrowStr }));
        toast.info("Call logged. Next call date pre-filled for tomorrow — update if needed.");
      } else {
        toast.success("Welcome call logged");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEditedCall = async () => {
    if (!activeEditingCall) return;
    if (!form.Outcome) { toast.error("Select an outcome before saving"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${activeEditingCall.Id}`, {
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
      if (!res.ok) throw new Error(data.error || "Could not update call");
      toast.success("Call updated");
      refetchChecklist();
      refetchCallContext();
      vcState.refetch();
      invalidateAll();
      exitEditMode();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEditedCall = async () => {
    if (!activeEditingCall) return;
    setDeletingCall(true);
    try {
      const res = await fetchWithAuth(`${API}/${activeEditingCall.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove call log");
      toast.success("Call log removed");
      refetchChecklist();
      refetchCallContext();
      vcState.refetch();
      invalidateAll();
      exitEditMode();
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
      vcState.refetch();
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
      vcState.refetch();
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
      vcState.refetch();
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
      toast.success(data.pending
        ? "Amendment queued — legal documents are under verification. This needs sign-off before it applies."
        : "Co-applicant added");
      setCoForm({ Name: "", Relation: "", Mobile: "", Email: "", PanNo: "", AadhaarNo: "", Reason: "" });
      setAddingCo(false);
      refetchCo();
      vcState.refetch();
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleRemoveCoApplicant = async (id: number) => {
    try {
      let res = await fetchWithAuth(`${CO_API}/${id}`, { method: "DELETE" });
      let data = await res.json().catch(() => ({}));
      if (!res.ok && /reason is required/i.test(data.error || "")) {
        const reason = await ask.prompt("Legal documents already exist for this booking — describe why this co-applicant should be removed.", {
          title: "Remove co-applicant", okLabel: "Remove", danger: true,
        });
        if (!reason?.trim()) return;
        res = await fetchWithAuth(`${CO_API}/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Reason: reason.trim() }),
        });
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(data.error);
      toast.success(data.pending
        ? "Amendment queued — legal documents are under verification. This needs sign-off before it applies."
        : "Co-applicant removed");
      refetchCo();
      vcState.refetch();
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
      if (!res.ok) throw new Error(data.error || "Could not save");
      setBpBankName("");
      setBpRemarks("");
      refetchBankPreferences();
      invalidateAll();
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
      if (!res.ok) throw new Error(data.error || "Could not remove");
      refetchBankPreferences();
      invalidateAll();
      toast.success(`Removed — ${bankName}`);
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleSetFinancingType = async (ft: "SelfFunded" | "LoanFinanced") => {
    setFtSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${booking.BookingId}/financing-type`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ FinancingType: ft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      toast.success(ft === "SelfFunded" ? "Marked as self-funded" : "Marked as loan-financed");
      refetchCallContext();
      invalidateAll();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setFtSaving(false);
    }
  };

  // Derived display values for MoneyBand & details
  const bk = callContext?.booking;
  const cust = callContext?.customer;
  const customerName = cust?.CustomerName || booking.ApplicantName || "Customer";
  const customerMobile = cust?.Mobile || booking.Mobile || null;
  const customerEmail = cust?.Email || booking.Email || null;
  const fullAddress = [cust?.Address, cust?.City, cust?.State, cust?.Pincode].filter(Boolean).join(", ");
  const bookingDateRaw = bk?.BookingDate || booking.BookingDate || null;
  const bookingDateDisplay = bookingDateRaw
    ? new Date(bookingDateRaw).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

  const cleared = Number(callContext?.outstanding?.totalPaid ?? 0);
  const mrReceived = Number(callContext?.mrReceived ?? 0);
  const approvedOnAccount = Number(callContext?.onAccount?.availableBalance ?? 0);
  const pendingReceipts = Math.max(0, mrReceived - cleared - approvedOnAccount);
  const storedGrand = Number(bk?.GrandTotal ?? booking.GrandTotal ?? 0);
  const grandTotal = storedGrand > 0
    ? storedGrand
    : (Number(bk?.TotalValue ?? booking.TotalValue ?? 0) + Number(bk?.ParkingTotal || 0) + Number(bk?.ExtraChargesTotal || 0));
  const { onAccount, outstanding } = financialFigures({
    grandTotal, cleared, pendingReceipts, approvedOnAccount,
  });
  const overdueCount = (milestones as any[]).filter(
    (m: any) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date(),
  ).length;
  const recentCalls: any[] = callContext?.recentCalls || [];
  const coNames = useMemo(
    () => (coApplicants as any[]).map((c: any) => asName(c.Name)).filter(Boolean),
    [coApplicants],
  );

  // Per-tab checklist stats for CrmBookingDetail-style badges
  const tabCheckStats = (t: WcTab) => {
    const keys = TAB_SECTIONS[t];
    if (!keys.length || !vcState.vc?.sections) return { total: 0, checked: 0, flagged: 0 };
    const secs = (vcState.vc.sections as any[]).filter((s: any) => keys.includes(s.section));
    const items = secs.flatMap((s: any) => s.items || []);
    return {
      total: items.length,
      checked: items.filter((i: VcItem) => i.IsChecked).length,
      flagged: items.filter((i: VcItem) => i.RecheckStatus === CrmStatus.OPEN).length,
    };
  };

  const stageBadge = vcState.locked
    ? { label: "Verified & Locked", tone: "done" as const }
    : (vcState.vc?.openRecheckCount ?? 0) > 0
      ? { label: `${vcState.vc.openRecheckCount} in Recheck`, tone: "stopped" as const }
      : vcState.vc?.hasWelcomedCall
        ? { label: "Checklist Due", tone: "waiting" as const }
        : { label: "Pending Call", tone: "waiting" as const };

  return (
    <>
      {ask.node}
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto thin-scroll rounded-xl p-5 gap-4">
          <DialogHeader className="sr-only">
            <DialogTitle>Welcome Call — {booking.BookingNo}</DialogTitle>
          </DialogHeader>

          <div className="min-w-0 space-y-4">
            {/* ── Clean Highlights Header Card (matches CrmCustomer360 / CrmApplication / CrmDataTable kit) ── */}
            <GridHighlights
              icon={PhoneCall}
              object={`Welcome Call · ${bk?.BookingNo || booking.BookingNo}${booking.ApplicationNo ? ` · ${booking.ApplicationNo}` : ""}`}
              title={
                <span className="capitalize">
                  <ApplicantNames
                    name={asName(customerName)}
                    bookingId={booking.BookingId}
                    applicationId={bk?.ApplicationId ?? booking.ApplicationId}
                    coApplicants={coNames.length ? coNames : undefined}
                  />
                </span>
              }
              status={<GridToneMark tone={stageBadge.tone} text={stageBadge.label} />}
              sub={
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>{bk?.ProjectName || booking.ProjectName || "—"}</span>
                  {(bk?.UnitNo || booking.UnitNo) && (
                    <span>· {bk?.IsPlotSale ? "Plot" : "Unit"} {bk?.UnitNo || booking.UnitNo}{bk?.BlockName ? ` (${bk.BlockName})` : ""}</span>
                  )}
                  {bk?.AssignedToName && <span>· Owner: {bk.AssignedToName}</span>}
                  {fullAddress && <span>· {fullAddress}</span>}
                </div>
              }
              actions={
                (customerMobile || customerEmail) ? (
                  <div className="pr-8">
                    <ContactActionBar
                      applicantName={customerName}
                      mobile={customerMobile}
                      email={customerEmail}
                    />
                  </div>
                ) : undefined
              }
              fields={[
                { label: "Grand total", value: fmtRupees(grandTotal) },
                { label: "Cleared", value: fmtRupees(cleared) },
                { label: "On account", value: onAccount > 0 ? fmtRupees(onAccount) : "—" },
                { label: "Outstanding", value: outstanding > 0 ? fmtRupees(outstanding) : "Settled" },
                {
                  label: "Financing",
                  value: callContext?.financingType === "SelfFunded"
                    ? "Self-funded"
                    : callContext?.financingType === "LoanFinanced"
                      ? `Home Loan${callContext?.loan?.BankName ? ` · ${callContext.loan.BankName}` : ""}`
                      : "Not set",
                },
                {
                  label: "Call attempts",
                  value: `${recentCalls.length} logged${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}`,
                },
              ]}
            />

            {(callContext?.consecutiveNonReached ?? 0) >= 3 && (
              <GridGuidance
                tone="stopped"
                title={`Unreachable for ${callContext!.consecutiveNonReached} consecutive attempts`}
                text="Consider escalating to a team lead or reaching out via SMS / WhatsApp before logging another call attempt."
              />
            )}

            {/* ── Unified Verification Status & Action Strip ── */}
            <VerificationBanner
              vc={vcState.vc}
              locked={vcState.locked}
              submitting={vcState.submitting}
              reopening={vcState.reopening}
              onSubmit={vcState.handleSubmit}
              onReopen={vcState.handleReopen}
              onPreviewPdf={() => setViewingWelcomeCallPdf({ id: booking.BookingId, no: bk?.BookingNo || booking.BookingNo })}
            />

            {/* ── 2-Column Workspace: Sticky Call Logger (left) + Tabbed Verification Data (right) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">
              {/* Left Column: Log / Edit Call */}
              <div className="lg:sticky lg:top-0">
                <div className={cn(CARD_SHELL, "shadow-[0_2px_3px_0_hsl(var(--foreground)/0.07)]")}>
                  <div className={CARD_HEAD}>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        <Phone size={14} className="text-primary shrink-0" />
                        {isEditingCall ? "Edit call log" : "Log this call"}
                      </h3>
                      {isEditingCall && (
                        <p className="text-[0.6875rem] text-muted-foreground mt-0.5 truncate">
                          {activeEditingCall.CalledByName && <>By <span className="font-medium text-foreground">{activeEditingCall.CalledByName}</span></>}
                          {activeEditingCall.CreatedAt && <> · {new Date(activeEditingCall.CreatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
                        </p>
                      )}
                    </div>
                    {!isEditingCall && (
                      <div className="flex items-center gap-2 shrink-0">
                        {timerRunning && (
                          <span className="tabular-nums text-xs font-semibold text-primary px-2 py-0.5 rounded-full bg-primary/10">
                            {fmtTimer(timerSeconds)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setTimerRunning((r) => !r)}
                          className={cn(
                            "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors",
                            timerRunning
                              ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                              : "border-border bg-card text-foreground hover:bg-muted",
                          )}
                        >
                          <Timer size={12} /> {timerRunning ? "Stop" : "Start Timer"}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-4 space-y-3.5">
                    <div className="space-y-3">
                      <div>
                        <label className={FIELD_LBL}>Called by</label>
                        {isEditingCall ? (
                          <div className={FIELD_WELL}>{activeEditingCall.CalledByName || "—"}</div>
                        ) : calledByLocked ? (
                          <div className="flex items-center justify-between gap-2 h-9 rounded-md border border-border/60 bg-muted/40 px-2.5">
                            <span className="text-sm text-foreground truncate">{currentUser?.name || "Self"}</span>
                            <button type="button" onClick={() => setCalledByLocked(false)} className="text-xs font-medium text-primary hover:underline shrink-0">
                              Change
                            </button>
                          </div>
                        ) : (
                          <SearchableNativeSelect
                            value={form.CalledBy}
                            onChange={(e) => setForm((f) => ({ ...f, CalledBy: e.target.value }))}
                            className={INP}
                          >
                            <option value="">— Self —</option>
                            {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                          </SearchableNativeSelect>
                        )}
                      </div>

                      <div>
                        <label className={FIELD_LBL}>Call date &amp; time</label>
                        {isEditingCall ? (
                          <div className={cn(FIELD_WELL, "tabular-nums")}>{form.CallDate ? form.CallDate.replace("T", " ") : "—"}</div>
                        ) : (
                          <DateTimeInput
                            value={form.CallDate}
                            onChange={(e) => setForm((f) => ({ ...f, CallDate: e.target.value }))}
                            className={INP}
                          />
                        )}
                      </div>

                      <div>
                        <label className={FIELD_LBL}>
                          Duration
                          {!isEditingCall && timerSeconds > 0 && !form.DurationSeconds && (
                            <span className="ml-1 text-primary font-normal">(live from timer)</span>
                          )}
                        </label>
                        {isEditingCall ? (
                          <div className={cn(FIELD_WELL, "tabular-nums inline-block")}>
                            {fmtDuration(form.DurationSeconds ? Number(form.DurationSeconds) : null)}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={999}
                              value={form.DurationSeconds ? String(Math.floor(Number(form.DurationSeconds) / 60)) : timerSeconds > 0 ? String(Math.floor(timerSeconds / 60)) : ""}
                              onChange={(e) => {
                                const mm = Math.max(0, Number(e.target.value) || 0);
                                const ss = form.DurationSeconds ? Number(form.DurationSeconds) % 60 : timerSeconds % 60;
                                setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                              }}
                              placeholder="MM"
                              className="w-16 h-9 text-sm rounded-md border border-border px-2 bg-card text-center tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                            />
                            <span className="text-muted-foreground font-semibold">:</span>
                            <input
                              type="number"
                              min={0}
                              max={59}
                              value={form.DurationSeconds ? String(Number(form.DurationSeconds) % 60).padStart(2, "0") : timerSeconds > 0 ? String(timerSeconds % 60).padStart(2, "0") : ""}
                              onChange={(e) => {
                                const ss = Math.min(59, Math.max(0, Number(e.target.value) || 0));
                                const mm = form.DurationSeconds ? Math.floor(Number(form.DurationSeconds) / 60) : Math.floor(timerSeconds / 60);
                                setForm((f) => ({ ...f, DurationSeconds: String(mm * 60 + ss) }));
                              }}
                              placeholder="SS"
                              className="w-16 h-9 text-sm rounded-md border border-border px-2 bg-card text-center tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                            />
                            <span className="text-xs text-muted-foreground ml-1">min : sec</span>
                            {form.DurationSeconds && Number(form.DurationSeconds) > 0 && (
                              <span className="text-xs text-muted-foreground ml-auto tabular-nums">{Number(form.DurationSeconds)}s</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Outcome quick-pick buttons */}
                    <div>
                      <label className={FIELD_LBL}>Outcome</label>
                      <div className="flex flex-wrap gap-1.5">
                        {OUTCOMES.map((o) => {
                          const selected = form.Outcome === o;
                          return (
                            <button
                              key={o}
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, Outcome: o }))}
                              className={cn(
                                selected ? KEY_INK : KEY_LINE,
                                "h-8 px-2.5",
                                !selected && "text-foreground",
                              )}
                            >
                              {selected && <Check size={11} />}
                              {OUTCOME_LABEL[o] || o}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {!isEditingCall && (
                      <div>
                        <label className={FIELD_LBL}>Payment plan confirmed by customer?</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {([true, false] as const).map((v) => {
                            const active = paymentPlanConfirmed === v;
                            return (
                              <button
                                key={String(v)}
                                type="button"
                                onClick={() => {
                                  setPaymentPlanConfirmed((prev) => prev === v ? null : v);
                                  if (v === true) setPaymentPlanDisputeReason("");
                                }}
                                className={cn(
                                  "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-colors",
                                  active
                                    ? v
                                      ? TONE_EMERALD_PILL
                                      : "border-destructive/40 bg-destructive/10 text-destructive"
                                    : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                              >
                                {active && <Check size={11} />}
                                {v ? "Yes — confirmed" : "No — disputed"}
                              </button>
                            );
                          })}
                          {paymentPlanConfirmed !== null && (
                            <button
                              type="button"
                              onClick={() => { setPaymentPlanConfirmed(null); setPaymentPlanDisputeReason(""); }}
                              className="text-xs text-muted-foreground hover:underline"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {paymentPlanConfirmed === false && (
                          <textarea
                            value={paymentPlanDisputeReason}
                            onChange={(e) => setPaymentPlanDisputeReason(e.target.value)}
                            placeholder="What is the customer's objection to the payment plan? (required)"
                            rows={2}
                            className={cn(TEXTAREA, "mt-2 text-xs border-destructive/40 focus:border-destructive focus:ring-destructive/20")}
                          />
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={cn(FIELD_LBL, "flex items-center gap-1")}>
                          <CalendarClock size={12} /> Follow-up call
                        </label>
                        <DateInput
                          value={form.NextCallDate}
                          onChange={(e) => setForm((f) => ({ ...f, NextCallDate: e.target.value }))}
                          className={INP}
                        />
                      </div>
                      <div>
                        <label className={cn(FIELD_LBL, "flex items-center gap-1")} title="Informal note only — the formal agreement date is proposed later on the Agreement page">
                          <CalendarClock size={12} /> Agreement note
                        </label>
                        <DateInput
                          value={form.PreferredAgreementDate}
                          onChange={(e) => setForm((f) => ({ ...f, PreferredAgreementDate: e.target.value }))}
                          className={INP}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={cn(FIELD_LBL, "flex items-center gap-1")}>
                        <StickyNote size={12} /> Notes
                      </label>
                      <textarea
                        value={form.Notes}
                        onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                        rows={3}
                        placeholder="Key discussion points from this call…"
                        className={TEXTAREA}
                      />
                    </div>

                    {/* Additional custom fields */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <ListPlus size={12} /> Additional fields
                        </label>
                        <button
                          type="button"
                          onClick={() => setCustomFields((f) => [...f, { key: "", value: "" }])}
                          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          <Plus size={12} /> Add field
                        </button>
                      </div>
                      {customFields.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 mb-1.5">
                          <input
                            placeholder="Field name"
                            value={f.key}
                            onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                            className={cn(INP, "flex-1")}
                          />
                          <input
                            placeholder="Value"
                            value={f.value}
                            onChange={(e) => setCustomFields((cf) => cf.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                            className={cn(INP, "flex-1")}
                          />
                          <button
                            type="button"
                            onClick={() => setCustomFields((cf) => cf.filter((_, j) => j !== i))}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted shrink-0"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Submit actions */}
                    {isEditingCall ? (
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                        {rights.canDelete ? (
                          <button
                            type="button"
                            onClick={handleDeleteEditedCall}
                            disabled={deletingCall || saving}
                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-destructive/40 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40"
                          >
                            {deletingCall ? "Removing…" : "Delete Call"}
                          </button>
                        ) : <span />}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={exitEditMode}
                            disabled={saving || deletingCall}
                            className={`${KEY_LINE} h-8 px-3 text-foreground`}
                          >
                            Cancel
                          </button>
                          {rights.canEdit && (
                            <button
                              type="button"
                              onClick={handleSaveEditedCall}
                              disabled={saving || deletingCall || !form.Outcome}
                              title={!form.Outcome ? "Select an outcome above first" : undefined}
                              className={`${KEY_INK} h-8 px-3.5`}
                            >
                              {saving ? "Saving…" : "Save Changes"}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      rights.canCreate && (
                        <button
                          type="button"
                          onClick={handleLogCall}
                          disabled={saving || !form.Outcome}
                          title={!form.Outcome ? "Select an outcome above first" : undefined}
                          className={`${KEY_INK} h-9 w-full`}
                        >
                          <PhoneCall size={13} /> {saving ? "Logging call…" : "Log Call"}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Sectioned Dossier & Verification */}
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-end gap-x-1 border-b border-border" role="tablist" aria-label="Welcome call sections">
                  {WC_TABS.map((t) => {
                    const active = wcTab === t;
                    const c = tabCheckStats(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setWcTab(t)}
                        className={cn(
                          "h-10 px-3 -mb-px border-b-2 text-[0.8125rem] whitespace-nowrap transition-colors inline-flex items-center gap-1.5",
                          active
                            ? "border-primary text-foreground font-semibold"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                        )}
                      >
                        <span>{t}</span>
                        {c.total > 0 && (
                          c.flagged > 0 ? (
                            <span title={`${c.flagged} flagged`} className="px-1.5 min-w-[1.25rem] text-center rounded-full text-[0.6875rem] font-semibold bg-destructive/15 text-destructive">!</span>
                          ) : c.checked === c.total ? (
                            <span title="All verified" className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full border", TONE_EMERALD_PILL)}>
                              <Check size={10} />
                            </span>
                          ) : (
                            <span title={`${c.total - c.checked} pending`} className={cn(
                              "px-1.5 min-w-[1.25rem] text-center rounded-full text-[0.6875rem] tabular-nums",
                              active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                            )}>
                              {c.total - c.checked}
                            </span>
                          )
                        )}
                        {t === "Bank Preference" && !callContext?.financingType && (
                          <span title="Financing type not selected" className="w-2 h-2 rounded-full bg-amber-400" />
                        )}
                        {t === "Call Log" && recentCalls.length > 0 && (
                          <span className={cn(
                            "px-1.5 min-w-[1.25rem] text-center rounded-full text-[0.6875rem] tabular-nums",
                            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                          )}>
                            {recentCalls.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* ── Tab 1: Overview ── */}
                {wcTab === "Overview" && (
                  <div className="space-y-4">
                    {/* Customer details + inline verify ticks */}
                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Users size={14} className="text-primary" /> Customer
                        </h3>
                        {cust?.PanNo && (
                          <span className="text-[0.6875rem] font-mono text-muted-foreground rounded-md bg-background border border-border px-2 py-0.5">
                            PAN: {cust.PanNo}
                          </span>
                        )}
                      </div>
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>Name</label>
                          <div className={cn(FIELD_WELL, "capitalize")} title={customerName}>{asName(customerName)}</div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "applicant_name")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>Mobile</label>
                          <div className={cn(FIELD_WELL, "tabular-nums")}>{customerMobile || "—"}</div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "mobile_number")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>Email</label>
                          <div className={FIELD_WELL} title={customerEmail || undefined}>{customerEmail || "—"}</div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "email")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>Communication address</label>
                          <div className={FIELD_WELL} title={fullAddress || undefined}>
                            {[cust?.Address, cust?.City].filter(Boolean).join(", ") || "—"}
                          </div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "address")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                      </div>
                    </section>

                    {/* Application & Booking + inline verify ticks */}
                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Building2 size={14} className="text-primary" /> Application &amp; Booking
                        </h3>
                        {bk?.BookingStatus && <GridStatusPill status={bk.BookingStatus} />}
                      </div>
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>Project</label>
                          <div className={FIELD_WELL} title={bk?.ProjectName || booking.ProjectName}>{bk?.ProjectName || booking.ProjectName || "—"}</div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "project_name")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>{bk?.IsPlotSale ? "Plots" : "Unit"}{bk?.BlockName ? ` · ${bk.BlockName}` : ""}</label>
                          <div className={FIELD_WELL} title={bk?.UnitNo || booking.UnitNo}>{bk?.UnitNo || booking.UnitNo || "—"}</div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "unit_no")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>Booking date</label>
                          <div className={cn(FIELD_WELL, "tabular-nums")}>{bookingDateDisplay}</div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "booking_date")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                        <div className="min-w-0">
                          <label className={FIELD_LBL}>Grand total</label>
                          <div className={cn(FIELD_WELL, "tabular-nums font-semibold")}>{fmt(grandTotal > 0 ? grandTotal : null)}</div>
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "total_value")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                      </div>
                    </section>

                    {/* Payment Plan, Balances & Invoices */}
                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <IndianRupee size={14} className="text-primary" /> Payment Schedule &amp; Balances
                        </h3>
                        {overdueCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 border border-destructive/30 px-2 py-0.5 text-[0.6875rem] font-medium text-destructive">
                            {overdueCount} overdue
                          </span>
                        )}
                      </div>
                      <div className="p-4 space-y-3">
                        {/* Payment Plan Accordion */}
                        <div className="rounded-lg border border-border bg-card overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setExpandedCard((c) => c === "plan" ? null : "plan")}
                            className="w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors"
                          >
                            <div className="min-w-0">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <ClipboardCheck size={12} /> {bk?.IsPlotSale ? "Payment schedule" : "Payment plan"}
                              </span>
                              <div className="text-sm font-semibold text-foreground truncate mt-0.5">
                                {bk?.IsPlotSale ? "Booking Amount, then the balance" : (bk?.PaymentPlanName || "7-stage default")}
                              </div>
                            </div>
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                              {(milestones as any[]).length} milestones
                              <ChevronRight size={14} className={cn("transition-transform", expandedCard === "plan" && "rotate-90")} />
                            </span>
                          </button>

                          <div className="px-3.5 pb-2.5 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border/60 pt-2 bg-muted/15">
                            <InlineVerify
                              item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "plan_structure")}
                              bookingId={booking.BookingId}
                              locked={vcState.locked}
                              onChanged={vcState.refetch}
                              label="Plan schedule:"
                            />
                            <InlineVerify
                              item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "outstanding_balance")}
                              bookingId={booking.BookingId}
                              locked={vcState.locked}
                              onChanged={vcState.refetch}
                              label="Outstanding balance:"
                            />
                          </div>

                          {expandedCard === "plan" && (
                            <div className="border-t border-border px-3.5 py-2.5 space-y-2 bg-muted/20">
                              {(milestones as any[]).length === 0 ? (
                                <p className="text-xs text-muted-foreground">No milestone schedule generated yet.</p>
                              ) : (milestones as any[]).map((m: any) => {
                                const due = Number(m.AmountDue || 0);
                                const paid = Number(m.AmountPaid || 0);
                                const balance = Math.max(0, due - paid);
                                const isDone = m.Status === CrmStatus.PAID || m.Status === "Waived";
                                const label = m.Status === "Waived" ? "Waived" : isDone ? "Paid" : paid > 0 ? "Partially Paid" : "Pending";
                                return (
                                  <div key={m.Id} className="rounded-md border border-border/70 bg-card px-3 py-2 text-xs space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-medium text-foreground truncate">{m.MilestoneNo}. {m.MilestoneName}</span>
                                      <GridStatusPill status={label} />
                                    </div>
                                    <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
                                      <span>Due {fmt(due)}</span>
                                      {paid > 0 && <span className={TONE_EMERALD_TEXT}>Paid {fmt(paid)}</span>}
                                      {!isDone && balance > 0 && <span className="text-foreground font-medium">Balance {fmt(balance)}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Home Loan Accordion */}
                        <div className="rounded-lg border border-border bg-card overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setExpandedCard((c) => c === "bank" ? null : "bank")}
                            className="w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors"
                          >
                            <div className="min-w-0">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Landmark size={12} /> Bank / Home loan record
                              </span>
                              <div className="text-sm font-semibold text-foreground truncate mt-0.5">
                                {callContext?.loan?.BankName || "Not on file"}
                              </div>
                            </div>
                            <ChevronRight size={14} className={cn("text-muted-foreground shrink-0 transition-transform", expandedCard === "bank" && "rotate-90")} />
                          </button>
                          {expandedCard === "bank" && (
                            <div className="border-t border-border px-3.5 py-2.5 space-y-1.5 bg-muted/20 text-xs">
                              {loanLoading ? (
                                <p className="text-muted-foreground">Loading…</p>
                              ) : !loanDetail ? (
                                <p className="text-muted-foreground">No sanctioned loan record on file — capture preferred banks under the Bank Preference tab.</p>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Bank / Branch</span><span className="font-medium">{loanDetail.BankName || "—"}{loanDetail.BranchName ? ` · ${loanDetail.BranchName}` : ""}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Loan Amount</span><span className="font-medium tabular-nums">{fmt(loanDetail.LoanAmount)}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">Sanction Status</span><span className="font-medium">{loanDetail.SanctionStatus || "NotApplied"}</span></div>
                                  {loanDetail.DisbursedAmount > 0 && (
                                    <div className="flex justify-between"><span className="text-muted-foreground">Disbursed</span><span className="font-medium tabular-nums">{fmt(loanDetail.DisbursedAmount)}</span></div>
                                  )}
                                  {loanDetail.LoanAccountNo && (
                                    <div className="flex justify-between"><span className="text-muted-foreground">Loan A/c No.</span><span className="font-medium tabular-nums">{loanDetail.LoanAccountNo}</span></div>
                                  )}
                                  {loanDetail.RmName && (
                                    <div className="flex justify-between"><span className="text-muted-foreground">RM</span><span className="font-medium">{loanDetail.RmName}{loanDetail.RmContact ? ` · ${loanDetail.RmContact}` : ""}</span></div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {(callContext?.invoices?.length ?? 0) > 0 && (
                          <div className="pt-1">
                            <span className={FIELD_LBL}>Invoices</span>
                            <div className="flex flex-wrap gap-1.5">
                              {callContext.invoices.map((inv: any) => (
                                <button
                                  key={inv.InvoiceNo}
                                  type="button"
                                  onClick={() => handleViewInvoice(inv.InvoiceNo)}
                                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-card text-xs font-medium tabular-nums hover:bg-muted transition-colors"
                                >
                                  {inv.InvoiceNo} · {fmt(inv.Amount)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Parking & Extra Charges */}
                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Car size={14} className="text-primary" />
                          {bk?.IsPlotSale ? "Extra Charges" : "Parking & Extra Charges"}
                        </h4>
                      </div>
                      <div className="p-4 space-y-3">
                        {!bk?.IsPlotSale && (
                          <div className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Car size={12} /> Parking</span>
                            {parkingAllotments.length === 0 ? (
                              <p className="text-xs text-muted-foreground">None on this booking.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {parkingAllotments.map((p: any) => (
                                  <div key={p.Id} className="flex items-center justify-between text-xs rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                                    <span className="truncate font-medium">{p.ParkingSlotNo || p.ParkingType || "Slot"} {p.Quantity > 1 ? `× ${p.Quantity}` : ""}</span>
                                    <span className="font-semibold tabular-nums shrink-0">{fmt(p.TotalAmount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "parking_selection")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1"><IndianRupee size={12} /> Extra Charges</span>
                          {extraCharges.length === 0 ? (
                            <p className="text-xs text-muted-foreground">None on this booking.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {extraCharges.map((c: any) => (
                                <div key={c.Id} className="flex items-center justify-between text-xs rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                                  <span className="truncate font-medium">{c.Description || c.MasterChargeName || "Extra charge"}</span>
                                  <span className="font-semibold tabular-nums shrink-0">{fmt(c.TotalAmount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <InlineVerify item={vcState.vc?.items.find((i: VcItem) => i.ItemKey === "extra_charges")} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} />
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {/* ── Tab 2: Documents ── */}
                {wcTab === "Documents" && (
                  <div className="space-y-4">
                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <FileCheck size={14} className="text-primary" /> Document &amp; Attachment Verification
                        </h3>
                        <span className="text-xs text-muted-foreground tabular-nums">{docData.documents.length} file(s)</span>
                      </div>
                      <div className="p-4 space-y-3">
                        {docData.documents.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No documents attached yet.</p>
                        ) : (
                          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                            {docData.documents.map((d: any) => (
                              <div key={d.Id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm bg-card hover:bg-muted/20 transition-colors">
                                <button
                                  type="button"
                                  onClick={() => (d.FilePath ? setPreviewDoc(d) : d.DocumentUrl && window.open(d.DocumentUrl, "_blank"))}
                                  disabled={!d.FilePath && !d.DocumentUrl}
                                  className="flex items-center gap-2.5 min-w-0 text-left disabled:cursor-default"
                                >
                                  {mimeIcon(d.MimeType)}
                                  <span className="min-w-0">
                                    <span className="font-medium block truncate">{d.DocumentType}</span>
                                    {d.FileName && (
                                      <span className="block text-xs text-muted-foreground truncate max-w-[240px]">
                                        {d.FileName}{d.FileSize ? ` · ${fmtBytes(d.FileSize)}` : ""}
                                      </span>
                                    )}
                                  </span>
                                </button>
                                <div className="flex items-center gap-2 shrink-0">
                                  {rights.canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => handleVerifyDoc(d.Id, !d.IsVerified)}
                                      className={cn(
                                        "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-medium border transition-colors",
                                        d.IsVerified
                                          ? TONE_EMERALD_PILL
                                          : "bg-card border-border text-foreground hover:bg-muted",
                                      )}
                                    >
                                      {d.IsVerified && <Check size={11} />}
                                      {d.IsVerified ? "Verified" : "Mark Verified"}
                                    </button>
                                  )}
                                  {rights.canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveDoc(d.Id)}
                                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {rights.canCreate && (
                          <div className="space-y-2 pt-2 border-t border-border">
                            <div className="flex flex-wrap items-center gap-2">
                              <select value={docType} onChange={(e) => setDocType(e.target.value)} className={cn(INP, "flex-1 min-w-[180px]")}>
                                <option value="">Select document type</option>
                                {docData.standardTypes.map((t: string) => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <input
                                type="file"
                                multiple
                                ref={fileInputRef}
                                onChange={(e) => handleUploadFiles(e.target.files)}
                                className="hidden"
                              />
                              <button
                                type="button"
                                onClick={() => { if (!docType) { toast.error("Select a document type first"); return; } fileInputRef.current?.click(); }}
                                disabled={uploading}
                                className={`${KEY_LINE} h-9 px-3 text-foreground shrink-0`}
                              >
                                <Upload size={13} /> {uploading ? "Uploading…" : "Upload File(s)"}
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                placeholder="…or paste an external document URL instead"
                                value={docUrl}
                                onChange={(e) => setDocUrl(e.target.value)}
                                className={cn(INP, "flex-1")}
                              />
                              <button type="button" onClick={handleAddDoc} className={`${KEY_LINE} h-9 px-3 text-foreground shrink-0`}>
                                + Add Link
                              </button>
                            </div>
                            <p className="text-[0.6875rem] text-muted-foreground">PDF, images, Word, Excel · up to 10 files, 25 MB each</p>
                          </div>
                        )}
                      </div>
                    </section>

                    <ChecklistSectionBlock vc={vcState.vc} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} sectionKey="Documents" />
                  </div>
                )}

                {/* ── Tab 3: Co-Applicant ── */}
                {wcTab === "Co-Applicant" && (
                  <div className="space-y-4">
                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Users size={14} className="text-primary" /> Co-Applicants
                        </h3>
                        <span className="text-xs text-muted-foreground tabular-nums">{coApplicants.length} listed</span>
                      </div>
                      <div className="p-4 space-y-3">
                        {coApplicants.length === 0 && !addingCo && (
                          <p className="text-xs text-muted-foreground">No co-applicant on this booking yet.</p>
                        )}
                        {coApplicants.map((c: any) => (
                          <div key={c.Id} className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                                {c.ApplicantNo && (
                                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-primary">
                                    Applicant {c.ApplicantNo}
                                  </span>
                                )}
                                <span>{c.Name}</span>
                                {c.Relation && <span className="text-muted-foreground font-normal">· {c.Relation}</span>}
                                {c.CustomerNo && <span className="text-muted-foreground font-normal text-xs">· {c.CustomerNo}</span>}
                              </div>
                              {rights.canDelete && !vcState.locked && (
                                <button type="button" onClick={() => handleRemoveCoApplicant(c.Id)} className="text-xs font-medium text-destructive hover:underline shrink-0">
                                  Remove
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                                <span className="text-[0.6875rem] text-muted-foreground block">Mobile</span>
                                <span className="font-medium tabular-nums">{c.Mobile || "—"}</span>
                              </div>
                              <div className="rounded-md bg-muted/40 px-2.5 py-1.5 min-w-0">
                                <span className="text-[0.6875rem] text-muted-foreground block">Email</span>
                                <span className="font-medium block truncate">{c.Email || "—"}</span>
                              </div>
                              <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                                <span className="text-[0.6875rem] text-muted-foreground block">PAN</span>
                                <span className="font-medium font-mono">{c.PanNo || "—"}</span>
                              </div>
                              <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                                <span className="text-[0.6875rem] text-muted-foreground block">Aadhaar</span>
                                <span className="font-medium tabular-nums">{c.AadhaarNo || "—"}</span>
                              </div>
                            </div>
                          </div>
                        ))}

                        {vcState.locked ? (
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Lock size={12} /> Reopen the verification checklist to add or remove a co-applicant.
                          </p>
                        ) : !addingCo ? (
                          rights.canCreate && (
                            <button type="button" onClick={() => setAddingCo(true)} className={`${KEY_LINE} h-8 px-3 text-foreground`}>
                              <Plus size={12} /> Add Co-Applicant
                            </button>
                          )
                        ) : (
                          <div className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2.5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <input placeholder="Name *" value={coForm.Name} onChange={(e) => setCoForm((f) => ({ ...f, Name: e.target.value }))} className={INP} />
                              <input placeholder="Relation" value={coForm.Relation} onChange={(e) => setCoForm((f) => ({ ...f, Relation: e.target.value }))} className={INP} />
                              <input placeholder="Mobile" value={coForm.Mobile} onChange={(e) => setCoForm((f) => ({ ...f, Mobile: e.target.value }))} className={INP} />
                              <input placeholder="Email" value={coForm.Email} onChange={(e) => setCoForm((f) => ({ ...f, Email: e.target.value }))} className={INP} />
                              <input placeholder="PAN (Permanent Account Number)" value={coForm.PanNo} onChange={(e) => setCoForm((f) => ({ ...f, PanNo: e.target.value }))} className={INP} />
                              <input placeholder="Aadhaar No." value={coForm.AadhaarNo} onChange={(e) => setCoForm((f) => ({ ...f, AadhaarNo: e.target.value }))} className={INP} />
                            </div>
                            <input
                              placeholder="Reason (only needed if legal documents already exist for this booking)"
                              value={coForm.Reason}
                              onChange={(e) => setCoForm((f) => ({ ...f, Reason: e.target.value }))}
                              className={INP}
                            />
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={handleAddCoApplicant} className={`${KEY_INK} h-8 px-3.5`}>Save Co-Applicant</button>
                              <button type="button" onClick={() => setAddingCo(false)} className={`${KEY_LINE} h-8 px-3 text-foreground`}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    <ChecklistSectionBlock vc={vcState.vc} bookingId={booking.BookingId} locked={vcState.locked} onChanged={vcState.refetch} sectionKey="CoApplicant" />
                  </div>
                )}

                {/* ── Tab 4: Bank Preference ── */}
                {wcTab === "Bank Preference" && (
                  <div className="space-y-4">
                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                            <Wallet size={14} className="text-primary" /> How is this purchase being financed?
                          </h3>
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Ask the customer during the call — this unlocks the loan-tracking step and prefills Bank &amp; KYC.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {(["SelfFunded", "LoanFinanced"] as const).map((opt) => {
                            const isSelected = callContext?.financingType === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                disabled={ftSaving}
                                onClick={() => handleSetFinancingType(opt)}
                                className={cn(
                                  "rounded-lg border px-3.5 py-2.5 text-left transition-colors flex items-center gap-2.5 text-sm",
                                  isSelected
                                    ? "border-primary bg-primary/10 text-primary font-medium"
                                    : "border-border bg-card hover:bg-muted/40 text-foreground",
                                  ftSaving ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                                )}
                              >
                                <span className={cn(
                                  "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                                  isSelected ? "border-primary" : "border-muted-foreground/40",
                                )}>
                                  {isSelected && <span className="w-2 h-2 rounded-full bg-primary block" />}
                                </span>
                                {opt === "SelfFunded" ? "Self-funded" : "Home Loan"}
                              </button>
                            );
                          })}
                        </div>
                        {!callContext?.financingType && (
                          <p className={cn("text-xs flex items-center gap-1.5", TONE_AMBER_TEXT)}>
                            <AlertTriangle size={12} className="shrink-0" /> Ask the customer and select above — required before agreement prep.
                          </p>
                        )}
                      </div>
                    </section>

                    <section className={CARD_SHELL}>
                      <div className={CARD_HEAD}>
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Landmark size={14} className="text-primary" /> Customer&apos;s Preferred Banks (Home Loan)
                        </h3>
                      </div>
                      <div className="p-4 space-y-3">
                        <p className="text-xs text-muted-foreground">
                          {callContext?.financingType === "SelfFunded"
                            ? "Customer is self-funded — bank preferences are optional but can still be recorded."
                            : "Banks the customer prefers for their home loan — not the finalised/sanctioned loan. Multiple banks can be recorded."}
                        </p>

                        {bankPreferences.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No bank preferences recorded yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {bankPreferences.map((bp: any) => (
                              <div key={bp.Id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-2.5">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Landmark size={13} className="text-primary shrink-0" />
                                    <span className="text-sm font-medium truncate">{bp.BankName}</span>
                                  </div>
                                  {bp.Remarks && (
                                    <p className="text-xs text-muted-foreground mt-0.5 ml-5">{bp.Remarks}</p>
                                  )}
                                  <p className="text-[0.6875rem] text-muted-foreground mt-0.5 ml-5">
                                    Added by {bp.CreatedByName || "—"} · {bp.CreatedAt ? fmtIstIso(bp.CreatedAt) : ""}
                                  </p>
                                </div>
                                {rights.canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveBankPreference(bp.Id, bp.BankName)}
                                    className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted shrink-0"
                                    title="Remove this bank preference"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {rights.canCreate && (
                          <div className="space-y-2 pt-3 border-t border-border">
                            <label className={FIELD_LBL}>Add a bank preference</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="Bank name (e.g. SBI, HDFC, ICICI…)"
                                value={bpBankName}
                                onChange={(e) => setBpBankName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleAddBankPreference()}
                                className={cn(INP, "flex-1")}
                              />
                              <button
                                type="button"
                                onClick={handleAddBankPreference}
                                disabled={bpSaving || !bpBankName.trim()}
                                className={`${KEY_INK} h-9 px-3.5 shrink-0`}
                              >
                                <Plus size={13} /> {bpSaving ? "Adding…" : "Add"}
                              </button>
                            </div>
                            <input
                              type="text"
                              placeholder="Remarks (optional) — e.g. customer already has an account here"
                              value={bpRemarks}
                              onChange={(e) => setBpRemarks(e.target.value)}
                              className={INP}
                            />
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                )}

                {/* ── Tab 5: Call Log Timeline for this booking ── */}
                {wcTab === "Call Log" && (
                  <section className={CARD_SHELL}>
                    <div className={CARD_HEAD}>
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        <History size={14} className="text-primary" /> Previous Calls ({recentCalls.length})
                      </h3>
                      {isEditingCall && (
                        <button type="button" onClick={exitEditMode} className="text-xs font-medium text-primary hover:underline">
                          + Log new call instead
                        </button>
                      )}
                    </div>
                    <div className="p-4 space-y-2.5">
                      {recentCalls.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">
                          No calls logged for this booking yet. Use the form on the left to record the first call.
                        </p>
                      ) : recentCalls.map((c: any) => {
                        const isCurrentlyEditing = activeEditingCall?.Id === c.Id;
                        const tone = outcomeTone(c.Outcome);
                        return (
                          <div
                            key={c.Id}
                            className={cn(
                              "rounded-lg border p-3.5 space-y-1.5 transition-colors",
                              isCurrentlyEditing ? "border-primary bg-primary/5" : "border-border bg-card",
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <GridToneMark tone={tone} text={OUTCOME_LABEL[c.Outcome] || c.Outcome} />
                                {c.PaymentPlanConfirmed === true && (
                                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
                                    Plan confirmed
                                  </span>
                                )}
                                {c.PaymentPlanConfirmed === false && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 border border-destructive/30 px-2 py-0.5 text-[0.6875rem] font-medium text-destructive">
                                    <ShieldAlert size={10} /> Plan disputed
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
                                <span>{c.CallDate ? fmtIstIso(c.CallDate) : "—"}</span>
                                {c.DurationSeconds ? <span>· {fmtDuration(c.DurationSeconds)}</span> : null}
                                {rights.canEdit && !isCurrentlyEditing && (
                                  <button
                                    type="button"
                                    onClick={() => setLocalEditingCall(c)}
                                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                                  >
                                    <Pencil size={11} /> Edit
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Called by <span className="text-foreground font-medium">{c.CalledByName || "—"}</span>
                              {c.NextCallDate && <> · Follow-up: <span className="text-foreground">{String(c.NextCallDate).slice(0, 10)}</span></>}
                              {c.PreferredAgreementDate && <> · Agreement note: <span className="text-foreground">{String(c.PreferredAgreementDate).slice(0, 10)}</span></>}
                            </p>
                            {c.Notes && <p className="text-xs text-foreground whitespace-pre-wrap pt-0.5">{c.Notes}</p>}
                            {c.PaymentPlanDisputeReason && (
                              <p className="text-xs text-destructive">Objection: {c.PaymentPlanDisputeReason}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-border">
              <button type="button" onClick={onClose} className={`${KEY_LINE} h-9 px-4 text-foreground`}>
                Close
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {previewDoc && <DocPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />}

      {viewingWelcomeCallPdf && (
        <WelcomeCallPdfDialog
          bookingId={viewingWelcomeCallPdf.id}
          bookingNo={viewingWelcomeCallPdf.no}
          onClose={() => setViewingWelcomeCallPdf(null)}
        />
      )}
      {viewingInvoice && (
        <InvoicePdfDialog
          bookingId={booking.BookingId}
          invoice={viewingInvoice}
          onClose={() => setViewingInvoice(null)}
        />
      )}
    </>
  );
};
